-- 021 was already applied to an actual validation instance and remains immutable.
-- Qualify the expired-job update when both the job and its project expose version.
CREATE OR REPLACE FUNCTION dg_native_speech_claim() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE current_app text;r studio_speech_jobs%ROWTYPE;new_token text:=gen_random_uuid()::text;until_at text;
BEGIN
 SELECT app_env INTO current_app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND environment='mock' AND session_user=worker_role;
 IF current_app IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only the native speech worker can claim';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('native-system-speech-capacity',0)) THEN RETURN NULL;END IF;
 DELETE FROM _dg_native_speech_leases WHERE lease_until<=dg_utc_now();
 UPDATE studio_speech_jobs j SET status='failed',error_code='SPEECH_INTERRUPTED',error_message='上次系统配音中断，已达到两次执行上限，请重新建立任务。',lease_token=NULL,lease_until=NULL,version=j.version+1,updated_at=dg_utc_now() FROM _dg_native_speech_inputs i JOIN studio_projects p ON p.tenant_id=i.tenant_id AND p.workspace_id=i.workspace_id WHERE i.job_id=j.id AND p.id=j.project_id AND p.environment='mock' AND p.app_env=current_app AND j.status='rendering' AND j.lease_until<=dg_utc_now() AND j.attempts>=2;
 IF(SELECT count(*) FROM _dg_native_speech_leases WHERE lease_until>dg_utc_now())>=2 THEN RETURN NULL;END IF;
 SELECT j.* INTO r FROM studio_speech_jobs j JOIN _dg_native_speech_inputs i ON i.job_id=j.id JOIN studio_projects p ON p.id=j.project_id AND p.tenant_id=i.tenant_id AND p.workspace_id=i.workspace_id WHERE p.environment='mock' AND p.app_env=current_app AND j.attempts<2 AND(j.status='queued' OR(j.status='rendering' AND j.lease_until<=dg_utc_now())) AND NOT EXISTS(SELECT 1 FROM _dg_native_speech_leases l WHERE l.job_id=j.id) ORDER BY j.created_at,j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED;
 IF r.id IS NULL THEN RETURN NULL;END IF;until_at:=to_char((clock_timestamp()+interval '30 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 UPDATE studio_speech_jobs SET status='rendering',attempts=attempts+1,lease_token=new_token,lease_until=until_at,error_code=NULL,error_message=NULL,version=version+1,updated_at=dg_utc_now() WHERE id=r.id RETURNING * INTO r;INSERT INTO _dg_native_speech_leases VALUES(r.id,new_token,until_at);RETURN to_jsonb(r);
END;$dg$;
REVOKE ALL ON FUNCTION dg_native_speech_claim() FROM PUBLIC;
