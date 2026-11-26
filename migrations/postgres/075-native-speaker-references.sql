-- R-129/R-132/R-133: explicit synthetic enrolled references and single-use grants.
-- No actual recording, biometric vector or clone asset is accepted by these APIs.
CREATE TABLE _dg_native_speaker_reference_revocations(
 reference_id text PRIMARY KEY REFERENCES speaker_references(id),reason text NOT NULL,created_at text NOT NULL
);
CREATE TABLE _dg_native_speaker_ticket_origins(
 ticket_id text PRIMARY KEY REFERENCES speaker_use_tickets(id),reference_id text NOT NULL REFERENCES speaker_references(id),
 reference_version bigint NOT NULL,provider_id text NOT NULL,tenant_id text NOT NULL,workspace_id text NOT NULL,
 owner_user_id text NOT NULL,session_id text NOT NULL REFERENCES reception_sessions(id),focus_version bigint NOT NULL,
 expires_at text NOT NULL,created_at text NOT NULL,transaction_id text NOT NULL
);
CREATE TABLE _dg_native_speaker_ticket_signatures(
 ticket_id text PRIMARY KEY REFERENCES _dg_native_speaker_ticket_origins(ticket_id),
 token_hash text NOT NULL CHECK(token_hash ~ '^[a-f0-9]{64}$'),created_at text NOT NULL
);
CREATE TABLE _dg_native_speaker_enrolled_uses(
 session_id text NOT NULL,focus_version bigint NOT NULL,ticket_id text NOT NULL REFERENCES _dg_native_speaker_ticket_origins(ticket_id),
 reference_id text NOT NULL REFERENCES speaker_references(id),reference_version bigint NOT NULL,created_at text NOT NULL,
 PRIMARY KEY(session_id,focus_version),FOREIGN KEY(session_id,focus_version) REFERENCES _dg_native_speaker_focus_origins(session_id,focus_version) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE _dg_native_speaker_use_attempts(
 session_id text NOT NULL REFERENCES reception_sessions(id),key_hash text NOT NULL CHECK(key_hash ~ '^[a-f0-9]{64}$'),
 body_hash text NOT NULL CHECK(body_hash ~ '^[a-f0-9]{64}$'),token_hash text NOT NULL CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 focus_version bigint NOT NULL,created_at text NOT NULL,PRIMARY KEY(session_id,key_hash)
);
CREATE INDEX native_speaker_use_attempt_window ON _dg_native_speaker_use_attempts(session_id,created_at);
CREATE TRIGGER native_speaker_reference_revocation_immutable BEFORE UPDATE OR DELETE ON _dg_native_speaker_reference_revocations FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_speaker_ticket_origin_immutable BEFORE UPDATE OR DELETE ON _dg_native_speaker_ticket_origins FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_speaker_ticket_signature_immutable BEFORE UPDATE OR DELETE ON _dg_native_speaker_ticket_signatures FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_speaker_enrolled_use_immutable BEFORE UPDATE OR DELETE ON _dg_native_speaker_enrolled_uses FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_speaker_use_attempt_immutable BEFORE UPDATE OR DELETE ON _dg_native_speaker_use_attempts FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();

CREATE FUNCTION dg_native_speaker_reference_valid(target text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT EXISTS(SELECT 1 FROM speaker_references r JOIN _dg_native_speaker_reference_origins o ON o.reference_id=r.id
 JOIN memberships m ON m.user_id=r.owner_user_id AND m.tenant_id=r.tenant_id
 WHERE r.id=target AND r.scope='enrolled' AND r.status='active' AND r.quality='adequate' AND r.expires_at>dg_utc_now()
 AND r.environment='mock' AND r.app_env=(SELECT app_env FROM _dg_native_runtime_control WHERE id=1)
 AND m.workspace_ids::jsonb ? r.workspace_id AND o.owner_user_id=r.owner_user_id AND o.tenant_id=r.tenant_id AND o.workspace_id=r.workspace_id
 AND o.scope=r.scope AND o.provider_id=r.provider_id AND o.expires_at=r.expires_at AND o.consent_at=r.consent_at
 AND NOT EXISTS(SELECT 1 FROM _dg_native_speaker_reference_revocations WHERE reference_id=r.id))
$dg$;
CREATE FUNCTION dg_native_speaker_reference_member_ids(target text,session_value text) RETURNS TABLE(user_id text) LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 WITH sessions AS(SELECT session_value id WHERE session_value IS NOT NULL UNION SELECT f.session_id FROM speaker_focus_sessions f WHERE f.reference_id=target AND f.state NOT IN('idle','ended','handoff_pending'))
 SELECT owner_user_id FROM speaker_references WHERE id=target AND owner_user_id IS NOT NULL
 UNION SELECT o.actor_id FROM _dg_native_reception_origins o JOIN sessions s ON s.id=o.session_id
 UNION SELECT t.actor_id FROM _dg_native_reception_terminals t JOIN _dg_native_reception_origins o ON o.terminal_id=t.terminal_id JOIN sessions s ON s.id=o.session_id
 UNION SELECT d.recipient_id FROM visits v JOIN sessions s ON s.id=v.session_id JOIN LATERAL(SELECT recipient_id FROM _dg_native_visit_drafts WHERE visit_id=v.id ORDER BY version DESC LIMIT 1) d ON true WHERE d.recipient_id IS NOT NULL
$dg$;
CREATE FUNCTION dg_native_speaker_reference_prepare(target text,workspace_value text,session_value text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE m memberships%ROWTYPE;r speaker_references%ROWTYPE;member_value text;locked_ids text[];needed_ids text[];s reception_sessions%ROWTYPE;
BEGIN
 PERFORM dg_native_reception_runtime();SELECT * INTO m FROM dg_native_locked_membership(current_setting('digitalguide.actor_id',true));IF m.user_id IS NULL THEN PERFORM dg_native_speaker_error('FORBIDDEN');END IF;
 IF target IS NOT NULL THEN SELECT q.* INTO r FROM speaker_references q JOIN _dg_native_speaker_reference_origins o ON o.reference_id=q.id WHERE q.id=target AND q.scope='enrolled' AND q.owner_user_id=m.user_id AND q.tenant_id=m.tenant_id AND q.app_env=(SELECT app_env FROM _dg_native_runtime_control WHERE id=1);IF r.id IS NULL THEN PERFORM dg_native_speaker_error('NOT_FOUND');END IF;workspace_value:=r.workspace_id;END IF;
 IF workspace_value IS NULL OR NOT(m.workspace_ids::jsonb ? workspace_value) OR NOT EXISTS(SELECT 1 FROM workspaces WHERE id=workspace_value AND tenant_id=m.tenant_id) THEN PERFORM dg_native_speaker_error('NOT_FOUND');END IF;
 IF session_value IS NOT NULL THEN SELECT * INTO s FROM reception_sessions WHERE id=session_value AND tenant_id=m.tenant_id AND workspace_id=workspace_value;IF s.id IS NULL THEN PERFORM dg_native_speaker_error('STATE_CONFLICT');END IF;END IF;
 SELECT array_agg(q.user_id ORDER BY q.user_id) INTO locked_ids FROM(SELECT m.user_id user_id UNION SELECT user_id FROM dg_native_speaker_reference_member_ids(target,session_value)) q;
 FOREACH member_value IN ARRAY locked_ids LOOP PERFORM user_id FROM dg_native_locked_membership(member_value);END LOOP;
 IF target IS NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('native-speaker-owner:'||m.user_id,0));ELSE PERFORM pg_advisory_xact_lock(hashtextextended('native-speaker-reference:'||target,0));END IF;
 SELECT array_agg(user_id ORDER BY user_id) INTO needed_ids FROM dg_native_speaker_reference_member_ids(target,session_value);IF NOT coalesce(needed_ids,ARRAY[]::text[]) <@ coalesce(locked_ids,ARRAY[]::text[]) THEN PERFORM dg_native_speaker_error('VERSION_CONFLICT');END IF;
 RETURN jsonb_build_object('workspaceId',workspace_value,'referenceId',r.id,'sessionId',s.id,'sessionVersion',s.version,'sessionFocus',s.focus_version,'actorId',m.user_id);
END;$dg$;
CREATE FUNCTION dg_native_speaker_reference_row(target text) RETURNS speaker_references LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE r speaker_references%ROWTYPE;m memberships%ROWTYPE;
BEGIN
 PERFORM dg_native_reception_runtime();SELECT * INTO m FROM dg_native_locked_membership(current_setting('digitalguide.actor_id',true));
 SELECT q.* INTO r FROM speaker_references q JOIN _dg_native_speaker_reference_origins o ON o.reference_id=q.id WHERE q.id=target AND q.scope='enrolled' AND q.owner_user_id=m.user_id AND q.tenant_id=m.tenant_id AND q.environment='mock' AND q.app_env=(SELECT app_env FROM _dg_native_runtime_control WHERE id=1) AND m.workspace_ids::jsonb ? q.workspace_id;
 IF r.id IS NULL THEN PERFORM dg_native_speaker_error('NOT_FOUND');END IF;RETURN r;
END;$dg$;
CREATE FUNCTION dg_native_speaker_reference_view(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE r speaker_references%ROWTYPE;
BEGIN r:=dg_native_speaker_reference_row(target);RETURN jsonb_build_object('id',r.id,'workspaceId',r.workspace_id,'label',r.label,'scope',r.scope,'quality',r.quality,'status',r.status,'version',r.version,'provider',r.provider_id,'expiresAt',r.expires_at,'deleteStatus',r.delete_status,'createdAt',r.created_at);END;$dg$;
CREATE FUNCTION dg_native_speaker_reference_list(workspace_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE m memberships%ROWTYPE;r record;result jsonb:='[]'::jsonb;
BEGIN
 PERFORM dg_native_reception_runtime();SELECT * INTO m FROM dg_native_locked_membership(current_setting('digitalguide.actor_id',true));IF m.user_id IS NULL OR NOT(m.workspace_ids::jsonb ? workspace_value) THEN PERFORM dg_native_speaker_error('NOT_FOUND');END IF;
 FOR r IN SELECT q.id FROM speaker_references q JOIN _dg_native_speaker_reference_origins o ON o.reference_id=q.id WHERE q.owner_user_id=m.user_id AND q.tenant_id=m.tenant_id AND q.workspace_id=workspace_value AND q.scope='enrolled' AND q.app_env=(SELECT app_env FROM _dg_native_runtime_control WHERE id=1) ORDER BY q.created_at DESC,q.id DESC LIMIT 100 LOOP result:=result||jsonb_build_array(dg_native_speaker_reference_view(r.id));END LOOP;RETURN result;
END;$dg$;
CREATE FUNCTION dg_native_speaker_reference_revoke(target text,reason_value text,expired_value boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE r speaker_references%ROWTYPE;candidate record;s reception_sessions%ROWTYPE;f speaker_focus_sessions%ROWTYPE;action_value text;before_focus bigint;before_version bigint;operation_value text;
BEGIN
 SELECT q.* INTO r FROM speaker_references q JOIN _dg_native_speaker_reference_origins o ON o.reference_id=q.id WHERE q.id=target AND q.scope='enrolled';IF r.id IS NULL THEN RETURN;END IF;
 INSERT INTO _dg_native_speaker_reference_revocations VALUES(target,reason_value,dg_utc_now()) ON CONFLICT DO NOTHING;
 operation_value:=CASE WHEN expired_value THEN 'reference_expired' ELSE 'reference_withdrawn' END;
 FOR candidate IN SELECT s0.id,s0.terminal_id FROM reception_sessions s0 JOIN speaker_focus_sessions f0 ON f0.session_id=s0.id WHERE f0.reference_id=target AND f0.state NOT IN('idle','ended','handoff_pending') ORDER BY s0.terminal_id,s0.id LOOP
  PERFORM dg_native_reception_workspace(r.tenant_id,r.workspace_id,true);PERFORM id FROM reception_terminals WHERE id=candidate.terminal_id FOR UPDATE;SELECT * INTO s FROM reception_sessions WHERE id=candidate.id FOR UPDATE;SELECT * INTO f FROM speaker_focus_sessions WHERE session_id=s.id;
  IF f.reference_id IS DISTINCT FROM target OR f.state IN('idle','ended','handoff_pending') THEN CONTINUE;END IF;
  IF s.status='active' AND s.focus_version=f.focus_version AND s.expires_at>dg_utc_now() AND s.activity_at>dg_native_people_iso(clock_timestamp()-interval '120 seconds') AND dg_native_reception_source_valid(s.id) THEN
   action_value:=gen_random_uuid()::text;before_focus:=s.focus_version;before_version:=s.version;s:=dg_native_speaker_advance(s.id,operation_value,action_value,false);INSERT INTO _dg_native_speaker_actions VALUES(action_value,s.id,repeat('0',64),operation_value,before_version,before_focus,s.focus_version,dg_utc_now(),pg_current_xact_id()::text);
  ELSIF s.status='active' THEN PERFORM dg_native_reception_end(s.id,'speaker_source_expired',true);END IF;
  PERFORM dg_native_speaker_end(s.id,operation_value);
 END LOOP;
 PERFORM dg_native_speaker_erase_reference(target,expired_value);
END;$dg$;
CREATE FUNCTION dg_native_speaker_reference_apply(target text,action_value text,input jsonb,hint jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE m memberships%ROWTYPE;r speaker_references%ROWTYPE;s reception_sessions%ROWTYPE;meta jsonb;id_value text:=gen_random_uuid()::text;now_value text:=dg_utc_now();expires_value text;days_value bigint;
BEGIN
 meta:=dg_native_speaker_reference_prepare(target,coalesce(input->>'workspaceId',hint->>'workspaceId'),CASE WHEN action_value='authorize-use' THEN input->>'sessionId' END);IF meta IS DISTINCT FROM hint THEN PERFORM dg_native_speaker_error('VERSION_CONFLICT');END IF;
 SELECT * INTO m FROM dg_native_locked_membership(meta->>'actorId');PERFORM dg_native_reception_workspace(m.tenant_id,meta->>'workspaceId',true);
 IF action_value='enroll' THEN
  PERFORM dg_native_reception_fields(input,ARRAY['workspaceId','label','purpose','consent','noticeVersion','retentionDays','fixture','provider','source']);
  IF input->'consent' IS DISTINCT FROM 'true'::jsonb OR input->>'purpose' IS DISTINCT FROM 'speaker_focus' OR input->>'noticeVersion' IS DISTINCT FROM 'speaker-v1' OR input->>'source' IS DISTINCT FROM 'synthetic_fixture' OR input->>'provider' IS NULL OR input->>'provider' NOT IN('mock-focus-final','mock-focus-early') OR char_length(btrim(coalesce(input->>'label',''))) NOT BETWEEN 1 AND 80 OR jsonb_typeof(input->'retentionDays') IS DISTINCT FROM 'number' OR input->>'retentionDays' !~ '^[0-9]+$' THEN PERFORM dg_native_speaker_error('VALIDATION_FAILED');END IF;
  days_value:=(input->>'retentionDays')::bigint;IF days_value NOT BETWEEN 1 AND 30 THEN PERFORM dg_native_speaker_error('VALIDATION_FAILED');END IF;
  IF input->>'fixture' IS NULL OR input->>'fixture' NOT IN('clear','replay_match') THEN PERFORM dg_native_speaker_error('REFERENCE_QUALITY_INSUFFICIENT');END IF;
  IF(SELECT count(*) FROM speaker_references q JOIN _dg_native_speaker_reference_origins o ON o.reference_id=q.id WHERE q.owner_user_id=m.user_id AND q.tenant_id=m.tenant_id AND q.scope='enrolled' AND q.status IN('active','pending') AND q.expires_at>now_value)>=10 THEN PERFORM dg_native_speaker_error('QUOTA_EXCEEDED');END IF;
  INSERT INTO speaker_references(id,tenant_id,workspace_id,owner_user_id,scope,label,provider_id,provider_reference,target_token,quality,status,purpose,notice_version,consent_at,expires_at,created_at,environment,app_env) VALUES(id_value,m.tenant_id,meta->>'workspaceId',m.user_id,'enrolled',btrim(input->>'label'),input->>'provider','mock-reference:'||gen_random_uuid()::text,'mock-target:'||gen_random_uuid()::text,'adequate','active','speaker_focus','speaker-v1',now_value,dg_native_people_iso(now_value::timestamptz+make_interval(days=>days_value::integer)),now_value,'mock',(SELECT app_env FROM _dg_native_runtime_control WHERE id=1));
 ELSIF action_value='authorize-use' THEN
  PERFORM dg_native_reception_fields(input,ARRAY['referenceVersion','sessionId','focusVersion','confirmed']);r:=dg_native_speaker_reference_row(target);
  IF jsonb_typeof(input->'referenceVersion') IS DISTINCT FROM 'number' OR input->>'referenceVersion' !~ '^[1-9][0-9]*$' OR input ? 'focusVersion' AND(jsonb_typeof(input->'focusVersion') IS DISTINCT FROM 'number' OR input->>'focusVersion' !~ '^[0-9]+$') OR input->'confirmed' IS DISTINCT FROM 'true'::jsonb OR input->>'referenceVersion' IS DISTINCT FROM r.version::text OR NOT dg_native_speaker_reference_valid(target) THEN PERFORM dg_native_speaker_error('STATE_CONFLICT');END IF;
  IF(SELECT count(*) FROM speaker_use_tickets WHERE reference_id=target AND created_at>=dg_native_people_iso(clock_timestamp()-interval '60 seconds'))>=12 THEN PERFORM dg_native_speaker_error('RATE_LIMITED');END IF;
  PERFORM id FROM reception_terminals WHERE id=(SELECT terminal_id FROM reception_sessions WHERE id=input->>'sessionId') FOR UPDATE;SELECT * INTO s FROM reception_sessions WHERE id=input->>'sessionId' FOR UPDATE;
  IF s.id IS NULL OR s.tenant_id<>r.tenant_id OR s.workspace_id<>r.workspace_id OR s.status<>'active' OR s.environment<>'mock' OR s.app_env<>r.app_env OR s.expires_at<=dg_utc_now() OR s.activity_at<=dg_native_people_iso(clock_timestamp()-interval '120 seconds') OR NOT dg_native_reception_source_valid(s.id) OR input ? 'focusVersion' AND input->>'focusVersion' IS DISTINCT FROM s.focus_version::text THEN PERFORM dg_native_speaker_error('STATE_CONFLICT');END IF;
  IF s.scene_app_snapshot::jsonb->>'speakerProvider' IS DISTINCT FROM r.provider_id OR s.scene_app_snapshot::jsonb->>'targetSpeechProvider' IS DISTINCT FROM 'mock-target-speech' THEN PERFORM dg_native_speaker_error('SCOPE_CONFLICT');END IF;
  expires_value:=least(r.expires_at,s.expires_at,dg_native_people_iso(clock_timestamp()+interval '60 seconds'));
  INSERT INTO speaker_use_tickets(id,reference_id,session_id,focus_version,token_hash,expires_at,created_at) VALUES(id_value,r.id,s.id,s.focus_version,'',expires_value,now_value);
  INSERT INTO _dg_native_speaker_ticket_origins VALUES(id_value,r.id,r.version,r.provider_id,r.tenant_id,r.workspace_id,m.user_id,s.id,s.focus_version,expires_value,now_value,pg_current_xact_id()::text);
 ELSIF action_value='delete' THEN
  PERFORM dg_native_reception_fields(input,ARRAY['version','confirmed']);r:=dg_native_speaker_reference_row(target);IF jsonb_typeof(input->'version') IS DISTINCT FROM 'number' OR input->'confirmed' IS DISTINCT FROM 'true'::jsonb OR input->>'version' IS DISTINCT FROM r.version::text THEN PERFORM dg_native_speaker_error('VERSION_CONFLICT');END IF;
  PERFORM dg_native_speaker_reference_revoke(target,'owner_request');id_value:=target;
 ELSE PERFORM dg_native_speaker_error('VALIDATION_FAILED');END IF;
 RETURN id_value;
END;$dg$;

CREATE FUNCTION dg_native_speaker_ticket_descriptor(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE t speaker_use_tickets%ROWTYPE;o _dg_native_speaker_ticket_origins%ROWTYPE;r speaker_references%ROWTYPE;s reception_sessions%ROWTYPE;
BEGIN
 SELECT * INTO t FROM speaker_use_tickets WHERE id=target;SELECT * INTO o FROM _dg_native_speaker_ticket_origins WHERE ticket_id=target;r:=dg_native_speaker_reference_row(o.reference_id);SELECT * INTO s FROM reception_sessions WHERE id=t.session_id;
 IF t.id IS NULL OR o.ticket_id IS NULL OR o.owner_user_id IS DISTINCT FROM current_setting('digitalguide.actor_id',true) OR t.used_at IS NOT NULL OR t.revoked_at IS NOT NULL OR t.expires_at<=dg_utc_now() OR NOT dg_native_speaker_reference_valid(r.id) OR r.version<>o.reference_version OR s.status<>'active' OR s.focus_version<>t.focus_version OR s.expires_at<=dg_utc_now() OR s.activity_at<=dg_native_people_iso(clock_timestamp()-interval '120 seconds') OR NOT dg_native_reception_source_valid(s.id) THEN PERFORM dg_native_speaker_error('STATE_CONFLICT');END IF;
 RETURN jsonb_build_object('id',t.id,'referenceId',r.id,'referenceVersion',o.reference_version,'provider',o.provider_id,'tenantId',o.tenant_id,'workspaceId',o.workspace_id,'ownerId',o.owner_user_id,'sessionId',t.session_id,'focusVersion',t.focus_version,'expiresAt',t.expires_at);
END;$dg$;
CREATE FUNCTION dg_native_speaker_ticket_bind(target text,token_digest text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE o _dg_native_speaker_ticket_origins%ROWTYPE;
BEGIN
 PERFORM dg_native_speaker_ticket_descriptor(target);SELECT * INTO o FROM _dg_native_speaker_ticket_origins WHERE ticket_id=target;
 IF token_digest !~ '^[a-f0-9]{64}$' OR o.transaction_id<>pg_current_xact_id()::text OR EXISTS(SELECT 1 FROM _dg_native_speaker_ticket_signatures WHERE ticket_id=target) THEN PERFORM dg_native_speaker_error('STATE_CONFLICT');END IF;
 INSERT INTO _dg_native_speaker_ticket_signatures VALUES(target,token_digest,dg_utc_now());UPDATE speaker_use_tickets SET token_hash=token_digest WHERE id=target;
END;$dg$;
CREATE FUNCTION dg_native_speaker_ticket_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE o _dg_native_speaker_ticket_origins%ROWTYPE;sig _dg_native_speaker_ticket_signatures%ROWTYPE;
BEGIN
 SELECT * INTO o FROM _dg_native_speaker_ticket_origins WHERE ticket_id=OLD.id;IF o.ticket_id IS NULL THEN RETURN NEW;END IF;SELECT * INTO sig FROM _dg_native_speaker_ticket_signatures WHERE ticket_id=OLD.id;
 IF to_jsonb(NEW)-ARRAY['token_hash','used_at','revoked_at'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['token_hash','used_at','revoked_at'] OR OLD.used_at IS NOT NULL AND NEW.used_at IS DISTINCT FROM OLD.used_at OR OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Ticket source, original expiry and terminal consumption are immutable';END IF;
 IF NEW.token_hash<>'' AND(NEW.used_at IS NOT NULL OR NEW.revoked_at IS NOT NULL OR NEW.token_hash IS DISTINCT FROM sig.token_hash OR OLD.token_hash='' AND o.transaction_id<>pg_current_xact_id()::text) OR NEW.token_hash='' AND NEW.used_at IS NULL AND NEW.revoked_at IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='A consumed or revoked ticket cannot be rebound';END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_speaker_ticket_guard BEFORE UPDATE ON speaker_use_tickets FOR EACH ROW EXECUTE FUNCTION dg_native_speaker_ticket_guard();
CREATE FUNCTION dg_native_speaker_ticket_final() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE target text;o _dg_native_speaker_ticket_origins%ROWTYPE;t speaker_use_tickets%ROWTYPE;sig _dg_native_speaker_ticket_signatures%ROWTYPE;
BEGIN
 target:=CASE WHEN TG_TABLE_NAME='speaker_use_tickets' THEN NEW.id ELSE NEW.ticket_id END;SELECT * INTO o FROM _dg_native_speaker_ticket_origins WHERE ticket_id=target;IF o.ticket_id IS NULL THEN RETURN NULL;END IF;SELECT * INTO t FROM speaker_use_tickets WHERE id=target;SELECT * INTO sig FROM _dg_native_speaker_ticket_signatures WHERE ticket_id=target;
 IF t.id IS NULL OR sig.ticket_id IS NULL OR t.reference_id<>o.reference_id OR t.session_id<>o.session_id OR t.focus_version<>o.focus_version OR t.expires_at<>o.expires_at OR t.created_at<>o.created_at OR t.used_at IS NULL AND t.revoked_at IS NULL AND t.token_hash IS DISTINCT FROM sig.token_hash OR(t.used_at IS NOT NULL OR t.revoked_at IS NOT NULL) AND t.token_hash<>'' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Single-use ticket must retain its original signed descriptor';END IF;RETURN NULL;
END;$dg$;
CREATE CONSTRAINT TRIGGER native_speaker_ticket_final AFTER INSERT OR UPDATE ON speaker_use_tickets DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_speaker_ticket_final();
CREATE CONSTRAINT TRIGGER native_speaker_ticket_origin_final AFTER INSERT ON _dg_native_speaker_ticket_origins DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_speaker_ticket_final();
CREATE CONSTRAINT TRIGGER native_speaker_ticket_signature_final AFTER INSERT ON _dg_native_speaker_ticket_signatures DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_speaker_ticket_final();

CREATE FUNCTION dg_native_speaker_prelock(target text,token_hash_value text,ticket_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;candidate record;v visits%ROWTYPE;d _dg_native_visit_drafts%ROWTYPE;f speaker_focus_sessions%ROWTYPE;new_reference text;original_reference text;locked_ids text[];needed_ids text[];
BEGIN
 PERFORM dg_native_reception_runtime();meta:=dg_native_reception_meta(target,token_hash_value);
 IF token_hash_value IS NULL THEN PERFORM dg_native_reception_admin(meta->>'workspaceId');END IF;
 SELECT * INTO v FROM visits WHERE session_id=target;d:=dg_native_visit_draft(v.id);SELECT * INTO f FROM speaker_focus_sessions WHERE session_id=target;original_reference:=f.reference_id;
 SELECT o.reference_id INTO new_reference FROM _dg_native_speaker_ticket_origins o JOIN speaker_use_tickets t ON t.id=o.ticket_id WHERE o.ticket_id=ticket_value AND o.session_id=target AND o.tenant_id=meta->>'tenantId' AND o.workspace_id=meta->>'workspaceId';
 SELECT array_agg(user_id ORDER BY user_id) INTO locked_ids FROM(SELECT meta->>'actorId' user_id UNION SELECT actor_id FROM _dg_native_reception_terminals WHERE terminal_id=meta->>'terminalId' UNION SELECT d.recipient_id UNION SELECT owner_user_id FROM speaker_references WHERE id IN(f.reference_id,new_reference)) q WHERE user_id IS NOT NULL;
 FOR candidate IN SELECT unnest(locked_ids) user_id LOOP PERFORM user_id FROM dg_native_locked_membership(candidate.user_id);END LOOP;
 FOR candidate IN SELECT id FROM speaker_references WHERE id IN(f.reference_id,new_reference) AND scope='enrolled' ORDER BY id LOOP PERFORM pg_advisory_xact_lock(hashtextextended('native-speaker-reference:'||candidate.id,0));END LOOP;
 -- Recheck after waiting: the current reference or recipient may have changed.
 SELECT * INTO v FROM visits WHERE session_id=target;d:=dg_native_visit_draft(v.id);SELECT * INTO f FROM speaker_focus_sessions WHERE session_id=target;
 SELECT array_agg(user_id ORDER BY user_id) INTO needed_ids FROM(SELECT d.recipient_id user_id UNION SELECT owner_user_id FROM speaker_references WHERE id=f.reference_id) q WHERE user_id IS NOT NULL;
 IF f.reference_id IS DISTINCT FROM original_reference OR NOT coalesce(needed_ids,ARRAY[]::text[]) <@ coalesce(locked_ids,ARRAY[]::text[]) THEN PERFORM dg_native_speaker_error('VERSION_CONFLICT');END IF;
 RETURN jsonb_build_object('visitId',v.id,'visitVersion',v.version,'recipientId',d.recipient_id,'referenceId',f.reference_id);
END;$dg$;
CREATE OR REPLACE FUNCTION dg_native_speaker_prelock(target text,token_hash_value text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT dg_native_speaker_prelock(target,token_hash_value,NULL)
$dg$;
CREATE FUNCTION dg_native_speaker_use_attempt(target text,token_hash_value text,csrf_hash_value text,focus_value bigint,key_digest text,body_digest text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE previous _dg_native_speaker_use_attempts%ROWTYPE;s reception_sessions%ROWTYPE;
BEGIN
 PERFORM dg_native_reception_runtime();PERFORM dg_native_reception_authorize(target,token_hash_value,csrf_hash_value,true);
 IF key_digest !~ '^[a-f0-9]{64}$' OR body_digest !~ '^[a-f0-9]{64}$' OR focus_value IS NULL OR focus_value<0 THEN PERFORM dg_native_speaker_error('VALIDATION_FAILED');END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('native-speaker-use-attempt:'||target,0));
 SELECT * INTO previous FROM _dg_native_speaker_use_attempts WHERE session_id=target AND key_hash=key_digest;
 IF previous.session_id IS NOT NULL THEN IF previous.token_hash<>token_hash_value OR previous.body_hash<>body_digest OR previous.focus_version<>focus_value THEN PERFORM dg_native_speaker_error('IDEMPOTENCY_CONFLICT');END IF;RETURN;END IF;
 SELECT * INTO s FROM reception_sessions WHERE id=target;IF s.focus_version<>focus_value OR s.status<>'active' THEN PERFORM dg_native_speaker_error('VERSION_CONFLICT');END IF;
 IF(SELECT count(*) FROM _dg_native_speaker_use_attempts WHERE session_id=target AND created_at>=dg_native_people_iso(clock_timestamp()-interval '60 seconds'))>=10 THEN PERFORM dg_native_speaker_error('RATE_LIMITED');END IF;
 INSERT INTO _dg_native_speaker_use_attempts VALUES(target,key_digest,body_digest,token_hash_value,focus_value,dg_utc_now());
END;$dg$;
CREATE FUNCTION dg_native_speaker_guest_ticket(target text,token_hash_value text,csrf_hash_value text,focus_value bigint,ticket_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE t speaker_use_tickets%ROWTYPE;o _dg_native_speaker_ticket_origins%ROWTYPE;r speaker_references%ROWTYPE;s reception_sessions%ROWTYPE;
BEGIN
 s:=dg_native_guest_memory_session(target,token_hash_value,csrf_hash_value,focus_value,true);
 SELECT * INTO t FROM speaker_use_tickets WHERE id=ticket_value;SELECT * INTO o FROM _dg_native_speaker_ticket_origins WHERE ticket_id=ticket_value;SELECT * INTO r FROM speaker_references WHERE id=o.reference_id;
 IF t.id IS NULL OR o.ticket_id IS NULL OR t.session_id<>target OR o.session_id<>target OR t.focus_version<>s.focus_version OR t.used_at IS NOT NULL OR t.revoked_at IS NOT NULL OR t.expires_at<=dg_utc_now() OR t.token_hash='' OR NOT dg_native_speaker_reference_valid(r.id) OR r.version<>o.reference_version OR r.tenant_id<>s.tenant_id OR r.workspace_id<>s.workspace_id OR r.provider_id IS DISTINCT FROM s.scene_app_snapshot::jsonb->>'speakerProvider' THEN PERFORM dg_native_speaker_error('REFERENCE_USE_DENIED');END IF;
 RETURN jsonb_build_object('id',t.id,'referenceId',r.id,'referenceVersion',o.reference_version,'provider',o.provider_id,'tenantId',o.tenant_id,'workspaceId',o.workspace_id,'ownerId',o.owner_user_id,'sessionId',t.session_id,'focusVersion',t.focus_version,'expiresAt',t.expires_at);
END;$dg$;

-- A system withdrawal may rebase an awaiting visit without a guest request.
-- Bind only that exact system-created draft on the next authenticated read;
-- the guest must still explicitly confirm it under the original deadline.
CREATE FUNCTION dg_native_speaker_visit_confirmation_bind(target text,token_hash_value text,visit_value text,descriptor_digest text,token_digest text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE raw_value jsonb;d _dg_native_visit_drafts%ROWTYPE;existing_value text;
BEGIN
 raw_value:=dg_native_visit_guest_view(target,token_hash_value);d:=dg_native_visit_draft(visit_value);
 IF raw_value->'descriptor' IS NULL OR raw_value->'descriptor'='null'::jsonb OR raw_value->'visit'->>'id' IS DISTINCT FROM visit_value THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT 1 FROM _dg_native_speaker_visit_focus_links l JOIN _dg_native_speaker_actions a ON a.id=l.action_id WHERE l.visit_id=visit_value AND l.focus_version=(raw_value->'descriptor'->>'focusVersion')::bigint AND a.session_id=target AND a.focus_after=l.focus_version AND a.operation IN('reference_withdrawn','reference_expired','expiry') AND a.transaction_id=d.transaction_id) THEN RETURN false;END IF;
 IF token_digest !~ '^[a-f0-9]{64}$' OR descriptor_digest IS DISTINCT FROM dg_native_office_hash(raw_value->'descriptor') THEN PERFORM dg_native_visit_error('STATE_CONFLICT');END IF;
 INSERT INTO _dg_native_visit_confirmations VALUES(visit_value,d.version,token_digest,dg_utc_now()) ON CONFLICT DO NOTHING;
 SELECT token_hash INTO existing_value FROM _dg_native_visit_confirmations WHERE visit_id=visit_value AND version=d.version;
 IF existing_value IS DISTINCT FROM token_digest THEN PERFORM dg_native_visit_error('STATE_CONFLICT');END IF;RETURN true;
END;$dg$;
CREATE FUNCTION dg_native_speaker_reference_membership_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE r record;
BEGIN
 FOR r IN SELECT q.id,q.tenant_id,q.workspace_id FROM speaker_references q JOIN _dg_native_speaker_reference_origins o ON o.reference_id=q.id WHERE q.owner_user_id=OLD.user_id AND q.scope='enrolled' AND q.status IN('pending','active') ORDER BY q.tenant_id,q.workspace_id,q.id LOOP
  IF TG_OP='DELETE' OR NOT EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=OLD.user_id AND m.tenant_id=r.tenant_id AND m.workspace_ids::jsonb ? r.workspace_id) THEN
   PERFORM dg_native_reception_workspace(r.tenant_id,r.workspace_id,true);PERFORM dg_native_speaker_reference_revoke(r.id,'owner_scope_withdrawn');
  END IF;
 END LOOP;RETURN NULL;
END;$dg$;
CREATE TRIGGER native_speaker_reference_membership_changed AFTER UPDATE OR DELETE ON memberships FOR EACH ROW EXECUTE FUNCTION dg_native_speaker_reference_membership_changed();

ALTER FUNCTION dg_native_speaker_sweep() RENAME TO dg_native_speaker_sweep_before_references;
CREATE FUNCTION dg_native_speaker_sweep() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE candidate record;available_ids text[]:=ARRAY[]::text[];locked_owners text[]:=ARRAY[]::text[];count_value bigint:=0;
BEGIN
 PERFORM dg_native_reception_runtime(true);
 -- Never wait for a membership or reference after taking parent locks.
 FOR candidate IN SELECT m.user_id FROM memberships m WHERE EXISTS(SELECT 1 FROM speaker_references r JOIN _dg_native_speaker_reference_origins o ON o.reference_id=r.id WHERE r.owner_user_id=m.user_id AND r.scope='enrolled' AND r.status IN('pending','active')) ORDER BY m.user_id FOR SHARE SKIP LOCKED LOOP locked_owners:=array_append(locked_owners,candidate.user_id);END LOOP;
 FOR candidate IN SELECT r.id FROM speaker_references r JOIN _dg_native_speaker_reference_origins o ON o.reference_id=r.id WHERE r.scope='enrolled' AND r.status IN('pending','active') AND(r.owner_user_id=ANY(locked_owners) OR NOT EXISTS(SELECT 1 FROM memberships WHERE user_id=r.owner_user_id)) ORDER BY r.id LOOP
  IF pg_try_advisory_xact_lock(hashtextextended('native-speaker-reference:'||candidate.id,0)) THEN available_ids:=array_append(available_ids,candidate.id);END IF;
 END LOOP;
 count_value:=dg_native_speaker_sweep_before_references();
 FOR candidate IN SELECT r.id,r.tenant_id,r.workspace_id,r.expires_at FROM speaker_references r WHERE r.id=ANY(available_ids) AND NOT dg_native_speaker_reference_valid(r.id) ORDER BY r.tenant_id,r.workspace_id,r.id LOOP
  IF NOT pg_try_advisory_xact_lock(hashtextextended('native-reception-workspace:'||candidate.tenant_id||':'||candidate.workspace_id,0)) THEN CONTINUE;END IF;
  PERFORM dg_native_speaker_reference_revoke(candidate.id,CASE WHEN candidate.expires_at<=dg_utc_now() THEN 'reference_expired' ELSE 'owner_scope_withdrawn' END,candidate.expires_at<=dg_utc_now());count_value:=count_value+1;
 END LOOP;RETURN count_value;
END;$dg$;

-- Enrolled control extension.
CREATE OR REPLACE FUNCTION dg_native_speaker_apply(target text,token_hash_value text,csrf_hash_value text,action_value text,input jsonb,hint jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s reception_sessions%ROWTYPE;old speaker_focus_sessions%ROWTYPE;f speaker_focus_sessions%ROWTYPE;r speaker_references%ROWTYPE;policy jsonb;id_value text:=gen_random_uuid()::text;now_value text:=dg_utc_now();before_version bigint;before_focus bigint;quality_value text;expires_value text;rebind_value text;ticket_value speaker_use_tickets%ROWTYPE;ticket_origin _dg_native_speaker_ticket_origins%ROWTYPE;original_ticket text;
BEGIN
 PERFORM dg_native_reception_runtime();PERFORM dg_native_speaker_check_hint(target,hint);
 IF jsonb_typeof(input->'focusVersion') IS DISTINCT FROM 'number' OR input->>'focusVersion' !~ '^[0-9]+$' OR jsonb_typeof(input->'version') IS DISTINCT FROM 'number' OR input->>'version' !~ '^[1-9][0-9]*$' THEN PERFORM dg_native_speaker_error('VALIDATION_FAILED');END IF;
 s:=dg_native_guest_memory_session(target,token_hash_value,csrf_hash_value,(input->>'focusVersion')::bigint,true);IF s.version::text IS DISTINCT FROM input->>'version' THEN PERFORM dg_native_speaker_error('VERSION_CONFLICT');END IF;before_version:=s.version;before_focus:=s.focus_version;
 policy:=dg_native_speaker_policy(target);
 IF action_value IN('start','reacquire','release') AND(SELECT count(*) FROM _dg_native_speaker_actions WHERE session_id=target AND operation IN('start','reacquire','release') AND created_at>=dg_native_people_iso(clock_timestamp()-interval '60 seconds'))>=12 THEN PERFORM dg_native_speaker_error('RATE_LIMITED');END IF;
 IF action_value='start' THEN
  PERFORM dg_native_reception_fields(input,ARRAY['version','focusVersion','mode','sameVisitorConfirmed','consent','noticeVersion','useCode']);
  IF input->>'mode' IS NULL OR input->>'mode' NOT IN('temporary','enrolled') THEN PERFORM dg_native_speaker_error('VALIDATION_FAILED');END IF;
  IF input->'sameVisitorConfirmed' IS DISTINCT FROM 'true'::jsonb OR input->'consent' IS DISTINCT FROM 'true'::jsonb OR input->>'noticeVersion' IS DISTINCT FROM 'speaker-v1' OR input->>'mode'='temporary' AND input ? 'useCode' THEN PERFORM dg_native_speaker_error('VALIDATION_FAILED');END IF;
  IF input->>'mode'='enrolled' THEN
   IF coalesce(input->>'useCode','') !~ '^SF1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$' THEN PERFORM dg_native_speaker_error('REFERENCE_USE_DENIED');END IF;
   SELECT * INTO ticket_value FROM speaker_use_tickets WHERE id=split_part(input->>'useCode','.',2) FOR UPDATE;SELECT * INTO ticket_origin FROM _dg_native_speaker_ticket_origins WHERE ticket_id=ticket_value.id;SELECT * INTO r FROM speaker_references WHERE id=ticket_origin.reference_id;
   IF ticket_value.id IS NULL OR ticket_origin.ticket_id IS NULL OR ticket_value.session_id<>target OR ticket_value.focus_version<>s.focus_version OR ticket_value.used_at IS NOT NULL OR ticket_value.revoked_at IS NOT NULL OR ticket_value.expires_at<=now_value OR ticket_value.token_hash IS DISTINCT FROM encode(sha256(convert_to(input->>'useCode','UTF8')),'hex') OR NOT dg_native_speaker_reference_valid(r.id) OR r.version<>ticket_origin.reference_version OR r.provider_id IS DISTINCT FROM policy->>'provider' OR r.tenant_id<>s.tenant_id OR r.workspace_id<>s.workspace_id THEN PERFORM dg_native_speaker_error('REFERENCE_USE_DENIED');END IF;
   UPDATE speaker_use_tickets SET used_at=now_value,token_hash='' WHERE id=ticket_value.id;original_ticket:=ticket_value.id;
  END IF;
  s:=dg_native_speaker_advance(target,'start',id_value);IF input->>'mode'='temporary' THEN r:=dg_native_speaker_temporary(target,policy->>'provider');END IF;expires_value:=least(s.expires_at,r.expires_at,dg_native_people_iso(now_value::timestamptz+interval '5 minutes'));
  INSERT INTO speaker_focus_sessions(session_id,state,reference_id,mode,provider_id,extraction_id,source_channel_id,focus_version,config_version,fallback,last_reason,expires_at,updated_at) VALUES(target,'acquiring',r.id,input->>'mode',policy->>'provider',policy->>'extraction','terminal:'||s.terminal_id,s.focus_version,(policy->>'configVersion')::bigint,'text','sample_required',expires_value,now_value) ON CONFLICT(session_id) DO UPDATE SET state='acquiring',reference_id=excluded.reference_id,mode=excluded.mode,provider_id=excluded.provider_id,extraction_id=excluded.extraction_id,source_channel_id=excluded.source_channel_id,focus_version=excluded.focus_version,config_version=excluded.config_version,fallback='text',last_reason='sample_required',usage_target_token=NULL,quality='pending',expires_at=excluded.expires_at,updated_at=excluded.updated_at;
 ELSIF action_value='reference' THEN
  PERFORM dg_native_reception_fields(input,ARRAY['version','focusVersion','fixture']);f:=dg_native_speaker_active(target);
  IF f.state NOT IN('acquiring','reacquiring','uncertain') OR input->>'fixture' IS NULL OR input->>'fixture' NOT IN('clear','too_short','overlapping','noisy','registered_mismatch','replay_match') THEN PERFORM dg_native_speaker_error('STATE_CONFLICT');END IF;
  SELECT * INTO r FROM speaker_references WHERE id=f.reference_id;IF r.status NOT IN('pending','active') OR r.expires_at<=now_value THEN PERFORM dg_native_speaker_error('REFERENCE_EXPIRED');END IF;
  quality_value:=CASE WHEN input->>'fixture' IN('too_short','noisy') THEN 'insufficient' WHEN input->>'fixture'='overlapping' THEN 'overlap' WHEN f.mode='enrolled' AND input->>'fixture'='registered_mismatch' THEN 'mismatch' ELSE 'adequate' END;
  IF f.mode='temporary' THEN UPDATE speaker_references SET quality=quality_value,status=CASE WHEN quality_value='adequate' THEN 'active' ELSE 'pending' END,provider_reference=CASE WHEN quality_value='adequate' THEN 'mock-reference:'||gen_random_uuid()::text END,target_token=CASE WHEN quality_value='adequate' THEN 'mock-target:'||gen_random_uuid()::text END,version=version+1 WHERE id=r.id;END IF;
  UPDATE speaker_focus_sessions SET state=CASE WHEN quality_value='adequate' THEN 'locked' ELSE 'uncertain' END,quality=quality_value,usage_target_token=CASE WHEN quality_value='adequate' THEN 'mock-session-target:'||gen_random_uuid()::text END,last_reason=CASE WHEN quality_value='adequate' THEN 'reference_confirmed_mock' ELSE 'reference_'||quality_value END,updated_at=now_value WHERE session_id=target;
  UPDATE reception_sessions SET version=version+1,activity_at=now_value WHERE id=target;
 ELSIF action_value='reacquire' THEN
  PERFORM dg_native_reception_fields(input,ARRAY['version','focusVersion','sameVisitorConfirmed']);IF input->'sameVisitorConfirmed' IS DISTINCT FROM 'true'::jsonb THEN PERFORM dg_native_speaker_error('VALIDATION_FAILED');END IF;old:=dg_native_speaker_active(target);IF old.mode='enrolled' THEN
   SELECT u.ticket_id INTO original_ticket FROM _dg_native_speaker_enrolled_uses u WHERE u.session_id=target AND u.focus_version=old.focus_version;SELECT * INTO r FROM speaker_references WHERE id=old.reference_id;
   IF original_ticket IS NULL OR NOT dg_native_speaker_reference_valid(r.id) THEN PERFORM dg_native_speaker_error('REFERENCE_EXPIRED');END IF;
  END IF;
  s:=dg_native_speaker_advance(target,'reacquire',id_value);IF old.mode='temporary' THEN r:=dg_native_speaker_temporary(target,policy->>'provider');END IF;expires_value:=least(s.expires_at,r.expires_at,dg_native_people_iso(now_value::timestamptz+interval '5 minutes'));
  UPDATE speaker_focus_sessions SET state='reacquiring',reference_id=r.id,usage_target_token=NULL,quality='pending',focus_version=s.focus_version,fallback='text',last_reason='sample_required',expires_at=expires_value,updated_at=now_value WHERE session_id=target;
 ELSIF action_value='release' THEN
  PERFORM dg_native_reception_fields(input,ARRAY['version','focusVersion','confirmed']);IF input->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN PERFORM dg_native_speaker_error('VALIDATION_FAILED');END IF;PERFORM dg_native_speaker_active(target);s:=dg_native_speaker_advance(target,'participant_released',id_value);PERFORM dg_native_speaker_end(target,'participant_released');
 ELSIF action_value='fallback' THEN
  PERFORM dg_native_reception_fields(input,ARRAY['version','focusVersion','mode','confirmed']);IF input->'confirmed' IS DISTINCT FROM 'true'::jsonb OR input->>'mode' IS NULL OR input->>'mode' NOT IN('text','near_field','ptt') THEN PERFORM dg_native_speaker_error('VALIDATION_FAILED');END IF;PERFORM dg_native_speaker_active(target);
  IF input->>'mode'='text' THEN s:=dg_native_speaker_advance(target,'text_fallback',id_value);PERFORM dg_native_speaker_end(target,'text_fallback');ELSE UPDATE speaker_focus_sessions SET fallback=input->>'mode',last_reason=CASE WHEN input->>'mode'='ptt' THEN 'ptt_confirmation_required' ELSE 'move_closer_then_reacquire' END,updated_at=now_value WHERE session_id=target;DELETE FROM speaker_ptt_permits WHERE session_id=target;UPDATE reception_sessions SET version=version+1,activity_at=now_value WHERE id=target;END IF;
 ELSIF action_value='ptt' THEN
  PERFORM dg_native_reception_fields(input,ARRAY['version','focusVersion','confirmed']);f:=dg_native_speaker_active(target);IF input->'confirmed' IS DISTINCT FROM 'true'::jsonb OR f.fallback<>'ptt' THEN PERFORM dg_native_speaker_error('STATE_CONFLICT');END IF;
  IF EXISTS(SELECT 1 FROM speaker_ptt_permits WHERE session_id=target AND focus_version=s.focus_version AND consumed_at IS NULL AND expires_at>now_value) THEN PERFORM dg_native_speaker_error('STATE_CONFLICT');END IF;
  DELETE FROM speaker_ptt_permits WHERE session_id=target AND expires_at<=now_value;INSERT INTO speaker_ptt_permits VALUES(gen_random_uuid()::text,target,s.focus_version,least(f.expires_at,dg_native_people_iso(now_value::timestamptz+interval '10 seconds')),NULL,now_value);UPDATE reception_sessions SET version=version+1,activity_at=now_value WHERE id=target;
 ELSE PERFORM dg_native_speaker_error('VALIDATION_FAILED');END IF;
 SELECT * INTO s FROM reception_sessions WHERE id=target;
 IF action_value IN('start','reacquire') THEN SELECT * INTO f FROM speaker_focus_sessions WHERE session_id=target;INSERT INTO _dg_native_speaker_focus_origins VALUES(target,s.focus_version,f.reference_id,f.provider_id,f.extraction_id,f.config_version,f.expires_at,now_value);IF f.mode='enrolled' THEN INSERT INTO _dg_native_speaker_enrolled_uses VALUES(target,s.focus_version,original_ticket,r.id,r.version,now_value);END IF;END IF;
 INSERT INTO _dg_native_speaker_actions VALUES(id_value,target,token_hash_value,action_value,before_version,before_focus,s.focus_version,now_value,pg_current_xact_id()::text);
 SELECT v.id INTO rebind_value FROM visits v JOIN LATERAL(SELECT * FROM _dg_native_visit_drafts WHERE visit_id=v.id ORDER BY version DESC LIMIT 1) d ON true WHERE v.session_id=target AND v.focus_version=s.focus_version AND v.status='awaiting_confirmation' AND d.version=v.version AND d.transaction_id=pg_current_xact_id()::text;
 INSERT INTO outbox_events VALUES(gen_random_uuid()::text,s.tenant_id,s.workspace_id,s.id,'speaker.'||action_value||'_mock','mock','{}',now_value,NULL);RETURN jsonb_build_object('id',id_value,'rebindVisitId',rebind_value);
END;$dg$;

CREATE OR REPLACE FUNCTION dg_native_speaker_focus_final() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE target text;f speaker_focus_sessions%ROWTYPE;s reception_sessions%ROWTYPE;o _dg_native_speaker_focus_origins%ROWTYPE;r speaker_references%ROWTYPE;u _dg_native_speaker_enrolled_uses%ROWTYPE;t speaker_use_tickets%ROWTYPE;origin _dg_native_speaker_ticket_origins%ROWTYPE;
BEGIN
 target:=NEW.session_id;SELECT * INTO f FROM speaker_focus_sessions WHERE session_id=target;IF f.session_id IS NULL OR f.state='ended' THEN RETURN NULL;END IF;
 SELECT * INTO STRICT s FROM reception_sessions WHERE id=target;SELECT * INTO o FROM _dg_native_speaker_focus_origins WHERE session_id=target AND focus_version=f.focus_version;SELECT * INTO r FROM speaker_references WHERE id=f.reference_id;
 IF s.status<>'active' OR f.focus_version<>s.focus_version OR r.id IS NULL OR o.reference_id IS NULL OR f.reference_id<>o.reference_id OR f.provider_id<>o.provider_id OR f.extraction_id<>o.extraction_id OR f.config_version<>o.config_version OR f.expires_at<>o.expires_at OR f.expires_at>s.expires_at OR f.expires_at>r.expires_at OR r.tenant_id<>s.tenant_id OR r.workspace_id<>s.workspace_id OR r.scope<>f.mode OR r.scope='temporary' AND r.session_id<>s.id OR f.source_channel_id IS DISTINCT FROM 'terminal:'||s.terminal_id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Focus must retain its original consent, source and expiry';END IF;
 IF f.mode='enrolled' THEN
  SELECT * INTO u FROM _dg_native_speaker_enrolled_uses WHERE session_id=target AND focus_version=f.focus_version;SELECT * INTO t FROM speaker_use_tickets WHERE id=u.ticket_id;SELECT * INTO origin FROM _dg_native_speaker_ticket_origins WHERE ticket_id=t.id;
  IF u.ticket_id IS NULL OR NOT dg_native_speaker_reference_valid(r.id) OR u.reference_id<>r.id OR u.reference_version<>r.version OR origin.reference_id<>r.id OR origin.reference_version<>r.version OR origin.session_id<>s.id OR origin.focus_version>=f.focus_version OR origin.provider_id<>f.provider_id OR t.used_at IS NULL OR t.used_at>t.expires_at OR t.token_hash<>'' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Enrolled focus requires an original single-use grant and current owner consent';END IF;
 END IF;
 RETURN NULL;
END;$dg$;

CREATE CONSTRAINT TRIGGER native_speaker_enrolled_use_final AFTER INSERT ON _dg_native_speaker_enrolled_uses DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_speaker_focus_final();
DO $dg$ DECLARE r record;role_value text;BEGIN
 FOR r IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND p.proname LIKE 'dg_native_speaker_%' LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||r.signature||' FROM PUBLIC';END LOOP;
 FOR role_value IN SELECT app_role FROM _dg_native_runtime_control UNION SELECT worker_role FROM _dg_native_runtime_control LOOP EXECUTE format('REVOKE ALL ON FUNCTION dg_native_speaker_sweep_before_references() FROM %I',role_value);END LOOP;
END;$dg$;

