-- P-P: Big PO numbers, and the stock detail (tap a stock card).
--
-- Official purchases (Big POs) get a PO number, typed in the Official PO form
-- (the next number is suggested). Existing ones are numbered by date: every
-- Big PO line on the same day shares a number.
--
-- pp_pools() now says where each purchase came from (PO number or station)
-- and, for owners only, what it cost per litre — managers and accountants
-- see P-P counts only.
--
-- Needs 20261122200000_pp_pools. Safe to run more than once.

alter table public.pipa_movements add column if not exists po_number text check (char_length(po_number) <= 40);

-- Number the existing Big POs once: one number per day, oldest first.
do $$
begin
  if not exists (select 1 from public.pipa_movements where po_number is not null) then
    with o as (
      select id, dense_rank() over (order by occurred_on) as n
      from public.pipa_movements where kind = 'buy' and source = 'official'
    )
    update public.pipa_movements m set po_number = o.n::text from o where m.id = o.id;
  end if;
end $$;

-- Record one P-P line — an official purchase can carry its PO number.
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
  v_po      text := nullif(btrim(left(coalesce(p ->> 'po_number', ''), 40)), '');
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
  if v_source is distinct from 'official' then v_tfee := null; v_ofee := null; v_po := null; end if;
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
                                     price_mode, unit_price, total_amount, note, source, transport_fee, other_fee, po_number, created_by)
  values (v_on, v_kind, v_station, v_product, v_pipas, v_size, v_exact, v_mode, v_price, v_total,
          nullif(btrim(coalesce(p ->> 'note', '')), ''), v_source, v_tfee, v_ofee, v_po, lower(auth.jwt() ->> 'email'))
  returning id into v_id;
  perform public.pp_apply_movement(v_id);
  return v_id;
end;
$$;
revoke all on function public.record_pp_movement(jsonb) from public, anon;
grant execute on function public.record_pp_movement(jsonb) to authenticated;

-- P-P lines for the ledger page — with the PO number.
drop function if exists public.pp_movements();
create function public.pp_movements()
returns table (
  id uuid, created_at timestamptz, occurred_on date, kind text, station_id uuid, product text, pipas numeric,
  liters_per_pipa numeric, exact_liters numeric, price_mode text, unit_price numeric, total_amount numeric,
  transport_fee numeric, other_fee numeric, source text, note text, shift_batch_id uuid, shift_id uuid, created_by text,
  write_off_reason text, po_number text
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_role text := public.pp_require_role();
  v_show boolean := v_role = 'ceo' or coalesce((select managers_see_prices from public.pp_settings where pp_settings.id), true);
begin
  return query
  select m.id, m.created_at, m.occurred_on, m.kind, m.station_id, m.product, m.pipas::numeric,
         m.liters_per_pipa::numeric, m.exact_liters,
         case when v_show then m.price_mode end, case when v_show then m.unit_price::numeric end,
         case when v_show then m.total_amount::numeric end, case when v_show then m.transport_fee::numeric end,
         case when v_show then m.other_fee::numeric end, m.source, m.note, m.shift_batch_id, d.shift_id, m.created_by,
         m.write_off_reason, m.po_number
  from public.pipa_movements m
  left join public.pipa_shift_deductions d on d.batch_id = m.shift_batch_id
  order by m.occurred_on desc, m.created_at desc;
end;
$$;
revoke all on function public.pp_movements() from public, anon;
grant execute on function public.pp_movements() to authenticated;

-- The pools for the stock detail: each purchase with where it came from;
-- what it cost per litre only for owners.
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
                          'station', s.name, 'po', m.po_number,
                          'cost', case when v_owner then l.cost_per_liter end)
                        order by l.occurred_on, l.created_at, l.id)
                         from public.pp_lots l
                         left join public.pipa_movements m on m.id = l.movement_id
                         left join public.pipa_stations s on s.id = l.station_id
                        where l.pool_id = p.id), '[]'::jsonb) as lots
          from public.pp_pools p
         where (p.closed_at is null and exists (select 1 from public.pp_lots l where l.pool_id = p.id and l.remaining > 0.0005))
            or p.closed_at > now() - make_interval(days => v_days)
            or p.started_on > (now() at time zone 'Asia/Yangon')::date - v_days
         order by p.started_on desc limit 80) x), '[]'::jsonb));
end;
$$;
revoke all on function public.pp_pools(integer) from public, anon;
grant execute on function public.pp_pools(integer) to authenticated;
