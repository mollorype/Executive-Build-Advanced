-- Per purchase (lot): litres sold, litres gone otherwise (lent, shortage,
-- used), and the money / cost of what was sold — for the stock view on the
-- owner's Profit page. A security-invoker view, so the owner-only rules on
-- pp_lots and pp_cost_lines apply: everyone else gets no rows.
-- Needs 20261122120000_pp_profit_engine. Safe to run more than once.

create or replace view public.pp_lot_stats with (security_invoker = true) as
select l.id as lot_id,
       coalesce(sum(c.liters) filter (where c.kind = 'sale'), 0)   as sold_liters,
       coalesce(sum(c.liters) filter (where c.kind <> 'sale'), 0)  as other_liters,
       coalesce(sum(c.amount) filter (where c.kind = 'sale'), 0)   as revenue,
       coalesce(sum(c.cost) filter (where c.kind = 'sale'), 0)     as cost
from public.pp_lots l
left join public.pp_cost_lines c on c.lot_id = l.id
group by l.id;

revoke all on public.pp_lot_stats from anon, authenticated;
grant select on public.pp_lot_stats to authenticated;
