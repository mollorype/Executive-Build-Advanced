-- Employee Telegram notifications.
--
-- STM Daily staff can now connect the same Telegram bot owners use, and get:
--   • salary paid / salary entries applied (deduction, bonus, overtime, paid back)
--     — reaching the employee whose Salary profile has their STM Daily email
--   • their leave request approved or declined
--   • emergency alerts from the team chat
--   • new team-chat messages, only if they switch it on (off by default; the
--     notice never includes the message — chat is end-to-end encrypted)
--
-- Owner alerts are unchanged: shift_alert_recipients() still returns owners
-- only, so a staff link never receives shift or owner alerts.
-- The staff-telegram-notify Edge Function sends each notice once.
-- Needs: telegram_shift_alerts, team_chat, salary_management, salary_payments.
-- Safe to run more than once.

-- ── 1. Who may connect: owners and STM Daily staff ───────────────────────────
create or replace function public.create_telegram_link_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := replace(gen_random_uuid()::text, '-', '');
begin
  -- chat_member_role(): 'ceo' or 'staff' for the verified session, else null.
  if public.chat_member_role() is null then
    raise exception 'Only owners and STM Daily staff can connect Telegram' using errcode = '42501';
  end if;
  delete from public.telegram_link_codes where user_id = auth.uid() or expires_at < now();
  insert into public.telegram_link_codes (code, user_id, expires_at)
  values (v_code, auth.uid(), now() + interval '10 minutes');
  return v_code;
end;
$$;
revoke all on function public.create_telegram_link_code() from public, anon;
grant execute on function public.create_telegram_link_code() to authenticated;

-- 'linked' for an owner, 'linked_staff' for staff (the bot words its reply differently).
create or replace function public.redeem_telegram_link_code(
  p_code text, p_chat_id bigint, p_username text, p_first_name text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_role text;
begin
  delete from public.telegram_link_codes
   where code = p_code and expires_at > now()
  returning user_id into v_user;            -- single use
  if v_user is null then
    return 'invalid';
  end if;

  v_role := public.chat_role_of(v_user);    -- still an owner / still on the staff list?
  if v_role is null then
    return 'not_allowed';
  end if;

  delete from public.telegram_links where chat_id = p_chat_id and user_id <> v_user;
  insert into public.telegram_links (user_id, chat_id, telegram_username, telegram_first_name, linked_at)
  values (v_user, p_chat_id, p_username, p_first_name, now())
  on conflict (user_id) do update
    set chat_id = excluded.chat_id,
        telegram_username = excluded.telegram_username,
        telegram_first_name = excluded.telegram_first_name,
        linked_at = now();
  return case when v_role = 'ceo' then 'linked' else 'linked_staff' end;
end;
$$;
revoke all on function public.redeem_telegram_link_code(text, bigint, text, text) from public, anon, authenticated;
grant execute on function public.redeem_telegram_link_code(text, bigint, text, text) to service_role;

-- ── 2. Chat-message notices are opt-in; each person sets their own ───────────
alter table public.telegram_links add column if not exists notify_chat boolean not null default true;   -- staff can switch it off on their card
grant update (notify_chat) on public.telegram_links to authenticated;
drop policy if exists "own_link_update" on public.telegram_links;
create policy "own_link_update" on public.telegram_links
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── 3. Recipients (service role only; re-checked at send time) ───────────────
-- The linked chat of the STM Daily staff member with this email.
create or replace function public.staff_chat_for_email(p_email text)
returns table (chat_id bigint)
language sql
stable
security definer
set search_path = public
as $$
  select l.chat_id
  from public.telegram_links l
  join auth.users u on u.id = l.user_id
  where lower(u.email) = lower(btrim(p_email))
    and public.chat_role_of(u.id) = 'staff';
$$;

-- The linked chat of this user, if they are still staff.
create or replace function public.staff_chat_for_user(p_user uuid)
returns table (chat_id bigint)
language sql
stable
security definer
set search_path = public
as $$
  select l.chat_id from public.telegram_links l
  where l.user_id = p_user and public.chat_role_of(p_user) = 'staff';
$$;

-- Every linked staff member except `p_except` (the sender).
create or replace function public.staff_chat_recipients(p_except uuid)
returns table (chat_id bigint, notify_chat boolean)
language sql
stable
security definer
set search_path = public
as $$
  select l.chat_id, l.notify_chat from public.telegram_links l
  where l.user_id is distinct from p_except and public.chat_role_of(l.user_id) = 'staff';
$$;

revoke all on function public.staff_chat_for_email(text) from public, anon, authenticated;
revoke all on function public.staff_chat_for_user(uuid) from public, anon, authenticated;
revoke all on function public.staff_chat_recipients(uuid) from public, anon, authenticated;
grant execute on function public.staff_chat_for_email(text) to service_role;
grant execute on function public.staff_chat_for_user(uuid) to service_role;
grant execute on function public.staff_chat_recipients(uuid) to service_role;
-- The Edge Function needs these too, under the service role.
grant execute on function public.chat_role_of(uuid) to service_role;

-- ── 4. Each notice is sent once (calls are claimed here first) ───────────────
create table if not exists public.staff_telegram_sent (
  event   text not null,
  ref_id  uuid not null,
  sent_at timestamptz not null default now(),
  primary key (event, ref_id)
);
alter table public.staff_telegram_sent enable row level security;
revoke all on public.staff_telegram_sent from anon, authenticated;

-- ── 5. Triggers → staff-telegram-notify ──────────────────────────────────────
create or replace function public.notify_staff_telegram()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event text;
begin
  if tg_table_name = 'employee_salary_payments' then
    v_event := 'salary_paid';
  elsif tg_table_name = 'employee_salary_items' then
    -- a manual entry, or an STM Daily entry being deducted; never pending/dismissed
    if new.status = 'applied' and (tg_op = 'INSERT' or old.status is distinct from 'applied') then
      v_event := 'salary_item';
    end if;
  elsif tg_table_name = 'chat_messages' then
    if tg_op = 'INSERT' and new.kind = 'emergency' then
      v_event := 'emergency';
    elsif tg_op = 'INSERT' and new.kind = 'message' then
      v_event := 'chat_message';
    elsif tg_op = 'UPDATE' and new.kind = 'leave' and new.status in ('approved', 'declined')
          and old.status is distinct from new.status then
      v_event := 'leave_decided';
    end if;
  end if;

  if v_event is not null then
    begin
      perform net.http_post(
        url                  := 'https://ryubjollofribrvrwqtz.supabase.co/functions/v1/staff-telegram-notify',
        body                 := jsonb_build_object('event', v_event, 'id', new.id),
        headers              := jsonb_build_object('Content-Type', 'application/json'),
        timeout_milliseconds := 10000
      );
    exception when others then
      raise warning 'notify_staff_telegram failed for % %: % (%)', v_event, new.id, sqlerrm, sqlstate;
    end;
  end if;
  return new;
end;
$$;
revoke all on function public.notify_staff_telegram() from public, anon, authenticated;

drop trigger if exists staff_telegram_salary_paid on public.employee_salary_payments;
create trigger staff_telegram_salary_paid
  after insert on public.employee_salary_payments
  for each row execute function public.notify_staff_telegram();

drop trigger if exists staff_telegram_salary_item on public.employee_salary_items;
create trigger staff_telegram_salary_item
  after insert or update of status on public.employee_salary_items
  for each row execute function public.notify_staff_telegram();

drop trigger if exists staff_telegram_chat on public.chat_messages;
create trigger staff_telegram_chat
  after insert or update of status on public.chat_messages
  for each row execute function public.notify_staff_telegram();
