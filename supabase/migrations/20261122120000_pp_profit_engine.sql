-- P-P profit engine — replaces the PO Registry.
--
-- The P-P Ledger is the only stock record. Behind it, owner-only:
--   pp_lots        every litre that came in, with what it cost per litre:
--                  shop purchases, official (large) purchases with fees,
--                  borrowed P-P, P-P returned to us, count gains, opening stock
--   pp_cost_lines  every litre that went out, taken from the oldest lot first:
--                  shift sales (with that day's selling price), lending,
--                  returning borrowed P-P, count losses, fuel used — plus cash
--                  settlements for borrowed / lent P-P
--   pp_archive     everything deleted, with the reason, who and when
-- Profit is worked out from these only when an owner asks (pp_profit), or in
-- a weekly / monthly Telegram report if switched on.
--
-- Who does what:
--   • owners, accountants and managers record P-P lines and deduct shift sales
--     (and new shifts are deducted automatically while "auto deduct" is on);
--   • deleting a line, or undoing a shift deduction, needs a reason — the line
--     goes to the archive and owners get a Telegram message;
--   • only owners see costs, sales money, profit, the archive and the history;
--     managers see purchase prices unless an owner turns that off.
-- Every write goes through the functions below (they check the role), so P-P
-- stock and the cost records can't drift apart.
--
-- Also: deletes the PO data and retires the PO functions. Safe to run more
-- than once. Needs: pipa_ledger, manager_shared_pp_po, pg_net.

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. Settings (one row; owners change it in STM Financial → Settings)
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.pp_settings (
  id                  boolean primary key default true check (id),
  default_pp_liters   numeric not null default 215 check (default_pp_liters > 0 and default_pp_liters <= 10000),
  auto_deduct         boolean not null default true,     -- deduct each shift as soon as it is submitted
  managers_see_prices boolean not null default true,     -- managers / accountants see purchase prices
  profit_auto         text not null default 'off' check (profit_auto in ('off', 'week', 'month')),       -- Profit page opens calculated
  profit_report       text not null default 'off' check (profit_report in ('off', 'weekly', 'monthly')), -- Telegram report to owners
  updated_at          timestamptz not null default now(),
  updated_by          text
);
insert into public.pp_settings (id) values (true) on conflict (id) do nothing;
alter table public.pp_settings enable row level security;
revoke all on public.pp_settings from anon, authenticated;
grant select on public.pp_settings to authenticated;
grant update (default_pp_liters, auto_deduct, managers_see_prices, profit_auto, profit_report) on public.pp_settings to authenticated;
drop policy if exists "pp_read" on public.pp_settings;
create policy "pp_read" on public.pp_settings for select to authenticated
  using (public.current_app_role() in ('ceo', 'accountant', 'manager'));
drop policy if exists "owner_update" on public.pp_settings;
create policy "owner_update" on public.pp_settings for update to authenticated
  using (public.current_app_role() = 'ceo') with check (public.current_app_role() = 'ceo');

create or replace function public.pp_settings_stamp()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := lower(auth.jwt() ->> 'email');
  return new;
end;
$$;
drop trigger if exists pp_settings_stamp on public.pp_settings;
create trigger pp_settings_stamp before update on public.pp_settings
  for each row execute function public.pp_settings_stamp();

create or replace function public.pp_pp_liters()
returns numeric language sql stable security definer set search_path = ''
as $$ select coalesce((select default_pp_liters from public.pp_settings where id), 215) $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. Tables
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.pipa_movements add column if not exists source       text check (source in ('shop', 'official'));
alter table public.pipa_movements add column if not exists transport_fee numeric(14, 2) check (transport_fee >= 0);  -- MMK / litre
alter table public.pipa_movements add column if not exists other_fee     numeric(14, 2) check (other_fee >= 0);      -- MMK / litre
alter table public.pipa_movements add column if not exists exact_liters  numeric check (exact_liters > 0);          -- official purchases typed in litres
alter table public.pipa_movements add column if not exists created_by    text;

alter table public.pipa_shift_deductions add column if not exists liters      jsonb;   -- { fuel: litres } when deducted
alter table public.pipa_shift_deductions add column if not exists amounts     jsonb;   -- { fuel: money } when deducted
alter table public.pipa_shift_deductions add column if not exists shift_at    timestamptz;
alter table public.pipa_shift_deductions add column if not exists auto        boolean not null default false;
alter table public.pipa_shift_deductions add column if not exists deducted_by text;

create table if not exists public.pp_lots (
  id              uuid primary key default gen_random_uuid(),
  product         text not null check (product in ('92', '95', 'PD', 'D')),
  source          text not null check (source in ('shop', 'official', 'borrow', 'lend_return', 'count_gain', 'opening')),
  movement_id     uuid references public.pipa_movements(id) on delete cascade,
  station_id      uuid references public.pipa_stations(id) on delete set null,
  occurred_on     date not null,
  liters          numeric not null check (liters > 0),
  remaining       numeric not null check (remaining >= 0),
  price_per_liter numeric,                          -- what was paid per litre
  fees_per_liter  numeric not null default 0,       -- transport + other fees per litre
  cost_per_liter  numeric,                          -- price + fees; null = not known
  created_at      timestamptz not null default clock_timestamp()
);
create index if not exists pp_lots_fifo on public.pp_lots (product, occurred_on, created_at) where remaining > 0;
create index if not exists pp_lots_movement on public.pp_lots (movement_id);

create table if not exists public.pp_cost_lines (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('sale', 'lend', 'borrow_return', 'lend_paid', 'borrow_paid', 'count_loss', 'used')),
  product     text not null check (product in ('92', '95', 'PD', 'D')),
  lot_id      uuid references public.pp_lots(id) on delete restrict,   -- null: no lot had stock (no purchase price)
  liters      numeric not null check (liters >= 0),
  cost        numeric,       -- litres × the lot's cost per litre
  amount      numeric,       -- money: shift sales, cash received (lend_paid), cash paid (borrow_paid)
  ref_cost    numeric,       -- what those litres were costed at when borrowed / lent
  shift_id    uuid references public.daily_sales_reports(id) on delete set null,
  batch_id    uuid,          -- the shift deduction this belongs to
  movement_id uuid references public.pipa_movements(id) on delete cascade,
  station_id  uuid,
  occurred_on date not null,
  created_at  timestamptz not null default clock_timestamp(),
  created_by  text
);
create index if not exists pp_cost_lines_day on public.pp_cost_lines (occurred_on);
create index if not exists pp_cost_lines_lot on public.pp_cost_lines (lot_id);
create index if not exists pp_cost_lines_batch on public.pp_cost_lines (batch_id);
create index if not exists pp_cost_lines_movement on public.pp_cost_lines (movement_id);

create table if not exists public.pp_archive (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('movement', 'shift')),
  summary     text not null,
  snapshot    jsonb not null,
  reason      text not null check (btrim(reason) <> ''),
  archived_by text,
  actor_role  text,
  notify      boolean not null default false,
  notified_at timestamptz,
  archived_at timestamptz not null default now()
);
create index if not exists pp_archive_at on public.pp_archive (archived_at desc);

create table if not exists public.pp_report_sent (
  period  text primary key,
  sent_at timestamptz not null default now()
);

-- Owners read costs, history and the archive; nobody writes them directly.
alter table public.pp_lots enable row level security;
alter table public.pp_cost_lines enable row level security;
alter table public.pp_archive enable row level security;
alter table public.pp_report_sent enable row level security;
revoke all on public.pp_lots, public.pp_cost_lines, public.pp_archive, public.pp_report_sent from anon, authenticated;
grant select on public.pp_lots, public.pp_cost_lines, public.pp_archive to authenticated;
drop policy if exists "owner_read" on public.pp_lots;
create policy "owner_read" on public.pp_lots for select to authenticated using (public.current_app_role() = 'ceo');
drop policy if exists "owner_read" on public.pp_cost_lines;
create policy "owner_read" on public.pp_cost_lines for select to authenticated using (public.current_app_role() = 'ceo');
drop policy if exists "owner_read" on public.pp_archive;
create policy "owner_read" on public.pp_archive for select to authenticated using (public.current_app_role() = 'ceo');

-- P-P lines: written only through the functions; read directly by owners,
-- by everyone else through pp_movements() (which hides prices if switched off).
revoke all on public.pipa_movements, public.pipa_shift_deductions from anon, authenticated;
grant select on public.pipa_movements, public.pipa_shift_deductions to authenticated;
drop policy if exists "pp_read" on public.pipa_movements;
drop policy if exists "pp_insert" on public.pipa_movements;
drop policy if exists "pp_update" on public.pipa_movements;
drop policy if exists "pp_delete" on public.pipa_movements;
drop policy if exists "owner_read" on public.pipa_movements;
create policy "owner_read" on public.pipa_movements for select to authenticated using (public.current_app_role() = 'ceo');
drop policy if exists "pp_read" on public.pipa_shift_deductions;
drop policy if exists "owner_read" on public.pipa_shift_deductions;
create policy "owner_read" on public.pipa_shift_deductions for select to authenticated using (public.current_app_role() = 'ceo');

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. Building blocks (internal — not callable from the browser)
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.pp_num(v jsonb)
returns numeric language sql immutable set search_path = ''
as $$
  select case jsonb_typeof(v)
    when 'number' then (v #>> '{}')::numeric
    when 'string' then case when btrim(v #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$' then btrim(v #>> '{}')::numeric else 0 end
    else 0 end
$$;

-- Litres and money of each fuel in one shift's figures — the same count STM
-- Financial shows: pumps, diesel sold by cash, whole P-P sold and J-C.
create or replace function public.pp_shift_sales(p_fuel jsonb, p_pp numeric)
returns table (product text, liters numeric, amount numeric)
language plpgsql immutable set search_path = ''
as $$
declare
  f     jsonb := coalesce(p_fuel, '{}'::jsonb);
  prods text[] := array['92', '95', 'PD', 'D'];
  v_l   numeric[] := array[0, 0, 0, 0];
  v_a   numeric[] := array[0, 0, 0, 0];
  i     integer;
  l     numeric;
  t     numeric;
  pr    numeric;
  lit   numeric;
  e     jsonb;
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
      v_l[i] := v_l[i] + public.pp_num(e -> 'containers') * p_pp;
      v_a[i] := v_a[i] + case when public.pp_num(e -> 'total') <> 0 then public.pp_num(e -> 'total')
                              else public.pp_num(e -> 'containers') * public.pp_num(e -> 'price') end;
    end loop;
  end if;
  if jsonb_typeof(f -> 'jelly_can_items') = 'array' then
    for e in select x from jsonb_array_elements(f -> 'jelly_can_items') x loop
      i := array_position(prods, e ->> 'product');
      continue when i is null;
      v_l[i] := v_l[i] + public.pp_num(e -> 'total_liters');
      v_a[i] := v_a[i] + case when public.pp_num(e -> 'total') <> 0 then public.pp_num(e -> 'total')
                              else public.pp_num(e -> 'pieces') * public.pp_num(e -> 'price') end;
    end loop;
  end if;
  for i in 1..4 loop
    product := prods[i]; liters := trim_scale(round(v_l[i], 3)); amount := trim_scale(round(v_a[i], 2));
    if liters > 0 then return next; end if;
  end loop;
end;
$$;

-- What the latest real purchase of a fuel cost per litre (used to cost borrowed P-P).
create or replace function public.pp_latest_cost(p_product text)
returns numeric language sql stable security definer set search_path = ''
as $$
  select l.cost_per_liter from public.pp_lots l
  where l.product = p_product and l.source in ('shop', 'official', 'opening') and l.cost_per_liter is not null
  order by l.occurred_on desc, l.created_at desc limit 1
$$;

-- P-P still out with / owed to a station, in litres, and what they're costed at.
create or replace function public.pp_holding(p_station uuid, p_product text, p_side text)
returns table (liters numeric, cost numeric)
language sql stable security definer set search_path = ''
as $$
  with parts as (
    select sum(c.liters) as l, sum(coalesce(c.cost, 0)) as c from public.pp_cost_lines c
     where p_side = 'lent' and c.kind = 'lend' and c.station_id = p_station and c.product = p_product
    union all
    select -sum(o.liters), -sum(o.liters * coalesce(o.cost_per_liter, 0)) from public.pp_lots o
     where p_side = 'lent' and o.source = 'lend_return' and o.station_id = p_station and o.product = p_product
    union all
    select -sum(c.liters), -sum(coalesce(c.ref_cost, 0)) from public.pp_cost_lines c
     where p_side = 'lent' and c.kind = 'lend_paid' and c.station_id = p_station and c.product = p_product
    union all
    select sum(o.liters), sum(o.liters * coalesce(o.cost_per_liter, 0)) from public.pp_lots o
     where p_side = 'borrowed' and o.source = 'borrow' and o.station_id = p_station and o.product = p_product
    union all
    select -sum(c.liters), -sum(coalesce(c.ref_cost, 0)) from public.pp_cost_lines c
     where p_side = 'borrowed' and c.kind in ('borrow_return', 'borrow_paid') and c.station_id = p_station and c.product = p_product
  )
  select coalesce(sum(l), 0), coalesce(sum(c), 0) from parts
$$;

create or replace function public.pp_holding_rate(p_station uuid, p_product text, p_side text)
returns numeric language sql stable security definer set search_path = ''
as $$
  select case when h.liters > 0.0005 then h.cost / h.liters end from public.pp_holding(p_station, p_product, p_side) h
$$;

-- Take litres out of stock, oldest lot first. Money (amount / ref_cost) is
-- shared out over the pieces in proportion. Litres no lot can cover are kept
-- as a line without a lot (no purchase price) so nothing is lost.
create or replace function public.pp_take(
  p_product text, p_liters numeric, p_kind text, p_amount numeric, p_ref_cost numeric,
  p_shift uuid, p_batch uuid, p_movement uuid, p_station uuid, p_on date, p_who text
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
      insert into public.pp_cost_lines (kind, product, lot_id, liters, cost, amount, ref_cost, shift_id, batch_id, movement_id, station_id, occurred_on, created_by)
      values (p_kind, p_product, null, v_rest, null, round(p_amount * v_rest / p_liters, 2), round(p_ref_cost * v_rest / p_liters, 2),
              p_shift, p_batch, p_movement, p_station, p_on, p_who);
      return;
    end if;
    v_take := least(v_rest, lot.remaining);
    update public.pp_lots set remaining = case when remaining - v_take < 0.0005 then 0 else remaining - v_take end where id = lot.id;
    insert into public.pp_cost_lines (kind, product, lot_id, liters, cost, amount, ref_cost, shift_id, batch_id, movement_id, station_id, occurred_on, created_by)
    values (p_kind, p_product, lot.id, v_take, round(v_take * lot.cost_per_liter, 2), round(p_amount * v_take / p_liters, 2),
            round(p_ref_cost * v_take / p_liters, 2), p_shift, p_batch, p_movement, p_station, p_on, p_who);
    v_rest := v_rest - v_take;
  end loop;
end;
$$;

-- Put the litres of some cost lines back on their lots, and remove the lines.
create or replace function public.pp_restore_lines(p_movement uuid, p_batch uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  update public.pp_lots l
     set remaining = least(l.liters, l.remaining + s.liters)
    from (select lot_id, sum(liters) as liters from public.pp_cost_lines
           where lot_id is not null and ((p_movement is not null and movement_id = p_movement) or (p_batch is not null and batch_id = p_batch))
           group by lot_id) s
   where l.id = s.lot_id;
  delete from public.pp_cost_lines
   where (p_movement is not null and movement_id = p_movement) or (p_batch is not null and batch_id = p_batch);
end;
$$;

-- Remove a lot; anything already taken from it is taken again from the other lots.
create or replace function public.pp_drop_lot(p_lot uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare r record;
begin
  update public.pp_lots set remaining = 0 where id = p_lot;
  for r in select * from public.pp_cost_lines where lot_id = p_lot order by occurred_on, created_at loop
    delete from public.pp_cost_lines where id = r.id;
    perform public.pp_take(r.product, r.liters, r.kind, r.amount, r.ref_cost, r.shift_id, r.batch_id,
                           r.movement_id, r.station_id, r.occurred_on, r.created_by);
  end loop;
  delete from public.pp_lots where id = p_lot;
end;
$$;

-- What one P-P line does to the lots and cost lines.
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
end;
$$;

-- Undo what one P-P line did (before the line itself is deleted).
create or replace function public.pp_unapply_movement(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_lot uuid;
begin
  perform public.pp_restore_lines(p_id, null);
  for v_lot in select id from public.pp_lots where movement_id = p_id loop
    perform public.pp_drop_lot(v_lot);
  end loop;
end;
$$;

-- ── Shift deductions ─────────────────────────────────────────────────────────
create or replace function public.pp_shift_figures(p_shift uuid, out liters jsonb, out amounts jsonb, out shift_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select coalesce((select jsonb_object_agg(x.product, x.liters) from public.pp_shift_sales(s.fuel_data, public.pp_pp_liters()) x), '{}'::jsonb),
         coalesce((select jsonb_object_agg(x.product, x.amount) from public.pp_shift_sales(s.fuel_data, public.pp_pp_liters()) x), '{}'::jsonb),
         s."timestamp"
  from public.daily_sales_reports s where s.id = p_shift
$$;

-- Deduct one shift: a P-P "sold" line per fuel, and the litres taken from the
-- oldest lots with that day's selling price. A second time fails with 23505.
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

create or replace function public.pp_undo_shift(p_shift uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_batch uuid;
begin
  select batch_id into v_batch from public.pipa_shift_deductions where shift_id = p_shift;
  if v_batch is null then return false; end if;
  perform public.pp_restore_lines(null, v_batch);
  delete from public.pipa_movements where shift_batch_id = v_batch;
  delete from public.pipa_shift_deductions where shift_id = p_shift;
  return true;
end;
$$;

-- Archive a shift deduction (with the reason) and undo it.
create or replace function public.pp_archive_shift(p_shift uuid, p_reason text, p_notify boolean)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  d  public.pipa_shift_deductions;
  s  record;
begin
  select * into d from public.pipa_shift_deductions where shift_id = p_shift;
  if not found then return false; end if;
  select employee_name, "timestamp" into s from public.daily_sales_reports where id = p_shift;
  insert into public.pp_archive (kind, summary, snapshot, reason, archived_by, actor_role, notify)
  values ('shift',
          format('Shift sales deduction · %s · %s · %s', coalesce(s.employee_name, '—'),
                 to_char(coalesce(d.shift_at, s."timestamp") at time zone 'Asia/Yangon', 'DD Mon YYYY HH24:MI'),
                 (select string_agg(format('%s %s L', key, value), ', ' order by key) from jsonb_each_text(coalesce(d.liters, '{}'::jsonb)))),
          to_jsonb(d) || jsonb_build_object('employee_name', s.employee_name),
          btrim(p_reason), coalesce(lower(auth.jwt() ->> 'email'), 'auto'), public.current_app_role(), p_notify);
  return public.pp_undo_shift(p_shift);
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. What the app calls
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.pp_require_role()
returns text language plpgsql stable security definer set search_path = ''
as $$
declare v text := public.current_app_role();
begin
  if v is null or v not in ('ceo', 'accountant', 'manager') then
    raise exception 'Only owners, accountants and managers can use the P-P Ledger' using errcode = '42501';
  end if;
  return v;
end;
$$;

-- P-P lines for the ledger page. Prices are blank for accountants / managers
-- when an owner has switched "managers see purchase prices" off.
drop function if exists public.pp_movements();
create function public.pp_movements()
returns table (
  id uuid, created_at timestamptz, occurred_on date, kind text, station_id uuid, product text, pipas numeric,
  liters_per_pipa numeric, exact_liters numeric, price_mode text, unit_price numeric, total_amount numeric,
  transport_fee numeric, other_fee numeric, source text, note text, shift_batch_id uuid, shift_id uuid, created_by text
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
         case when v_show then m.other_fee::numeric end, m.source, m.note, m.shift_batch_id, d.shift_id, m.created_by
  from public.pipa_movements m
  left join public.pipa_shift_deductions d on d.batch_id = m.shift_batch_id
  order by m.occurred_on desc, m.created_at desc;
end;
$$;
revoke all on function public.pp_movements() from public, anon;
grant execute on function public.pp_movements() to authenticated;

-- Record one P-P line. p: { kind, product, station_id, pipas, liters_per_pipa,
-- occurred_on, note, price_mode, unit_price, source ('shop'|'official'),
-- liters (official, instead of pipas), transport_fee, other_fee (MMK / litre) }.
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
  if v_kind is null or v_kind not in ('buy', 'borrow', 'borrow_returned', 'borrow_paid', 'lend', 'lend_returned', 'lend_paid', 'used', 'adjust') then
    raise exception 'Unknown kind of P-P line';
  end if;
  if v_product is null or v_product not in ('92', '95', 'PD', 'D') then raise exception 'Choose a fuel'; end if;
  if v_size is null or v_size <= 0 then raise exception 'P-P size must be positive'; end if;
  v_station_kind := v_kind not in ('used', 'adjust');
  v_priced := v_kind in ('buy', 'borrow_paid', 'lend_paid');
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

  if v_exact is not null then           -- official purchase typed in litres
    if v_exact <= 0 then raise exception 'Litres must be positive'; end if;
    v_pipas := round(v_exact / v_size, 3);
  end if;
  if v_pipas is null or (v_kind = 'adjust' and v_pipas = 0) or (v_kind <> 'adjust' and v_pipas <= 0) then
    raise exception 'Enter how many P-P';
  end if;

  if v_priced or (v_kind = 'adjust' and v_price is not null) then
    v_mode := coalesce(v_mode, 'per_liter');
    if v_mode not in ('per_pipa', 'per_liter') or v_price is null or v_price < 0 then raise exception 'Enter the price'; end if;
    if v_kind = 'adjust' and v_pipas < 0 then v_mode := null; v_price := null; end if;   -- a shortage has no price
  else
    v_mode := null; v_price := null;
  end if;

  -- Returns and settlements can't exceed what is owed.
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

-- Delete a P-P line: needs a reason; it goes to the archive (owners are told on
-- Telegram when someone else did it), and stock and costs are put right.
create or replace function public.archive_pp_movement(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_role text := public.pp_require_role();
  m      public.pipa_movements;
  v_st   text;
begin
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Write why this is being deleted' using errcode = '22023'; end if;
  select * into m from public.pipa_movements where id = p_id for update;
  if not found then raise exception 'This line was already deleted' using errcode = 'P0002'; end if;
  if m.shift_batch_id is not null then raise exception 'Undo the shift deduction instead' using errcode = 'P0001'; end if;
  select name into v_st from public.pipa_stations where id = m.station_id;
  insert into public.pp_archive (kind, summary, snapshot, reason, archived_by, actor_role, notify)
  values ('movement',
          format('%s · %s P-P · %s%s · %s', m.kind, trim_scale(m.pipas), m.product, coalesce(' · ' || v_st, ''), m.occurred_on),
          to_jsonb(m) || jsonb_build_object('station_name', v_st),
          btrim(p_reason), lower(auth.jwt() ->> 'email'), v_role, v_role <> 'ceo');
  perform public.pp_unapply_movement(m.id);
  delete from public.pipa_movements where id = m.id;
end;
$$;
revoke all on function public.archive_pp_movement(uuid, text) from public, anon;
grant execute on function public.archive_pp_movement(uuid, text) to authenticated;

-- Recent shifts for the "Deduct shift sales" list: litres per fuel for
-- everyone; the money only for owners. changed = edited since it was deducted.
drop function if exists public.shifts_for_deduction(integer);
create function public.shifts_for_deduction(p_limit integer default 100)
returns table (id uuid, shift_at timestamptz, employee_name text, liters jsonb, amounts jsonb, deducted boolean, changed boolean, auto boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_role text := public.pp_require_role();
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
  order by s."timestamp" desc
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;
revoke all on function public.shifts_for_deduction(integer) from public, anon;
grant execute on function public.shifts_for_deduction(integer) to authenticated;

-- Deduct the chosen shifts (oldest first), each on its own.
drop function if exists public.record_shift_usage(jsonb, numeric);
drop function if exists public.record_shift_usage(uuid[]);
create function public.record_shift_usage(p_shift_ids uuid[])
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_role text := public.pp_require_role();
  v_n    integer := 0;
  v_id   uuid;
begin
  if p_shift_ids is null or cardinality(p_shift_ids) = 0 then raise exception 'No shifts selected'; end if;
  for v_id in select s.id from public.daily_sales_reports s where s.id = any(p_shift_ids) order by s."timestamp" loop
    perform public.pp_deduct_shift(v_id, false, lower(auth.jwt() ->> 'email'));
    v_n := v_n + 1;
  end loop;
  if v_n <> (select count(distinct x) from unnest(p_shift_ids) x) then raise exception 'Unknown shift' using errcode = '23503'; end if;
  return v_n;
end;
$$;
revoke all on function public.record_shift_usage(uuid[]) from public, anon;
grant execute on function public.record_shift_usage(uuid[]) to authenticated;

create or replace function public.undo_shift_deduction(p_shift_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_role text := public.pp_require_role();
begin
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Write why this is being undone' using errcode = '22023'; end if;
  if not public.pp_archive_shift(p_shift_id, p_reason, v_role <> 'ceo') then
    raise exception 'This shift isn''t deducted' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.undo_shift_deduction(uuid, text) from public, anon;
grant execute on function public.undo_shift_deduction(uuid, text) to authenticated;

-- A shift edited after it was deducted: take it off again with the new figures.
create or replace function public.rededuct_shift(p_shift_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_role text := public.pp_require_role();
begin
  if not public.pp_archive_shift(p_shift_id, 'Shift changed after it was deducted — deducted again with the new figures', false) then
    raise exception 'This shift isn''t deducted' using errcode = 'P0002';
  end if;
  perform public.pp_deduct_shift(p_shift_id, false, lower(auth.jwt() ->> 'email'));
end;
$$;
revoke all on function public.rededuct_shift(uuid) from public, anon;
grant execute on function public.rededuct_shift(uuid) to authenticated;

-- ── Profit (owners only) ─────────────────────────────────────────────────────
-- profit = shift sales − cost of the litres sold
--        + cash received for lent P-P − what those litres cost
--        − (what returning / paying for borrowed P-P cost − what it was costed at)
--        − stock-count shortages − fuel used (not sold)
create or replace function public.pp_profit_calc(p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = ''
as $$
  with x as (
    select occurred_on as day, product,
      case when kind in ('sale', 'lend_paid') then coalesce(amount, 0) else 0 end as revenue,
      case when kind = 'sale' then coalesce(cost, 0) when kind = 'lend_paid' then coalesce(ref_cost, 0) else 0 end as cogs,
      case when kind = 'borrow_return' then coalesce(cost, 0) - coalesce(ref_cost, 0)
           when kind = 'borrow_paid' then coalesce(amount, 0) - coalesce(ref_cost, 0) else 0 end as settle,
      case when kind = 'count_loss' then coalesce(cost, 0) else 0 end as loss,
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
    'days', coalesce((select jsonb_agg(to_jsonb(d) order by d.day) from (
        select day, sum(sold) as liters, sum(revenue) as revenue, sum(cogs) as cost,
               sum(revenue - cogs - settle - loss - used) as profit
        from x group by day) d), '[]'::jsonb)
  )
$$;

create or replace function public.pp_profit(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if public.current_app_role() is distinct from 'ceo' then
    raise exception 'Only an owner can see profit' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Choose a date range'; end if;
  if p_to - p_from > 3660 then raise exception 'Choose at most 10 years'; end if;
  return public.pp_profit_calc(p_from, p_to);
end;
$$;
revoke all on function public.pp_profit(date, date) from public, anon;
grant execute on function public.pp_profit(date, date) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. Automatic: new shifts deducted, edited shifts re-deducted, deleted shifts
--    put back. Never blocks saving a shift — a problem only leaves a warning.
-- ═════════════════════════════════════════════════════════════════════════════
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
drop trigger if exists pp_shift_auto on public.daily_sales_reports;
create trigger pp_shift_auto after insert or update on public.daily_sales_reports
  for each row execute function public.pp_shift_changed();
drop trigger if exists pp_shift_deleted on public.daily_sales_reports;
create trigger pp_shift_deleted before delete on public.daily_sales_reports
  for each row execute function public.pp_shift_changed();

-- Owners hear about deletions on Telegram.
create or replace function public.pp_archive_notify()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.notify then
    begin
      perform net.http_post(
        url                  := 'https://ryubjollofribrvrwqtz.supabase.co/functions/v1/pp-telegram-notify',
        body                 := jsonb_build_object('event', 'archived', 'id', new.id),
        headers              := jsonb_build_object('Content-Type', 'application/json'),
        timeout_milliseconds := 10000
      );
    exception when others then
      raise warning 'pp_archive_notify failed for %: % (%)', new.id, sqlerrm, sqlstate;
    end;
  end if;
  return new;
end;
$$;
drop trigger if exists pp_archive_notify on public.pp_archive;
create trigger pp_archive_notify after insert on public.pp_archive
  for each row execute function public.pp_archive_notify();

-- ═════════════════════════════════════════════════════════════════════════════
-- 6. Who may call what
-- ═════════════════════════════════════════════════════════════════════════════
revoke all on function public.pp_num(jsonb), public.pp_shift_sales(jsonb, numeric), public.pp_latest_cost(text),
  public.pp_holding(uuid, text, text), public.pp_holding_rate(uuid, text, text),
  public.pp_take(text, numeric, text, numeric, numeric, uuid, uuid, uuid, uuid, date, text),
  public.pp_restore_lines(uuid, uuid), public.pp_drop_lot(uuid), public.pp_apply_movement(uuid), public.pp_unapply_movement(uuid),
  public.pp_shift_figures(uuid), public.pp_deduct_shift(uuid, boolean, text), public.pp_undo_shift(uuid),
  public.pp_archive_shift(uuid, text, boolean), public.pp_require_role(), public.pp_pp_liters(),
  public.pp_profit_calc(date, date), public.pp_shift_changed(), public.pp_archive_notify(), public.pp_settings_stamp()
  from public, anon, authenticated;
grant execute on function public.pp_profit_calc(date, date) to service_role;   -- the Telegram report

-- ═════════════════════════════════════════════════════════════════════════════
-- 7. Retire the PO Registry: its functions, and its data (as asked)
-- ═════════════════════════════════════════════════════════════════════════════
drop function if exists public.record_po_shift_usage(jsonb);
drop function if exists public.undo_po_shift_usage(uuid);
drop function if exists public.undo_pipa_shift_usage(uuid);
drop function if exists public.record_pipa_shift_usage(uuid[], jsonb, numeric);
drop function if exists public.undo_shift_usage(uuid);
drop function if exists public.record_pipa_buy(jsonb, boolean);
drop function if exists public.next_po_batch_name();
update public.pipa_movements set po_id = null where po_id is not null;
delete from public.po_usage;
delete from public.po_shift_deductions;
delete from public.fuel_purchase_orders;

-- ═════════════════════════════════════════════════════════════════════════════
-- 8. Bring existing P-P lines and shift deductions into the new records (once)
-- ═════════════════════════════════════════════════════════════════════════════
do $$
declare
  r      record;
  v_redo uuid[] := '{}';
begin
  -- Old-style shift deductions (from before this engine): taken off here, deducted again below.
  for r in select shift_id, batch_id from public.pipa_shift_deductions where liters is null loop
    delete from public.pipa_movements where shift_batch_id = r.batch_id;
    delete from public.pipa_shift_deductions where shift_id = r.shift_id;
    v_redo := v_redo || r.shift_id;
  end loop;
  -- P-P lines and those shifts, in date order.
  for r in
    select 'movement' as what, m.id, m.occurred_on as on_day, m.created_at as at from public.pipa_movements m
     where m.shift_batch_id is null
       and not exists (select 1 from public.pp_lots l where l.movement_id = m.id)
       and not exists (select 1 from public.pp_cost_lines c where c.movement_id = m.id)
    union all
    select 'shift', s.id, (s."timestamp" at time zone 'Asia/Yangon')::date, s."timestamp" from public.daily_sales_reports s
     where s.id = any(v_redo)
    order by 3, 4
  loop
    if r.what = 'movement' then
      perform public.pp_apply_movement(r.id);
    else
      perform public.pp_deduct_shift(r.id, false, 'migration');
    end if;
  end loop;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 9. Weekly / monthly profit report (optional — needs pg_cron; skipped if not
--    available). Runs every day at 08:30 Yangon; the function decides whether
--    a report is due from Settings.
-- ═════════════════════════════════════════════════════════════════════════════
do $$
begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'pg_cron is not available here, so the Telegram profit report is off: %', sqlerrm;
end $$;
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('stm-profit-report', '0 2 * * *',
      $cron$ select net.http_post(
               url := 'https://ryubjollofribrvrwqtz.supabase.co/functions/v1/pp-telegram-notify',
               body := '{"event":"profit_report"}'::jsonb,
               headers := '{"Content-Type":"application/json"}'::jsonb) $cron$);
  end if;
exception when others then
  raise notice 'Could not schedule the profit report: %', sqlerrm;
end $$;
