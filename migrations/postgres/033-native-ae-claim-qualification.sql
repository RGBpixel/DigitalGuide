-- Correct local-record/table-alias ambiguity and actual app_role column. Applied032 remains frozen.
CREATE OR REPLACE FUNCTION dg_native_ae_refresh_batch(target text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE next_status text;BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control c JOIN ae_batches b ON b.app_env=c.app_env WHERE c.id=1 AND c.status='validation_only' AND session_user IN(c.app_role,c.worker_role) AND b.id=target) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Native runtime batch only';END IF;
 SELECT CASE WHEN count(*) FILTER(WHERE status IN('queued','rendering'))>0 THEN 'running' WHEN count(*) FILTER(WHERE status IN('failed','cancelled'))>0 THEN 'completed_with_errors' ELSE 'completed' END INTO next_status FROM ae_render_jobs WHERE batch_id=target;
 UPDATE ae_batches SET status=next_status,version=version+1,updated_at=dg_utc_now() WHERE id=target AND status<>'cancelled' AND status<>next_status;
END;$dg$;
CREATE OR REPLACE FUNCTION dg_native_ae_render_claim(capacity integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE app text;j ae_render_jobs%ROWTYPE;token text:=gen_random_uuid()::text;until_at text;bid text;
BEGIN
 SELECT app_env INTO app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user=worker_role;IF app IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only worker claims native AE renders';END IF;
 IF capacity IS NULL OR capacity NOT BETWEEN 1 AND 2 OR NOT pg_try_advisory_xact_lock(hashtextextended('native-ae-render-capacity',0)) THEN RETURN NULL;END IF;DELETE FROM _dg_native_ae_render_leases WHERE lease_until<=dg_utc_now();
 FOR bid IN SELECT b.id FROM ae_batches b WHERE b.app_env=app AND b.status='running' AND EXISTS(SELECT 1 FROM ae_render_jobs expired WHERE expired.batch_id=b.id AND expired.status='rendering' AND expired.lease_until<=dg_utc_now() AND expired.attempts>=3) FOR UPDATE OF b SKIP LOCKED LOOP
  UPDATE ae_render_attempts a SET status='interrupted',error_message='原租约中断且恢复次数已用完。',finished_at=dg_utc_now() FROM ae_render_jobs x WHERE a.job_id=x.id AND x.batch_id=bid AND x.status='rendering' AND x.lease_until<=dg_utc_now() AND x.attempts>=3 AND a.status='rendering';
  UPDATE ae_render_jobs SET status='failed',stage='finished',version=version+1,lease_token=NULL,lease_until=NULL,error_code='AE_RECOVERY_LIMIT',error_message='三次执行已用完，请保留记录并新建批次。',updated_at=dg_utc_now() WHERE batch_id=bid AND status='rendering' AND lease_until<=dg_utc_now() AND attempts>=3;PERFORM dg_native_ae_refresh_batch(bid);
 END LOOP;
 IF(SELECT count(*) FROM _dg_native_ae_render_leases)>=capacity THEN RETURN NULL;END IF;
 SELECT x.* INTO j FROM ae_render_jobs x JOIN ae_batches b ON b.id=x.batch_id WHERE b.app_env=app AND b.environment='mock' AND b.status='running' AND x.attempts<3 AND(x.status='queued' OR x.status='rendering' AND x.lease_until<=dg_utc_now()) AND NOT EXISTS(SELECT 1 FROM _dg_native_ae_render_leases WHERE job_id=x.id) ORDER BY x.created_at,x.position,x.id LIMIT 1 FOR UPDATE OF b,x SKIP LOCKED;IF j.id IS NULL THEN RETURN NULL;END IF;
 UPDATE ae_render_attempts SET status='interrupted',error_message='原租约中断，使用原固定输入和新目录自然恢复。',finished_at=dg_utc_now() WHERE job_id=j.id AND status='rendering';until_at:=to_char((clock_timestamp()+interval '30 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 UPDATE ae_render_jobs SET status='rendering',stage='preparing',version=version+1,attempts=attempts+1,lease_token=token,lease_until=until_at,error_code=NULL,error_message=NULL,updated_at=dg_utc_now() WHERE id=j.id RETURNING * INTO j;
 INSERT INTO ae_render_attempts VALUES(j.id,j.attempts,'rendering',j.parameters,NULL,dg_utc_now(),NULL,j.actor_id);INSERT INTO _dg_native_ae_render_leases VALUES(j.id,token,until_at);RETURN to_jsonb(j);
END;$dg$;
