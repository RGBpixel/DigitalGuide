CREATE OR REPLACE FUNCTION dg_native_directory_clear_exclusive_name(actor text,target text,tenant text,connector text,source_revision bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE member record;c record;d record;
BEGIN
 SELECT * INTO c FROM _dg_native_runtime_control WHERE id=1;
 IF c.id IS NULL OR c.status<>'validation_only' OR c.environment<>'mock' OR session_user<>c.app_role OR actor=target THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Directory erasure role is not allowed';END IF;
 SELECT * INTO member FROM dg_native_locked_membership(actor);
 IF member.user_id IS NULL OR member.tenant_id<>tenant OR member.role<>'admin' OR EXISTS(SELECT 1 FROM workspaces w WHERE w.tenant_id=tenant AND NOT jsonb_exists(member.workspace_ids::jsonb,w.id)) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Organization administrator is required';END IF;
 PERFORM dg_native_identity_lock_member(target);
 SELECT * INTO d FROM enterprise_directory_users u WHERE u.id=target AND u.tenant_id=tenant AND u.environment=c.environment AND u.app_env=c.app_env AND u.connector_id=connector FOR UPDATE;
 IF d.id IS NULL OR d.deleted<>1 OR d.active<>0 OR d.version<>source_revision OR NOT EXISTS(SELECT 1 FROM enterprise_member_controls s WHERE s.user_id=target AND s.tenant_id=tenant AND s.environment=c.environment AND s.app_env=c.app_env AND s.status='suspended') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Deleted suspended directory member is required';END IF;
 IF (SELECT count(*) FROM memberships m WHERE m.user_id=target)<>1 OR NOT EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=target AND m.tenant_id=tenant AND m.role='viewer' AND jsonb_array_length(m.workspace_ids::jsonb)=0) OR NOT EXISTS(SELECT 1 FROM enterprise_member_directory m WHERE m.user_id=target AND m.tenant_id=tenant AND m.environment=c.environment AND m.app_env=c.app_env AND m.origin='provisioned') OR EXISTS(SELECT 1 FROM enterprise_member_directory m WHERE m.user_id=target AND(m.tenant_id<>tenant OR m.environment<>c.environment OR m.app_env<>c.app_env)) OR EXISTS(SELECT 1 FROM enterprise_directory_connectors s WHERE s.owner_id=target) OR EXISTS(SELECT 1 FROM enterprise_identity_bindings b WHERE b.user_id=target AND b.enabled=1 AND NOT(b.tenant_id=tenant AND b.environment=c.environment AND b.app_env=c.app_env)) OR EXISTS(SELECT 1 FROM auth_sessions s WHERE s.user_id=target AND NOT(s.environment=c.environment AND s.app_env=c.app_env) AND s.expires_at>dg_utc_now()) THEN RETURN false;END IF;
 UPDATE users SET name='已清理目录成员' WHERE id=target;RETURN true;
END;$dg$;
REVOKE ALL ON FUNCTION dg_native_directory_clear_exclusive_name(text,text,text,text,bigint) FROM PUBLIC;
