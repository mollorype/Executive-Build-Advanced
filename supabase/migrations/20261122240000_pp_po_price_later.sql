-- P-P: the Big PO price is entered by the owner (later, if need be).
--
-- Managers record a Big PO with its date and quantity only. The owner enters
-- the price per litre (and fees) — when recording it, or later from the stock
-- detail / history. Until then the litres sold from it have no cost (Profit
-- warns); once the price is in, everything taken from that PO is costed again.
-- A Big PO is known by its date ("Nov 22 PO"); PO numbers aren't used.
--
-- pp_pools() also gives owners each purchase's price, and what was sold from
-- it (litres, money, cost) for the per-PO view.
--
-- Needs 20261122220000_pp_po_number. Safe to run more than once.

-- A Big PO may be saved without a price.
alter table public.pipa_movements drop constraint if exists pipa_movements_price_required;
alter table public.pipa_movements add constraint pipa_movements_price_required check (
  kind not in ('buy', 'borrow_paid', 'lend_paid', 'sell')
  or (kind = 'buy' and source = 'official')
  or (price_mode is not null and unit_price is not null));

create or replace function public.record_pp_movement(p jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_role    text := public.pp_require_role();
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
  v_priced  boolean;
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
  v_priced := v_kind in ('buy', 'borrow_paid', 'lend_paid', 'sell');
  if v_station_kind and v_station is null then raise exception 'Choose a station'; end if;
  if not v_station_kind then v_station := null; end if;
  if v_station is not null and not exists (select 1 from public.pipa_stations where id = v_station) then
    raise exception 'Unknown station' using errcode = '23503';
  end if;

  if v_kind = 'buy' then
    v_source := coalesce(v_source, 'shop');
    if v_source not in ('shop', 'official') then raise exception 'Unknown kind of purchase'; end if;
  else
    v_source := null; v_tfee := null; v_ofee := null; v_exact := null;
  end if;
  if v_source is distinct from 'official' then v_tfee := null; v_ofee := null; end if;
  -- Big PO: only owners enter the price, and it can come later.
  if v_source = 'official' then
    if v_role <> 'ceo' then v_price := null; v_mode := null; v_tfee := null; v_ofee := null; end if;
    v_priced := v_price is not null;
    if not v_priced then v_mode := null; end if;
  end if;
  if coalesce(v_tfee, 0) < 0 or coalesce(v_ofee, 0) < 0 then raise exception 'Fees must not be negative'; end if;

  if v_exact is not null then
    if v_exact <= 0 then raise exception 'Litres must be positive'; end if;
    v_pipas := round(v_exact / v_size, 3);
  end if;
  if v_pipas is null or (v_kind = 'adjust' and v_pipas = 0) or (v_kind <> 'adjust' and v_pipas <= 0) then
    raise exception 'Enter how many P-P';
  end if;

  if v_priced or (v_kind = 'adjust' and v_price is not null) then
    v_mode := coalesce(v_mode, 'per_liter');
    if v_source = 'official' then v_mode := 'per_liter'; end if;
    if v_mode not in ('per_pipa', 'per_liter') or v_price is null or v_price < 0 then raise exception 'Enter the price'; end if;
    if v_kind = 'adjust' and v_pipas < 0 then v_mode := null; v_price := null; end if;
  else
    v_mode := null; v_price := null;
  end if;

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

-- The owner enters (or corrects) a Big PO's price; everything already taken
-- from it is costed again, so profit is right from the first day.
create or replace function public.pp_set_po_price(p_movement uuid, p_price numeric, p_transport numeric, p_other numeric)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  m      public.pipa_movements;
  v_l    numeric;
  v_fees numeric;
  v_cost numeric;
  v_n    integer;
begin
  if public.current_app_role() is distinct from 'ceo' then
    raise exception 'Only an owner can enter the Big PO price' using errcode = '42501';
  end if;
  if p_price is null or p_price < 0 then raise exception 'Enter the price per litre' using errcode = '22023'; end if;
  if coalesce(p_transport, 0) < 0 or coalesce(p_other, 0) < 0 then raise exception 'Fees must not be negative' using errcode = '22023'; end if;
  select * into m from public.pipa_movements where id = p_movement for update;
  if not found or m.kind <> 'buy' or m.source is distinct from 'official' then
    raise exception 'This is not a Big PO' using errcode = 'P0002';
  end if;
  v_l := coalesce(m.exact_liters, m.pipas * m.liters_per_pipa);
  v_fees := coalesce(p_transport, 0) + coalesce(p_other, 0);
  v_cost := p_price + v_fees;

  update public.pipa_movements
     set price_mode = 'per_liter', unit_price = p_price, total_amount = round(p_price * v_l, 2),
         transport_fee = coalesce(p_transport, 0), other_fee = coalesce(p_other, 0)
   where id = m.id;
  update public.pp_lots set price_per_liter = p_price, fees_per_liter = v_fees, cost_per_liter = v_cost where movement_id = m.id;
  update public.pp_cost_lines c set cost = round(c.liters * v_cost, 2)
    from public.pp_lots l where c.lot_id = l.id and l.movement_id = m.id;
  get diagnostics v_n = row_count;
  return jsonb_build_object('cost_per_liter', v_cost, 'lines_costed', v_n);
end;
$$;
revoke all on function public.pp_set_po_price(uuid, numeric, numeric, numeric) from public, anon;
grant execute on function public.pp_set_po_price(uuid, numeric, numeric, numeric) to authenticated;

-- Pools for the stock detail. Owners also get, per purchase: its line (to
-- enter a Big PO price), price, fees, cost, and what was sold from it.
create or replace function public.pp_pools(p_days integer default 60)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_role  text := public.pp_require_role();
  v_owner boolean := v_role = 'ceo';
  v_days  integer := least(greatest(coalesce(p_days, 60), 1), 400);
begin
  return jsonb_build_object(
    'pp_liters', public.pp_pp_liters(),
    'short', coalesce((select jsonb_object_agg(product, l) from (
        select product, sum(liters) as l from public.pp_cost_lines
         where lot_id is null and kind in ('sale', 'lend', 'borrow_return', 'count_loss', 'used') group by product) s), '{}'::jsonb),
    'pools', coalesce((select jsonb_agg(x order by x.product, x.started_on desc, x.created_at desc) from (
        select p.id, p.product, p.started_on, p.created_at, p.closed_at, p.closed_by, p.close_reason, p.close_note,
               coalesce((select jsonb_agg(jsonb_build_object(
                          'source', l.source, 'on', l.occurred_on, 'liters', l.liters, 'remaining', l.remaining,
                          'written', coalesce((select sum(c.liters) from public.pp_cost_lines c where c.lot_id = l.id and c.kind = 'write_off'), 0),
                          'station', s.name,
                          'priced', l.cost_per_liter is not null,
                          'movement', case when v_owner then l.movement_id end,
                          'price', case when v_owner then l.price_per_liter end,
                          'fees', case when v_owner then l.fees_per_liter end,
                          'cost', case when v_owner then l.cost_per_liter end,
                          'sold', case when v_owner then coalesce(st.sold, 0) end,
                          'revenue', case when v_owner then coalesce(st.revenue, 0) end,
                          'cogs', case when v_owner then st.cogs end)
                        order by l.occurred_on, l.created_at, l.id)
                         from public.pp_lots l
                         left join public.pipa_stations s on s.id = l.station_id
                         left join lateral (
                           select sum(c.liters) as sold, sum(coalesce(c.amount, 0)) as revenue, sum(c.cost) as cogs
                             from public.pp_cost_lines c where c.lot_id = l.id and c.kind = 'sale') st on true
                        where l.pool_id = p.id), '[]'::jsonb) as lots
          from public.pp_pools p
         where (p.closed_at is null and exists (select 1 from public.pp_lots l where l.pool_id = p.id and l.remaining > 0.0005))
            or exists (select 1 from public.pp_lots l where l.pool_id = p.id and l.source = 'official' and l.cost_per_liter is null)
            or p.closed_at > now() - make_interval(days => v_days)
            or p.started_on > (now() at time zone 'Asia/Yangon')::date - v_days
         order by p.started_on desc limit 80) x), '[]'::jsonb));
end;
$$;
revoke all on function public.pp_pools(integer) from public, anon;
grant execute on function public.pp_pools(integer) to authenticated;
