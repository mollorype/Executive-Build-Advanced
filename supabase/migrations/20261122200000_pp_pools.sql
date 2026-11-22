-- P-P pools, closing a pool, selling P-P to a station, and each shift sale
-- kept per channel.
--
-- Pools (one per fuel). A Big PO (official purchase) starts a pool; a shop
-- purchase or other stock starts one only when no pool is open. Stock that
-- comes in later (shop purchases, borrowed P-P, count extras…) joins the
-- open pool. Sales still take the oldest fuel first. A pool can go short;
-- those litres wait and take the next purchase's cost.
--
-- Closing a pool: when the app shows fuel that isn't really there, an owner
-- or manager closes the pool. What's left becomes a loss (shortage / spill /
-- other, with a note) on that day's profit. Deleting the "pool closed" line
-- opens the pool again. Owners are told on Telegram when a manager closes one.
--
-- Selling P-P to another station is a new kind of line ("sell"), with a
-- price; its money counts as sales.
--
-- Every shift sale keeps its own litres and money per channel: pumps
-- (with diesel sold by cash), P-P sold and J-C. P-P sold use the litres the
-- staff entered (215 by default).
--
-- Borrowed P-P are costed at the latest Big PO's cost per litre, kept flat:
-- giving them back or paying for them doesn't add a profit or a loss.
--
-- Needs 20261122180000_pp_reset. Safe to run more than once.

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. Tables
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.pp_pools (
  id                uuid primary key default gen_random_uuid(),
  product           text not null check (product in ('92', '95', 'PD', 'D')),
  started_on        date not null,
  created_at        timestamptz not null default clock_timestamp(),
  closed_at         timestamptz,
  closed_by         text,
  close_reason      text check (close_reason in ('shortage', 'spill', 'other')),
  close_note        text,
  close_movement_id uuid references public.pipa_movements(id) on delete set null,
  notified_at       timestamptz
);
create index if not exists pp_pools_product on public.pp_pools (product, started_on desc);
alter table public.pp_pools enable row level security;
revoke all on public.pp_pools from anon, authenticated;   -- read through pp_pools() only

alter table public.pp_lots add column if not exists pool_id uuid references public.pp_pools(id) on delete set null;
create index if not exists pp_lots_pool on public.pp_lots (pool_id);

alter table public.pipa_movements add column if not exists pool_id uuid references public.pp_pools(id) on delete set null;
alter table public.pipa_movements add column if not exists write_off_reason text check (write_off_reason in ('shortage', 'spill', 'other'));
alter table public.pipa_movements drop constraint if exists pipa_movements_kind_check;
alter table public.pipa_movements add constraint pipa_movements_kind_check check (kind in
  ('buy', 'borrow', 'borrow_returned', 'borrow_paid', 'lend', 'lend_returned', 'lend_paid', 'used', 'adjust', 'sell', 'write_off'));
alter table public.pipa_movements drop constraint if exists pipa_movements_station_required;
alter table public.pipa_movements add constraint pipa_movements_station_required check ((kind in ('used', 'adjust', 'write_off')) = (station_id is null));
alter table public.pipa_movements drop constraint if exists pipa_movements_price_required;
alter table public.pipa_movements add constraint pipa_movements_price_required check (
  kind not in ('buy', 'borrow_paid', 'lend_paid', 'sell') or (price_mode is not null and unit_price is not null));

alter table public.pp_cost_lines drop constraint if exists pp_cost_lines_kind_check;
alter table public.pp_cost_lines add constraint pp_cost_lines_kind_check check (kind in
  ('sale', 'lend', 'borrow_return', 'lend_paid', 'borrow_paid', 'count_loss', 'used', 'write_off'));
alter table public.pp_cost_lines add column if not exists channel text check (channel in ('pump', 'pipa', 'jc', 'station'));

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. Which pool a purchase belongs to
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.pp_pool_for(p_product text, p_source text, p_on date)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v uuid;
begin
  if p_source <> 'official' then
    select p.id into v from public.pp_pools p
     where p.product = p_product and p.closed_at is null and p.started_on <= p_on
     order by p.started_on desc, p.created_at desc limit 1;
  end if;
  if v is null then
    insert into public.pp_pools (product, started_on) values (p_product, p_on) returning id into v;
  end if;
  return v;
end;
$$;

create or replace function public.pp_lot_pool()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.pool_id is null then new.pool_id := public.pp_pool_for(new.product, new.source, new.occurred_on); end if;
  return new;
end;
$$;
drop trigger if exists pp_lot_pool on public.pp_lots;
create trigger pp_lot_pool before insert on public.pp_lots for each row execute function public.pp_lot_pool();

-- A pool with no purchases left (all deleted) goes too.
create or replace function public.pp_lot_gone()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.pp_pools p where p.id = old.pool_id and not exists (select 1 from public.pp_lots l where l.pool_id = p.id);
  return old;
end;
$$;
drop trigger if exists pp_lot_gone on public.pp_lots;
create trigger pp_lot_gone after delete on public.pp_lots for each row execute function public.pp_lot_gone();

-- Existing purchases, oldest first.
do $$
declare l record;
begin
  for l in select id, product, source, occurred_on from public.pp_lots where pool_id is null order by product, occurred_on, created_at, id loop
    update public.pp_lots set pool_id = public.pp_pool_for(l.product, l.source, l.occurred_on) where id = l.id;
  end loop;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. Taking litres out — now with the sale channel
-- ═════════════════════════════════════════════════════════════════════════════
drop function if exists public.pp_take(text, numeric, text, numeric, numeric, uuid, uuid, uuid, uuid, date, text);
create or replace function public.pp_take(
  p_product text, p_liters numeric, p_kind text, p_amount numeric, p_ref_cost numeric,
  p_shift uuid, p_batch uuid, p_movement uuid, p_station uuid, p_on date, p_who text, p_channel text default null
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_rest numeric := p_liters;
  v_take numeric;
  lot    record;
begin
  if p_liters is null or p_liters <= 0 then return; end if;
  while v_rest > 0.0005 loop
    select * into lot from public.pp_lots
     where product = p_product and remaining > 0.0005
     order by occurred_on, created_at, id limit 1 for update;
    if not found then
      insert into public.pp_cost_lines (kind, product, lot_id, liters, cost, amount, ref_cost, shift_id, batch_id, movement_id, station_id, occurred_on, created_by, channel)
      values (p_kind, p_product, null, v_rest, null, round(p_amount * v_rest / p_liters, 2), round(p_ref_cost * v_rest / p_liters, 2),
              p_shift, p_batch, p_movement, p_station, p_on, p_who, p_channel);
      return;
    end if;
    v_take := least(v_rest, lot.remaining);
    update public.pp_lots set remaining = case when remaining - v_take < 0.0005 then 0 else remaining - v_take end where id = lot.id;
    insert into public.pp_cost_lines (kind, product, lot_id, liters, cost, amount, ref_cost, shift_id, batch_id, movement_id, station_id, occurred_on, created_by, channel)
    values (p_kind, p_product, lot.id, v_take, round(v_take * lot.cost_per_liter, 2), round(p_amount * v_take / p_liters, 2),
            round(p_ref_cost * v_take / p_liters, 2), p_shift, p_batch, p_movement, p_station, p_on, p_who, p_channel);
    v_rest := v_rest - v_take;
  end loop;
end;
$$;

-- Remove a purchase; what was taken from it is taken again from the others.
create or replace function public.pp_drop_lot(p_lot uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare r record;
begin
  update public.pp_lots set remaining = 0 where id = p_lot;
  for r in select * from public.pp_cost_lines where lot_id = p_lot order by occurred_on, created_at loop
    delete from public.pp_cost_lines where id = r.id;
    perform public.pp_take(r.product, r.liters, r.kind, r.amount, r.ref_cost, r.shift_id, r.batch_id,
                           r.movement_id, r.station_id, r.occurred_on, r.created_by, r.channel);
  end loop;
  delete from public.pp_lots where id = p_lot;
end;
$$;

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
                           r.movement_id, r.station_id, r.occurred_on, r.created_by, r.channel);
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

-- Borrowed P-P: the latest Big PO's cost per litre (else the latest purchase).
create or replace function public.pp_latest_cost(p_product text)
returns numeric language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select l.cost_per_liter from public.pp_lots l
      where l.product = p_product and l.source = 'official' and l.cost_per_liter is not null
      order by l.occurred_on desc, l.created_at desc limit 1),
    (select l.cost_per_liter from public.pp_lots l
      where l.product = p_product and l.source in ('shop', 'opening') and l.cost_per_liter is not null
      order by l.occurred_on desc, l.created_at desc limit 1))
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. P-P lines: "sell" to a station; undoing a "pool closed" line opens it again
-- ═════════════════════════════════════════════════════════════════════════════
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
    values (m.product, case when v_per is null then 'count_gain' else 'opening' end, m.id, null, m.occurred_on, v_l, v_l, v_per, coalesce(v_per, 0));
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

create or replace function public.pp_unapply_movement(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_lot     uuid;
  v_product text := (select product from public.pipa_movements where id = p_id);
begin
  -- A purchase in a closed pool: the pool has to be opened first.
  if exists (select 1 from public.pp_lots l join public.pp_pools p on p.id = l.pool_id
              where l.movement_id = p_id and p.closed_at is not null and p.close_movement_id is not null) then
    raise exception 'This purchase is in a closed pool — delete its "pool closed" line first' using errcode = 'P0001';
  end if;
  perform public.pp_restore_lines(p_id, null);
  for v_lot in select id from public.pp_lots where movement_id = p_id loop
    perform public.pp_drop_lot(v_lot);
  end loop;
  -- Undoing a "pool closed" line opens the pool again.
  update public.pp_pools set closed_at = null, closed_by = null, close_reason = null, close_note = null,
                             close_movement_id = null, notified_at = null
   where close_movement_id = p_id;
  if v_product is not null then perform public.pp_cover_unallocated(v_product); end if;
end;
$$;

-- Record one P-P line (owners, accountants, managers). Adds "sell" (to a station, with a price).
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

-- P-P lines for the ledger page — now with why a pool was closed.
drop function if exists public.pp_movements();
create function public.pp_movements()
returns table (
  id uuid, created_at timestamptz, occurred_on date, kind text, station_id uuid, product text, pipas numeric,
  liters_per_pipa numeric, exact_liters numeric, price_mode text, unit_price numeric, total_amount numeric,
  transport_fee numeric, other_fee numeric, source text, note text, shift_batch_id uuid, shift_id uuid, created_by text,
  write_off_reason text
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
         m.write_off_reason
  from public.pipa_movements m
  left join public.pipa_shift_deductions d on d.batch_id = m.shift_batch_id
  order by m.occurred_on desc, m.created_at desc;
end;
$$;
revoke all on function public.pp_movements() from public, anon;
grant execute on function public.pp_movements() to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. Closing a pool
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.pp_close_pool(p_pool uuid, p_reason text, p_note text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_role text := public.current_app_role();
  v_who  text := lower(auth.jwt() ->> 'email');
  v_note text := nullif(btrim(left(coalesce(p_note, ''), 500)), '');
  v_pp   numeric := public.pp_pp_liters();
  v_on   date := (now() at time zone 'Asia/Yangon')::date;
  p      public.pp_pools;
  v_left numeric;
  v_mid  uuid;
  l      record;
begin
  if v_role is null or v_role not in ('ceo', 'manager') then
    raise exception 'Only owners and managers can close a pool' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('shortage', 'spill', 'other') then raise exception 'Choose why the pool is closed'; end if;
  if p_reason = 'other' and v_note is null then raise exception 'Write what happened'; end if;
  select * into p from public.pp_pools where id = p_pool for update;
  if not found then raise exception 'Unknown pool' using errcode = '23503'; end if;
  if p.closed_at is not null then raise exception 'This pool is already closed' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtext('pp_cover:' || p.product));

  select coalesce(sum(remaining), 0) into v_left from public.pp_lots where pool_id = p.id;
  if v_left > 0.0005 then
    insert into public.pipa_movements (occurred_on, kind, product, pipas, liters_per_pipa, exact_liters, note, pool_id, write_off_reason, created_by)
    values (v_on, 'write_off', p.product, greatest(round(v_left / v_pp, 3), 0.001), v_pp, v_left,
            'Pool closed — ' || p_reason || coalesce(' · ' || v_note, ''), p.id, p_reason, v_who)
    returning id into v_mid;
    for l in select * from public.pp_lots where pool_id = p.id and remaining > 0.0005 order by occurred_on, created_at, id for update loop
      insert into public.pp_cost_lines (kind, product, lot_id, liters, cost, movement_id, occurred_on, created_by)
      values ('write_off', p.product, l.id, l.remaining, round(l.remaining * l.cost_per_liter, 2), v_mid, v_on, v_who);
      update public.pp_lots set remaining = 0 where id = l.id;
    end loop;
  end if;
  update public.pp_pools set closed_at = now(), closed_by = v_who, close_reason = p_reason, close_note = v_note, close_movement_id = v_mid
   where id = p.id;

  if v_role <> 'ceo' then   -- owners are told when a manager closes a pool
    begin
      perform net.http_post(
        url                  := 'https://ryubjollofribrvrwqtz.supabase.co/functions/v1/pp-telegram-notify',
        body                 := jsonb_build_object('event', 'pool_closed', 'id', p.id),
        headers              := jsonb_build_object('Content-Type', 'application/json'),
        timeout_milliseconds := 10000);
    exception when others then
      raise warning 'pp_close_pool: Telegram notice failed for %: % (%)', p.id, sqlerrm, sqlstate;
    end;
  end if;
  return jsonb_build_object('pool', p.id, 'liters', v_left, 'movement', v_mid);
end;
$$;
revoke all on function public.pp_close_pool(uuid, text, text) from public, anon;
grant execute on function public.pp_close_pool(uuid, text, text) to authenticated;

-- The pools for the stock view: open ones still holding fuel, and any closed (or started) in the last p_days days.
create or replace function public.pp_pools(p_days integer default 60)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_role text := public.pp_require_role();
  v_days integer := least(greatest(coalesce(p_days, 60), 1), 400);
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
                          'written', coalesce((select sum(c.liters) from public.pp_cost_lines c where c.lot_id = l.id and c.kind = 'write_off'), 0))
                        order by l.occurred_on, l.created_at, l.id)
                         from public.pp_lots l where l.pool_id = p.id), '[]'::jsonb) as lots
          from public.pp_pools p
         where (p.closed_at is null and exists (select 1 from public.pp_lots l where l.pool_id = p.id and l.remaining > 0.0005))
            or p.closed_at > now() - make_interval(days => v_days)
            or p.started_on > (now() at time zone 'Asia/Yangon')::date - v_days
         order by p.started_on desc limit 80) x), '[]'::jsonb));
end;
$$;
revoke all on function public.pp_pools(integer) from public, anon;
grant execute on function public.pp_pools(integer) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 6. Shift sales per channel (pumps, P-P sold, J-C), each with its own money
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.pp_shift_channels(p_fuel jsonb, p_pp numeric)
returns table (product text, channel text, liters numeric, amount numeric)
language plpgsql immutable set search_path = ''
as $$
declare
  f     jsonb := coalesce(p_fuel, '{}'::jsonb);
  prods text[] := array['92', '95', 'PD', 'D'];
  chans text[] := array['pump', 'pipa', 'jc'];
  v_l   numeric[] := array_fill(0::numeric, array[12]);   -- [channel − 1] * 4 + fuel
  v_a   numeric[] := array_fill(0::numeric, array[12]);
  i int; ci int; l numeric; t numeric; pr numeric; lit numeric; sz numeric; e jsonb;
begin
  for i in 1..3 loop
    l  := public.pp_num(f -> (array['fuel_92_liters', 'fuel_95_liters', 'premium_diesel_liters'])[i]);
    t  := public.pp_num(f -> (array['fuel_92_total', 'fuel_95_total', 'premium_diesel_total'])[i]);
    pr := public.pp_num(f -> (array['fuel_92_price', 'fuel_95_price', 'premium_diesel_price'])[i]);
    lit := case when l > 0 then l when t > 0 and pr > 0 then t / pr else 0 end;
    v_l[i] := v_l[i] + lit;
    v_a[i] := v_a[i] + case when t > 0 then t else lit * pr end;
  end loop;
  t := public.pp_num(f -> 'diesel_cash'); pr := public.pp_num(f -> 'diesel_price');
  if t > 0 and pr > 0 then v_l[4] := v_l[4] + t / pr; v_a[4] := v_a[4] + t; end if;
  if jsonb_typeof(f -> 'pipa_items') = 'array' then
    for e in select x from jsonb_array_elements(f -> 'pipa_items') x loop
      i := array_position(prods, e ->> 'product');
      continue when i is null;
      sz := case when public.pp_num(e -> 'liters_per_pipa') > 0 then public.pp_num(e -> 'liters_per_pipa') else p_pp end;
      v_l[4 + i] := v_l[4 + i] + public.pp_num(e -> 'containers') * sz;
      v_a[4 + i] := v_a[4 + i] + case when public.pp_num(e -> 'total') <> 0 then public.pp_num(e -> 'total')
                                      else public.pp_num(e -> 'containers') * public.pp_num(e -> 'price') end;
    end loop;
  end if;
  if jsonb_typeof(f -> 'jelly_can_items') = 'array' then
    for e in select x from jsonb_array_elements(f -> 'jelly_can_items') x loop
      i := array_position(prods, e ->> 'product');
      continue when i is null;
      lit := case when public.pp_num(e -> 'total_liters') > 0 then public.pp_num(e -> 'total_liters')
                  else public.pp_num(e -> 'pieces') * coalesce(nullif(public.pp_num(e -> 'liters_per_can'), 0), 18) end;
      v_l[8 + i] := v_l[8 + i] + lit;
      v_a[8 + i] := v_a[8 + i] + case when public.pp_num(e -> 'total') <> 0 then public.pp_num(e -> 'total')
                                      else public.pp_num(e -> 'pieces') * public.pp_num(e -> 'price') end;
    end loop;
  end if;
  for i in 1..4 loop
    for ci in 1..3 loop
      continue when v_l[(ci - 1) * 4 + i] <= 0;
      product := prods[i]; channel := chans[ci];
      liters := v_l[(ci - 1) * 4 + i]; amount := v_a[(ci - 1) * 4 + i];   -- not rounded (pp_shift_sales rounds the totals)
      return next;
    end loop;
  end loop;
end;
$$;

-- Litres and money per fuel (all channels) — what STM Financial shows and what a deduction stores.
create or replace function public.pp_shift_sales(p_fuel jsonb, p_pp numeric)
returns table (product text, liters numeric, amount numeric)
language sql immutable set search_path = ''
as $$
  select c.product, trim_scale(round(sum(c.liters), 3)), trim_scale(round(sum(c.amount), 2))
  from public.pp_shift_channels(p_fuel, p_pp) c
  group by c.product
  having round(sum(c.liters), 3) > 0
  order by array_position(array['92', '95', 'PD', 'D'], c.product)
$$;

-- Deduct one shift: one "sold" line per fuel; costs and money kept per channel.
create or replace function public.pp_deduct_shift(p_shift uuid, p_auto boolean, p_who text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_batch uuid := gen_random_uuid();
  v_pp    numeric := public.pp_pp_liters();
  v_fuel  jsonb;
  v_fig   record;
  v_on    date;
  v_name  text;
  v_mid   uuid;
  v_done  numeric;
  v_amt   numeric;
  v_n     integer;
  v_k     integer;
  r       record;
  c       record;
begin
  select * into v_fig from public.pp_shift_figures(p_shift);
  if v_fig.shift_at is null then raise exception 'Unknown shift' using errcode = '23503'; end if;
  if v_fig.shift_at < public.pp_reset_at() then
    raise exception 'This shift is from before the P-P data was reset' using errcode = 'P0001';
  end if;
  select employee_name, fuel_data into v_name, v_fuel from public.daily_sales_reports where id = p_shift;
  v_on := (v_fig.shift_at at time zone 'Asia/Yangon')::date;

  insert into public.pipa_shift_deductions (shift_id, batch_id, liters, amounts, shift_at, auto, deducted_by)
  values (p_shift, v_batch, v_fig.liters, v_fig.amounts, v_fig.shift_at, p_auto, p_who);

  for r in select * from public.pp_shift_sales(v_fuel, v_pp) loop
    v_mid := null;
    if round(r.liters / v_pp, 3) > 0 then
      insert into public.pipa_movements (occurred_on, kind, product, pipas, liters_per_pipa, exact_liters, note, shift_batch_id, created_by)
      values (v_on, 'used', r.product, round(r.liters / v_pp, 3), v_pp, r.liters,
              format('Shift sales: %s L · %s', round(r.liters, 2), coalesce(nullif(btrim(v_name), ''), '—')), v_batch, p_who)
      returning id into v_mid;
    end if;
    -- Each channel its own litres and money; the last one takes the rounding so they add up exactly.
    select count(*) into v_n from public.pp_shift_channels(v_fuel, v_pp) x where x.product = r.product;
    v_done := 0; v_amt := 0; v_k := 0;
    for c in select * from public.pp_shift_channels(v_fuel, v_pp) x where x.product = r.product loop
      v_k := v_k + 1;
      if v_k < v_n then
        perform public.pp_take(r.product, round(c.liters, 3), 'sale', round(c.amount, 2), null, p_shift, v_batch, v_mid, null, v_on, p_who, c.channel);
        v_done := v_done + round(c.liters, 3); v_amt := v_amt + round(c.amount, 2);
      else
        perform public.pp_take(r.product, r.liters - v_done, 'sale', r.amount - v_amt, null, p_shift, v_batch, v_mid, null, v_on, p_who, c.channel);
      end if;
    end loop;
  end loop;
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 7. Profit: loss includes closed pools; borrowed P-P kept flat; per channel
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.pp_profit_calc(p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = ''
as $$
  with x as (
    select occurred_on as day, product, kind, channel, liters, amount, cost,
      case when kind in ('sale', 'lend_paid') then coalesce(amount, 0) else 0 end as revenue,
      case when kind = 'sale' then coalesce(cost, 0) when kind = 'lend_paid' then coalesce(ref_cost, 0) else 0 end as cogs,
      0::numeric as settle,   -- borrowed P-P are kept flat at the Big PO cost
      case when kind in ('count_loss', 'write_off') then coalesce(cost, 0) else 0 end as loss,
      case when kind = 'used' then coalesce(cost, 0) else 0 end as used,
      case when kind = 'sale' then liters else 0 end as sold,
      case when kind = 'sale' and cost is null then liters else 0 end as unpriced
    from public.pp_cost_lines where occurred_on between p_from and p_to
  ),
  tot as (
    select coalesce(sum(sold), 0) as liters, coalesce(sum(revenue), 0) as revenue, coalesce(sum(cogs), 0) as cost,
           coalesce(sum(settle), 0) as settle, coalesce(sum(loss), 0) as loss, coalesce(sum(used), 0) as used,
           coalesce(sum(unpriced), 0) as unpriced, coalesce(sum(revenue - cogs - settle - loss - used), 0) as profit
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
        select product, coalesce(channel, 'mixed') as channel, sum(liters) as liters, sum(coalesce(amount, 0)) as revenue,
               sum(coalesce(cost, 0)) as cost, sum(coalesce(amount, 0) - coalesce(cost, 0)) as profit,
               sum(case when cost is null then liters else 0 end) as unpriced
        from x where kind = 'sale' group by product, coalesce(channel, 'mixed')) c), '[]'::jsonb),
    'days', coalesce((select jsonb_agg(to_jsonb(d) order by d.day) from (
        select day, sum(sold) as liters, sum(revenue) as revenue, sum(cogs) as cost,
               sum(revenue - cogs - settle - loss - used) as profit
        from x group by day) d), '[]'::jsonb)
  )
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 8. "Delete all P-P data" also removes the pools
-- ═════════════════════════════════════════════════════════════════════════════
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
  lock table public.pipa_movements, public.pipa_shift_deductions, public.pp_lots, public.pp_cost_lines, public.pp_archive, public.pp_pools
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
  delete from public.pp_pools where true;
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

-- ═════════════════════════════════════════════════════════════════════════════
-- 9. Who may call what (internal helpers: nobody from the browser)
-- ═════════════════════════════════════════════════════════════════════════════
revoke all on function public.pp_pool_for(text, text, date), public.pp_lot_pool(), public.pp_lot_gone(),
  public.pp_take(text, numeric, text, numeric, numeric, uuid, uuid, uuid, uuid, date, text, text),
  public.pp_drop_lot(uuid), public.pp_cover_unallocated(text), public.pp_latest_cost(text),
  public.pp_apply_movement(uuid), public.pp_unapply_movement(uuid),
  public.pp_shift_channels(jsonb, numeric), public.pp_shift_sales(jsonb, numeric),
  public.pp_deduct_shift(uuid, boolean, text), public.pp_profit_calc(date, date)
  from public, anon, authenticated;
grant execute on function public.pp_profit_calc(date, date) to service_role;   -- the Telegram report
