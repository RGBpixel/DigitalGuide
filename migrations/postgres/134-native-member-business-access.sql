-- R-119. Legacy membership remains the stable lock anchor, while business
-- authorization reads the current runtime environment's effective membership.
CREATE VIEW _dg_native_effective_member_directory AS
 SELECT b.user_id,b.tenant_id,coalesce(d.role,b.role) AS role,coalesce(d.workspace_ids,b.workspace_ids) AS workspace_ids
 FROM memberships b CROSS JOIN _dg_native_runtime_control runtime
 LEFT JOIN enterprise_member_directory d ON d.user_id=b.user_id AND d.tenant_id=b.tenant_id AND d.environment=runtime.environment AND d.app_env=runtime.app_env
 WHERE runtime.id=1 AND(d.user_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM enterprise_member_directory origin WHERE origin.user_id=b.user_id AND origin.origin='provisioned'));
CREATE VIEW _dg_native_effective_memberships AS
 SELECT m.user_id,m.tenant_id,m.role,m.workspace_ids FROM _dg_native_effective_member_directory m
 WHERE NOT EXISTS(SELECT 1 FROM enterprise_member_controls control CROSS JOIN _dg_native_runtime_control runtime
  WHERE runtime.id=1 AND control.user_id=m.user_id AND control.tenant_id=m.tenant_id AND control.environment=runtime.environment AND control.app_env=runtime.app_env AND control.status='suspended');
REVOKE ALL ON _dg_native_effective_member_directory,_dg_native_effective_memberships FROM PUBLIC;

-- The schema is created from pinned migrations in a new private runtime. Only
-- existing code-owned function definitions in that schema can be replaced.
-- CREATE OR REPLACE preserves their identities, signatures and individual ACLs.
DO $migration$
DECLARE item record;definition text;changed integer:=0;
BEGIN
 FOR item IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname=current_schema() AND p.prokind='f' AND p.prosrc ~* '\m(FROM|JOIN)[[:space:]]+memberships\M'
  AND p.proname NOT IN('dg_native_locked_membership','dg_native_identity_lock_member') ORDER BY p.oid LOOP
  definition:=pg_get_functiondef(item.oid);
  IF item.proname='dg_native_operations_metrics' THEN
   -- Member registration totals include suspended registered members; the
   -- separate admin/session authorization in the same function excludes them.
   definition:=regexp_replace(definition,'\mFROM[[:space:]]+memberships[[:space:]]+([a-z_][a-z_0-9]*)[[:space:]]+CROSS[[:space:]]+JOIN[[:space:]]+scope\M','FROM _dg_native_effective_member_directory \1 CROSS JOIN scope','gi');
  END IF;
  definition:=regexp_replace(definition,'\m(FROM|JOIN)([[:space:]]+)memberships\M','\1\2_dg_native_effective_memberships','gi');
  EXECUTE definition;changed:=changed+1;
 END LOOP;
 IF changed=0 THEN RAISE EXCEPTION 'No pinned native membership functions were updated';END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND p.prokind='f' AND p.prosrc ~* '\m(FROM|JOIN)[[:space:]]+memberships\M' AND p.proname NOT IN('dg_native_locked_membership','dg_native_identity_lock_member')) THEN RAISE EXCEPTION 'Unexpected legacy business membership read remains';END IF;
END;$migration$;
