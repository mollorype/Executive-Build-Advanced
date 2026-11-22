-- P-P: stock that comes in first covers litres sold when there was none.
--
-- A sale (or lending, a shortage…) bigger than the stock on record leaves
-- litres with no purchase behind them. The P-P Ledger goes below zero, but
-- the purchase records can't, so a later stock count or purchase used to add
-- its litres on top — the owner's stock bars then showed P-P that aren't
-- there. Now any stock that comes in (purchase, count extra, borrowed,
-- returned, or stock put back by an undo) first covers those litres, oldest
-- first, so the purchase records always match the ledger. Existing records
-- are put right at the end. Needs 20261122120000_pp_profit_engine.
--
-- Litres covered by "extra found in a count" (no price) stay without a
-- purchase price on the Profit page: nobody paid for them, so their cost is
-- unknown — the owner keeps seeing the warning instead of a made-up profit.
-- Safe to run more than once.

create or replace function public.pp_cover_unallocated(p_product text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_ids uuid[];
  v_t   timestamptz;
  r     record;
begin
  perform pg_advisory_xact_lock(hashtext('pp_cover:' || p_product));   -- one at a time per fuel
  select array_agg(id) into v_ids from public.pp_cost_lines
   where product = p_product and lot_id is null and liters > 0
     and kind in ('sale', 'lend', 'borrow_return', 'count_loss', 'used');   -- not the cash-only lines
  if v_ids is null then return; end if;
  for r in select * from public.pp_cost_lines where id = any(v_ids) order by occurred_on, created_at, id loop
    exit when not exists (select 1 from public.pp_lots where product = p_product and remaining > 0.0005);
    delete from public.pp_cost_lines where id = r.id;
    continue when not found;
    v_t := clock_timestamp();
    perform public.pp_take(r.product, r.liters, r.kind, r.amount, r.ref_cost, r.shift_id, r.batch_id,
                           r.movement_id, r.station_id, r.occurred_on, r.created_by);
    -- The new pieces keep the line's place in the queue; sales covered by
    -- found stock stay without a price.
    update public.pp_cost_lines c
       set created_at = r.created_at,
           cost = case when c.kind = 'sale' and exists (select 1 from public.pp_lots l where l.id = c.lot_id and l.source = 'count_gain')
                       then null else c.cost end
     where c.created_at >= v_t and c.product = r.product and c.kind = r.kind
       and c.movement_id is not distinct from r.movement_id and c.batch_id is not distinct from r.batch_id
       and c.shift_id is not distinct from r.shift_id;
  end loop;
end;
$$;

create or replace function public.pp_apply_movement(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  m      public.pipa_movements;
  v_l    numeric;
  v_per  numeric;
  v_fees numeric;
  v_rate numeric;
begin
  select * into m from public.pipa_movements where id = p_id;
  if not found or m.shift_batch_id is not null then return; end if;
  v_l := coalesce(m.exact_liters, abs(m.pipas) * m.liters_per_pipa);
  v_per := case when m.unit_price is null then null
                when m.price_mode = 'per_liter' then m.unit_price
                else m.unit_price / m.liters_per_pipa end;

  if m.kind = 'buy' then
    v_fees := coalesce(m.transport_fee, 0) + coalesce(m.other_fee, 0);
    insert into public.pp_lots (product, source, movement_id, station_id, occurred_on, liters, remaining, price_per_liter, fees_per_liter, cost_per_liter)
    values (m.product, coalesce(m.source, 'shop'), m.id, m.station_id, m.occurred_on, v_l, v_l, v_per, v_fees, v_per + v_fees);
  elsif m.kind = 'borrow' then
    insert into public.pp_lots (product, source, movement_id, station_id, occurred_on, liters, remaining, cost_per_liter)
    values (m.product, 'borrow', m.id, m.station_id, m.occurred_on, v_l, v_l, public.pp_latest_cost(m.product));
  elsif m.kind = 'lend_returned' then
    insert into public.pp_lots (product, source, movement_id, station_id, occurred_on, liters, remaining, cost_per_liter)
    values (m.product, 'lend_return', m.id, m.station_id, m.occurred_on, v_l, v_l,
            coalesce(public.pp_holding_rate(m.station_id, m.product, 'lent'), public.pp_latest_cost(m.product)));
  elsif m.kind = 'adjust' and m.pipas > 0 then
    -- Found stock costs nothing (it makes up for an earlier shortage); opening stock carries its price.
    insert into public.pp_lots (product, source, movement_id, station_id, occurred_on, liters, remaining, price_per_liter, cost_per_liter)
    values (m.product, case when v_per is null then 'count_gain' else 'opening' end, m.id, null, m.occurred_on, v_l, v_l, v_per, coalesce(v_per, 0));
  elsif m.kind = 'adjust' then
    perform public.pp_take(m.product, v_l, 'count_loss', null, null, null, null, m.id, null, m.occurred_on, m.created_by);
  elsif m.kind = 'used' then
    perform public.pp_take(m.product, v_l, 'used', null, null, null, null, m.id, null, m.occurred_on, m.created_by);
  elsif m.kind = 'lend' then
    perform public.pp_take(m.product, v_l, 'lend', null, null, null, null, m.id, m.station_id, m.occurred_on, m.created_by);
  elsif m.kind = 'borrow_returned' then
    v_rate := public.pp_holding_rate(m.station_id, m.product, 'borrowed');
    perform public.pp_take(m.product, v_l, 'borrow_return', null, round(v_l * v_rate, 2), null, null, m.id, m.station_id, m.occurred_on, m.created_by);
  elsif m.kind in ('borrow_paid', 'lend_paid') then
    v_rate := public.pp_holding_rate(m.station_id, m.product, case when m.kind = 'borrow_paid' then 'borrowed' else 'lent' end);
    insert into public.pp_cost_lines (kind, product, lot_id, liters, cost, amount, ref_cost, movement_id, station_id, occurred_on, created_by)
    values (m.kind, m.product, null, v_l, null, m.total_amount, round(v_l * v_rate, 2), m.id, m.station_id, m.occurred_on, m.created_by);
  end if;
  -- New stock first covers litres that were sold / taken when there was none.
  if m.kind in ('buy', 'borrow', 'lend_returned') or (m.kind = 'adjust' and m.pipas > 0) then
    perform public.pp_cover_unallocated(m.product);
  end if;
end;
$$;


create or replace function public.pp_unapply_movement(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_lot     uuid;
  v_product text := (select product from public.pipa_movements where id = p_id);
begin
  perform public.pp_restore_lines(p_id, null);
  for v_lot in select id from public.pp_lots where movement_id = p_id loop
    perform public.pp_drop_lot(v_lot);
  end loop;
  -- Stock given back can now cover litres sold when there was none.
  if v_product is not null then perform public.pp_cover_unallocated(v_product); end if;
end;
$$;


create or replace function public.pp_undo_shift(p_shift uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  v_batch    uuid;
  v_products text[];
  v_p        text;
begin
  select batch_id into v_batch from public.pipa_shift_deductions where shift_id = p_shift;
  if v_batch is null then return false; end if;
  select array_agg(distinct product) into v_products from public.pp_cost_lines where batch_id = v_batch;
  perform public.pp_restore_lines(null, v_batch);
  delete from public.pipa_movements where shift_batch_id = v_batch;
  delete from public.pipa_shift_deductions where shift_id = p_shift;
  foreach v_p in array coalesce(v_products, '{}') loop
    perform public.pp_cover_unallocated(v_p);
  end loop;
  return true;
end;
$$;


revoke all on function public.pp_cover_unallocated(text), public.pp_apply_movement(uuid), public.pp_unapply_movement(uuid),
  public.pp_undo_shift(uuid) from public, anon, authenticated;

-- Put existing records right.
select public.pp_cover_unallocated(p) from (select distinct product as p from public.pp_cost_lines where lot_id is null) s;
