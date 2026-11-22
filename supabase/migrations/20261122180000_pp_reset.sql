-- P-P: owners can delete all P-P data and start over.
--
-- STM Financial → Settings → P-P Ledger & profit → "Delete all P-P data".
-- Deletes every P-P line (purchases, official POs, counts, lending /
-- borrowing, used), every shift deduction, the purchase and cost records
-- behind profit, and the Deleted list. Kept: shift reports, stations
-- (shops), settings.
--
-- The moment of the reset is remembered (pp_settings.reset_at): shifts from
-- before it are never deducted (not automatically, not by hand), because the
-- stock counted after the reset already reflects them. Shifts after it are
-- deducted as usual.
--
-- One "started over" entry stays in the Deleted list with a full copy of
-- what was deleted, so a mistake can still be undone by hand.
-- Owners only — checked here, not in the browser. Needs
-- 20261122120000_pp_profit_engine. Safe to run more than once.

alter table public.pp_settings add column if not exists reset_at timestamptz;

alter table public.pp_archive drop constraint if exists pp_archive_kind_check;
alter table public.pp_archive add constraint pp_archive_kind_check check (kind in ('movement', 'shift', 'reset'));

-- p_confirm must be exactly 'DELETE ALL P-P' (the app sends it after the
-- owner typed the confirmation word), so a stray call can't wipe anything.
create or replace function public.pp_reset_all(p_confirm text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_lines  integer;
  v_shifts integer;
  v_old    integer;
  v_snap   jsonb;
  v_now    timestamptz := now();
begin
  if public.current_app_role() is distinct from 'ceo' then
    raise exception 'Only an owner can delete all P-P data' using errcode = '42501';
  end if;
  if p_confirm is distinct from 'DELETE ALL P-P' then
    raise exception 'Not confirmed' using errcode = '22023';
  end if;
  -- No shift deduction or P-P line can slip in half-way.
  lock table public.pipa_movements, public.pipa_shift_deductions, public.pp_lots, public.pp_cost_lines, public.pp_archive
    in share row exclusive mode;

  select count(*) into v_lines from public.pipa_movements where shift_batch_id is null;
  select count(*) into v_shifts from public.pipa_shift_deductions;
  select count(*) into v_old from public.pp_archive;
  v_snap := jsonb_build_object(
    'counts', jsonb_build_object('lines', v_lines, 'shift_deductions', v_shifts, 'deleted_entries', v_old),
    'movements', coalesce((select jsonb_agg(to_jsonb(m) order by m.occurred_on, m.created_at) from public.pipa_movements m), '[]'::jsonb),
    'shift_deductions', coalesce((select jsonb_agg(to_jsonb(d)) from public.pipa_shift_deductions d), '[]'::jsonb),
    'archive', coalesce((select jsonb_agg(to_jsonb(a) order by a.archived_at) from public.pp_archive a), '[]'::jsonb));

  delete from public.pp_cost_lines where true;
  delete from public.pp_lots where true;
  delete from public.pipa_movements where true;
  delete from public.pipa_shift_deductions where true;
  delete from public.pp_archive where true;

  insert into public.pp_archive (kind, summary, snapshot, reason, archived_by, actor_role, notify)
  values ('reset', format('All P-P data deleted · %s lines · %s shift deductions · %s deleted entries', v_lines, v_shifts, v_old),
          v_snap, 'Owner started over', lower(auth.jwt() ->> 'email'), 'ceo', false);
  update public.pp_settings set reset_at = v_now where id;

  return jsonb_build_object('lines', v_lines, 'shift_deductions', v_shifts, 'deleted_entries', v_old, 'reset_at', v_now);
end;
$$;
revoke all on function public.pp_reset_all(text) from public, anon;
grant execute on function public.pp_reset_all(text) to authenticated;

create or replace function public.pp_reset_at()
returns timestamptz language sql stable security definer set search_path = ''
as $$ select reset_at from public.pp_settings where id $$;

-- Deduct one shift — never one from before the reset.
create or replace function public.pp_deduct_shift(p_shift uuid, p_auto boolean, p_who text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_batch uuid := gen_random_uuid();
  v_pp    numeric := public.pp_pp_liters();
  v_fig   record;
  v_on    date;
  v_name  text;
  v_mid   uuid;
  r       record;
begin
  select * into v_fig from public.pp_shift_figures(p_shift);
  if v_fig.shift_at is null then raise exception 'Unknown shift' using errcode = '23503'; end if;
  if v_fig.shift_at < public.pp_reset_at() then
    raise exception 'This shift is from before the P-P data was reset' using errcode = 'P0001';
  end if;
  select employee_name into v_name from public.daily_sales_reports where id = p_shift;
  v_on := (v_fig.shift_at at time zone 'Asia/Yangon')::date;

  insert into public.pipa_shift_deductions (shift_id, batch_id, liters, amounts, shift_at, auto, deducted_by)
  values (p_shift, v_batch, v_fig.liters, v_fig.amounts, v_fig.shift_at, p_auto, p_who);

  for r in select * from public.pp_shift_sales((select fuel_data from public.daily_sales_reports where id = p_shift), v_pp) loop
    v_mid := null;
    if round(r.liters / v_pp, 3) > 0 then
      insert into public.pipa_movements (occurred_on, kind, product, pipas, liters_per_pipa, exact_liters, note, shift_batch_id, created_by)
      values (v_on, 'used', r.product, round(r.liters / v_pp, 3), v_pp, r.liters,
              format('Shift sales: %s L · %s', round(r.liters, 2), coalesce(nullif(btrim(v_name), ''), '—')), v_batch, p_who)
      returning id into v_mid;
    end if;
    perform public.pp_take(r.product, r.liters, 'sale', r.amount, null, p_shift, v_batch, v_mid, null, v_on, p_who);
  end loop;
end;
$$;

-- Automatic deduction: quietly leaves shifts from before the reset alone.
create or replace function public.pp_shift_changed()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_auto boolean := coalesce((select auto_deduct from public.pp_settings where id), true);
  v_fig  record;
  d      public.pipa_shift_deductions;
begin
  if tg_op = 'DELETE' then
    begin
      perform public.pp_archive_shift(old.id, 'Shift deleted — its deduction was put back', false);
    exception when others then
      raise warning 'P-P: could not put back deleted shift %: % (%)', old.id, sqlerrm, sqlstate;
    end;
    return old;
  end if;

  if not v_auto then return new; end if;
  if new."timestamp" < public.pp_reset_at() then return new; end if;
  begin
    if tg_op = 'INSERT' then
      perform public.pp_deduct_shift(new.id, true, 'auto');
    else
      select * into d from public.pipa_shift_deductions where shift_id = new.id;
      if found then
        select * into v_fig from public.pp_shift_figures(new.id);
        if d.liters is distinct from v_fig.liters or d.amounts is distinct from v_fig.amounts or d.shift_at is distinct from v_fig.shift_at then
          perform public.pp_archive_shift(new.id, 'Shift edited — deducted again automatically', false);
          perform public.pp_deduct_shift(new.id, true, 'auto');
        end if;
      end if;
    end if;
  exception when others then
    raise warning 'P-P: automatic deduction of shift % failed: % (%)', new.id, sqlerrm, sqlstate;
  end;
  return new;
end;
$$;

-- The "Deduct shift sales" list leaves out shifts from before the reset.
drop function if exists public.shifts_for_deduction(integer);
create function public.shifts_for_deduction(p_limit integer default 100)
returns table (id uuid, shift_at timestamptz, employee_name text, liters jsonb, amounts jsonb, deducted boolean, changed boolean, auto boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_role  text := public.pp_require_role();
  v_since timestamptz := coalesce(public.pp_reset_at(), '-infinity'::timestamptz);
begin
  return query
  select s.id, s."timestamp", s.employee_name, f.liters,
         case when v_role = 'ceo' then f.amounts end,
         d.shift_id is not null,
         d.shift_id is not null and (d.liters is distinct from f.liters or d.amounts is distinct from f.amounts
                                     or d.shift_at is distinct from s."timestamp"),
         coalesce(d.auto, false)
  from public.daily_sales_reports s
  cross join lateral public.pp_shift_figures(s.id) f
  left join public.pipa_shift_deductions d on d.shift_id = s.id
  where s."timestamp" >= v_since
  order by s."timestamp" desc
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;
revoke all on function public.shifts_for_deduction(integer) from public, anon;
grant execute on function public.shifts_for_deduction(integer) to authenticated;

revoke all on function public.pp_reset_at(), public.pp_deduct_shift(uuid, boolean, text), public.pp_shift_changed()
  from public, anon, authenticated;
