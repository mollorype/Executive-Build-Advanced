-- Supabase's default privileges grant EXECUTE on new public-schema functions
-- to anon/authenticated, so REVOKE ... FROM PUBLIC alone is not sufficient.
-- Revoke from the named roles explicitly.

-- Role resolution is only meaningful for a signed-in caller (anon has no JWT
-- email and would always get NULL) — keep it off the anonymous surface.
REVOKE EXECUTE ON FUNCTION public.current_app_role() FROM anon;

-- Pre-existing Supabase event-trigger helper: it is only ever invoked by the
-- DDL event trigger (which runs as its owner, unaffected by EXECUTE grants),
-- so it has no reason to be reachable as a REST RPC.
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon, authenticated;

-- The four functions below stay deliberately anon-executable: STM Daily is
-- anonymous by design and these are the narrow, audited operations it needs.
--   is_accountant_allowed       -> yes/no for one email (pre-signup UX gate)
--   is_employee_allowed         -> yes/no for one email (daily app login gate)
--   search_debt_profiles_basic  -> id/name/relation only, min 2 chars, max 6 rows
--   record_daily_app_debt_entry -> forced source, server-computed balance delta
