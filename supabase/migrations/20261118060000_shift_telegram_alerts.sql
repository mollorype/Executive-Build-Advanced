-- =====================================================================
-- Telegram alert for every STM Daily shift submission.
--
-- AFTER INSERT on daily_sales_reports → pg_net POST { shift_id } to the
-- `shift-telegram-alert` Edge Function, which re-reads the shift, sends the
-- message, and records it in shift_telegram_notifications (once per shift).
-- =====================================================================

-- pg_net: async HTTP from Postgres (what Supabase Database Webhooks use).
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Once-only ledger: a row here means the shift has been announced.
CREATE TABLE IF NOT EXISTS public.shift_telegram_notifications (
  shift_id uuid PRIMARY KEY REFERENCES public.daily_sales_reports(id) ON DELETE CASCADE,
  sent_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.shift_telegram_notifications ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: only the Edge Function's service-role key, which
-- bypasses RLS, reads or writes this table.
REVOKE ALL ON public.shift_telegram_notifications FROM anon, authenticated;

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
