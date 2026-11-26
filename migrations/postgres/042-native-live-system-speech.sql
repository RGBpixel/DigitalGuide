-- R-058/R-094/R-097/R-098/R-099. Actual Windows system speech, not voice/style cloning.
ALTER TABLE live_speech_plans ADD COLUMN invalidated_at text;
ALTER TABLE live_speech_plans ADD COLUMN invalidation_reason text;
ALTER TABLE live_speech_jobs ADD COLUMN invalidated_at text;
ALTER TABLE live_speech_jobs ADD COLUMN invalidation_reason text;
CREATE TABLE _dg_native_live_speech_plan_inputs(plan_id text PRIMARY KEY REFERENCES live_speech_plans(id),snapshot text NOT NULL,input_hash text NOT NULL CHECK(input_hash=encode(sha256(convert_to(snapshot,'UTF8')),'hex')),created_at text NOT NULL);
CREATE TABLE _dg_native_live_speech_job_inputs(job_id text PRIMARY KEY REFERENCES live_speech_jobs(id),snapshot text NOT NULL,input_hash text NOT NULL CHECK(input_hash=encode(sha256(convert_to(snapshot,'UTF8')),'hex')),created_at text NOT NULL);
CREATE TABLE _dg_native_live_speech_outputs(job_id text PRIMARY KEY REFERENCES live_speech_jobs(id),lease_token text NOT NULL,receipt text NOT NULL,receipt_hash text NOT NULL CHECK(receipt_hash=encode(sha256(convert_to(receipt,'UTF8')),'hex')),created_at text NOT NULL);
CREATE TABLE _dg_native_live_speech_plan_outputs(plan_id text PRIMARY KEY REFERENCES live_speech_plans(id),result text NOT NULL,result_hash text NOT NULL CHECK(result_hash=encode(sha256(convert_to(result,'UTF8')),'hex')),created_at text NOT NULL);
CREATE TABLE _dg_native_live_speech_leases(job_id text PRIMARY KEY REFERENCES live_speech_jobs(id),token text NOT NULL,lease_until text NOT NULL);
CREATE TRIGGER native_live_speech_plan_input_immutable BEFORE UPDATE OR DELETE ON _dg_native_live_speech_plan_inputs FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_live_speech_job_input_immutable BEFORE UPDATE OR DELETE ON _dg_native_live_speech_job_inputs FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_live_speech_output_immutable BEFORE UPDATE OR DELETE ON _dg_native_live_speech_outputs FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_live_speech_plan_output_immutable BEFORE UPDATE OR DELETE ON _dg_native_live_speech_plan_outputs FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
ALTER TABLE live_speech_plans ADD CONSTRAINT native_live_speech_plan_shape CHECK(environment='mock' AND app_env IN('development','sandbox') AND version>0 AND status IN('building','ready','failed','cancelled','withdrawn') AND input_hash ~ '^[a-f0-9]{64}$' AND voice::jsonb->>'provider'='windows-sapi' AND voice::jsonb->>'cloned'='false' AND voice::jsonb->>'local'='true' AND jsonb_typeof(cues::jsonb)='array' AND jsonb_array_length(cues::jsonb)<=30 AND(status<>'ready' OR result_hash IS NOT NULL));
ALTER TABLE live_speech_jobs ADD CONSTRAINT native_live_speech_job_shape CHECK(environment='mock' AND app_env IN('development','sandbox') AND version>0 AND control_version BETWEEN 1 AND version AND attempts BETWEEN 0 AND 3 AND progress BETWEEN 0 AND 1 AND status IN('queued','processing','succeeded','failed','cancelled','stale') AND input_hash ~ '^[a-f0-9]{64}$' AND source::jsonb->>'kind' IN('cue','answer','manual') AND char_length(source::jsonb->>'text') BETWEEN 1 AND 1500 AND((lease_token IS NULL)=(lease_until IS NULL)) AND(status<>'succeeded' OR(wav_key IS NOT NULL AND wav_format IS NOT NULL AND pcm_key IS NOT NULL AND pcm_format IS NOT NULL)));
ALTER TABLE live_speech_playbacks ADD CONSTRAINT native_live_speech_playback_shape CHECK(version>0 AND epoch>0 AND position_frames BETWEEN 0 AND 1440 AND program_cue_index BETWEEN 0 AND 29 AND program_offset_ms BETWEEN 0 AND 600000 AND kind IN('answer','manual') AND status IN('active','completed','stopped'));
CREATE UNIQUE INDEX native_live_speech_cue_once ON live_speech_jobs(plan_id,(source::jsonb->>'cueId')) WHERE source::jsonb->>'kind'='cue';

CREATE FUNCTION dg_native_live_speech_row_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE s live_sessions%ROWTYPE;p live_speech_plans%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Live speech history cannot be deleted';END IF;
 IF TG_TABLE_NAME='live_speech_plans' THEN
  SELECT * INTO s FROM live_sessions WHERE id=NEW.session_id;
  IF s.id IS NULL OR NEW.tenant_id<>s.tenant_id OR NEW.workspace_id<>s.workspace_id OR NEW.environment<>s.environment OR NEW.app_env<>s.app_env OR NEW.session_hash<>s.snapshot_hash THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Speech plan must match the exact session scope';END IF;
  IF TG_OP='UPDATE' THEN
   IF to_jsonb(NEW)-ARRAY['status','version','result_hash','withdrawn_at','invalidated_at','invalidation_reason','updated_at'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['status','version','result_hash','withdrawn_at','invalidated_at','invalidation_reason','updated_at'] OR NEW.version<>OLD.version+1 OR(OLD.result_hash IS NOT NULL AND NEW.result_hash IS DISTINCT FROM OLD.result_hash) OR(OLD.withdrawn_at IS NOT NULL AND NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at) OR(OLD.invalidated_at IS NOT NULL AND NEW.invalidated_at IS DISTINCT FROM OLD.invalidated_at) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Speech plan identity, input and completed result cannot be overwritten';END IF;
  ELSE IF NEW.version<>1 OR NEW.status<>'building' OR NEW.result_hash IS NOT NULL OR NEW.withdrawn_at IS NOT NULL OR NEW.invalidated_at IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Speech plan starts as a new building plan';END IF;END IF;
 ELSE
  SELECT * INTO p FROM live_speech_plans WHERE id=NEW.plan_id;
  IF p.id IS NULL OR NEW.session_id<>p.session_id OR NEW.tenant_id<>p.tenant_id OR NEW.workspace_id<>p.workspace_id OR NEW.environment<>p.environment OR NEW.app_env<>p.app_env THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Speech job must match its exact plan scope';END IF;
  IF TG_OP='UPDATE' THEN
   IF to_jsonb(NEW)-ARRAY['status','version','control_version','attempts','progress','lease_token','lease_until','wav_key','wav_format','pcm_key','pcm_format','withdrawn_at','invalidated_at','invalidation_reason','error_code','error_message','updated_at'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['status','version','control_version','attempts','progress','lease_token','lease_until','wav_key','wav_format','pcm_key','pcm_format','withdrawn_at','invalidated_at','invalidation_reason','error_code','error_message','updated_at'] OR NEW.version NOT BETWEEN OLD.version AND OLD.version+1 OR NEW.attempts NOT BETWEEN OLD.attempts AND OLD.attempts+1 OR(OLD.wav_key IS NOT NULL AND ROW(NEW.wav_key,NEW.wav_format,NEW.pcm_key,NEW.pcm_format) IS DISTINCT FROM ROW(OLD.wav_key,OLD.wav_format,OLD.pcm_key,OLD.pcm_format)) OR(OLD.withdrawn_at IS NOT NULL AND NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at) OR(OLD.invalidated_at IS NOT NULL AND NEW.invalidated_at IS DISTINCT FROM OLD.invalidated_at) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Speech job input, attempt history and completed audio cannot be overwritten';END IF;
  ELSE IF NEW.status<>'queued' OR NEW.version<>1 OR NEW.attempts<>0 OR NEW.lease_token IS NOT NULL OR NEW.wav_key IS NOT NULL OR NEW.pcm_key IS NOT NULL OR NEW.withdrawn_at IS NOT NULL OR NEW.invalidated_at IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Speech job starts queued without fabricated output';END IF;END IF;
  IF NEW.status='succeeded' AND NOT EXISTS(SELECT 1 FROM _dg_native_live_speech_outputs o WHERE o.job_id=NEW.id AND o.receipt::jsonb->>'inputHash'=NEW.input_hash AND o.receipt::jsonb->'wav'->'object'->>'storage_key'=NEW.wav_key AND o.receipt::jsonb->'pcm'->'object'->>'storage_key'=NEW.pcm_key AND o.receipt::jsonb->'wav'->'format'=NEW.wav_format::jsonb AND o.receipt::jsonb->'pcm'->'format'=NEW.pcm_format::jsonb) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Completed speech needs its immutable actual output receipt';END IF;
 END IF;RETURN NEW;
END $dg$;
CREATE TRIGGER native_live_speech_plan_guard BEFORE INSERT OR UPDATE OR DELETE ON live_speech_plans FOR EACH ROW EXECUTE FUNCTION dg_native_live_speech_row_guard();
CREATE TRIGGER native_live_speech_job_guard BEFORE INSERT OR UPDATE OR DELETE ON live_speech_jobs FOR EACH ROW EXECUTE FUNCTION dg_native_live_speech_row_guard();
CREATE FUNCTION dg_native_live_speech_input_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE expected jsonb;
BEGIN
 IF TG_TABLE_NAME='_dg_native_live_speech_plan_inputs' THEN SELECT jsonb_build_object('sessionHash',session_hash,'voice',voice::jsonb,'cues',cues::jsonb) INTO expected FROM live_speech_plans WHERE id=NEW.plan_id AND input_hash=NEW.input_hash;
 ELSE SELECT jsonb_build_object('planId',p.id,'planInputHash',p.input_hash,'sessionHash',p.session_hash,'voice',p.voice::jsonb,'source',j.source::jsonb) INTO expected FROM live_speech_jobs j JOIN live_speech_plans p ON p.id=j.plan_id WHERE j.id=NEW.job_id AND j.input_hash=NEW.input_hash;END IF;
 IF expected IS NULL OR expected IS DISTINCT FROM NEW.snapshot::jsonb THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Speech input ledger must match the actual original plan and job';END IF;RETURN NEW;
END $dg$;
CREATE TRIGGER native_live_speech_plan_input_guard BEFORE INSERT ON _dg_native_live_speech_plan_inputs FOR EACH ROW EXECUTE FUNCTION dg_native_live_speech_input_guard();
CREATE TRIGGER native_live_speech_job_input_guard BEFORE INSERT ON _dg_native_live_speech_job_inputs FOR EACH ROW EXECUTE FUNCTION dg_native_live_speech_input_guard();

CREATE FUNCTION dg_native_live_speech_valid(target text,expected_token text,completed boolean DEFAULT false) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j live_speech_jobs%ROWTYPE;p live_speech_plans%ROWTYPE;s live_sessions%ROWTYPE;v jsonb;q live_audience_events%ROWTYPE;
BEGIN
 SELECT * INTO j FROM live_speech_jobs WHERE id=target;IF NOT FOUND THEN RETURN false;END IF;SELECT * INTO p FROM live_speech_plans WHERE id=j.plan_id;SELECT * INTO s FROM live_sessions WHERE id=j.session_id;
 IF p.id IS NULL OR s.id IS NULL OR j.environment<>'mock' OR j.app_env<>(SELECT app_env FROM _dg_native_runtime_control WHERE id=1) OR j.invalidated_at IS NOT NULL OR j.withdrawn_at IS NOT NULL OR p.invalidated_at IS NOT NULL OR p.withdrawn_at IS NOT NULL OR p.status IN('cancelled','withdrawn') OR s.invalidated_at IS NOT NULL OR s.snapshot_hash<>p.session_hash OR NOT EXISTS(SELECT 1 FROM _dg_native_live_speech_job_inputs i WHERE i.job_id=j.id AND i.input_hash=j.input_hash) OR NOT EXISTS(SELECT 1 FROM _dg_native_live_speech_plan_inputs i WHERE i.plan_id=p.id AND i.input_hash=p.input_hash) THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=j.actor_id AND m.tenant_id=j.tenant_id AND m.role='admin' AND m.workspace_ids::jsonb ? j.workspace_id) OR NOT EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=p.actor_id AND m.tenant_id=p.tenant_id AND m.role='admin' AND m.workspace_ids::jsonb ? p.workspace_id) THEN RETURN false;END IF;
 v:=j.source::jsonb;
 IF v->>'kind'='cue' THEN IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(s.snapshot::jsonb->'definition'->'cues') c WHERE c->>'id'=v->>'cueId' AND c->>'kind'<>'video' AND c->>'text'=v->>'text' AND c->>'durationMs'=v->>'durationMs') THEN RETURN false;END IF;
 ELSE
  IF p.status<>'ready' OR p.result_hash IS NULL OR NOT EXISTS(SELECT 1 FROM _dg_native_live_speech_plan_outputs o WHERE o.plan_id=p.id AND o.result_hash=p.result_hash) THEN RETURN false;END IF;
  IF v->>'kind'='answer' THEN SELECT * INTO q FROM live_audience_events WHERE id=v->>'questionId';IF NOT FOUND OR q.session_id<>s.id OR q.answer IS DISTINCT FROM v->>'text' OR q.citations::jsonb IS DISTINCT FROM v->'citations' OR(q.answer_kind='knowledge' AND NOT dg_native_live_knowledge_answer_valid(q.id)) THEN RETURN false;END IF;END IF;
 END IF;
 IF completed THEN RETURN j.status='succeeded' AND EXISTS(SELECT 1 FROM _dg_native_live_speech_outputs o WHERE o.job_id=j.id);END IF;
 IF j.status<>'processing' OR j.lease_token IS DISTINCT FROM expected_token OR j.lease_until<=dg_utc_now() OR NOT EXISTS(SELECT 1 FROM _dg_native_live_speech_leases l WHERE l.job_id=j.id AND l.token=expected_token AND l.lease_until>dg_utc_now()) THEN RETURN false;END IF;
 IF v->>'kind'='cue' THEN RETURN s.status IN('ready','scheduled') AND p.result_hash IS NULL;END IF;
 IF s.status NOT IN('live','preview') OR(s.state::jsonb->>'epoch')::bigint<>(v->>'epoch')::bigint OR NOT EXISTS(SELECT 1 FROM live_outputs o WHERE o.session_id=s.id AND o.snapshot::jsonb->'settings'->>'speechPlanId'=p.id AND o.invalidated_at IS NULL AND o.withdrawn_at IS NULL) THEN RETURN false;END IF;
 IF v->>'kind'='manual' THEN RETURN(s.state::jsonb->>'manual')::boolean AND s.state::jsonb->>'surface'='manual';END IF;
 RETURN q.status='ready' AND q.version=(v->>'questionVersion')::bigint AND q.prepared_epoch=(v->>'epoch')::bigint AND NOT(s.state::jsonb->>'manual')::boolean AND NOT(s.state::jsonb->>'interactionsPaused')::boolean AND s.state::jsonb->>'answerId' IS NULL;
EXCEPTION WHEN data_exception THEN RETURN false;
END $dg$;

CREATE FUNCTION dg_native_live_speech_claim() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE env text;r live_speech_jobs%ROWTYPE;t text:=gen_random_uuid()::text;until_at text;
BEGIN
 SELECT app_env INTO env FROM _dg_native_runtime_control WHERE id=1 AND session_user=worker_role AND status='validation_only';IF env IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only native speech worker can claim';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('native-live-system-speech-capacity',0)) THEN RETURN NULL;END IF;
 DELETE FROM _dg_native_live_speech_leases WHERE lease_until<=dg_utc_now();
 UPDATE live_speech_jobs j SET status='failed',version=j.version+1,lease_token=NULL,lease_until=NULL,error_code='LIVE_SPEECH_INTERRUPTED',error_message='原执行中断且已达三次上限，请按当前场景新建任务。',updated_at=dg_utc_now() WHERE j.app_env=env AND j.status='processing' AND j.lease_until<=dg_utc_now() AND j.attempts>=3;
 IF EXISTS(SELECT 1 FROM _dg_native_live_speech_leases WHERE lease_until>dg_utc_now()) THEN RETURN NULL;END IF;
 SELECT j.* INTO r FROM live_speech_jobs j WHERE j.environment='mock' AND j.app_env=env AND j.attempts<3 AND(j.status='queued' OR j.status='processing' AND j.lease_until<=dg_utc_now()) AND NOT EXISTS(SELECT 1 FROM _dg_native_live_speech_leases l WHERE l.job_id=j.id) ORDER BY j.created_at,j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED;
 IF r.id IS NULL THEN RETURN NULL;END IF;until_at:=to_char((clock_timestamp()+interval '30 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 UPDATE live_speech_jobs SET status='processing',attempts=attempts+1,version=version+1,lease_token=t,lease_until=until_at,error_code=NULL,error_message=NULL,updated_at=dg_utc_now() WHERE id=r.id RETURNING * INTO r;INSERT INTO _dg_native_live_speech_leases VALUES(r.id,t,until_at);RETURN to_jsonb(r);
END $dg$;
CREATE FUNCTION dg_native_live_speech_renew(target text,expected_token text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE until_at text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND session_user=worker_role) OR NOT dg_native_live_speech_valid(target,expected_token,false) THEN RETURN false;END IF;
 until_at:=to_char((clock_timestamp()+interval '30 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');UPDATE _dg_native_live_speech_leases SET lease_until=until_at WHERE job_id=target AND _dg_native_live_speech_leases.token=expected_token;UPDATE live_speech_jobs SET lease_until=until_at,progress=greatest(progress,.1),updated_at=dg_utc_now() WHERE id=target AND lease_token=expected_token;RETURN true;
END $dg$;
CREATE FUNCTION dg_native_live_speech_release(target text,expected_token text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND session_user=worker_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only worker releases speech slot';END IF;DELETE FROM _dg_native_live_speech_leases l WHERE l.job_id=target AND l.token=expected_token;END $dg$;
CREATE FUNCTION dg_native_live_speech_fail(target text,expected_token text,code text,message text,interrupted boolean,stale boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND session_user=worker_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only worker finishes failed speech';END IF;
 UPDATE live_speech_jobs SET status=CASE WHEN stale THEN 'stale' WHEN interrupted AND attempts<3 THEN 'queued' ELSE 'failed' END,version=version+1,lease_token=NULL,lease_until=NULL,error_code=code,error_message=message,updated_at=dg_utc_now() WHERE id=target AND lease_token=expected_token AND status='processing';
END $dg$;

CREATE FUNCTION dg_native_commit_live_speech(target text,expected_token text,actual_input text,receipt_text text,receipt_digest text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j live_speech_jobs%ROWTYPE;p live_speech_plans%ROWTYPE;v jsonb:=receipt_text::jsonb;w jsonb:=v->'wav';c jsonb:=v->'pcm';total bigint;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND session_user=worker_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only worker commits actual speech';END IF;
 SELECT * INTO j FROM live_speech_jobs WHERE id=target FOR UPDATE;SELECT * INTO p FROM live_speech_plans WHERE id=j.plan_id;
 IF NOT COALESCE(dg_native_live_speech_valid(target,expected_token,false) AND j.input_hash=actual_input AND receipt_digest=encode(sha256(convert_to(receipt_text,'UTF8')),'hex') AND v->>'schemaVersion'='1' AND v->>'pipeline'='native-live-system-speech-v1' AND v->>'jobId'=j.id AND v->>'inputHash'=j.input_hash AND v->'voice'=p.voice::jsonb AND w->'object'->>'storage_key' ~ '^[a-f0-9-]{36}\.bin$' AND c->'object'->>'storage_key' ~ '^[a-f0-9-]{36}\.bin$' AND w->'object'->>'sha256'=w->'format'->>'sha256' AND c->'object'->>'sha256'=c->'format'->>'sha256' AND w->'object'->>'size'=w->'format'->>'size' AND c->'object'->>'size'=c->'format'->>'size' AND w->'format'->>'sampleRate'='22050' AND w->'format'->>'channels'='1' AND w->'format'->>'bitsPerSample'='16' AND c->'format'->>'sampleRate'='48000' AND c->'format'->>'channels'='2' AND c->'format'->>'bitsPerSample'='16' AND(w->'format'->>'size')::bigint BETWEEN 46 AND 67108864 AND(w->'format'->>'durationMs')::numeric>0 AND(w->'format'->>'durationMs')::numeric<=600000 AND(c->'format'->>'size')::bigint BETWEEN 4 AND 115200000 AND(c->'format'->>'samples')::bigint*4=(c->'format'->>'size')::bigint AND(c->'format'->>'frames')::bigint=ceil((c->'format'->>'samples')::numeric/2000) AND w->'format'->>'sha256' ~ '^[a-f0-9]{64}$' AND w->'format'->>'pcmSHA256' ~ '^[a-f0-9]{64}$' AND c->'format'->>'sha256' ~ '^[a-f0-9]{64}$' AND((j.source::jsonb->>'kind'='cue' AND(c->'format'->>'frames')::numeric*1000/24<=(j.source::jsonb->>'durationMs')::numeric+1) OR(j.source::jsonb->>'kind'<>'cue' AND(c->'format'->>'frames')::bigint<=1440)),false) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Speech receipt must match actual current source, voice, formats and lease';END IF;
 SELECT coalesce(sum((wav_format::jsonb->>'size')::bigint+(pcm_format::jsonb->>'size')::bigint),0) INTO total FROM live_speech_jobs WHERE plan_id=p.id AND status='succeeded';IF total+(w->'object'->>'size')::bigint+(c->'object'->>'size')::bigint>536870912 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Speech plan exceeds fixed 512MiB capacity';END IF;
 INSERT INTO _dg_native_live_speech_outputs VALUES(j.id,expected_token,receipt_text,receipt_digest,dg_utc_now());UPDATE live_speech_jobs SET status='succeeded',version=version+1,progress=1,lease_token=NULL,lease_until=NULL,wav_key=w->'object'->>'storage_key',wav_format=(w->'format')::text,pcm_key=c->'object'->>'storage_key',pcm_format=(c->'format')::text,error_code=NULL,error_message=NULL,updated_at=dg_utc_now() WHERE id=j.id;
END $dg$;
CREATE FUNCTION dg_native_live_speech_plan_state(target text,result_text text,result_digest text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE p live_speech_plans%ROWTYPE;expected jsonb;n bigint;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND session_user IN(app_role,worker_role)) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only runtime updates speech plan result';END IF;
 SELECT * INTO p FROM live_speech_plans WHERE id=target FOR UPDATE;IF p.id IS NULL OR p.result_hash IS NOT NULL OR p.status IN('cancelled','withdrawn') OR p.invalidated_at IS NOT NULL THEN RETURN;END IF;
 SELECT count(*) INTO n FROM live_speech_jobs WHERE plan_id=target AND source::jsonb->>'kind'='cue';
 IF result_text IS NOT NULL THEN
  SELECT jsonb_build_object('inputHash',p.input_hash,'clips',coalesce(jsonb_agg(jsonb_build_object('id',j.id,'inputHash',j.input_hash,'wav',j.wav_format::jsonb,'pcm',j.pcm_format::jsonb) ORDER BY j.id),'[]'::jsonb)) INTO expected FROM live_speech_jobs j JOIN _dg_native_live_speech_outputs o ON o.job_id=j.id WHERE j.plan_id=p.id AND j.source::jsonb->>'kind'='cue' AND j.status='succeeded' AND j.withdrawn_at IS NULL AND j.invalidated_at IS NULL;
  IF n<>jsonb_array_length(p.cues::jsonb) OR n<>jsonb_array_length(expected->'clips') OR expected IS DISTINCT FROM result_text::jsonb OR result_digest IS DISTINCT FROM encode(sha256(convert_to(result_text,'UTF8')),'hex') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Ready speech plan requires exact complete cue output receipts';END IF;
  INSERT INTO _dg_native_live_speech_plan_outputs VALUES(p.id,result_text,result_digest,dg_utc_now());UPDATE live_speech_plans SET status='ready',result_hash=result_digest,version=version+1,updated_at=dg_utc_now() WHERE id=p.id;
 ELSIF EXISTS(SELECT 1 FROM live_speech_jobs j WHERE j.plan_id=p.id AND j.source::jsonb->>'kind'='cue' AND(j.status IN('failed','cancelled','stale') OR j.withdrawn_at IS NOT NULL OR j.invalidated_at IS NOT NULL)) THEN IF p.status<>'failed' THEN UPDATE live_speech_plans SET status='failed',version=version+1,updated_at=dg_utc_now() WHERE id=p.id;END IF;
 ELSIF p.status='failed' THEN UPDATE live_speech_plans SET status='building',version=version+1,updated_at=dg_utc_now() WHERE id=p.id;END IF;
END $dg$;

CREATE FUNCTION dg_native_live_speech_invalidate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE plan_target text;job_target text;cue_job boolean:=false;why text:='原系统播音方案、语音用途或准备人权限已变化，旧媒体和派生用途停止使用。';
BEGIN
 IF TG_TABLE_NAME='live_speech_plans' THEN IF NEW.withdrawn_at IS NULL AND NEW.invalidated_at IS NULL AND NEW.status NOT IN('cancelled','withdrawn') THEN RETURN NULL;END IF;plan_target:=NEW.id;
 ELSE IF NEW.withdrawn_at IS NULL AND NEW.invalidated_at IS NULL THEN RETURN NULL;END IF;job_target:=NEW.id;plan_target:=NEW.plan_id;cue_job:=NEW.source::jsonb->>'kind'='cue';END IF;
 UPDATE live_outputs o SET invalidated_at=dg_utc_now(),invalidation_reason=why,version=version+1,updated_at=dg_utc_now() WHERE o.invalidated_at IS NULL AND o.snapshot::jsonb->'settings'->>'speechPlanId'=plan_target AND(job_target IS NULL OR cue_job OR EXISTS(SELECT 1 FROM live_output_spans sp WHERE sp.output_id=o.id AND sp.frame::jsonb->'speech'->>'jobId'=job_target) OR EXISTS(SELECT 1 FROM live_speech_playbacks b WHERE b.session_id=o.session_id AND b.job_id=job_target AND b.status='active'));
 UPDATE live_sessions s SET invalidated_at=dg_utc_now(),invalidation_reason=why,version=version+1,updated_at=dg_utc_now() WHERE s.invalidated_at IS NULL AND EXISTS(SELECT 1 FROM live_outputs o WHERE o.session_id=s.id AND o.invalidated_at IS NOT NULL AND o.snapshot::jsonb->'settings'->>'speechPlanId'=plan_target);
 RETURN NULL;
END $dg$;
CREATE TRIGGER native_live_speech_plan_invalidate AFTER UPDATE ON live_speech_plans FOR EACH ROW EXECUTE FUNCTION dg_native_live_speech_invalidate();
CREATE TRIGGER native_live_speech_job_invalidate AFTER UPDATE ON live_speech_jobs FOR EACH ROW EXECUTE FUNCTION dg_native_live_speech_invalidate();
CREATE FUNCTION dg_native_live_speech_member_invalidate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 UPDATE live_speech_plans p SET invalidated_at=dg_utc_now(),invalidation_reason='原播音准备人权限已变化，请新建方案。',version=version+1,updated_at=dg_utc_now() WHERE p.actor_id=OLD.user_id AND p.invalidated_at IS NULL AND(TG_OP='DELETE' OR NEW.tenant_id<>p.tenant_id OR NEW.role<>'admin' OR NOT(NEW.workspace_ids::jsonb ? p.workspace_id));
 UPDATE live_speech_jobs j SET invalidated_at=dg_utc_now(),invalidation_reason='原播音任务准备人权限已变化，请重新准备。',version=version+1,updated_at=dg_utc_now() WHERE j.actor_id=OLD.user_id AND j.invalidated_at IS NULL AND(TG_OP='DELETE' OR NEW.tenant_id<>j.tenant_id OR NEW.role<>'admin' OR NOT(NEW.workspace_ids::jsonb ? j.workspace_id));RETURN NULL;
END $dg$;
CREATE TRIGGER native_live_speech_member_invalidate AFTER UPDATE OR DELETE ON memberships FOR EACH ROW EXECUTE FUNCTION dg_native_live_speech_member_invalidate();
CREATE FUNCTION dg_native_live_speech_playback_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE j live_speech_jobs%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Speech playback history cannot be deleted';END IF;SELECT * INTO j FROM live_speech_jobs WHERE id=NEW.job_id;
 IF j.id IS NULL OR j.session_id<>NEW.session_id OR j.source::jsonb->>'kind'<>NEW.kind OR NEW.position_frames>(j.pcm_format::jsonb->>'frames')::bigint OR NEW.status='completed' AND NEW.position_frames<>(j.pcm_format::jsonb->>'frames')::bigint THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Speech playback must match its exact actual job and bounded frames';END IF;RETURN NEW;
END $dg$;
CREATE TRIGGER native_live_speech_playback_guard BEFORE INSERT OR UPDATE OR DELETE ON live_speech_playbacks FOR EACH ROW EXECUTE FUNCTION dg_native_live_speech_playback_guard();
CREATE FUNCTION dg_native_live_speech_frame_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE f jsonb:=NEW.frame::jsonb->'speech';j live_speech_jobs%ROWTYPE;o live_outputs%ROWTYPE;
BEGIN
 IF f IS NULL THEN RETURN NEW;END IF;SELECT * INTO j FROM live_speech_jobs WHERE id=f->>'jobId';SELECT * INTO o FROM live_outputs WHERE id=NEW.output_id;
 IF NOT COALESCE(dg_native_live_speech_valid(j.id,NULL,true) AND o.session_id=j.session_id AND o.snapshot::jsonb->'settings'->>'speechPlanId'=j.plan_id AND j.input_hash=f->>'inputHash' AND j.source::jsonb->>'kind'=f->>'kind' AND(j.pcm_format::jsonb->>'frames')::bigint=(f->>'totalFrames')::bigint AND(f->>'offsetSamples')::bigint BETWEEN 0 AND 28800000 AND(f->>'offsetSamples')::bigint%2000=0,false) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Actual speech frame must match fixed selected job and PCM receipt';END IF;RETURN NEW;
END $dg$;
CREATE TRIGGER native_live_speech_frame_guard BEFORE INSERT OR UPDATE ON live_output_spans FOR EACH ROW EXECUTE FUNCTION dg_native_live_speech_frame_guard();
REVOKE ALL ON FUNCTION dg_native_live_speech_row_guard(),dg_native_live_speech_input_guard(),dg_native_live_speech_valid(text,text,boolean),dg_native_live_speech_claim(),dg_native_live_speech_renew(text,text),dg_native_live_speech_release(text,text),dg_native_live_speech_fail(text,text,text,text,boolean,boolean),dg_native_commit_live_speech(text,text,text,text,text),dg_native_live_speech_plan_state(text,text,text),dg_native_live_speech_invalidate(),dg_native_live_speech_member_invalidate(),dg_native_live_speech_playback_guard(),dg_native_live_speech_frame_guard() FROM PUBLIC;

-- Only the owning speech output recovery may rewind a completed answer to its published cutoff.
CREATE OR REPLACE FUNCTION dg_native_live_discussion_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native live event cannot be deleted';END IF;
 IF TG_OP='INSERT' THEN IF NEW.status<>'received' OR NEW.version<>1 OR NEW.answer IS NOT NULL OR NEW.answer_kind IS NOT NULL OR NEW.prepared_epoch IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Live event must start from a received input';END IF;
 ELSE
  IF to_jsonb(NEW)-ARRAY['status','priority','version','answer','answer_kind','citations','product_id','prepared_epoch'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['status','priority','version','answer','answer_kind','citations','product_id','prepared_epoch'] OR NEW.version<>OLD.version+1 OR(OLD.answer IS NOT NULL AND (NEW.answer,NEW.answer_kind,NEW.citations,NEW.product_id,NEW.prepared_epoch) IS DISTINCT FROM (OLD.answer,OLD.answer_kind,OLD.citations,OLD.product_id,OLD.prepared_epoch)) OR(NEW.status<>OLD.status AND NOT((OLD.status IN('received','queued') AND NEW.status IN('queued','rejected','authorized_simulation','ready')) OR(OLD.status='ready' AND NEW.status IN('playing','cancelled')) OR(OLD.status='playing' AND NEW.status IN('answered','cancelled')) OR(OLD.status='answered' AND NEW.status='playing' AND session_user=(SELECT worker_role FROM _dg_native_runtime_control WHERE id=1) AND EXISTS(SELECT 1 FROM live_speech_playbacks b JOIN live_speech_jobs j ON j.id=b.job_id JOIN live_outputs o ON o.session_id=b.session_id WHERE b.session_id=NEW.session_id AND b.status='active' AND j.source::jsonb->>'kind'='answer' AND j.source::jsonb->>'questionId'=NEW.id AND j.status='succeeded' AND j.withdrawn_at IS NULL AND j.invalidated_at IS NULL AND o.status='preparing' AND o.lease_token IS NOT NULL)))) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Live event input, confirmed answer and state transition are protected';END IF;
 END IF;
 RETURN NEW;
END $dg$;
REVOKE ALL ON FUNCTION dg_native_live_discussion_guard() FROM PUBLIC;
