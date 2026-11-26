-- Applied038 remains frozen. Existing dependent cleanup stays confined to NEW.session_id / NEW.id.
-- API and worker still receive no direct rights on peer or guest-programme tables.
ALTER FUNCTION dg_trigger_7149c9c0c009ad90f81f034a() SECURITY DEFINER;
ALTER FUNCTION dg_trigger_8c643cae7e064e22569539f7() SECURITY DEFINER;
REVOKE ALL ON FUNCTION dg_trigger_7149c9c0c009ad90f81f034a(),dg_trigger_8c643cae7e064e22569539f7() FROM PUBLIC;
