-- Native fixed-source local answers. Applied001-019 remain unchanged.
ALTER TABLE studio_presentation_sessions DROP CONSTRAINT native_presentation_manual_mode;
ALTER TABLE studio_presentation_sessions ADD CONSTRAINT native_presentation_answer_mode CHECK(
 (answer_mode='human_text' AND answer_configuration IS NULL) OR
 (answer_mode='local_model' AND answer_configuration IS NOT NULL AND jsonb_typeof(answer_configuration::jsonb)='object'
  AND answer_configuration::jsonb ?& ARRAY['engine','voice','autoResume']
  AND jsonb_typeof(answer_configuration::jsonb->'engine') IS NOT DISTINCT FROM 'object'
  AND answer_configuration::jsonb->'engine'->>'policy' IS NOT DISTINCT FROM 'ppt-question-parts-v2'
  AND jsonb_typeof(answer_configuration::jsonb->'voice') IS NOT DISTINCT FROM 'object'
  AND jsonb_typeof(answer_configuration::jsonb->'autoResume') IS NOT DISTINCT FROM 'boolean'));
CREATE OR REPLACE FUNCTION dg_native_presentation_session_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE mutable text[]:=ARRAY['state','position_ms','anchor_at','version','active_question_id','resume_state','resume_position_ms','answer_generation','answer_mode','answer_configuration','updated_at','invalidated_at','invalidation_reason'];
BEGIN
 IF NEW.version<>OLD.version+1 OR to_jsonb(NEW)-mutable IS DISTINCT FROM to_jsonb(OLD)-mutable THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Presentation media, source and authored boundaries are immutable';
 END IF;
 IF OLD.invalidated_at IS NULL AND NEW.invalidated_at IS NOT NULL AND to_jsonb(NEW)-ARRAY['version','invalidated_at','invalidation_reason'] IS NOT DISTINCT FROM to_jsonb(OLD)-ARRAY['version','invalidated_at','invalidation_reason'] THEN RETURN NEW;END IF;
 IF OLD.invalidated_at IS NOT NULL OR NEW.invalidated_at IS NOT NULL OR OLD.state='ended' OR NEW.answer_generation NOT BETWEEN OLD.answer_generation AND OLD.answer_generation+1 THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Ended or invalidated sessions cannot revive';
 END IF;
 IF (NEW.answer_mode IS DISTINCT FROM OLD.answer_mode OR NEW.answer_configuration IS DISTINCT FROM OLD.answer_configuration)
  AND(OLD.state='question' OR NEW.state<>OLD.state OR NEW.answer_generation<>OLD.answer_generation+1) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Answer configuration requires a new control generation outside a question';
 END IF;RETURN NEW;
END;$dg$;

CREATE TABLE _dg_native_answer_inputs(
 job_id text PRIMARY KEY REFERENCES studio_presentation_answer_jobs(id),request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),
 host_id text NOT NULL,artifact_id text NOT NULL,artifact_hash text NOT NULL CHECK(artifact_hash ~ '^[a-f0-9]{64}$'),created_at text NOT NULL);
CREATE TABLE _dg_native_answer_outputs(
 job_id text PRIMARY KEY REFERENCES studio_presentation_answer_jobs(id),lease_token text NOT NULL,result text NOT NULL,evidence text NOT NULL,
 audio_key text NOT NULL,audio_format text NOT NULL,created_at text NOT NULL);
CREATE TRIGGER native_answer_input_immutable BEFORE UPDATE OR DELETE ON _dg_native_answer_inputs FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_answer_output_immutable BEFORE UPDATE OR DELETE ON _dg_native_answer_outputs FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
ALTER TABLE studio_presentation_answer_jobs ADD CONSTRAINT native_answer_question_identity UNIQUE(id,question_id,session_id);
ALTER TABLE studio_presentation_questions ADD CONSTRAINT native_question_answer_identity FOREIGN KEY(answer_job_id,id,session_id) REFERENCES studio_presentation_answer_jobs(id,question_id,session_id);
ALTER TABLE studio_presentation_questions DROP CONSTRAINT native_presentation_question_shape;
ALTER TABLE studio_presentation_questions ADD CONSTRAINT native_presentation_question_shape CHECK(version>0 AND position_ms BETWEEN 0 AND 10800000 AND status IN ('pending','answered','dismissed') AND char_length(body) BETWEEN 1 AND 2000
 AND((status='answered' AND answer IS NOT NULL AND char_length(answer) BETWEEN 1 AND 4000 AND answer_at IS NOT NULL
   AND((answer_by IS NOT NULL AND answer_job_id IS NULL) OR(answer_by IS NULL AND answer_job_id IS NOT NULL)))
 OR(status<>'answered' AND answer IS NULL AND answer_by IS NULL AND answer_at IS NULL AND answer_job_id IS NULL)));
CREATE OR REPLACE FUNCTION dg_native_presentation_question_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NEW.version<>OLD.version+1 OR to_jsonb(NEW)-ARRAY['status','answer','answer_by','answer_at','answer_job_id','version'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['status','answer','answer_by','answer_at','answer_job_id','version'] THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Original question text and breakpoints are immutable';
 END IF;
 IF OLD.status='pending' AND NEW.status IN ('answered','dismissed') THEN
  IF NEW.answer_job_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM studio_presentation_answer_jobs j WHERE j.id=NEW.answer_job_id AND j.question_id=NEW.id AND j.session_id=NEW.session_id AND j.status='succeeded' AND j.result::jsonb->>'answer'=NEW.answer) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Automatic question answer needs its completed immutable job';
  END IF;RETURN NEW;
 END IF;
 IF OLD.status='answered' AND OLD.answer_job_id IS NOT NULL AND NEW.status='pending'
  AND EXISTS(SELECT 1 FROM studio_presentation_answer_jobs j JOIN studio_presentation_sessions s ON s.id=j.session_id
   WHERE j.id=OLD.answer_job_id AND j.playback_state='interrupted' AND s.state='question' AND s.active_question_id=OLD.id AND s.answer_generation=j.control_generation+1) THEN RETURN NEW;END IF;
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Confirmed human answers and finished questions cannot be overwritten';
END;$dg$;

ALTER TABLE studio_presentation_answer_jobs ADD CONSTRAINT native_answer_job_shape CHECK(
 status IN ('queued','processing','succeeded','failed','cancelled','stale') AND version>0 AND attempts BETWEEN 0 AND 3 AND control_generation>0 AND progress BETWEEN 0 AND 1
 AND source_hash ~ '^[a-f0-9]{64}$' AND input_hash ~ '^[a-f0-9]{64}$'
 AND jsonb_typeof(request::jsonb)='object' AND jsonb_typeof(configuration::jsonb)='object'
 AND((status='processing' AND lease_token IS NOT NULL AND lease_until IS NOT NULL AND attempts>0) OR(status<>'processing' AND lease_token IS NULL AND lease_until IS NULL))
 AND((status='succeeded' AND result IS NOT NULL AND evidence IS NOT NULL AND audio_key IS NOT NULL AND audio_format IS NOT NULL AND progress=1)
  OR(status<>'succeeded' AND result IS NULL AND evidence IS NULL AND audio_key IS NULL AND audio_format IS NULL))
 AND playback_version>=0 AND playback_state IN ('idle','playing','completed','interrupted')
 AND((playback_state='playing' AND status='succeeded' AND playback_actor_id IS NOT NULL AND playback_client_id IS NOT NULL AND playback_started_at IS NOT NULL AND playback_lease_until IS NOT NULL)
  OR(playback_state<>'playing' AND playback_lease_until IS NULL)));
CREATE FUNCTION dg_native_answer_job_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE mutable text[]:=ARRAY['status','version','attempts','progress','lease_token','lease_until','result','evidence','audio_key','audio_format','error_code','error_message','playback_version','playback_state','playback_actor_id','playback_client_id','playback_started_at','playback_lease_until','updated_at'];
BEGIN
 IF to_jsonb(NEW)-mutable IS DISTINCT FROM to_jsonb(OLD)-mutable OR NEW.version NOT BETWEEN OLD.version AND OLD.version+1
  OR(NEW.version=OLD.version AND to_jsonb(NEW)-ARRAY['progress','lease_until','updated_at'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['progress','lease_until','updated_at']) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Answer inputs and control generation are immutable; state changes advance once';
 END IF;
 IF NEW.status<>OLD.status AND NOT((OLD.status='queued' AND NEW.status IN ('processing','cancelled')) OR(OLD.status='processing' AND NEW.status IN ('queued','succeeded','failed','cancelled','stale')) OR(OLD.status IN ('failed','cancelled') AND NEW.status='queued')) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native answer transition is invalid';
 END IF;
 IF NEW.status='processing' AND NEW.lease_token IS DISTINCT FROM OLD.lease_token
  AND(NEW.attempts<>OLD.attempts+1 OR(OLD.status='processing' AND OLD.lease_until>dg_utc_now())) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Answer claim needs an available lease and increments attempts once';
 END IF;
 IF NEW.status='processing' AND NEW.lease_token IS NOT DISTINCT FROM OLD.lease_token
  AND(OLD.status<>'processing' OR NEW.attempts<>OLD.attempts OR OLD.lease_until<=dg_utc_now()) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Expired answer leases cannot renew';
 END IF;
 IF NEW.status='succeeded' AND OLD.status<>'succeeded' AND(OLD.status<>'processing' OR OLD.lease_until<=dg_utc_now()) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Answer completion needs an unexpired processing lease';
 END IF;
 IF OLD.status='succeeded' AND(NEW.status<>'succeeded' OR NEW.result IS DISTINCT FROM OLD.result OR NEW.evidence IS DISTINCT FROM OLD.evidence OR NEW.audio_key IS DISTINCT FROM OLD.audio_key OR NEW.audio_format IS DISTINCT FROM OLD.audio_format) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Completed model answers and audio receipts are immutable';
 END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_answer_job_guard BEFORE UPDATE ON studio_presentation_answer_jobs FOR EACH ROW EXECUTE FUNCTION dg_native_answer_job_guard();
CREATE FUNCTION dg_native_answer_ledger_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_answer_inputs i JOIN studio_presentation_sessions s ON s.id=NEW.session_id WHERE i.job_id=NEW.id AND i.host_id=s.actor_id AND i.artifact_id=s.artifact_id AND i.artifact_hash=s.artifact_hash) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native answer needs its immutable input ledger';
 END IF;
 IF NEW.status='succeeded' AND NOT EXISTS(SELECT 1 FROM _dg_native_answer_outputs o WHERE o.job_id=NEW.id AND o.result=NEW.result AND o.evidence=NEW.evidence AND o.audio_key=NEW.audio_key AND o.audio_format=NEW.audio_format) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native answer needs its exact immutable result ledger';
 END IF;RETURN NULL;
END;$dg$;
CREATE CONSTRAINT TRIGGER native_answer_ledger_guard AFTER INSERT OR UPDATE ON studio_presentation_answer_jobs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_answer_ledger_guard();
ALTER TABLE native_model_leases ADD CONSTRAINT native_answer_cpu_shape CHECK(resource='qwen3-4b-cpu' AND job_kind='presentation-answer' AND char_length(token)=36);

CREATE FUNCTION dg_native_answer_context(target text,token text,completed boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j studio_presentation_answer_jobs%ROWTYPE;s studio_presentation_sessions%ROWTYPE;q studio_presentation_questions%ROWTYPE;current_app text;
BEGIN
 SELECT app_env INTO current_app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND environment='mock' AND session_user=worker_role;
 IF current_app IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only the native answer worker can read leased context';END IF;
 SELECT * INTO j FROM studio_presentation_answer_jobs WHERE id=target AND environment='mock' AND app_env=current_app;
 IF j.id IS NULL OR NOT EXISTS(SELECT 1 FROM native_model_leases l WHERE l.resource='qwen3-4b-cpu' AND l.job_id=j.id AND l.token=dg_native_answer_context.token AND l.lease_until>dg_utc_now()) THEN RETURN NULL;END IF;
 IF NOT((NOT completed AND j.status='processing' AND j.lease_token=token AND j.lease_until>dg_utc_now())
  OR(completed AND j.status='succeeded' AND EXISTS(SELECT 1 FROM _dg_native_answer_outputs o WHERE o.job_id=j.id AND o.lease_token=token))) THEN RETURN NULL;END IF;
 SELECT * INTO s FROM studio_presentation_sessions WHERE id=j.session_id;
 SELECT * INTO q FROM studio_presentation_questions WHERE id=j.question_id AND session_id=j.session_id;
 IF s.id IS NULL OR q.id IS NULL OR s.invalidated_at IS NOT NULL OR s.state<>'question' OR s.active_question_id<>q.id OR s.answer_mode<>'local_model'
  OR s.answer_generation<>j.control_generation OR s.answer_configuration<>j.configuration OR s.source_hash<>j.source_hash OR s.tenant_id<>j.tenant_id OR s.workspace_id<>j.workspace_id
  OR s.environment<>'mock' OR s.app_env<>current_app OR q.actor_id<>j.actor_id OR j.request::jsonb->>'question' IS DISTINCT FROM q.body OR j.request::jsonb->>'pageId' IS DISTINCT FROM q.page_id
  OR(NOT completed AND q.status<>'pending') OR(completed AND(q.status<>'answered' OR q.answer_job_id IS DISTINCT FROM j.id))
  OR NOT EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=s.actor_id AND m.tenant_id=s.tenant_id AND m.role IN ('admin','editor') AND m.workspace_ids::jsonb ? s.workspace_id)
  OR NOT EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=j.actor_id AND m.tenant_id=j.tenant_id AND m.workspace_ids::jsonb ? j.workspace_id)
  OR NOT EXISTS(SELECT 1 FROM _dg_native_answer_inputs i WHERE i.job_id=j.id AND i.host_id=s.actor_id AND i.artifact_id=s.artifact_id AND i.artifact_hash=s.artifact_hash)
 THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('session',to_jsonb(s),'question',to_jsonb(q));
END;$dg$;

CREATE FUNCTION dg_native_answer_claim() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE current_app text;r studio_presentation_answer_jobs%ROWTYPE;new_token text:=gen_random_uuid()::text;until_at text;
BEGIN
 SELECT app_env INTO current_app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND environment='mock' AND session_user=worker_role;
 IF current_app IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only the native answer worker can claim';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('native-local-qwen-cpu',0)) THEN RETURN NULL;END IF;
 IF EXISTS(SELECT 1 FROM native_model_leases WHERE resource='qwen3-4b-cpu' AND lease_until>dg_utc_now()) THEN RETURN NULL;END IF;
 DELETE FROM native_model_leases WHERE resource='qwen3-4b-cpu' AND lease_until<=dg_utc_now();
 UPDATE studio_presentation_answer_jobs SET status='failed',version=version+1,lease_token=NULL,lease_until=NULL,error_code='PRESENTATION_ANSWER_INTERRUPTED',error_message='本机答疑恢复次数已用完，请转人工处理当前问题。',updated_at=dg_utc_now()
  WHERE environment='mock' AND app_env=current_app AND status='processing' AND lease_until<=dg_utc_now() AND attempts>=3;
 SELECT * INTO r FROM studio_presentation_answer_jobs WHERE environment='mock' AND app_env=current_app AND attempts<3 AND(status='queued' OR(status='processing' AND lease_until<=dg_utc_now())) ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF r.id IS NULL THEN RETURN NULL;END IF;
 until_at:=to_char((clock_timestamp()+interval '30 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 UPDATE studio_presentation_answer_jobs SET status='processing',attempts=attempts+1,version=version+1,progress=0,lease_token=new_token,lease_until=until_at,error_code=NULL,error_message=NULL,updated_at=dg_utc_now() WHERE id=r.id RETURNING * INTO r;
 INSERT INTO native_model_leases VALUES('qwen3-4b-cpu','presentation-answer',r.id,new_token,until_at);RETURN to_jsonb(r);
END;$dg$;
CREATE FUNCTION dg_native_answer_hold(target text,token text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND session_user=worker_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only the native answer worker can hold its active CPU process';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('native-local-qwen-cpu',0));
 UPDATE native_model_leases SET lease_until=to_char((clock_timestamp()+interval '30 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  WHERE resource='qwen3-4b-cpu' AND job_id=target AND native_model_leases.token=dg_native_answer_hold.token AND lease_until>dg_utc_now();RETURN FOUND;
END;$dg$;
CREATE FUNCTION dg_native_answer_renew(target text,token text,fraction double precision) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE until_at text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND session_user=worker_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only the native answer worker can renew';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('native-local-qwen-cpu',0));
 IF fraction IS NULL OR fraction<0 OR fraction>0.96 OR dg_native_answer_context(target,token,false) IS NULL THEN RETURN false;END IF;
 until_at:=to_char((clock_timestamp()+interval '30 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 UPDATE native_model_leases SET lease_until=until_at WHERE resource='qwen3-4b-cpu' AND job_id=target AND native_model_leases.token=dg_native_answer_renew.token AND lease_until>dg_utc_now();IF NOT FOUND THEN RETURN false;END IF;
 UPDATE studio_presentation_answer_jobs SET progress=GREATEST(progress,fraction),lease_until=until_at,updated_at=dg_utc_now() WHERE id=target AND lease_token=token AND status='processing' AND lease_until>dg_utc_now();RETURN FOUND;
END;$dg$;
CREATE FUNCTION dg_native_answer_release(target text,token text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND session_user=worker_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only the native answer worker can release';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('native-local-qwen-cpu',0));DELETE FROM native_model_leases WHERE resource='qwen3-4b-cpu' AND job_id=target AND native_model_leases.token=dg_native_answer_release.token;RETURN FOUND;
END;$dg$;
CREATE FUNCTION dg_native_answer_fail(target text,token text,code text,message text,stopped boolean,stale boolean) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND session_user=worker_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only the native answer worker can stop its lease';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('native-local-qwen-cpu',0));
 IF char_length(code)>100 OR char_length(message)>1000 OR NOT EXISTS(SELECT 1 FROM native_model_leases WHERE resource='qwen3-4b-cpu' AND job_id=target AND native_model_leases.token=dg_native_answer_fail.token AND lease_until>dg_utc_now()) THEN RETURN false;END IF;
 UPDATE studio_presentation_answer_jobs SET status=CASE WHEN stale THEN 'stale' WHEN stopped AND attempts<3 THEN 'queued' ELSE 'failed' END,version=version+1,lease_token=NULL,lease_until=NULL,error_code=code,error_message=message,updated_at=dg_utc_now()
  WHERE id=target AND lease_token=token AND status='processing' AND lease_until>dg_utc_now();RETURN FOUND;
END;$dg$;

CREATE FUNCTION dg_native_commit_answer(target text,token text,actual_input text,result_text text,evidence_text text,audio text,format_text text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j studio_presentation_answer_jobs%ROWTYPE;s studio_presentation_sessions%ROWTYPE;q studio_presentation_questions%ROWTYPE;ctx jsonb;h text;who text;current_app text;
 result_json jsonb:=result_text::jsonb;evidence_json jsonb:=evidence_text::jsonb;format_json jsonb:=format_text::jsonb;until_at text;
BEGIN
 SELECT app_env INTO current_app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND environment='mock' AND session_user=worker_role;
 IF current_app IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only the native answer worker can commit';END IF;
 SELECT * INTO j FROM studio_presentation_answer_jobs WHERE id=target;SELECT host_id INTO h FROM _dg_native_answer_inputs WHERE job_id=target;
 -- Acquire all membership locks before the workspace/CPU/job/session locks.
 FOR who IN SELECT DISTINCT v FROM unnest(ARRAY[j.actor_id,h]) v ORDER BY v LOOP PERFORM dg_native_locked_membership(who);END LOOP;
 PERFORM pg_advisory_xact_lock(hashtextextended('["native-asset-workspace",'||to_jsonb(j.tenant_id)::text||','||to_jsonb(j.workspace_id)::text||']',0));
 PERFORM pg_advisory_xact_lock(hashtextextended('native-local-qwen-cpu',0));
 SELECT * INTO j FROM studio_presentation_answer_jobs WHERE id=target FOR UPDATE;ctx:=dg_native_answer_context(target,token,false);
 IF ctx IS NULL OR actual_input IS DISTINCT FROM j.input_hash THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Answer lease, current question or fixed input changed';END IF;
 SELECT * INTO s FROM studio_presentation_sessions WHERE id=j.session_id FOR UPDATE;SELECT * INTO q FROM studio_presentation_questions WHERE id=j.question_id FOR UPDATE;
 IF jsonb_typeof(result_json) IS DISTINCT FROM 'object' OR jsonb_typeof(evidence_json) IS DISTINCT FROM 'object' OR jsonb_typeof(format_json) IS DISTINCT FROM 'object'
  OR result_json->>'answer' IS NULL OR char_length(result_json->>'answer') NOT BETWEEN 1 AND 1200
  OR evidence_json->'engine' IS DISTINCT FROM j.configuration::jsonb->'engine'
  OR evidence_json->>'inputSHA256' IS DISTINCT FROM(SELECT request_sha256 FROM _dg_native_answer_inputs WHERE job_id=j.id)
  OR jsonb_typeof(evidence_json->'composition') IS DISTINCT FROM 'object' OR jsonb_typeof(result_json->'composition') IS DISTINCT FROM 'object'
  OR audio IS NULL OR audio !~ '^[a-f0-9-]{36}\.wav$' OR format_json->>'sha256' IS NULL OR format_json->>'sha256' !~ '^[a-f0-9]{64}$'
  OR format_json->>'pcmSHA256' IS NULL OR format_json->>'pcmSHA256' !~ '^[a-f0-9]{64}$'
  OR(format_json->>'sampleRate')::integer IS DISTINCT FROM 22050 OR(format_json->>'channels')::integer IS DISTINCT FROM 1 OR(format_json->>'bitsPerSample')::integer IS DISTINCT FROM 16
  OR(format_json->>'durationMs')::numeric IS NULL OR(format_json->>'durationMs')::numeric NOT BETWEEN 1 AND 240000
  OR(format_json->>'size')::bigint IS NULL OR(format_json->>'size')::bigint NOT BETWEEN 44 AND 67108864 THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Actual answer, engine, input or audio receipt is invalid';
 END IF;
 SELECT lease_until INTO until_at FROM native_model_leases WHERE resource='qwen3-4b-cpu' AND job_id=target AND native_model_leases.token=dg_native_commit_answer.token;
 INSERT INTO _dg_native_answer_outputs VALUES(j.id,token,result_text,evidence_text,audio,format_text,dg_utc_now());
 UPDATE studio_presentation_answer_jobs SET status='succeeded',version=version+1,progress=1,result=result_text,evidence=evidence_text,audio_key=audio,audio_format=format_text,lease_token=NULL,lease_until=NULL,error_code=NULL,error_message=NULL,updated_at=dg_utc_now() WHERE id=j.id;
 UPDATE studio_presentation_questions SET status='answered',answer=result_json->>'answer',answer_job_id=j.id,answer_by=NULL,answer_at=dg_utc_now(),version=version+1 WHERE id=q.id;
 UPDATE studio_presentation_sessions SET version=version+1,updated_at=dg_utc_now() WHERE id=s.id;
 INSERT INTO audit_events VALUES(gen_random_uuid()::text,j.tenant_id,j.workspace_id,j.actor_id,'presentation.local_answer_completed',j.id,'confirmed','native-answer:'||j.id||':'||j.attempts,dg_utc_now());
 IF until_at IS NULL OR until_at<=dg_utc_now() THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Answer CPU lease expired before completion';END IF;RETURN j.id;
END;$dg$;
REVOKE ALL ON FUNCTION dg_native_answer_context(text,text,boolean),dg_native_answer_claim(),dg_native_answer_hold(text,text),dg_native_answer_renew(text,text,double precision),dg_native_answer_release(text,text),dg_native_answer_fail(text,text,text,text,boolean,boolean),dg_native_commit_answer(text,text,text,text,text,text,text) FROM PUBLIC;
