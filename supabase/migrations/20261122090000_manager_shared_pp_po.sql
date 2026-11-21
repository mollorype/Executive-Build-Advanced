-- Manager role, and one P-P / PO record for everyone.
--
-- • Managers (manager_access) can now sign in to STM Financial. What they can
--   use: the P-P Ledger — the same as accountants (who also keep the Debt
--   Tracker and Salary). The PO Registry stays owner-only.
-- • P-P Ledger and PO Registry are the same stock seen two ways: deducting a
--   shift's sales (from either page) takes it off P-P stock AND off the POs,
--   with that day's selling price; a P-P purchase can add its PO in the same
--   step. Each shift is deducted once, for both.
--
-- current_app_role() gains 'manager'. Every existing policy and function
-- compares it with exact values ('ceo', or 'ceo'/'accountant'), so this grants
-- managers nothing beyond what is added here. Safe to run more than once.

-- ── 1. Manager role ──────────────────────────────────────────────────────────
create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.jwt() ->> 'email' is null then null
    when exists (select 1 from public.ceo_access where email = lower(auth.jwt() ->> 'email')) then 'ceo'
    when exists (select 1 from public.accountant_access where email = lower(auth.jwt() ->> 'email')) then 'accountant'
    when exists (select 1 from public.manager_access where email = lower(auth.jwt() ->> 'email')) then 'manager'
    else null
  end;
$$;
revoke all on function public.current_app_role() from public;
grant execute on function public.current_app_role() to authenticated;

-- Sign-up pre-check (yes/no for one email), like is_accountant_allowed.
create or replace function public.is_manager_allowed(check_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.manager_access where email = lower(btrim(check_email)));
$$;
revoke all on function public.is_manager_allowed(text) from public;
grant execute on function public.is_manager_allowed(text) to anon, authenticated;

-- ── 2. P-P Ledger: owners, accountants and managers ──────────────────────────
-- Only the table rights the page uses (no truncate / references / trigger).
revoke all on public.pipa_stations, public.pipa_movements, public.pipa_shift_deductions from anon, authenticated;
grant select, insert, update, delete on public.pipa_stations, public.pipa_movements to authenticated;
grant select on public.pipa_shift_deductions to authenticated;

drop policy if exists "ceo_manage" on public.pipa_stations;
drop policy if exists "pp_manage" on public.pipa_stations;
create policy "pp_manage" on public.pipa_stations for all to authenticated
  using (public.current_app_role() in ('ceo', 'accountant', 'manager'))
  with check (public.current_app_role() in ('ceo', 'accountant', 'manager'));

-- Movements: everyone on the P-P Ledger reads them all. Lines from a shift
-- deduction change only through undo_shift_usage() (so the POs change with
-- them), and only an owner may link a line to a PO directly — a purchase with
-- its PO goes through record_pipa_buy().
drop policy if exists "ceo_manage" on public.pipa_movements;
drop policy if exists "pp_manage" on public.pipa_movements;
drop policy if exists "pp_read" on public.pipa_movements;
drop policy if exists "pp_insert" on public.pipa_movements;
drop policy if exists "pp_update" on public.pipa_movements;
drop policy if exists "pp_delete" on public.pipa_movements;
create policy "pp_read" on public.pipa_movements for select to authenticated
  using (public.current_app_role() in ('ceo', 'accountant', 'manager'));
create policy "pp_insert" on public.pipa_movements for insert to authenticated
  with check (public.current_app_role() in ('ceo', 'accountant', 'manager') and shift_batch_id is null
              and (po_id is null or public.current_app_role() = 'ceo'));
create policy "pp_update" on public.pipa_movements for update to authenticated
  using (public.current_app_role() in ('ceo', 'accountant', 'manager') and shift_batch_id is null)
  with check (public.current_app_role() in ('ceo', 'accountant', 'manager') and shift_batch_id is null
              and (po_id is null or public.current_app_role() = 'ceo'));
create policy "pp_delete" on public.pipa_movements for delete to authenticated
  using (public.current_app_role() in ('ceo', 'accountant', 'manager') and shift_batch_id is null);

-- Which shifts were deducted: read-only to the browser (changed by the functions below).
drop policy if exists "ceo_manage" on public.pipa_shift_deductions;
drop policy if exists "pp_read" on public.pipa_shift_deductions;
create policy "pp_read" on public.pipa_shift_deductions for select to authenticated
  using (public.current_app_role() in ('ceo', 'accountant', 'manager'));
drop policy if exists "ceo_read" on public.po_shift_deductions;
drop policy if exists "pp_read" on public.po_shift_deductions;
create policy "pp_read" on public.po_shift_deductions for select to authenticated
  using (public.current_app_role() in ('ceo', 'accountant', 'manager'));
-- po_usage (prices and amounts per PO) stays owner-only.

-- ── 3. Recent shifts for the "Deduct shift sales" dialog ─────────────────────
-- Accountants and managers can't read daily_sales_reports (cash, differences);
-- this gives them only what deducting needs: when, who, and the fuel figures.
-- before_open_pos: the shift is older than every PO still open, so its sales
-- weren't from those POs (the dialog leaves it unticked).
drop function if exists public.shifts_for_deduction(integer);
create function public.shifts_for_deduction(p_limit integer default 100)
returns table (id uuid, shift_at timestamptz, employee_name text, fuel_data jsonb, deducted boolean, before_open_pos boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with since as (
    select min(f.created_at) as at from public.fuel_purchase_orders f
    where f.status <> 'DONE' and f.shortage_liters is null
  )
  select s.id, s."timestamp", s.employee_name, s.fuel_data,
         exists (select 1 from public.po_shift_deductions d where d.shift_id = s.id)
           or exists (select 1 from public.pipa_shift_deductions d where d.shift_id = s.id),
         coalesce(s."timestamp" < (select at from since), false)
  from public.daily_sales_reports s
  where public.current_app_role() in ('ceo', 'accountant', 'manager')
  order by s."timestamp" desc
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;
revoke all on function public.shifts_for_deduction(integer) from public, anon;
grant execute on function public.shifts_for_deduction(integer) to authenticated;

-- ── 4. One deduction for P-P stock and the POs ───────────────────────────────
-- p_rows: [{ "shift_id": uuid, "product": "92"|"95"|"PD"|"D", "liters": n, "amount": n }, ...]
-- Returns { batch, unallocated: { product: litres } } — litres no PO could take.
create or replace function public.record_shift_usage(p_rows jsonb, p_liters_per_pipa numeric default 215)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch   uuid := gen_random_uuid();
  v_who     text := lower(auth.jwt() ->> 'email');
  v_left    jsonb := '{}'::jsonb;
  v_shifts  integer;
  r         record;
  po        record;
  v_rest    numeric;
  v_cal     numeric;
  v_take    numeric;
  v_used    numeric;
  v_remain  numeric;
begin
  if public.current_app_role() is null or public.current_app_role() not in ('ceo', 'accountant', 'manager') then
    raise exception 'Only owners, accountants and managers can deduct shift sales' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'No shifts selected';
  end if;
  if p_liters_per_pipa is null or p_liters_per_pipa <= 0 then
    raise exception 'P-P size must be positive';
  end if;
  if exists (select 1 from jsonb_array_elements(p_rows) e
             where coalesce(e ->> 'product', '') not in ('92', '95', 'PD', 'D')
                or coalesce((e ->> 'liters')::numeric, 0) < 0 or coalesce((e ->> 'amount')::numeric, 0) < 0) then
    raise exception 'Each line needs a fuel (92, 95, PD, D) and litres / money that are not negative';
  end if;

  -- Each shift once, for both (a second attempt fails with 23505; an unknown shift with 23503).
  insert into public.po_shift_deductions (shift_id, batch_id)
  select distinct (e ->> 'shift_id')::uuid, v_batch from jsonb_array_elements(p_rows) e;
  insert into public.pipa_shift_deductions (shift_id, batch_id)
  select distinct (e ->> 'shift_id')::uuid, v_batch from jsonb_array_elements(p_rows) e;
  get diagnostics v_shifts = row_count;

  -- P-P stock: one "Sold / used" line per fuel.
  insert into public.pipa_movements (kind, product, pipas, liters_per_pipa, note, shift_batch_id)
  select 'used', t.product, round(t.liters / p_liters_per_pipa, 3), p_liters_per_pipa,
         format('Shift sales: %s L from %s shift(s)', round(t.liters, 2), v_shifts), v_batch
  from (select e ->> 'product' as product, sum((e ->> 'liters')::numeric) as liters
        from jsonb_array_elements(p_rows) e group by 1) t
  where round(t.liters / p_liters_per_pipa, 3) > 0;

  -- POs: oldest first (the ACTIVE one first), each piece with that shift's price.
  for r in
    select (e ->> 'shift_id')::uuid as shift_id, s."timestamp" as shift_at, e ->> 'product' as product,
           coalesce((e ->> 'liters')::numeric, 0) as liters, coalesce((e ->> 'amount')::numeric, 0) as amount
    from jsonb_array_elements(p_rows) e
    join public.daily_sales_reports s on s.id = (e ->> 'shift_id')::uuid
    order by s."timestamp", e ->> 'product'
  loop
    if r.liters = 0 then continue; end if;
    v_rest := r.liters;
    while v_rest > 0.0005 loop
      select * into po
      from public.fuel_purchase_orders f
      where f.product_type = r.product and f.status <> 'DONE' and f.shortage_liters is null and f.remaining_volume > 0
      order by (f.status = 'ACTIVE') desc, f.created_at, f.id
      limit 1
      for update;
      if not found then
        v_left := jsonb_set(v_left, array[r.product], to_jsonb(round(coalesce((v_left ->> r.product)::numeric, 0) + v_rest, 3)));
        exit;
      end if;

      v_cal    := coalesce(nullif(po.calibration_factor, 0), 1);
      v_take   := least(v_rest, po.remaining_volume / v_cal);
      v_used   := v_take * v_cal;
      v_remain := po.remaining_volume - v_used;
      if v_remain < 0.001 then v_remain := 0; end if;

      insert into public.po_usage (batch_id, po_id, shift_id, shift_at, product, liters, stock_used, amount, status_before, created_by)
      values (v_batch, po.id, r.shift_id, r.shift_at, r.product, v_take, v_used,
              round(r.amount * v_take / r.liters, 2), po.status, v_who);

      update public.fuel_purchase_orders
      set remaining_volume  = v_remain,
          total_volume_sold = coalesce(total_volume_sold, 0) + v_take,
          status            = case when v_remain = 0 then 'DONE' else 'ACTIVE' end
      where id = po.id;

      v_rest := v_rest - v_take;
    end loop;
  end loop;

  return jsonb_build_object('batch', v_batch, 'unallocated', v_left);
end;
$$;

-- Undo one deduction, for both: P-P lines removed, litres back on the POs with
-- the status they had, shifts free again. As before, only the newest
-- deduction for a fuel, and not after a PO it used was force-closed.
create or replace function public.undo_shift_usage(p_batch uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shifts integer;
  v_last   timestamptz;
begin
  if public.current_app_role() is null or public.current_app_role() not in ('ceo', 'accountant', 'manager') then
    raise exception 'Only owners, accountants and managers can undo a shift deduction' using errcode = '42501';
  end if;
  select max(created_at) into v_last from public.po_usage where batch_id = p_batch;

  if v_last is not null then
    if exists (
      select 1 from public.po_usage u
      where u.batch_id <> p_batch and u.created_at > v_last
        and u.product in (select product from public.po_usage where batch_id = p_batch)
    ) then
      raise exception 'Undo the newer deduction first' using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.fuel_purchase_orders f
      where f.id in (select po_id from public.po_usage where batch_id = p_batch) and f.shortage_liters is not null
    ) then
      raise exception 'A purchase order in this deduction was force-closed afterwards' using errcode = 'P0001';
    end if;

    update public.fuel_purchase_orders f
    set remaining_volume  = f.remaining_volume + b.used,
        total_volume_sold = greatest(0, coalesce(f.total_volume_sold, 0) - b.sold),
        status            = b.status_before
    from (
      select po_id, sum(stock_used) as used, sum(liters) as sold,
             (array_agg(status_before order by created_at))[1] as status_before
      from public.po_usage where batch_id = p_batch group by po_id
    ) b
    where f.id = b.po_id;
    delete from public.po_usage where batch_id = p_batch;
  end if;

  delete from public.pipa_movements where shift_batch_id = p_batch;
  delete from public.po_shift_deductions where batch_id = p_batch;
  delete from public.pipa_shift_deductions where batch_id = p_batch;
  get diagnostics v_shifts = row_count;
  return v_shifts;
end;
$$;

revoke all on function public.record_shift_usage(jsonb, numeric), public.undo_shift_usage(uuid) from public, anon;
grant execute on function public.record_shift_usage(jsonb, numeric), public.undo_shift_usage(uuid) to authenticated;

-- The older entry points now do the same as the shared ones, so every page
-- (even one opened before this update) keeps P-P and the POs together.
create or replace function public.record_po_shift_usage(p_rows jsonb)
returns jsonb language sql set search_path = ''
as $$ select public.record_shift_usage(p_rows, 215) $$;
create or replace function public.undo_po_shift_usage(p_batch uuid)
returns integer language sql set search_path = ''
as $$ select public.undo_shift_usage(p_batch) $$;
create or replace function public.undo_pipa_shift_usage(p_batch uuid)
returns integer language sql set search_path = ''
as $$ select public.undo_shift_usage(p_batch) $$;
-- The old P-P-only deduction had no per-shift prices, so it can't update the POs.
create or replace function public.record_pipa_shift_usage(p_shift_ids uuid[], p_liters jsonb, p_liters_per_pipa numeric default 215)
returns uuid language plpgsql set search_path = ''
as $$
begin
  raise exception 'STM Financial was updated — refresh the page and try again.' using errcode = 'P0001';
end;
$$;
revoke all on function public.record_po_shift_usage(jsonb), public.undo_po_shift_usage(uuid), public.undo_pipa_shift_usage(uuid),
  public.record_pipa_shift_usage(uuid[], jsonb, numeric) from public, anon;
grant execute on function public.record_po_shift_usage(jsonb), public.undo_po_shift_usage(uuid), public.undo_pipa_shift_usage(uuid),
  public.record_pipa_shift_usage(uuid[], jsonb, numeric) to authenticated;

-- ── 5. A P-P purchase and its PO, in one step ────────────────────────────────
-- p_movement: { occurred_on, station_id, product, pipas, liters_per_pipa, price_mode, unit_price, note }
-- With p_add_po, a QUEUED PO in litres at the price per litre is created and
-- linked (accountants and managers can't write POs themselves). Returns the movement id.
create or replace function public.record_pipa_buy(p_movement jsonb, p_add_po boolean default true)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product text    := p_movement ->> 'product';
  v_pipas   numeric := (p_movement ->> 'pipas')::numeric;
  v_size    numeric := (p_movement ->> 'liters_per_pipa')::numeric;
  v_mode    text    := p_movement ->> 'price_mode';
  v_price   numeric := (p_movement ->> 'unit_price')::numeric;
  v_station uuid    := (p_movement ->> 'station_id')::uuid;
  v_on      date    := coalesce((p_movement ->> 'occurred_on')::date, (now() at time zone 'Asia/Yangon')::date);
  v_liters  numeric;
  v_per_l   numeric;
  v_total   numeric;
  v_po      uuid;
  v_name    text;
  v_id      uuid;
begin
  if public.current_app_role() is null or public.current_app_role() not in ('ceo', 'accountant', 'manager') then
    raise exception 'Only owners, accountants and managers can record a P-P purchase' using errcode = '42501';
  end if;
  if v_product not in ('92', '95', 'PD', 'D') or v_pipas is null or v_pipas <= 0 or v_size is null or v_size <= 0
     or v_mode not in ('per_pipa', 'per_liter') or v_price is null or v_price < 0 or v_station is null then
    raise exception 'A purchase needs a station, fuel, P-P count, P-P size and price';
  end if;
  select name into v_name from public.pipa_stations where id = v_station;
  if v_name is null then
    raise exception 'Unknown station' using errcode = '23503';
  end if;

  v_liters := v_pipas * v_size;
  v_per_l  := case when v_mode = 'per_liter' then v_price else v_price / v_size end;
  v_total  := case when v_mode = 'per_liter' then v_price * v_liters else v_price * v_pipas end;

  if p_add_po then
    insert into public.fuel_purchase_orders (name, product_type, status, initial_volume, remaining_volume,
                                             calibration_factor, wholesale_price, is_verified, total_volume_sold)
    values (format('P-P · %s · %s', v_name, v_on), v_product, 'QUEUED', v_liters, v_liters, 1, v_per_l, false, 0)
    returning id into v_po;
  end if;

  insert into public.pipa_movements (occurred_on, kind, station_id, product, pipas, liters_per_pipa,
                                     price_mode, unit_price, total_amount, note, po_id)
  values (v_on, 'buy', v_station, v_product, v_pipas, v_size, v_mode, v_price, round(v_total, 2),
          nullif(btrim(coalesce(p_movement ->> 'note', '')), ''), v_po)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.record_pipa_buy(jsonb, boolean) from public, anon;
grant execute on function public.record_pipa_buy(jsonb, boolean) to authenticated;
