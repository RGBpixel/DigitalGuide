-- Fresh native validation instances. No imported archive activation or in-place upgrade.
CREATE TABLE _dg_native_clone_sources (
 clone_id text PRIMARY KEY REFERENCES studio_clones(id),
 asset_id text NOT NULL REFERENCES assets(id),asset_version bigint NOT NULL CHECK(asset_version>0),
 upload_id text NOT NULL REFERENCES uploads(id),sha256 text NOT NULL,
 consent_id text NOT NULL REFERENCES consents(id),consent_expires_at text NOT NULL,
 created_at text NOT NULL
);
CREATE TABLE _dg_native_clone_attempts (
 clone_id text NOT NULL REFERENCES studio_clones(id),job_id text NOT NULL UNIQUE REFERENCES jobs(id),
 ordinal bigint NOT NULL CHECK(ordinal>0),created_at text NOT NULL,
 PRIMARY KEY(clone_id,ordinal)
);
CREATE TABLE _dg_native_clone_versions (
 clone_id text NOT NULL REFERENCES studio_clones(id),version bigint NOT NULL CHECK(version>0),
 snapshot text NOT NULL,actor_id text,created_at text NOT NULL,
 PRIMARY KEY(clone_id,version)
);
CREATE TRIGGER native_clone_source_immutable BEFORE UPDATE OR DELETE ON _dg_native_clone_sources FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_clone_attempt_immutable BEFORE UPDATE OR DELETE ON _dg_native_clone_attempts FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_clone_version_immutable BEFORE UPDATE OR DELETE ON _dg_native_clone_versions FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_library_event_immutable BEFORE UPDATE OR DELETE ON asset_library_events FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();

CREATE FUNCTION dg_native_library_file_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
 IF (NEW.asset_id,NEW.upload_id,NEW.sha256,NEW.size,NEW.media_type)
  IS DISTINCT FROM (OLD.asset_id,OLD.upload_id,OLD.sha256,OLD.size,OLD.media_type) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native library file bytes are immutable';
 END IF;
 RETURN NEW;
END;
$dg$;
CREATE TRIGGER native_library_file_guard BEFORE UPDATE ON asset_library_revisions FOR EACH ROW EXECUTE FUNCTION dg_native_library_file_guard();

ALTER TABLE studio_clones ADD CONSTRAINT native_clone_status CHECK(status IN ('training','awaiting_review','accepted','rejected','failed','unknown','cancelled','revoked'));
ALTER TABLE studio_clones ADD CONSTRAINT native_clone_mode CHECK(environment='mock' AND app_env IN ('development','sandbox') AND kind IN ('avatar','voice'));
ALTER TABLE studio_clones ADD CONSTRAINT native_clone_version CHECK(version>0);
ALTER TABLE studio_clones ADD CONSTRAINT native_clone_acceptance CHECK(status<>'accepted' OR accepted_at IS NOT NULL);
CREATE FUNCTION dg_native_clone_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
 IF (NEW.id,NEW.tenant_id,NEW.workspace_id,NEW.name,NEW.kind,NEW.asset_id,NEW.consent_id,NEW.environment,NEW.app_env,NEW.created_at)
  IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.workspace_id,OLD.name,OLD.kind,OLD.asset_id,OLD.consent_id,OLD.environment,OLD.app_env,OLD.created_at)
  OR NEW.version<>OLD.version+1 OR OLD.status='revoked' THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native clone source and revocation are immutable';
 END IF;
 IF NEW.job_id<>OLD.job_id AND NOT (OLD.status IN ('failed','unknown','cancelled','rejected') AND NEW.status='training') THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native clone retry must create a new attempt';
 END IF;
 IF NEW.status<>OLD.status AND NOT (
  NEW.status='revoked' OR
  (OLD.status='training' AND NEW.status IN ('awaiting_review','failed','unknown','cancelled')) OR
  (OLD.status='awaiting_review' AND NEW.status IN ('accepted','rejected')) OR
  (OLD.status IN ('failed','unknown','cancelled','rejected') AND NEW.status='training')) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native clone state transition is invalid';
 END IF;
 RETURN NEW;
END;
$dg$;
CREATE TRIGGER native_clone_guard BEFORE UPDATE ON studio_clones FOR EACH ROW EXECUTE FUNCTION dg_native_clone_guard();
CREATE FUNCTION dg_native_clone_history() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
 INSERT INTO _dg_native_clone_versions VALUES(NEW.id,NEW.version,row_to_json(NEW)::text,
  NULLIF(current_setting('digitalguide.actor_id',true),''),dg_utc_now());
 RETURN NEW;
END;
$dg$;
CREATE TRIGGER native_clone_history AFTER INSERT OR UPDATE ON studio_clones FOR EACH ROW EXECUTE FUNCTION dg_native_clone_history();
