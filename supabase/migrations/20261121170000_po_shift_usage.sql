-- PO Registry: deduct daily shift sales from purchase orders, with history.
--
-- Replaces the old "Run FIFO Engine", which recomputed every PO from every
-- shift ever recorded (so a new PO lost all past sales) and kept no history.
-- Now, as in the P-P Ledger, the owner picks which shifts to deduct; each
-- shift's litres come off the POs of that fuel oldest-first (the ACTIVE one
-- first), and every piece is recorded with the day and the selling price of
-- that shift. Profit is worked out from these records — not a fixed retail
-- price.
--
--   po_usage             one line per (shift, fuel, PO): litres, money, price/L
--   po_shift_deductions  which shifts have been deducted (each only once)
--
-- Both are read-only to the browser; they change only through the two
-- functions below, which check that the caller is an owner. Safe to run more
-- than once.

create table if not exists public.po_shift_deductions (
  shift_id   uuid primary key references public.daily_sales_reports(id) on delete cascade,
  batch_id   uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists po_shift_deductions_batch on public.po_shift_deductions (batch_id);

create table if not exists public.po_usage (
  id              uuid primary key default gen_random_uuid(),
  batch_id        uuid not null,
  po_id           uuid not null references public.fuel_purchase_orders(id) on delete cascade,
  shift_id        uuid references public.daily_sales_reports(id) on delete set null,
  shift_at        timestamptz not null,
  product         text not null check (product in ('92', '95', 'PD', 'D')),
  liters          numeric not null check (liters > 0),
  stock_used      numeric not null check (stock_used >= 0),   -- litres × calibration factor taken off the PO
  amount          numeric not null check (amount >= 0),       -- money those litres sold for, at that shift's prices
  price_per_liter numeric generated always as (round(amount / liters, 2)) stored,
  status_before   text not null check (status_before in ('ACTIVE', 'QUEUED', 'DONE')),
  created_at      timestamptz not null default clock_timestamp(),
  created_by      text
);
create index if not exists po_usage_po on public.po_usage (po_id);
create index if not exists po_usage_batch on public.po_usage (batch_id);

alter table public.po_usage enable row level security;
alter table public.po_shift_deductions enable row level security;
revoke all on public.po_usage, public.po_shift_deductions from anon, authenticated;
grant select on public.po_usage, public.po_shift_deductions to authenticated;
drop policy if exists "ceo_read" on public.po_usage;
create policy "ceo_read" on public.po_usage for select to authenticated
  using (public.current_app_role() = 'ceo');
drop policy if exists "ceo_read" on public.po_shift_deductions;
create policy "ceo_read" on public.po_shift_deductions for select to authenticated
  using (public.current_app_role() = 'ceo');

-- p_rows: [{ "shift_id": uuid, "product": "92"|"95"|"PD"|"D", "liters": n, "amount": n }, ...]
-- (litres and money per fuel, worked out by STM Financial from each shift's
-- figures, exactly as shown in the dialog). Shifts are taken oldest first.
-- Returns { batch, unallocated: { product: litres } } — litres with no PO left.
create or replace function public.record_po_shift_usage(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch   uuid := gen_random_uuid();
  v_who     text := lower(auth.jwt() ->> 'email');
  v_left    jsonb := '{}'::jsonb;
  r         record;
  po        record;
  v_rest    numeric;
  v_cal     numeric;
  v_take    numeric;
  v_used    numeric;
  v_remain  numeric;
begin
  if public.current_app_role() is distinct from 'ceo' then
    raise exception 'Only an owner can deduct shift sales' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'No shifts selected';
  end if;

  -- Each shift once (a second attempt fails with 23505). Unknown shift → FK error.
  insert into public.po_shift_deductions (shift_id, batch_id)
  select distinct (e ->> 'shift_id')::uuid, v_batch from jsonb_array_elements(p_rows) e;

  for r in
    select (e ->> 'shift_id')::uuid as shift_id, s."timestamp" as shift_at, e ->> 'product' as product,
           coalesce((e ->> 'liters')::numeric, 0) as liters, coalesce((e ->> 'amount')::numeric, 0) as amount
    from jsonb_array_elements(p_rows) e
    join public.daily_sales_reports s on s.id = (e ->> 'shift_id')::uuid
    order by s."timestamp", e ->> 'product'
  loop
    if r.product not in ('92', '95', 'PD', 'D') then
      raise exception 'Unknown fuel %', r.product;
    end if;
    if r.liters < 0 or r.amount < 0 then
      raise exception 'Litres and money must not be negative';
    end if;
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
      v_take   := least(v_rest, po.remaining_volume / v_cal);   -- litres sold from this PO
      v_used   := v_take * v_cal;                                -- stock it takes off the PO
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

-- Undo one deduction: litres go back on the POs it used, the POs get back the
-- status they had, and its shifts can be deducted again. Only the newest
-- deduction for those fuels can be undone, and not after a PO it used was
-- force-closed, so every PO ends up exactly as it was before.
create or replace function public.undo_po_shift_usage(p_batch uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shifts integer;
  v_last   timestamptz;
begin
  if public.current_app_role() is distinct from 'ceo' then
    raise exception 'Only an owner can undo a shift deduction' using errcode = '42501';
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

  delete from public.po_shift_deductions where batch_id = p_batch;
  get diagnostics v_shifts = row_count;
  return v_shifts;
end;
$$;

revoke all on function public.record_po_shift_usage(jsonb), public.undo_po_shift_usage(uuid) from public, anon;
grant execute on function public.record_po_shift_usage(jsonb), public.undo_po_shift_usage(uuid) to authenticated;
