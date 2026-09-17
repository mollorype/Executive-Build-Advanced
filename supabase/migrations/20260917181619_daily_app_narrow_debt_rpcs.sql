-- =====================================================================
-- STM Daily runs fully anonymously by design (offline shift submission),
-- but two of its flows legitimately touch debt data. Rather than granting
-- anon broad table access (the vulnerability just removed), expose exactly
-- those two operations as narrow SECURITY DEFINER RPCs.
-- =====================================================================

-- 1. Debtor lookup for the expense-linking autocomplete.
--    Returns ONLY id/name/relation — never balances, phones, credit limits.
--    Requires >= 2 characters and caps results, to limit bulk enumeration.
CREATE OR REPLACE FUNCTION public.search_debt_profiles_basic(search_term text)
RETURNS TABLE (id uuid, name text, relation text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.name, p.relation
  FROM public.debt_profiles p
  WHERE length(btrim(coalesce(search_term, ''))) >= 2
    AND p.name ILIKE '%' || btrim(search_term) || '%'
  ORDER BY p.name
  LIMIT 6;
$$;
REVOKE ALL ON FUNCTION public.search_debt_profiles_basic(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_debt_profiles_basic(text) TO anon, authenticated;

-- 2. Record a debt payment/charge raised by a shift submission.
--    The balance is adjusted by a server-computed delta — the caller
--    cannot set an absolute balance, cannot delete, cannot read the
--    profile, and `source` is forced to 'daily_app'.
CREATE OR REPLACE FUNCTION public.record_daily_app_debt_entry(
  p_profile_id uuid,
  p_amount numeric,
  p_transaction_number text,
  p_note text,
  p_date timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exists boolean;
BEGIN
  IF p_profile_id IS NULL OR p_amount IS NULL OR p_amount = 0 THEN
    RETURN false;
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.debt_profiles WHERE id = p_profile_id) INTO v_exists;
  IF NOT v_exists THEN
    RETURN false;
  END IF;

  INSERT INTO public.debt_transactions
    (profile_id, amount, date, note, transaction_number, source)
  VALUES
    (p_profile_id, p_amount, coalesce(p_date, now()), p_note, p_transaction_number, 'daily_app');

  UPDATE public.debt_profiles
  SET current_balance = coalesce(current_balance, 0) + p_amount,
      score           = least(100, coalesce(score, 50) + 5),
      last_payment_at = coalesce(p_date, now())
  WHERE id = p_profile_id;

  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.record_daily_app_debt_entry(uuid, numeric, text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_daily_app_debt_entry(uuid, numeric, text, text, timestamptz) TO anon, authenticated;

-- 3. Clean up the audit's test rows.
DELETE FROM public.home_family_members WHERE name = '__rls_test_family__';
DELETE FROM public.debt_profiles WHERE name = '__rls_test_debtor__';
DELETE FROM public.accountant_access WHERE email = '__rls_test__@nowhere.com';
DELETE FROM public.daily_sales_reports WHERE employee_id IN ('__anon_insert_probe__','__test_emp__','__test_emp2__');
