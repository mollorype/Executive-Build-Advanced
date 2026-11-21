-- Which Telegram notices STM Daily employees get — one row, set by an owner in
-- STM Financial → Settings. The staff-telegram-notify Edge Function skips any
-- type that is switched off; STM Daily reads it to show what staff will get.
--
-- Defaults: salary paid, salary changes, emergencies and team chat on; leave
-- decisions off. Staff can read the row; only an owner can change it, and the
-- database stamps who changed it and when. Safe to run more than once.

create table if not exists public.staff_notify_settings (
  id            boolean primary key default true check (id),   -- exactly one row
  salary_paid   boolean not null default true,
  salary_item   boolean not null default true,
  emergency     boolean not null default true,
  chat_message  boolean not null default true,
  leave_decided boolean not null default false,
  updated_at    timestamptz not null default now(),
  updated_by    text
);
insert into public.staff_notify_settings (id) values (true) on conflict (id) do nothing;

alter table public.staff_notify_settings enable row level security;
revoke all on public.staff_notify_settings from anon, authenticated;
grant select on public.staff_notify_settings to authenticated;
grant update (salary_paid, salary_item, emergency, chat_message, leave_decided) on public.staff_notify_settings to authenticated;

drop policy if exists "owner_and_staff_read" on public.staff_notify_settings;
create policy "owner_and_staff_read" on public.staff_notify_settings for select to authenticated
  using (public.current_app_role() = 'ceo' or public.chat_member_role() is not null);
drop policy if exists "owner_update" on public.staff_notify_settings;
create policy "owner_update" on public.staff_notify_settings for update to authenticated
  using (public.current_app_role() = 'ceo') with check (public.current_app_role() = 'ceo');

create or replace function public.staff_notify_settings_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := lower(auth.jwt() ->> 'email');
  return new;
end;
$$;
drop trigger if exists staff_notify_settings_stamp on public.staff_notify_settings;
create trigger staff_notify_settings_stamp
  before update on public.staff_notify_settings
  for each row execute function public.staff_notify_settings_stamp();
