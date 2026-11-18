-- =====================================================================
-- Pipa Ledger — the station stores fuel in pipas (215 L drums), not an
-- underground tank. Track pipas bought, borrowed and lent, by station.
--
-- Stock on hand and per-station balances are always calculated from
-- pipa_movements; nothing is typed in as a running total.
-- CEO-only, like the PO Registry.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Stations we buy from, borrow from or lend to.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pipa_stations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL CHECK (btrim(name) <> ''),
  phone      text,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 2. Every pipa movement. Effect on stock / station balance by kind:
--      buy              stock +   (price required)
--      borrow           stock +   we owe the station
--      borrow_returned  stock −   we owe less
--      borrow_paid      —         we owe less (settled in cash; price required)
--      lend             stock −   the station owes us
--      lend_returned    stock +   they owe less
--      lend_paid        —         they owe less (settled in cash; price required)
--      used             stock −   (sold / used; no station)
--      adjust           ± pipas   (stock count correction or opening stock; no station)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pipa_movements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  occurred_on     date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Yangon')::date,
  kind            text NOT NULL CHECK (kind IN ('buy','borrow','borrow_returned','borrow_paid',
                                                'lend','lend_returned','lend_paid','used','adjust')),
  station_id      uuid REFERENCES public.pipa_stations(id) ON DELETE RESTRICT,
  product         text NOT NULL CHECK (product IN ('92','95','PD','D')),
  pipas           numeric(12,3) NOT NULL,
  liters_per_pipa numeric(8,2) NOT NULL DEFAULT 215 CHECK (liters_per_pipa > 0),
  price_mode      text CHECK (price_mode IN ('per_pipa','per_liter')),
  unit_price      numeric(14,2) CHECK (unit_price >= 0),
  total_amount    numeric(16,2),
  note            text,
  po_id           uuid REFERENCES public.fuel_purchase_orders(id) ON DELETE SET NULL,
  shift_batch_id  uuid,   -- set on 'used' rows created by record_pipa_shift_usage()
  CONSTRAINT pipa_movements_pipas_sign CHECK (
    (kind = 'adjust' AND pipas <> 0) OR (kind <> 'adjust' AND pipas > 0)),
  CONSTRAINT pipa_movements_station_required CHECK (
    (kind IN ('used','adjust')) = (station_id IS NULL)),
  CONSTRAINT pipa_movements_price_required CHECK (
    kind NOT IN ('buy','borrow_paid','lend_paid') OR (price_mode IS NOT NULL AND unit_price IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS pipa_movements_station_idx ON public.pipa_movements (station_id);
CREATE INDEX IF NOT EXISTS pipa_movements_occurred_idx ON public.pipa_movements (occurred_on DESC, created_at DESC);

-- ---------------------------------------------------------------------
-- 3. Which shifts have been deducted from stock — the primary key makes
--    deducting the same shift twice impossible.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pipa_shift_deductions (
  shift_id    uuid PRIMARY KEY REFERENCES public.daily_sales_reports(id) ON DELETE CASCADE,
  batch_id    uuid NOT NULL,
  deducted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pipa_shift_deductions_batch_idx ON public.pipa_shift_deductions (batch_id);

-- ---------------------------------------------------------------------
-- 4. CEO-only access, through the same trusted role check as everything else.
-- ---------------------------------------------------------------------
ALTER TABLE public.pipa_stations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipa_movements         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipa_shift_deductions  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pipa_stations, public.pipa_movements, public.pipa_shift_deductions FROM anon;

DROP POLICY IF EXISTS "ceo_manage" ON public.pipa_stations;
CREATE POLICY "ceo_manage" ON public.pipa_stations FOR ALL TO authenticated
  USING (public.current_app_role() = 'ceo') WITH CHECK (public.current_app_role() = 'ceo');
DROP POLICY IF EXISTS "ceo_manage" ON public.pipa_movements;
CREATE POLICY "ceo_manage" ON public.pipa_movements FOR ALL TO authenticated
  USING (public.current_app_role() = 'ceo') WITH CHECK (public.current_app_role() = 'ceo');
DROP POLICY IF EXISTS "ceo_manage" ON public.pipa_shift_deductions;
CREATE POLICY "ceo_manage" ON public.pipa_shift_deductions FOR ALL TO authenticated
  USING (public.current_app_role() = 'ceo') WITH CHECK (public.current_app_role() = 'ceo');

-- ---------------------------------------------------------------------
-- 5. "Deduct shift sales" — never automatic; run only when the CEO presses
--    the button. All-or-nothing: if any selected shift was already deducted,
--    the primary key on pipa_shift_deductions rolls the whole call back.
--    SECURITY INVOKER, so the CEO-only RLS above applies to every insert.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_pipa_shift_usage(
  p_shift_ids uuid[], p_liters jsonb, p_liters_per_pipa numeric DEFAULT 215
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_batch   uuid := gen_random_uuid();
  v_product text;
  v_liters  numeric;
  v_shifts  int := coalesce(array_length(p_shift_ids, 1), 0);
BEGIN
  IF public.current_app_role() IS DISTINCT FROM 'ceo' THEN
    RAISE EXCEPTION 'Only the CEO can deduct shift sales' USING ERRCODE = '42501';
  END IF;
  IF v_shifts = 0 THEN
    RAISE EXCEPTION 'No shifts selected';
  END IF;
  IF p_liters_per_pipa IS NULL OR p_liters_per_pipa <= 0 THEN
    RAISE EXCEPTION 'Pipa size must be positive';
  END IF;

  INSERT INTO public.pipa_shift_deductions (shift_id, batch_id)
  SELECT unnest(p_shift_ids), v_batch;

  FOR v_product, v_liters IN SELECT key, value::numeric FROM jsonb_each_text(p_liters) LOOP
    IF v_product NOT IN ('92','95','PD','D') THEN
      RAISE EXCEPTION 'Unknown product %', v_product;
    END IF;
    IF v_liters > 0 THEN
      INSERT INTO public.pipa_movements (kind, product, pipas, liters_per_pipa, note, shift_batch_id)
      VALUES ('used', v_product, round(v_liters / p_liters_per_pipa, 3), p_liters_per_pipa,
              format('Shift sales: %s L from %s shift(s)', round(v_liters, 2), v_shifts), v_batch);
    END IF;
  END LOOP;

  RETURN v_batch;
END;
$$;
REVOKE ALL ON FUNCTION public.record_pipa_shift_usage(uuid[], jsonb, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_pipa_shift_usage(uuid[], jsonb, numeric) TO authenticated;

-- Undo a shift deduction as a unit: its movements go, and its shifts become
-- deductible again.
CREATE OR REPLACE FUNCTION public.undo_pipa_shift_usage(p_batch uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_shifts integer;
BEGIN
  IF public.current_app_role() IS DISTINCT FROM 'ceo' THEN
    RAISE EXCEPTION 'Only the CEO can undo a shift deduction' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.pipa_movements WHERE shift_batch_id = p_batch;
  DELETE FROM public.pipa_shift_deductions WHERE batch_id = p_batch;
  GET DIAGNOSTICS v_shifts = ROW_COUNT;
  RETURN v_shifts;
END;
$$;
REVOKE ALL ON FUNCTION public.undo_pipa_shift_usage(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_pipa_shift_usage(uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 6. Opening stock: carry over the old hand-typed "Pipa Remaining" numbers
--    as count corrections, once (only while the ledger is still empty).
--    pipa_stock itself is left untouched.
-- ---------------------------------------------------------------------
INSERT INTO public.pipa_movements (kind, product, pipas, note)
SELECT 'adjust', s.product_type, s.remaining_containers,
       'Opening stock, carried over from the old Pipa Remaining card'
         || coalesce(' · ' || nullif(btrim(s.wholesale_assignment), ''), '')
FROM public.pipa_stock s
WHERE s.remaining_containers <> 0
  AND s.product_type IN ('92','95','PD','D')
  AND NOT EXISTS (SELECT 1 FROM public.pipa_movements);
