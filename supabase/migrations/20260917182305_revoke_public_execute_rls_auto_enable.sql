-- The remaining EXECUTE came from the implicit PUBLIC grant, which every role
-- inherits. Event-trigger functions run as their owner when the trigger fires,
-- so removing the RPC-facing grant does not affect the trigger itself.
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
