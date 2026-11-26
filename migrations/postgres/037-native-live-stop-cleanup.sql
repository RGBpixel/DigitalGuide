-- R-058/R-093. 036 is applied and frozen. Stop keeps dependent invitations closed.
-- The existing trigger is restricted to NEW.id; callers get no direct peer-table rights.
ALTER FUNCTION dg_trigger_46ee32b28b8abe91b1a7006c() SECURITY DEFINER;
REVOKE ALL ON FUNCTION dg_trigger_46ee32b28b8abe91b1a7006c() FROM PUBLIC;
