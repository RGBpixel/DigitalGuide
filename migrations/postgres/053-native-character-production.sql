-- R-058/R-068/R-069/R-070/R-071/R-126. Fresh private validation schemas only.
ALTER TABLE _dg_native_asset_origins DROP CONSTRAINT native_asset_source_kind;
ALTER TABLE _dg_native_asset_origins ADD CONSTRAINT native_asset_source_kind CHECK(source_kind IN('private_upload','package_import','video_upload','system_speech','media_processing','recording','ae_media','live_recording','character_source','character_render'));
CREATE TABLE _dg_native_character_inputs(job_id text PRIMARY KEY REFERENCES character_jobs(id),input_hash text NOT NULL,input_snapshot text NOT NULL,created_at text NOT NULL);
CREATE TABLE _dg_native_character_outputs(job_id text PRIMARY KEY REFERENCES character_jobs(id),lease_token text NOT NULL,input_hash text NOT NULL,receipt text NOT NULL,sha256 text NOT NULL,quality_sha256 text,created_at text NOT NULL);
CREATE TABLE _dg_native_character_leases(job_id text PRIMARY KEY REFERENCES character_jobs(id),token text NOT NULL UNIQUE,lease_until text NOT NULL,created_at text NOT NULL);
CREATE TABLE _dg_native_character_assets(asset_id text PRIMARY KEY REFERENCES assets(id),job_id text NOT NULL UNIQUE REFERENCES character_jobs(id),upload_id text NOT NULL REFERENCES uploads(id),expires_at text NOT NULL,synthetic bigint NOT NULL CHECK(synthetic IN(0,1)),created_at text NOT NULL);
CREATE TRIGGER native_character_input_immutable BEFORE UPDATE OR DELETE ON _dg_native_character_inputs FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_character_output_immutable BEFORE UPDATE OR DELETE ON _dg_native_character_outputs FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_character_asset_immutable BEFORE UPDATE OR DELETE ON _dg_native_character_assets FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_character_motion_version_immutable BEFORE UPDATE OR DELETE ON character_motion_versions FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
ALTER TABLE character_jobs ADD CONSTRAINT native_character_job_shape CHECK(environment='mock' AND app_env IN('development','sandbox') AND version>0 AND attempts BETWEEN 0 AND 3 AND operation IN('quality','reference','motion','mock_training') AND status IN('queued','rendering','succeeded','awaiting_review','accepted','rejected','failed','unknown','cancelled','stale') AND input_hash ~ '^[a-f0-9]{64}$' AND character_version>0 AND ((status='rendering' AND lease_token IS NOT NULL AND lease_until IS NOT NULL) OR(status<>'rendering' AND lease_token IS NULL AND lease_until IS NULL)));

CREATE FUNCTION dg_native_character_dependencies(p_job text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j character_jobs%ROWTYPE;c studio_characters%ROWTYPE;v jsonb;r jsonb;a assets%ROWTYPE;u uploads%ROWTYPE;t consents%ROWTYPE;q character_jobs%ROWTYPE;app text;
BEGIN
 SELECT * INTO j FROM character_jobs WHERE id=p_job;SELECT app_env INTO app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only';
 IF j.id IS NULL OR j.environment<>'mock' OR j.app_env IS DISTINCT FROM app OR NOT EXISTS(SELECT 1 FROM _dg_native_character_inputs i WHERE i.job_id=j.id AND i.input_hash=j.input_hash AND i.input_snapshot=j.input_snapshot) THEN RETURN false;END IF;
 v:=j.input_snapshot::jsonb;SELECT * INTO c FROM studio_characters WHERE id=j.character_id;
 IF c.id IS NULL OR c.tenant_id<>j.tenant_id OR c.workspace_id<>j.workspace_id OR c.environment<>j.environment OR c.app_env<>j.app_env OR c.archived<>0 OR c.version<>j.character_version OR c.expires_at::timestamptz<=clock_timestamp()
  OR v->'character'->>'id'<>c.id OR(v->'character'->>'version')::bigint<>c.version OR v->'character'->>'workspaceId'<>c.workspace_id OR v->'character'->>'sourceAssetId'<>c.source_asset_id OR(v->'character'->>'sourceVersion')::bigint<>c.source_version OR v->'character'->>'consentId'<>c.consent_id
  OR v->'source'->>'id'<>c.source_asset_id OR(v->'source'->>'version')::bigint<>c.source_version OR v->'source'->>'sha256'<>c.source_sha256
  OR NOT EXISTS(SELECT 1 FROM memberships m JOIN workspaces w ON w.id=j.workspace_id AND w.tenant_id=m.tenant_id WHERE m.user_id=j.actor_id AND m.tenant_id=j.tenant_id AND m.role IN('admin','editor') AND m.workspace_ids::jsonb ? j.workspace_id) THEN RETURN false;END IF;
 SELECT * INTO t FROM consents WHERE id=c.consent_id;
 IF t.id IS NULL OR t.tenant_id<>j.tenant_id OR t.workspace_id<>j.workspace_id OR t.asset_id<>c.source_asset_id OR t.purpose<>'character_use' OR t.revoked_at IS NOT NULL OR t.expires_at::timestamptz<=clock_timestamp() OR t.expires_at::timestamptz<c.expires_at::timestamptz THEN RETURN false;END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(jsonb_build_array(v->'source',v->'voice')) LOOP
  IF r IS NOT NULL AND r<>'null'::jsonb THEN
   SELECT * INTO a FROM assets WHERE id=r->>'id';SELECT * INTO u FROM uploads WHERE id=a.upload_id;
   IF a.id IS NULL OR u.id IS NULL OR a.tenant_id<>j.tenant_id OR a.workspace_id<>j.workspace_id OR a.archived<>0 OR a.version<>(r->>'version')::bigint OR(a.expires_at IS NOT NULL AND a.expires_at::timestamptz<=clock_timestamp()) OR u.tenant_id<>a.tenant_id OR u.workspace_id<>a.workspace_id OR u.sha256<>r->>'sha256' OR u.size<>(r->>'size')::bigint OR u.media_type<>r->>'mediaType' OR u.storage_key<>r->>'storageKey' OR u.specs::jsonb IS DISTINCT FROM r->'specs' OR(a.synthetic=1) IS DISTINCT FROM(r->>'synthetic')::boolean THEN RETURN false;END IF;
  END IF;
 END LOOP;
 IF v->'training'<>'null'::jsonb THEN
  IF j.operation<>'mock_training' OR NOT EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=j.actor_id AND m.tenant_id=j.tenant_id AND m.role='admin' AND m.workspace_ids::jsonb ? j.workspace_id) THEN RETURN false;END IF;
  SELECT * INTO t FROM consents WHERE id=v->'training'->>'consentId';SELECT * INTO q FROM character_jobs WHERE id=v->'training'->>'qualityJobId';
  IF t.id IS NULL OR t.tenant_id<>j.tenant_id OR t.workspace_id<>j.workspace_id OR t.asset_id<>c.source_asset_id OR t.purpose<>'train_avatar' OR t.revoked_at IS NOT NULL OR t.expires_at::timestamptz<=clock_timestamp() OR q.id IS NULL OR q.operation<>'quality' OR q.status<>'succeeded' OR q.character_id<>j.character_id OR q.character_version<>j.character_version OR NOT EXISTS(SELECT 1 FROM _dg_native_character_outputs o WHERE o.job_id=q.id AND o.quality_sha256=v->'training'->>'qualityHash') OR EXISTS(SELECT 1 FROM jsonb_array_elements(q.result::jsonb->'quality'->'findings') f WHERE f->>'level'='blocking') OR NOT dg_native_character_dependencies(q.id) THEN RETURN false;END IF;
 END IF;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $dg$;

CREATE FUNCTION dg_native_character_motion_valid(p_job text,p_token text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j character_jobs%ROWTYPE;v jsonb;app text;
BEGIN
 SELECT app_env INTO app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user=worker_role;
 IF app IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Native character worker required';END IF;
 SELECT * INTO j FROM character_jobs WHERE id=p_job;v:=j.input_snapshot::jsonb;
 IF j.id IS NULL OR j.app_env<>app OR j.status<>'rendering' OR j.lease_token IS DISTINCT FROM p_token OR j.lease_until::timestamptz<=clock_timestamp() THEN RETURN false;END IF;
 RETURN v->'motion'='null'::jsonb OR EXISTS(SELECT 1 FROM character_motion_plans p WHERE p.id=v->'motion'->>'id' AND p.version=(v->'motion'->>'version')::bigint AND p.character_id=j.character_id AND p.project_id=j.project_id AND p.payload::jsonb=v->'motion'->'content');
END $dg$;

CREATE FUNCTION dg_native_character_plan_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE c studio_characters%ROWTYPE;p studio_projects%ROWTYPE;v jsonb:=NEW.payload::jsonb;
BEGIN
 IF TG_OP='UPDATE' AND(ROW(NEW.id,NEW.character_id,NEW.project_id,NEW.actor_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.character_id,OLD.project_id,OLD.actor_id,OLD.created_at) OR NEW.version<>OLD.version+1) THEN RAISE EXCEPTION 'Motion plan identity is fixed and revisions advance once';END IF;
 IF TG_OP='INSERT' AND NEW.version<>1 THEN RAISE EXCEPTION 'Motion plan starts at version one';END IF;
 SELECT * INTO c FROM studio_characters WHERE id=NEW.character_id;SELECT * INTO p FROM studio_projects WHERE id=NEW.project_id;
 IF c.id IS NULL OR p.id IS NULL OR c.workspace_id<>p.workspace_id OR c.tenant_id<>p.tenant_id OR c.archived<>0 OR p.archived<>0 OR v->>'characterId'<>c.id OR(v->>'characterVersion')::bigint<>c.version OR(v->>'projectVersion')::bigint<>p.version OR NOT EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=NEW.actor_id AND m.tenant_id=c.tenant_id AND m.role IN('admin','editor') AND m.workspace_ids::jsonb ? c.workspace_id) THEN RAISE EXCEPTION 'Motion plan must bind its current character, project and actor';END IF;
 RETURN NEW;
END $dg$;
CREATE TRIGGER native_character_plan_guard BEFORE INSERT OR UPDATE ON character_motion_plans FOR EACH ROW EXECUTE FUNCTION dg_native_character_plan_guard();
CREATE FUNCTION dg_native_character_plan_history() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE p character_motion_plans%ROWTYPE;
BEGIN
 SELECT * INTO p FROM character_motion_plans WHERE id=NEW.id;
 IF NOT EXISTS(SELECT 1 FROM character_motion_versions v WHERE v.plan_id=NEW.id AND v.version=NEW.version AND v.payload=NEW.payload) THEN RAISE EXCEPTION 'Each motion plan revision and immutable history commit together';END IF;RETURN NULL;
END $dg$;
CREATE CONSTRAINT TRIGGER native_character_plan_history AFTER INSERT OR UPDATE ON character_motion_plans DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_character_plan_history();
CREATE FUNCTION dg_native_character_motion_version_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM character_motion_plans p WHERE p.id=NEW.plan_id AND p.version=NEW.version AND p.payload=NEW.payload) THEN RAISE EXCEPTION 'Motion history must record the exact current plan';END IF;RETURN NEW;
END $dg$;
CREATE TRIGGER native_character_motion_version_guard BEFORE INSERT ON character_motion_versions FOR EACH ROW EXECUTE FUNCTION dg_native_character_motion_version_guard();

CREATE FUNCTION dg_native_character_job_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v jsonb:=NEW.input_snapshot::jsonb;c studio_characters%ROWTYPE;api boolean;worker boolean;o _dg_native_character_outputs%ROWTYPE;
BEGIN
 SELECT session_user=app_role,session_user=worker_role INTO api,worker FROM _dg_native_runtime_control WHERE id=1;
 IF TG_OP='INSERT' THEN
  SELECT * INTO c FROM studio_characters WHERE id=NEW.character_id;
  IF c.id IS NULL OR c.tenant_id<>NEW.tenant_id OR c.workspace_id<>NEW.workspace_id OR c.version<>NEW.character_version OR NEW.status<>'queued' OR NEW.version<>1 OR NEW.attempts<>0 OR NEW.outputs<>'[]' OR NEW.result IS NOT NULL OR NEW.applied_project_version IS NOT NULL OR NEW.lease_token IS NOT NULL OR NEW.lease_until IS NOT NULL OR NEW.input_hash<>encode(sha256(convert_to(NEW.input_snapshot,'UTF8')),'hex') OR NEW.app_env<>(SELECT app_env FROM _dg_native_runtime_control WHERE id=1) OR jsonb_typeof(v)<>'object' OR(v->'character'->>'id') IS DISTINCT FROM c.id OR(v->'character'->>'version')::bigint IS DISTINCT FROM c.version OR NOT EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=NEW.actor_id AND m.tenant_id=NEW.tenant_id AND m.role IN('admin','editor') AND m.workspace_ids::jsonb ? NEW.workspace_id) THEN RAISE EXCEPTION 'New character task must bind current actor and immutable input';END IF;
  IF NEW.operation IN('reference','motion') THEN IF v->'project' IS NULL OR v->'project'='null'::jsonb OR v->'project'->>'id' IS DISTINCT FROM NEW.project_id OR(v->'project'->>'version')::bigint IS DISTINCT FROM NEW.project_version OR NOT EXISTS(SELECT 1 FROM studio_projects p WHERE p.id=NEW.project_id AND p.workspace_id=NEW.workspace_id AND p.tenant_id=NEW.tenant_id AND p.version=NEW.project_version AND p.archived=0) THEN RAISE EXCEPTION 'Character render requires its fixed current project';END IF;
  ELSIF NEW.project_id IS NOT NULL OR NEW.project_version IS NOT NULL OR v->'project' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Quality and mock preparation do not bind projects';END IF;
  IF(NEW.operation='motion') IS DISTINCT FROM(v->'motion'<>'null'::jsonb) OR(NEW.operation='mock_training') IS DISTINCT FROM(v->'training'<>'null'::jsonb) THEN RAISE EXCEPTION 'Operation and explicit motion/training purpose must agree';END IF;
 ELSE
  IF ROW(NEW.id,NEW.character_id,NEW.character_version,NEW.tenant_id,NEW.workspace_id,NEW.actor_id,NEW.operation,NEW.project_id,NEW.project_version,NEW.input_snapshot,NEW.input_hash,NEW.environment,NEW.app_env,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.character_id,OLD.character_version,OLD.tenant_id,OLD.workspace_id,OLD.actor_id,OLD.operation,OLD.project_id,OLD.project_version,OLD.input_snapshot,OLD.input_hash,OLD.environment,OLD.app_env,OLD.created_at) THEN RAISE EXCEPTION 'Character task identity and input are immutable';END IF;
  IF OLD.status='stale' AND NEW.status<>'stale' THEN RAISE EXCEPTION 'Invalidated character tasks cannot revive';END IF;
  IF NEW.outputs IS DISTINCT FROM OLD.outputs OR NEW.result IS DISTINCT FROM OLD.result THEN
   SELECT * INTO o FROM _dg_native_character_outputs WHERE job_id=NEW.id;
   IF NOT worker OR OLD.status<>'rendering' OR o.job_id IS NULL OR o.lease_token<>OLD.lease_token OR NEW.outputs::jsonb IS DISTINCT FROM o.receipt::jsonb->'outputs' OR NEW.result::jsonb IS DISTINCT FROM o.receipt::jsonb->'result' THEN RAISE EXCEPTION 'Only current worker receipt commits actual character outputs';END IF;
  END IF;
  IF api AND NEW.status IS DISTINCT FROM OLD.status AND NOT((NEW.status='cancelled' AND OLD.status IN('queued','rendering')) OR(NEW.status='queued' AND OLD.status='failed' AND OLD.attempts<3 AND OLD.error_code IS DISTINCT FROM 'MOCK_PERMANENT_FAILURE' AND dg_native_character_dependencies(NEW.id)) OR(NEW.status='awaiting_review' AND OLD.status='unknown' AND OLD.operation='mock_training' AND OLD.result::jsonb->>'mockOutcome'='succeeded' AND dg_native_character_dependencies(NEW.id)) OR(NEW.status IN('accepted','rejected') AND OLD.status='awaiting_review' AND OLD.operation='mock_training' AND(NEW.status='rejected' OR dg_native_character_dependencies(NEW.id))) OR(NEW.status='stale' AND NOT dg_native_character_dependencies(NEW.id))) THEN RAISE EXCEPTION 'API cannot forge worker state or revive expired inputs';END IF;
  IF api AND NEW.lease_token IS NOT NULL THEN RAISE EXCEPTION 'API cannot forge or extend worker leases';END IF;
  IF NEW.applied_project_version IS DISTINCT FROM OLD.applied_project_version AND(OLD.applied_project_version IS NOT NULL OR OLD.status<>'succeeded' OR NEW.applied_project_version IS DISTINCT FROM OLD.project_version+1 OR NOT EXISTS(SELECT 1 FROM _dg_native_character_assets a WHERE a.job_id=NEW.id)) THEN RAISE EXCEPTION 'Character application commits once with its actual derived asset';END IF;
  IF NEW.version<>OLD.version+1 AND NOT(worker AND NEW.version=OLD.version AND NEW.status='rendering' AND NEW.lease_token=OLD.lease_token AND NEW.outputs=OLD.outputs AND NEW.result IS NOT DISTINCT FROM OLD.result) THEN RAISE EXCEPTION 'Character state revisions advance once';END IF;
 END IF;RETURN NEW;
END $dg$;
CREATE TRIGGER native_character_job_guard BEFORE INSERT OR UPDATE ON character_jobs FOR EACH ROW EXECUTE FUNCTION dg_native_character_job_guard();
CREATE FUNCTION dg_native_character_input_record() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 INSERT INTO _dg_native_character_inputs VALUES(NEW.id,NEW.input_hash,NEW.input_snapshot,dg_utc_now());
 IF NOT dg_native_character_dependencies(NEW.id) THEN RAISE EXCEPTION 'Character input dependencies are unavailable';END IF;RETURN NEW;
END $dg$;
CREATE TRIGGER native_character_input_record AFTER INSERT ON character_jobs FOR EACH ROW EXECUTE FUNCTION dg_native_character_input_record();

CREATE FUNCTION dg_native_character_invalidate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j character_jobs%ROWTYPE;
BEGIN
 FOR j IN SELECT * FROM character_jobs WHERE status NOT IN('stale','cancelled','rejected') ORDER BY id LOOP
  IF NOT dg_native_character_dependencies(j.id) THEN UPDATE character_jobs SET status='stale',version=version+1,lease_token=NULL,lease_until=NULL,error_code='CHARACTER_SOURCE_CHANGED',error_message='原形象、发起人、素材或独立用途已变化，请建立新任务。',updated_at=dg_utc_now() WHERE id=j.id AND status NOT IN('stale','cancelled','rejected');END IF;
 END LOOP;RETURN NULL;
END $dg$;
CREATE TRIGGER native_character_membership_invalidate AFTER UPDATE OR DELETE ON memberships FOR EACH STATEMENT EXECUTE FUNCTION dg_native_character_invalidate();
CREATE TRIGGER native_character_catalog_invalidate AFTER UPDATE OR DELETE ON studio_characters FOR EACH STATEMENT EXECUTE FUNCTION dg_native_character_invalidate();
CREATE TRIGGER native_character_asset_invalidate AFTER UPDATE OR DELETE ON assets FOR EACH STATEMENT EXECUTE FUNCTION dg_native_character_invalidate();
CREATE TRIGGER native_character_consent_invalidate AFTER UPDATE OR DELETE ON consents FOR EACH STATEMENT EXECUTE FUNCTION dg_native_character_invalidate();

CREATE FUNCTION dg_native_character_valid(p_job text,p_token text,p_completed boolean DEFAULT false) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j character_jobs%ROWTYPE;v jsonb;app text;
BEGIN
 SELECT app_env INTO app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user=worker_role;IF app IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Native character worker required';END IF;
 SELECT * INTO j FROM character_jobs WHERE id=p_job;v:=j.input_snapshot::jsonb;
 IF j.id IS NULL OR j.app_env<>app OR NOT dg_native_character_dependencies(p_job) OR NOT EXISTS(SELECT 1 FROM _dg_native_character_leases l WHERE l.job_id=p_job AND l.token=p_token AND l.lease_until::timestamptz>clock_timestamp()) THEN RETURN false;END IF;
 IF v->'project'<>'null'::jsonb AND NOT EXISTS(SELECT 1 FROM studio_projects p WHERE p.id=j.project_id AND p.workspace_id=j.workspace_id AND p.tenant_id=j.tenant_id AND p.archived=0 AND p.version=j.project_version) THEN RETURN false;END IF;
 IF v->'motion'<>'null'::jsonb AND NOT EXISTS(SELECT 1 FROM character_motion_plans p WHERE p.id=v->'motion'->>'id' AND p.version=(v->'motion'->>'version')::bigint AND p.payload::jsonb=v->'motion'->'content') THEN RETURN false;END IF;
 RETURN(NOT p_completed AND j.status='rendering' AND j.lease_token=p_token AND j.lease_until::timestamptz>clock_timestamp()) OR(p_completed AND j.status IN('succeeded','awaiting_review','unknown') AND EXISTS(SELECT 1 FROM _dg_native_character_outputs o WHERE o.job_id=j.id AND o.lease_token=p_token));
END $dg$;
CREATE FUNCTION dg_native_character_claim() RETURNS character_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j character_jobs%ROWTYPE;app text;t text:=gen_random_uuid()::text;deadline text;
BEGIN
 SELECT app_env INTO app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user=worker_role;IF app IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Native character worker required';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('native-character-production-capacity',0));
 DELETE FROM _dg_native_character_leases WHERE lease_until::timestamptz<=clock_timestamp();
 UPDATE character_jobs SET status=CASE WHEN attempts<3 THEN 'queued' ELSE 'failed' END,version=version+1,lease_token=NULL,lease_until=NULL,error_code='CHARACTER_INTERRUPTED',error_message='原处理租约已自然到期，保留固定输入和次数进行有界恢复。',updated_at=dg_utc_now() WHERE environment='mock' AND app_env=app AND status='rendering' AND lease_until::timestamptz<=clock_timestamp();
 IF(SELECT count(*) FROM _dg_native_character_leases)>=2 THEN RETURN NULL;END IF;
 SELECT r.* INTO j FROM character_jobs r WHERE r.environment='mock' AND r.app_env=app AND r.status='queued' AND r.attempts<3 AND NOT EXISTS(SELECT 1 FROM _dg_native_character_leases l WHERE l.job_id=r.id) ORDER BY r.created_at,r.id FOR UPDATE SKIP LOCKED LIMIT 1;
 IF j.id IS NULL THEN RETURN NULL;END IF;
 IF NOT dg_native_character_dependencies(j.id) THEN UPDATE character_jobs SET status='stale',version=version+1,error_code='CHARACTER_SOURCE_CHANGED',error_message='原固定来源失效，请重新创建任务。',updated_at=dg_utc_now() WHERE id=j.id;RETURN NULL;END IF;
 deadline:=to_char((clock_timestamp()+interval '30 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');INSERT INTO _dg_native_character_leases VALUES(j.id,t,deadline,dg_utc_now());
 UPDATE character_jobs SET status='rendering',attempts=attempts+1,version=version+1,lease_token=t,lease_until=deadline,error_code=NULL,error_message=NULL,updated_at=dg_utc_now() WHERE id=j.id RETURNING * INTO j;RETURN j;
END $dg$;
CREATE FUNCTION dg_native_character_hold(p_job text,p_token text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE deadline text;
BEGIN
 IF NOT dg_native_character_valid(p_job,p_token,false) THEN RETURN false;END IF;deadline:=to_char((clock_timestamp()+interval '30 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');UPDATE _dg_native_character_leases SET lease_until=deadline WHERE job_id=p_job AND token=p_token;UPDATE character_jobs SET lease_until=deadline WHERE id=p_job AND lease_token=p_token;RETURN true;
END $dg$;
CREATE FUNCTION dg_native_character_release(p_job text,p_token text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user=worker_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Native character worker required';END IF;
 DELETE FROM _dg_native_character_leases WHERE job_id=p_job AND token=p_token;RETURN FOUND;
END $dg$;
CREATE FUNCTION dg_native_character_fail(p_job text,p_token text,p_code text,p_message text,p_stopped boolean,p_stale boolean) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j character_jobs%ROWTYPE;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user=worker_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Native character worker required';END IF;
 SELECT * INTO j FROM character_jobs WHERE id=p_job FOR UPDATE;IF j.id IS NULL OR j.status<>'rendering' OR j.lease_token IS DISTINCT FROM p_token THEN RETURN false;END IF;
 UPDATE character_jobs SET status=CASE WHEN p_stale OR NOT dg_native_character_dependencies(p_job) THEN 'stale' WHEN p_stopped AND attempts<3 THEN 'queued' ELSE 'failed' END,version=version+1,lease_token=NULL,lease_until=NULL,error_code=left(p_code,80),error_message=left(p_message,500),updated_at=dg_utc_now() WHERE id=p_job;RETURN true;
END $dg$;
CREATE FUNCTION dg_native_commit_character(p_job text,p_token text,p_input text,p_receipt text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j character_jobs%ROWTYPE;r jsonb:=p_receipt::jsonb;o jsonb;app text;
BEGIN
 SELECT * INTO j FROM character_jobs WHERE id=p_job FOR UPDATE;
 IF NOT dg_native_character_valid(p_job,p_token,false) OR j.input_hash IS DISTINCT FROM p_input OR j.result IS NOT NULL OR r->>'inputHash' IS DISTINCT FROM p_input OR r->>'operation' IS DISTINCT FROM j.operation OR(r->>'attempt')::bigint IS DISTINCT FROM j.attempts OR jsonb_typeof(r->'outputs') IS DISTINCT FROM 'array' OR jsonb_typeof(r->'result') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Actual character completion lost its input, operation, attempt or lease';END IF;
 IF j.operation='quality' THEN
  IF r->>'status'<>'succeeded' OR jsonb_array_length(r->'outputs')<>0 OR r->>'qualityHash' IS NULL OR r->>'qualityHash' !~ '^[a-f0-9]{64}$' OR r->'result'->'quality'->>'sourceSHA256' IS DISTINCT FROM j.input_snapshot::jsonb->'source'->>'sha256' THEN RAISE EXCEPTION 'Quality report must describe the actual fixed source';END IF;
 ELSIF j.operation='mock_training' THEN
  IF r->>'status' NOT IN('awaiting_review','unknown') OR jsonb_array_length(r->'outputs')<>0 OR r->'result'->>'provider' IS DISTINCT FROM 'mock-character' OR r->'result'->>'simulated' IS DISTINCT FROM 'true' OR r->'result'->>'realModelCreated' IS DISTINCT FROM 'false' OR r->'result'->>'mockOperationId' IS DISTINCT FROM j.id OR r->'result'->>'mockOutcome' IS DISTINCT FROM 'succeeded' THEN RAISE EXCEPTION 'Explicit mock preparation cannot create a real model or auto-accept';END IF;
 ELSE
  IF r->>'status'<>'succeeded' OR jsonb_array_length(r->'outputs')<>1 OR r->'result'->>'localActualFile' IS DISTINCT FROM 'true' OR r->'result'->>'realModelCreated' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'Reference and motion produce one actual local media file';END IF;
  o:=r->'outputs'->0;
  IF jsonb_typeof(o) IS DISTINCT FROM 'object' OR NOT(o ?& ARRAY['mediaType','storageKey','sha256','size','width','height','specs','assetId','durationMs','name']) THEN RAISE EXCEPTION 'Actual character file metadata must be complete';END IF;
  IF o->>'mediaType' NOT IN('image/png','video/mp4') OR o->>'storageKey' !~ '^[a-f0-9-]{36}\.bin$' OR o->>'sha256' !~ '^[a-f0-9]{64}$' OR(o->>'size')::bigint NOT BETWEEN 1 AND 134217728 OR(o->>'width')::bigint NOT BETWEEN 1 AND 4096 OR(o->>'height')::bigint NOT BETWEEN 1 AND 4096 OR o->'assetId' IS DISTINCT FROM 'null'::jsonb OR(o->>'mediaType'='video/mp4' AND(o->'poster' IS NULL OR o->'poster'='null'::jsonb OR o->'poster'->>'storageKey' !~ '^[a-f0-9-]{36}\.bin$' OR o->'poster'->>'sha256' !~ '^[a-f0-9]{64}$' OR(o->'poster'->>'size')::bigint NOT BETWEEN 1 AND 8388608)) OR(j.operation='motion' AND o->>'mediaType'<>'video/mp4') THEN RAISE EXCEPTION 'Actual character media object or checked poster is invalid';END IF;
 END IF;
 INSERT INTO _dg_native_character_outputs VALUES(j.id,p_token,j.input_hash,p_receipt,encode(sha256(convert_to(p_receipt,'UTF8')),'hex'),r->>'qualityHash',dg_utc_now());
 UPDATE character_jobs SET status=r->>'status',outputs=(r->'outputs')::text,result=(r->'result')::text,version=version+1,lease_token=NULL,lease_until=NULL,error_code=NULL,error_message=NULL,updated_at=dg_utc_now() WHERE id=j.id;
 INSERT INTO audit_events VALUES(gen_random_uuid()::text,j.tenant_id,j.workspace_id,j.actor_id,'character.'||j.operation||'_completed',j.id,'confirmed',p_token,dg_utc_now());
 INSERT INTO outbox_events VALUES(gen_random_uuid()::text,j.tenant_id,j.workspace_id,j.id,'character.'||j.operation||'_completed','mock','{}',dg_utc_now(),NULL);RETURN j.id;
END $dg$;

CREATE FUNCTION dg_native_character_materialize(p_job text,p_actor text,p_asset text,p_upload text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j character_jobs%ROWTYPE;r jsonb;o jsonb;v jsonb;c studio_characters%ROWTYPE;a assets%ROWTYPE;t consents%ROWTYPE;deadline text;synth bigint;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user=app_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Native character application API required';END IF;
 SELECT * INTO j FROM character_jobs WHERE id=p_job FOR UPDATE;v:=j.input_snapshot::jsonb;
 IF j.id IS NULL OR j.status<>'succeeded' OR j.operation NOT IN('reference','motion') OR j.applied_project_version IS NOT NULL OR NOT dg_native_character_dependencies(j.id) OR NOT EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=p_actor AND m.tenant_id=j.tenant_id AND m.role IN('admin','editor') AND m.workspace_ids::jsonb ? j.workspace_id) OR NOT EXISTS(SELECT 1 FROM studio_projects p WHERE p.id=j.project_id AND p.version=j.project_version AND p.archived=0) THEN RAISE EXCEPTION 'Actual character application requires current fixed sources, project and actor';END IF;
 SELECT x.receipt::jsonb INTO r FROM _dg_native_character_outputs x WHERE x.job_id=j.id AND x.input_hash=j.input_hash;IF r IS NULL OR jsonb_array_length(r->'outputs')<>1 THEN RAISE EXCEPTION 'Actual character receipt is required';END IF;o:=r->'outputs'->0;
 SELECT * INTO c FROM studio_characters WHERE id=j.character_id;SELECT * INTO a FROM assets WHERE id=c.source_asset_id;SELECT * INTO t FROM consents WHERE id=c.consent_id;
 SELECT to_char(min(x::timestamptz) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') INTO deadline FROM unnest(ARRAY[c.expires_at,t.expires_at,a.expires_at,(SELECT z.expires_at FROM assets z WHERE z.id=v->'voice'->>'id')]) x WHERE x IS NOT NULL;
 synth:=CASE WHEN j.operation='motion' OR v->'source'->>'mediaType' IN('application/vnd.digitalguide.puppet+json','model/gltf-binary') OR(v->'source'->>'synthetic')::boolean THEN 1 ELSE 0 END;
 INSERT INTO uploads VALUES(p_upload,j.tenant_id,j.workspace_id,p_actor,o->>'storageKey',o->>'sha256',(o->>'size')::bigint,o->>'mediaType',(o->'specs')::text,dg_utc_now());
 INSERT INTO assets(id,tenant_id,workspace_id,upload_id,name,category,synthetic,expires_at,created_at) VALUES(p_asset,j.tenant_id,j.workspace_id,p_upload,'形象制作 · '||(o->>'name'),'avatar',synth,deadline,dg_utc_now());
 INSERT INTO _dg_native_asset_origins VALUES(p_asset,p_upload,j.tenant_id,j.workspace_id,o->>'sha256',(o->>'size')::bigint,'character_render','mock',j.app_env,dg_utc_now());
 INSERT INTO character_derivations VALUES(p_asset,j.character_id,v->'source'->>'id',(v->'source'->>'version')::bigint,v->'character'->>'consentId',v->'voice'->>'id',(v->'voice'->>'version')::bigint,dg_utc_now());
 INSERT INTO _dg_native_character_assets VALUES(p_asset,j.id,p_upload,deadline,synth,dg_utc_now());
 IF o->>'mediaType'='video/mp4' THEN INSERT INTO video_sources VALUES(p_asset,o->'poster'->>'storageKey',o->'poster'->>'sha256',(o->'poster'->>'size')::bigint,dg_utc_now());END IF;RETURN p_asset;
END $dg$;
CREATE FUNCTION dg_native_character_application_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j character_jobs%ROWTYPE;b _dg_native_character_assets%ROWTYPE;
BEGIN
 SELECT * INTO b FROM _dg_native_character_assets WHERE asset_id=NEW.asset_id;SELECT * INTO j FROM character_jobs WHERE id=b.job_id;
 IF b.asset_id IS NULL OR j.id IS NULL OR j.applied_project_version IS DISTINCT FROM j.project_version+1 OR NOT EXISTS(SELECT 1 FROM studio_project_versions v CROSS JOIN LATERAL jsonb_array_elements(v.document::jsonb->'timeline'->'tracks') t CROSS JOIN LATERAL jsonb_array_elements(t->'clips') c WHERE v.project_id=j.project_id AND v.version=j.applied_project_version AND t->>'type'='avatar' AND c->'source'->>'assetId'=b.asset_id) THEN RAISE EXCEPTION 'Character asset, task application and project revision commit together';END IF;RETURN NULL;
END $dg$;
CREATE CONSTRAINT TRIGGER native_character_application_guard AFTER INSERT ON _dg_native_character_assets DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_character_application_guard();

DO $dg$ DECLARE signature text;BEGIN FOREACH signature IN ARRAY ARRAY['dg_native_character_dependencies(text)','dg_native_character_motion_valid(text,text)','dg_native_character_plan_guard()','dg_native_character_plan_history()','dg_native_character_motion_version_guard()','dg_native_character_job_guard()','dg_native_character_input_record()','dg_native_character_invalidate()','dg_native_character_valid(text,text,boolean)','dg_native_character_claim()','dg_native_character_hold(text,text)','dg_native_character_release(text,text)','dg_native_character_fail(text,text,text,text,boolean,boolean)','dg_native_commit_character(text,text,text,text)','dg_native_character_materialize(text,text,text,text)','dg_native_character_application_guard()'] LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||signature||' FROM PUBLIC';END LOOP;END $dg$;
