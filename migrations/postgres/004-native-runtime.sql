-- New, empty native validation schemas only. Never activates an imported archive.
CREATE TABLE _dg_native_runtime_control (
 id integer PRIMARY KEY CHECK(id=1),runtime_id text NOT NULL UNIQUE,
 purpose text NOT NULL CHECK(purpose='native-application-validation-only'),
 status text NOT NULL CHECK(status='validation_only'),environment text NOT NULL CHECK(environment='mock'),
 app_env text NOT NULL CHECK(app_env IN ('development','sandbox')),
 data_dir_sha256 text NOT NULL,app_role text NOT NULL,worker_role text NOT NULL,
 catalog_sha256 text NOT NULL,created_at text NOT NULL
);

-- Lock a membership without granting membership writes to API/worker roles.
CREATE FUNCTION dg_native_locked_membership(actor text)
RETURNS TABLE(user_id text,tenant_id text,role text,workspace_ids text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control c WHERE c.id=1 AND c.status='validation_only'
   AND c.environment='mock' AND session_user IN (c.app_role,c.worker_role)) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Native runtime role is not allowed';
 END IF;
 RETURN QUERY SELECT m.user_id,m.tenant_id,m.role,m.workspace_ids FROM memberships m WHERE m.user_id=actor FOR SHARE;
END;
$dg$;
REVOKE ALL ON FUNCTION dg_native_locked_membership(text) FROM PUBLIC;

ALTER TABLE jobs ADD CONSTRAINT native_job_status CHECK(status IN ('queued','running','retrying','cancellation_requested','cancelled','succeeded','failed','unknown'));
ALTER TABLE jobs ADD CONSTRAINT native_job_attempts CHECK(attempts>=0 AND max_attempts BETWEEN 1 AND 10 AND attempts<=max_attempts);
ALTER TABLE jobs ADD CONSTRAINT native_job_lease CHECK(
 (status IN ('running','cancellation_requested') AND lease_token IS NOT NULL AND lease_until IS NOT NULL) OR
 (status NOT IN ('running','cancellation_requested') AND lease_token IS NULL AND lease_until IS NULL));
CREATE FUNCTION dg_native_job_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
 IF (NEW.id,NEW.tenant_id,NEW.workspace_id,NEW.actor_id,NEW.kind,NEW.payload,NEW.environment,NEW.created_at)
  IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.workspace_id,OLD.actor_id,OLD.kind,OLD.payload,OLD.environment,OLD.created_at) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native job input is immutable';
 END IF;
 IF NEW.status<>OLD.status AND NOT (
  (OLD.status IN ('queued','retrying') AND NEW.status IN ('running','cancelled')) OR
  (OLD.status='running' AND NEW.status IN ('retrying','failed','succeeded','unknown','cancellation_requested')) OR
  (OLD.status='cancellation_requested' AND NEW.status='cancelled')) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native job state transition is invalid';
 END IF;
 RETURN NEW;
END;
$dg$;
CREATE TRIGGER native_job_guard BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION dg_native_job_guard();
