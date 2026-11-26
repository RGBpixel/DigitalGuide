-- R-038/R-039/R-053/R-054: visit-scoped public replies and self erasure.
ALTER TABLE reception_messages ADD COLUMN native_visit_id text REFERENCES visits(id);
ALTER TABLE reception_messages ADD COLUMN native_visit_version bigint;
ALTER TABLE reception_messages ADD CONSTRAINT native_visit_reply_shape CHECK((native_visit_id IS NULL)=(native_visit_version IS NULL) AND(native_visit_id IS NULL OR native_visit_version>0 AND memory_person_id IS NULL AND native_memory_version IS NULL AND memory_fact_ids='[]' AND role='assistant'));
CREATE INDEX native_visit_reply_source ON reception_messages(native_visit_id) WHERE native_visit_id IS NOT NULL;
CREATE TABLE _dg_native_visit_erasure_receipts(
 id text PRIMARY KEY,visit_id text UNIQUE NOT NULL REFERENCES visits(id),focus_version bigint NOT NULL,
 reason text NOT NULL CHECK(reason IN('owner_request','profile_erased','retention_expired')),created_at text NOT NULL
);
CREATE TRIGGER native_visit_erasure_receipt_immutable BEFORE UPDATE OR DELETE ON _dg_native_visit_erasure_receipts FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();

CREATE OR REPLACE FUNCTION dg_native_reception_message_payload(target text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT(to_jsonb(m)-ARRAY['status','text']-CASE WHEN m.native_memory_version IS NULL THEN ARRAY['native_memory_version'] ELSE ARRAY[]::text[] END-CASE WHEN m.native_visit_id IS NULL THEN ARRAY['native_visit_id','native_visit_version'] ELSE ARRAY[]::text[] END)||jsonb_build_object('textHash',encode(sha256(convert_to(m.text,'UTF8')),'hex')) FROM reception_messages m WHERE m.id=target
$dg$;
CREATE FUNCTION dg_native_visit_reply_text(target text) RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT '【模拟来访回复】'||(p->>'publicMessage')||CASE WHEN p->>'guidance' IS NULL THEN '' ELSE ' '||(p->>'guidance') END FROM(SELECT dg_native_visit_public(target) p) q
$dg$;
CREATE FUNCTION dg_native_visit_reply_context(target text,token_hash_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s reception_sessions%ROWTYPE;v visits%ROWTYPE;text_value text;
BEGIN
 s:=dg_native_visit_session(target,token_hash_value,NULL,NULL,false);SELECT * INTO v FROM visits WHERE session_id=target AND focus_version=s.focus_version;
 IF s.status<>'active' OR v.id IS NULL OR NOT dg_native_visit_source_valid(v.id) THEN RETURN NULL;END IF;
 text_value:=dg_native_visit_reply_text(v.id);
 PERFORM set_config('digitalguide.native_visit_reply',jsonb_build_object('visitId',v.id,'version',v.version,'sessionId',s.id,'focusVersion',s.focus_version,'textHash',encode(sha256(convert_to(text_value,'UTF8')),'hex'))::text,true);
 RETURN jsonb_build_object('visitId',v.id,'version',v.version,'text',text_value);
END;$dg$;
CREATE FUNCTION dg_native_visit_reply_valid(target text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT EXISTS(SELECT 1 FROM reception_messages m JOIN visits v ON v.id=m.native_visit_id WHERE m.id=target AND m.native_visit_version=v.version AND m.session_id=v.session_id AND m.focus_version=v.focus_version AND m.role='assistant' AND m.text=dg_native_visit_reply_text(v.id) AND dg_native_visit_source_valid(v.id))
$dg$;
CREATE FUNCTION dg_native_visit_reply_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE proof jsonb;v visits%ROWTYPE;
BEGIN
 IF TG_OP='INSERT' AND NEW.role='assistant' AND nullif(current_setting('digitalguide.native_visit_reply',true),'') IS NOT NULL THEN
  proof:=current_setting('digitalguide.native_visit_reply',true)::jsonb;
  IF proof->>'sessionId'=NEW.session_id AND proof->>'focusVersion'=NEW.focus_version::text AND proof->>'textHash'=encode(sha256(convert_to(NEW.text,'UTF8')),'hex') THEN NEW.native_visit_id:=proof->>'visitId';NEW.native_visit_version:=(proof->>'version')::bigint;END IF;
 END IF;
 IF NEW.native_visit_id IS NOT NULL AND NEW.status IN('ready','playing','completed') AND NEW.text<>'' THEN
  SELECT * INTO v FROM visits WHERE id=NEW.native_visit_id;
  IF v.id IS NULL OR v.version<>NEW.native_visit_version OR NEW.session_id<>v.session_id OR NEW.focus_version<>v.focus_version OR NEW.text<>dg_native_visit_reply_text(v.id) OR NOT dg_native_visit_source_valid(v.id) THEN PERFORM dg_native_visit_error('STATE_CONFLICT');END IF;
 END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER aa_native_visit_reply_guard BEFORE INSERT OR UPDATE ON reception_messages FOR EACH ROW EXECUTE FUNCTION dg_native_visit_reply_guard();
CREATE FUNCTION dg_native_visit_reply_final() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE m reception_messages%ROWTYPE;
BEGIN
 SELECT * INTO m FROM reception_messages WHERE id=NEW.id;
 IF m.native_visit_id IS NOT NULL AND m.status IN('ready','playing','completed') AND m.text<>'' AND NOT dg_native_visit_reply_valid(m.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Public visit reply requires its current version and original guest scope';END IF;RETURN NULL;
END;$dg$;
CREATE CONSTRAINT TRIGGER native_visit_reply_final AFTER INSERT OR UPDATE ON reception_messages DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_visit_reply_final();
CREATE FUNCTION dg_native_visit_reply_withdraw() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE sid text;changed bigint;
BEGIN
 IF TG_TABLE_NAME='visits' THEN IF to_jsonb(NEW)=to_jsonb(OLD) THEN RETURN NULL;END IF;sid:=NEW.session_id;
 ELSE sid:=NEW.session_id;IF NEW.context_invalidated_at IS NOT DISTINCT FROM OLD.context_invalidated_at AND NEW.redacted_at IS NOT DISTINCT FROM OLD.redacted_at THEN RETURN NULL;END IF;END IF;
 UPDATE reception_messages SET text='',status='cancelled',knowledge_citations='[]' WHERE native_visit_id=CASE WHEN TG_TABLE_NAME='visits' THEN to_jsonb(NEW)->>'id' ELSE to_jsonb(NEW)->>'visit_id' END AND(text<>'' OR status<>'cancelled');GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed>0 THEN UPDATE reception_sessions SET version=version+1,reply_epoch=reply_epoch+1 WHERE id=sid AND status IN('active','human');END IF;RETURN NULL;
END;$dg$;
CREATE TRIGGER native_visit_reply_withdraw AFTER UPDATE ON visits FOR EACH ROW EXECUTE FUNCTION dg_native_visit_reply_withdraw();
CREATE TRIGGER native_visit_origin_reply_withdraw AFTER UPDATE ON _dg_native_visit_origins FOR EACH ROW EXECUTE FUNCTION dg_native_visit_reply_withdraw();

CREATE FUNCTION dg_native_visit_redact(target text,reason_value text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v visits%ROWTYPE;o _dg_native_visit_origins%ROWTYPE;receipt_value text;
BEGIN
 SELECT * INTO STRICT v FROM visits WHERE id=target;SELECT * INTO STRICT o FROM _dg_native_visit_origins WHERE visit_id=target;
 IF reason_value NOT IN('owner_request','profile_erased','retention_expired') THEN PERFORM dg_native_visit_error('VALIDATION_FAILED');END IF;
 PERFORM dg_native_reception_workspace(o.tenant_id,o.workspace_id,true);PERFORM id FROM reception_terminals WHERE id=o.terminal_id FOR UPDATE;PERFORM id FROM reception_sessions WHERE id=o.session_id FOR UPDATE;PERFORM id FROM visits WHERE id=target FOR UPDATE;
 SELECT id INTO receipt_value FROM _dg_native_visit_erasure_receipts WHERE visit_id=target;IF receipt_value IS NOT NULL THEN RETURN receipt_value;END IF;
 PERFORM dg_native_visit_escalate(target,'privacy_erased',true);
 UPDATE visits SET guest_name='',company='',purpose='',appointment_ref='',host_name='',host_private_note=NULL,guidance_code=NULL,version=version+1,updated_at=dg_utc_now() WHERE id=target;
 UPDATE _dg_native_visit_origins SET redacted_at=coalesce(redacted_at,dg_utc_now()),context_invalidated_at=coalesce(context_invalidated_at,dg_utc_now()) WHERE visit_id=target;
 receipt_value:=gen_random_uuid()::text;INSERT INTO _dg_native_visit_erasure_receipts VALUES(receipt_value,target,v.focus_version,reason_value,dg_utc_now());RETURN receipt_value;
END;$dg$;
CREATE FUNCTION dg_native_visit_erase(target text,token_hash_value text,csrf_hash_value text,input jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s reception_sessions%ROWTYPE;v visits%ROWTYPE;
BEGIN
 PERFORM dg_native_reception_fields(input,ARRAY['version','focusVersion','confirmed']);s:=dg_native_visit_session(target,token_hash_value,csrf_hash_value,(input->>'focusVersion')::bigint,true);
 SELECT * INTO v FROM visits WHERE session_id=target AND focus_version=s.focus_version FOR UPDATE;
 IF v.id IS NULL THEN PERFORM dg_native_visit_error('NOT_FOUND');END IF;
 IF input->>'confirmed'<>'true' OR input->>'version' IS DISTINCT FROM v.version::text THEN PERFORM dg_native_visit_error('VERSION_CONFLICT');END IF;
 PERFORM dg_native_visit_redact(v.id,'owner_request');RETURN v.id;
END;$dg$;

-- Couple the existing person privacy transaction to its original session/focus
-- links before the underlying erasure removes those links.
ALTER FUNCTION dg_native_people_erase_internal(text,text) RENAME TO dg_native_people_erase_before_visits;
CREATE FUNCTION dg_native_people_erase_internal(target text,reason_value text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v record;p people%ROWTYPE;
BEGIN
 SELECT * INTO p FROM people WHERE id=target FOR UPDATE;
 FOR v IN SELECT q.id FROM memory_session_links l JOIN visits q ON q.session_id=l.session_id AND q.focus_version=l.focus_version JOIN _dg_native_visit_origins o ON o.visit_id=q.id WHERE l.person_id=target AND q.tenant_id=p.tenant_id AND q.workspace_id=p.workspace_id ORDER BY q.session_id LOOP PERFORM dg_native_visit_redact(v.id,'profile_erased');END LOOP;
 RETURN dg_native_people_erase_before_visits(target,reason_value);
END;$dg$;
ALTER FUNCTION dg_native_guest_memory_export(text,text) RENAME TO dg_native_guest_memory_export_before_visits;
CREATE FUNCTION dg_native_guest_memory_export(target text,token_hash_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE result jsonb;p people%ROWTYPE;visits_value jsonb;
BEGIN
 result:=dg_native_guest_memory_export_before_visits(target,token_hash_value);p:=dg_native_guest_memory_owned(target);
 SELECT coalesce(jsonb_agg(dg_native_visit_public(q.id) ORDER BY q.created_at,q.id),'[]') INTO visits_value FROM memory_session_links l JOIN visits q ON q.session_id=l.session_id AND q.focus_version=l.focus_version JOIN _dg_native_visit_origins o ON o.visit_id=q.id WHERE l.person_id=p.id AND q.tenant_id=p.tenant_id AND q.workspace_id=p.workspace_id AND o.expires_at>dg_utc_now();
 RETURN result||jsonb_build_object('visits',visits_value);
END;$dg$;

-- Existing public grants are explicitly re-established by runtime-bootstrap.
REVOKE ALL ON FUNCTION dg_native_people_erase_internal(text,text),dg_native_guest_memory_export(text,text),dg_native_people_erase_before_visits(text,text),dg_native_guest_memory_export_before_visits(text,text) FROM PUBLIC;
DO $dg$ DECLARE r record;BEGIN FOR r IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND p.proname LIKE 'dg_native_visit_%' LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||r.signature||' FROM PUBLIC';END LOOP;END;$dg$;

-- Preserve all original memory authorization, permitting only erase to finish
-- its own same-focus human pause and without renewing activity.
CREATE OR REPLACE FUNCTION dg_native_guest_memory_apply(target text,token_hash_value text,csrf_hash_value text,focus_value bigint,action_value text,input jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s reception_sessions%ROWTYPE;p people%ROWTYPE;action_id text:=gen_random_uuid()::text;resource_value text;time_value text:=dg_utc_now();access_value text;person_value text;metadata jsonb;source_value jsonb;credential_value text;old_session text;
BEGIN
 s:=dg_native_guest_memory_session(target,token_hash_value,csrf_hash_value,focus_value,true);
 IF(SELECT count(*) FROM _dg_native_guest_memory_actions WHERE session_id=target AND created_at>dg_native_people_iso(clock_timestamp()-interval '60 seconds'))>=120 OR(SELECT count(*) FROM _dg_native_guest_memory_actions WHERE session_id=target)>=1000 THEN PERFORM dg_native_people_error('RATE_LIMITED');END IF;
 SELECT id INTO access_value FROM _dg_native_reception_access WHERE session_id=target AND token_hash=token_hash_value AND access_version=s.access_version;
 IF action_value='enroll' THEN
  PERFORM dg_native_people_fields(input,ARRAY['displayName','roles','consent','noticeVersion','retentionDays']);
  IF input->'consent' IS DISTINCT FROM 'true'::jsonb OR input->>'noticeVersion' IS DISTINCT FROM 'memory-v1' OR jsonb_typeof(input->'displayName') IS DISTINCT FROM 'string' OR char_length(btrim(input->>'displayName')) NOT BETWEEN 1 AND 60 OR jsonb_typeof(input->'retentionDays') IS DISTINCT FROM 'number' OR input->>'retentionDays' NOT IN('30','90','180') THEN PERFORM dg_native_people_error('VALIDATION_FAILED');END IF;
  IF EXISTS(SELECT 1 FROM people WHERE guest_session_id=target AND status='active') THEN PERFORM dg_native_people_error('STATE_CONFLICT');END IF;
  person_value:=gen_random_uuid()::text;
  INSERT INTO people(id,tenant_id,workspace_id,owner_user_id,guest_session_id,display_name,roles,identity_kind,status,version,personalization,do_not_disturb,quiet_start,quiet_end,cooldown_minutes,notice_version,consent_at,expires_at,environment,app_env,created_at,updated_at) VALUES(person_value,s.tenant_id,s.workspace_id,NULL,target,btrim(input->>'displayName'),dg_native_guest_memory_roles(input->'roles'),'self_reported','active',1,0,1,'22:00','08:00',60,'memory-v1',time_value,dg_native_people_iso(time_value::timestamptz+(input->>'retentionDays')::integer*interval '24 hours'),'mock',s.app_env,time_value,time_value);
  INSERT INTO memory_session_links VALUES(target,person_value,s.focus_version,time_value,dg_native_people_iso(time_value::timestamptz+interval '30 days'));resource_value:=person_value;
 ELSIF action_value='restore' THEN
  PERFORM dg_native_people_fields(input,ARRAY['credentialId','codeHash','consent','noticeVersion']);IF input->'consent' IS DISTINCT FROM 'true'::jsonb OR input->>'noticeVersion' IS DISTINCT FROM 'memory-v1' THEN PERFORM dg_native_people_error('VALIDATION_FAILED');END IF;
  IF EXISTS(SELECT 1 FROM people WHERE guest_session_id=target AND status='active') THEN PERFORM dg_native_people_error('STATE_CONFLICT');END IF;
  metadata:=dg_native_guest_memory_recovery_meta(target,token_hash_value,input->>'credentialId',input->>'codeHash');person_value:=metadata->>'personId';SELECT * INTO p FROM people WHERE id=person_value FOR UPDATE;old_session:=p.guest_session_id;
  PERFORM dg_native_people_invalidate(person_value);UPDATE people SET guest_session_id=target,version=version+1,updated_at=time_value WHERE id=person_value;
  INSERT INTO memory_session_links VALUES(target,person_value,s.focus_version,time_value,least(p.expires_at,dg_native_people_iso(time_value::timestamptz+interval '30 days')));
  UPDATE memory_recovery_credentials SET token_hash='',revoked_at=coalesce(revoked_at,time_value),used_at=CASE WHEN id=input->>'credentialId' THEN time_value ELSE used_at END WHERE person_id=person_value;resource_value:=person_value;
 ELSE
  p:=dg_native_guest_memory_owned(target);person_value:=p.id;source_value:=jsonb_build_object('sessionId',target,'focusVersion',s.focus_version);
  IF action_value='propose' THEN source_value:=source_value||jsonb_build_object('messageId',input->>'sourceMessageId');input:=input-'sourceMessageId';END IF;
  IF action_value IN('recovery','revoke') THEN
   IF input->>'version' IS DISTINCT FROM p.version::text OR input->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN PERFORM dg_native_people_error('VERSION_CONFLICT');END IF;
   PERFORM dg_native_people_fields(input,CASE WHEN action_value='recovery' THEN ARRAY['version','confirmed','credentialId','tokenHash'] ELSE ARRAY['version','confirmed'] END);
   UPDATE memory_recovery_credentials SET token_hash='',revoked_at=coalesce(revoked_at,time_value) WHERE person_id=p.id AND token_hash<>'';
   IF action_value='recovery' THEN
    IF input->>'tokenHash' !~ '^[a-f0-9]{64}$' OR input->>'credentialId' !~ '^[a-f0-9-]{36}$' OR(SELECT count(*) FROM memory_recovery_credentials WHERE person_id=p.id)>=100 THEN PERFORM dg_native_people_error('QUOTA_EXCEEDED');END IF;credential_value:=input->>'credentialId';
    INSERT INTO memory_recovery_credentials VALUES(credential_value,p.id,p.tenant_id,p.workspace_id,input->>'tokenHash',least(p.expires_at,dg_native_people_iso(time_value::timestamptz+interval '30 days')),NULL,NULL,time_value,'mock',p.app_env);
    INSERT INTO _dg_native_guest_memory_recovery_origins SELECT credential_value,target,s.focus_version,expires_at FROM memory_recovery_credentials WHERE id=credential_value;resource_value:=credential_value;
   ELSE resource_value:=p.id;END IF;PERFORM dg_native_people_touch(p.id,'memory.recovery_'||action_value);
  ELSE resource_value:=dg_native_people_mutate(p,action_value,input,source_value);END IF;
 END IF;
 PERFORM dg_native_guest_memory_session(target,token_hash_value,csrf_hash_value,focus_value,action_value<>'erase');UPDATE reception_sessions SET version=version+1,activity_at=CASE WHEN action_value='erase' THEN activity_at ELSE dg_utc_now() END WHERE id=target;
 INSERT INTO _dg_native_guest_memory_actions VALUES(action_id,person_value,target,s.focus_version,access_value,action_value,resource_value,pg_current_xact_id()::text,time_value);
 INSERT INTO outbox_events VALUES(gen_random_uuid()::text,s.tenant_id,s.workspace_id,target,'memory.guest_'||action_value,'mock','{}',time_value,NULL);RETURN action_id;
END;$dg$;
CREATE OR REPLACE FUNCTION dg_native_visit_public(target text,mask_value boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v visits%ROWTYPE;d _dg_native_visit_drafts%ROWTYPE;n visit_deliveries%ROWTYPE;o _dg_native_visit_origins%ROWTYPE;message_value text;guidance_value text;
BEGIN
 SELECT * INTO STRICT v FROM visits WHERE id=target;SELECT * INTO STRICT o FROM _dg_native_visit_origins WHERE visit_id=target;d:=dg_native_visit_draft(target);SELECT * INTO n FROM visit_deliveries WHERE visit_id=target;
 mask_value:=mask_value OR o.redacted_at IS NOT NULL OR o.expires_at<=dg_utc_now();
 message_value:=CASE v.status WHEN 'awaiting_confirmation' THEN CASE WHEN d.recipient_id IS NULL THEN '暂未匹配到可通知的受访人，请修改称呼或请求前台协助。' ELSE '请核对资料和渠道，确认仅用于本次来访并通知指定接待人。' END WHEN 'notifying' THEN CASE WHEN n.id IS NULL THEN '登记已确认，尚未提交通知。' ELSE '接待请求正在排队处理，尚未得到接待人同意。' END WHEN 'waiting_host' THEN CASE WHEN d.channel='local' THEN '已建立本地接待请求，正在等待受访人回复。' ELSE '模拟渠道已接受通知，正在等待受访人回复。' END WHEN 'accepted' THEN '接待人已明确同意，请按公开指引行动。' WHEN 'declined' THEN '接待人暂时无法接待，请联系前台工作人员。' WHEN 'escalated' THEN '本次接待需要工作人员协助，系统没有代替受访人表示同意。' WHEN 'completed' THEN '本次来访处理已结束。感谢您的配合。' WHEN 'cancelled' THEN '本次来访已取消。' ELSE '请核对本人自述的来访资料。' END;
 IF mask_value THEN message_value:='当前服务对象或登记资料已变化，旧来访信息不再公开，请联系前台处理。';END IF;
 guidance_value:=CASE WHEN NOT mask_value AND v.status='accepted' AND dg_native_visit_target_valid(v.id) THEN CASE v.guidance_code WHEN 'front_desk' THEN '请在前台等候，由工作人员与您会合。' WHEN 'waiting_area' THEN '请前往一层访客等候区，接待人会到现场迎接。' WHEN 'meeting_a' THEN '请先到前台领取访客指引，由工作人员陪同前往演示会议室 A。' END END;
 RETURN jsonb_build_object('id',v.id,'sessionId',v.session_id,'guestName',CASE WHEN mask_value THEN '' ELSE v.guest_name END,'company',CASE WHEN mask_value THEN '' ELSE v.company END,'hostName',CASE WHEN mask_value THEN '' ELSE v.host_name END,'purpose',CASE WHEN mask_value THEN '' ELSE v.purpose END,'appointmentRef',CASE WHEN mask_value THEN '' ELSE v.appointment_ref END,'status',v.status,'version',v.version,'focusVersion',v.focus_version,'identity','self_reported','dataErased',o.redacted_at IS NOT NULL,'environment','mock','notificationChannel',d.channel,'confirmedAt',v.confirmed_at,'completedAt',v.completed_at,'hostDeadline',v.host_deadline,'publicMessage',message_value,'guidance',guidance_value,'delivery',CASE WHEN n.id IS NULL OR mask_value THEN NULL ELSE jsonb_build_object('id',n.id,'status',n.status,'version',n.version,'environment','mock','remoteId',n.remote_id,'errorCode',n.error_code,'channel',n.native_channel,'availability',n.native_availability) END,'createdAt',v.created_at,'updatedAt',v.updated_at);
END;$dg$;
CREATE OR REPLACE FUNCTION dg_native_visit_guest_view(target text,token_hash_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s reception_sessions%ROWTYPE;v visits%ROWTYPE;d _dg_native_visit_drafts%ROWTYPE;descriptor jsonb;
BEGIN
 s:=dg_native_visit_session(target,token_hash_value,NULL,NULL,false);SELECT * INTO v FROM visits WHERE session_id=target;
 IF v.id IS NULL THEN RETURN jsonb_build_object('visit',NULL,'descriptor',NULL);END IF;d:=dg_native_visit_draft(v.id);
 IF s.status='active' AND v.focus_version=s.focus_version AND v.status='awaiting_confirmation' AND d.confirmation_expires_at>dg_utc_now() AND dg_native_visit_target_valid(v.id) THEN descriptor:=jsonb_build_object('visitId',v.id,'version',d.version,'sessionId',s.id,'focusVersion',s.focus_version,'contentHash',d.payload_hash,'hostId',d.host_id,'hostVersion',d.host_version,'recipientId',d.recipient_id,'channel',d.channel,'noticeVersion','visit-v1','expiresAt',d.confirmation_expires_at);END IF;
 RETURN jsonb_build_object('visit',dg_native_visit_public(v.id,v.focus_version<>s.focus_version),'descriptor',descriptor,'privacyReceipt',CASE WHEN v.focus_version=s.focus_version THEN(SELECT jsonb_build_object('requestId',r.id,'scope','visit_registration','status','completed','completedAt',r.created_at,'external','not_applicable') FROM _dg_native_visit_erasure_receipts r WHERE r.visit_id=v.id) END);
END;$dg$;
CREATE OR REPLACE FUNCTION dg_native_visit_sweep() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE o _dg_native_visit_origins%ROWTYPE;v visits%ROWTYPE;count_value integer:=0;
BEGIN
 PERFORM dg_native_reception_runtime(true);
 FOR o IN SELECT * FROM _dg_native_visit_origins WHERE redacted_at IS NULL ORDER BY tenant_id,workspace_id,terminal_id,visit_id LOOP
  IF NOT pg_try_advisory_xact_lock(hashtextextended('native-reception-workspace:'||o.tenant_id||':'||o.workspace_id,0)) THEN CONTINUE;END IF;
  PERFORM id FROM reception_terminals WHERE id=o.terminal_id FOR UPDATE SKIP LOCKED;IF NOT FOUND THEN CONTINUE;END IF;PERFORM id FROM reception_sessions WHERE id=o.session_id FOR UPDATE SKIP LOCKED;IF NOT FOUND THEN CONTINUE;END IF;SELECT * INTO v FROM visits WHERE id=o.visit_id FOR UPDATE SKIP LOCKED;IF NOT FOUND THEN CONTINUE;END IF;
  IF v.status IN('notifying','waiting_host') AND(v.host_deadline<=dg_utc_now() OR NOT dg_native_visit_source_valid(v.id)) THEN PERFORM dg_native_visit_escalate(v.id,CASE WHEN v.host_deadline<=dg_utc_now() THEN 'host_timeout' ELSE 'source_unavailable' END);count_value:=count_value+1;END IF;
  IF o.expires_at<=dg_utc_now() THEN
   PERFORM dg_native_visit_redact(v.id,'retention_expired');count_value:=count_value+1;
  END IF;
 END LOOP;RETURN count_value;
END;$dg$;
