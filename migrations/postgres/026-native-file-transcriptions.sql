-- R-058/R-072: fresh, isolated native validation. Applied001-025 are unchanged.
CREATE TABLE _dg_native_transcription_inputs(
 job_id text PRIMARY KEY REFERENCES studio_transcriptions(id),recognizer text,
 input_hash text NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),created_at text NOT NULL
);
CREATE TABLE _dg_native_transcription_outputs(
 job_id text PRIMARY KEY REFERENCES studio_transcriptions(id),lease_token text NOT NULL,
 analysis text NOT NULL,analysis_hash text NOT NULL CHECK(analysis_hash ~ '^[a-f0-9]{64}$'),
 audio_key text,audio_sha256 text,audio_size bigint,review text NOT NULL,review_hash text NOT NULL,
 created_at text NOT NULL,
 CHECK((audio_key IS NULL AND audio_sha256 IS NULL AND audio_size IS NULL) OR
 (audio_key ~ '^[a-f0-9-]{36}\.bin$' AND audio_sha256 ~ '^[a-f0-9]{64}$' AND audio_size BETWEEN 44 AND 19201024))
);
CREATE TABLE _dg_native_transcription_leases(job_id text PRIMARY KEY REFERENCES studio_transcriptions(id),token text NOT NULL,lease_until text NOT NULL);
DO $dg$ DECLARE target text;BEGIN
 FOREACH target IN ARRAY ARRAY['_dg_native_transcription_inputs','_dg_native_transcription_outputs','studio_transcription_revisions','studio_transcription_sources'] LOOP
  EXECUTE format('CREATE TRIGGER native_transcription_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION dg_native_append_only()',target);
 END LOOP;
END;$dg$;
ALTER TABLE studio_transcriptions ADD CONSTRAINT native_transcription_shape CHECK(
 environment='mock' AND app_env IN('development','sandbox') AND version>0 AND attempts BETWEEN 0 AND 3 AND progress BETWEEN 0 AND 1
 AND status IN('queued','transcribing','review','applied','failed','cancelled','stale')
 AND jsonb_typeof(snapshot::jsonb)='object' AND input_hash ~ '^[a-f0-9]{64}$'
 AND ((status='transcribing' AND lease_token IS NOT NULL AND lease_until IS NOT NULL) OR(status<>'transcribing' AND lease_token IS NULL AND lease_until IS NULL))
 AND ((review IS NULL AND review_version IS NULL AND review_hash IS NULL) OR(review IS NOT NULL AND review_version>0 AND review_hash ~ '^[a-f0-9]{64}$'))
 AND (status NOT IN('review','applied') OR analysis IS NOT NULL AND review IS NOT NULL)
 AND (status<>'applied' OR source_id IS NOT NULL)
);
CREATE FUNCTION dg_native_transcription_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE current_app text;api boolean;worker boolean;heartbeat boolean;mutable text[];
BEGIN
 SELECT app_env,session_user=app_role,session_user=worker_role INTO current_app,api,worker FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only';
 IF current_app IS NULL OR NOT(api OR worker) OR NEW.app_env<>current_app OR NEW.environment<>'mock' OR NOT EXISTS(SELECT 1 FROM workspaces WHERE id=NEW.workspace_id AND tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native transcription scope is invalid';END IF;
 IF TG_OP='INSERT' THEN
  IF NOT api OR NEW.status<>'queued' OR NEW.version<>1 OR NEW.attempts<>0 OR NEW.analysis IS NOT NULL OR NEW.review IS NOT NULL OR NEW.source_id IS NOT NULL OR NEW.withdrawn_at IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Transcription starts as a fixed queued task';END IF;RETURN NEW;
 END IF;
 mutable:=ARRAY['status','version','progress','attempts','lease_token','lease_until','review','review_version','review_hash','source_id','withdrawn_at','error_code','error_message','updated_at'];
 IF worker AND OLD.analysis IS NULL THEN mutable:=mutable||ARRAY['analysis','analysis_hash','audio_key','audio_sha256','audio_size'];END IF;
 heartbeat:=OLD.status='transcribing' AND NEW.status='transcribing' AND NEW.version=OLD.version AND to_jsonb(NEW)-ARRAY['lease_until','progress','updated_at'] IS NOT DISTINCT FROM to_jsonb(OLD)-ARRAY['lease_until','progress','updated_at'];
 IF to_jsonb(NEW)-mutable IS DISTINCT FROM to_jsonb(OLD)-mutable OR(NOT heartbeat AND NEW.version<>OLD.version+1) OR OLD.withdrawn_at IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Fixed transcription input, output and withdrawal are immutable';END IF;
 IF NEW.attempts<>OLD.attempts AND(NOT worker OR NEW.status<>'transcribing' OR NEW.attempts<>OLD.attempts+1 OR NEW.lease_token IS NOT DISTINCT FROM OLD.lease_token) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Only a new worker lease advances attempts';END IF;
 IF OLD.status<>NEW.status AND NOT(
  OLD.status='queued' AND NEW.status IN('transcribing','cancelled') OR
  OLD.status='transcribing' AND NEW.status IN('queued','review','failed','cancelled','stale') OR
  OLD.status IN('failed','cancelled','stale') AND NEW.status='queued' AND NEW.attempts<3 AND NEW.analysis IS NULL OR
  OLD.status='review' AND NEW.status='applied' OR OLD.status='applied' AND NEW.status='review'
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid transcription state transition';END IF;
 IF NEW.status='transcribing' AND NOT worker OR NEW.status='review' AND OLD.status='transcribing' AND NOT worker THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Only worker execution can produce recognition';END IF;
 IF NEW.review IS DISTINCT FROM OLD.review OR NEW.review_version IS DISTINCT FROM OLD.review_version THEN
  IF NEW.review_version<>coalesce(OLD.review_version,0)+1 OR NEW.status<>'review' OR NEW.source_id IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Review revisions advance once and invalidate the current source';END IF;
 ELSIF NEW.review_hash IS DISTINCT FROM OLD.review_hash THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Review digest cannot change independently';END IF;
 RETURN NEW;
END;$dg$;
CREATE TRIGGER native_transcription_guard BEFORE INSERT OR UPDATE ON studio_transcriptions FOR EACH ROW EXECUTE FUNCTION dg_native_transcription_guard();
CREATE FUNCTION dg_native_transcription_receipt_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE j studio_transcriptions%ROWTYPE;i _dg_native_transcription_inputs%ROWTYPE;o _dg_native_transcription_outputs%ROWTYPE;
BEGIN
 SELECT * INTO j FROM studio_transcriptions WHERE id=NEW.id;SELECT * INTO i FROM _dg_native_transcription_inputs WHERE job_id=j.id;
 IF i.job_id IS NULL OR i.input_hash<>j.input_hash OR(j.snapshot::jsonb->'configuration'->>'provider'='windows-offline-asr' AND(i.recognizer IS NULL OR i.recognizer::jsonb->>'id' IS DISTINCT FROM j.snapshot::jsonb->'configuration'->>'recognizerId' OR i.recognizer::jsonb->>'locale' IS DISTINCT FROM j.snapshot::jsonb->'configuration'->>'locale')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Transcription needs its fixed input and recognizer receipt';END IF;
 IF j.analysis IS NOT NULL THEN
  SELECT * INTO o FROM _dg_native_transcription_outputs WHERE job_id=j.id;
  IF o.job_id IS NULL OR o.analysis<>j.analysis OR o.analysis_hash<>j.analysis_hash OR o.audio_key IS DISTINCT FROM j.audio_key OR o.audio_sha256 IS DISTINCT FROM j.audio_sha256 OR o.audio_size IS DISTINCT FROM j.audio_size OR NOT EXISTS(SELECT 1 FROM studio_transcription_revisions v WHERE v.transcription_id=j.id AND v.version=1 AND v.review=o.review AND v.review_hash=o.review_hash) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Recognition output needs its immutable worker receipt';END IF;
 END IF;
 IF j.review IS NOT NULL AND NOT EXISTS(SELECT 1 FROM studio_transcription_revisions v WHERE v.transcription_id=j.id AND v.version=j.review_version AND v.review=j.review AND v.review_hash=j.review_hash) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Current review needs its immutable revision';END IF;
 IF j.source_id IS NOT NULL AND(j.status<>'applied' OR NOT EXISTS(SELECT 1 FROM studio_transcription_sources s WHERE s.source_id=j.source_id AND s.transcription_id=j.id AND s.review_version=j.review_version AND s.review_hash=j.review_hash)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Applied source needs its confirmation receipt';END IF;RETURN NULL;
END;$dg$;
CREATE CONSTRAINT TRIGGER native_transcription_receipt AFTER INSERT OR UPDATE ON studio_transcriptions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_transcription_receipt_guard();

CREATE FUNCTION dg_native_transcription_valid(target text,expected_token text,completed boolean DEFAULT false) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE current_app text;j studio_transcriptions%ROWTYPE;
BEGIN
 SELECT app_env INTO current_app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user=worker_role;
 IF current_app IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only native file ASR worker can validate execution';END IF;
 SELECT * INTO j FROM studio_transcriptions WHERE id=target;
 IF j.id IS NULL OR j.environment<>'mock' OR j.app_env<>current_app OR j.withdrawn_at IS NOT NULL OR j.snapshot::jsonb->>'expiresAt'<=dg_utc_now() OR NOT EXISTS(SELECT 1 FROM _dg_native_transcription_inputs i WHERE i.job_id=j.id AND i.input_hash=j.input_hash) OR NOT EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=j.actor_id AND m.tenant_id=j.tenant_id AND m.role IN('admin','editor') AND m.workspace_ids::jsonb ? j.workspace_id) OR NOT EXISTS(SELECT 1 FROM _dg_native_transcription_leases l WHERE l.job_id=j.id AND l.token=expected_token AND l.lease_until>dg_utc_now()) THEN RETURN false;END IF;
 RETURN(NOT completed AND j.status='transcribing' AND j.lease_token=expected_token AND j.lease_until>dg_utc_now()) OR(completed AND j.status='review' AND EXISTS(SELECT 1 FROM _dg_native_transcription_outputs o WHERE o.job_id=j.id AND o.lease_token=expected_token));
END;$dg$;
CREATE FUNCTION dg_native_transcription_claim() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE current_app text;j studio_transcriptions%ROWTYPE;token text:=gen_random_uuid()::text;until_at text;
BEGIN
 SELECT app_env INTO current_app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user=worker_role;
 IF current_app IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only native file ASR worker can claim';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('native-file-transcription-capacity',0)) THEN RETURN NULL;END IF;
 DELETE FROM _dg_native_transcription_leases WHERE lease_until<=dg_utc_now();
 UPDATE studio_transcriptions SET status='failed',version=version+1,lease_token=NULL,lease_until=NULL,error_code='TRANSCRIPTION_INTERRUPTED',error_message='离线转写已达到三次执行上限，请新建任务。',updated_at=dg_utc_now() WHERE environment='mock' AND app_env=current_app AND status='transcribing' AND lease_until<=dg_utc_now() AND attempts>=3;
 IF(SELECT count(*) FROM _dg_native_transcription_leases WHERE lease_until>dg_utc_now())>=2 THEN RETURN NULL;END IF;
 SELECT * INTO j FROM studio_transcriptions t WHERE t.environment='mock' AND t.app_env=current_app AND t.withdrawn_at IS NULL AND t.attempts<3 AND(t.status='queued' OR t.status='transcribing' AND t.lease_until<=dg_utc_now()) AND NOT EXISTS(SELECT 1 FROM _dg_native_transcription_leases l WHERE l.job_id=t.id) ORDER BY t.created_at,t.id LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF j.id IS NULL THEN RETURN NULL;END IF;until_at:=to_char((clock_timestamp()+interval '30 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 UPDATE studio_transcriptions SET status='transcribing',version=version+1,progress=0,attempts=attempts+1,lease_token=token,lease_until=until_at,error_code=NULL,error_message=NULL,updated_at=dg_utc_now() WHERE id=j.id RETURNING * INTO j;
 INSERT INTO _dg_native_transcription_leases VALUES(j.id,token,until_at);RETURN to_jsonb(j);
END;$dg$;
CREATE FUNCTION dg_native_transcription_hold(target text,expected_token text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND session_user=worker_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only native ASR worker can hold';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('native-file-transcription-capacity',0));
 UPDATE _dg_native_transcription_leases SET lease_until=to_char((clock_timestamp()+interval '30 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') WHERE job_id=target AND token=expected_token AND lease_until>dg_utc_now();RETURN FOUND;
END;$dg$;
CREATE FUNCTION dg_native_transcription_renew(target text,expected_token text,fraction double precision) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF fraction IS NULL OR fraction<0 OR fraction>0.96 OR NOT dg_native_transcription_valid(target,expected_token,false) THEN RETURN false;END IF;
 UPDATE studio_transcriptions SET lease_until=to_char((clock_timestamp()+interval '30 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),progress=greatest(progress,fraction),updated_at=dg_utc_now() WHERE id=target;RETURN true;
END;$dg$;
CREATE FUNCTION dg_native_transcription_release(target text,expected_token text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND session_user=worker_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only native ASR worker can release';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('native-file-transcription-capacity',0));DELETE FROM _dg_native_transcription_leases WHERE job_id=target AND token=expected_token;RETURN FOUND;
END;$dg$;
CREATE FUNCTION dg_native_transcription_fail(target text,expected_token text,code text,message text,stopped boolean,source_stale boolean) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND session_user=worker_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only native ASR worker can fail';END IF;
 UPDATE studio_transcriptions SET status=CASE WHEN source_stale THEN 'stale' WHEN stopped AND attempts<3 THEN 'queued' ELSE 'failed' END,version=version+1,lease_token=NULL,lease_until=NULL,error_code=code,error_message=message,updated_at=dg_utc_now() WHERE id=target AND status='transcribing' AND lease_token=expected_token AND lease_until>dg_utc_now();RETURN FOUND;
END;$dg$;
CREATE FUNCTION dg_native_commit_transcription(target text,expected_token text,actual_input text,analysis_text text,analysis_digest text,audio jsonb,review_text text,review_digest text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j studio_transcriptions%ROWTYPE;a jsonb:=analysis_text::jsonb;key text;sha text;bytes bigint;requester text;
BEGIN
 SELECT actor_id INTO requester FROM studio_transcriptions WHERE id=target;PERFORM user_id FROM dg_native_locked_membership(requester);
 SELECT * INTO j FROM studio_transcriptions WHERE id=target FOR UPDATE;
 IF NOT dg_native_transcription_valid(target,expected_token,false) OR j.input_hash IS DISTINCT FROM actual_input OR j.analysis IS NOT NULL OR a->>'provider' IS DISTINCT FROM j.snapshot::jsonb->'configuration'->>'provider' OR analysis_digest !~ '^[a-f0-9]{64}$' OR review_digest !~ '^[a-f0-9]{64}$' OR jsonb_typeof(a->'segments') IS DISTINCT FROM 'array' OR jsonb_typeof(review_text::jsonb->'segments') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Transcription completion has stale input or invalid analysis';END IF;
 IF a->>'provider'='windows-offline-asr' THEN
  key:=audio->>'storageKey';sha:=audio->>'sha256';bytes:=(audio->>'size')::bigint;
  IF (a->>'simulated')::boolean IS DISTINCT FROM false OR(a->>'inputStreamEnded')::boolean IS DISTINCT FROM true OR a->>'audioSHA256' IS DISTINCT FROM sha OR key IS NULL OR key !~ '^[a-f0-9-]{36}\.bin$' OR sha IS NULL OR sha !~ '^[a-f0-9]{64}$' OR bytes IS NULL OR bytes NOT BETWEEN 44 AND 19201024 OR NOT EXISTS(SELECT 1 FROM _dg_native_transcription_inputs i WHERE i.job_id=j.id AND i.recognizer::jsonb=a->'recognizer') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Real ASR requires its actual PCM and fixed recognizer';END IF;
 ELSIF a->>'provider'<>'mock-file-asr' OR(a->>'simulated')::boolean IS DISTINCT FROM true OR audio IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Mock ASR is explicit report only';END IF;
 INSERT INTO _dg_native_transcription_outputs VALUES(j.id,expected_token,analysis_text,analysis_digest,key,sha,bytes,review_text,review_digest,dg_utc_now());
 INSERT INTO studio_transcription_revisions VALUES(j.id,1,review_text,review_digest,j.actor_id,dg_utc_now());
 UPDATE studio_transcriptions SET status='review',version=version+1,progress=1,lease_token=NULL,lease_until=NULL,analysis=analysis_text,analysis_hash=analysis_digest,audio_key=key,audio_sha256=sha,audio_size=bytes,review=review_text,review_version=1,review_hash=review_digest,error_code=NULL,error_message=NULL,updated_at=dg_utc_now() WHERE id=j.id;
 INSERT INTO audit_events VALUES(gen_random_uuid()::text,j.tenant_id,j.workspace_id,j.actor_id,'transcription.complete',j.id,'confirmed',expected_token,dg_utc_now());RETURN j.id;
END;$dg$;

-- An API client cannot label pasted text as human-reviewed ASR without this bound receipt.
CREATE FUNCTION dg_native_transcription_source_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE s studio_content_sources%ROWTYPE;j studio_transcriptions%ROWTYPE;o jsonb;binding studio_transcription_sources%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='studio_content_sources' THEN
  SELECT * INTO s FROM studio_content_sources WHERE id=NEW.id;
  IF s.kind<>'video' OR s.origin::jsonb->>'mode'<>'reviewed_video_asr' THEN RETURN NULL;END IF;
  SELECT * INTO binding FROM studio_transcription_sources WHERE source_id=s.id;
 ELSE SELECT * INTO binding FROM studio_transcription_sources WHERE source_id=NEW.source_id;SELECT * INTO s FROM studio_content_sources WHERE id=binding.source_id;END IF;
 SELECT * INTO j FROM studio_transcriptions WHERE id=binding.transcription_id;o:=s.origin::jsonb;
 IF s.id IS NULL OR j.id IS NULL OR j.tenant_id<>s.tenant_id OR j.workspace_id<>s.workspace_id OR j.environment<>s.environment OR j.app_env<>s.app_env OR j.actor_id<>binding.actor_id OR binding.review_hash IS DISTINCT FROM o->>'reviewSHA256' OR binding.review_version IS DISTINCT FROM (o->>'reviewVersion')::bigint OR j.id IS DISTINCT FROM o->>'transcriptionId' OR j.analysis_hash IS DISTINCT FROM o->>'analysisSHA256' OR j.snapshot::jsonb->'configuration'->>'provider'<>'windows-offline-asr' OR(j.analysis::jsonb->>'simulated')::boolean IS DISTINCT FROM false OR NOT EXISTS(SELECT 1 FROM _dg_native_transcription_outputs WHERE job_id=j.id) OR NOT EXISTS(SELECT 1 FROM studio_transcription_revisions WHERE transcription_id=j.id AND version=binding.review_version AND review_hash=binding.review_hash) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Reviewed ASR content requires its real analysis and bound review receipt';END IF;RETURN NULL;
END;$dg$;
CREATE CONSTRAINT TRIGGER native_reviewed_asr_source AFTER INSERT ON studio_content_sources DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_transcription_source_guard();
CREATE CONSTRAINT TRIGGER native_reviewed_asr_binding AFTER INSERT ON studio_transcription_sources DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_transcription_source_guard();
DO $dg$ DECLARE f record;BEGIN FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace=current_schema()::regnamespace AND proname LIKE 'dg_native_%transcription%' LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||f.signature||' FROM PUBLIC';END LOOP;END;$dg$;
