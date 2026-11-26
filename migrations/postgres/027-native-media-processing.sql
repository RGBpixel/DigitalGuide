-- R-058/R-076/R-078/R-079/R-080: isolated native validation; applied001-026 unchanged.
ALTER TABLE _dg_native_asset_origins DROP CONSTRAINT native_asset_source_kind;
ALTER TABLE _dg_native_asset_origins ADD CONSTRAINT native_asset_source_kind CHECK(source_kind IN('private_upload','package_import','video_upload','system_speech','media_processing'));
CREATE TABLE _dg_native_processing_inputs(job_id text PRIMARY KEY REFERENCES studio_media_jobs(id),input_snapshot text NOT NULL,input_hash text NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),created_at text NOT NULL);
CREATE TABLE _dg_native_processing_outputs(job_id text PRIMARY KEY REFERENCES studio_media_jobs(id),lease_token text NOT NULL,input_hash text NOT NULL,report text NOT NULL,report_hash text NOT NULL CHECK(report_hash ~ '^[a-f0-9]{64}$'),files text NOT NULL CHECK(jsonb_typeof(files::jsonb)='array'),created_at text NOT NULL);
CREATE TABLE _dg_native_processing_leases(job_id text PRIMARY KEY REFERENCES studio_media_jobs(id),token text NOT NULL,lease_until text NOT NULL);
DO $dg$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['_dg_native_processing_inputs','_dg_native_processing_outputs','studio_media_outputs','studio_media_plan_versions'] LOOP EXECUTE format('CREATE TRIGGER native_processing_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION dg_native_append_only()',t);END LOOP;END;$dg$;
ALTER TABLE studio_media_jobs ADD CONSTRAINT native_processing_shape CHECK(environment='mock' AND app_env IN('development','sandbox') AND version>0 AND attempts BETWEEN 0 AND 3 AND progress BETWEEN 0 AND 1 AND status IN('queued','processing','succeeded','awaiting_review','accepted_mock','rejected','failed','cancelled','stale') AND input_hash ~ '^[a-f0-9]{64}$' AND jsonb_typeof(input_snapshot::jsonb)='object' AND((status='processing' AND lease_token IS NOT NULL AND lease_until IS NOT NULL) OR(status<>'processing' AND lease_token IS NULL AND lease_until IS NULL)) AND(status NOT IN('succeeded','awaiting_review','accepted_mock','rejected') OR report IS NOT NULL));
CREATE UNIQUE INDEX native_processing_active ON studio_media_jobs(plan_id,input_hash) WHERE status IN('queued','processing');
CREATE FUNCTION dg_native_processing_plan_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE app text;
BEGIN
 SELECT app_env INTO app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user=app_role;
 IF app IS NULL OR NEW.app_env<>app OR NEW.environment<>'mock' OR NEW.version<1 OR NEW.plan_hash !~ '^[a-f0-9]{64}$' OR NOT EXISTS(SELECT 1 FROM workspaces WHERE id=NEW.workspace_id AND tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native processing plan scope is invalid';END IF;
 IF TG_OP='INSERT' THEN IF NEW.version<>1 OR NEW.withdrawn_at IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Processing plan starts at version one';END IF;
 ELSE IF OLD.withdrawn_at IS NOT NULL OR NEW.version<>OLD.version+1 OR to_jsonb(NEW)-ARRAY['name','payload','plan_hash','version','withdrawn_at','updated_at'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['name','payload','plan_hash','version','withdrawn_at','updated_at'] THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Processing plan identity and permanent withdrawal cannot change';END IF;END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_processing_plan_guard BEFORE INSERT OR UPDATE ON studio_media_plans FOR EACH ROW EXECUTE FUNCTION dg_native_processing_plan_guard();
CREATE FUNCTION dg_native_processing_revision_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN IF NOT EXISTS(SELECT 1 FROM studio_media_plans p WHERE p.id=NEW.plan_id AND p.version=NEW.version AND p.payload=NEW.payload AND p.plan_hash=NEW.plan_hash AND p.actor_id=NEW.actor_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Plan history must match its exact version';END IF;RETURN NEW;END;$dg$;
CREATE TRIGGER native_processing_revision_guard BEFORE INSERT ON studio_media_plan_versions FOR EACH ROW EXECUTE FUNCTION dg_native_processing_revision_guard();
CREATE FUNCTION dg_native_processing_job_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE app text;api boolean;worker boolean;mutable text[];heartbeat boolean;
BEGIN
 SELECT app_env,session_user=app_role,session_user=worker_role INTO app,api,worker FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only';
 IF app IS NULL OR NOT(api OR worker) OR NEW.app_env<>app OR NEW.environment<>'mock' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid native processing role or environment';END IF;
 IF TG_OP='INSERT' THEN
  IF NOT api OR NEW.status<>'queued' OR NEW.version<>1 OR NEW.attempts<>0 OR NEW.report IS NOT NULL OR NOT EXISTS(SELECT 1 FROM studio_media_plans p WHERE p.id=NEW.plan_id AND p.tenant_id=NEW.tenant_id AND p.workspace_id=NEW.workspace_id AND p.actor_id=NEW.actor_id AND p.version=NEW.plan_version AND p.payload=NEW.input_snapshot AND p.plan_hash=NEW.input_hash AND p.withdrawn_at IS NULL) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Processing jobs require a fixed current plan';END IF;RETURN NEW;
 END IF;
 mutable:=ARRAY['status','version','progress','attempts','lease_token','lease_until','error_code','error_message','updated_at'];IF worker AND OLD.report IS NULL THEN mutable:=mutable||ARRAY['report'];END IF;
 heartbeat:=worker AND NEW.status='processing' AND OLD.status='processing' AND NEW.version=OLD.version AND to_jsonb(NEW)-ARRAY['progress','lease_until','updated_at'] IS NOT DISTINCT FROM to_jsonb(OLD)-ARRAY['progress','lease_until','updated_at'];
 IF to_jsonb(NEW)-mutable IS DISTINCT FROM to_jsonb(OLD)-mutable OR(NOT heartbeat AND NEW.version<>OLD.version+1) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Processing input and completed report are immutable';END IF;
 IF NEW.attempts<>OLD.attempts AND(NOT worker OR NEW.status<>'processing' OR NEW.attempts<>OLD.attempts+1 OR NEW.lease_token IS NOT DISTINCT FROM OLD.lease_token) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Only a new worker lease advances attempts';END IF;
 IF OLD.status<>NEW.status AND NOT(OLD.status='queued' AND NEW.status IN('processing','cancelled','stale') OR OLD.status='processing' AND NEW.status IN('queued','succeeded','awaiting_review','failed','cancelled','stale') OR OLD.status IN('failed','cancelled','stale') AND NEW.status='queued' AND NEW.attempts<3 AND NEW.report IS NULL OR OLD.status='awaiting_review' AND NEW.status IN('accepted_mock','rejected')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid processing state transition';END IF;
 IF NEW.status IN('succeeded','awaiting_review') AND OLD.status='processing' AND NOT worker OR NEW.status='processing' AND NOT worker THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Only worker execution produces media';END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_processing_job_guard BEFORE INSERT OR UPDATE ON studio_media_jobs FOR EACH ROW EXECUTE FUNCTION dg_native_processing_job_guard();
CREATE FUNCTION dg_native_processing_valid(target text,expected_token text,completed boolean) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE app text;j studio_media_jobs%ROWTYPE;p studio_media_plans%ROWTYPE;
BEGIN
 SELECT app_env INTO app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user=worker_role;IF app IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only native processing worker validates leases';END IF;
 SELECT * INTO j FROM studio_media_jobs WHERE id=target;SELECT * INTO p FROM studio_media_plans WHERE id=j.plan_id;
 IF j.id IS NULL OR p.id IS NULL OR j.environment<>'mock' OR j.app_env<>app OR p.withdrawn_at IS NOT NULL OR p.payload::jsonb->'rights'->>'expiresAt'<=dg_utc_now() OR j.input_snapshot::jsonb->'rights'->>'expiresAt'<=dg_utc_now() OR NOT EXISTS(SELECT 1 FROM _dg_native_processing_inputs i WHERE i.job_id=j.id AND i.input_hash=j.input_hash AND i.input_snapshot=j.input_snapshot) OR NOT EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=j.actor_id AND m.tenant_id=j.tenant_id AND m.role IN('admin','editor') AND m.workspace_ids::jsonb ? j.workspace_id) OR NOT EXISTS(SELECT 1 FROM _dg_native_processing_leases l WHERE l.job_id=j.id AND l.token=expected_token AND l.lease_until>dg_utc_now()) THEN RETURN false;END IF;
 RETURN(NOT completed AND j.status='processing' AND j.lease_token=expected_token AND j.lease_until>dg_utc_now()) OR(completed AND j.status IN('succeeded','awaiting_review') AND EXISTS(SELECT 1 FROM _dg_native_processing_outputs o WHERE o.job_id=j.id AND o.lease_token=expected_token));
END;$dg$;
CREATE FUNCTION dg_native_processing_claim() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE app text;j studio_media_jobs%ROWTYPE;token text:=gen_random_uuid()::text;until_at text;
BEGIN
 SELECT app_env INTO app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user=worker_role;IF app IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only native processing worker claims';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('native-media-processing-capacity',0)) THEN RETURN NULL;END IF;
 DELETE FROM _dg_native_processing_leases WHERE lease_until<=dg_utc_now();
 UPDATE studio_media_jobs SET status='failed',version=version+1,lease_token=NULL,lease_until=NULL,error_code='MEDIA_RETRY_LIMIT',error_message='媒体加工已到三次执行上限，请重新审阅。',updated_at=dg_utc_now() WHERE environment='mock' AND app_env=app AND status='processing' AND lease_until<=dg_utc_now() AND attempts>=3;
 IF EXISTS(SELECT 1 FROM _dg_native_processing_leases WHERE lease_until>dg_utc_now()) THEN RETURN NULL;END IF;
 SELECT * INTO j FROM studio_media_jobs t WHERE t.environment='mock' AND t.app_env=app AND t.attempts<3 AND(t.status='queued' OR t.status='processing' AND t.lease_until<=dg_utc_now()) AND NOT EXISTS(SELECT 1 FROM _dg_native_processing_leases l WHERE l.job_id=t.id) ORDER BY t.created_at,t.id LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF j.id IS NULL THEN RETURN NULL;END IF;until_at:=to_char((clock_timestamp()+interval '30 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 UPDATE studio_media_jobs SET status='processing',version=version+1,progress=0,attempts=attempts+1,lease_token=token,lease_until=until_at,error_code=NULL,error_message=NULL,updated_at=dg_utc_now() WHERE id=j.id RETURNING * INTO j;
 INSERT INTO _dg_native_processing_leases VALUES(j.id,token,until_at);RETURN to_jsonb(j);
END;$dg$;
CREATE FUNCTION dg_native_processing_hold(target text,expected_token text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND session_user=worker_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only native processing worker holds';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('native-media-processing-capacity',0));UPDATE _dg_native_processing_leases SET lease_until=to_char((clock_timestamp()+interval '30 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') WHERE job_id=target AND token=expected_token AND lease_until>dg_utc_now();RETURN FOUND;
END;$dg$;
CREATE FUNCTION dg_native_processing_renew(target text,expected_token text,fraction double precision) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN IF fraction IS NULL OR fraction<0 OR fraction>0.96 OR NOT dg_native_processing_valid(target,expected_token,false) THEN RETURN false;END IF;UPDATE studio_media_jobs SET lease_until=to_char((clock_timestamp()+interval '30 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),progress=greatest(progress,fraction),updated_at=dg_utc_now() WHERE id=target;RETURN true;END;$dg$;
CREATE FUNCTION dg_native_processing_release(target text,expected_token text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND session_user=worker_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only native processing worker releases';END IF;PERFORM pg_advisory_xact_lock(hashtextextended('native-media-processing-capacity',0));DELETE FROM _dg_native_processing_leases WHERE job_id=target AND token=expected_token;RETURN FOUND;END;$dg$;
CREATE FUNCTION dg_native_processing_fail(target text,expected_token text,code text,message text,stopped boolean,source_stale boolean) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND session_user=worker_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only native processing worker fails';END IF;
 UPDATE studio_media_jobs SET status=CASE WHEN source_stale THEN 'stale' WHEN stopped AND attempts<3 THEN 'queued' ELSE 'failed' END,version=version+1,lease_token=NULL,lease_until=NULL,error_code=left(code,100),error_message=left(message,1000),updated_at=dg_utc_now() WHERE id=target AND status='processing' AND lease_token=expected_token AND lease_until>dg_utc_now();RETURN FOUND;
END;$dg$;
CREATE FUNCTION dg_native_commit_processing(target text,expected_token text,actual_input text,report_text text,report_digest text,files_text text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j studio_media_jobs%ROWTYPE;r jsonb:=report_text::jsonb;files jsonb:=files_text::jsonb;f jsonb;a assets%ROWTYPE;at_time text:=dg_utc_now();mock boolean;
BEGIN
 PERFORM user_id FROM dg_native_locked_membership((SELECT actor_id FROM studio_media_jobs WHERE id=target));SELECT * INTO j FROM studio_media_jobs WHERE id=target FOR UPDATE;
 IF NOT dg_native_processing_valid(target,expected_token,false) OR j.input_hash IS DISTINCT FROM actual_input OR j.report IS NOT NULL OR report_digest !~ '^[a-f0-9]{64}$' OR jsonb_typeof(files)<>'array' OR jsonb_array_length(files)>20 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Processing completion lost its fixed lease or input';END IF;
 mock:=j.input_snapshot::jsonb->'configuration'->>'provider'='mock-media';
 IF r->>'provider' IS DISTINCT FROM j.input_snapshot::jsonb->'configuration'->>'provider' OR(r->>'simulated')::boolean IS DISTINCT FROM mock OR(r->>'realAlgorithm')::boolean IS DISTINCT FROM(NOT mock) OR mock AND jsonb_array_length(files)<>0 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Mock processing cannot produce real media';END IF;
 INSERT INTO _dg_native_processing_outputs VALUES(j.id,expected_token,j.input_hash,report_text,report_digest,files_text,at_time);
 FOR f IN SELECT value FROM jsonb_array_elements(files) LOOP
  IF f->>'mediaType' NOT IN('image/png','audio/wav','video/mp4','video/quicktime') OR f->'object'->>'storage_key' !~ '^[a-f0-9-]{36}\.bin$' OR f->'object'->>'sha256' !~ '^[a-f0-9]{64}$' OR(f->'object'->>'size')::bigint NOT BETWEEN 1 AND 1073741824 OR f->>'expiresAt'>j.input_snapshot::jsonb->'rights'->>'expiresAt' OR f->>'expiresAt'<=at_time OR(f->>'mediaType' IN('video/mp4','video/quicktime') AND f->'poster'='null'::jsonb) OR(f->>'mediaType'='video/quicktime' AND f->'preview'='null'::jsonb) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Media output object or inherited deadline is invalid';END IF;
  INSERT INTO uploads VALUES(f->>'uploadId',j.tenant_id,j.workspace_id,j.actor_id,f->'object'->>'storage_key',f->'object'->>'sha256',(f->'object'->>'size')::bigint,f->>'mediaType',(f->'specs')::text,at_time);
  INSERT INTO assets(id,tenant_id,workspace_id,upload_id,name,category,synthetic,expires_at,created_at) VALUES(f->>'assetId',j.tenant_id,j.workspace_id,f->>'uploadId',f->>'name',CASE WHEN f->>'mediaType'='audio/wav' THEN 'voice' ELSE 'reference' END,CASE WHEN(j.input_snapshot::jsonb->'source'->>'synthetic')::boolean THEN 1 ELSE 0 END,f->>'expiresAt',at_time) RETURNING * INTO a;
  INSERT INTO _dg_native_asset_origins VALUES(a.id,a.upload_id,j.tenant_id,j.workspace_id,f->'object'->>'sha256',(f->'object'->>'size')::bigint,'media_processing','mock',j.app_env,at_time);
  IF f->'poster'<>'null'::jsonb THEN INSERT INTO video_sources VALUES(a.id,f->'poster'->>'storage_key',f->'poster'->>'sha256',(f->'poster'->>'size')::bigint,at_time);END IF;
  IF f->'preview'<>'null'::jsonb THEN INSERT INTO alpha_video_previews VALUES(a.id,f->'preview'->>'storage_key',f->'preview'->>'sha256',(f->'preview'->>'size')::bigint,at_time);END IF;
  INSERT INTO studio_media_outputs VALUES(f->>'id',j.id,a.id,f->>'name',f->>'mediaType',f->'object'->>'storage_key',(f->'object'->>'size')::bigint,f->'object'->>'sha256',(f->'specs')::text,(f->>'sourceStartMs')::bigint,(f->>'sourceDurationMs')::bigint,CASE WHEN(f->>'alpha')::boolean THEN 1 ELSE 0 END,f->'preview'->>'storage_key',f->'preview'->>'sha256',(f->'preview'->>'size')::bigint,at_time);
  INSERT INTO asset_versions VALUES(a.id,1,jsonb_build_object('id',a.id,'workspaceId',a.workspace_id,'name',a.name,'category',a.category,'version',1,'archived',false,'synthetic',a.synthetic=1,'expiresAt',a.expires_at,'createdAt',a.created_at,'mediaType',f->>'mediaType','size',(f->'object'->>'size')::bigint,'sha256',f->'object'->>'sha256','specs',f->'specs')::text,at_time);
 END LOOP;
 UPDATE studio_media_jobs SET status=CASE WHEN mock THEN 'awaiting_review' ELSE 'succeeded' END,version=version+1,progress=1,lease_token=NULL,lease_until=NULL,report=report_text,error_code=NULL,error_message=NULL,updated_at=at_time WHERE id=j.id;RETURN j.id;
END;$dg$;
CREATE FUNCTION dg_native_processing_asset_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN IF NEW.source_kind='media_processing' AND NOT EXISTS(SELECT 1 FROM studio_media_outputs o JOIN _dg_native_processing_outputs r ON r.job_id=o.job_id JOIN assets a ON a.id=o.asset_id WHERE o.asset_id=NEW.asset_id AND a.upload_id=NEW.upload_id AND o.sha256=NEW.sha256 AND o.size=NEW.size AND EXISTS(SELECT 1 FROM jsonb_array_elements(r.files::jsonb) f WHERE f->>'assetId'=a.id AND f->>'id'=o.id AND f->'object'->>'sha256'=o.sha256 AND f->'object'->>'storage_key'=o.storage_key)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Processing assets require immutable worker output receipts';END IF;RETURN NULL;END;$dg$;
CREATE CONSTRAINT TRIGGER native_processing_asset_guard AFTER INSERT ON _dg_native_asset_origins DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_processing_asset_guard();
CREATE FUNCTION dg_native_processing_expiry_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE cutoff text;synthetic bigint;
BEGIN SELECT f->>'expiresAt',CASE WHEN(j.input_snapshot::jsonb->'source'->>'synthetic')::boolean THEN 1 ELSE 0 END INTO cutoff,synthetic FROM studio_media_outputs o JOIN studio_media_jobs j ON j.id=o.job_id JOIN _dg_native_processing_outputs r ON r.job_id=j.id CROSS JOIN LATERAL jsonb_array_elements(r.files::jsonb) f WHERE o.asset_id=OLD.id AND f->>'assetId'=OLD.id;
 IF FOUND AND(NEW.expires_at IS NULL OR NEW.expires_at>cutoff OR NEW.synthetic<>synthetic) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Processed media cannot relax inherited expiry or synthetic identity';END IF;RETURN NEW;END;$dg$;
CREATE TRIGGER native_processing_expiry_guard BEFORE UPDATE ON assets FOR EACH ROW EXECUTE FUNCTION dg_native_processing_expiry_guard();
CREATE FUNCTION dg_native_processing_application_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
 IF TG_OP='UPDATE' THEN IF OLD.reverted_version IS NOT NULL OR NEW.reverted_version IS NULL OR to_jsonb(NEW)-'reverted_version' IS DISTINCT FROM to_jsonb(OLD)-'reverted_version' OR NOT EXISTS(SELECT 1 FROM studio_projects WHERE id=NEW.project_id AND version=NEW.reverted_version) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Media adoption identity is immutable and reverts once';END IF;
 ELSE IF NOT EXISTS(SELECT 1 FROM studio_media_jobs j JOIN studio_projects p ON p.id=NEW.project_id WHERE j.id=NEW.job_id AND j.actor_id=NEW.actor_id AND j.status='succeeded' AND p.tenant_id=j.tenant_id AND p.workspace_id=j.workspace_id AND p.version=NEW.applied_version) OR NEW.kind NOT IN('new_project','append','replace_clip') OR NEW.reverted_version IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Media adoption requires the current real job and same workspace';END IF;END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_processing_application_guard BEFORE INSERT OR UPDATE ON studio_media_applications FOR EACH ROW EXECUTE FUNCTION dg_native_processing_application_guard();
DO $dg$ DECLARE f record;BEGIN FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace=current_schema()::regnamespace AND proname LIKE 'dg_native_%processing%' LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||f.signature||' FROM PUBLIC';END LOOP;END;$dg$;
