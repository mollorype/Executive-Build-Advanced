-- =====================================================================
-- Telegram shift alerts, delivered privately to each CEO who connects
-- Telegram from the CEO portal.
--
-- Alerting: daily_sales_reports INSERT → trigger → pg_net → Edge Function
--   shift-telegram-alert → every chat returned by shift_alert_recipients().
-- Linking:  portal → create_telegram_link_code() (CEO session only)
--   → t.me/<bot>?start=<code> → Telegram → Edge Function telegram-webhook
--   → redeem_telegram_link_code().
-- =====================================================================

-- pg_net: async HTTP from Postgres (what Supabase Database Webhooks use).
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ---------------------------------------------------------------------
-- 1. Once-only ledger: a row here means the shift has been announced.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shift_telegram_notifications (
  shift_id uuid PRIMARY KEY REFERENCES public.daily_sales_reports(id) ON DELETE CASCADE,
  sent_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.shift_telegram_notifications ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: only the Edge Function's service-role key (which
-- bypasses RLS) reads or writes this table.
REVOKE ALL ON public.shift_telegram_notifications FROM anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Linked Telegram chats — one per portal account, one account per chat.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.telegram_links (
  user_id             uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  chat_id             bigint NOT NULL UNIQUE,
  telegram_username   text,
  telegram_first_name text,
  linked_at           timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.telegram_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.telegram_links FROM anon, authenticated;
-- The portal may see and remove only its own link; links are only ever
-- created by redeem_telegram_link_code() below.
GRANT SELECT, DELETE ON public.telegram_links TO authenticated;
DROP POLICY IF EXISTS "own_link_read" ON public.telegram_links;
CREATE POLICY "own_link_read" ON public.telegram_links
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "own_link_delete" ON public.telegram_links;
CREATE POLICY "own_link_delete" ON public.telegram_links
  FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

-- ---------------------------------------------------------------------
-- 3. Single-use link codes (10-minute lifetime). Not client-readable.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.telegram_link_codes (
  code       text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
ALTER TABLE public.telegram_link_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.telegram_link_codes FROM anon, authenticated;

-- Portal (CEO session only): issue a code for the caller.
CREATE OR REPLACE FUNCTION public.create_telegram_link_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text := replace(gen_random_uuid()::text, '-', '');  -- 122 random bits; fits Telegram's 64-char start param
BEGIN
  -- Same trusted, JWT-verified role check every RLS policy uses.
  IF public.current_app_role() IS DISTINCT FROM 'ceo' THEN
    RAISE EXCEPTION 'Only the CEO can connect Telegram alerts' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.telegram_link_codes WHERE user_id = auth.uid() OR expires_at < now();
  INSERT INTO public.telegram_link_codes (code, user_id, expires_at)
  VALUES (v_code, auth.uid(), now() + interval '10 minutes');
  RETURN v_code;
END;
$$;
REVOKE ALL ON FUNCTION public.create_telegram_link_code() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_telegram_link_code() TO authenticated;

-- telegram-webhook (service role only): consume a code and link the chat.
-- Returns 'linked' | 'invalid' (unknown, used or expired) | 'not_allowed'.
CREATE OR REPLACE FUNCTION public.redeem_telegram_link_code(
  p_code text, p_chat_id bigint, p_username text, p_first_name text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
BEGIN
  DELETE FROM public.telegram_link_codes
   WHERE code = p_code AND expires_at > now()
  RETURNING user_id INTO v_user;            -- single use: the code is gone either way
  IF v_user IS NULL THEN
    RETURN 'invalid';
  END IF;

  -- Still a CEO at the moment of linking?
  IF NOT EXISTS (
    SELECT 1 FROM auth.users u JOIN public.ceo_access c ON c.email = lower(u.email)
    WHERE u.id = v_user
  ) THEN
    RETURN 'not_allowed';
  END IF;

  DELETE FROM public.telegram_links WHERE chat_id = p_chat_id AND user_id <> v_user;
  INSERT INTO public.telegram_links (user_id, chat_id, telegram_username, telegram_first_name, linked_at)
  VALUES (v_user, p_chat_id, p_username, p_first_name, now())
  ON CONFLICT (user_id) DO UPDATE
    SET chat_id = EXCLUDED.chat_id,
        telegram_username = EXCLUDED.telegram_username,
        telegram_first_name = EXCLUDED.telegram_first_name,
        linked_at = now();
  RETURN 'linked';
END;
$$;
REVOKE ALL ON FUNCTION public.redeem_telegram_link_code(text, bigint, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_telegram_link_code(text, bigint, text, text) TO service_role;

-- shift-telegram-alert (service role only): who gets alerts. Re-checked at
-- send time, so removing someone from ceo_access stops their alerts at once.
CREATE OR REPLACE FUNCTION public.shift_alert_recipients()
RETURNS TABLE (chat_id bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.chat_id
  FROM public.telegram_links l
  JOIN auth.users u ON u.id = l.user_id
  WHERE EXISTS (SELECT 1 FROM public.ceo_access c WHERE c.email = lower(u.email));
$$;
REVOKE ALL ON FUNCTION public.shift_alert_recipients() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shift_alert_recipients() TO service_role;

-- ---------------------------------------------------------------------
-- 4. Trigger: every new shift → shift-telegram-alert.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_shift_telegram()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER            -- STM Daily inserts as anon, which has no access to schema net
SET search_path = public
AS $$
BEGIN
  -- pg_net only queues the request (sent after commit), and any error here is
  -- downgraded to a warning: the notifier must never block or fail a shift.
  BEGIN
    PERFORM net.http_post(
      url                  := 'https://ryubjollofribrvrwqtz.supabase.co/functions/v1/shift-telegram-alert',
      body                 := jsonb_build_object('shift_id', NEW.id),
      headers              := jsonb_build_object('Content-Type', 'application/json'),
      timeout_milliseconds := 10000
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_shift_telegram failed for %: % (%)', NEW.id, SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_shift_telegram() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS shift_telegram_alert ON public.daily_sales_reports;
CREATE TRIGGER shift_telegram_alert
  AFTER INSERT ON public.daily_sales_reports
  FOR EACH ROW EXECUTE FUNCTION public.notify_shift_telegram();
