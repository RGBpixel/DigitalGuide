-- R-129/R-132/R-133/R-058. Native temporary-focus controls. Explicit mock only.
-- Enrolled use, handoff and accepted-event provenance follow before the feature
-- is advertised. Applied migrations are immutable.
CREATE TABLE _dg_native_speaker_reference_origins(
 reference_id text PRIMARY KEY REFERENCES speaker_references(id),tenant_id text NOT NULL,
 workspace_id text NOT NULL,owner_user_id text,session_id text,scope text NOT NULL,
 provider_id text NOT NULL,expires_at text NOT NULL,consent_at text NOT NULL,created_at text NOT NULL
);
CREATE TABLE _dg_native_speaker_actions(
 id text PRIMARY KEY,session_id text NOT NULL REFERENCES reception_sessions(id),
 token_hash text NOT NULL CHECK(token_hash ~ '^[a-f0-9]{64}$'),operation text NOT NULL,
 version_before bigint NOT NULL,focus_before bigint NOT NULL,focus_after bigint NOT NULL,
 created_at text NOT NULL,transaction_id text NOT NULL
);
CREATE INDEX native_speaker_action_window ON _dg_native_speaker_actions(session_id,created_at);
CREATE TABLE _dg_native_speaker_focus_origins(
 session_id text NOT NULL REFERENCES reception_sessions(id),focus_version bigint NOT NULL,
 reference_id text NOT NULL REFERENCES speaker_references(id),provider_id text NOT NULL,
 extraction_id text NOT NULL,config_version bigint NOT NULL,expires_at text NOT NULL,
 created_at text NOT NULL,PRIMARY KEY(session_id,focus_version)
);
CREATE TABLE _dg_native_speaker_visit_focus_links(
 visit_id text NOT NULL REFERENCES visits(id),focus_version bigint NOT NULL,
 action_id text REFERENCES _dg_native_speaker_actions(id) DEFERRABLE INITIALLY DEFERRED,
 created_at text NOT NULL,PRIMARY KEY(visit_id,focus_version)
);
INSERT INTO _dg_native_speaker_visit_focus_links SELECT visit_id,focus_version,NULL,created_at FROM _dg_native_visit_origins;
CREATE TRIGGER native_speaker_reference_origin_immutable BEFORE UPDATE OR DELETE ON _dg_native_speaker_reference_origins FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_speaker_action_immutable BEFORE UPDATE OR DELETE ON _dg_native_speaker_actions FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_speaker_focus_origin_immutable BEFORE UPDATE OR DELETE ON _dg_native_speaker_focus_origins FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_speaker_visit_link_immutable BEFORE UPDATE OR DELETE ON _dg_native_speaker_visit_focus_links FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();

CREATE FUNCTION dg_native_speaker_error(code_value text) RETURNS void LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='DGSPEAKER:'||code_value;END;$dg$;
CREATE FUNCTION dg_native_speaker_policy(target text,required_value boolean DEFAULT true) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s reception_sessions%ROWTYPE;policy jsonb;provider_value text;extraction_value text;
BEGIN
 SELECT * INTO s FROM reception_sessions WHERE id=target;policy:=s.scene_app_snapshot::jsonb;
 provider_value:=policy->>'speakerProvider';extraction_value:=policy->>'targetSpeechProvider';
 IF provider_value IS NULL OR provider_value='disabled' THEN IF required_value THEN PERFORM dg_native_speaker_error('CAPABILITY_UNAVAILABLE');END IF;RETURN NULL;END IF;
 IF provider_value NOT IN('mock-focus-final','mock-focus-early') OR extraction_value IS DISTINCT FROM 'mock-target-speech' OR s.environment<>'mock' OR s.app_env='production' THEN IF required_value THEN PERFORM dg_native_speaker_error('PROVIDER_NOT_CONFIGURED');END IF;RETURN NULL;END IF;
 IF NOT dg_native_reception_source_valid(target) THEN IF required_value THEN PERFORM dg_native_speaker_error('SOURCE_UNAVAILABLE');END IF;RETURN NULL;END IF;
 RETURN jsonb_build_object('provider',provider_value,'extraction',extraction_value,'configVersion',(policy->>'version')::bigint,'early',provider_value='mock-focus-early');
END;$dg$;
CREATE FUNCTION dg_native_speaker_prelock(target text,token_hash_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;candidate record;v visits%ROWTYPE;d _dg_native_visit_drafts%ROWTYPE;f speaker_focus_sessions%ROWTYPE;
BEGIN
 PERFORM dg_native_reception_runtime();meta:=dg_native_reception_meta(target,token_hash_value);
 IF token_hash_value IS NULL THEN PERFORM dg_native_reception_admin(meta->>'workspaceId');END IF;
 SELECT * INTO v FROM visits WHERE session_id=target;d:=dg_native_visit_draft(v.id);SELECT * INTO f FROM speaker_focus_sessions WHERE session_id=target;
 -- Membership locks precede asset/workspace/terminal/session locks.
 FOR candidate IN SELECT DISTINCT user_id FROM(SELECT meta->>'actorId' user_id UNION ALL SELECT actor_id FROM _dg_native_reception_terminals WHERE terminal_id=meta->>'terminalId' UNION ALL SELECT d.recipient_id UNION ALL SELECT owner_user_id FROM speaker_references WHERE id=f.reference_id) q WHERE user_id IS NOT NULL ORDER BY user_id LOOP PERFORM user_id FROM dg_native_locked_membership(candidate.user_id);END LOOP;
 RETURN jsonb_build_object('visitId',v.id,'visitVersion',v.version,'recipientId',d.recipient_id,'referenceId',f.reference_id);
END;$dg$;
CREATE FUNCTION dg_native_speaker_check_hint(target text,hint jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v visits%ROWTYPE;d _dg_native_visit_drafts%ROWTYPE;f speaker_focus_sessions%ROWTYPE;
BEGIN
 SELECT * INTO v FROM visits WHERE session_id=target;d:=dg_native_visit_draft(v.id);SELECT * INTO f FROM speaker_focus_sessions WHERE session_id=target;
 IF hint->>'visitId' IS DISTINCT FROM v.id OR hint->>'visitVersion' IS DISTINCT FROM v.version::text OR hint->>'recipientId' IS DISTINCT FROM d.recipient_id OR hint->>'referenceId' IS DISTINCT FROM f.reference_id THEN PERFORM dg_native_speaker_error('VERSION_CONFLICT');END IF;
END;$dg$;
CREATE FUNCTION dg_native_speaker_reference_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE o _dg_native_speaker_reference_origins%ROWTYPE;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.scope NOT IN('temporary','enrolled') OR NEW.provider_id NOT IN('mock-focus-final','mock-focus-early') OR NEW.environment<>'mock' OR NEW.app_env IS DISTINCT FROM(SELECT app_env FROM _dg_native_runtime_control WHERE id=1) OR NEW.purpose<>'speaker_focus' OR NEW.notice_version<>'speaker-v1' OR NEW.expires_at<=NEW.created_at OR NEW.expires_at>dg_native_people_iso(NEW.created_at::timestamptz+CASE WHEN NEW.scope='temporary' THEN interval '5 minutes' ELSE interval '30 days' END) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native speaker references need fixed explicit mock consent and expiry';END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO o FROM _dg_native_speaker_reference_origins WHERE reference_id=OLD.id;
 IF o.reference_id IS NOT NULL AND(to_jsonb(NEW)-ARRAY['label','provider_reference','target_token','quality','status','version','delete_status','deleted_at'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['label','provider_reference','target_token','quality','status','version','delete_status','deleted_at'] OR NEW.version<>OLD.version+1 OR OLD.status IN('deleted','expired') AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Speaker reference scope, consent and original expiry cannot be changed or revived';END IF;
 IF NEW.status IN('deleted','expired') AND(NEW.provider_reference IS NOT NULL OR NEW.target_token IS NOT NULL OR NEW.delete_status<>'completed_mock' OR NEW.deleted_at IS NULL) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Ended mock reference must clear private handles';END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_speaker_reference_guard BEFORE INSERT OR UPDATE ON speaker_references FOR EACH ROW EXECUTE FUNCTION dg_native_speaker_reference_guard();
CREATE FUNCTION dg_native_speaker_reference_origin() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN INSERT INTO _dg_native_speaker_reference_origins VALUES(NEW.id,NEW.tenant_id,NEW.workspace_id,NEW.owner_user_id,NEW.session_id,NEW.scope,NEW.provider_id,NEW.expires_at,NEW.consent_at,NEW.created_at);RETURN NULL;END;$dg$;
CREATE TRIGGER native_speaker_reference_origin AFTER INSERT ON speaker_references FOR EACH ROW EXECUTE FUNCTION dg_native_speaker_reference_origin();
CREATE FUNCTION dg_native_speaker_erase_reference(target text,expired_value boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 UPDATE speaker_references SET label=CASE WHEN scope='enrolled' THEN '已删除声音参考' ELSE label END,provider_reference=NULL,target_token=NULL,status=CASE WHEN expired_value THEN 'expired' ELSE 'deleted' END,delete_status='completed_mock',deleted_at=dg_utc_now(),version=version+1 WHERE id=target AND status IN('pending','active') AND EXISTS(SELECT 1 FROM _dg_native_speaker_reference_origins WHERE reference_id=target);
 UPDATE speaker_use_tickets SET token_hash='',revoked_at=coalesce(revoked_at,dg_utc_now()) WHERE reference_id=target AND token_hash<>'';
END;$dg$;
CREATE FUNCTION dg_native_speaker_end(target text,reason_value text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE r record;
BEGIN
 FOR r IN SELECT id FROM speaker_references WHERE session_id=target AND scope='temporary' AND status IN('pending','active') LOOP PERFORM dg_native_speaker_erase_reference(r.id);END LOOP;
 UPDATE speaker_focus_sessions SET state='ended',reference_id=NULL,usage_target_token=NULL,quality='pending',focus_version=(SELECT focus_version FROM reception_sessions WHERE id=target),last_reason=reason_value,updated_at=dg_utc_now() WHERE session_id=target;
 DELETE FROM speaker_ptt_permits WHERE session_id=target;UPDATE speaker_use_tickets SET token_hash='',revoked_at=coalesce(revoked_at,dg_utc_now()) WHERE session_id=target AND token_hash<>'';
END;$dg$;
CREATE FUNCTION dg_native_speaker_context_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN IF NEW.status<>'active' OR NEW.focus_version<>OLD.focus_version OR NEW.access_version<>OLD.access_version THEN PERFORM dg_native_speaker_end(NEW.id,CASE WHEN NEW.status='active' THEN 'focus_or_access_changed' ELSE 'session_paused_or_ended' END);END IF;RETURN NULL;END;$dg$;
CREATE TRIGGER native_speaker_context_changed AFTER UPDATE OF status,focus_version,access_version ON reception_sessions FOR EACH ROW EXECUTE FUNCTION dg_native_speaker_context_changed();

CREATE FUNCTION dg_native_speaker_visit_origin() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN INSERT INTO _dg_native_speaker_visit_focus_links VALUES(NEW.visit_id,NEW.focus_version,NULL,NEW.created_at);RETURN NULL;END;$dg$;
CREATE TRIGGER native_speaker_visit_origin AFTER INSERT ON _dg_native_visit_origins FOR EACH ROW EXECUTE FUNCTION dg_native_speaker_visit_origin();
CREATE OR REPLACE FUNCTION dg_native_visit_source_valid(target text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT EXISTS(SELECT 1 FROM _dg_native_visit_origins o JOIN reception_sessions s ON s.id=o.session_id JOIN visits v ON v.id=o.visit_id
 WHERE o.visit_id=target AND o.context_invalidated_at IS NULL AND o.redacted_at IS NULL AND o.expires_at>dg_utc_now()
 AND s.status='active' AND s.focus_version=v.focus_version AND EXISTS(SELECT 1 FROM _dg_native_speaker_visit_focus_links l WHERE l.visit_id=v.id AND l.focus_version=s.focus_version)
 AND s.expires_at>dg_utc_now() AND s.activity_at>dg_native_people_iso(clock_timestamp()-interval '120 seconds') AND dg_native_reception_source_valid(s.id) AND dg_native_visit_target_valid(target))
$dg$;
CREATE FUNCTION dg_native_speaker_advance(target text,reason_value text,action_value text,activity_value boolean DEFAULT true) RETURNS reception_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s reception_sessions%ROWTYPE;p people%ROWTYPE;v visits%ROWTYPE;o _dg_native_visit_origins%ROWTYPE;d _dg_native_visit_drafts%ROWTYPE;next_value bigint;new_version bigint;hash_value text;now_value text:=dg_utc_now();
BEGIN
 SELECT * INTO STRICT s FROM reception_sessions WHERE id=target;next_value:=s.focus_version+1;
 PERFORM dg_native_reception_cancel(target);
 p:=dg_native_guest_memory_owned(target,false);
 IF p.id IS NOT NULL THEN
  INSERT INTO memory_session_links(session_id,person_id,focus_version,consent_at,transcript_expires_at) SELECT session_id,person_id,next_value,consent_at,transcript_expires_at FROM memory_session_links WHERE session_id=target AND person_id=p.id AND focus_version=s.focus_version ON CONFLICT DO NOTHING;
  UPDATE people SET version=version+1,updated_at=now_value WHERE id=p.id;PERFORM dg_native_people_invalidate(p.id);
 END IF;
 SELECT * INTO v FROM visits WHERE session_id=target AND focus_version=s.focus_version;SELECT * INTO o FROM _dg_native_visit_origins WHERE visit_id=v.id;
 IF v.id IS NOT NULL AND o.context_invalidated_at IS NULL AND o.redacted_at IS NULL THEN
  d:=dg_native_visit_draft(v.id);INSERT INTO _dg_native_speaker_visit_focus_links VALUES(v.id,next_value,action_value,now_value);
  IF v.status='notifying' AND NOT EXISTS(SELECT 1 FROM visit_deliveries WHERE visit_id=v.id) THEN DELETE FROM visit_confirmation_targets WHERE visit_id=v.id;v.status:='awaiting_confirmation';END IF;
  UPDATE visits SET focus_version=next_value,version=version+1,status=v.status,confirmed_hash=CASE WHEN v.status='awaiting_confirmation' THEN NULL ELSE confirmed_hash END,confirmed_at=CASE WHEN v.status='awaiting_confirmation' THEN NULL ELSE confirmed_at END,notice_version=CASE WHEN v.status='awaiting_confirmation' THEN NULL ELSE notice_version END,updated_at=now_value WHERE id=v.id RETURNING version INTO new_version;
  IF v.status='awaiting_confirmation' THEN
   hash_value:=dg_native_office_hash(jsonb_build_object('guestName',v.guest_name,'company',v.company,'hostName',v.host_name,'purpose',v.purpose,'appointmentRef',v.appointment_ref,'sessionId',s.id,'focusVersion',next_value,'hostId',d.host_id,'hostVersion',d.host_version,'recipientId',d.recipient_id,'channel',d.channel));
   INSERT INTO _dg_native_visit_drafts VALUES(v.id,new_version,d.host_id,d.host_version,d.recipient_id,hash_value,d.channel,d.confirmation_expires_at,pg_current_xact_id()::text,now_value);
  END IF;
 END IF;
 UPDATE reception_sessions SET focus_version=next_value,version=version+1,reply_epoch=reply_epoch+1,activity_at=CASE WHEN activity_value THEN now_value ELSE activity_at END WHERE id=target;
 INSERT INTO outbox_events VALUES(gen_random_uuid()::text,s.tenant_id,s.workspace_id,s.id,'speaker.focus_version_changed','mock','{}',now_value,NULL);
 SELECT * INTO s FROM reception_sessions WHERE id=target;RETURN s;
END;$dg$;
CREATE FUNCTION dg_native_speaker_temporary(target text,provider_value text) RETURNS speaker_references LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s reception_sessions%ROWTYPE;r speaker_references%ROWTYPE;id_value text:=gen_random_uuid()::text;now_value text:=dg_utc_now();
BEGIN
 SELECT * INTO STRICT s FROM reception_sessions WHERE id=target;
 INSERT INTO speaker_references(id,tenant_id,workspace_id,session_id,scope,label,provider_id,purpose,notice_version,consent_at,expires_at,created_at,environment,app_env) VALUES(id_value,s.tenant_id,s.workspace_id,s.id,'temporary','本次临时合成参考',provider_value,'speaker_focus','speaker-v1',now_value,least(s.expires_at,dg_native_people_iso(now_value::timestamptz+interval '5 minutes')),now_value,'mock',s.app_env) RETURNING * INTO r;RETURN r;
END;$dg$;
CREATE FUNCTION dg_native_speaker_active(target text) RETURNS speaker_focus_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s reception_sessions%ROWTYPE;f speaker_focus_sessions%ROWTYPE;
BEGIN
 PERFORM dg_native_speaker_policy(target);SELECT * INTO STRICT s FROM reception_sessions WHERE id=target;SELECT * INTO f FROM speaker_focus_sessions WHERE session_id=target;
 IF s.status<>'active' OR f.session_id IS NULL OR f.focus_version<>s.focus_version OR f.state IN('idle','ended','handoff_pending') OR f.expires_at<=dg_utc_now() THEN PERFORM dg_native_speaker_error('FOCUS_NOT_ACTIVE');END IF;RETURN f;
END;$dg$;
CREATE FUNCTION dg_native_speaker_projection(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s reception_sessions%ROWTYPE;f speaker_focus_sessions%ROWTYPE;r speaker_references%ROWTYPE;policy jsonb;capabilities_value jsonb;
BEGIN
 SELECT * INTO STRICT s FROM reception_sessions WHERE id=target;SELECT * INTO f FROM speaker_focus_sessions WHERE session_id=target;SELECT * INTO r FROM speaker_references WHERE id=f.reference_id;policy:=dg_native_speaker_policy(target,false);
 IF policy IS NOT NULL THEN capabilities_value:=jsonb_build_object('attributionTiming',CASE WHEN policy->>'early'='true' THEN 'early' ELSE 'final' END,'targetBargeIn',policy->'early','targetExtraction','simulated','overlap','reject','processingLocation','local_mock');END IF;
 RETURN jsonb_build_object('state',coalesce(f.state,'idle'),'enabled',policy IS NOT NULL,'configured',policy IS NOT NULL,'simulated',policy IS NOT NULL OR f.session_id IS NOT NULL,'mode',f.mode,'focusVersion',s.focus_version,'sessionVersion',s.version,'fallback',coalesce(f.fallback,'text'),'reason',coalesce(f.last_reason,CASE WHEN policy IS NULL THEN 'not_configured' ELSE 'not_started' END),'reference',CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object('scope',r.scope,'status',r.status,'quality',f.quality,'expiresAt',f.expires_at) END,'capabilities',capabilities_value,'pttReady',EXISTS(SELECT 1 FROM speaker_ptt_permits WHERE session_id=target AND focus_version=s.focus_version AND consumed_at IS NULL AND expires_at>dg_utc_now()),'counts',jsonb_build_object('accepted',(SELECT count(*) FROM speaker_segment_decisions WHERE session_id=target AND focus_version=s.focus_version AND accepted=1),'rejected',(SELECT count(*) FROM speaker_segment_decisions WHERE session_id=target AND focus_version=s.focus_version AND accepted=0 AND reason<>'awaiting_final'),'buffered',0));
END;$dg$;
CREATE FUNCTION dg_native_speaker_view(target text,token_hash_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN PERFORM dg_native_reception_authorize(target,token_hash_value,NULL,false);RETURN dg_native_speaker_projection(target);END;$dg$;
CREATE FUNCTION dg_native_speaker_admin_view(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;
BEGIN PERFORM dg_native_reception_runtime();meta:=dg_native_reception_meta(target,NULL);PERFORM dg_native_reception_admin(meta->>'workspaceId');RETURN dg_native_speaker_projection(target);END;$dg$;
CREATE FUNCTION dg_native_speaker_apply(target text,token_hash_value text,csrf_hash_value text,action_value text,input jsonb,hint jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s reception_sessions%ROWTYPE;old speaker_focus_sessions%ROWTYPE;f speaker_focus_sessions%ROWTYPE;r speaker_references%ROWTYPE;policy jsonb;id_value text:=gen_random_uuid()::text;now_value text:=dg_utc_now();before_version bigint;before_focus bigint;quality_value text;expires_value text;rebind_value text;
BEGIN
 PERFORM dg_native_reception_runtime();PERFORM dg_native_speaker_check_hint(target,hint);
 IF jsonb_typeof(input->'focusVersion') IS DISTINCT FROM 'number' OR input->>'focusVersion' !~ '^[0-9]+$' OR jsonb_typeof(input->'version') IS DISTINCT FROM 'number' OR input->>'version' !~ '^[1-9][0-9]*$' THEN PERFORM dg_native_speaker_error('VALIDATION_FAILED');END IF;
 s:=dg_native_guest_memory_session(target,token_hash_value,csrf_hash_value,(input->>'focusVersion')::bigint,true);IF s.version::text IS DISTINCT FROM input->>'version' THEN PERFORM dg_native_speaker_error('VERSION_CONFLICT');END IF;before_version:=s.version;before_focus:=s.focus_version;
 policy:=dg_native_speaker_policy(target);
 IF action_value IN('start','reacquire','release') AND(SELECT count(*) FROM _dg_native_speaker_actions WHERE session_id=target AND operation IN('start','reacquire','release') AND created_at>=dg_native_people_iso(clock_timestamp()-interval '60 seconds'))>=12 THEN PERFORM dg_native_speaker_error('RATE_LIMITED');END IF;
 IF action_value='start' THEN
  PERFORM dg_native_reception_fields(input,ARRAY['version','focusVersion','mode','sameVisitorConfirmed','consent','noticeVersion','useCode']);
  IF input->>'mode' IS DISTINCT FROM 'temporary' THEN PERFORM dg_native_speaker_error('CAPABILITY_UNAVAILABLE');END IF;
  IF input->'sameVisitorConfirmed' IS DISTINCT FROM 'true'::jsonb OR input->'consent' IS DISTINCT FROM 'true'::jsonb OR input->>'noticeVersion' IS DISTINCT FROM 'speaker-v1' OR input ? 'useCode' THEN PERFORM dg_native_speaker_error('VALIDATION_FAILED');END IF;
  s:=dg_native_speaker_advance(target,'start',id_value);r:=dg_native_speaker_temporary(target,policy->>'provider');expires_value:=r.expires_at;
  INSERT INTO speaker_focus_sessions(session_id,state,reference_id,mode,provider_id,extraction_id,source_channel_id,focus_version,config_version,fallback,last_reason,expires_at,updated_at) VALUES(target,'acquiring',r.id,'temporary',policy->>'provider',policy->>'extraction','terminal:'||s.terminal_id,s.focus_version,(policy->>'configVersion')::bigint,'text','sample_required',expires_value,now_value) ON CONFLICT(session_id) DO UPDATE SET state='acquiring',reference_id=excluded.reference_id,mode=excluded.mode,provider_id=excluded.provider_id,extraction_id=excluded.extraction_id,source_channel_id=excluded.source_channel_id,focus_version=excluded.focus_version,config_version=excluded.config_version,fallback='text',last_reason='sample_required',usage_target_token=NULL,quality='pending',expires_at=excluded.expires_at,updated_at=excluded.updated_at;
 ELSIF action_value='reference' THEN
  PERFORM dg_native_reception_fields(input,ARRAY['version','focusVersion','fixture']);f:=dg_native_speaker_active(target);
  IF f.state NOT IN('acquiring','reacquiring','uncertain') OR f.mode<>'temporary' OR input->>'fixture' IS NULL OR input->>'fixture' NOT IN('clear','too_short','overlapping','noisy','registered_mismatch','replay_match') THEN PERFORM dg_native_speaker_error('STATE_CONFLICT');END IF;
  SELECT * INTO r FROM speaker_references WHERE id=f.reference_id;IF r.status NOT IN('pending','active') OR r.expires_at<=now_value THEN PERFORM dg_native_speaker_error('REFERENCE_EXPIRED');END IF;
  quality_value:=CASE WHEN input->>'fixture' IN('too_short','noisy') THEN 'insufficient' WHEN input->>'fixture'='overlapping' THEN 'overlap' ELSE 'adequate' END;
  UPDATE speaker_references SET quality=quality_value,status=CASE WHEN quality_value='adequate' THEN 'active' ELSE 'pending' END,provider_reference=CASE WHEN quality_value='adequate' THEN 'mock-reference:'||gen_random_uuid()::text END,target_token=CASE WHEN quality_value='adequate' THEN 'mock-target:'||gen_random_uuid()::text END,version=version+1 WHERE id=r.id;
  UPDATE speaker_focus_sessions SET state=CASE WHEN quality_value='adequate' THEN 'locked' ELSE 'uncertain' END,quality=quality_value,usage_target_token=(SELECT target_token FROM speaker_references WHERE id=r.id),last_reason=CASE WHEN quality_value='adequate' THEN 'reference_confirmed_mock' ELSE 'reference_'||quality_value END,updated_at=now_value WHERE session_id=target;
  UPDATE reception_sessions SET version=version+1,activity_at=now_value WHERE id=target;
 ELSIF action_value='reacquire' THEN
  PERFORM dg_native_reception_fields(input,ARRAY['version','focusVersion','sameVisitorConfirmed']);IF input->'sameVisitorConfirmed' IS DISTINCT FROM 'true'::jsonb THEN PERFORM dg_native_speaker_error('VALIDATION_FAILED');END IF;old:=dg_native_speaker_active(target);IF old.mode<>'temporary' THEN PERFORM dg_native_speaker_error('CAPABILITY_UNAVAILABLE');END IF;
  s:=dg_native_speaker_advance(target,'reacquire',id_value);r:=dg_native_speaker_temporary(target,policy->>'provider');expires_value:=least(s.expires_at,r.expires_at);
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
 IF action_value IN('start','reacquire') THEN SELECT * INTO f FROM speaker_focus_sessions WHERE session_id=target;INSERT INTO _dg_native_speaker_focus_origins VALUES(target,s.focus_version,f.reference_id,f.provider_id,f.extraction_id,f.config_version,f.expires_at,now_value);END IF;
 INSERT INTO _dg_native_speaker_actions VALUES(id_value,target,token_hash_value,action_value,before_version,before_focus,s.focus_version,now_value,pg_current_xact_id()::text);
 SELECT v.id INTO rebind_value FROM visits v JOIN LATERAL(SELECT * FROM _dg_native_visit_drafts WHERE visit_id=v.id ORDER BY version DESC LIMIT 1) d ON true WHERE v.session_id=target AND v.focus_version=s.focus_version AND v.status='awaiting_confirmation' AND d.version=v.version AND d.transaction_id=pg_current_xact_id()::text;
 INSERT INTO outbox_events VALUES(gen_random_uuid()::text,s.tenant_id,s.workspace_id,s.id,'speaker.'||action_value||'_mock','mock','{}',now_value,NULL);RETURN jsonb_build_object('id',id_value,'rebindVisitId',rebind_value);
END;$dg$;
CREATE FUNCTION dg_native_speaker_receipt_view(target text,token_hash_value text,action_value text,focus_value bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s reception_sessions%ROWTYPE;r _dg_native_speaker_actions%ROWTYPE;
BEGIN
 PERFORM dg_native_reception_authorize(target,token_hash_value,NULL,false);SELECT * INTO s FROM reception_sessions WHERE id=target;SELECT * INTO r FROM _dg_native_speaker_actions WHERE id=action_value AND session_id=target AND token_hash=token_hash_value;
 IF r.id IS NULL OR r.focus_before<>focus_value OR r.focus_after<>s.focus_version THEN PERFORM dg_native_speaker_error('VERSION_CONFLICT');END IF;RETURN dg_native_speaker_projection(target);
END;$dg$;

CREATE FUNCTION dg_native_speaker_focus_final() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE target text;f speaker_focus_sessions%ROWTYPE;s reception_sessions%ROWTYPE;o _dg_native_speaker_focus_origins%ROWTYPE;r speaker_references%ROWTYPE;
BEGIN
 target:=NEW.session_id;SELECT * INTO f FROM speaker_focus_sessions WHERE session_id=target;IF f.session_id IS NULL OR f.state='ended' THEN RETURN NULL;END IF;
 SELECT * INTO STRICT s FROM reception_sessions WHERE id=target;SELECT * INTO o FROM _dg_native_speaker_focus_origins WHERE session_id=target AND focus_version=f.focus_version;SELECT * INTO r FROM speaker_references WHERE id=f.reference_id;
 IF s.status<>'active' OR f.focus_version<>s.focus_version OR r.id IS NULL OR o.reference_id IS NULL OR f.reference_id<>o.reference_id OR f.provider_id<>o.provider_id OR f.extraction_id<>o.extraction_id OR f.config_version<>o.config_version OR f.expires_at<>o.expires_at OR f.expires_at>s.expires_at OR f.expires_at>r.expires_at OR r.tenant_id<>s.tenant_id OR r.workspace_id<>s.workspace_id OR r.scope<>f.mode OR r.scope='temporary' AND r.session_id<>s.id OR f.source_channel_id IS DISTINCT FROM 'terminal:'||s.terminal_id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Focus must retain its original consent, source and expiry';END IF;
 RETURN NULL;
END;$dg$;
CREATE CONSTRAINT TRIGGER native_speaker_focus_final AFTER INSERT OR UPDATE ON speaker_focus_sessions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_speaker_focus_final();
CREATE CONSTRAINT TRIGGER native_speaker_focus_origin_final AFTER INSERT ON _dg_native_speaker_focus_origins DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_speaker_focus_final();
CREATE FUNCTION dg_native_speaker_sweep() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE candidate record;s reception_sessions%ROWTYPE;f speaker_focus_sessions%ROWTYPE;r speaker_references%ROWTYPE;action_value text;before_version bigint;before_focus bigint;count_value bigint:=0;terminal_value text;
BEGIN
 PERFORM dg_native_reception_runtime(true);
 FOR candidate IN SELECT s0.id,s0.terminal_id,s0.tenant_id,s0.workspace_id FROM reception_sessions s0 JOIN speaker_focus_sessions f0 ON f0.session_id=s0.id JOIN _dg_native_reception_origins o ON o.session_id=s0.id WHERE f0.state NOT IN('idle','ended','handoff_pending') ORDER BY s0.tenant_id,s0.workspace_id,s0.terminal_id,s0.id LOOP
  IF NOT pg_try_advisory_xact_lock(hashtextextended('native-reception-workspace:'||candidate.tenant_id||':'||candidate.workspace_id,0)) THEN CONTINUE;END IF;
  terminal_value:=NULL;SELECT id INTO terminal_value FROM reception_terminals WHERE id=candidate.terminal_id FOR UPDATE SKIP LOCKED;IF terminal_value IS NULL THEN CONTINUE;END IF;SELECT * INTO s FROM reception_sessions WHERE id=candidate.id FOR UPDATE SKIP LOCKED;IF s.id IS NULL THEN CONTINUE;END IF;SELECT * INTO f FROM speaker_focus_sessions WHERE session_id=s.id;SELECT * INTO r FROM speaker_references WHERE id=f.reference_id;
  IF s.status<>'active' OR f.focus_version<>s.focus_version THEN PERFORM dg_native_speaker_end(s.id,'session_paused_or_ended');count_value:=count_value+1;
  ELSIF NOT dg_native_reception_source_valid(s.id) THEN PERFORM dg_native_reception_end(s.id,'source_unavailable',false,true);count_value:=count_value+1;
  ELSIF s.expires_at<=dg_utc_now() OR s.activity_at<=dg_native_people_iso(clock_timestamp()-interval '120 seconds') THEN PERFORM dg_native_reception_end(s.id,'timeout',true);count_value:=count_value+1;
  ELSIF f.expires_at<=dg_utc_now() OR r.id IS NULL OR r.status NOT IN('pending','active') OR r.expires_at<=dg_utc_now() THEN
   action_value:=gen_random_uuid()::text;before_version:=s.version;before_focus:=s.focus_version;IF r.id IS NOT NULL AND r.scope='temporary' THEN PERFORM dg_native_speaker_erase_reference(r.id,true);END IF;s:=dg_native_speaker_advance(s.id,'reference_expired',action_value,false);PERFORM dg_native_speaker_end(s.id,'reference_expired');
   INSERT INTO _dg_native_speaker_actions VALUES(action_value,s.id,repeat('0',64),'expiry',before_version,before_focus,s.focus_version,dg_utc_now(),pg_current_xact_id()::text);count_value:=count_value+1;
  END IF;
 END LOOP;
 DELETE FROM speaker_ptt_permits WHERE expires_at<=dg_utc_now();UPDATE speaker_use_tickets SET token_hash='',revoked_at=coalesce(revoked_at,dg_utc_now()) WHERE token_hash<>'' AND expires_at<=dg_utc_now();RETURN count_value;
END;$dg$;

DO $dg$ DECLARE r record;BEGIN FOR r IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND p.proname LIKE 'dg_native_speaker_%' LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||r.signature||' FROM PUBLIC';END LOOP;END;$dg$;
