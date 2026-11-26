-- 009 was actually executed and is frozen. Preserve its first failure evidence.
-- These existing triggers only invalidate dependent reviews/presentation sessions
-- when their source project changes. Keep the exact baseline bodies and fixed
-- schema search_path, and do not grant API/worker access to unported tables.
ALTER FUNCTION dg_trigger_4033f3a1e4074dfea8a74a26() SECURITY DEFINER;
ALTER FUNCTION dg_trigger_6d493d8694c95164f52f50d5() SECURITY DEFINER;
REVOKE ALL ON FUNCTION dg_trigger_4033f3a1e4074dfea8a74a26() FROM PUBLIC;
REVOKE ALL ON FUNCTION dg_trigger_6d493d8694c95164f52f50d5() FROM PUBLIC;
