-- Native validation instances only. Previous migrations are not modified or upgraded in place.
CREATE TABLE _dg_native_preview_job_sources (
 job_id text PRIMARY KEY REFERENCES studio_preview_jobs(id),
 snapshot text NOT NULL,sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),created_at text NOT NULL
);
CREATE TABLE _dg_native_preview_artifacts (
 storage_key text PRIMARY KEY,frame_id text NOT NULL REFERENCES studio_preview_frames(id),
 job_id text NOT NULL REFERENCES studio_preview_jobs(id),project_version bigint NOT NULL CHECK(project_version>0),
 fingerprint text NOT NULL,sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),size bigint NOT NULL CHECK(size>0),
 width bigint NOT NULL CHECK(width>0),height bigint NOT NULL CHECK(height>0),created_at text NOT NULL
);
CREATE TRIGGER native_preview_source_immutable BEFORE UPDATE OR DELETE ON _dg_native_preview_job_sources FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_preview_artifact_immutable BEFORE UPDATE OR DELETE ON _dg_native_preview_artifacts FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_project_version_immutable BEFORE UPDATE OR DELETE ON studio_project_versions FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_template_version_immutable BEFORE UPDATE OR DELETE ON studio_template_versions FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_template_instantiation_immutable BEFORE UPDATE OR DELETE ON studio_template_instantiations FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_review_plan_immutable BEFORE UPDATE OR DELETE ON studio_review_plans FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();

CREATE FUNCTION dg_native_studio_project(target text,tenant text,for_write boolean)
RETURNS SETOF studio_projects LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control c WHERE c.id=1 AND c.status='validation_only'
  AND c.environment='mock' AND (session_user=c.app_role OR (session_user=c.worker_role AND NOT for_write))) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Native project role is not allowed';
 END IF;
 IF for_write THEN RETURN QUERY SELECT p.* FROM studio_projects p WHERE p.id=target AND p.tenant_id=tenant
  AND p.environment='mock' AND p.app_env=(SELECT app_env FROM _dg_native_runtime_control WHERE id=1) FOR UPDATE;
 ELSE RETURN QUERY SELECT p.* FROM studio_projects p WHERE p.id=target AND p.tenant_id=tenant
  AND p.environment='mock' AND p.app_env=(SELECT app_env FROM _dg_native_runtime_control WHERE id=1) FOR SHARE; END IF;
END;
$dg$;
REVOKE ALL ON FUNCTION dg_native_studio_project(text,text,boolean) FROM PUBLIC;

CREATE FUNCTION dg_native_studio_profile(target text,tenant text)
RETURNS SETOF profiles LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control c WHERE c.id=1 AND c.status='validation_only'
  AND c.environment='mock' AND session_user IN (c.app_role,c.worker_role)) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Native profile read role is not allowed';
 END IF;
 RETURN QUERY SELECT p.* FROM profiles p WHERE p.id=target AND p.tenant_id=tenant FOR SHARE;
END;
$dg$;
REVOKE ALL ON FUNCTION dg_native_studio_profile(text,text) FROM PUBLIC;

CREATE FUNCTION dg_native_studio_clone(target text,tenant text,workspace text,expected_kind text,asset text)
RETURNS TABLE(id text,version bigint,job_id text,consent_id text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control t WHERE t.id=1 AND t.status='validation_only'
  AND t.environment='mock' AND session_user IN (t.app_role,t.worker_role)) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Native accepted clone read role is not allowed';
 END IF;
 RETURN QUERY SELECT c.id,c.version,c.job_id,c.consent_id FROM studio_clones c
  JOIN _dg_native_clone_sources s ON s.clone_id=c.id JOIN assets a ON a.id=c.asset_id
  JOIN uploads u ON u.id=a.upload_id JOIN consents g ON g.id=c.consent_id JOIN jobs j ON j.id=c.job_id
  JOIN _dg_native_job_sources js ON js.job_id=j.id
  WHERE c.id=target AND c.tenant_id=tenant AND c.workspace_id=workspace AND c.kind=expected_kind AND c.asset_id=asset
  AND c.status='accepted' AND c.accepted_at IS NOT NULL AND c.environment='mock'
  AND c.app_env=(SELECT app_env FROM _dg_native_runtime_control WHERE _dg_native_runtime_control.id=1)
  AND a.tenant_id=tenant AND a.workspace_id=workspace AND a.archived=0 AND (a.expires_at IS NULL OR a.expires_at>dg_utc_now())
  AND s.asset_id=a.id AND s.asset_version=a.version AND s.upload_id=a.upload_id AND s.sha256=u.sha256
  AND s.consent_id=g.id AND s.consent_expires_at=g.expires_at AND g.asset_id=a.id
  AND g.tenant_id=tenant AND g.workspace_id=workspace AND g.revoked_at IS NULL AND g.expires_at>dg_utc_now()
  AND g.purpose=CASE WHEN expected_kind='avatar' THEN 'train_avatar' ELSE 'train_voice' END
  AND j.tenant_id=tenant AND j.workspace_id=workspace AND j.environment='mock' AND j.kind='training.'||expected_kind
  AND j.status='succeeded' AND j.result::jsonb @> jsonb_build_object('simulated',true,'provider','mock-local','remoteId','mock:'||j.id,'operation',j.kind)
  AND js.asset_id=s.asset_id AND js.asset_version=s.asset_version AND js.upload_id=s.upload_id AND js.sha256=s.sha256
  AND js.consent_id=s.consent_id AND js.consent_expires_at=s.consent_expires_at FOR SHARE OF c,a,g,j;
END;
$dg$;
REVOKE ALL ON FUNCTION dg_native_studio_clone(text,text,text,text,text) FROM PUBLIC;

CREATE FUNCTION dg_native_project_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
 IF (NEW.id,NEW.tenant_id,NEW.workspace_id,NEW.purpose,NEW.environment,NEW.app_env,NEW.created_at)
  IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.workspace_id,OLD.purpose,OLD.environment,OLD.app_env,OLD.created_at)
  OR NEW.version<>OLD.version+1 THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native project scope is immutable and revisions are monotonic';
 END IF;
 RETURN NEW;
END;
$dg$;
CREATE TRIGGER native_project_guard BEFORE UPDATE ON studio_projects FOR EACH ROW EXECUTE FUNCTION dg_native_project_guard();
CREATE FUNCTION dg_native_template_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
 IF (NEW.id,NEW.tenant_id,NEW.workspace_id,NEW.environment,NEW.app_env,NEW.created_at)
  IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.workspace_id,OLD.environment,OLD.app_env,OLD.created_at)
  OR NEW.version<>OLD.version+1 THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native template scope is immutable and revisions are monotonic';
 END IF;
 RETURN NEW;
END;
$dg$;
CREATE TRIGGER native_template_guard BEFORE UPDATE ON studio_templates FOR EACH ROW EXECUTE FUNCTION dg_native_template_guard();
CREATE TRIGGER native_brand_guard BEFORE UPDATE ON studio_brand_kits FOR EACH ROW EXECUTE FUNCTION dg_native_template_guard();

ALTER TABLE studio_preview_jobs ADD CONSTRAINT native_preview_state CHECK(status IN ('queued','rendering','succeeded','failed','cancelled'));
ALTER TABLE studio_preview_jobs ADD CONSTRAINT native_preview_attempts CHECK(attempts BETWEEN 0 AND 2);
ALTER TABLE studio_preview_jobs ADD CONSTRAINT native_preview_lease CHECK(
 (status='rendering' AND lease_token IS NOT NULL AND lease_until IS NOT NULL) OR
 (status<>'rendering' AND lease_token IS NULL AND lease_until IS NULL));
CREATE UNIQUE INDEX native_preview_one_pending ON studio_preview_jobs(project_id) WHERE status IN ('queued','rendering');
CREATE FUNCTION dg_native_preview_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
 IF (NEW.id,NEW.project_id,NEW.tenant_id,NEW.workspace_id,NEW.actor_id,NEW.project_version,NEW.plan_hash,NEW.segment_ids,NEW.environment,NEW.app_env,NEW.created_at)
  IS DISTINCT FROM (OLD.id,OLD.project_id,OLD.tenant_id,OLD.workspace_id,OLD.actor_id,OLD.project_version,OLD.plan_hash,OLD.segment_ids,OLD.environment,OLD.app_env,OLD.created_at)
  OR OLD.status IN ('succeeded','failed','cancelled') THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native preview input and terminal state are immutable';
 END IF;
 IF NEW.status<>OLD.status AND NOT ((OLD.status='queued' AND NEW.status IN ('rendering','cancelled')) OR
  (OLD.status='rendering' AND NEW.status IN ('succeeded','failed','cancelled'))) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native preview state transition is invalid';
 END IF;
 RETURN NEW;
END;
$dg$;
CREATE TRIGGER native_preview_guard BEFORE UPDATE ON studio_preview_jobs FOR EACH ROW EXECUTE FUNCTION dg_native_preview_guard();
