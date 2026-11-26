-- R-053/R-054/R-059. Recovery conservatively removes uncertain old personal
-- data. Keep that operational decision distinct from an original owner request.
CREATE OR REPLACE FUNCTION dg_native_people_erase_before_visits(target text,reason_value text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE p people%ROWTYPE;receipt_id text;time_value text:=dg_utc_now();s record;plan_value text;
BEGIN
 IF reason_value='recovery_conservative' THEN
  plan_value:=current_setting('digitalguide.recovery_privacy_plan',true);
  IF session_user IS DISTINCT FROM(SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname=current_schema()) OR NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND status='recovery_quarantined' AND environment='mock') OR to_regclass('public._dg_native_recovery_control') IS NULL THEN PERFORM dg_native_people_error('STATE_CONFLICT');END IF;
  IF NOT EXISTS(SELECT 1 FROM public._dg_native_recovery_control r JOIN _dg_native_recovery_journal_plans j ON j.backup_id=r.backup_id AND j.runtime_id=r.runtime_id WHERE r.id=1 AND r.status='quarantined' AND r.schema_name=current_schema() AND j.id=plan_value AND j.status='pending') THEN PERFORM dg_native_people_error('STATE_CONFLICT');END IF;
 END IF;
 SELECT * INTO p FROM people WHERE id=target FOR UPDATE;SELECT id INTO receipt_id FROM privacy_requests WHERE person_id=target AND status='completed' ORDER BY created_at,id LIMIT 1;IF receipt_id IS NOT NULL THEN RETURN receipt_id;END IF;
 IF p.id IS NULL OR reason_value NOT IN('owner_request','retention_expired','membership_withdrawn','recovery_conservative') THEN PERFORM dg_native_people_error('STATE_CONFLICT');END IF;
 PERFORM dg_native_people_invalidate(target);
 FOR s IN SELECT DISTINCT session_id,focus_version FROM memory_session_links WHERE person_id=target LOOP
  UPDATE reception_messages SET text='',knowledge_citations='[]',status='cancelled' WHERE session_id=s.session_id AND(focus_version=s.focus_version OR memory_person_id=target) AND(text<>'' OR knowledge_citations<>'[]' OR status<>'cancelled');
  IF FOUND THEN UPDATE reception_sessions SET version=version+1,reply_epoch=reply_epoch+1 WHERE id=s.session_id AND status IN('active','human');END IF;
 END LOOP;
 DELETE FROM memory_session_links WHERE person_id=target;DELETE FROM memory_session_greetings WHERE person_id=target;DELETE FROM memory_lookup WHERE person_id=target;DELETE FROM memory_facts WHERE person_id=target;DELETE FROM memory_notes WHERE person_id=target;
 UPDATE memory_recovery_credentials SET token_hash='',revoked_at=coalesce(revoked_at,time_value) WHERE person_id=target;UPDATE _dg_native_people_guards SET invalidated_at=coalesce(invalidated_at,time_value) WHERE person_id=target;
 UPDATE people SET display_name='已删除资料',roles='[]',identity_kind='self_reported',owner_user_id=NULL,guest_session_id=NULL,status='deleted',personalization=0,do_not_disturb=1,quiet_start='22:00',quiet_end='08:00',cooldown_minutes=60,last_greeted_at=NULL,version=version+1,updated_at=time_value WHERE id=target;
 receipt_id:=gen_random_uuid()::text;INSERT INTO privacy_requests VALUES(receipt_id,p.id,p.tenant_id,p.workspace_id,reason_value,'completed',time_value,'not_applicable',time_value);INSERT INTO outbox_events VALUES(gen_random_uuid()::text,p.tenant_id,p.workspace_id,receipt_id,'privacy.local_completed','mock','{}',time_value,NULL);RETURN receipt_id;
END;$dg$;
REVOKE ALL ON FUNCTION dg_native_people_erase_before_visits(text,text) FROM PUBLIC;
