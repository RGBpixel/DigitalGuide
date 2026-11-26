-- Increment100 phase2 / R-037,R-038,R-039,R-058. Native visit records.
-- Delivery execution, callback and privacy integration follow separately.
CREATE TABLE _dg_native_visit_origins(
 visit_id text PRIMARY KEY REFERENCES visits(id),terminal_id text NOT NULL REFERENCES reception_terminals(id),
 tenant_id text NOT NULL,workspace_id text NOT NULL,session_id text NOT NULL,focus_version bigint NOT NULL,
 expires_at text NOT NULL,context_invalidated_at text,redacted_at text,created_at text NOT NULL
);
CREATE TABLE _dg_native_visit_drafts(
 visit_id text NOT NULL REFERENCES visits(id),version bigint NOT NULL CHECK(version>0),
 host_id text REFERENCES _dg_native_visit_hosts(id),host_version bigint,recipient_id text,
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),channel text NOT NULL CHECK(channel IN('local','mock')),
 confirmation_expires_at text NOT NULL,transaction_id text NOT NULL,created_at text NOT NULL,
 PRIMARY KEY(visit_id,version),CHECK((host_id IS NULL AND host_version IS NULL AND recipient_id IS NULL) OR (host_id IS NOT NULL AND host_version>0 AND recipient_id IS NOT NULL))
);
CREATE TABLE _dg_native_visit_confirmations(
 visit_id text NOT NULL,version bigint NOT NULL,token_hash text NOT NULL CHECK(token_hash ~ '^[a-f0-9]{64}$'),created_at text NOT NULL,
 PRIMARY KEY(visit_id,version),FOREIGN KEY(visit_id,version) REFERENCES _dg_native_visit_drafts(visit_id,version)
);
CREATE TRIGGER native_visit_drafts_immutable BEFORE UPDATE OR DELETE ON _dg_native_visit_drafts FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_visit_confirmations_immutable BEFORE UPDATE OR DELETE ON _dg_native_visit_confirmations FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
ALTER TABLE visit_deliveries ADD COLUMN native_channel text NOT NULL DEFAULT 'mock' CHECK(native_channel IN('local','mock'));
ALTER TABLE visit_deliveries ADD COLUMN native_availability text NOT NULL DEFAULT 'active' CHECK(native_availability IN('active','withdrawn'));
ALTER TABLE visits ADD CONSTRAINT native_visit_shape CHECK(version>0 AND focus_version>=0 AND char_length(guest_name)<=40 AND char_length(company)<=80 AND char_length(host_name)<=40 AND char_length(purpose)<=200 AND char_length(appointment_ref)<=80 AND char_length(coalesce(host_private_note,''))<=300);
ALTER TABLE visit_deliveries ADD CONSTRAINT native_visit_delivery_shape CHECK(environment='mock' AND app_env IN('development','sandbox') AND version>0 AND attempts BETWEEN 0 AND 3 AND scenario IN('normal','failed','unknown'));

CREATE FUNCTION dg_native_visit_error(code_value text) RETURNS void LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='DGVISIT:'||code_value;END;$dg$;
CREATE FUNCTION dg_native_visit_draft(target text) RETURNS _dg_native_visit_drafts LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT d FROM _dg_native_visit_drafts d WHERE d.visit_id=target ORDER BY version DESC LIMIT 1
$dg$;
CREATE FUNCTION dg_native_visit_target_valid(target text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT EXISTS(SELECT 1 FROM _dg_native_visit_drafts d JOIN _dg_native_visit_origins o ON o.visit_id=d.visit_id
 WHERE d.visit_id=target AND d.version=(SELECT max(version) FROM _dg_native_visit_drafts WHERE visit_id=target)
 AND o.redacted_at IS NULL AND o.expires_at>dg_utc_now() AND dg_native_visit_host_reference_valid(d.host_id,d.host_version,d.recipient_id))
$dg$;
CREATE FUNCTION dg_native_visit_source_valid(target text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT EXISTS(SELECT 1 FROM _dg_native_visit_origins o JOIN reception_sessions s ON s.id=o.session_id
 WHERE o.visit_id=target AND o.context_invalidated_at IS NULL AND o.redacted_at IS NULL AND o.expires_at>dg_utc_now()
 AND s.status='active' AND s.focus_version=o.focus_version AND s.expires_at>dg_utc_now() AND s.activity_at>dg_native_people_iso(clock_timestamp()-interval '120 seconds')
 AND dg_native_reception_source_valid(s.id) AND dg_native_visit_target_valid(target))
$dg$;

-- Prelock the frozen/proposed recipient before Reception acquires workspace and
-- terminal locks. A publication change while waiting must not acquire a new
-- membership lock after the parent locks.
CREATE FUNCTION dg_native_visit_prelock(target text,token_hash_value text,alias_value text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;d _dg_native_visit_drafts%ROWTYPE;h _dg_native_visit_hosts%ROWTYPE;
BEGIN
 meta:=dg_native_reception_meta(target,token_hash_value);
 SELECT q.* INTO d FROM visits v JOIN LATERAL(SELECT * FROM _dg_native_visit_drafts WHERE visit_id=v.id ORDER BY version DESC LIMIT 1) q ON true WHERE v.session_id=target;
 IF alias_value IS NOT NULL THEN SELECT * INTO h FROM _dg_native_visit_hosts WHERE tenant_id=meta->>'tenantId' AND workspace_id=meta->>'workspaceId' AND enabled AND alias_key=lower(regexp_replace(normalize(btrim(alias_value),NFC),'[[:space:]]+',' ','g'));END IF;
 PERFORM user_id FROM memberships WHERE user_id=ANY(ARRAY[d.recipient_id,h.recipient_id]) ORDER BY user_id FOR SHARE;
 RETURN jsonb_build_object('hostId',h.id,'hostVersion',h.version,'recipientId',h.recipient_id,'priorRecipientId',d.recipient_id);
END;$dg$;
CREATE FUNCTION dg_native_visit_session(target text,token_hash_value text,csrf_hash_value text,focus_value bigint,write_value boolean DEFAULT false) RETURNS reception_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s reception_sessions%ROWTYPE;
BEGIN
 PERFORM dg_native_reception_authorize(target,token_hash_value,csrf_hash_value,write_value);SELECT * INTO STRICT s FROM reception_sessions WHERE id=target;
 IF focus_value IS NOT NULL AND focus_value<>s.focus_version THEN PERFORM dg_native_visit_error('VERSION_CONFLICT');END IF;
 IF write_value AND s.status<>'active' THEN PERFORM dg_native_visit_error('STATE_CONFLICT');END IF;RETURN s;
END;$dg$;
CREATE FUNCTION dg_native_visit_withdraw(target text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN UPDATE visit_deliveries SET native_availability='withdrawn',status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END,version=version+1,updated_at=dg_utc_now() WHERE visit_id=target AND native_availability='active';END;$dg$;
CREATE FUNCTION dg_native_visit_state(target text,status_value text,reason_value text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v visits%ROWTYPE;
BEGIN
 SELECT * INTO STRICT v FROM visits WHERE id=target;
 IF v.status=status_value AND v.escalated_reason IS NOT DISTINCT FROM reason_value THEN RETURN;END IF;
 UPDATE visits SET status=status_value,escalated_reason=reason_value,version=version+1,updated_at=dg_utc_now(),completed_at=CASE WHEN status_value IN('completed','cancelled') THEN coalesce(completed_at,dg_utc_now()) ELSE completed_at END WHERE id=target;
 INSERT INTO outbox_events VALUES(gen_random_uuid()::text,v.tenant_id,v.workspace_id,v.id,'visit.'||status_value,'mock','{}',dg_utc_now(),NULL);
END;$dg$;
CREATE FUNCTION dg_native_visit_escalate(target text,reason_value text,preserve_focus boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v visits%ROWTYPE;
BEGIN
 SELECT * INTO STRICT v FROM visits WHERE id=target;
 PERFORM dg_native_visit_withdraw(target);
 UPDATE _dg_native_visit_origins SET context_invalidated_at=coalesce(context_invalidated_at,dg_utc_now()) WHERE visit_id=target;
 IF v.status IN('completed','cancelled','declined','escalated') OR(v.status='accepted' AND reason_value<>'privacy_erased') THEN RETURN;END IF;
 PERFORM dg_native_visit_state(target,'escalated',reason_value);
 UPDATE reception_messages SET text='',knowledge_citations='[]',status='cancelled' WHERE session_id=v.session_id AND role='assistant' AND status IN('ready','playing');
 UPDATE reception_sessions SET status='human',version=version+1,reply_epoch=reply_epoch+1,focus_version=focus_version+CASE WHEN preserve_focus THEN 0 ELSE 1 END WHERE id=v.session_id AND status='active';
END;$dg$;
CREATE FUNCTION dg_native_visit_context_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v visits%ROWTYPE;
BEGIN
 IF NEW.status=OLD.status AND NEW.focus_version=OLD.focus_version THEN RETURN NULL;END IF;
 SELECT * INTO v FROM visits WHERE session_id=NEW.id;IF v.id IS NULL THEN RETURN NULL;END IF;
 IF NEW.status<>'active' OR NEW.focus_version<>v.focus_version THEN
  UPDATE _dg_native_visit_origins SET context_invalidated_at=coalesce(context_invalidated_at,dg_utc_now()) WHERE visit_id=v.id;
  PERFORM dg_native_visit_withdraw(v.id);
  IF v.status IN('draft','awaiting_confirmation','notifying','waiting_host') THEN PERFORM dg_native_visit_state(v.id,'escalated','session_context_changed');END IF;
 END IF;RETURN NULL;
END;$dg$;
CREATE TRIGGER native_visit_context_changed AFTER UPDATE OF status,focus_version ON reception_sessions FOR EACH ROW EXECUTE FUNCTION dg_native_visit_context_changed();
CREATE FUNCTION dg_native_visit_host_revoked() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v visits%ROWTYPE;
BEGIN
 FOR v IN SELECT q.* FROM visits q JOIN _dg_native_visit_drafts d ON d.visit_id=q.id WHERE d.host_id=NEW.host_id AND d.host_version=NEW.version AND d.version=(SELECT max(version) FROM _dg_native_visit_drafts WHERE visit_id=q.id) ORDER BY q.session_id LOOP
  PERFORM id FROM reception_terminals WHERE id=(SELECT terminal_id FROM _dg_native_visit_origins WHERE visit_id=v.id) FOR UPDATE;PERFORM id FROM reception_sessions WHERE id=v.session_id FOR UPDATE;PERFORM id FROM visits WHERE id=v.id FOR UPDATE;PERFORM dg_native_visit_escalate(v.id,'host_publication_withdrawn');
 END LOOP;RETURN NULL;
END;$dg$;
CREATE TRIGGER native_visit_host_revoked AFTER INSERT ON _dg_native_visit_host_revocations FOR EACH ROW EXECUTE FUNCTION dg_native_visit_host_revoked();

CREATE FUNCTION dg_native_visit_public(target text,mask_value boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v visits%ROWTYPE;d _dg_native_visit_drafts%ROWTYPE;n visit_deliveries%ROWTYPE;o _dg_native_visit_origins%ROWTYPE;message_value text;guidance_value text;
BEGIN
 SELECT * INTO STRICT v FROM visits WHERE id=target;SELECT * INTO STRICT o FROM _dg_native_visit_origins WHERE visit_id=target;d:=dg_native_visit_draft(target);SELECT * INTO n FROM visit_deliveries WHERE visit_id=target;
 mask_value:=mask_value OR o.redacted_at IS NOT NULL OR o.expires_at<=dg_utc_now();
 message_value:=CASE v.status WHEN 'awaiting_confirmation' THEN CASE WHEN d.recipient_id IS NULL THEN '暂未匹配到可通知的受访人，请修改称呼或请求前台协助。' ELSE '请核对资料和渠道，确认仅用于本次来访并通知指定接待人。' END WHEN 'notifying' THEN CASE WHEN n.id IS NULL THEN '登记已确认，尚未提交通知。' ELSE '接待请求正在排队处理，尚未得到接待人同意。' END WHEN 'waiting_host' THEN CASE WHEN d.channel='local' THEN '已建立本地接待请求，正在等待受访人回复。' ELSE '模拟渠道已接受通知，正在等待受访人回复。' END WHEN 'accepted' THEN '接待人已明确同意，请按公开指引行动。' WHEN 'declined' THEN '接待人暂时无法接待，请联系前台工作人员。' WHEN 'escalated' THEN '本次接待需要工作人员协助，系统没有代替受访人表示同意。' WHEN 'completed' THEN '本次来访处理已结束。感谢您的配合。' WHEN 'cancelled' THEN '本次来访已取消。' ELSE '请核对本人自述的来访资料。' END;
 IF mask_value THEN message_value:='当前服务对象或登记资料已变化，旧来访信息不再公开，请联系前台处理。';END IF;
 guidance_value:=CASE WHEN NOT mask_value AND v.status='accepted' AND dg_native_visit_target_valid(v.id) THEN CASE v.guidance_code WHEN 'front_desk' THEN '请在前台等候，由工作人员与您会合。' WHEN 'waiting_area' THEN '请前往一层访客等候区，接待人会到现场迎接。' WHEN 'meeting_a' THEN '请先到前台领取访客指引，由工作人员陪同前往演示会议室 A。' END END;
 RETURN jsonb_build_object('id',v.id,'sessionId',v.session_id,'guestName',CASE WHEN mask_value THEN '' ELSE v.guest_name END,'company',CASE WHEN mask_value THEN '' ELSE v.company END,'hostName',CASE WHEN mask_value THEN '' ELSE v.host_name END,'purpose',CASE WHEN mask_value THEN '' ELSE v.purpose END,'appointmentRef',CASE WHEN mask_value THEN '' ELSE v.appointment_ref END,'status',v.status,'version',v.version,'focusVersion',v.focus_version,'identity','self_reported','environment','mock','notificationChannel',d.channel,'confirmedAt',v.confirmed_at,'completedAt',v.completed_at,'hostDeadline',v.host_deadline,'publicMessage',message_value,'guidance',guidance_value,'delivery',CASE WHEN n.id IS NULL OR mask_value THEN NULL ELSE jsonb_build_object('id',n.id,'status',n.status,'version',n.version,'environment','mock','remoteId',n.remote_id,'errorCode',n.error_code,'channel',n.native_channel,'availability',n.native_availability) END,'createdAt',v.created_at,'updatedAt',v.updated_at);
END;$dg$;
CREATE FUNCTION dg_native_visit_guest_view(target text,token_hash_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s reception_sessions%ROWTYPE;v visits%ROWTYPE;d _dg_native_visit_drafts%ROWTYPE;descriptor jsonb;
BEGIN
 s:=dg_native_visit_session(target,token_hash_value,NULL,NULL,false);SELECT * INTO v FROM visits WHERE session_id=target;
 IF v.id IS NULL THEN RETURN jsonb_build_object('visit',NULL,'descriptor',NULL);END IF;d:=dg_native_visit_draft(v.id);
 IF s.status='active' AND v.focus_version=s.focus_version AND v.status='awaiting_confirmation' AND d.confirmation_expires_at>dg_utc_now() AND dg_native_visit_target_valid(v.id) THEN descriptor:=jsonb_build_object('visitId',v.id,'version',d.version,'sessionId',s.id,'focusVersion',s.focus_version,'contentHash',d.payload_hash,'hostId',d.host_id,'hostVersion',d.host_version,'recipientId',d.recipient_id,'channel',d.channel,'noticeVersion','visit-v1','expiresAt',d.confirmation_expires_at);END IF;
 RETURN jsonb_build_object('visit',dg_native_visit_public(v.id,v.focus_version<>s.focus_version),'descriptor',descriptor);
END;$dg$;
CREATE FUNCTION dg_native_visit_confirmation_bind(target text,token_hash_value text,visit_value text,token_digest text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s reception_sessions%ROWTYPE;d _dg_native_visit_drafts%ROWTYPE;
BEGIN
 s:=dg_native_visit_session(target,token_hash_value,NULL,NULL,false);d:=dg_native_visit_draft(visit_value);
 IF token_digest !~ '^[a-f0-9]{64}$' OR d.transaction_id<>pg_current_xact_id()::text OR NOT EXISTS(SELECT 1 FROM visits WHERE id=visit_value AND session_id=target AND focus_version=s.focus_version AND status='awaiting_confirmation' AND version=d.version) THEN PERFORM dg_native_visit_error('STATE_CONFLICT');END IF;
 INSERT INTO _dg_native_visit_confirmations VALUES(visit_value,d.version,token_digest,dg_utc_now());
END;$dg$;

CREATE FUNCTION dg_native_visit_guest_apply(target text,token_hash_value text,csrf_hash_value text,action_value text,input jsonb,hint jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s reception_sessions%ROWTYPE;v visits%ROWTYPE;d _dg_native_visit_drafts%ROWTYPE;h _dg_native_visit_hosts%ROWTYPE;now_value text:=dg_utc_now();id_value text;channel_value text:=coalesce(input->>'channel','mock');expires_value text;hash_value text;quota bigint;
BEGIN
 IF input IS NULL OR jsonb_typeof(input)<>'object' OR jsonb_typeof(input->'focusVersion') IS DISTINCT FROM 'number' OR input->>'focusVersion' !~ '^[0-9]+$' THEN PERFORM dg_native_visit_error('VALIDATION_FAILED');END IF;
 s:=dg_native_visit_session(target,token_hash_value,csrf_hash_value,(input->>'focusVersion')::bigint,true);SELECT * INTO v FROM visits WHERE session_id=target FOR UPDATE;
 IF action_value='draft' THEN
  PERFORM dg_native_reception_fields(input,ARRAY['guestName','company','hostName','purpose','appointmentRef','version','focusVersion','channel']);
  IF channel_value NOT IN('local','mock') OR char_length(coalesce(input->>'guestName','')) NOT BETWEEN 1 AND 40 OR char_length(coalesce(input->>'hostName','')) NOT BETWEEN 1 AND 40 OR char_length(coalesce(input->>'purpose','')) NOT BETWEEN 1 AND 200 OR char_length(coalesce(input->>'company',''))>80 OR char_length(coalesce(input->>'appointmentRef',''))>80 THEN PERFORM dg_native_visit_error('VALIDATION_FAILED');END IF;
  IF v.id IS NOT NULL AND(v.status NOT IN('draft','awaiting_confirmation') OR v.focus_version<>s.focus_version) THEN PERFORM dg_native_visit_error('STATE_CONFLICT');END IF;
  IF(v.id IS NULL AND input->'version'<>'null'::jsonb) OR(v.id IS NOT NULL AND input->>'version' IS DISTINCT FROM v.version::text) THEN PERFORM dg_native_visit_error('VERSION_CONFLICT');END IF;
  IF v.id IS NOT NULL AND(SELECT count(*) FROM _dg_native_visit_drafts WHERE visit_id=v.id)>=20 THEN PERFORM dg_native_visit_error('QUOTA_EXCEEDED');END IF;
  IF v.id IS NULL AND(SELECT count(*) FROM visits WHERE tenant_id=s.tenant_id AND workspace_id=s.workspace_id AND created_at>=left(now_value,10))>=200 THEN PERFORM dg_native_visit_error('QUOTA_EXCEEDED');END IF;
  SELECT * INTO h FROM _dg_native_visit_hosts WHERE tenant_id=s.tenant_id AND workspace_id=s.workspace_id AND enabled AND alias_key=lower(regexp_replace(normalize(btrim(input->>'hostName'),NFC),'[[:space:]]+',' ','g'));
  IF h.id IS DISTINCT FROM hint->>'hostId' OR h.recipient_id IS DISTINCT FROM hint->>'recipientId' OR h.version::text IS DISTINCT FROM hint->>'hostVersion' THEN PERFORM dg_native_visit_error('VERSION_CONFLICT');END IF;
  IF h.id IS NOT NULL AND NOT dg_native_visit_host_reference_valid(h.id,h.version,h.recipient_id) THEN PERFORM dg_native_visit_error('RECIPIENT_UNAVAILABLE');END IF;
  IF v.id IS NULL THEN
   id_value:=gen_random_uuid()::text;INSERT INTO visits(id,tenant_id,workspace_id,venue_id,session_id,host_name,guest_name,company,purpose,appointment_ref,status,focus_version,created_at,updated_at) SELECT id_value,s.tenant_id,s.workspace_id,t.venue_id,s.id,input->>'hostName',input->>'guestName',coalesce(input->>'company',''),input->>'purpose',coalesce(input->>'appointmentRef',''),'awaiting_confirmation',s.focus_version,now_value,now_value FROM reception_terminals t WHERE t.id=s.terminal_id;
   INSERT INTO _dg_native_visit_origins VALUES(id_value,s.terminal_id,s.tenant_id,s.workspace_id,s.id,s.focus_version,dg_native_people_iso(now_value::timestamptz+interval '30 days'),NULL,NULL,now_value);
  ELSE id_value:=v.id;UPDATE visits SET guest_name=input->>'guestName',company=coalesce(input->>'company',''),host_name=input->>'hostName',purpose=input->>'purpose',appointment_ref=coalesce(input->>'appointmentRef',''),version=version+1,confirmed_hash=NULL,confirmed_at=NULL,notice_version=NULL,updated_at=now_value WHERE id=v.id;END IF;
  SELECT * INTO STRICT v FROM visits WHERE id=id_value;expires_value:=least(s.expires_at,dg_native_people_iso(now_value::timestamptz+interval '120 seconds'));
  hash_value:=dg_native_office_hash(jsonb_build_object('guestName',v.guest_name,'company',v.company,'hostName',v.host_name,'purpose',v.purpose,'appointmentRef',v.appointment_ref,'sessionId',s.id,'focusVersion',s.focus_version,'hostId',h.id,'hostVersion',h.version,'recipientId',h.recipient_id,'channel',channel_value));
  INSERT INTO _dg_native_visit_drafts VALUES(v.id,v.version,h.id,h.version,h.recipient_id,hash_value,channel_value,expires_value,pg_current_xact_id()::text,now_value);
 ELSE
  IF v.id IS NULL THEN PERFORM dg_native_visit_error('NOT_FOUND');END IF;id_value:=v.id;d:=dg_native_visit_draft(v.id);
  IF input->>'version' IS DISTINCT FROM v.version::text OR v.focus_version<>s.focus_version THEN PERFORM dg_native_visit_error('VERSION_CONFLICT');END IF;
  IF action_value='confirm' THEN
   PERFORM dg_native_reception_fields(input,ARRAY['version','focusVersion','confirmationToken','expiresAt','noticeVersion','confirmed','channel']);
   IF v.status<>'awaiting_confirmation' OR input->>'confirmed'<>'true' OR input->>'noticeVersion'<>'visit-v1' OR input->>'expiresAt' IS DISTINCT FROM d.confirmation_expires_at OR d.confirmation_expires_at<=dg_utc_now() OR channel_value<>d.channel OR NOT dg_native_visit_target_valid(v.id) OR NOT EXISTS(SELECT 1 FROM _dg_native_visit_confirmations WHERE visit_id=v.id AND version=d.version AND token_hash=encode(sha256(convert_to(input->>'confirmationToken','UTF8')),'hex')) THEN PERFORM dg_native_visit_error('CONFIRMATION_INVALID');END IF;
   UPDATE visits SET confirmed_hash=d.payload_hash,confirmed_at=now_value,notice_version='visit-v1' WHERE id=v.id;INSERT INTO visit_confirmation_targets VALUES(v.id,d.recipient_id);PERFORM dg_native_visit_state(v.id,'notifying');
  ELSIF action_value='notify' THEN
   PERFORM dg_native_reception_fields(input,ARRAY['version','focusVersion','channel']);
   IF v.status<>'notifying' OR v.confirmed_hash IS DISTINCT FROM d.payload_hash OR channel_value<>d.channel OR NOT dg_native_visit_source_valid(v.id) THEN PERFORM dg_native_visit_error('STATE_CONFLICT');END IF;
   IF EXISTS(SELECT 1 FROM visit_deliveries WHERE visit_id=v.id) THEN RETURN v.id;END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended('native-visit-tenant-quota:'||s.tenant_id,0));SELECT least(100,daily_limit) INTO quota FROM tenants WHERE id=s.tenant_id;
   IF(SELECT count(*) FROM visit_deliveries WHERE tenant_id=s.tenant_id AND created_at>=left(now_value,10))>=coalesce(quota,0) THEN PERFORM dg_native_visit_error('QUOTA_EXCEEDED');END IF;
   INSERT INTO visit_deliveries(id,visit_id,tenant_id,workspace_id,recipient_user_id,environment,app_env,status,scenario,created_at,updated_at,native_channel) VALUES(gen_random_uuid()::text,v.id,s.tenant_id,s.workspace_id,d.recipient_id,'mock',s.app_env,'queued',v.mock_scenario,now_value,now_value,d.channel);
   UPDATE visits SET host_deadline=dg_native_people_iso(now_value::timestamptz+interval '60 seconds'),version=version+1,updated_at=now_value WHERE id=v.id;
  ELSIF action_value='control' THEN
   PERFORM dg_native_reception_fields(input,ARRAY['version','focusVersion','action']);
   IF(input->>'action'='complete' AND v.status<>'accepted') OR input->>'action' NOT IN('cancel','complete') OR v.status IN('cancelled','completed') THEN PERFORM dg_native_visit_error('STATE_CONFLICT');END IF;
   PERFORM dg_native_visit_withdraw(v.id);PERFORM dg_native_visit_state(v.id,CASE WHEN input->>'action'='complete' THEN 'completed' ELSE 'cancelled' END);
  ELSE PERFORM dg_native_visit_error('VALIDATION_FAILED');END IF;
 END IF;
 UPDATE reception_sessions SET activity_at=dg_utc_now(),version=version+1 WHERE id=s.id;
 INSERT INTO outbox_events VALUES(gen_random_uuid()::text,s.tenant_id,s.workspace_id,id_value,'visit.'||action_value,'mock','{}',dg_utc_now(),NULL);RETURN id_value;
END;$dg$;

CREATE FUNCTION dg_native_visit_staff_scope(target text,own_only boolean DEFAULT false,write_value boolean DEFAULT false) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE m memberships%ROWTYPE;v visits%ROWTYPE;d _dg_native_visit_drafts%ROWTYPE;terminal_value text;
BEGIN
 PERFORM dg_native_reception_runtime();SELECT * INTO m FROM dg_native_locked_membership(current_setting('digitalguide.actor_id',true));
 IF m.user_id IS NULL OR(own_only AND m.role NOT IN('admin','editor')) OR(NOT own_only AND m.role<>'admin') THEN PERFORM dg_native_visit_error('FORBIDDEN');END IF;
 SELECT * INTO v FROM visits WHERE id=target AND tenant_id=m.tenant_id;IF v.id IS NULL OR NOT(m.workspace_ids::jsonb ? v.workspace_id) THEN PERFORM dg_native_visit_error('NOT_FOUND');END IF;d:=dg_native_visit_draft(v.id);
 IF own_only AND(d.recipient_id IS DISTINCT FROM m.user_id OR NOT dg_native_visit_target_valid(v.id)) THEN PERFORM dg_native_visit_error('NOT_FOUND');END IF;
 IF write_value THEN PERFORM user_id FROM memberships WHERE user_id=d.recipient_id FOR SHARE;END IF;
 IF write_value THEN PERFORM pg_advisory_xact_lock(hashtextextended('["native-asset-workspace",'||to_jsonb(v.tenant_id)::text||','||to_jsonb(v.workspace_id)::text||']',0));ELSE PERFORM pg_advisory_xact_lock_shared(hashtextextended('["native-asset-workspace",'||to_jsonb(v.tenant_id)::text||','||to_jsonb(v.workspace_id)::text||']',0));END IF;
 PERFORM dg_native_reception_workspace(v.tenant_id,v.workspace_id,write_value);
 IF write_value THEN
  SELECT terminal_id INTO terminal_value FROM _dg_native_visit_origins WHERE visit_id=target;PERFORM id FROM reception_terminals WHERE id=terminal_value FOR UPDATE;PERFORM id FROM reception_sessions WHERE id=v.session_id FOR UPDATE;PERFORM id FROM visits WHERE id=target FOR UPDATE;
  IF (SELECT recipient_id FROM _dg_native_visit_draft(target)) IS DISTINCT FROM d.recipient_id THEN PERFORM dg_native_visit_error('VERSION_CONFLICT');END IF;
 END IF;
 IF own_only AND NOT dg_native_visit_target_valid(v.id) THEN PERFORM dg_native_visit_error('NOT_FOUND');END IF;RETURN v.workspace_id;
END;$dg$;
CREATE FUNCTION dg_native_visit_staff_view(target text,own_only boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v visits%ROWTYPE;d _dg_native_visit_drafts%ROWTYPE;
BEGIN
 PERFORM dg_native_visit_staff_scope(target,own_only,false);SELECT * INTO STRICT v FROM visits WHERE id=target;d:=dg_native_visit_draft(target);
 RETURN dg_native_visit_public(target)||jsonb_build_object('workspaceId',v.workspace_id,'venueId',v.venue_id,'recipientIsMe',d.recipient_id=current_setting('digitalguide.actor_id',true),'privateNote',v.host_private_note,'escalatedReason',v.escalated_reason,'canRespond',d.recipient_id=current_setting('digitalguide.actor_id',true) AND v.status='waiting_host' AND dg_native_visit_source_valid(v.id));
END;$dg$;
CREATE FUNCTION dg_native_visit_staff_list(workspaces_value text[],cursor_value text,limit_value integer,own_only boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE m memberships%ROWTYPE;v record;result jsonb:='[]';w text;
BEGIN
 PERFORM dg_native_reception_runtime();SELECT * INTO m FROM dg_native_locked_membership(current_setting('digitalguide.actor_id',true));
 IF m.user_id IS NULL OR(own_only AND m.role NOT IN('admin','editor')) OR(NOT own_only AND m.role<>'admin') THEN PERFORM dg_native_visit_error('FORBIDDEN');END IF;
 IF limit_value IS NULL OR limit_value NOT BETWEEN 1 AND 101 OR cardinality(workspaces_value)>1000 THEN PERFORM dg_native_visit_error('VALIDATION_FAILED');END IF;
 FOREACH w IN ARRAY workspaces_value LOOP IF NOT(m.workspace_ids::jsonb ? w) THEN PERFORM dg_native_visit_error('NOT_FOUND');END IF;END LOOP;
 FOR v IN SELECT q.id FROM visits q JOIN _dg_native_visit_origins o ON o.visit_id=q.id JOIN LATERAL(SELECT * FROM _dg_native_visit_drafts WHERE visit_id=q.id ORDER BY version DESC LIMIT 1) d ON true WHERE q.tenant_id=m.tenant_id AND q.workspace_id=ANY(workspaces_value) AND q.id>cursor_value AND(NOT own_only OR d.recipient_id=m.user_id AND dg_native_visit_target_valid(q.id)) ORDER BY q.id LIMIT limit_value LOOP result:=result||jsonb_build_array(dg_native_visit_staff_view(v.id,own_only));END LOOP;RETURN result;
END;$dg$;
CREATE FUNCTION dg_native_visit_staff_apply(target text,action_value text,input jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v visits%ROWTYPE;d _dg_native_visit_drafts%ROWTYPE;n visit_deliveries%ROWTYPE;
BEGIN
 PERFORM dg_native_visit_staff_scope(target,action_value='respond',true);SELECT * INTO STRICT v FROM visits WHERE id=target;d:=dg_native_visit_draft(target);
 IF action_value='scenario' THEN
  PERFORM dg_native_reception_fields(input,ARRAY['version','scenario']);SELECT * INTO n FROM visit_deliveries WHERE visit_id=target FOR UPDATE;
  IF input->>'version' IS DISTINCT FROM n.version::text OR n.status<>'queued' OR n.attempts<>0 OR input->>'scenario' NOT IN('normal','failed','unknown') THEN PERFORM dg_native_visit_error('STATE_CONFLICT');END IF;UPDATE visit_deliveries SET scenario=input->>'scenario',version=version+1,updated_at=dg_utc_now() WHERE id=n.id;RETURN target;
 END IF;
 IF input->>'version' IS DISTINCT FROM v.version::text THEN PERFORM dg_native_visit_error('VERSION_CONFLICT');END IF;
 IF action_value='respond' THEN
  PERFORM dg_native_reception_fields(input,ARRAY['version','decision','guidanceCode','privateNote']);
  IF v.status<>'waiting_host' OR NOT dg_native_visit_source_valid(target) OR v.host_deadline<=dg_utc_now() OR input->>'decision' NOT IN('accepted','declined') OR char_length(coalesce(input->>'privateNote',''))>300 OR input->>'decision'='accepted' AND coalesce(input->>'guidanceCode','') NOT IN('front_desk','waiting_area','meeting_a') THEN PERFORM dg_native_visit_error('STATE_CONFLICT');END IF;
  UPDATE visits SET responded_by=current_setting('digitalguide.actor_id',true),host_private_note=coalesce(input->>'privateNote',''),guidance_code=CASE WHEN input->>'decision'='accepted' THEN input->>'guidanceCode' ELSE NULL END WHERE id=target;PERFORM dg_native_visit_state(target,input->>'decision');
 ELSE
  PERFORM dg_native_reception_fields(input,ARRAY['version','action']);
  IF v.status IN('cancelled','completed') OR input->>'action' NOT IN('escalate','complete','cancel') OR(input->>'action'='complete' AND v.status NOT IN('accepted','declined','escalated')) THEN PERFORM dg_native_visit_error('STATE_CONFLICT');END IF;
  IF input->>'action'='escalate' THEN PERFORM dg_native_visit_escalate(target,'front_desk_requested');ELSE PERFORM dg_native_visit_withdraw(target);PERFORM dg_native_visit_state(target,CASE WHEN input->>'action'='complete' THEN 'completed' ELSE 'cancelled' END);END IF;
 END IF;RETURN target;
END;$dg$;
CREATE FUNCTION dg_native_visit_sweep() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE o _dg_native_visit_origins%ROWTYPE;v visits%ROWTYPE;count_value integer:=0;
BEGIN
 PERFORM dg_native_reception_runtime(true);
 FOR o IN SELECT * FROM _dg_native_visit_origins WHERE redacted_at IS NULL ORDER BY tenant_id,workspace_id,terminal_id,visit_id LOOP
  IF NOT pg_try_advisory_xact_lock(hashtextextended('native-reception-workspace:'||o.tenant_id||':'||o.workspace_id,0)) THEN CONTINUE;END IF;
  PERFORM id FROM reception_terminals WHERE id=o.terminal_id FOR UPDATE SKIP LOCKED;IF NOT FOUND THEN CONTINUE;END IF;PERFORM id FROM reception_sessions WHERE id=o.session_id FOR UPDATE SKIP LOCKED;IF NOT FOUND THEN CONTINUE;END IF;SELECT * INTO v FROM visits WHERE id=o.visit_id FOR UPDATE SKIP LOCKED;IF NOT FOUND THEN CONTINUE;END IF;
  IF v.status IN('notifying','waiting_host') AND(v.host_deadline<=dg_utc_now() OR NOT dg_native_visit_source_valid(v.id)) THEN PERFORM dg_native_visit_escalate(v.id,CASE WHEN v.host_deadline<=dg_utc_now() THEN 'host_timeout' ELSE 'source_unavailable' END);count_value:=count_value+1;END IF;
  IF o.expires_at<=dg_utc_now() THEN
   PERFORM dg_native_visit_escalate(v.id,'retention_expired');UPDATE visits SET guest_name='',company='',purpose='',appointment_ref='',host_name='',host_private_note=NULL,guidance_code=NULL,version=version+1,updated_at=dg_utc_now() WHERE id=v.id;UPDATE _dg_native_visit_origins SET redacted_at=dg_utc_now() WHERE visit_id=v.id;count_value:=count_value+1;
  END IF;
 END LOOP;RETURN count_value;
END;$dg$;
DO $dg$ DECLARE r record;BEGIN FOR r IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND p.proname LIKE 'dg_native_visit_%' LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||r.signature||' FROM PUBLIC';END LOOP;END;$dg$;
