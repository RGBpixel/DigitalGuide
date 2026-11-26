-- New native validation schemas only. Terminal sessions are anonymous and never grant staff identity.
CREATE TABLE _dg_native_reception_terminals(
 terminal_id text PRIMARY KEY REFERENCES reception_terminals(id),tenant_id text NOT NULL,workspace_id text NOT NULL,
 actor_id text NOT NULL,app_env text NOT NULL,invalidated_at text,created_at text NOT NULL
);
CREATE TABLE _dg_native_reception_origins(
 session_id text PRIMARY KEY REFERENCES reception_sessions(id),terminal_id text NOT NULL REFERENCES reception_terminals(id),
 tenant_id text NOT NULL,workspace_id text NOT NULL,actor_id text NOT NULL,profile text,scene text,assets text NOT NULL,
 inputs_hash text NOT NULL CHECK(inputs_hash ~ '^[a-f0-9]{64}$'),transcript_expires_at text NOT NULL,
 invalidated_at text,created_at text NOT NULL
);
CREATE TABLE _dg_native_reception_access(
 id text PRIMARY KEY,session_id text NOT NULL REFERENCES reception_sessions(id),actor_id text NOT NULL,access_version bigint NOT NULL,
 token_hash text UNIQUE NOT NULL CHECK(token_hash ~ '^[a-f0-9]{64}$'),csrf_hash text NOT NULL CHECK(csrf_hash ~ '^[a-f0-9]{64}$'),
 expires_at text NOT NULL,created_at text NOT NULL,UNIQUE(session_id,access_version)
);
CREATE TABLE _dg_native_reception_receipts(
 id text PRIMARY KEY,terminal_id text NOT NULL REFERENCES reception_terminals(id),session_id text REFERENCES reception_sessions(id),
 access_id text REFERENCES _dg_native_reception_access(id),focus_version bigint,kind text NOT NULL,payload text NOT NULL,
 transaction_id text NOT NULL,created_at text NOT NULL
);
CREATE TABLE _dg_native_reception_message_digests(
 message_id text PRIMARY KEY REFERENCES reception_messages(id),payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$')
);
CREATE SEQUENCE _dg_native_reception_message_order;
CREATE SEQUENCE _dg_native_reception_queue_order;
ALTER TABLE reception_messages ADD COLUMN native_ordinal bigint NOT NULL DEFAULT nextval('_dg_native_reception_message_order');
CREATE UNIQUE INDEX native_reception_message_order ON reception_messages(native_ordinal);
ALTER TABLE reception_presence ADD COLUMN present bigint NOT NULL DEFAULT 1;
ALTER TABLE reception_presence ADD COLUMN queue_sequence bigint;
ALTER TABLE reception_presence ADD CONSTRAINT native_reception_presence_shape CHECK(track_hash ~ '^[a-f0-9]{64}$' AND present IN(0,1) AND((queue_at IS NULL)=(queue_sequence IS NULL)) AND(queue_at IS NULL OR present=1));
ALTER TABLE reception_sessions ADD CONSTRAINT native_reception_session_shape CHECK(environment='mock' AND app_env IN('development','sandbox') AND source IN('manual','mock_presence') AND version>0 AND reply_epoch>=0 AND focus_version>=0 AND access_version>0 AND track_hash ~ '^[a-f0-9]{64}$' AND service_scene IN('reception','restaurant'));
ALTER TABLE reception_terminals ADD CONSTRAINT native_reception_terminal_shape CHECK(environment='mock' AND version>0 AND char_length(name) BETWEEN 1 AND 60);
ALTER TABLE reception_messages ADD CONSTRAINT native_reception_message_shape CHECK(status IN('received','ready','playing','completed','cancelled') AND input_source IN('typed','system','verified_mock_audio') AND reply_epoch>=0 AND focus_version>=0 AND native_ordinal>0 AND char_length(text)<=12000 AND jsonb_typeof(knowledge_citations::jsonb)='array' AND jsonb_typeof(memory_fact_ids::jsonb)='array');
CREATE TRIGGER native_reception_access_immutable BEFORE UPDATE OR DELETE ON _dg_native_reception_access FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_reception_receipt_immutable BEFORE UPDATE OR DELETE ON _dg_native_reception_receipts FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_reception_digest_immutable BEFORE UPDATE OR DELETE ON _dg_native_reception_message_digests FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();

CREATE FUNCTION dg_native_reception_error(code_value text) RETURNS void LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='DGRECEPTION:'||code_value;END;$dg$;
CREATE FUNCTION dg_native_reception_runtime(worker_allowed boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND environment='mock' AND(session_user=app_role OR worker_allowed AND session_user=worker_role)) THEN PERFORM dg_native_reception_error('FORBIDDEN');END IF;END;$dg$;
CREATE FUNCTION dg_native_reception_presence(terminal_value text,input jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v_terminal reception_terminals%ROWTYPE;v_member memberships%ROWTYPE;v_session reception_sessions%ROWTYPE;v_record reception_presence%ROWTYPE;v_waiting text;v_hash text:=input->>'trackHash';v_time text:=dg_utc_now();v_id text:=gen_random_uuid()::text;v_result jsonb;v_position bigint;
BEGIN
 v_terminal:=dg_native_reception_terminal_lock(terminal_value,true);v_member:=dg_native_reception_admin(v_terminal.workspace_id);PERFORM dg_native_reception_fields(input,ARRAY['type','trackHash','sessionId']);
 IF coalesce(input->>'type','') NOT IN('entered','left') OR coalesce(v_hash,'') !~ '^[a-f0-9]{64}$' THEN PERFORM dg_native_reception_error('VALIDATION_FAILED');END IF;
 UPDATE reception_presence SET queue_at=NULL,queue_sequence=NULL WHERE terminal_id=terminal_value AND queue_at IS NOT NULL AND last_seen_at<=dg_native_people_iso(clock_timestamp()-interval '30 seconds');
 SELECT * INTO v_session FROM reception_sessions WHERE terminal_id=terminal_value AND status IN('active','human') FOR UPDATE;SELECT * INTO v_record FROM reception_presence WHERE terminal_id=terminal_value AND track_hash=v_hash;
 IF input->>'type'='left' THEN
  IF v_session.track_hash=v_hash THEN IF input->>'sessionId' IS DISTINCT FROM v_session.id THEN PERFORM dg_native_reception_error('STATE_CONFLICT');END IF;PERFORM dg_native_reception_end(v_session.id,'presence_left');END IF;
  UPDATE reception_presence SET present=0,queue_at=NULL,queue_sequence=NULL,last_seen_at=v_time WHERE terminal_id=terminal_value AND track_hash=v_hash;
  v_result:=jsonb_build_object('disposition','left','sessionId',v_session.id,'greeted',false,'queuePosition',NULL);
 ELSE
  INSERT INTO reception_presence(terminal_id,track_hash,last_seen_at,cooldown_until,queue_at,present,queue_sequence) VALUES(terminal_value,v_hash,v_time,v_time,NULL,1,NULL) ON CONFLICT(terminal_id,track_hash) DO UPDATE SET last_seen_at=excluded.last_seen_at,present=1;
  IF v_session.track_hash=v_hash THEN v_result:=jsonb_build_object('disposition','active','sessionId',v_session.id,'greeted',false,'queuePosition',NULL);
  ELSIF v_record.cooldown_until>v_time THEN v_result:=jsonb_build_object('disposition','cooldown','sessionId',NULL,'greeted',false,'queuePosition',NULL);
  ELSE
   SELECT track_hash INTO v_waiting FROM reception_presence WHERE terminal_id=terminal_value AND present=1 AND queue_at IS NOT NULL AND last_seen_at>dg_native_people_iso(clock_timestamp()-interval '30 seconds') ORDER BY queue_at,queue_sequence LIMIT 1;
   IF v_session.id IS NOT NULL OR v_waiting IS NOT NULL AND v_waiting<>v_hash THEN
    IF v_record.queue_at IS NULL AND(SELECT count(*) FROM reception_presence WHERE terminal_id=terminal_value AND present=1 AND queue_at IS NOT NULL)>=8 THEN PERFORM dg_native_reception_error('QUEUE_FULL');END IF;
    UPDATE reception_presence SET queue_at=coalesce(queue_at,v_time),queue_sequence=coalesce(queue_sequence,nextval('_dg_native_reception_queue_order')) WHERE terminal_id=terminal_value AND track_hash=v_hash;
    SELECT position INTO v_position FROM(SELECT track_hash,row_number() OVER(ORDER BY queue_at,queue_sequence) position FROM reception_presence WHERE terminal_id=terminal_value AND present=1 AND queue_at IS NOT NULL) q WHERE q.track_hash=v_hash;
    v_result:=jsonb_build_object('disposition','queued','sessionId',NULL,'greeted',false,'queuePosition',v_position);
   ELSE
    v_session.id:=dg_native_reception_spawn(terminal_value,v_member.user_id,'mock_presence',v_hash,jsonb_build_object('profile',NULL,'scene',NULL,'assets','[]'::jsonb));
    UPDATE reception_presence SET cooldown_until=dg_native_people_iso(v_time::timestamptz+interval '60 seconds'),queue_at=NULL,queue_sequence=NULL WHERE terminal_id=terminal_value AND track_hash=v_hash;
    v_result:=jsonb_build_object('disposition','started','sessionId',v_session.id,'greeted',true,'queuePosition',NULL);
   END IF;
  END IF;
 END IF;
 INSERT INTO _dg_native_reception_receipts VALUES(v_id,terminal_value,v_result->>'sessionId',NULL,NULL,'presence',v_result::text,pg_current_xact_id()::text,v_time);RETURN v_id;
END;$dg$;
CREATE FUNCTION dg_native_reception_presence_result(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v_receipt _dg_native_reception_receipts%ROWTYPE;
BEGIN PERFORM dg_native_reception_runtime();SELECT * INTO v_receipt FROM _dg_native_reception_receipts WHERE id=target AND kind='presence';IF v_receipt.id IS NULL THEN PERFORM dg_native_reception_error('NOT_FOUND');END IF;PERFORM dg_native_reception_terminal_lock(v_receipt.terminal_id);RETURN v_receipt.payload::jsonb;END;$dg$;
CREATE FUNCTION dg_native_reception_next(terminal_value text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v_terminal reception_terminals%ROWTYPE;v_member memberships%ROWTYPE;v_track text;v_id text;
BEGIN
 v_terminal:=dg_native_reception_terminal_lock(terminal_value,true);v_member:=dg_native_reception_admin(v_terminal.workspace_id);IF EXISTS(SELECT 1 FROM reception_sessions WHERE terminal_id=terminal_value AND status IN('active','human')) THEN PERFORM dg_native_reception_error('STATE_CONFLICT');END IF;
 SELECT track_hash INTO v_track FROM reception_presence WHERE terminal_id=terminal_value AND present=1 AND queue_at IS NOT NULL AND last_seen_at>dg_native_people_iso(clock_timestamp()-interval '30 seconds') ORDER BY queue_at,queue_sequence LIMIT 1;
 IF v_track IS NULL THEN PERFORM dg_native_reception_error('QUEUE_EMPTY');END IF;v_id:=dg_native_reception_spawn(terminal_value,v_member.user_id,'mock_presence',v_track,jsonb_build_object('profile',NULL,'scene',NULL,'assets','[]'::jsonb));UPDATE reception_presence SET queue_at=NULL,queue_sequence=NULL,cooldown_until=dg_native_people_iso(clock_timestamp()+interval '60 seconds') WHERE terminal_id=terminal_value AND track_hash=v_track;RETURN v_id;
END;$dg$;
CREATE FUNCTION dg_native_reception_issue(target text,grant_value text,token_hash_value text,csrf_hash_value text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v_meta jsonb;v_session reception_sessions%ROWTYPE;v_member memberships%ROWTYPE;
BEGIN
 v_meta:=dg_native_reception_meta(target,NULL);PERFORM dg_native_reception_terminal_lock(v_meta->>'terminalId',true);v_member:=dg_native_reception_admin(v_meta->>'workspaceId');SELECT * INTO v_session FROM reception_sessions WHERE id=target FOR UPDATE;
 IF v_session.status NOT IN('active','human') OR v_session.expires_at<=dg_utc_now() OR v_session.activity_at<=dg_native_people_iso(clock_timestamp()-interval '120 seconds') THEN PERFORM dg_native_reception_error('SESSION_ENDED');END IF;IF NOT dg_native_reception_source_valid(target) THEN PERFORM dg_native_reception_error('SOURCE_UNAVAILABLE');END IF;
 IF grant_value IS NULL OR token_hash_value !~ '^[a-f0-9]{64}$' OR csrf_hash_value !~ '^[a-f0-9]{64}$' THEN PERFORM dg_native_reception_error('VALIDATION_FAILED');END IF;
 UPDATE reception_sessions SET access_version=access_version+1,version=version+1 WHERE id=target RETURNING * INTO v_session;
 INSERT INTO _dg_native_reception_access VALUES(grant_value,target,v_member.user_id,v_session.access_version,token_hash_value,csrf_hash_value,v_session.expires_at,dg_utc_now());RETURN grant_value;
END;$dg$;
CREATE FUNCTION dg_native_reception_access(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v_access _dg_native_reception_access%ROWTYPE;v_member memberships%ROWTYPE;v_session reception_sessions%ROWTYPE;
BEGIN
 v_member:=dg_native_reception_admin(NULL);SELECT * INTO v_access FROM _dg_native_reception_access WHERE id=target AND actor_id=v_member.user_id;IF v_access.id IS NULL THEN PERFORM dg_native_reception_error('NOT_FOUND');END IF;PERFORM dg_native_reception_meta(v_access.session_id,NULL);SELECT * INTO v_session FROM reception_sessions WHERE id=v_access.session_id;
 IF v_session.status NOT IN('active','human') OR v_session.expires_at<=dg_utc_now() OR v_session.activity_at<=dg_native_people_iso(clock_timestamp()-interval '120 seconds') THEN PERFORM dg_native_reception_error('SESSION_ENDED');END IF;IF v_access.access_version<>v_session.access_version THEN PERFORM dg_native_reception_error('STATE_CONFLICT');END IF;
 RETURN jsonb_build_object('sessionId',v_access.session_id,'expiresAt',v_access.expires_at);
END;$dg$;
CREATE FUNCTION dg_native_reception_guest_apply(target text,token_hash_value text,csrf_hash_value text,action_value text,input jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v_row reception_sessions%ROWTYPE;v_access _dg_native_reception_access%ROWTYPE;v_id text:=gen_random_uuid()::text;v_payload jsonb:='{}';v_text text;v_reply text;v_citations jsonb;v_message reception_messages%ROWTYPE;v_epoch bigint;v_required bigint;
BEGIN
 PERFORM dg_native_reception_authorize(target,token_hash_value,csrf_hash_value,true);SELECT * INTO v_row FROM reception_sessions WHERE id=target;SELECT * INTO v_access FROM _dg_native_reception_access WHERE session_id=target AND token_hash=token_hash_value AND access_version=v_row.access_version;
 IF(SELECT count(*) FROM _dg_native_reception_receipts WHERE session_id=target AND access_id IS NOT NULL AND created_at>dg_native_people_iso(clock_timestamp()-interval '60 seconds'))>=120 THEN PERFORM dg_native_reception_error('RATE_LIMITED');END IF;
 IF(SELECT count(*) FROM _dg_native_reception_receipts WHERE session_id=target AND access_id IS NOT NULL)>=1000 THEN PERFORM dg_native_reception_error('QUOTA_EXCEEDED');END IF;
 IF action_value='message' THEN
  PERFORM dg_native_reception_fields(input,ARRAY['text','version','focusVersion','source','reply','citations']);v_text:=input->>'text';v_reply:=input->>'reply';v_citations:=input->'citations';
  IF input->>'version' IS DISTINCT FROM v_row.version::text OR input->>'focusVersion' IS DISTINCT FROM v_row.focus_version::text THEN PERFORM dg_native_reception_error('VERSION_CONFLICT');END IF;
  IF input->>'source' IS DISTINCT FROM 'typed' OR jsonb_typeof(input->'text') IS DISTINCT FROM 'string' OR char_length(btrim(v_text)) NOT BETWEEN 1 AND 1000 OR(v_row.status='active' AND(v_reply IS NULL OR left(v_reply,3)<>'【模拟' OR char_length(v_reply)>12000)) OR(v_row.status='human' AND v_reply IS NOT NULL) OR NOT dg_native_reception_citations_valid(target,v_citations) THEN PERFORM dg_native_reception_error('VALIDATION_FAILED');END IF;
  IF(SELECT count(*) FROM reception_messages WHERE session_id=target AND role='visitor' AND created_at>dg_native_people_iso(clock_timestamp()-interval '60 seconds'))>=20 THEN PERFORM dg_native_reception_error('RATE_LIMITED');END IF;
  v_required:=CASE WHEN v_row.status='active' THEN 2 ELSE 1 END;IF(SELECT count(*) FROM reception_messages WHERE session_id=target)+v_required>200 THEN PERFORM dg_native_reception_error('QUOTA_EXCEEDED');END IF;
  PERFORM dg_native_reception_cancel(target);v_epoch:=v_row.reply_epoch+1;PERFORM dg_native_reception_add_message(target,'visitor',btrim(v_text),'received',v_epoch,v_row.focus_version);
  IF v_row.status='active' THEN PERFORM dg_native_reception_add_message(target,'assistant',v_reply,'ready',v_epoch,v_row.focus_version,v_citations);END IF;
  UPDATE reception_sessions SET version=version+1,reply_epoch=v_epoch,activity_at=dg_utc_now() WHERE id=target;INSERT INTO outbox_events VALUES(gen_random_uuid()::text,v_row.tenant_id,v_row.workspace_id,target,'session.typed_message','mock','{}',dg_utc_now(),NULL);
 ELSIF action_value='control' THEN PERFORM dg_native_reception_control(target,input,true);
 ELSIF action_value='event' THEN
  IF input->>'type'='audio.segment' THEN
   PERFORM dg_native_reception_fields(input,ARRAY['type','segmentId','attribution','final','focusVersion','source']);
   IF input->>'source' IS DISTINCT FROM 'mock_audio' OR coalesce(input->>'attribution','') NOT IN('target','other','uncertain') OR jsonb_typeof(input->'final') IS DISTINCT FROM 'boolean' THEN PERFORM dg_native_reception_error('VALIDATION_FAILED');END IF;
   v_payload:=jsonb_build_object('accepted',false,'reason',CASE WHEN input->>'focusVersion' IS DISTINCT FROM v_row.focus_version::text THEN 'STALE_FOCUS' ELSE 'SPEAKER_FOCUS_NOT_CONFIGURED' END,'message','当前没有可靠的目标归属服务，请使用文字输入或人工接待。');
  ELSE
   PERFORM dg_native_reception_fields(input,ARRAY['type','replyId','replyEpoch','focusVersion']);IF coalesce(input->>'type','') NOT IN('reply.started','reply.completed') OR v_row.status<>'active' OR input->>'replyEpoch' IS DISTINCT FROM v_row.reply_epoch::text OR input->>'focusVersion' IS DISTINCT FROM v_row.focus_version::text THEN PERFORM dg_native_reception_error('STATE_CONFLICT');END IF;
   SELECT * INTO v_message FROM reception_messages WHERE id=input->>'replyId' AND session_id=target AND role='assistant' AND reply_epoch=v_row.reply_epoch AND focus_version=v_row.focus_version FOR UPDATE;
   IF v_message.id IS NULL OR v_message.status<>(CASE WHEN input->>'type'='reply.started' THEN 'ready' ELSE 'playing' END) OR NOT dg_native_reception_citations_valid(target,v_message.knowledge_citations::jsonb) THEN PERFORM dg_native_reception_error('STATE_CONFLICT');END IF;
   UPDATE reception_messages SET status=CASE WHEN input->>'type'='reply.started' THEN 'playing' ELSE 'completed' END WHERE id=v_message.id;UPDATE reception_sessions SET version=version+1,activity_at=dg_utc_now() WHERE id=target;INSERT INTO outbox_events VALUES(gen_random_uuid()::text,v_row.tenant_id,v_row.workspace_id,target,input->>'type','mock','{}',dg_utc_now(),NULL);
  END IF;
 ELSE PERFORM dg_native_reception_error('VALIDATION_FAILED');END IF;
 INSERT INTO _dg_native_reception_receipts VALUES(v_id,v_row.terminal_id,target,v_access.id,v_row.focus_version,action_value,v_payload::text,pg_current_xact_id()::text,dg_utc_now());RETURN v_id;
END;$dg$;
CREATE FUNCTION dg_native_reception_guest_result(target text,token_hash_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v_receipt _dg_native_reception_receipts%ROWTYPE;v_access _dg_native_reception_access%ROWTYPE;v_session reception_sessions%ROWTYPE;
BEGIN
 PERFORM dg_native_reception_runtime();SELECT * INTO v_receipt FROM _dg_native_reception_receipts WHERE id=target;SELECT * INTO v_access FROM _dg_native_reception_access WHERE id=v_receipt.access_id AND token_hash=token_hash_value;
 IF v_receipt.id IS NULL OR v_access.id IS NULL THEN PERFORM dg_native_reception_error('AUTH_REQUIRED');END IF;SELECT * INTO v_session FROM reception_sessions WHERE id=v_receipt.session_id;
 IF NOT(v_receipt.kind='control' AND v_receipt.transaction_id=pg_current_xact_id()::text AND v_session.status='ended' AND v_session.ended_reason='manual_end') THEN PERFORM dg_native_reception_authorize(v_session.id,token_hash_value,NULL,false);END IF;
 IF v_receipt.payload::jsonb ? 'accepted' THEN RETURN v_receipt.payload::jsonb;END IF;RETURN jsonb_build_object('session',dg_native_reception_project(v_session.id));
END;$dg$;
CREATE FUNCTION dg_native_reception_admin(workspace_value text) RETURNS memberships LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v_member memberships%ROWTYPE;v_actor text:=current_setting('digitalguide.actor_id',true);
BEGIN PERFORM dg_native_reception_runtime();SELECT * INTO v_member FROM dg_native_locked_membership(v_actor);IF v_member.user_id IS NULL OR v_member.role<>'admin' THEN PERFORM dg_native_reception_error('FORBIDDEN');END IF;IF workspace_value IS NOT NULL AND NOT(v_member.workspace_ids::jsonb ? workspace_value) THEN PERFORM dg_native_reception_error('NOT_FOUND');END IF;RETURN v_member;END;$dg$;
CREATE FUNCTION dg_native_reception_workspace(tenant_value text,workspace_value text,write_value boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN IF write_value THEN PERFORM pg_advisory_xact_lock(hashtextextended('native-reception-workspace:'||tenant_value||':'||workspace_value,0));ELSE PERFORM pg_advisory_xact_lock_shared(hashtextextended('native-reception-workspace:'||tenant_value||':'||workspace_value,0));END IF;END;$dg$;
CREATE FUNCTION dg_native_reception_fields(input jsonb,keys_value text[]) RETURNS void LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN IF input IS NULL OR jsonb_typeof(input)<>'object' OR input-keys_value<>'{}'::jsonb THEN PERFORM dg_native_reception_error('VALIDATION_FAILED');END IF;END;$dg$;
CREATE FUNCTION dg_native_reception_sweep() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v_candidate record;v_row reception_sessions%ROWTYPE;v_origin _dg_native_reception_origins%ROWTYPE;v_count bigint:=0;v_changed bigint;v_time text:=dg_utc_now();v_terminal text;
BEGIN
 PERFORM dg_native_reception_runtime(true);
 FOR v_candidate IN SELECT s.id,s.terminal_id,s.tenant_id,s.workspace_id FROM reception_sessions s JOIN _dg_native_reception_origins g ON g.session_id=s.id WHERE s.environment='mock' AND s.app_env=(SELECT app_env FROM _dg_native_runtime_control WHERE id=1) ORDER BY s.terminal_id,s.id LOOP
  -- Parent terminal always precedes its sessions/messages; maintenance never locks a membership afterwards.
  PERFORM dg_native_reception_workspace(v_candidate.tenant_id,v_candidate.workspace_id);v_terminal:=NULL;SELECT id INTO v_terminal FROM reception_terminals WHERE id=v_candidate.terminal_id FOR UPDATE SKIP LOCKED;IF v_terminal IS NULL THEN CONTINUE;END IF;
  SELECT * INTO v_row FROM reception_sessions WHERE id=v_candidate.id FOR UPDATE SKIP LOCKED;IF v_row.id IS NULL THEN CONTINUE;END IF;SELECT * INTO v_origin FROM _dg_native_reception_origins WHERE session_id=v_row.id;
  IF v_origin.invalidated_at IS NULL AND NOT dg_native_reception_source_valid(v_row.id) THEN PERFORM dg_native_reception_end(v_row.id,'source_unavailable',false,true);v_count:=v_count+1;
  ELSIF v_row.status IN('active','human') AND(v_row.expires_at<=v_time OR v_row.activity_at<=dg_native_people_iso(v_time::timestamptz-interval '120 seconds')) THEN PERFORM dg_native_reception_end(v_row.id,'timeout',true);v_count:=v_count+1;END IF;
  IF v_origin.transcript_expires_at<=v_time THEN
   UPDATE reception_messages SET text='',knowledge_citations='[]',status='cancelled' WHERE session_id=v_row.id AND(text<>'' OR knowledge_citations<>'[]' OR status<>'cancelled');GET DIAGNOSTICS v_changed=ROW_COUNT;v_count:=v_count+v_changed;
  ELSE
   UPDATE reception_messages SET text='',knowledge_citations='[]',status='cancelled' WHERE session_id=v_row.id AND knowledge_citations<>'[]' AND NOT dg_native_reception_citations_valid(v_row.id,knowledge_citations::jsonb);GET DIAGNOSTICS v_changed=ROW_COUNT;
   IF v_changed>0 AND v_row.status IN('active','human') THEN PERFORM dg_native_reception_cancel(v_row.id);UPDATE reception_sessions SET version=version+1,reply_epoch=reply_epoch+1 WHERE id=v_row.id;END IF;v_count:=v_count+v_changed;
  END IF;
 END LOOP;
 FOR v_candidate IN SELECT t.id,t.tenant_id,t.workspace_id FROM reception_terminals t JOIN _dg_native_reception_terminals g ON g.terminal_id=t.id WHERE g.app_env=(SELECT app_env FROM _dg_native_runtime_control WHERE id=1) ORDER BY t.id LOOP
  PERFORM dg_native_reception_workspace(v_candidate.tenant_id,v_candidate.workspace_id);v_terminal:=NULL;SELECT id INTO v_terminal FROM reception_terminals WHERE id=v_candidate.id FOR UPDATE SKIP LOCKED;IF v_terminal IS NULL THEN CONTINUE;END IF;
  UPDATE reception_presence SET queue_at=NULL,queue_sequence=NULL WHERE terminal_id=v_terminal AND queue_at IS NOT NULL AND(present=0 OR last_seen_at<=dg_native_people_iso(v_time::timestamptz-interval '30 seconds'));
  DELETE FROM reception_presence p WHERE p.terminal_id=v_terminal AND p.last_seen_at<=dg_native_people_iso(v_time::timestamptz-interval '24 hours') AND p.cooldown_until<=v_time AND NOT EXISTS(SELECT 1 FROM reception_sessions s WHERE s.terminal_id=v_terminal AND s.track_hash=p.track_hash AND s.status IN('active','human'));
 END LOOP;RETURN v_count;
END;$dg$;
CREATE FUNCTION dg_native_reception_scope_invalidate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v_guard _dg_native_reception_terminals%ROWTYPE;v_origin _dg_native_reception_origins%ROWTYPE;
BEGIN
 FOR v_guard IN SELECT * FROM _dg_native_reception_terminals WHERE actor_id=OLD.user_id AND invalidated_at IS NULL ORDER BY terminal_id LOOP
  IF TG_OP='DELETE' OR NOT EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=v_guard.actor_id AND m.tenant_id=v_guard.tenant_id AND m.role='admin' AND m.workspace_ids::jsonb ? v_guard.workspace_id) THEN
   PERFORM dg_native_reception_workspace(v_guard.tenant_id,v_guard.workspace_id,true);PERFORM id FROM reception_terminals WHERE id=v_guard.terminal_id FOR UPDATE;UPDATE _dg_native_reception_terminals SET invalidated_at=dg_utc_now() WHERE terminal_id=v_guard.terminal_id;UPDATE reception_presence SET present=0,queue_at=NULL,queue_sequence=NULL WHERE terminal_id=v_guard.terminal_id;
   FOR v_origin IN SELECT * FROM _dg_native_reception_origins WHERE terminal_id=v_guard.terminal_id AND invalidated_at IS NULL ORDER BY session_id LOOP PERFORM dg_native_reception_end(v_origin.session_id,'terminal_scope_withdrawn',false,true);END LOOP;
  END IF;
 END LOOP;
 FOR v_origin IN SELECT * FROM _dg_native_reception_origins WHERE actor_id=OLD.user_id AND invalidated_at IS NULL ORDER BY terminal_id,session_id LOOP
  IF TG_OP='DELETE' OR NOT EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=v_origin.actor_id AND m.tenant_id=v_origin.tenant_id AND m.role='admin' AND m.workspace_ids::jsonb ? v_origin.workspace_id) THEN PERFORM dg_native_reception_workspace(v_origin.tenant_id,v_origin.workspace_id,true);PERFORM id FROM reception_terminals WHERE id=v_origin.terminal_id FOR UPDATE;PERFORM dg_native_reception_end(v_origin.session_id,'session_scope_withdrawn',false,true);END IF;
 END LOOP;RETURN NULL;
END;$dg$;
CREATE TRIGGER native_reception_scope_invalidate AFTER UPDATE OR DELETE ON memberships FOR EACH ROW EXECUTE FUNCTION dg_native_reception_scope_invalidate();
CREATE FUNCTION dg_native_reception_dependency_invalidate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v_origin _dg_native_reception_origins%ROWTYPE;
BEGIN
 FOR v_origin IN SELECT * FROM _dg_native_reception_origins WHERE invalidated_at IS NULL ORDER BY terminal_id,session_id LOOP
  IF NOT dg_native_reception_source_valid(v_origin.session_id) THEN PERFORM dg_native_reception_workspace(v_origin.tenant_id,v_origin.workspace_id,true);PERFORM id FROM reception_terminals WHERE id=v_origin.terminal_id FOR UPDATE;PERFORM dg_native_reception_end(v_origin.session_id,'source_withdrawn',false,true);END IF;
 END LOOP;RETURN NULL;
END;$dg$;
CREATE TRIGGER native_reception_asset_invalidate AFTER UPDATE ON assets FOR EACH ROW EXECUTE FUNCTION dg_native_reception_dependency_invalidate();
CREATE TRIGGER native_reception_scene_invalidate AFTER UPDATE ON scene_apps FOR EACH ROW EXECUTE FUNCTION dg_native_reception_dependency_invalidate();
CREATE TRIGGER native_reception_collection_invalidate AFTER UPDATE ON knowledge_collections FOR EACH ROW EXECUTE FUNCTION dg_native_reception_dependency_invalidate();
CREATE FUNCTION dg_native_reception_session_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'active' OR NEW.version<>1 OR NEW.reply_epoch<>0 OR NEW.focus_version<>0 OR NEW.access_version<>1 OR NEW.service_scene<>'reception' OR NEW.dining_party_id IS NOT NULL OR NEW.created_at<>NEW.activity_at OR extract(epoch FROM NEW.expires_at::timestamptz)-extract(epoch FROM NEW.created_at::timestamptz)<>900 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native reception starts anonymously with fixed clocks and no completed replies';END IF;
 ELSE
  IF OLD.status IN('ended','expired') OR NEW.version<>OLD.version+1 OR NEW.reply_epoch NOT BETWEEN OLD.reply_epoch AND OLD.reply_epoch+1 OR NEW.focus_version NOT BETWEEN OLD.focus_version AND OLD.focus_version+1 OR NEW.access_version NOT BETWEEN OLD.access_version AND OLD.access_version+1 OR to_jsonb(NEW)-ARRAY['status','version','reply_epoch','focus_version','access_version','activity_at','ended_reason'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['status','version','reply_epoch','focus_version','access_version','activity_at','ended_reason'] OR NEW.activity_at<OLD.activity_at THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Session scope, original expiry and monotonic versions are guarded';END IF;
  IF NEW.status IN('ended','expired') AND(NEW.reply_epoch<>OLD.reply_epoch+1 OR NEW.focus_version<>OLD.focus_version+1 OR NEW.access_version<>OLD.access_version+1 OR NEW.ended_reason IS NULL) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Session closure revokes every old reply, target and access capability';END IF;
 END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_reception_session_guard BEFORE INSERT OR UPDATE ON reception_sessions FOR EACH ROW EXECUTE FUNCTION dg_native_reception_session_guard();
CREATE FUNCTION dg_native_reception_terminal_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN IF TG_OP='INSERT' THEN IF NEW.version<>1 OR NOT EXISTS(SELECT 1 FROM venues v WHERE v.id=NEW.venue_id AND v.tenant_id=NEW.tenant_id AND v.workspace_id=NEW.workspace_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Terminal venue must share the original scope';END IF;ELSE IF NEW.version<>OLD.version+1 OR to_jsonb(NEW)-'version' IS DISTINCT FROM to_jsonb(OLD)-'version' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Terminal identity and configuration are immutable in this revision';END IF;END IF;RETURN NEW;END;$dg$;
CREATE TRIGGER native_reception_terminal_guard BEFORE INSERT OR UPDATE ON reception_terminals FOR EACH ROW EXECUTE FUNCTION dg_native_reception_terminal_guard();
CREATE FUNCTION dg_native_reception_origin_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN IF TG_OP='DELETE' OR to_jsonb(NEW)-'invalidated_at' IS DISTINCT FROM to_jsonb(OLD)-'invalidated_at' OR OLD.invalidated_at IS NOT NULL AND NEW.invalidated_at IS DISTINCT FROM OLD.invalidated_at THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Original reception scope cannot be rewritten or revived';END IF;RETURN NEW;END;$dg$;
CREATE TRIGGER native_reception_origin_guard BEFORE UPDATE OR DELETE ON _dg_native_reception_origins FOR EACH ROW EXECUTE FUNCTION dg_native_reception_origin_guard();
CREATE TRIGGER native_reception_terminal_origin_guard BEFORE UPDATE OR DELETE ON _dg_native_reception_terminals FOR EACH ROW EXECUTE FUNCTION dg_native_reception_origin_guard();
CREATE FUNCTION dg_native_reception_message_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE v_session reception_sessions%ROWTYPE;
BEGIN
 SELECT * INTO v_session FROM reception_sessions WHERE id=NEW.session_id;
 IF v_session.id IS NULL OR NEW.tenant_id<>v_session.tenant_id OR NEW.workspace_id<>v_session.workspace_id OR NEW.memory_person_id IS NOT NULL OR NEW.memory_fact_ids<>'[]' OR NEW.visual_context IS NOT NULL OR NEW.restaurant_context IS NOT NULL OR NEW.speaker_decision_id IS NOT NULL OR NEW.input_source IS DISTINCT FROM(CASE WHEN NEW.role='visitor' THEN 'typed' ELSE 'system' END) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Reception message needs its bound session and supported input proof';END IF;
 IF TG_OP='INSERT' THEN IF NEW.focus_version<>v_session.focus_version OR NEW.reply_epoch NOT BETWEEN v_session.reply_epoch AND v_session.reply_epoch+1 OR NEW.status IS DISTINCT FROM(CASE WHEN NEW.role='assistant' THEN 'ready' ELSE 'received' END) OR char_length(NEW.text)=0 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Reception message starts from the current typed turn or fixed greeting';END IF;
 ELSE
  IF to_jsonb(NEW)-ARRAY['text','status','knowledge_citations'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['text','status','knowledge_citations'] OR OLD.status='cancelled' AND NEW.status<>'cancelled' OR NEW.text IS DISTINCT FROM OLD.text AND NEW.text<>'' OR NEW.knowledge_citations IS DISTINCT FROM OLD.knowledge_citations AND NEW.knowledge_citations<>'[]' OR NEW.text='' AND NEW.status<>'cancelled' OR NEW.text<>'' AND NEW.knowledge_citations IS DISTINCT FROM OLD.knowledge_citations THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Messages cannot be retargeted, rewritten or replayed after cancellation';END IF;
  IF NEW.text<>'' AND NOT(NEW.status=OLD.status OR NEW.role='assistant' AND((OLD.status='ready' AND NEW.status IN('playing','cancelled')) OR(OLD.status='playing' AND NEW.status IN('completed','cancelled')) OR(OLD.status='completed' AND NEW.status='cancelled'))) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Unsupported reply playback transition';END IF;
 END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_reception_message_guard BEFORE INSERT OR UPDATE ON reception_messages FOR EACH ROW EXECUTE FUNCTION dg_native_reception_message_guard();
CREATE FUNCTION dg_native_reception_final_binding() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v_target text;v_session reception_sessions%ROWTYPE;v_origin _dg_native_reception_origins%ROWTYPE;v_terminal reception_terminals%ROWTYPE;v_guard _dg_native_reception_terminals%ROWTYPE;v_message reception_messages%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME IN('reception_terminals','_dg_native_reception_terminals') THEN
  v_target:=CASE WHEN TG_TABLE_NAME='reception_terminals' THEN to_jsonb(NEW)->>'id' ELSE to_jsonb(NEW)->>'terminal_id' END;SELECT * INTO v_terminal FROM reception_terminals WHERE id=v_target;SELECT * INTO v_guard FROM _dg_native_reception_terminals WHERE terminal_id=v_target;
  IF v_guard.terminal_id IS NULL OR v_terminal.id IS NULL OR v_guard.tenant_id<>v_terminal.tenant_id OR v_guard.workspace_id<>v_terminal.workspace_id OR v_guard.app_env IS DISTINCT FROM(SELECT app_env FROM _dg_native_runtime_control WHERE id=1) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Terminal and original scope guard must commit together';END IF;RETURN NULL;
 END IF;
 IF TG_TABLE_NAME IN('reception_messages','_dg_native_reception_message_digests') THEN
  SELECT * INTO v_message FROM reception_messages WHERE id=CASE WHEN TG_TABLE_NAME='reception_messages' THEN to_jsonb(NEW)->>'id' ELSE to_jsonb(NEW)->>'message_id' END;v_target:=v_message.session_id;
  IF v_message.id IS NULL OR NOT EXISTS(SELECT 1 FROM _dg_native_reception_message_digests d WHERE d.message_id=v_message.id AND(v_message.text='' OR d.payload_hash=dg_native_office_hash(dg_native_reception_message_payload(v_message.id)))) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Message must commit its original immutable digest';END IF;
 ELSE v_target:=CASE WHEN TG_TABLE_NAME='reception_sessions' THEN to_jsonb(NEW)->>'id' ELSE to_jsonb(NEW)->>'session_id' END;END IF;
 SELECT * INTO v_session FROM reception_sessions WHERE id=v_target;SELECT * INTO v_origin FROM _dg_native_reception_origins WHERE session_id=v_target;
 IF v_session.id IS NULL OR v_origin.session_id IS NULL OR v_session.tenant_id<>v_origin.tenant_id OR v_session.workspace_id<>v_origin.workspace_id OR v_session.terminal_id<>v_origin.terminal_id OR v_session.profile_snapshot::jsonb IS DISTINCT FROM v_origin.profile::jsonb OR v_session.scene_app_snapshot::jsonb IS DISTINCT FROM v_origin.scene::jsonb OR extract(epoch FROM v_origin.transcript_expires_at::timestamptz)-extract(epoch FROM v_session.created_at::timestamptz)<>24*3600 OR NOT EXISTS(SELECT 1 FROM reception_messages m WHERE m.session_id=v_target AND m.role='assistant') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Session, fixed source and first greeting must commit atomically';END IF;
 IF v_session.status IN('active','human') AND NOT dg_native_reception_source_valid(v_target) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Active reception requires its original usable public sources';END IF;
 IF v_session.status IN('ended','expired') AND EXISTS(SELECT 1 FROM reception_messages WHERE session_id=v_target AND status IN('ready','playing')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Closed session cannot retain playable replies';END IF;
 IF v_origin.invalidated_at IS NOT NULL AND EXISTS(SELECT 1 FROM reception_messages WHERE session_id=v_target AND text<>'') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Withdrawn source cannot retain readable transcript bodies';END IF;RETURN NULL;
END;$dg$;
CREATE CONSTRAINT TRIGGER native_reception_terminal_final AFTER INSERT OR UPDATE ON reception_terminals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_reception_final_binding();
CREATE CONSTRAINT TRIGGER native_reception_terminal_origin_final AFTER INSERT OR UPDATE ON _dg_native_reception_terminals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_reception_final_binding();
CREATE CONSTRAINT TRIGGER native_reception_session_final AFTER INSERT OR UPDATE ON reception_sessions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_reception_final_binding();
CREATE CONSTRAINT TRIGGER native_reception_origin_final AFTER INSERT OR UPDATE ON _dg_native_reception_origins DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_reception_final_binding();
CREATE CONSTRAINT TRIGGER native_reception_message_final AFTER INSERT OR UPDATE ON reception_messages DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_reception_final_binding();
CREATE CONSTRAINT TRIGGER native_reception_digest_final AFTER INSERT ON _dg_native_reception_message_digests DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_reception_final_binding();
CREATE FUNCTION dg_native_reception_venues(workspaces_value text[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v_member memberships%ROWTYPE;v_result jsonb;v_ws text;
BEGIN
 PERFORM dg_native_reception_runtime();SELECT * INTO v_member FROM dg_native_locked_membership(current_setting('digitalguide.actor_id',true));IF v_member.user_id IS NULL THEN PERFORM dg_native_reception_error('AUTH_REQUIRED');END IF;
 IF workspaces_value IS NULL OR cardinality(workspaces_value)>1000 THEN PERFORM dg_native_reception_error('VALIDATION_FAILED');END IF;FOREACH v_ws IN ARRAY workspaces_value LOOP IF NOT(v_member.workspace_ids::jsonb ? v_ws) THEN PERFORM dg_native_reception_error('NOT_FOUND');END IF;END LOOP;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',v.id,'workspaceId',v.workspace_id,'name',v.name,'timezone',v.timezone) ORDER BY v.id),'[]') INTO v_result FROM venues v WHERE v.tenant_id=v_member.tenant_id AND v.workspace_id=ANY(workspaces_value);RETURN v_result;
END;$dg$;
CREATE FUNCTION dg_native_reception_citations_valid(target text,citations_value jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v_origin _dg_native_reception_origins%ROWTYPE;v_item jsonb;
BEGIN
 SELECT * INTO v_origin FROM _dg_native_reception_origins WHERE session_id=target;
 IF v_origin.session_id IS NULL OR jsonb_typeof(citations_value) IS DISTINCT FROM 'array' OR jsonb_array_length(citations_value)>20 THEN RETURN false;END IF;
 IF jsonb_array_length(citations_value)=0 THEN RETURN true;END IF;IF v_origin.scene IS NULL OR v_origin.scene::jsonb='null'::jsonb THEN RETURN false;END IF;
 FOR v_item IN SELECT value FROM jsonb_array_elements(citations_value) LOOP
  IF NOT EXISTS(SELECT 1 FROM knowledge_collections c JOIN knowledge_documents d ON d.collection_id=c.id JOIN knowledge_versions v ON v.id=d.published_version_id AND v.document_id=d.id JOIN knowledge_chunks k ON k.document_id=d.id AND k.version_id=v.id WHERE c.id=v_item->>'collectionId' AND c.tenant_id=v_origin.tenant_id AND c.workspace_id=v_origin.workspace_id AND c.audience='public' AND c.scenes::jsonb ? 'reception' AND c.reader_roles::jsonb ? 'viewer' AND c.environment='mock' AND c.app_env=(SELECT app_env FROM _dg_native_runtime_control WHERE id=1) AND(v_origin.scene::jsonb->'collectionIds') ? c.id AND d.id=v_item->>'documentId' AND v.id=v_item->>'versionId' AND v.ordinal=(v_item->>'version')::bigint AND v.status='published' AND v.title=v_item->>'title' AND v.source_label=v_item->>'sourceLabel' AND v.source_url IS NOT DISTINCT FROM v_item->>'sourceUrl' AND left(k.text,400)=v_item->>'snippet') THEN RETURN false;END IF;
 END LOOP;RETURN true;
EXCEPTION WHEN data_exception THEN RETURN false;
END;$dg$;
CREATE FUNCTION dg_native_reception_project(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v_row reception_sessions%ROWTYPE;v_origin _dg_native_reception_origins%ROWTYPE;v_messages jsonb;v_retained boolean;
BEGIN
 SELECT * INTO v_row FROM reception_sessions WHERE id=target;SELECT * INTO v_origin FROM _dg_native_reception_origins WHERE session_id=target;
 v_retained:=v_origin.invalidated_at IS NULL AND v_origin.transcript_expires_at>dg_utc_now();
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'role',m.role,'text',CASE WHEN v_retained AND dg_native_reception_citations_valid(target,m.knowledge_citations::jsonb) THEN m.text ELSE '' END,'status',CASE WHEN NOT v_retained OR NOT dg_native_reception_citations_valid(target,m.knowledge_citations::jsonb) THEN 'cancelled' ELSE m.status END,'replyEpoch',m.reply_epoch,'focusVersion',m.focus_version,'createdAt',m.created_at,'restaurantContext',NULL,'citations',CASE WHEN v_retained AND dg_native_reception_citations_valid(target,m.knowledge_citations::jsonb) THEN m.knowledge_citations::jsonb ELSE '[]'::jsonb END,'visualContext',NULL,'toolRequests','[]'::jsonb,'inputSource',m.input_source,'speakerDecisionId',m.speaker_decision_id) ORDER BY m.native_ordinal),'[]') INTO v_messages FROM reception_messages m WHERE m.session_id=target;
 RETURN jsonb_build_object('id',v_row.id,'terminalId',v_row.terminal_id,'status',v_row.status,'version',v_row.version,'replyEpoch',v_row.reply_epoch,'focusVersion',v_row.focus_version,'source',v_row.source,'environment',v_row.environment,'identity','anonymous','scene',v_row.service_scene,'sceneAppId',v_origin.scene::jsonb->>'id','sceneAppName',v_origin.scene::jsonb->>'name','expiresAt',v_row.expires_at,'activityAt',v_row.activity_at,'profileName',v_origin.profile::jsonb->>'name','messages',v_messages,'features',jsonb_build_object('speakerFocus',false,'visitRegistration',false,'personalMemory',false,'visionQuestions',false,'dining',false));
END;$dg$;
CREATE FUNCTION dg_native_reception_session(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v_meta jsonb;
BEGIN v_meta:=dg_native_reception_meta(target,NULL);PERFORM dg_native_reception_terminal_lock(v_meta->>'terminalId');PERFORM id FROM reception_sessions WHERE id=target FOR SHARE;RETURN dg_native_reception_project(target);END;$dg$;
CREATE FUNCTION dg_native_reception_guest_view(target text,token_hash_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN PERFORM dg_native_reception_authorize(target,token_hash_value,NULL,false);RETURN dg_native_reception_project(target);END;$dg$;
CREATE FUNCTION dg_native_reception_message_payload(target text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT to_jsonb(m)-ARRAY['status','text']||jsonb_build_object('textHash',encode(sha256(convert_to(m.text,'UTF8')),'hex')) FROM reception_messages m WHERE m.id=target
$dg$;
CREATE FUNCTION dg_native_reception_add_message(target text,role_value text,text_value text,status_value text,epoch_value bigint,focus_value bigint,citations_value jsonb DEFAULT '[]') RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v_row reception_sessions%ROWTYPE;v_id text:=gen_random_uuid()::text;
BEGIN
 SELECT * INTO v_row FROM reception_sessions WHERE id=target;
 IF v_row.id IS NULL OR NOT dg_native_reception_citations_valid(target,citations_value) THEN PERFORM dg_native_reception_error('SOURCE_UNAVAILABLE');END IF;
 INSERT INTO reception_messages(id,session_id,tenant_id,workspace_id,role,text,status,reply_epoch,focus_version,created_at,knowledge_citations,input_source) VALUES(v_id,target,v_row.tenant_id,v_row.workspace_id,role_value,text_value,status_value,epoch_value,focus_value,dg_utc_now(),citations_value::text,CASE WHEN role_value='visitor' THEN 'typed' ELSE 'system' END);
 INSERT INTO _dg_native_reception_message_digests VALUES(v_id,dg_native_office_hash(dg_native_reception_message_payload(v_id)));RETURN v_id;
END;$dg$;
CREATE FUNCTION dg_native_reception_spawn(terminal_value text,actor_value text,source_value text,track_hash_value text,inputs_value jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v_terminal reception_terminals%ROWTYPE;v_current reception_sessions%ROWTYPE;v_id text:=gen_random_uuid()::text;v_time text:=dg_utc_now();v_profile text;v_scene text;
BEGIN
 SELECT * INTO v_terminal FROM reception_terminals WHERE id=terminal_value;
 IF v_terminal.id IS NULL OR source_value NOT IN('manual','mock_presence') OR track_hash_value !~ '^[a-f0-9]{64}$' OR jsonb_typeof(inputs_value) IS DISTINCT FROM 'object' OR inputs_value-ARRAY['profile','scene','assets']<>'{}'::jsonb OR jsonb_typeof(inputs_value->'assets') IS DISTINCT FROM 'array' THEN PERFORM dg_native_reception_error('VALIDATION_FAILED');END IF;
 SELECT * INTO v_current FROM reception_sessions WHERE terminal_id=terminal_value AND status IN('active','human');
 IF v_current.id IS NOT NULL THEN
  IF inputs_value->'scene' IS NOT NULL AND inputs_value->'scene'<>'null'::jsonb AND v_current.scene_app_snapshot::jsonb IS DISTINCT FROM inputs_value->'scene' OR inputs_value->'profile' IS NOT NULL AND inputs_value->'profile'<>'null'::jsonb AND v_current.profile_snapshot::jsonb IS DISTINCT FROM inputs_value->'profile' THEN PERFORM dg_native_reception_error('STATE_CONFLICT');END IF;RETURN v_current.id;
 END IF;
 v_profile:=CASE WHEN inputs_value->'profile'='null'::jsonb THEN NULL ELSE(inputs_value->'profile')::text END;v_scene:=CASE WHEN inputs_value->'scene'='null'::jsonb THEN NULL ELSE(inputs_value->'scene')::text END;
 INSERT INTO reception_sessions(id,tenant_id,workspace_id,terminal_id,track_hash,source,environment,app_env,status,version,reply_epoch,focus_version,access_version,created_at,activity_at,expires_at,profile_snapshot,scene_app_snapshot,service_scene) VALUES(v_id,v_terminal.tenant_id,v_terminal.workspace_id,terminal_value,track_hash_value,source_value,'mock',(SELECT app_env FROM _dg_native_runtime_control WHERE id=1),'active',1,0,0,1,v_time,v_time,dg_native_people_iso(v_time::timestamptz+interval '900 seconds'),v_profile,v_scene,'reception');
 INSERT INTO _dg_native_reception_origins VALUES(v_id,terminal_value,v_terminal.tenant_id,v_terminal.workspace_id,actor_value,v_profile,v_scene,(inputs_value->'assets')::text,dg_native_office_hash(jsonb_build_object('profile',v_profile::jsonb,'scene',v_scene::jsonb,'assets',inputs_value->'assets')),dg_native_people_iso(v_time::timestamptz+interval '24 hours'),NULL,v_time);
 IF NOT dg_native_reception_source_valid(v_id) THEN PERFORM dg_native_reception_error('SOURCE_UNAVAILABLE');END IF;
 PERFORM dg_native_reception_add_message(v_id,'assistant',CASE WHEN v_scene IS NULL THEN '【模拟问候】您好，欢迎来访。您可以输入问题，也可以请求人工接待。' ELSE '【模拟问候】'||(v_scene::jsonb->>'welcomeText') END,'ready',0,0);
 UPDATE reception_terminals SET version=version+1 WHERE id=terminal_value;INSERT INTO outbox_events VALUES(gen_random_uuid()::text,v_terminal.tenant_id,v_terminal.workspace_id,v_id,'session.started','mock','{}',v_time,NULL);RETURN v_id;
END;$dg$;
CREATE FUNCTION dg_native_reception_create_session(terminal_value text,inputs_value jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v_terminal reception_terminals%ROWTYPE;v_member memberships%ROWTYPE;
BEGIN v_terminal:=dg_native_reception_terminal_lock(terminal_value,true);v_member:=dg_native_reception_admin(v_terminal.workspace_id);RETURN dg_native_reception_spawn(terminal_value,v_member.user_id,'manual',encode(sha256(convert_to(gen_random_uuid()::text,'UTF8')),'hex'),inputs_value);END;$dg$;
CREATE FUNCTION dg_native_reception_cancel(target text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN UPDATE reception_messages SET status='cancelled' WHERE session_id=target AND role='assistant' AND status IN('ready','playing');END;$dg$;
CREATE FUNCTION dg_native_reception_end(target text,reason_value text,expired_value boolean DEFAULT false,clear_value boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v_row reception_sessions%ROWTYPE;
BEGIN
 SELECT * INTO v_row FROM reception_sessions WHERE id=target FOR UPDATE;IF v_row.id IS NULL THEN RETURN;END IF;
 PERFORM dg_native_reception_cancel(target);
 IF clear_value THEN UPDATE _dg_native_reception_origins SET invalidated_at=coalesce(invalidated_at,dg_utc_now()) WHERE session_id=target;UPDATE reception_messages SET text='',knowledge_citations='[]',status='cancelled' WHERE session_id=target AND(text<>'' OR knowledge_citations<>'[]' OR status<>'cancelled');END IF;
 IF v_row.status IN('active','human') THEN UPDATE reception_sessions SET status=CASE WHEN expired_value THEN 'expired' ELSE 'ended' END,version=version+1,reply_epoch=reply_epoch+1,focus_version=focus_version+1,access_version=access_version+1,ended_reason=reason_value WHERE id=target;UPDATE reception_terminals SET version=version+1 WHERE id=v_row.terminal_id;INSERT INTO outbox_events VALUES(gen_random_uuid()::text,v_row.tenant_id,v_row.workspace_id,target,CASE WHEN expired_value THEN 'session.expired' ELSE 'session.ended' END,'mock','{}',dg_utc_now(),NULL);END IF;
END;$dg$;
CREATE FUNCTION dg_native_reception_control(target text,input jsonb,guest_value boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v_row reception_sessions%ROWTYPE;v_action text:=input->>'action';
BEGIN
 PERFORM dg_native_reception_fields(input,ARRAY['action','version','focusVersion']);SELECT * INTO v_row FROM reception_sessions WHERE id=target FOR UPDATE;
 IF v_row.status NOT IN('active','human') OR v_row.expires_at<=dg_utc_now() OR v_row.activity_at<=dg_native_people_iso(clock_timestamp()-interval '120 seconds') THEN PERFORM dg_native_reception_error('SESSION_ENDED');END IF;
 IF input->>'version' IS DISTINCT FROM v_row.version::text OR input->>'focusVersion' IS DISTINCT FROM v_row.focus_version::text THEN PERFORM dg_native_reception_error('VERSION_CONFLICT');END IF;
 IF v_action NOT IN('stop','handoff','resume','end') OR v_action IS NULL THEN PERFORM dg_native_reception_error('VALIDATION_FAILED');END IF;IF guest_value AND v_action='resume' THEN PERFORM dg_native_reception_error('FORBIDDEN');END IF;
 IF v_action='end' THEN PERFORM dg_native_reception_end(target,'manual_end');RETURN;END IF;
 IF v_action='resume' AND v_row.status<>'human' THEN PERFORM dg_native_reception_error('STATE_CONFLICT');END IF;
 PERFORM dg_native_reception_cancel(target);UPDATE reception_sessions SET status=CASE WHEN v_action='handoff' THEN 'human' WHEN v_action='resume' THEN 'active' ELSE status END,version=version+1,reply_epoch=reply_epoch+1,focus_version=focus_version+CASE WHEN v_action='stop' THEN 0 ELSE 1 END,activity_at=dg_utc_now() WHERE id=target;
 INSERT INTO outbox_events VALUES(gen_random_uuid()::text,v_row.tenant_id,v_row.workspace_id,target,'session.'||v_action,'mock','{}',dg_utc_now(),NULL);
END;$dg$;
CREATE FUNCTION dg_native_reception_admin_control(target text,input jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v_meta jsonb;
BEGIN v_meta:=dg_native_reception_meta(target,NULL);PERFORM dg_native_reception_terminal_lock(v_meta->>'terminalId',true);PERFORM dg_native_reception_control(target,input,false);RETURN target;END;$dg$;
CREATE FUNCTION dg_native_reception_venue_scope(target text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v_member memberships%ROWTYPE;v_ws text;
BEGIN v_member:=dg_native_reception_admin(NULL);SELECT workspace_id INTO v_ws FROM venues WHERE id=target AND tenant_id=v_member.tenant_id;IF v_ws IS NULL OR NOT(v_member.workspace_ids::jsonb ? v_ws) THEN PERFORM dg_native_reception_error('NOT_FOUND');END IF;RETURN v_ws;END;$dg$;
CREATE FUNCTION dg_native_reception_terminal_scope(target text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v_member memberships%ROWTYPE;v_guard _dg_native_reception_terminals%ROWTYPE;
BEGIN
 v_member:=dg_native_reception_admin(NULL);SELECT * INTO v_guard FROM _dg_native_reception_terminals WHERE terminal_id=target AND tenant_id=v_member.tenant_id AND app_env=(SELECT app_env FROM _dg_native_runtime_control WHERE id=1);
 IF v_guard.terminal_id IS NULL OR v_guard.invalidated_at IS NOT NULL OR NOT(v_member.workspace_ids::jsonb ? v_guard.workspace_id) THEN PERFORM dg_native_reception_error('NOT_FOUND');END IF;PERFORM user_id FROM dg_native_locked_membership(v_guard.actor_id);RETURN v_guard.workspace_id;
END;$dg$;
CREATE FUNCTION dg_native_reception_terminal_lock(target text,write_value boolean DEFAULT false) RETURNS reception_terminals LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v_row reception_terminals%ROWTYPE;v_ws text;
BEGIN
 v_ws:=dg_native_reception_terminal_scope(target);SELECT * INTO v_row FROM reception_terminals WHERE id=target;PERFORM dg_native_reception_workspace(v_row.tenant_id,v_ws,write_value);
 IF write_value THEN SELECT * INTO v_row FROM reception_terminals WHERE id=target FOR UPDATE;ELSE SELECT * INTO v_row FROM reception_terminals WHERE id=target FOR SHARE;END IF;RETURN v_row;
END;$dg$;
CREATE FUNCTION dg_native_reception_terminal_project(target text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT jsonb_build_object('id',t.id,'workspaceId',t.workspace_id,'venueId',t.venue_id,'name',t.name,'environment',t.environment,'version',t.version,'currentSessionId',(SELECT s.id FROM reception_sessions s WHERE s.terminal_id=t.id AND s.status IN('active','human')),'queued',(SELECT count(*) FROM reception_presence p WHERE p.terminal_id=t.id AND p.present=1 AND p.queue_at IS NOT NULL AND p.last_seen_at>dg_native_people_iso(clock_timestamp()-interval '30 seconds'))) FROM reception_terminals t WHERE t.id=target
$dg$;
CREATE FUNCTION dg_native_reception_terminal(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN PERFORM dg_native_reception_terminal_lock(target);RETURN dg_native_reception_terminal_project(target);END;$dg$;
CREATE FUNCTION dg_native_reception_terminals(workspaces_value text[],cursor_value text,limit_value integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v_member memberships%ROWTYPE;v_ws text;v_result jsonb;
BEGIN
 v_member:=dg_native_reception_admin(NULL);IF workspaces_value IS NULL OR cardinality(workspaces_value)>1000 OR cursor_value IS NULL OR limit_value NOT BETWEEN 1 AND 101 THEN PERFORM dg_native_reception_error('VALIDATION_FAILED');END IF;
 FOREACH v_ws IN ARRAY workspaces_value LOOP IF NOT(v_member.workspace_ids::jsonb ? v_ws) THEN PERFORM dg_native_reception_error('NOT_FOUND');END IF;END LOOP;
 SELECT coalesce(jsonb_agg(dg_native_reception_terminal_project(q.id) ORDER BY q.id),'[]') INTO v_result FROM(SELECT t.id FROM reception_terminals t JOIN _dg_native_reception_terminals g ON g.terminal_id=t.id WHERE t.tenant_id=v_member.tenant_id AND t.workspace_id=ANY(workspaces_value) AND g.app_env=(SELECT app_env FROM _dg_native_runtime_control WHERE id=1) AND g.invalidated_at IS NULL AND t.id>cursor_value AND NOT EXISTS(SELECT 1 FROM restaurant_terminals r WHERE r.terminal_id=t.id) ORDER BY t.id LIMIT limit_value) q;RETURN v_result;
END;$dg$;
CREATE FUNCTION dg_native_reception_create_terminal(venue_value text,name_value text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v_member memberships%ROWTYPE;v_ws text;v_id text:=gen_random_uuid()::text;v_time text:=dg_utc_now();
BEGIN
 v_ws:=dg_native_reception_venue_scope(venue_value);v_member:=dg_native_reception_admin(v_ws);PERFORM dg_native_reception_workspace(v_member.tenant_id,v_ws,true);
 IF name_value IS NULL OR char_length(btrim(name_value)) NOT BETWEEN 1 AND 60 THEN PERFORM dg_native_reception_error('VALIDATION_FAILED');END IF;
 IF(SELECT count(*) FROM reception_terminals t WHERE t.tenant_id=v_member.tenant_id AND t.workspace_id=v_ws)>=100 THEN PERFORM dg_native_reception_error('QUOTA_EXCEEDED');END IF;
 INSERT INTO reception_terminals VALUES(v_id,v_member.tenant_id,v_ws,venue_value,btrim(name_value),'mock',1,v_time);
 INSERT INTO _dg_native_reception_terminals VALUES(v_id,v_member.tenant_id,v_ws,v_member.user_id,(SELECT app_env FROM _dg_native_runtime_control WHERE id=1),NULL,v_time);
 INSERT INTO outbox_events VALUES(gen_random_uuid()::text,v_member.tenant_id,v_ws,v_id,'reception.terminal_created','mock','{}',v_time,NULL);RETURN v_id;
END;$dg$;
CREATE FUNCTION dg_native_reception_source_valid(target text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v_session reception_sessions%ROWTYPE;v_origin _dg_native_reception_origins%ROWTYPE;v_terminal _dg_native_reception_terminals%ROWTYPE;v_profile jsonb;v_scene jsonb;v_asset jsonb;v_app scene_apps%ROWTYPE;
BEGIN
 SELECT * INTO v_session FROM reception_sessions WHERE id=target;SELECT * INTO v_origin FROM _dg_native_reception_origins WHERE session_id=target;SELECT * INTO v_terminal FROM _dg_native_reception_terminals WHERE terminal_id=v_origin.terminal_id;
 IF v_session.id IS NULL OR v_origin.session_id IS NULL OR v_terminal.terminal_id IS NULL OR v_origin.invalidated_at IS NOT NULL OR v_terminal.invalidated_at IS NOT NULL OR v_session.environment<>'mock' OR v_session.app_env IS DISTINCT FROM(SELECT app_env FROM _dg_native_runtime_control WHERE id=1) OR v_origin.inputs_hash<>dg_native_office_hash(jsonb_build_object('profile',v_origin.profile::jsonb,'scene',v_origin.scene::jsonb,'assets',v_origin.assets::jsonb)) THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=v_origin.actor_id AND m.tenant_id=v_origin.tenant_id AND m.role='admin' AND m.workspace_ids::jsonb ? v_origin.workspace_id) OR NOT EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=v_terminal.actor_id AND m.tenant_id=v_terminal.tenant_id AND m.role='admin' AND m.workspace_ids::jsonb ? v_terminal.workspace_id) THEN RETURN false;END IF;
 v_profile:=v_origin.profile::jsonb;v_scene:=v_origin.scene::jsonb;
 IF v_profile IS NOT NULL AND v_profile<>'null'::jsonb THEN
  IF NOT EXISTS(SELECT 1 FROM profiles p JOIN profile_versions h ON h.profile_id=p.id WHERE p.id=v_profile->>'id' AND p.tenant_id=v_origin.tenant_id AND p.workspace_id=v_origin.workspace_id AND h.version=(v_profile->>'version')::bigint AND h.config::jsonb=v_profile AND v_profile->'scenes' ? 'reception') THEN RETURN false;END IF;
  IF jsonb_array_length(v_origin.assets::jsonb)<>(CASE WHEN v_profile->>'voiceAssetId' IS NULL THEN 1 ELSE 2 END) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_origin.assets::jsonb) x WHERE x->>'id'=v_profile->>'avatarAssetId') OR v_profile->>'voiceAssetId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_origin.assets::jsonb) x WHERE x->>'id'=v_profile->>'voiceAssetId') THEN RETURN false;END IF;
 ELSE IF jsonb_array_length(v_origin.assets::jsonb)<>0 OR v_scene IS NOT NULL AND v_scene<>'null'::jsonb THEN RETURN false;END IF;END IF;
 FOR v_asset IN SELECT value FROM jsonb_array_elements(v_origin.assets::jsonb) LOOP
  IF NOT EXISTS(SELECT 1 FROM assets a JOIN uploads u ON u.id=a.upload_id AND u.tenant_id=a.tenant_id AND u.workspace_id=a.workspace_id JOIN _dg_native_asset_origins o ON o.asset_id=a.id AND o.upload_id=u.id AND o.sha256=u.sha256 AND o.size=u.size WHERE a.id=v_asset->>'id' AND a.tenant_id=v_origin.tenant_id AND a.workspace_id=v_origin.workspace_id AND o.tenant_id=a.tenant_id AND o.workspace_id=a.workspace_id AND o.environment='mock' AND o.app_env=v_session.app_env AND a.version=(v_asset->>'version')::bigint AND a.archived=0 AND(a.expires_at IS NULL OR a.expires_at>dg_utc_now()) AND u.sha256=v_asset->>'sha256' AND u.size=(v_asset->>'size')::bigint AND u.storage_key=v_asset->>'storageKey') THEN RETURN false;END IF;
 END LOOP;
 IF v_scene IS NOT NULL AND v_scene<>'null'::jsonb THEN
  SELECT * INTO v_app FROM scene_apps WHERE id=v_scene->>'id' AND tenant_id=v_origin.tenant_id AND workspace_id=v_origin.workspace_id AND environment='mock' AND app_env=v_session.app_env;
  IF v_app.id IS NULL OR v_app.enabled<>1 OR v_app.scene<>'reception' OR v_app.config::jsonb->>'audience'<>'public' OR(v_app.config::jsonb||jsonb_build_object('id',v_app.id,'workspaceId',v_app.workspace_id,'version',v_app.version,'enabled',v_app.enabled=1,'createdAt',v_app.created_at)) IS DISTINCT FROM v_scene OR v_scene->'profile' IS DISTINCT FROM v_profile THEN RETURN false;END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(v_scene->'collectionIds') selected(id) LEFT JOIN knowledge_collections c ON c.id=selected.id WHERE c.id IS NULL OR c.tenant_id<>v_origin.tenant_id OR c.workspace_id<>v_origin.workspace_id OR c.audience<>'public' OR NOT(c.scenes::jsonb ? 'reception') OR c.environment<>'mock' OR c.app_env<>v_session.app_env) THEN RETURN false;END IF;
 END IF;RETURN true;
EXCEPTION WHEN data_exception THEN RETURN false;
END;$dg$;
CREATE FUNCTION dg_native_reception_meta(target text,token_hash_value text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v_session reception_sessions%ROWTYPE;v_origin _dg_native_reception_origins%ROWTYPE;v_access _dg_native_reception_access%ROWTYPE;v_member memberships%ROWTYPE;
BEGIN
 PERFORM dg_native_reception_runtime();SELECT * INTO v_session FROM reception_sessions WHERE id=target;SELECT * INTO v_origin FROM _dg_native_reception_origins WHERE session_id=target;
 IF token_hash_value IS NULL THEN v_member:=dg_native_reception_admin(NULL);IF v_session.id IS NULL OR v_session.tenant_id<>v_member.tenant_id OR NOT(v_member.workspace_ids::jsonb ? v_session.workspace_id) THEN PERFORM dg_native_reception_error('NOT_FOUND');END IF;PERFORM dg_native_reception_terminal_scope(v_session.terminal_id);
 ELSE
  SELECT * INTO v_access FROM _dg_native_reception_access WHERE session_id=target AND token_hash=token_hash_value AND access_version=v_session.access_version AND expires_at>dg_utc_now();
  IF v_access.id IS NULL OR v_origin.session_id IS NULL OR v_session.status NOT IN('active','human') OR v_session.expires_at<=dg_utc_now() OR v_session.activity_at<=dg_native_people_iso(clock_timestamp()-interval '120 seconds') OR NOT dg_native_reception_source_valid(target) THEN PERFORM dg_native_reception_error('AUTH_REQUIRED');END IF;
 END IF;
 IF v_origin.session_id IS NULL THEN PERFORM dg_native_reception_error('NOT_FOUND');END IF;
 IF v_session.status IN('active','human') THEN PERFORM user_id FROM dg_native_locked_membership(v_origin.actor_id);PERFORM user_id FROM dg_native_locked_membership((SELECT actor_id FROM _dg_native_reception_terminals WHERE terminal_id=v_origin.terminal_id));END IF;
 RETURN jsonb_build_object('id',v_session.id,'tenantId',v_session.tenant_id,'workspaceId',v_session.workspace_id,'terminalId',v_session.terminal_id,'actorId',v_origin.actor_id,'status',v_session.status,'version',v_session.version,'focusVersion',v_session.focus_version,'replyEpoch',v_session.reply_epoch,'accessVersion',v_session.access_version,'expiresAt',v_session.expires_at,'profile',v_origin.profile::jsonb,'scene',v_origin.scene::jsonb,'assets',v_origin.assets::jsonb);
END;$dg$;
CREATE FUNCTION dg_native_reception_authorize(target text,token_hash_value text,csrf_hash_value text,write_value boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v_meta jsonb;v_session reception_sessions%ROWTYPE;v_access _dg_native_reception_access%ROWTYPE;v_terminal _dg_native_reception_terminals%ROWTYPE;
BEGIN
 v_meta:=dg_native_reception_meta(target,token_hash_value);SELECT * INTO v_terminal FROM _dg_native_reception_terminals WHERE terminal_id=v_meta->>'terminalId';PERFORM user_id FROM dg_native_locked_membership(v_meta->>'actorId');PERFORM user_id FROM dg_native_locked_membership(v_terminal.actor_id);PERFORM dg_native_reception_workspace(v_meta->>'tenantId',v_meta->>'workspaceId');
 IF write_value THEN PERFORM id FROM reception_terminals WHERE id=v_meta->>'terminalId' FOR UPDATE;SELECT * INTO v_session FROM reception_sessions WHERE id=target FOR UPDATE;
 ELSE PERFORM id FROM reception_terminals WHERE id=v_meta->>'terminalId' FOR SHARE;SELECT * INTO v_session FROM reception_sessions WHERE id=target FOR SHARE;END IF;
 PERFORM dg_native_reception_meta(target,token_hash_value);SELECT * INTO v_access FROM _dg_native_reception_access WHERE session_id=target AND token_hash=token_hash_value AND access_version=v_session.access_version;
 IF write_value AND(csrf_hash_value IS NULL OR v_access.csrf_hash IS DISTINCT FROM csrf_hash_value) THEN PERFORM dg_native_reception_error('FORBIDDEN');END IF;
END;$dg$;

DO $dg$ DECLARE r record;BEGIN FOR r IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND p.proname LIKE 'dg_native_reception_%' LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||r.signature||' FROM PUBLIC';END LOOP;END;$dg$;
