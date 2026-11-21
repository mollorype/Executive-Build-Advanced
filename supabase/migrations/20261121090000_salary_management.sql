-- Salary Management
--
-- Employees (debt_profiles with relation 'Employee') move from the Debt
-- Tracker to their own page. Each has a monthly base salary
-- (employee_salary_pool) and items that change one month's pay
-- (employee_salary_items): Overtime and Bonus add, Deduction subtracts,
-- Refund adds back money an employee returned.
--
-- Money an employee takes through STM Daily is NOT deducted automatically:
-- record_daily_app_debt_entry() files it as a *pending* item, shown as a
-- warning, and the owner or accountant chooses to deduct or dismiss it.
--
-- Access is unchanged: owners and accountants only (the existing
-- "ceo_accountant_manage" policies). Safe to run more than once.

-- ── 1. Salary items ─────────────────────────────────────────────────────────
alter table public.employee_salary_items
  add column if not exists salary_month       date,
  add column if not exists source             text not null default 'manual',
  add column if not exists status             text not null default 'applied',
  add column if not exists transaction_number text,
  add column if not exists reported_by        text,
  add column if not exists decided_at         timestamptz,
  add column if not exists decided_by         text;

update public.employee_salary_items
  set salary_month = date_trunc('month', date)::date
  where salary_month is null;
alter table public.employee_salary_items alter column salary_month set not null;

alter table public.employee_salary_items
  drop constraint if exists employee_salary_items_type_check,
  drop constraint if exists employee_salary_items_amount_check,
  drop constraint if exists employee_salary_items_source_check,
  drop constraint if exists employee_salary_items_status_check,
  drop constraint if exists employee_salary_items_month_check,
  drop constraint if exists employee_salary_items_label_check;
alter table public.employee_salary_items
  add constraint employee_salary_items_type_check   check (type in ('Overtime', 'Bonus', 'Deduction', 'Refund')),
  add constraint employee_salary_items_amount_check check (amount > 0),
  add constraint employee_salary_items_source_check check (source in ('manual', 'daily_app')),
  add constraint employee_salary_items_status_check check (status in ('pending', 'applied', 'dismissed')),
  add constraint employee_salary_items_month_check  check (salary_month = date_trunc('month', salary_month)::date),
  add constraint employee_salary_items_label_check  check (label is null or length(label) <= 300);

-- A shift replayed by the offline queue must not file the same entry twice.
create unique index if not exists employee_salary_items_daily_txn
  on public.employee_salary_items (transaction_number) where source = 'daily_app';
create index if not exists employee_salary_items_profile_month
  on public.employee_salary_items (profile_id, salary_month);

alter table public.employee_salary_pool
  drop constraint if exists employee_salary_pool_base_check;
alter table public.employee_salary_pool
  add constraint employee_salary_pool_base_check check (base_salary >= 0);

-- STM Daily is anonymous and only ever reaches salary through the function below.
revoke all on public.employee_salary_items, public.employee_salary_pool from anon;

-- ── 2. Guard: what the daily app reported can't be rewritten from the browser ─
-- Requests from the portal run as "authenticated"; the daily-app function runs
-- as its owner, so only it can file daily / pending items.
create or replace function public.employee_salary_items_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    if old.source = 'daily_app' then
      raise exception 'A daily app entry can''t be deleted — dismiss it instead.' using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    new.source := 'manual';
    new.status := 'applied';
    new.transaction_number := null;
    new.reported_by := null;
    new.decided_at := null;
    new.decided_by := null;
    return new;
  end if;

  -- UPDATE
  if new.profile_id is distinct from old.profile_id
     or new.source is distinct from old.source
     or new.transaction_number is distinct from old.transaction_number
     or new.reported_by is distinct from old.reported_by then
    raise exception 'These details can''t be changed.' using errcode = '42501';
  end if;
  if old.source = 'daily_app' and (new.amount is distinct from old.amount or new.type is distinct from old.type) then
    raise exception 'A daily app entry''s amount can''t be changed — dismiss it and add your own instead.' using errcode = '42501';
  end if;
  if old.source = 'manual' and new.status <> 'applied' then
    raise exception 'Only daily app entries can be pending or dismissed.' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if new.status = 'pending' then
      new.decided_at := null;
      new.decided_by := null;
    else
      new.decided_at := now();
      new.decided_by := lower(auth.jwt() ->> 'email');
    end if;
  else
    new.decided_at := old.decided_at;
    new.decided_by := old.decided_by;
  end if;
  return new;
end;
$$;

drop trigger if exists employee_salary_items_guard on public.employee_salary_items;
create trigger employee_salary_items_guard
  before insert or update or delete on public.employee_salary_items
  for each row execute function public.employee_salary_items_guard();

-- ── 3. STM Daily: employees get a pending salary item, not an automatic deduction ─
-- Same signature, grants and behaviour for every other profile.
create or replace function public.record_daily_app_debt_entry(
  p_profile_id uuid,
  p_amount numeric,
  p_transaction_number text,
  p_note text,
  p_date timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_relation text;
  v_day date;
begin
  if p_profile_id is null or p_amount is null or p_amount = 0 then
    return false;
  end if;

  select relation into v_relation from public.debt_profiles where id = p_profile_id;
  if not found then
    return false;
  end if;

  if v_relation = 'Employee' then
    v_day := (coalesce(p_date, now()) at time zone 'Asia/Yangon')::date;
    insert into public.employee_salary_items
      (profile_id, type, label, amount, date, salary_month, source, status, transaction_number, reported_by)
    values
      (p_profile_id,
       case when p_amount > 0 then 'Deduction' else 'Refund' end,   -- took cash / paid cash back
       left(p_note, 300),
       abs(p_amount),
       v_day,
       date_trunc('month', v_day)::date,
       'daily_app',
       'pending',
       left(p_transaction_number, 64),
       nullif(btrim(split_part(coalesce(p_note, ''), ' — ', 2)), ''))
    on conflict (transaction_number) where source = 'daily_app' do nothing;
    return true;
  end if;

  insert into public.debt_transactions
    (profile_id, amount, date, note, transaction_number, source)
  values
    (p_profile_id, p_amount, coalesce(p_date, now()), p_note, p_transaction_number, 'daily_app');

  update public.debt_profiles
  set current_balance = coalesce(current_balance, 0) + p_amount,
      score           = least(100, coalesce(score, 50) + 5),
      last_payment_at = coalesce(p_date, now())
  where id = p_profile_id;

  return true;
end;
$$;
revoke all on function public.record_daily_app_debt_entry(uuid, numeric, text, text, timestamptz) from public;
grant execute on function public.record_daily_app_debt_entry(uuid, numeric, text, text, timestamptz) to anon, authenticated;
