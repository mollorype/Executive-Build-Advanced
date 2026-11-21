-- Salary payments: the month-by-month history.
--
-- When an owner or accountant marks a month's salary as paid, the figures
-- are saved here (base, overtime, bonus, cash paid back, deductions, net),
-- so the history stays exactly as paid even if the base salary or entries
-- change later. One payment per employee per month; "undo" deletes it.
-- Who paid and when are stamped by the database, not the browser.
--
-- Also: employee_salary_pool.staff_email links an employee to their STM
-- Daily sign-in, so salary notifications can reach them on Telegram.
-- Safe to run more than once.

create table if not exists public.employee_salary_payments (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.debt_profiles(id) on delete cascade,
  salary_month date not null,
  base         numeric not null default 0,
  overtime     numeric not null default 0,
  bonus        numeric not null default 0,
  refund       numeric not null default 0,
  deductions   numeric not null default 0,
  net          numeric not null default 0,
  note         text,
  paid_at      timestamptz not null default now(),
  paid_by      text,
  constraint employee_salary_payments_one_per_month unique (profile_id, salary_month),
  constraint employee_salary_payments_month_check check (salary_month = date_trunc('month', salary_month)::date),
  constraint employee_salary_payments_amounts_check check (base >= 0 and overtime >= 0 and bonus >= 0 and refund >= 0 and deductions >= 0),
  constraint employee_salary_payments_note_check check (note is null or length(note) <= 300)
);
create index if not exists employee_salary_payments_month on public.employee_salary_payments (salary_month);

alter table public.employee_salary_payments enable row level security;
revoke all on public.employee_salary_payments from anon;
-- Explicit, rather than relying on the project's default grants. No UPDATE: payments are records.
grant select, insert, delete on public.employee_salary_payments to authenticated;
drop policy if exists "ceo_accountant_manage" on public.employee_salary_payments;
create policy "ceo_accountant_manage" on public.employee_salary_payments
  for all to authenticated
  using (public.current_app_role() in ('ceo', 'accountant'))
  with check (public.current_app_role() in ('ceo', 'accountant'));

-- The net always adds up; who and when come from the session; a payment is
-- a record and is never edited (undo it and pay again instead).
create or replace function public.employee_salary_payments_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'A salary payment can''t be changed — undo it and mark it paid again.' using errcode = '42501';
  end if;
  new.net := new.base + new.overtime + new.bonus + new.refund - new.deductions;
  new.paid_at := now();
  new.paid_by := lower(auth.jwt() ->> 'email');
  return new;
end;
$$;
drop trigger if exists employee_salary_payments_stamp on public.employee_salary_payments;
create trigger employee_salary_payments_stamp
  before insert or update on public.employee_salary_payments
  for each row execute function public.employee_salary_payments_stamp();

alter table public.employee_salary_pool
  add column if not exists staff_email text;
alter table public.employee_salary_pool
  drop constraint if exists employee_salary_pool_staff_email_check;
alter table public.employee_salary_pool
  add constraint employee_salary_pool_staff_email_check
  check (staff_email is null or (staff_email = lower(btrim(staff_email)) and staff_email like '%@%'));
