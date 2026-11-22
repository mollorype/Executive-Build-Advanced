-- P-P: every purchase stands on its own.
--
-- Under each fuel, every purchase (a Big PO, P-P bought from a station,
-- borrowed P-P, stock found in a count) is kept apart — never mixed with
-- another. Shift sales still come off the oldest purchase first, at its price.
-- Force close works on one purchase: what's left in it is written off.
--
-- (Internally each purchase gets its own row in pp_pools, so closing,
-- re-opening and the Telegram notice keep working as before.)
--
-- Needs 20261122260000_pp_price_optional. Safe to run more than once.

-- New purchases: each one on its own.
create or replace function public.pp_pool_for(p_product text, p_source text, p_on date)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v uuid;
begin
  insert into public.pp_pools (product, started_on) values (p_product, p_on) returning id into v;
  return v;
end;
$$;
revoke all on function public.pp_pool_for(text, text, date) from public, anon, authenticated;

-- Purchases that were grouped together: the oldest keeps its row, every other
-- one gets its own. A closed group stays closed (same reason and close line),
-- so deleting that close line still opens all of them again.
do $$
declare l record; v uuid;
begin
  for l in
    select x.id, x.occurred_on, x.pool_id from (
      select lt.id, lt.occurred_on, lt.pool_id,
             row_number() over (partition by lt.pool_id order by lt.occurred_on, lt.created_at, lt.id) as n
        from public.pp_lots lt where lt.pool_id is not null) x
     where x.n > 1
     order by x.pool_id, x.n
  loop
    insert into public.pp_pools (product, started_on, closed_at, closed_by, close_reason, close_note, close_movement_id, notified_at)
    select p.product, l.occurred_on, p.closed_at, p.closed_by, p.close_reason, p.close_note, p.close_movement_id, p.notified_at
      from public.pp_pools p where p.id = l.pool_id
    returning id into v;
    update public.pp_lots set pool_id = v where id = l.id;
  end loop;
end $$;

-- The stock detail: purchases still holding fuel, oldest first, and (owners)
-- any purchase still waiting for its price. Cost per litre for owners only.
create or replace function public.pp_pools(p_days integer default 60)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_role  text := public.pp_require_role();
  v_owner boolean := v_role = 'ceo';
begin
  return jsonb_build_object(
    'pp_liters', public.pp_pp_liters(),
    'short', coalesce((select jsonb_object_agg(product, l) from (
        select product, sum(liters) as l from public.pp_cost_lines
         where lot_id is null and kind in ('sale', 'lend', 'borrow_return', 'count_loss', 'used') group by product) s), '{}'::jsonb),
    'pools', coalesce((select jsonb_agg(x order by x.product, x.started_on desc, x.created_at desc) from (
        select p.id, p.product, p.started_on, p.created_at, p.closed_at, p.closed_by, p.close_reason, p.close_note,
               coalesce((select jsonb_agg(jsonb_build_object(
                          'source', l.source, 'on', l.occurred_on, 'at', l.created_at, 'liters', l.liters, 'remaining', l.remaining,
                          'written', coalesce((select sum(c.liters) from public.pp_cost_lines c where c.lot_id = l.id and c.kind = 'write_off'), 0),
                          'station', s.name,
                          'priced', l.cost_per_liter is not null,
                          'movement', case when v_owner then l.movement_id end,
                          'price', case when v_owner then l.price_per_liter end,
                          'fees', case when v_owner then l.fees_per_liter end,
                          'cost', case when v_owner then l.cost_per_liter end)
                        order by l.occurred_on, l.created_at, l.id)
                         from public.pp_lots l
                         left join public.pipa_stations s on s.id = l.station_id
                        where l.pool_id = p.id), '[]'::jsonb) as lots
          from public.pp_pools p
         where (p.closed_at is null and exists (select 1 from public.pp_lots l where l.pool_id = p.id and l.remaining > 0.0005))
            or (v_owner and exists (select 1 from public.pp_lots l where l.pool_id = p.id and l.cost_per_liter is null
                                     and l.source in ('official', 'shop', 'count_gain', 'opening')))
         order by p.started_on desc limit 500) x), '[]'::jsonb));
end;
$$;
revoke all on function public.pp_pools(integer) from public, anon;
grant execute on function public.pp_pools(integer) to authenticated;
