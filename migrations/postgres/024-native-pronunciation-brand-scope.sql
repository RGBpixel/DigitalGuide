-- A speech worker validates a dictionary's brand scope without receiving brand bodies.
CREATE FUNCTION dg_native_voice_brand_valid(target_tenant text,target_workspace text,target_brand text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE current_app text;
BEGIN
 SELECT app_env INTO current_app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND environment='mock' AND session_user IN(app_role,worker_role);
 IF current_app IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only the native application or worker validates a pronunciation brand';END IF;
 RETURN EXISTS(SELECT 1 FROM studio_brand_kits b WHERE b.id=target_brand AND b.tenant_id=target_tenant AND b.workspace_id=target_workspace AND b.environment='mock' AND b.app_env=current_app);
END;$dg$;
REVOKE ALL ON FUNCTION dg_native_voice_brand_valid(text,text,text) FROM PUBLIC;
