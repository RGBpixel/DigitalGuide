-- R-132/R-133. Independent anonymous participant handoff; explicit mock only.
-- A retired ordinary guest capability alone cannot deliver the next one.
CREATE TABLE _dg_native_speaker_handoffs(
 id text PRIMARY KEY,session_id text NOT NULL REFERENCES reception_sessions(id),access_id text NOT NULL REFERENCES _dg_native_reception_access(id),
 state text NOT NULL CHECK(state IN('prepared','committed','claimed','expired','cancelled')),
 token_hash text NOT NULL CHECK(token_hash='' OR token_hash ~ '^[a-f0-9]{64}$'),
 next_session_id text UNIQUE REFERENCES reception_sessions(id) DEFERRABLE INITIALLY DEFERRED,
 next_access_id text UNIQUE REFERENCES _dg_native_reception_access(id) DEFERRABLE INITIALLY DEFERRED,
 started_at text,claimed_at text,updated_at text NOT NULL,transaction_id text NOT NULL
);
CREATE TABLE _dg_native_speaker_handoff_origins(
 id text PRIMARY KEY REFERENCES _dg_native_speaker_handoffs(id) DEFERRABLE INITIALLY DEFERRED,
 session_id text NOT NULL REFERENCES reception_sessions(id),access_id text NOT NULL REFERENCES _dg_native_reception_access(id),
 tenant_id text NOT NULL,workspace_id text NOT NULL,terminal_id text NOT NULL,actor_id text NOT NULL,
 session_version bigint NOT NULL,focus_version bigint NOT NULL,access_version bigint NOT NULL,
 input jsonb NOT NULL,input_hash text NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),token_hash text NOT NULL CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 expires_at text NOT NULL,created_at text NOT NULL
);
CREATE INDEX native_speaker_handoff_pending ON _dg_native_speaker_handoff_origins(session_id,created_at);
CREATE TRIGGER native_speaker_handoff_origin_immutable BEFORE UPDATE OR DELETE ON _dg_native_speaker_handoff_origins FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();

CREATE FUNCTION dg_native_speaker_handoff_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Handoff keeps its minimal lifecycle evidence';END IF;
 IF TG_OP='INSERT' THEN IF NEW.state<>'prepared' OR NEW.next_session_id IS NOT NULL OR NEW.next_access_id IS NOT NULL OR NEW.started_at IS NOT NULL OR NEW.claimed_at IS NOT NULL OR NEW.token_hash='' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Handoff starts as one fixed unconsumed intent';END IF;RETURN NEW;END IF;
 IF to_jsonb(NEW)-ARRAY['state','token_hash','next_session_id','next_access_id','started_at','claimed_at','updated_at','transaction_id'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['state','token_hash','next_session_id','next_access_id','started_at','claimed_at','updated_at','transaction_id'] OR NEW.updated_at<OLD.updated_at THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Handoff identity is immutable';END IF;
 IF OLD.state='prepared' AND NEW.state='committed' THEN
  IF NEW.next_session_id IS NULL OR NEW.next_session_id=NEW.session_id OR NEW.next_access_id IS NULL OR NEW.next_access_id=NEW.access_id OR NEW.started_at IS NULL OR NEW.claimed_at IS NOT NULL OR NEW.token_hash<>OLD.token_hash OR NEW.transaction_id<>pg_current_xact_id()::text THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Handoff commits one independent session and access';END IF;
 ELSE
  IF to_jsonb(NEW)-ARRAY['state','token_hash','claimed_at','updated_at'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['state','token_hash','claimed_at','updated_at'] OR NEW.token_hash<>'' OR NOT(OLD.state='prepared' AND NEW.state IN('expired','cancelled') OR OLD.state='committed' AND NEW.state IN('claimed','expired') OR OLD.state='expired' AND NEW.state='claimed' AND OLD.next_session_id IS NOT NULL) OR(NEW.state='claimed') IS DISTINCT FROM(NEW.claimed_at IS NOT NULL) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Handoff cannot be retargeted, renewed or revived';END IF;
 END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_speaker_handoff_guard BEFORE INSERT OR UPDATE OR DELETE ON _dg_native_speaker_handoffs FOR EACH ROW EXECUTE FUNCTION dg_native_speaker_handoff_guard();

CREATE FUNCTION dg_native_speaker_handoff_scope(target text,token_hash_value text,csrf_hash_value text,intent_value text,intent_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE h _dg_native_speaker_handoffs%ROWTYPE;o _dg_native_speaker_handoff_origins%ROWTYPE;a _dg_native_reception_access%ROWTYPE;s reception_sessions%ROWTYPE;n reception_sessions%ROWTYPE;origin _dg_native_reception_origins%ROWTYPE;
BEGIN
 PERFORM dg_native_reception_runtime();SELECT * INTO h FROM _dg_native_speaker_handoffs WHERE id=intent_value;SELECT * INTO o FROM _dg_native_speaker_handoff_origins WHERE id=intent_value;SELECT * INTO a FROM _dg_native_reception_access WHERE id=o.access_id;SELECT * INTO s FROM reception_sessions WHERE id=target;SELECT * INTO origin FROM _dg_native_reception_origins WHERE session_id=target;
 IF h.id IS NULL OR o.id IS NULL OR h.session_id<>target OR o.session_id<>target OR h.state NOT IN('prepared','committed') OR h.token_hash='' OR h.token_hash IS DISTINCT FROM intent_hash OR o.token_hash IS DISTINCT FROM intent_hash OR o.expires_at<=dg_utc_now() OR a.id IS NULL OR a.session_id<>target OR a.token_hash IS DISTINCT FROM token_hash_value OR csrf_hash_value IS NOT NULL AND a.csrf_hash IS DISTINCT FROM csrf_hash_value OR a.access_version<>o.access_version OR a.expires_at<=dg_utc_now() THEN PERFORM dg_native_speaker_error('HANDOFF_UNAVAILABLE');END IF;
 IF NOT dg_native_reception_source_valid(target) THEN PERFORM dg_native_speaker_error('SOURCE_UNAVAILABLE');END IF;
 IF h.state='prepared' THEN
  IF s.status<>'active' OR s.version<>o.session_version OR s.focus_version<>o.focus_version OR s.access_version<>o.access_version OR s.expires_at<=dg_utc_now() OR s.activity_at<=dg_native_people_iso(clock_timestamp()-interval '120 seconds') THEN PERFORM dg_native_speaker_error('VERSION_CONFLICT');END IF;
 ELSE
  SELECT * INTO n FROM reception_sessions WHERE id=h.next_session_id;
  IF s.status<>'ended' OR s.ended_reason<>'speaker_participant_handoff' OR s.focus_version<>o.focus_version+1 OR s.access_version<>o.access_version+1 OR n.id IS NULL OR n.status<>'active' OR n.focus_version<>0 OR n.access_version<>1 OR n.expires_at<=dg_utc_now() OR n.activity_at<=dg_native_people_iso(clock_timestamp()-interval '120 seconds') OR NOT dg_native_reception_source_valid(n.id) THEN PERFORM dg_native_speaker_error('HANDOFF_UNAVAILABLE');END IF;
 END IF;
 RETURN jsonb_build_object('id',s.id,'tenantId',s.tenant_id,'workspaceId',s.workspace_id,'terminalId',s.terminal_id,'actorId',origin.actor_id,'status',s.status,'version',s.version,'focusVersion',s.focus_version,'replyEpoch',s.reply_epoch,'accessVersion',s.access_version,'expiresAt',s.expires_at,'profile',origin.profile::jsonb,'scene',origin.scene::jsonb,'assets',origin.assets::jsonb);
END;$dg$;
CREATE FUNCTION dg_native_speaker_handoff_prelock(target text,token_hash_value text,csrf_hash_value text,intent_value text,intent_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;candidate record;v visits%ROWTYPE;d _dg_native_visit_drafts%ROWTYPE;f speaker_focus_sessions%ROWTYPE;
BEGIN
 meta:=dg_native_speaker_handoff_scope(target,token_hash_value,csrf_hash_value,intent_value,intent_hash);SELECT * INTO v FROM visits WHERE session_id=target;d:=dg_native_visit_draft(v.id);SELECT * INTO f FROM speaker_focus_sessions WHERE session_id=target;
 FOR candidate IN SELECT user_id FROM(SELECT meta->>'actorId' user_id UNION SELECT actor_id FROM _dg_native_reception_terminals WHERE terminal_id=meta->>'terminalId' UNION SELECT d.recipient_id UNION SELECT owner_user_id FROM speaker_references WHERE id=f.reference_id) q WHERE user_id IS NOT NULL ORDER BY user_id LOOP PERFORM user_id FROM dg_native_locked_membership(candidate.user_id);END LOOP;
 IF f.mode='enrolled' AND f.reference_id IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('native-speaker-reference:'||f.reference_id,0));END IF;
 -- Leave parent locks to the subsequent operation, after Node validates and
 -- locks the fixed assets/core workspace. Store only the membership hint.
 meta:=dg_native_speaker_handoff_scope(target,token_hash_value,csrf_hash_value,intent_value,intent_hash);PERFORM dg_native_speaker_check_hint(target,jsonb_build_object('visitId',v.id,'visitVersion',v.version,'recipientId',d.recipient_id,'referenceId',f.reference_id));PERFORM set_config('digitalguide.native_handoff_hint',jsonb_build_object('sessionId',target,'hint',jsonb_build_object('visitId',v.id,'visitVersion',v.version,'recipientId',d.recipient_id,'referenceId',f.reference_id))::text,true);RETURN meta;
END;$dg$;
CREATE FUNCTION dg_native_speaker_handoff_lock(target text,token_hash_value text,csrf_hash_value text,intent_value text,intent_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;hint_value jsonb;h _dg_native_speaker_handoffs%ROWTYPE;
BEGIN
 hint_value:=nullif(current_setting('digitalguide.native_handoff_hint',true),'')::jsonb;IF hint_value->>'sessionId' IS DISTINCT FROM target OR jsonb_typeof(hint_value->'hint') IS DISTINCT FROM 'object' THEN PERFORM dg_native_speaker_error('FORBIDDEN');END IF;
 meta:=dg_native_speaker_handoff_scope(target,token_hash_value,csrf_hash_value,intent_value,intent_hash);PERFORM dg_native_reception_workspace(meta->>'tenantId',meta->>'workspaceId',true);PERFORM id FROM reception_terminals WHERE id=meta->>'terminalId' FOR UPDATE;PERFORM id FROM reception_sessions WHERE id=target FOR UPDATE;SELECT * INTO h FROM _dg_native_speaker_handoffs WHERE id=intent_value FOR UPDATE;
 IF h.state<>'committed' OR h.transaction_id<>pg_current_xact_id()::text THEN PERFORM dg_native_speaker_check_hint(target,hint_value->'hint');END IF;
 RETURN dg_native_speaker_handoff_scope(target,token_hash_value,csrf_hash_value,intent_value,intent_hash);
END;$dg$;
CREATE FUNCTION dg_native_speaker_handoff_prepare(target text,token_hash_value text,csrf_hash_value text,intent_value text,intent_hash text,input jsonb,hint jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s reception_sessions%ROWTYPE;a _dg_native_reception_access%ROWTYPE;o _dg_native_reception_origins%ROWTYPE;id_value text;now_value text:=dg_utc_now();
BEGIN
 PERFORM dg_native_speaker_check_hint(target,hint);PERFORM dg_native_reception_authorize(target,token_hash_value,csrf_hash_value,true);SELECT * INTO s FROM reception_sessions WHERE id=target;SELECT * INTO a FROM _dg_native_reception_access WHERE session_id=target AND token_hash=token_hash_value AND access_version=s.access_version;SELECT * INTO o FROM _dg_native_reception_origins WHERE session_id=target;PERFORM dg_native_speaker_policy(target);
 PERFORM dg_native_reception_fields(input,ARRAY['version','focusVersion','confirmed','nextVisitorConfirmed']);
 IF input->'confirmed' IS DISTINCT FROM 'true'::jsonb OR input->'nextVisitorConfirmed' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(input->'version') IS DISTINCT FROM 'number' OR jsonb_typeof(input->'focusVersion') IS DISTINCT FROM 'number' OR intent_value IS NULL OR intent_value !~ '^[a-f0-9-]{36}$' OR intent_hash IS NULL OR intent_hash !~ '^[a-f0-9]{64}$' THEN PERFORM dg_native_speaker_error('VALIDATION_FAILED');END IF;
 IF s.status<>'active' OR input->>'version' IS DISTINCT FROM s.version::text OR input->>'focusVersion' IS DISTINCT FROM s.focus_version::text THEN PERFORM dg_native_speaker_error('VERSION_CONFLICT');END IF;
 IF(SELECT count(*) FROM _dg_native_speaker_handoff_origins WHERE session_id=target AND created_at>=dg_native_people_iso(clock_timestamp()-interval '60 seconds'))>=10 THEN PERFORM dg_native_speaker_error('RATE_LIMITED');END IF;
 SELECT h.id INTO id_value FROM _dg_native_speaker_handoffs h JOIN _dg_native_speaker_handoff_origins x ON x.id=h.id WHERE h.session_id=target AND h.state='prepared' AND x.session_version=s.version AND x.focus_version=s.focus_version AND x.access_version=s.access_version AND x.expires_at>now_value ORDER BY x.created_at DESC LIMIT 1;
 PERFORM set_config('digitalguide.native_handoff_hint',jsonb_build_object('sessionId',target,'hint',hint)::text,true);IF id_value IS NOT NULL THEN RETURN id_value;END IF;
 UPDATE _dg_native_speaker_handoffs SET state='cancelled',token_hash='',updated_at=now_value WHERE session_id=target AND state='prepared';
 INSERT INTO _dg_native_speaker_handoffs VALUES(intent_value,target,a.id,'prepared',intent_hash,NULL,NULL,NULL,NULL,now_value,pg_current_xact_id()::text);
 INSERT INTO _dg_native_speaker_handoff_origins VALUES(intent_value,target,a.id,s.tenant_id,s.workspace_id,s.terminal_id,o.actor_id,s.version,s.focus_version,s.access_version,input,dg_native_office_hash(input),intent_hash,least(s.expires_at,dg_native_people_iso(now_value::timestamptz+interval '60 seconds')),now_value);RETURN intent_value;
END;$dg$;
CREATE FUNCTION dg_native_speaker_handoff_descriptor(target text,token_hash_value text,intent_value text,intent_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE h _dg_native_speaker_handoffs%ROWTYPE;o _dg_native_speaker_handoff_origins%ROWTYPE;n reception_sessions%ROWTYPE;
BEGIN
 PERFORM dg_native_speaker_handoff_lock(target,token_hash_value,NULL,intent_value,intent_hash);SELECT * INTO h FROM _dg_native_speaker_handoffs WHERE id=intent_value;SELECT * INTO o FROM _dg_native_speaker_handoff_origins WHERE id=intent_value;SELECT * INTO n FROM reception_sessions WHERE id=h.next_session_id;
 RETURN jsonb_build_object('id',h.id,'state',h.state,'sessionId',target,'input',o.input,'expiresAt',o.expires_at,'nextSessionId',h.next_session_id,'grantId',h.next_access_id,'accessExpiresAt',n.expires_at);
END;$dg$;
CREATE FUNCTION dg_native_speaker_handoff_apply(target text,token_hash_value text,csrf_hash_value text,intent_value text,intent_hash text,input jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;h _dg_native_speaker_handoffs%ROWTYPE;o _dg_native_speaker_handoff_origins%ROWTYPE;source _dg_native_reception_origins%ROWTYPE;next_value text;now_value text:=dg_utc_now();
BEGIN
 meta:=dg_native_speaker_handoff_lock(target,token_hash_value,csrf_hash_value,intent_value,intent_hash);SELECT * INTO h FROM _dg_native_speaker_handoffs WHERE id=intent_value FOR UPDATE;SELECT * INTO o FROM _dg_native_speaker_handoff_origins WHERE id=intent_value;
 IF input IS DISTINCT FROM o.input OR dg_native_office_hash(input)<>o.input_hash THEN PERFORM dg_native_speaker_error('IDEMPOTENCY_CONFLICT');END IF;IF h.state='committed' THEN RETURN h.id;END IF;
 PERFORM dg_native_reception_authorize(target,token_hash_value,csrf_hash_value,true);PERFORM dg_native_speaker_policy(target);SELECT * INTO source FROM _dg_native_reception_origins WHERE session_id=target;
 PERFORM dg_native_reception_end(target,'speaker_participant_handoff');
 next_value:=dg_native_reception_spawn(o.terminal_id,o.actor_id,'manual',encode(sha256(convert_to(gen_random_uuid()::text,'UTF8')),'hex'),jsonb_build_object('profile',source.profile::jsonb,'scene',source.scene::jsonb,'assets',source.assets::jsonb));
 IF next_value=target OR EXISTS(SELECT 1 FROM _dg_native_speaker_handoffs WHERE next_session_id=next_value) THEN PERFORM dg_native_speaker_error('STATE_CONFLICT');END IF;
 UPDATE _dg_native_speaker_handoffs SET state='committed',next_session_id=next_value,next_access_id=gen_random_uuid()::text,started_at=now_value,updated_at=now_value,transaction_id=pg_current_xact_id()::text WHERE id=intent_value;
 INSERT INTO outbox_events VALUES(gen_random_uuid()::text,o.tenant_id,o.workspace_id,target,'speaker.participant_handoff_mock','mock','{}',now_value,NULL);RETURN intent_value;
END;$dg$;
CREATE FUNCTION dg_native_speaker_handoff_bind(target text,token_hash_value text,csrf_hash_value text,intent_value text,intent_hash text,next_token_hash text,next_csrf_hash text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE h _dg_native_speaker_handoffs%ROWTYPE;o _dg_native_speaker_handoff_origins%ROWTYPE;n reception_sessions%ROWTYPE;
BEGIN
 PERFORM dg_native_speaker_handoff_scope(target,token_hash_value,csrf_hash_value,intent_value,intent_hash);SELECT * INTO h FROM _dg_native_speaker_handoffs WHERE id=intent_value;SELECT * INTO o FROM _dg_native_speaker_handoff_origins WHERE id=intent_value;SELECT * INTO n FROM reception_sessions WHERE id=h.next_session_id;
 IF h.state<>'committed' OR h.transaction_id<>pg_current_xact_id()::text OR next_token_hash IS NULL OR next_token_hash !~ '^[a-f0-9]{64}$' OR next_csrf_hash IS NULL OR next_csrf_hash !~ '^[a-f0-9]{64}$' THEN PERFORM dg_native_speaker_error('VALIDATION_FAILED');END IF;
 INSERT INTO _dg_native_reception_access VALUES(h.next_access_id,n.id,o.actor_id,1,next_token_hash,next_csrf_hash,n.expires_at,dg_utc_now());
END;$dg$;

CREATE FUNCTION dg_native_speaker_handoff_final() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE h _dg_native_speaker_handoffs%ROWTYPE;o _dg_native_speaker_handoff_origins%ROWTYPE;s reception_sessions%ROWTYPE;n reception_sessions%ROWTYPE;a _dg_native_reception_access%ROWTYPE;old_origin _dg_native_reception_origins%ROWTYPE;new_origin _dg_native_reception_origins%ROWTYPE;
BEGIN
 SELECT * INTO h FROM _dg_native_speaker_handoffs WHERE id=NEW.id;SELECT * INTO o FROM _dg_native_speaker_handoff_origins WHERE id=NEW.id;SELECT * INTO s FROM reception_sessions WHERE id=h.session_id;
 IF h.id IS NULL OR o.id IS NULL OR h.session_id<>o.session_id OR h.access_id<>o.access_id OR s.tenant_id<>o.tenant_id OR s.workspace_id<>o.workspace_id OR s.terminal_id<>o.terminal_id OR o.input_hash IS DISTINCT FROM dg_native_office_hash(o.input) OR o.expires_at>least(s.expires_at,dg_native_people_iso(o.created_at::timestamptz+interval '60 seconds')) OR o.expires_at<=o.created_at OR h.state IN('prepared','committed') AND h.token_hash<>o.token_hash OR h.state IN('claimed','expired','cancelled') AND h.token_hash<>'' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Handoff retains its original scope, intent and deadline';END IF;
 IF h.next_session_id IS NOT NULL THEN
  SELECT * INTO n FROM reception_sessions WHERE id=h.next_session_id;SELECT * INTO a FROM _dg_native_reception_access WHERE id=h.next_access_id;SELECT * INTO old_origin FROM _dg_native_reception_origins WHERE session_id=s.id;SELECT * INTO new_origin FROM _dg_native_reception_origins WHERE session_id=n.id;
  IF n.id IS NULL OR a.id IS NULL OR n.id=s.id OR n.terminal_id<>s.terminal_id OR n.tenant_id<>s.tenant_id OR n.workspace_id<>s.workspace_id OR a.session_id<>n.id OR a.access_version<>1 OR a.actor_id<>o.actor_id OR a.expires_at<>n.expires_at OR new_origin.actor_id<>old_origin.actor_id OR new_origin.profile IS DISTINCT FROM old_origin.profile OR new_origin.scene IS DISTINCT FROM old_origin.scene OR new_origin.assets IS DISTINCT FROM old_origin.assets OR s.status NOT IN('ended','expired') OR s.ended_reason<>'speaker_participant_handoff' OR h.started_at IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Old closure, independent anonymous session and its capability must commit together';END IF;
 ELSIF h.state NOT IN('prepared','expired','cancelled') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Committed handoff requires its next participant';END IF;RETURN NULL;
END;$dg$;
CREATE CONSTRAINT TRIGGER native_speaker_handoff_final AFTER INSERT OR UPDATE ON _dg_native_speaker_handoffs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_speaker_handoff_final();
CREATE CONSTRAINT TRIGGER native_speaker_handoff_origin_final AFTER INSERT ON _dg_native_speaker_handoff_origins DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_speaker_handoff_final();

-- The new guest's first successful authorization permanently closes delivery
-- through the old intent. Ordinary guest reads keep their original clocks.
ALTER FUNCTION dg_native_reception_authorize(text,text,text,boolean) RENAME TO dg_native_reception_authorize_before_handoff;
CREATE FUNCTION dg_native_reception_authorize(target text,token_hash_value text,csrf_hash_value text,write_value boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 PERFORM dg_native_reception_authorize_before_handoff(target,token_hash_value,csrf_hash_value,write_value);
 UPDATE _dg_native_speaker_handoffs h SET state='claimed',token_hash='',claimed_at=dg_utc_now(),updated_at=dg_utc_now() FROM _dg_native_reception_access a WHERE h.next_session_id=target AND a.id=h.next_access_id AND a.token_hash=token_hash_value AND h.state IN('committed','expired');
END;$dg$;
ALTER FUNCTION dg_native_speaker_projection(text) RENAME TO dg_native_speaker_projection_before_handoff;
CREATE FUNCTION dg_native_speaker_projection(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE value jsonb;
BEGIN value:=dg_native_speaker_projection_before_handoff(target);IF NOT EXISTS(SELECT 1 FROM speaker_focus_sessions WHERE session_id=target) AND EXISTS(SELECT 1 FROM _dg_native_speaker_handoffs WHERE next_session_id=target) THEN value:=value||jsonb_build_object('state','handoff_pending','reason','next_visitor_confirmation_required');END IF;RETURN value;END;$dg$;
ALTER FUNCTION dg_native_speaker_sweep() RENAME TO dg_native_speaker_sweep_before_handoff;
CREATE FUNCTION dg_native_speaker_sweep() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE changed bigint;candidate record;
BEGIN
 changed:=dg_native_speaker_sweep_before_handoff();
 FOR candidate IN SELECT h.id FROM _dg_native_speaker_handoffs h JOIN _dg_native_speaker_handoff_origins o ON o.id=h.id WHERE h.state IN('prepared','committed') AND o.expires_at<=dg_utc_now() ORDER BY h.id FOR UPDATE OF h SKIP LOCKED LOOP UPDATE _dg_native_speaker_handoffs SET state='expired',token_hash='',updated_at=dg_utc_now() WHERE id=candidate.id;changed:=changed+1;END LOOP;RETURN changed;
END;$dg$;

CREATE FUNCTION dg_native_speaker_handoff_context_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF(NEW.status IS DISTINCT FROM OLD.status OR NEW.focus_version<>OLD.focus_version OR NEW.access_version<>OLD.access_version) AND NOT(NEW.status='ended' AND NEW.ended_reason='speaker_participant_handoff') THEN UPDATE _dg_native_speaker_handoffs SET state='cancelled',token_hash='',updated_at=dg_utc_now() WHERE session_id=NEW.id AND state='prepared';END IF;RETURN NULL;
END;$dg$;
CREATE TRIGGER native_speaker_handoff_context_changed AFTER UPDATE OF status,focus_version,access_version ON reception_sessions FOR EACH ROW EXECUTE FUNCTION dg_native_speaker_handoff_context_changed();
CREATE FUNCTION dg_native_speaker_staff_sample(target text,input jsonb,hint jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;s reception_sessions%ROWTYPE;f speaker_focus_sessions%ROWTYPE;r speaker_references%ROWTYPE;quality_value text;now_value text:=dg_utc_now();id_value text:=gen_random_uuid()::text;
BEGIN
 meta:=dg_native_speaker_event_actor(target);PERFORM dg_native_speaker_check_hint(target,hint);PERFORM dg_native_reception_workspace(meta->>'tenantId',meta->>'workspaceId',true);PERFORM id FROM reception_terminals WHERE id=meta->>'terminalId' FOR UPDATE;SELECT * INTO s FROM reception_sessions WHERE id=target FOR UPDATE;
 PERFORM dg_native_reception_fields(input,ARRAY['version','focusVersion','fixture']);IF jsonb_typeof(input->'version') IS DISTINCT FROM 'number' OR jsonb_typeof(input->'focusVersion') IS DISTINCT FROM 'number' THEN PERFORM dg_native_speaker_error('VALIDATION_FAILED');END IF;
 IF input->>'version' IS DISTINCT FROM s.version::text OR input->>'focusVersion' IS DISTINCT FROM s.focus_version::text THEN PERFORM dg_native_speaker_error('VERSION_CONFLICT');END IF;
 f:=dg_native_speaker_active(target);SELECT * INTO r FROM speaker_references WHERE id=f.reference_id;
 IF f.state NOT IN('acquiring','reacquiring','uncertain') OR input->>'fixture' IS NULL OR input->>'fixture' NOT IN('clear','too_short','overlapping','noisy','registered_mismatch','replay_match') THEN PERFORM dg_native_speaker_error('STATE_CONFLICT');END IF;
 IF r.id IS NULL OR r.status NOT IN('pending','active') OR r.expires_at<=now_value OR f.mode='enrolled' AND NOT dg_native_speaker_reference_valid(r.id) THEN PERFORM dg_native_speaker_error('REFERENCE_EXPIRED');END IF;
 quality_value:=CASE WHEN input->>'fixture' IN('too_short','noisy') THEN 'insufficient' WHEN input->>'fixture'='overlapping' THEN 'overlap' WHEN f.mode='enrolled' AND input->>'fixture'='registered_mismatch' THEN 'mismatch' ELSE 'adequate' END;
 IF f.mode='temporary' THEN UPDATE speaker_references SET quality=quality_value,status=CASE WHEN quality_value='adequate' THEN 'active' ELSE 'pending' END,provider_reference=CASE WHEN quality_value='adequate' THEN 'mock-reference:'||gen_random_uuid()::text END,target_token=CASE WHEN quality_value='adequate' THEN 'mock-target:'||gen_random_uuid()::text END,version=version+1 WHERE id=r.id;END IF;
 UPDATE speaker_focus_sessions SET state=CASE WHEN quality_value='adequate' THEN 'locked' ELSE 'uncertain' END,quality=quality_value,usage_target_token=CASE WHEN quality_value='adequate' THEN 'mock-session-target:'||gen_random_uuid()::text END,last_reason=CASE WHEN quality_value='adequate' THEN 'reference_confirmed_mock' ELSE 'reference_'||quality_value END,updated_at=now_value WHERE session_id=target;
 UPDATE reception_sessions SET version=version+1,activity_at=now_value WHERE id=target;
 INSERT INTO _dg_native_speaker_actions VALUES(id_value,target,encode(sha256(convert_to('native-staff-sample:'||current_setting('digitalguide.actor_id',true),'UTF8')),'hex'),'staff_reference',s.version,s.focus_version,s.focus_version,now_value,pg_current_xact_id()::text);
 INSERT INTO outbox_events VALUES(gen_random_uuid()::text,s.tenant_id,s.workspace_id,target,'speaker.staff_reference_mock','mock','{}',now_value,NULL);RETURN id_value;
END;$dg$;

DO $dg$ DECLARE r record;role_value text;BEGIN
 FOR r IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND p.proname LIKE 'dg_native_speaker_%' LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||r.signature||' FROM PUBLIC';END LOOP;
 REVOKE ALL ON FUNCTION dg_native_reception_authorize(text,text,text,boolean) FROM PUBLIC;
 FOR role_value IN SELECT app_role FROM _dg_native_runtime_control UNION SELECT worker_role FROM _dg_native_runtime_control LOOP EXECUTE format('REVOKE ALL ON FUNCTION dg_native_speaker_sweep_before_handoff() FROM %I',role_value);EXECUTE format('REVOKE ALL ON FUNCTION dg_native_reception_authorize_before_handoff(text,text,text,boolean) FROM %I',role_value);END LOOP;
END;$dg$;
