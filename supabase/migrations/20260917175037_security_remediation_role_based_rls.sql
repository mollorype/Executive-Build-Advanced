-- =====================================================================
-- Security remediation: trusted server-side role resolution + RLS fixes
--
-- Closes: anonymous full CRUD on debt_profiles/debt_transactions and the
-- employee_salary_* tables, anonymous UPDATE on daily_sales_reports,
-- unnecessary anon SELECT on private tables, and the privilege-escalation
-- path where any authenticated user defaulted to the CEO role.
-- =====================================================================

-- 1. Trusted CEO allowlist, locked down completely at the RLS level —
--    accessible only via the SECURITY DEFINER helper function below.
CREATE TABLE IF NOT EXISTS public.ceo_access (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.ceo_access ENABLE ROW LEVEL SECURITY;
-- No policies added: RLS enabled + zero policies = deny-all for every
-- role, including authenticated. Only SECURITY DEFINER functions
-- (running as the table owner) can read it.

INSERT INTO public.ceo_access (email)
VALUES ('jooeryuio@gmail.com')
ON CONFLICT (email) DO NOTHING;

-- 2. Trusted, server-side role resolution. auth.jwt() is populated by
--    PostgREST only after verifying the Supabase-signed JWT signature —
--    a client cannot forge this. Deny-by-default: NULL unless listed.
CREATE OR REPLACE FUNCTION public.current_app_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.jwt() ->> 'email' IS NULL THEN NULL
    WHEN EXISTS (
      SELECT 1 FROM public.ceo_access WHERE email = lower(auth.jwt() ->> 'email')
    ) THEN 'ceo'
    WHEN EXISTS (
      SELECT 1 FROM public.accountant_access WHERE email = lower(auth.jwt() ->> 'email')
    ) THEN 'accountant'
    ELSE NULL
  END;
$$;
REVOKE ALL ON FUNCTION public.current_app_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_app_role() TO authenticated;

-- 3. Narrow, anon-callable pre-check RPCs replacing direct anon SELECT
--    on the allowlist tables (which let anyone dump the full email list).
CREATE OR REPLACE FUNCTION public.is_accountant_allowed(check_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.accountant_access WHERE email = lower(check_email));
$$;
REVOKE ALL ON FUNCTION public.is_accountant_allowed(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_accountant_allowed(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_employee_allowed(check_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.allowed_employees WHERE email = lower(check_email));
$$;
REVOKE ALL ON FUNCTION public.is_employee_allowed(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_employee_allowed(text) TO anon, authenticated;

-- =====================================================================
-- 4. debt_profiles / debt_transactions — drop public-ALL, scope to
--    ceo+accountant (Debt Tracker is accessible to both roles).
-- =====================================================================
DROP POLICY IF EXISTS "debt_profiles_all" ON public.debt_profiles;
CREATE POLICY "ceo_accountant_manage" ON public.debt_profiles
  FOR ALL TO authenticated
  USING (public.current_app_role() IN ('ceo','accountant'))
  WITH CHECK (public.current_app_role() IN ('ceo','accountant'));

DROP POLICY IF EXISTS "debt_transactions_all" ON public.debt_transactions;
CREATE POLICY "ceo_accountant_manage" ON public.debt_transactions
  FOR ALL TO authenticated
  USING (public.current_app_role() IN ('ceo','accountant'))
  WITH CHECK (public.current_app_role() IN ('ceo','accountant'));

-- =====================================================================
-- 5. employee_salary_items / employee_salary_pool — same scope (FK'd
--    to debt_profiles employee records).
-- =====================================================================
DROP POLICY IF EXISTS "allow_all" ON public.employee_salary_items;
CREATE POLICY "ceo_accountant_manage" ON public.employee_salary_items
  FOR ALL TO authenticated
  USING (public.current_app_role() IN ('ceo','accountant'))
  WITH CHECK (public.current_app_role() IN ('ceo','accountant'));

DROP POLICY IF EXISTS "allow_all" ON public.employee_salary_pool;
CREATE POLICY "ceo_accountant_manage" ON public.employee_salary_pool
  FOR ALL TO authenticated
  USING (public.current_app_role() IN ('ceo','accountant'))
  WITH CHECK (public.current_app_role() IN ('ceo','accountant'));

-- =====================================================================
-- 6. daily_sales_reports — drop the anonymous-UPDATE hole and dedupe
--    anon-insert policies. Anonymous INSERT is preserved (STM Daily's
--    intentional offline-submission design). Read/update/delete/
--    authenticated-insert scoped to CEO only (/shifts is CEO-only).
-- =====================================================================
DROP POLICY IF EXISTS "allow_update" ON public.daily_sales_reports;
DROP POLICY IF EXISTS "Allow anonymous insert" ON public.daily_sales_reports;
DROP POLICY IF EXISTS "Auth read reports" ON public.daily_sales_reports;
DROP POLICY IF EXISTS "Allow delete on daily_sales_reports" ON public.daily_sales_reports;
DROP POLICY IF EXISTS "Auth insert reports" ON public.daily_sales_reports;
-- "Anon insert reports" (anon, INSERT, with_check true) is left as the
-- single anonymous-insert policy — required by the offline submission flow.

CREATE POLICY "ceo_read" ON public.daily_sales_reports
  FOR SELECT TO authenticated
  USING (public.current_app_role() = 'ceo');

CREATE POLICY "ceo_insert" ON public.daily_sales_reports
  FOR INSERT TO authenticated
  WITH CHECK (public.current_app_role() = 'ceo');

CREATE POLICY "ceo_update" ON public.daily_sales_reports
  FOR UPDATE TO authenticated
  USING (public.current_app_role() = 'ceo')
  WITH CHECK (public.current_app_role() = 'ceo');

CREATE POLICY "ceo_delete" ON public.daily_sales_reports
  FOR DELETE TO authenticated
  USING (public.current_app_role() = 'ceo');

-- =====================================================================
-- 7. fuel_purchase_orders / pipa_stock — CEO-only (PO Registry page).
-- =====================================================================
DROP POLICY IF EXISTS "Auth read POs" ON public.fuel_purchase_orders;
DROP POLICY IF EXISTS "Auth insert POs" ON public.fuel_purchase_orders;
DROP POLICY IF EXISTS "Auth update POs" ON public.fuel_purchase_orders;
DROP POLICY IF EXISTS "Allow delete on fuel_purchase_orders" ON public.fuel_purchase_orders;
CREATE POLICY "ceo_manage" ON public.fuel_purchase_orders
  FOR ALL TO authenticated
  USING (public.current_app_role() = 'ceo')
  WITH CHECK (public.current_app_role() = 'ceo');

DROP POLICY IF EXISTS "anon_read" ON public.pipa_stock;
DROP POLICY IF EXISTS "auth_manage" ON public.pipa_stock;
CREATE POLICY "ceo_manage" ON public.pipa_stock
  FOR ALL TO authenticated
  USING (public.current_app_role() = 'ceo')
  WITH CHECK (public.current_app_role() = 'ceo');

-- =====================================================================
-- 8. Home / I-C ledger tables — CEO-only personal finance. Drop anon
--    read entirely.
-- =====================================================================
DROP POLICY IF EXISTS "anon_read" ON public.home_family_members;
DROP POLICY IF EXISTS "auth_manage" ON public.home_family_members;
CREATE POLICY "ceo_manage" ON public.home_family_members
  FOR ALL TO authenticated
  USING (public.current_app_role() = 'ceo')
  WITH CHECK (public.current_app_role() = 'ceo');

DROP POLICY IF EXISTS "anon_read" ON public.home_expenses;
DROP POLICY IF EXISTS "auth_manage" ON public.home_expenses;
CREATE POLICY "ceo_manage" ON public.home_expenses
  FOR ALL TO authenticated
  USING (public.current_app_role() = 'ceo')
  WITH CHECK (public.current_app_role() = 'ceo');

DROP POLICY IF EXISTS "anon_read" ON public.home_ic_ledger;
DROP POLICY IF EXISTS "auth_manage" ON public.home_ic_ledger;
CREATE POLICY "ceo_manage" ON public.home_ic_ledger
  FOR ALL TO authenticated
  USING (public.current_app_role() = 'ceo')
  WITH CHECK (public.current_app_role() = 'ceo');

DROP POLICY IF EXISTS "anon_read" ON public.home_income_entries;
DROP POLICY IF EXISTS "auth_manage" ON public.home_income_entries;
CREATE POLICY "ceo_manage" ON public.home_income_entries
  FOR ALL TO authenticated
  USING (public.current_app_role() = 'ceo')
  WITH CHECK (public.current_app_role() = 'ceo');

-- =====================================================================
-- 9. accountant_access / allowed_employees — drop anon SELECT (full
--    list dump), management restricted to CEO only. Pre-auth "is this
--    email allowed" checks now go through the narrow RPCs above.
-- =====================================================================
DROP POLICY IF EXISTS "anon_read" ON public.accountant_access;
DROP POLICY IF EXISTS "auth_manage" ON public.accountant_access;
CREATE POLICY "ceo_manage" ON public.accountant_access
  FOR ALL TO authenticated
  USING (public.current_app_role() = 'ceo')
  WITH CHECK (public.current_app_role() = 'ceo');

DROP POLICY IF EXISTS "anon_read" ON public.allowed_employees;
DROP POLICY IF EXISTS "auth_manage" ON public.allowed_employees;
CREATE POLICY "ceo_manage" ON public.allowed_employees
  FOR ALL TO authenticated
  USING (public.current_app_role() = 'ceo')
  WITH CHECK (public.current_app_role() = 'ceo');
