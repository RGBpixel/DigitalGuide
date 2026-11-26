-- Lock quota/concurrency rows without granting tenant writes to runtime roles.
CREATE FUNCTION dg_native_locked_tenant(target text)
RETURNS TABLE(id text,daily_limit bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control c WHERE c.id=1 AND c.status='validation_only'
   AND c.environment='mock' AND session_user IN (c.app_role,c.worker_role)) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Native runtime role is not allowed';
 END IF;
 RETURN QUERY SELECT t.id,t.daily_limit FROM tenants t WHERE t.id=target FOR UPDATE;
END;
$dg$;
REVOKE ALL ON FUNCTION dg_native_locked_tenant(text) FROM PUBLIC;
