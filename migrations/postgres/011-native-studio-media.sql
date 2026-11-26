-- Independent native validation instance only. 001-010 remain frozen.
CREATE TABLE _dg_native_timeline_sources (
 job_id text PRIMARY KEY REFERENCES studio_timeline_previews(id),snapshot text NOT NULL,
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),created_at text NOT NULL
);
CREATE TABLE _dg_native_export_sources (
 job_id text PRIMARY KEY REFERENCES studio_exports(id),snapshot text NOT NULL,
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),created_at text NOT NULL
);
CREATE TABLE _dg_native_timeline_artifacts (
 job_id text NOT NULL REFERENCES studio_timeline_previews(id),kind text NOT NULL CHECK(kind IN ('video','audio')),
 storage_key text NOT NULL UNIQUE,media_type text NOT NULL,size bigint NOT NULL CHECK(size>0 AND size<=67108864),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),created_at text NOT NULL,PRIMARY KEY(job_id,kind)
);
CREATE TRIGGER native_timeline_source_immutable BEFORE UPDATE OR DELETE ON _dg_native_timeline_sources FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_export_source_immutable BEFORE UPDATE OR DELETE ON _dg_native_export_sources FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_timeline_artifact_immutable BEFORE UPDATE OR DELETE ON _dg_native_timeline_artifacts FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_export_artifact_immutable BEFORE UPDATE OR DELETE ON studio_export_artifacts FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
ALTER TABLE studio_exports ADD CONSTRAINT native_export_state CHECK(status IN ('queued','rendering','succeeded','failed','cancelled'));
ALTER TABLE studio_exports ADD CONSTRAINT native_export_attempts CHECK(attempts BETWEEN 0 AND 2);
ALTER TABLE studio_exports ADD CONSTRAINT native_export_progress CHECK(progress>=0 AND progress<=1);
ALTER TABLE studio_exports ADD CONSTRAINT native_export_lease CHECK((status='rendering' AND lease_token IS NOT NULL AND lease_until IS NOT NULL) OR (status<>'rendering' AND lease_token IS NULL AND lease_until IS NULL));
ALTER TABLE studio_timeline_previews ADD CONSTRAINT native_timeline_state CHECK(status IN ('queued','rendering','succeeded','failed','cancelled'));
ALTER TABLE studio_timeline_previews ADD CONSTRAINT native_timeline_attempts CHECK(attempts BETWEEN 0 AND 2);
ALTER TABLE studio_timeline_previews ADD CONSTRAINT native_timeline_progress CHECK(progress>=0 AND progress<=1);
ALTER TABLE studio_timeline_previews ADD CONSTRAINT native_timeline_lease CHECK((status='rendering' AND lease_token IS NOT NULL AND lease_until IS NOT NULL) OR (status<>'rendering' AND lease_token IS NULL AND lease_until IS NULL));
CREATE UNIQUE INDEX native_export_one_pending ON studio_exports(project_id) WHERE status IN ('queued','rendering');
CREATE UNIQUE INDEX native_timeline_one_pending ON studio_timeline_previews(project_id) WHERE status IN ('queued','rendering');
CREATE FUNCTION dg_native_media_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE mutable text[]:=ARRAY['status','attempts','lease_token','lease_until','progress','video_key','audio_key','result','error_message','updated_at'];
BEGIN
 IF to_jsonb(NEW)-mutable IS DISTINCT FROM to_jsonb(OLD)-mutable OR OLD.status IN ('succeeded','failed','cancelled') THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native media input and terminal result are immutable';
 END IF;
 IF NEW.status<>OLD.status AND NOT ((OLD.status='queued' AND NEW.status IN ('rendering','cancelled')) OR
  (OLD.status='rendering' AND NEW.status IN ('queued','succeeded','failed','cancelled'))) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native media transition is invalid';
 END IF;
 IF NEW.status='queued' AND (OLD.status<>'rendering' OR NEW.attempts<>OLD.attempts-1 OR NEW.progress<>0 OR NEW.result IS NOT NULL) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native media release must preserve a clean queued task';
 END IF;
 IF NEW.status='rendering' AND NEW.lease_token IS DISTINCT FROM OLD.lease_token AND NEW.attempts<>OLD.attempts+1 THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native media claim increments attempts exactly once';
 END IF;
 IF NEW.status='rendering' AND NEW.lease_token IS NOT DISTINCT FROM OLD.lease_token AND
  (NEW.attempts<>OLD.attempts OR OLD.lease_until<=dg_utc_now()) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Expired native media lease cannot be renewed';
 END IF;
 IF NEW.status='succeeded' AND (OLD.status<>'rendering' OR OLD.lease_until<=dg_utc_now() OR NEW.progress<>1 OR NEW.result IS NULL) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native media completion needs an active lease and result';
 END IF;
 RETURN NEW;
END;
$dg$;
CREATE TRIGGER native_export_guard BEFORE UPDATE ON studio_exports FOR EACH ROW EXECUTE FUNCTION dg_native_media_guard();
CREATE TRIGGER native_timeline_guard BEFORE UPDATE ON studio_timeline_previews FOR EACH ROW EXECUTE FUNCTION dg_native_media_guard();
