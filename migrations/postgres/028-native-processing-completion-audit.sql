-- 027 is already applied and frozen. Audit completion in the same transaction without granting raw audit writes to workers.
CREATE FUNCTION dg_native_processing_completion_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF OLD.status='processing' AND NEW.status IN('succeeded','awaiting_review') THEN
  IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user=worker_role) OR NOT EXISTS(SELECT 1 FROM _dg_native_processing_outputs WHERE job_id=NEW.id AND lease_token=OLD.lease_token AND input_hash=NEW.input_hash AND report=NEW.report) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Processing completion audit requires its exact worker receipt';END IF;
  INSERT INTO audit_events VALUES(gen_random_uuid()::text,NEW.tenant_id,NEW.workspace_id,NEW.actor_id,'media.processing.complete',NEW.id,'confirmed',OLD.lease_token,dg_utc_now());
 END IF;RETURN NULL;
END;$dg$;
CREATE TRIGGER native_processing_completion_audit AFTER UPDATE ON studio_media_jobs FOR EACH ROW EXECUTE FUNCTION dg_native_processing_completion_audit();
REVOKE ALL ON FUNCTION dg_native_processing_completion_audit() FROM PUBLIC;
