-- P-P: prices are never required, and only the owner enters them.
--
-- The P-P Ledger is the manager's page: lines are recorded with their date
-- and quantity only. The owner (who can use the page too) may type a price
-- when recording, or add / change it later — a purchase, Big PO, stock-count
-- extra, sale to a station, or a cash settlement. Everything already taken
-- from a purchase is costed again with its new price.
--
-- Stock found in a count (no price) is like a purchase waiting for its price.
--
-- Profit: litres sold with no purchase price, and sales to a station with no
-- price yet, are left out of sales, cost and profit, and counted in a warning
-- until the owner adds the price — so the profit is never made up.
--
-- Needs 20261122240000_pp_po_price_later. Safe to run more than once.

alter table public.pipa_movements drop constraint if exists pipa_movements_price_required;
alter table public.pipa_movements add constraint pipa_movements_price_required check ((price_mode is null) = (unit_price is null));

create or replace function public.record_pp_movement(p jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_role    text := public.pp_require_role();
  v_owner   boolean := v_role = 'ceo';
  v_kind    text := p ->> 'kind';
  v_product text := p ->> 'product';
  v_station uuid := nullif(p ->> 'station_id', '')::uuid;
  v_size    numeric := coalesce(nullif(p ->> 'liters_per_pipa', '')::numeric, public.pp_pp_liters());
  v_exact   numeric := nullif(p ->> 'liters', '')::numeric;
  v_pipas   numeric := nullif(p ->> 'pipas', '')::numeric;
  v_mode    text := nullif(p ->> 'price_mode', '');
  v_price   numeric := nullif(p ->> 'unit_price', '')::numeric;
  v_source  text := nullif(p ->> 'source', '');
  v_tfee    numeric := nullif(p ->> 'transport_fee', '')::numeric;
  v_ofee    numeric := nullif(p ->> 'other_fee', '')::numeric;
  v_on      date := coalesce(nullif(p ->> 'occurred_on', '')::date, (now() at time zone 'Asia/Yangon')::date);
  v_station_kind boolean;
  v_owed    numeric;
  v_total   numeric;
  v_id      uuid;
begin
  if v_kind is null or v_kind not in ('buy', 'borrow', 'borrow_returned', 'borrow_paid', 'lend', 'lend_returned', 'lend_paid', 'used', 'adjust', 'sell') then
    raise exception 'Unknown kind of P-P line';
  end if;
  if v_product is null or v_product not in ('92', '95', 'PD', 'D') then raise exception 'Choose a fuel'; end if;
  if v_size is null or v_size <= 0 then raise exception 'P-P size must be positive'; end if;
  v_station_kind := v_kind not in ('used', 'adjust');
  if v_station_kind and v_station is null then raise exception 'Choose a station'; end if;
  if not v_station_kind then v_station := null; end if;
  if v_station is not null and not exists (select 1 from public.pipa_stations where id = v_station) then
    raise exception 'Unknown station' using errcode = '23503';
  end if;

  if v_kind = 'buy' then
    v_source := coalesce(v_source, 'shop');
    if v_source not in ('shop', 'official') then raise exception 'Unknown kind of purchase'; end if;
  else
    v_source := null; v_exact := null;
  end if;

  if v_exact is not null then
    if v_exact <= 0 then raise exception 'Litres must be positive'; end if;
    v_pipas := round(v_exact / v_size, 3);
  end if;
  if v_pipas is null or (v_kind = 'adjust' and v_pipas = 0) or (v_kind <> 'adjust' and v_pipas <= 0) then
    raise exception 'Enter how many P-P';
  end if;

  -- Prices: only the owner, and never required.
  if not v_owner or v_price is null or v_kind not in ('buy', 'sell', 'borrow_paid', 'lend_paid', 'adjust')
     or (v_kind = 'adjust' and v_pipas < 0) then
    v_mode := null; v_price := null; v_tfee := null; v_ofee := null;
  else
    v_mode := case when v_source = 'official' or v_kind = 'adjust' then 'per_liter' else coalesce(v_mode, 'per_liter') end;
    if v_mode not in ('per_pipa', 'per_liter') or v_price < 0 then raise exception 'Enter the price'; end if;
  end if;
  if v_source is distinct from 'official' then v_tfee := null; v_ofee := null; end if;
  if coalesce(v_tfee, 0) < 0 or coalesce(v_ofee, 0) < 0 then raise exception 'Fees must not be negative'; end if;

  if v_kind in ('borrow_returned', 'borrow_paid', 'lend_returned', 'lend_paid') then
    select coalesce(sum(case
             when v_kind in ('borrow_returned', 'borrow_paid') then
               case m.kind when 'borrow' then m.pipas when 'borrow_returned' then -m.pipas when 'borrow_paid' then -m.pipas else 0 end
             else
               case m.kind when 'lend' then m.pipas when 'lend_returned' then -m.pipas when 'lend_paid' then -m.pipas else 0 end
           end), 0)
      into v_owed
      from public.pipa_movements m where m.station_id = v_station and m.product = v_product;
    if v_pipas > v_owed + 0.0005 then
      raise exception 'Only % P-P is owed for this fuel and station', trim_scale(round(greatest(v_owed, 0), 3)) using errcode = 'P0001';
    end if;
  end if;

  v_total := case when v_price is null then null
                  when v_mode = 'per_liter' then round(v_price * coalesce(v_exact, abs(v_pipas) * v_size), 2)
                  else round(v_price * abs(v_pipas), 2) end;

  insert into public.pipa_movements (occurred_on, kind, station_id, product, pipas, liters_per_pipa, exact_liters,
                                     price_mode, unit_price, total_amount, note, source, transport_fee, other_fee, created_by)
  values (v_on, v_kind, v_station, v_product, v_pipas, v_size, v_exact, v_mode, v_price, v_total,
          nullif(btrim(coalesce(p ->> 'note', '')), ''), v_source, v_tfee, v_ofee, lower(auth.jwt() ->> 'email'))
  returning id into v_id;
  perform public.pp_apply_movement(v_id);
  return v_id;
end;
$$;
revoke all on function public.record_pp_movement(jsonb) from public, anon;
grant execute on function public.record_pp_movement(jsonb) to authenticated;

-- Stock found in a count has no price until the owner adds one (it used to
-- cost nothing, which made its sales look like pure profit).
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
    insert into public.pp_lots (product, source, movement_id, station_id, occurred_on, liters, remaining, price_per_liter, cost_per_liter)
    values (m.product, case when v_per is null then 'count_gain' else 'opening' end, m.id, null, m.occurred_on, v_l, v_l, v_per, v_per);   -- found stock: no price until the owner adds one
  elsif m.kind = 'adjust' then
    perform public.pp_take(m.product, v_l, 'count_loss', null, null, null, null, m.id, null, m.occurred_on, m.created_by);
  elsif m.kind = 'used' then
    perform public.pp_take(m.product, v_l, 'used', null, null, null, null, m.id, null, m.occurred_on, m.created_by);
  elsif m.kind = 'sell' then
    perform public.pp_take(m.product, v_l, 'sale', m.total_amount, null, null, null, m.id, m.station_id, m.occurred_on, m.created_by, 'station');
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
  -- ('write_off' lines are only made by pp_close_pool.)
  if m.kind in ('buy', 'borrow', 'lend_returned') or (m.kind = 'adjust' and m.pipas > 0) then
    perform public.pp_cover_unallocated(m.product);
  end if;
end;
$$;
update public.pp_cost_lines c set cost = null
  from public.pp_lots l where c.lot_id = l.id and l.source = 'count_gain' and l.price_per_liter is null and c.cost = 0;
update public.pp_lots set cost_per_liter = null where source = 'count_gain' and price_per_liter is null;
revoke all on function public.pp_apply_movement(uuid) from public, anon, authenticated;

-- The owner adds or changes the price of a line. Purchases (and stock-count
-- extras): everything taken from them is costed again. Sales to a station and
-- cash settlements: their money is updated.
drop function if exists public.pp_set_po_price(uuid, numeric, numeric, numeric);
create or replace function public.pp_set_price(p_movement uuid, p_mode text, p_price numeric, p_transport numeric, p_other numeric)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  m       public.pipa_movements;
  v_mode  text;
  v_l     numeric;
  v_per   numeric;
  v_fees  numeric := 0;
  v_total numeric;
begin
  if public.current_app_role() is distinct from 'ceo' then
    raise exception 'Only an owner can enter prices' using errcode = '42501';
  end if;
  if p_price is null or p_price < 0 then raise exception 'Enter the price' using errcode = '22023'; end if;
  if coalesce(p_transport, 0) < 0 or coalesce(p_other, 0) < 0 then raise exception 'Fees must not be negative' using errcode = '22023'; end if;
  select * into m from public.pipa_movements where id = p_movement for update;
  if not found or m.shift_batch_id is not null
     or not (m.kind in ('buy', 'sell', 'borrow_paid', 'lend_paid') or (m.kind = 'adjust' and m.pipas > 0)) then
    raise exception 'This line has no price' using errcode = 'P0002';
  end if;
  v_mode := case when m.source = 'official' or m.kind = 'adjust' then 'per_liter' else coalesce(nullif(p_mode, ''), 'per_liter') end;
  if v_mode not in ('per_pipa', 'per_liter') then raise exception 'Unknown price mode' using errcode = '22023'; end if;
  v_l := coalesce(m.exact_liters, abs(m.pipas) * m.liters_per_pipa);
  v_per := case when v_mode = 'per_liter' then p_price else p_price / m.liters_per_pipa end;
  v_total := case when v_mode = 'per_liter' then round(p_price * v_l, 2) else round(p_price * abs(m.pipas), 2) end;
  if m.source = 'official' then v_fees := coalesce(p_transport, 0) + coalesce(p_other, 0); end if;

  update public.pipa_movements
     set price_mode = v_mode, unit_price = p_price, total_amount = v_total,
         transport_fee = case when m.source = 'official' then coalesce(p_transport, 0) end,
         other_fee = case when m.source = 'official' then coalesce(p_other, 0) end
   where id = m.id;

  if m.kind in ('buy', 'adjust') then
    update public.pp_lots
       set price_per_liter = v_per, fees_per_liter = v_fees, cost_per_liter = v_per + v_fees,
           source = case when source = 'count_gain' then 'opening' else source end
     where movement_id = m.id;
    update public.pp_cost_lines c set cost = round(c.liters * (v_per + v_fees), 2)
      from public.pp_lots l where c.lot_id = l.id and l.movement_id = m.id;
  elsif m.kind = 'sell' then
    update public.pp_cost_lines c set amount = round(v_total * c.liters / nullif(v_l, 0), 2)
     where c.movement_id = m.id and c.kind = 'sale';
  else   -- borrow_paid / lend_paid
    update public.pp_cost_lines c set amount = v_total where c.movement_id = m.id and c.kind = m.kind;
  end if;
  return jsonb_build_object('per_liter', v_per, 'total', v_total);
end;
$$;
revoke all on function public.pp_set_price(uuid, text, numeric, numeric, numeric) from public, anon;
grant execute on function public.pp_set_price(uuid, text, numeric, numeric, numeric) to authenticated;

-- Profit: what has no price yet stays out of the profit (and is counted) until it does.
create or replace function public.pp_profit_calc(p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = ''
as $$
  with x as (
    select occurred_on as day, product, kind, channel, liters, amount, cost,
      -- Only sales with both prices count towards profit; the rest wait for the owner's price.
      case when kind = 'sale' and amount is not null and cost is not null then amount
           when kind = 'lend_paid' and amount is not null then amount else 0 end as revenue,
      case when kind = 'sale' and amount is not null and cost is not null then cost
           when kind = 'lend_paid' and amount is not null then coalesce(ref_cost, 0) else 0 end as cogs,
      0::numeric as settle,
      case when kind in ('count_loss', 'write_off') then coalesce(cost, 0) else 0 end as loss,
      case when kind = 'used' then coalesce(cost, 0) else 0 end as used,
      case when kind = 'sale' then liters else 0 end as sold,
      case when kind = 'sale' and cost is null then liters else 0 end as unpriced,
      case when kind = 'sale' and amount is null then liters else 0 end as no_sale_price,
      case when kind = 'sale' and amount is not null and cost is null then amount else 0 end as unpriced_money
    from public.pp_cost_lines where occurred_on between p_from and p_to
  ),
  tot as (
    select coalesce(sum(sold), 0) as liters, coalesce(sum(revenue), 0) as revenue, coalesce(sum(cogs), 0) as cost,
           coalesce(sum(settle), 0) as settle, coalesce(sum(loss), 0) as loss, coalesce(sum(used), 0) as used,
           coalesce(sum(unpriced), 0) as unpriced, coalesce(sum(unpriced_money), 0) as unpriced_money,
           coalesce(sum(no_sale_price), 0) as no_sale_price,
           coalesce(sum(revenue - cogs - settle - loss - used), 0) as profit
    from x
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'totals', (select to_jsonb(tot) from tot),
    'products', coalesce((select jsonb_agg(to_jsonb(p) order by p.product) from (
        select product, sum(sold) as liters, sum(revenue) as revenue, sum(cogs) as cost,
               sum(revenue - cogs - settle - loss - used) as profit, sum(loss) as loss, sum(unpriced) as unpriced
        from x group by product) p), '[]'::jsonb),
    'channels', coalesce((select jsonb_agg(to_jsonb(c) order by c.product, c.channel) from (
        select product, coalesce(channel, 'mixed') as channel, sum(liters) as liters, sum(revenue) as revenue,
               sum(cogs) as cost, sum(revenue - cogs) as profit, sum(unpriced) as unpriced
        from x where kind = 'sale' group by product, coalesce(channel, 'mixed')) c), '[]'::jsonb),
    'days', coalesce((select jsonb_agg(to_jsonb(d) order by d.day) from (
        select day, sum(sold) as liters, sum(revenue) as revenue, sum(cogs) as cost,
               sum(revenue - cogs - settle - loss - used) as profit
        from x group by day) d), '[]'::jsonb)
  )
$$;
revoke all on function public.pp_profit_calc(date, date) from public, anon, authenticated;
grant execute on function public.pp_profit_calc(date, date) to service_role;
