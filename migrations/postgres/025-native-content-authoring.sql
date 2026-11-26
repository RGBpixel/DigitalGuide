-- Fresh native validation only. Applied001-024 remain unchanged.
CREATE TABLE _dg_native_content_source_inputs(source_id text PRIMARY KEY REFERENCES studio_content_sources(id),storage_key text NOT NULL CHECK(storage_key ~ '^[a-f0-9-]{36}\.bin$'),size bigint NOT NULL CHECK(size BETWEEN 1 AND 8388608),material_sha256 text NOT NULL CHECK(material_sha256 ~ '^[a-f0-9]{64}$'),text_sha256 text NOT NULL CHECK(text_sha256 ~ '^[a-f0-9]{64}$'),origin_sha256 text NOT NULL CHECK(origin_sha256 ~ '^[a-f0-9]{64}$'),created_at text NOT NULL);
CREATE TABLE _dg_native_content_origins(origin_id text PRIMARY KEY REFERENCES studio_content_origins(id),payload text NOT NULL,payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),created_at text NOT NULL);
CREATE TABLE _dg_native_content_plan_applications(plan_id text PRIMARY KEY REFERENCES studio_content_plans(id),plan_version bigint NOT NULL CHECK(plan_version>0),plan_hash text NOT NULL CHECK(plan_hash ~ '^[a-f0-9]{64}$'),resource_id text NOT NULL,resource_version bigint NOT NULL CHECK(resource_version>0),actor_id text NOT NULL,created_at text NOT NULL);
CREATE TABLE _dg_native_writing_inputs(job_id text PRIMARY KEY REFERENCES studio_content_writing_jobs(id),tenant_id text NOT NULL,workspace_id text NOT NULL,actor_id text NOT NULL,request text NOT NULL,engine text NOT NULL,input_hash text NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),created_at text NOT NULL);
CREATE TABLE _dg_native_writing_outputs(job_id text PRIMARY KEY REFERENCES studio_content_writing_jobs(id),lease_token text NOT NULL,input_hash text NOT NULL,result text NOT NULL,evidence text NOT NULL,result_hash text NOT NULL CHECK(result_hash ~ '^[a-f0-9]{64}$'),created_at text NOT NULL);
CREATE TABLE _dg_native_writing_adoptions(job_id text NOT NULL REFERENCES studio_content_writing_jobs(id),variant_index bigint NOT NULL CHECK(variant_index BETWEEN 0 AND 2),draft_id text NOT NULL UNIQUE REFERENCES studio_content_drafts(id),input_hash text NOT NULL,result_hash text NOT NULL,created_at text NOT NULL,PRIMARY KEY(job_id,variant_index));
DO $dg$ DECLARE target text;BEGIN
 FOREACH target IN ARRAY ARRAY['_dg_native_content_source_inputs','_dg_native_content_origins','_dg_native_content_plan_applications','_dg_native_writing_inputs','_dg_native_writing_outputs','_dg_native_writing_adoptions','studio_content_source_versions','studio_content_brief_versions','studio_content_draft_versions','studio_content_plan_versions','studio_content_origins','studio_content_writing_adoptions'] LOOP
  EXECUTE format('CREATE TRIGGER native_content_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION dg_native_append_only()',target);
 END LOOP;
END;$dg$;
ALTER TABLE studio_content_sources ADD CONSTRAINT native_content_source_shape CHECK(version>0 AND withdrawn IN(0,1) AND environment='mock' AND app_env IN('development','sandbox') AND kind IN('text','docx','web','video') AND char_length(text) BETWEEN 1 AND 60000 AND jsonb_typeof(paragraphs::jsonb)='array' AND jsonb_typeof(origin::jsonb)='object' AND jsonb_typeof(warnings::jsonb)='array' AND text_sha256=encode(sha256(convert_to(text,'UTF8')),'hex'));
ALTER TABLE studio_content_briefs ADD CONSTRAINT native_content_brief_shape CHECK(version>0 AND environment='mock' AND app_env IN('development','sandbox') AND jsonb_typeof(configuration::jsonb)='object');
ALTER TABLE studio_content_drafts ADD CONSTRAINT native_content_draft_shape CHECK(version>0 AND environment='mock' AND app_env IN('development','sandbox') AND jsonb_typeof(payload::jsonb)='object' AND jsonb_typeof(payload::jsonb->'sourceRefs')='array' AND jsonb_typeof(payload::jsonb->'sections')='array');
ALTER TABLE studio_content_plans ADD CONSTRAINT native_content_plan_shape CHECK(version>0 AND draft_version>0 AND environment='mock' AND app_env IN('development','sandbox') AND kind IN('draft_edit','new_project','project_patch') AND status IN('review','applied','cancelled') AND ((status='applied' AND applied_resource_id IS NOT NULL AND applied_resource_version IS NOT NULL) OR(status<>'applied' AND applied_resource_id IS NULL AND applied_resource_version IS NULL)));
CREATE FUNCTION dg_native_content_configuration_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE current_app text;mutable text[];
BEGIN
 SELECT app_env INTO current_app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user=app_role;
 IF current_app IS NULL OR NEW.environment<>'mock' OR NEW.app_env<>current_app OR NOT EXISTS(SELECT 1 FROM workspaces WHERE id=NEW.workspace_id AND tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native content scope is invalid';END IF;
 IF TG_TABLE_NAME='studio_content_sources' THEN
  mutable:=ARRAY['withdrawn','version','updated_at'];
  IF TG_OP='INSERT' AND(NEW.withdrawn<>0 OR NEW.expires_at<=dg_utc_now()) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='New content needs current explicit rights';END IF;
  IF TG_OP='UPDATE' AND(OLD.withdrawn<>0 OR NEW.withdrawn<>1) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Content withdrawal is permanent';END IF;
 ELSIF TG_TABLE_NAME='studio_content_briefs' THEN mutable:=ARRAY['configuration','version','updated_at'];
 ELSIF TG_TABLE_NAME='studio_content_drafts' THEN
  mutable:=ARRAY['payload','version','updated_at'];
  IF TG_OP='INSERT' AND(NEW.parent_id IS NULL AND NEW.root_id<>NEW.id OR NEW.parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM studio_content_drafts d WHERE d.id=NEW.parent_id AND d.root_id=NEW.root_id AND d.tenant_id=NEW.tenant_id AND d.workspace_id=NEW.workspace_id AND d.environment=NEW.environment AND d.app_env=NEW.app_env)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Draft parent and root must share the current scope';END IF;
 ELSE
  mutable:=ARRAY['snapshot','plan_hash','status','version','applied_resource_id','applied_resource_version','updated_at'];
  IF NOT EXISTS(SELECT 1 FROM studio_content_drafts d WHERE d.id=NEW.draft_id AND d.tenant_id=NEW.tenant_id AND d.workspace_id=NEW.workspace_id AND d.environment=NEW.environment AND d.app_env=NEW.app_env) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Content plan draft scope is invalid';END IF;
  IF TG_OP='INSERT' AND NEW.status<>'review' OR TG_OP='UPDATE' AND(OLD.status<>'review' OR NEW.status<>'review' AND(NEW.snapshot<>OLD.snapshot OR NEW.plan_hash<>OLD.plan_hash)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Closed content decisions cannot be rewritten';END IF;
 END IF;
 IF TG_OP='INSERT' THEN IF NEW.version<>1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Content configuration starts at version one';END IF;
 ELSIF NEW.version<>OLD.version+1 OR to_jsonb(NEW)-mutable IS DISTINCT FROM to_jsonb(OLD)-mutable THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Content identity is immutable and versions advance once';END IF;RETURN NEW;
END;$dg$;
DO $dg$ DECLARE target text;BEGIN FOREACH target IN ARRAY ARRAY['studio_content_sources','studio_content_briefs','studio_content_drafts','studio_content_plans'] LOOP EXECUTE format('CREATE TRIGGER native_content_configuration_guard BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION dg_native_content_configuration_guard()',target);END LOOP;END;$dg$;
CREATE FUNCTION dg_native_content_configuration_receipt() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE good boolean;
BEGIN
 IF TG_TABLE_NAME='studio_content_sources' THEN
  SELECT EXISTS(SELECT 1 FROM studio_content_sources s JOIN _dg_native_content_source_inputs n ON n.source_id=s.id JOIN studio_content_source_versions v ON v.source_id=s.id AND v.version=s.version WHERE s.id=NEW.id AND n.material_sha256=s.material_sha256 AND n.text_sha256=s.text_sha256 AND n.origin_sha256=encode(sha256(convert_to(s.origin,'UTF8')),'hex') AND v.material_sha256=s.material_sha256 AND v.text_sha256=s.text_sha256 AND v.action=CASE WHEN s.withdrawn=0 THEN 'captured' ELSE 'withdrawn' END) INTO good;
 ELSIF TG_TABLE_NAME='studio_content_briefs' THEN SELECT EXISTS(SELECT 1 FROM studio_content_briefs b JOIN studio_content_brief_versions v ON v.brief_id=b.id AND v.version=b.version WHERE b.id=NEW.id AND v.configuration=b.configuration) INTO good;
 ELSIF TG_TABLE_NAME='studio_content_drafts' THEN SELECT EXISTS(SELECT 1 FROM studio_content_drafts d JOIN studio_content_draft_versions v ON v.draft_id=d.id AND v.version=d.version WHERE d.id=NEW.id AND v.payload=d.payload) INTO good;
 ELSE SELECT EXISTS(SELECT 1 FROM studio_content_plans p JOIN studio_content_plan_versions v ON v.plan_id=p.id AND v.version=CASE WHEN p.status='review' THEN p.version ELSE p.version-1 END WHERE p.id=NEW.id AND v.snapshot=p.snapshot AND v.plan_hash=p.plan_hash AND(p.status<>'applied' OR EXISTS(SELECT 1 FROM _dg_native_content_plan_applications a WHERE a.plan_id=p.id AND a.plan_version=p.version-1 AND a.plan_hash=p.plan_hash AND a.resource_id=p.applied_resource_id AND a.resource_version=p.applied_resource_version))) INTO good;
 END IF;
 IF NOT COALESCE(good,false) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native content configuration requires its immutable current receipt';END IF;RETURN NULL;
END;$dg$;
DO $dg$ DECLARE target text;BEGIN FOREACH target IN ARRAY ARRAY['studio_content_sources','studio_content_briefs','studio_content_drafts','studio_content_plans'] LOOP EXECUTE format('CREATE CONSTRAINT TRIGGER native_content_configuration_receipt AFTER INSERT OR UPDATE ON %I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_content_configuration_receipt()',target);END LOOP;END;$dg$;

CREATE FUNCTION dg_native_content_source(target_tenant text,target_workspace text,target text,write_access boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE current_app text;r studio_content_sources%ROWTYPE;n _dg_native_content_source_inputs%ROWTYPE;
BEGIN
 SELECT app_env INTO current_app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND environment='mock' AND(session_user=app_role OR session_user=worker_role AND NOT write_access);
 IF current_app IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only a scoped native content reader is allowed';END IF;
 IF session_user=(SELECT app_role FROM _dg_native_runtime_control WHERE id=1) THEN
  IF write_access THEN SELECT * INTO r FROM studio_content_sources WHERE id=target AND tenant_id=target_tenant AND workspace_id=target_workspace AND environment='mock' AND app_env=current_app FOR UPDATE;
  ELSE SELECT * INTO r FROM studio_content_sources WHERE id=target AND tenant_id=target_tenant AND workspace_id=target_workspace AND environment='mock' AND app_env=current_app FOR SHARE;END IF;
 ELSE SELECT * INTO r FROM studio_content_sources WHERE id=target AND tenant_id=target_tenant AND workspace_id=target_workspace AND environment='mock' AND app_env=current_app;END IF;
 SELECT * INTO n FROM _dg_native_content_source_inputs WHERE source_id=r.id;
 IF n.source_id IS NULL OR n.material_sha256 IS DISTINCT FROM r.material_sha256 OR n.text_sha256 IS DISTINCT FROM r.text_sha256 OR n.origin_sha256 IS DISTINCT FROM encode(sha256(convert_to(r.origin,'UTF8')),'hex') THEN RETURN NULL;END IF;
 RETURN to_jsonb(r)||jsonb_build_object('storage_key',n.storage_key,'size',n.size);
END;$dg$;
CREATE FUNCTION dg_native_content_brief(target_tenant text,target_workspace text,target text,write_access boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE current_app text;r studio_content_briefs%ROWTYPE;
BEGIN
 SELECT app_env INTO current_app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND environment='mock' AND(session_user=app_role OR session_user=worker_role AND NOT write_access);IF current_app IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only a scoped native brief reader is allowed';END IF;
 IF session_user=(SELECT app_role FROM _dg_native_runtime_control WHERE id=1) THEN
  IF write_access THEN SELECT * INTO r FROM studio_content_briefs WHERE id=target AND tenant_id=target_tenant AND workspace_id=target_workspace AND environment='mock' AND app_env=current_app FOR UPDATE;
  ELSE SELECT * INTO r FROM studio_content_briefs WHERE id=target AND tenant_id=target_tenant AND workspace_id=target_workspace AND environment='mock' AND app_env=current_app FOR SHARE;END IF;
 ELSE SELECT * INTO r FROM studio_content_briefs WHERE id=target AND tenant_id=target_tenant AND workspace_id=target_workspace AND environment='mock' AND app_env=current_app;END IF;IF r.id IS NULL THEN RETURN NULL;END IF;RETURN to_jsonb(r);
END;$dg$;
CREATE FUNCTION dg_native_content_brief_revision(target_tenant text,target_workspace text,target text,target_version bigint) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE current_app text;payload text;
BEGIN
 SELECT app_env INTO current_app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user IN(app_role,worker_role);IF current_app IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only native content roles read a scoped brief revision';END IF;
 SELECT v.configuration INTO payload FROM studio_content_briefs b JOIN studio_content_brief_versions v ON v.brief_id=b.id WHERE b.id=target AND b.tenant_id=target_tenant AND b.workspace_id=target_workspace AND b.environment='mock' AND b.app_env=current_app AND v.version=target_version;RETURN payload;
END;$dg$;

ALTER TABLE native_model_leases DROP CONSTRAINT native_answer_cpu_shape;
ALTER TABLE native_model_leases ADD CONSTRAINT native_content_cpu_shape CHECK(resource='qwen3-4b-cpu' AND job_kind IN('presentation-answer','content-writing') AND char_length(token)=36);
ALTER TABLE studio_content_writing_jobs ADD CONSTRAINT native_writing_shape CHECK(version>0 AND control_version BETWEEN 1 AND version AND attempts BETWEEN 0 AND 3 AND progress BETWEEN 0 AND 1 AND environment='mock' AND app_env IN('development','sandbox') AND ((status='processing' AND lease_token IS NOT NULL AND lease_until IS NOT NULL AND attempts>0) OR(status<>'processing' AND lease_token IS NULL AND lease_until IS NULL)) AND ((status='succeeded' AND result IS NOT NULL AND evidence IS NOT NULL AND result_hash IS NOT NULL AND progress=1) OR(status<>'succeeded' AND result IS NULL AND evidence IS NULL AND result_hash IS NULL)));
CREATE FUNCTION dg_native_writing_job_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE mutable text[]:=ARRAY['status','version','control_version','attempts','progress','lease_token','lease_until','result','evidence','result_hash','error_code','error_message','updated_at'];
BEGIN
 IF TG_OP='INSERT' THEN IF NEW.version<>1 OR NEW.control_version<>1 OR NEW.status<>'queued' OR NEW.attempts<>0 OR NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user=app_role AND app_env=NEW.app_env) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Only the native app queues a fresh content writing input';END IF;RETURN NEW;END IF;
 IF to_jsonb(NEW)-mutable IS DISTINCT FROM to_jsonb(OLD)-mutable OR NEW.version NOT IN(OLD.version,OLD.version+1) OR NEW.version=OLD.version AND to_jsonb(NEW)-ARRAY['progress','lease_until','updated_at'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['progress','lease_until','updated_at'] THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Writing input identity is immutable and current versions advance once';END IF;
 IF OLD.status='succeeded' AND to_jsonb(NEW)-ARRAY['version','updated_at'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['version','updated_at'] THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Completed writing output cannot be overwritten';END IF;
 IF NEW.status='processing' AND NEW.lease_token IS DISTINCT FROM OLD.lease_token AND(NEW.attempts<>OLD.attempts+1 OR OLD.status='processing' AND OLD.lease_until>dg_utc_now()) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Writing claim needs an available lease and increments attempts once';END IF;
 IF NEW.status='processing' AND NEW.lease_token IS NOT DISTINCT FROM OLD.lease_token AND(OLD.status<>'processing' OR NEW.attempts<>OLD.attempts OR OLD.lease_until<=dg_utc_now()) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Expired writing leases cannot renew';END IF;
 IF NEW.status='succeeded' AND OLD.status<>'succeeded' AND(OLD.status<>'processing' OR OLD.lease_until<=dg_utc_now()) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Writing completion requires a current processing lease';END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_writing_job_guard BEFORE INSERT OR UPDATE ON studio_content_writing_jobs FOR EACH ROW EXECUTE FUNCTION dg_native_writing_job_guard();
CREATE FUNCTION dg_native_writing_ledger_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE good boolean;
BEGIN
 SELECT EXISTS(SELECT 1 FROM studio_content_writing_jobs j JOIN _dg_native_writing_inputs i ON i.job_id=j.id WHERE j.id=NEW.id AND j.tenant_id=i.tenant_id AND j.workspace_id=i.workspace_id AND j.actor_id=i.actor_id AND j.request=i.request AND j.engine=i.engine AND j.input_hash=i.input_hash AND((j.status='succeeded' AND EXISTS(SELECT 1 FROM _dg_native_writing_outputs o WHERE o.job_id=j.id AND o.input_hash=j.input_hash AND o.result=j.result AND o.evidence=j.evidence AND o.result_hash=j.result_hash)) OR(j.status<>'succeeded' AND NOT EXISTS(SELECT 1 FROM _dg_native_writing_outputs o WHERE o.job_id=j.id)))) INTO good;
 IF NOT COALESCE(good,false) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native writing requires immutable input and completed output receipts';END IF;RETURN NULL;
END;$dg$;
CREATE CONSTRAINT TRIGGER native_writing_ledger_guard AFTER INSERT OR UPDATE ON studio_content_writing_jobs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_writing_ledger_guard();
CREATE FUNCTION dg_native_writing_context(target text,token text,completed boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE current_app text;j studio_content_writing_jobs%ROWTYPE;m jsonb;ref jsonb;s studio_content_sources%ROWTYPE;b studio_content_briefs%ROWTYPE;
BEGIN
 SELECT app_env INTO current_app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND environment='mock' AND session_user=worker_role;IF current_app IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only the native writing worker reads leased context';END IF;
 SELECT * INTO j FROM studio_content_writing_jobs WHERE id=target AND environment='mock' AND app_env=current_app;
 IF j.id IS NULL OR NOT EXISTS(SELECT 1 FROM native_model_leases l WHERE l.resource='qwen3-4b-cpu' AND l.job_kind='content-writing' AND l.job_id=j.id AND l.token=dg_native_writing_context.token AND l.lease_until>dg_utc_now()) THEN RETURN NULL;END IF;
 IF NOT((NOT completed AND j.status='processing' AND j.lease_token=token AND j.lease_until>dg_utc_now()) OR(completed AND j.status='succeeded' AND EXISTS(SELECT 1 FROM _dg_native_writing_outputs o WHERE o.job_id=j.id AND o.lease_token=token))) THEN RETURN NULL;END IF;
 SELECT to_jsonb(v) INTO m FROM dg_native_locked_membership(j.actor_id) v;
 IF m IS NULL OR m->>'tenant_id' IS DISTINCT FROM j.tenant_id OR m->>'role' NOT IN('admin','editor') OR NOT((m->>'workspace_ids')::jsonb @> jsonb_build_array(j.workspace_id)) OR j.request::jsonb->>'inheritedExpiresAt'<=dg_utc_now() THEN RETURN NULL;END IF;
 FOR ref IN SELECT value FROM jsonb_array_elements(j.request::jsonb->'refs') LOOP
  SELECT * INTO s FROM studio_content_sources WHERE id=ref->>'id' AND tenant_id=j.tenant_id AND workspace_id=j.workspace_id AND environment='mock' AND app_env=current_app;
  IF s.id IS NULL OR s.withdrawn<>0 OR s.expires_at<=dg_utc_now() OR s.version IS DISTINCT FROM(ref->>'version')::bigint OR s.text_sha256 IS DISTINCT FROM ref->>'textSHA256' OR s.text_sha256 IS DISTINCT FROM encode(sha256(convert_to(s.text,'UTF8')),'hex') THEN RETURN NULL;END IF;
 END LOOP;
 IF j.request::jsonb->'brief' IS DISTINCT FROM 'null'::jsonb THEN SELECT * INTO b FROM studio_content_briefs WHERE id=j.request::jsonb->'brief'->>'id' AND tenant_id=j.tenant_id AND workspace_id=j.workspace_id AND environment='mock' AND app_env=current_app;IF b.id IS NULL OR b.version IS DISTINCT FROM(j.request::jsonb->'brief'->>'version')::bigint THEN RETURN NULL;END IF;END IF;RETURN to_jsonb(j);
END;$dg$;

CREATE FUNCTION dg_native_writing_claim() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE current_app text;r studio_content_writing_jobs%ROWTYPE;new_token text:=gen_random_uuid()::text;until_at text;
BEGIN
 SELECT app_env INTO current_app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND environment='mock' AND session_user=worker_role;
 IF current_app IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only the native writing worker can claim';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('native-local-qwen-cpu',0)) THEN RETURN NULL;END IF;
 IF EXISTS(SELECT 1 FROM native_model_leases WHERE resource='qwen3-4b-cpu' AND lease_until>dg_utc_now()) THEN RETURN NULL;END IF;
 DELETE FROM native_model_leases WHERE resource='qwen3-4b-cpu' AND lease_until<=dg_utc_now();
 UPDATE studio_content_writing_jobs SET status='failed',version=version+1,lease_token=NULL,lease_until=NULL,error_code='CONTENT_WRITING_INTERRUPTED',error_message='本机脚本恢复次数已用完，请按当前资料新建任务。',updated_at=dg_utc_now()
  WHERE environment='mock' AND app_env=current_app AND status='processing' AND lease_until<=dg_utc_now() AND attempts>=3;
 SELECT * INTO r FROM studio_content_writing_jobs WHERE environment='mock' AND app_env=current_app AND attempts<3 AND(status='queued' OR(status='processing' AND lease_until<=dg_utc_now())) ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF r.id IS NULL THEN RETURN NULL;END IF;
 until_at:=to_char((clock_timestamp()+interval '30 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 UPDATE studio_content_writing_jobs SET status='processing',attempts=attempts+1,version=version+1,progress=0,lease_token=new_token,lease_until=until_at,error_code=NULL,error_message=NULL,updated_at=dg_utc_now() WHERE id=r.id RETURNING * INTO r;
 INSERT INTO native_model_leases VALUES('qwen3-4b-cpu','content-writing',r.id,new_token,until_at);RETURN to_jsonb(r);
END;$dg$;
CREATE FUNCTION dg_native_writing_hold(target text,token text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND session_user=worker_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only the native writing worker can hold its active CPU process';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('native-local-qwen-cpu',0));
 UPDATE native_model_leases SET lease_until=to_char((clock_timestamp()+interval '30 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  WHERE resource='qwen3-4b-cpu' AND job_kind='content-writing' AND job_id=target AND native_model_leases.token=dg_native_writing_hold.token AND lease_until>dg_utc_now();RETURN FOUND;
END;$dg$;
CREATE FUNCTION dg_native_writing_renew(target text,token text,fraction double precision) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE until_at text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND session_user=worker_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only the native writing worker can renew';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('native-local-qwen-cpu',0));
 IF fraction IS NULL OR fraction<0 OR fraction>0.96 OR dg_native_writing_context(target,token,false) IS NULL THEN RETURN false;END IF;
 until_at:=to_char((clock_timestamp()+interval '30 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 UPDATE native_model_leases SET lease_until=until_at WHERE resource='qwen3-4b-cpu' AND job_kind='content-writing' AND job_id=target AND native_model_leases.token=dg_native_writing_renew.token AND lease_until>dg_utc_now();IF NOT FOUND THEN RETURN false;END IF;
 UPDATE studio_content_writing_jobs SET progress=GREATEST(progress,fraction),lease_until=until_at,updated_at=dg_utc_now() WHERE id=target AND lease_token=token AND status='processing' AND lease_until>dg_utc_now();RETURN FOUND;
END;$dg$;
CREATE FUNCTION dg_native_writing_release(target text,token text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND session_user=worker_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only the native writing worker can release';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('native-local-qwen-cpu',0));DELETE FROM native_model_leases WHERE resource='qwen3-4b-cpu' AND job_kind='content-writing' AND job_id=target AND native_model_leases.token=dg_native_writing_release.token;RETURN FOUND;
END;$dg$;
CREATE FUNCTION dg_native_writing_fail(target text,token text,code text,message text,stopped boolean,stale boolean) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND session_user=worker_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only the native writing worker can stop its lease';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('native-local-qwen-cpu',0));
 IF char_length(code)>100 OR char_length(message)>1000 OR NOT EXISTS(SELECT 1 FROM native_model_leases WHERE resource='qwen3-4b-cpu' AND job_kind='content-writing' AND job_id=target AND native_model_leases.token=dg_native_writing_fail.token AND lease_until>dg_utc_now()) THEN RETURN false;END IF;
 UPDATE studio_content_writing_jobs SET status=CASE WHEN stale THEN 'stale' WHEN stopped AND attempts<3 THEN 'queued' ELSE 'failed' END,version=version+1,lease_token=NULL,lease_until=NULL,error_code=code,error_message=message,updated_at=dg_utc_now()
  WHERE id=target AND lease_token=token AND status='processing' AND lease_until>dg_utc_now();RETURN FOUND;
END;$dg$;

CREATE FUNCTION dg_native_commit_writing(target text,token text,actual_input text,result_text text,evidence_text text,result_digest text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j studio_content_writing_jobs%ROWTYPE;ctx jsonb;i _dg_native_writing_inputs%ROWTYPE;current_app text;result_json jsonb:=result_text::jsonb;evidence_json jsonb:=evidence_text::jsonb;
BEGIN
 SELECT app_env INTO current_app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND environment='mock' AND session_user=worker_role;IF current_app IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only the native writing worker can complete';END IF;
 SELECT * INTO j FROM studio_content_writing_jobs WHERE id=target;PERFORM dg_native_locked_membership(j.actor_id);
 PERFORM pg_advisory_xact_lock(hashtextextended('["native-asset-workspace",'||to_jsonb(j.tenant_id)::text||','||to_jsonb(j.workspace_id)::text||']',0));PERFORM pg_advisory_xact_lock(hashtextextended('native-local-qwen-cpu',0));
 SELECT * INTO j FROM studio_content_writing_jobs WHERE id=target FOR UPDATE;ctx:=dg_native_writing_context(target,token,false);SELECT * INTO i FROM _dg_native_writing_inputs WHERE job_id=j.id;
 IF ctx IS NULL OR actual_input IS DISTINCT FROM j.input_hash OR i.input_hash IS DISTINCT FROM j.input_hash THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Writing lease or fixed input changed';END IF;
 IF jsonb_typeof(result_json) IS DISTINCT FROM 'object' OR jsonb_typeof(result_json->'variants') IS DISTINCT FROM 'array' OR jsonb_array_length(result_json->'variants') NOT BETWEEN 1 AND 3 OR jsonb_typeof(evidence_json) IS DISTINCT FROM 'object' OR evidence_json->'engine' IS DISTINCT FROM j.engine::jsonb OR evidence_json->>'inputSHA256' IS DISTINCT FROM i.request_sha256 OR result_digest IS NULL OR result_digest !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Writing result or provider receipt is not bound to the fixed request';END IF;
 INSERT INTO _dg_native_writing_outputs VALUES(j.id,token,j.input_hash,result_text,evidence_text,result_digest,dg_utc_now());
 UPDATE studio_content_writing_jobs SET status='succeeded',version=version+1,progress=1,result=result_text,evidence=evidence_text,result_hash=result_digest,lease_token=NULL,lease_until=NULL,error_code=NULL,error_message=NULL,updated_at=dg_utc_now() WHERE id=j.id;
 INSERT INTO audit_events VALUES(gen_random_uuid()::text,j.tenant_id,j.workspace_id,j.actor_id,'content.writing.complete',j.id,'confirmed','native-writing:'||j.id||':'||token,dg_utc_now());RETURN j.id;
END;$dg$;
CREATE FUNCTION dg_native_content_origin_receipt() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE good boolean;
BEGIN
 SELECT EXISTS(SELECT 1 FROM studio_content_origins o JOIN _dg_native_content_origins n ON n.origin_id=o.id JOIN studio_content_drafts d ON d.id=o.draft_id JOIN studio_content_draft_versions v ON v.draft_id=d.id AND v.version=o.draft_version WHERE o.id=NEW.id AND d.tenant_id=o.tenant_id AND d.workspace_id=o.workspace_id AND d.environment=o.environment AND d.app_env=o.app_env AND v.payload=n.payload AND v.payload::jsonb->'sourceRefs'=o.source_refs::jsonb) INTO good;
 IF NOT COALESCE(good,false) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native content origin needs the original draft revision and source references';END IF;RETURN NULL;
END;$dg$;
CREATE CONSTRAINT TRIGGER native_content_origin_receipt AFTER INSERT ON studio_content_origins DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_content_origin_receipt();
CREATE FUNCTION dg_native_writing_adoption_receipt() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE good boolean;
BEGIN
 SELECT EXISTS(SELECT 1 FROM studio_content_writing_adoptions a JOIN _dg_native_writing_adoptions n ON n.job_id=a.job_id AND n.variant_index=a.variant_index AND n.draft_id=a.draft_id JOIN studio_content_writing_jobs j ON j.id=a.job_id JOIN _dg_native_writing_outputs o ON o.job_id=j.id JOIN studio_content_drafts d ON d.id=a.draft_id WHERE a.job_id=NEW.job_id AND a.variant_index=NEW.variant_index AND j.status='succeeded' AND d.tenant_id=j.tenant_id AND d.workspace_id=j.workspace_id AND d.payload::jsonb->'modelOrigin'->>'jobId'=j.id AND(d.payload::jsonb->'modelOrigin'->>'variantIndex')::bigint=a.variant_index AND d.payload::jsonb->'modelOrigin'->>'inputSHA256'=j.input_hash AND d.payload::jsonb->'modelOrigin'->>'resultSHA256'=o.result_hash AND n.input_hash=j.input_hash AND n.result_hash=o.result_hash) INTO good;
 IF NOT COALESCE(good,false) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native writing adoption needs the immutable candidate and current draft scope';END IF;RETURN NULL;
END;$dg$;
CREATE CONSTRAINT TRIGGER native_writing_adoption_receipt AFTER INSERT ON studio_content_writing_adoptions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_writing_adoption_receipt();
CREATE FUNCTION dg_native_content_asset_references(target_tenant text,target_workspace text,target_assets text[]) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE current_app text;counted bigint;
BEGIN
 SELECT app_env INTO current_app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user=app_role;IF current_app IS NULL OR cardinality(target_assets)>200 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only scoped native asset plans count content references';END IF;
 SELECT count(*) INTO counted FROM studio_content_sources s WHERE s.tenant_id=target_tenant AND s.workspace_id=target_workspace AND s.environment='mock' AND s.app_env=current_app AND s.kind='video' AND s.origin::jsonb->>'assetId'=ANY(target_assets);RETURN counted;
END;$dg$;
DO $dg$ DECLARE item record;BEGIN FOR item IN SELECT p.oid::regprocedure::text AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND p.proname IN('dg_native_content_configuration_guard','dg_native_content_configuration_receipt','dg_native_content_source','dg_native_content_brief','dg_native_content_brief_revision','dg_native_writing_job_guard','dg_native_writing_ledger_guard','dg_native_writing_context','dg_native_writing_claim','dg_native_writing_hold','dg_native_writing_renew','dg_native_writing_release','dg_native_writing_fail','dg_native_commit_writing','dg_native_content_origin_receipt','dg_native_writing_adoption_receipt','dg_native_content_asset_references') LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||item.signature||' FROM PUBLIC';END LOOP;END;$dg$;

