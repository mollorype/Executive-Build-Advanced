-- P-P purchases go straight into the PO Registry as an ACTIVE batch, named in
-- order: Batch 1, Batch 2, Batch 3… (the next number after the highest
-- "Batch N" so far). The PO Registry's "New PO" form offers the same next name.
-- Needs 20261122090000_manager_shared_pp_po. Safe to run more than once.

-- The next free "Batch N" name. Owners, accountants and managers only.
create or replace function public.next_po_batch_name()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.current_app_role() in ('ceo', 'accountant', 'manager') then
    'Batch ' || (coalesce(max((substring(f.name from '^\s*[Bb][Aa][Tt][Cc][Hh]\s*([0-9]{1,9})\s*$'))::bigint), 0) + 1)
  end
  from public.fuel_purchase_orders f;
$$;
revoke all on function public.next_po_batch_name() from public, anon;
grant execute on function public.next_po_batch_name() to authenticated;

-- Same as before, except the PO is ACTIVE (in use now) and gets the next batch name.
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
    -- One purchase at a time picks the next number, so two at once can't both get "Batch 5".
    perform pg_advisory_xact_lock(hashtext('stm_po_batch_name'));
    insert into public.fuel_purchase_orders (name, product_type, status, initial_volume, remaining_volume,
                                             calibration_factor, wholesale_price, is_verified, total_volume_sold)
    values (public.next_po_batch_name(), v_product, 'ACTIVE', v_liters, v_liters, 1, v_per_l, false, 0)
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
