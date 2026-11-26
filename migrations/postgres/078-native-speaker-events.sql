-- R-129--R-134: explicit synthetic attribution before questions or memory.
-- Non-target/partial text is never stored by this pipeline. No real audio SDK.
CREATE TABLE _dg_native_speaker_ingress(
 id text PRIMARY KEY,session_id text NOT NULL REFERENCES reception_sessions(id),actor_id text NOT NULL,
 focus_version bigint NOT NULL,decision_id text REFERENCES speaker_segment_decisions(id),accepted boolean NOT NULL,
 buffered boolean NOT NULL,interrupted boolean NOT NULL,reason text NOT NULL,created_at text NOT NULL,transaction_id text NOT NULL
);
CREATE INDEX native_speaker_ingress_window ON _dg_native_speaker_ingress(session_id,created_at);
CREATE TABLE _dg_native_speaker_event_origins(
 decision_id text PRIMARY KEY REFERENCES speaker_segment_decisions(id),ingress_id text NOT NULL UNIQUE REFERENCES _dg_native_speaker_ingress(id),
 session_id text NOT NULL,focus_version bigint NOT NULL,actor_id text NOT NULL,descriptor jsonb NOT NULL,created_at text NOT NULL,transaction_id text NOT NULL,
 FOREIGN KEY(session_id,focus_version) REFERENCES _dg_native_speaker_focus_origins(session_id,focus_version) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE _dg_native_speaker_event_signatures(
 decision_id text PRIMARY KEY REFERENCES _dg_native_speaker_event_origins(decision_id),descriptor_hash text NOT NULL CHECK(descriptor_hash ~ '^[a-f0-9]{64}$'),
 signature_hash text NOT NULL CHECK(signature_hash ~ '^[a-f0-9]{64}$'),created_at text NOT NULL
);
CREATE TABLE _dg_native_speaker_message_sources(
 decision_id text PRIMARY KEY REFERENCES _dg_native_speaker_event_origins(decision_id),
 question_id text NOT NULL UNIQUE REFERENCES reception_messages(id) DEFERRABLE INITIALLY DEFERRED,
 reply_id text NOT NULL UNIQUE REFERENCES reception_messages(id) DEFERRABLE INITIALLY DEFERRED,
 session_id text NOT NULL,focus_version bigint NOT NULL,reply_epoch bigint NOT NULL,text_hash text NOT NULL CHECK(text_hash ~ '^[a-f0-9]{64}$'),created_at text NOT NULL
);
CREATE TABLE _dg_native_speaker_streams(
 session_id text NOT NULL,focus_version bigint NOT NULL,segment_id text NOT NULL,last_sequence bigint NOT NULL CHECK(last_sequence BETWEEN 0 AND 31),
 finalized boolean NOT NULL,partial_deadline text NOT NULL,created_at text NOT NULL,PRIMARY KEY(session_id,focus_version,segment_id),
 FOREIGN KEY(session_id,focus_version) REFERENCES _dg_native_speaker_focus_origins(session_id,focus_version) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE _dg_native_speaker_pending(
 session_id text NOT NULL,focus_version bigint NOT NULL,segment_id text NOT NULL,chunks bigint NOT NULL CHECK(chunks BETWEEN 1 AND 16),
 characters bigint NOT NULL CHECK(characters BETWEEN 0 AND 1000),expires_at text NOT NULL,created_at text NOT NULL,PRIMARY KEY(session_id,focus_version,segment_id),
 FOREIGN KEY(session_id,focus_version,segment_id) REFERENCES _dg_native_speaker_streams(session_id,focus_version,segment_id)
);
CREATE INDEX native_speaker_pending_expiry ON _dg_native_speaker_pending(expires_at);
CREATE TRIGGER native_speaker_decision_immutable BEFORE UPDATE OR DELETE ON speaker_segment_decisions FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_speaker_ingress_immutable BEFORE UPDATE OR DELETE ON _dg_native_speaker_ingress FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_speaker_event_origin_immutable BEFORE UPDATE OR DELETE ON _dg_native_speaker_event_origins FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_speaker_event_signature_immutable BEFORE UPDATE OR DELETE ON _dg_native_speaker_event_signatures FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_speaker_message_source_immutable BEFORE UPDATE OR DELETE ON _dg_native_speaker_message_sources FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();

CREATE FUNCTION dg_native_speaker_event_actor(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;
BEGIN PERFORM dg_native_reception_runtime();meta:=dg_native_reception_meta(target,NULL);PERFORM dg_native_reception_admin(meta->>'workspaceId');RETURN meta;END;$dg$;
CREATE FUNCTION dg_native_speaker_partial(target text,focus_value bigint,segment_value text,characters_value bigint) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE current_value _dg_native_speaker_pending%ROWTYPE;stream_value _dg_native_speaker_streams%ROWTYPE;count_value bigint;chars_value bigint;
BEGIN
 SELECT * INTO stream_value FROM _dg_native_speaker_streams WHERE session_id=target AND focus_version=focus_value AND segment_id=segment_value;
 DELETE FROM _dg_native_speaker_pending WHERE session_id=target AND expires_at<=dg_utc_now();
 SELECT * INTO current_value FROM _dg_native_speaker_pending WHERE session_id=target AND focus_version=focus_value AND segment_id=segment_value;
 SELECT count(*),coalesce(sum(characters),0) INTO count_value,chars_value FROM _dg_native_speaker_pending WHERE session_id=target AND focus_version=focus_value AND segment_id<>segment_value;
 IF stream_value.session_id IS NULL OR stream_value.partial_deadline<=dg_utc_now() OR current_value.chunks>=16 OR current_value.session_id IS NULL AND count_value>=4 OR chars_value+characters_value>4000 THEN DELETE FROM _dg_native_speaker_pending WHERE session_id=target AND focus_version=focus_value AND segment_id=segment_value;RETURN false;END IF;
 IF current_value.session_id IS NULL THEN INSERT INTO _dg_native_speaker_pending VALUES(target,focus_value,segment_value,1,characters_value,stream_value.partial_deadline,dg_utc_now());ELSE UPDATE _dg_native_speaker_pending SET chunks=chunks+1,characters=characters_value WHERE session_id=target AND focus_version=focus_value AND segment_id=segment_value;END IF;RETURN true;
END;$dg$;

-- Signatures contain only a digest of the server HMAC. The private runtime key
-- and partial/non-target transcript never enter this database protocol.
CREATE FUNCTION dg_native_speaker_event_bind(target text,descriptor_digest text,signature_digest text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE o _dg_native_speaker_event_origins%ROWTYPE;
BEGIN
 SELECT * INTO o FROM _dg_native_speaker_event_origins WHERE decision_id=target;
 IF o.decision_id IS NULL OR o.actor_id IS DISTINCT FROM current_setting('digitalguide.actor_id',true) OR o.transaction_id<>pg_current_xact_id()::text OR descriptor_digest IS DISTINCT FROM dg_native_office_hash(o.descriptor) OR signature_digest IS NULL OR signature_digest !~ '^[a-f0-9]{64}$' THEN PERFORM dg_native_speaker_error('INVALID_SOURCE');END IF;
 PERFORM dg_native_speaker_event_actor(o.session_id);
 INSERT INTO _dg_native_speaker_event_signatures VALUES(target,descriptor_digest,signature_digest,dg_utc_now());
END;$dg$;

-- Historical proof is deliberately independent of the *current* reference.
-- Withdrawing a reference must stop new audio, without falsifying a previously
-- accepted statement or silently removing a separately confirmed preference.
CREATE FUNCTION dg_native_speaker_message_valid(m reception_messages) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT EXISTS(SELECT 1 FROM _dg_native_speaker_message_sources l JOIN _dg_native_speaker_event_origins o ON o.decision_id=l.decision_id JOIN _dg_native_speaker_event_signatures g ON g.decision_id=o.decision_id JOIN speaker_segment_decisions d ON d.id=o.decision_id
 WHERE l.decision_id=m.speaker_decision_id AND l.session_id=m.session_id AND l.focus_version=m.focus_version AND l.reply_epoch=m.reply_epoch
 AND o.session_id=l.session_id AND o.focus_version=l.focus_version AND g.descriptor_hash=dg_native_office_hash(o.descriptor)
 AND d.session_id=l.session_id AND d.focus_version=l.focus_version AND d.accepted=1 AND d.final=1 AND d.attribution='target' AND d.simulated=1
 AND o.descriptor->>'source'='mock_speaker_event' AND o.descriptor->'accepted'='true'::jsonb AND o.descriptor->'final'='true'::jsonb AND o.descriptor->>'attribution'='target'
 AND o.descriptor->>'questionId'=l.question_id AND o.descriptor->>'replyId'=l.reply_id AND o.descriptor->>'textHash'=l.text_hash AND o.descriptor->>'replyEpoch'=l.reply_epoch::text
 AND((m.id=l.question_id AND m.role='visitor' AND m.input_source='verified_mock_audio' AND(m.text='' AND m.status='cancelled' OR encode(sha256(convert_to(m.text,'UTF8')),'hex')=l.text_hash)) OR(m.id=l.reply_id AND m.role='assistant' AND m.input_source='system')))
$dg$;
CREATE FUNCTION dg_native_speaker_event_current(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE o _dg_native_speaker_event_origins%ROWTYPE;l _dg_native_speaker_message_sources%ROWTYPE;g _dg_native_speaker_event_signatures%ROWTYPE;s reception_sessions%ROWTYPE;f speaker_focus_sessions%ROWTYPE;r speaker_references%ROWTYPE;meta jsonb;policy jsonb;
BEGIN
 SELECT * INTO o FROM _dg_native_speaker_event_origins WHERE decision_id=target;SELECT * INTO l FROM _dg_native_speaker_message_sources WHERE decision_id=target;SELECT * INTO g FROM _dg_native_speaker_event_signatures WHERE decision_id=target;
 IF o.decision_id IS NULL OR l.decision_id IS NULL OR g.decision_id IS NULL OR o.actor_id IS DISTINCT FROM current_setting('digitalguide.actor_id',true) OR o.transaction_id<>pg_current_xact_id()::text OR g.descriptor_hash IS DISTINCT FROM dg_native_office_hash(o.descriptor) OR o.descriptor->'accepted' IS DISTINCT FROM 'true'::jsonb THEN PERFORM dg_native_speaker_error('INVALID_SOURCE');END IF;
 meta:=dg_native_speaker_event_actor(o.session_id);SELECT * INTO s FROM reception_sessions WHERE id=o.session_id;f:=dg_native_speaker_active(s.id);policy:=dg_native_speaker_policy(s.id);SELECT * INTO r FROM speaker_references WHERE id=f.reference_id;
 IF s.focus_version<>o.focus_version OR s.version::text IS DISTINCT FROM o.descriptor->>'sessionVersion' OR s.reply_epoch+1<>l.reply_epoch OR s.expires_at<=dg_utc_now() OR s.activity_at<=dg_native_people_iso(clock_timestamp()-interval '120 seconds') OR r.id IS NULL OR r.id IS DISTINCT FROM o.descriptor->>'referenceId' OR r.version::text IS DISTINCT FROM o.descriptor->>'referenceVersion' OR r.status NOT IN('pending','active') OR r.expires_at<=dg_utc_now() OR f.expires_at<=dg_utc_now() OR f.provider_id IS DISTINCT FROM policy->>'provider' OR f.extraction_id IS DISTINCT FROM policy->>'extraction' OR f.config_version::text IS DISTINCT FROM policy->>'configVersion' OR f.mode='enrolled' AND NOT dg_native_speaker_reference_valid(r.id) THEN PERFORM dg_native_speaker_error('VERSION_CONFLICT');END IF;
 IF o.descriptor->>'permitId' IS NOT NULL THEN
  IF f.fallback<>'ptt' OR NOT EXISTS(SELECT 1 FROM speaker_ptt_permits p WHERE p.id=o.descriptor->>'permitId' AND p.session_id=s.id AND p.focus_version=s.focus_version AND p.consumed_at=o.created_at AND p.expires_at>dg_utc_now() AND p.expires_at=o.descriptor->>'permitExpiry') THEN PERFORM dg_native_speaker_error('STATE_CONFLICT');END IF;
 ELSIF r.status<>'active' OR f.state<>'locked' OR f.usage_target_token IS NULL OR f.fallback='ptt' THEN PERFORM dg_native_speaker_error('STATE_CONFLICT');END IF;
 RETURN meta;
END;$dg$;
CREATE FUNCTION dg_native_speaker_event_context(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;o _dg_native_speaker_event_origins%ROWTYPE;access_hash text;visit_value jsonb;
BEGIN
 meta:=dg_native_speaker_event_current(target);SELECT * INTO o FROM _dg_native_speaker_event_origins WHERE decision_id=target;
 -- Existing guest context is reused internally; no capability or private
 -- recognition handle is returned to the staff event endpoint.
 SELECT token_hash INTO access_hash FROM _dg_native_reception_access WHERE session_id=o.session_id AND access_version=(meta->>'accessVersion')::bigint AND expires_at>dg_utc_now() ORDER BY created_at DESC LIMIT 1;
 IF access_hash IS NOT NULL THEN visit_value:=dg_native_visit_reply_context(o.session_id,access_hash);END IF;
 RETURN jsonb_build_object('meta',meta,'descriptor',o.descriptor,'signatureHash',(SELECT signature_hash FROM _dg_native_speaker_event_signatures WHERE decision_id=target),'memory',dg_native_guest_memory_private_context(o.session_id),'visit',visit_value);
END;$dg$;
CREATE FUNCTION dg_native_speaker_event_finish(target text,input jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;o _dg_native_speaker_event_origins%ROWTYPE;l _dg_native_speaker_message_sources%ROWTYPE;s reception_sessions%ROWTYPE;text_value text;reply_value text;citations_value jsonb;memory_value jsonb;
BEGIN
 meta:=dg_native_speaker_event_current(target);SELECT * INTO o FROM _dg_native_speaker_event_origins WHERE decision_id=target;SELECT * INTO l FROM _dg_native_speaker_message_sources WHERE decision_id=target;SELECT * INTO s FROM reception_sessions WHERE id=o.session_id;
 PERFORM dg_native_reception_fields(input,ARRAY['text','reply','citations','memory']);text_value:=input->>'text';reply_value:=input->>'reply';citations_value:=input->'citations';memory_value:=nullif(input->'memory','null'::jsonb);
 IF jsonb_typeof(input->'text') IS DISTINCT FROM 'string' OR text_value<>btrim(text_value) OR char_length(text_value) NOT BETWEEN 1 AND 1000 OR encode(sha256(convert_to(text_value,'UTF8')),'hex') IS DISTINCT FROM l.text_hash OR jsonb_typeof(input->'reply') IS DISTINCT FROM 'string' OR left(reply_value,3)<>'【模拟' OR char_length(reply_value)>12000 OR NOT dg_native_reception_citations_valid(s.id,citations_value) OR(memory_value IS NOT NULL AND NOT dg_native_guest_memory_proof(s.id,s.focus_version,memory_value)) THEN PERFORM dg_native_speaker_error('INVALID_SOURCE');END IF;
 IF(SELECT count(*) FROM reception_messages WHERE session_id=s.id AND role='visitor' AND created_at>=dg_native_people_iso(clock_timestamp()-interval '60 seconds'))>=20 THEN PERFORM dg_native_speaker_error('RATE_LIMITED');END IF;
 IF(SELECT count(*) FROM reception_messages WHERE session_id=s.id)+2>200 THEN PERFORM dg_native_reception_error('QUOTA_EXCEEDED');END IF;
 PERFORM dg_native_reception_cancel(s.id);
 INSERT INTO reception_messages(id,session_id,tenant_id,workspace_id,role,text,status,reply_epoch,focus_version,created_at,knowledge_citations,input_source,speaker_decision_id) VALUES(l.question_id,s.id,s.tenant_id,s.workspace_id,'visitor',text_value,'received',l.reply_epoch,s.focus_version,o.created_at,'[]','verified_mock_audio',target);
 INSERT INTO reception_messages(id,session_id,tenant_id,workspace_id,role,text,status,reply_epoch,focus_version,created_at,knowledge_citations,input_source,speaker_decision_id,memory_person_id,memory_fact_ids,native_memory_version) VALUES(l.reply_id,s.id,s.tenant_id,s.workspace_id,'assistant',reply_value,'ready',l.reply_epoch,s.focus_version,o.created_at,citations_value::text,'system',target,memory_value->>'personId',coalesce(memory_value->'factIds','[]')::text,(memory_value->>'version')::bigint);
 INSERT INTO _dg_native_reception_message_digests VALUES(l.question_id,dg_native_office_hash(dg_native_reception_message_payload(l.question_id))),(l.reply_id,dg_native_office_hash(dg_native_reception_message_payload(l.reply_id)));
 UPDATE reception_sessions SET version=version+1,reply_epoch=l.reply_epoch,activity_at=dg_utc_now() WHERE id=s.id;
 INSERT INTO outbox_events VALUES(gen_random_uuid()::text,s.tenant_id,s.workspace_id,s.id,'session.verified_mock_audio','mock','{}',dg_utc_now(),NULL);
END;$dg$;
CREATE FUNCTION dg_native_speaker_event_receipt(target text,session_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;r _dg_native_speaker_ingress%ROWTYPE;current_focus bigint;
BEGIN
 meta:=dg_native_speaker_event_actor(session_value);SELECT * INTO r FROM _dg_native_speaker_ingress WHERE id=target AND session_id=session_value AND actor_id=current_setting('digitalguide.actor_id',true);
 IF r.id IS NULL THEN PERFORM dg_native_speaker_error('NOT_FOUND');END IF;current_focus:=(meta->>'focusVersion')::bigint;
 IF r.focus_version<>current_focus THEN RETURN jsonb_build_object('accepted',false,'buffered',false,'interrupted',false,'reason','stale_focus','decisionId',NULL,'focusVersion',current_focus,'simulated',true);END IF;
 RETURN jsonb_build_object('accepted',r.accepted,'buffered',r.buffered,'interrupted',r.interrupted,'reason',r.reason,'decisionId',r.decision_id,'focusVersion',current_focus,'simulated',true);
END;$dg$;

CREATE FUNCTION dg_native_speaker_event_final() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE target text;o _dg_native_speaker_event_origins%ROWTYPE;g _dg_native_speaker_event_signatures%ROWTYPE;l _dg_native_speaker_message_sources%ROWTYPE;d speaker_segment_decisions%ROWTYPE;r _dg_native_speaker_ingress%ROWTYPE;q reception_messages%ROWTYPE;a reception_messages%ROWTYPE;
BEGIN
 target:=CASE WHEN TG_TABLE_NAME='speaker_segment_decisions' THEN to_jsonb(NEW)->>'id' ELSE coalesce(to_jsonb(NEW)->>'decision_id',to_jsonb(NEW)->>'speaker_decision_id') END;IF target IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO o FROM _dg_native_speaker_event_origins WHERE decision_id=target;SELECT * INTO g FROM _dg_native_speaker_event_signatures WHERE decision_id=target;SELECT * INTO d FROM speaker_segment_decisions WHERE id=target;SELECT * INTO r FROM _dg_native_speaker_ingress WHERE decision_id=target;SELECT * INTO l FROM _dg_native_speaker_message_sources WHERE decision_id=target;
 IF o.decision_id IS NULL OR g.decision_id IS NULL OR d.id IS NULL OR r.id IS NULL OR g.descriptor_hash IS DISTINCT FROM dg_native_office_hash(o.descriptor) OR o.ingress_id<>r.id OR o.session_id<>d.session_id OR o.focus_version<>d.focus_version OR r.actor_id<>o.actor_id OR r.accepted<>(d.accepted=1) OR r.interrupted<>(d.interrupted=1) OR r.reason<>d.reason OR o.descriptor->>'decisionId' IS DISTINCT FROM d.id OR o.descriptor->>'sessionId' IS DISTINCT FROM d.session_id OR o.descriptor->>'actorId' IS DISTINCT FROM o.actor_id OR o.descriptor->>'focusVersion' IS DISTINCT FROM d.focus_version::text OR o.descriptor->>'segmentId' IS DISTINCT FROM d.segment_id OR o.descriptor->>'sequence' IS DISTINCT FROM d.sequence::text OR o.descriptor->>'fixture' IS DISTINCT FROM d.fixture OR o.descriptor->>'attribution' IS DISTINCT FROM d.attribution OR o.descriptor->>'final' IS DISTINCT FROM(d.final=1)::text OR o.descriptor->>'accepted' IS DISTINCT FROM(d.accepted=1)::text OR o.descriptor->>'reason' IS DISTINCT FROM d.reason OR d.simulated<>1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Speaker event requires the original signed synthetic decision';END IF;
 IF d.accepted=1 THEN
  SELECT * INTO q FROM reception_messages WHERE id=l.question_id;SELECT * INTO a FROM reception_messages WHERE id=l.reply_id;
  IF l.decision_id IS NULL OR q.id IS NULL OR a.id IS NULL OR NOT dg_native_speaker_message_valid(q) OR NOT dg_native_speaker_message_valid(a) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Accepted audio, question, reply and provenance must commit atomically';END IF;
 ELSIF l.decision_id IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Filtered speaker event cannot own a transcript or reply';END IF;RETURN NULL;
END;$dg$;
CREATE CONSTRAINT TRIGGER native_speaker_event_origin_final AFTER INSERT ON _dg_native_speaker_event_origins DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_speaker_event_final();
CREATE CONSTRAINT TRIGGER native_speaker_event_signature_final AFTER INSERT ON _dg_native_speaker_event_signatures DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_speaker_event_final();
CREATE CONSTRAINT TRIGGER native_speaker_event_source_final AFTER INSERT ON _dg_native_speaker_message_sources DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_speaker_event_final();
CREATE CONSTRAINT TRIGGER native_speaker_event_message_final AFTER INSERT OR UPDATE ON reception_messages DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_speaker_event_final();
CREATE CONSTRAINT TRIGGER native_speaker_event_decision_final AFTER INSERT ON speaker_segment_decisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_speaker_event_final();
CREATE FUNCTION dg_native_speaker_event_prepare(target text,input jsonb,hint jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;s reception_sessions%ROWTYPE;f speaker_focus_sessions%ROWTYPE;r speaker_references%ROWTYPE;policy jsonb;stream_value _dg_native_speaker_streams%ROWTYPE;permit speaker_ptt_permits%ROWTYPE;
 ingress_value text:=gen_random_uuid()::text;decision_value text;question_value text;reply_value text;now_value text:=dg_utc_now();text_value text;hash_value text;descriptor_value jsonb;
 fixture_value text;sequence_value bigint;focus_value bigint;attribution_value text;reason_value text;final_value boolean;early_value boolean;started_value boolean;lost_value boolean;requires_ptt boolean;usable_value boolean;
 accepted_value boolean:=false;interrupted_value boolean:=false;buffered_value boolean:=false;epoch_value bigint;
BEGIN
 meta:=dg_native_speaker_event_actor(target);PERFORM dg_native_speaker_check_hint(target,hint);
 PERFORM dg_native_reception_fields(input,ARRAY['focusVersion','segmentId','sequence','fixture','text','source']);
 IF input->>'source' IS DISTINCT FROM 'mock_speaker_event' OR jsonb_typeof(input->'focusVersion') IS DISTINCT FROM 'number' OR input->>'focusVersion' !~ '^[0-9]{1,16}$' OR jsonb_typeof(input->'sequence') IS DISTINCT FROM 'number' OR input->>'sequence' !~ '^[0-9]{1,2}$' OR coalesce(input->>'segmentId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' OR jsonb_typeof(input->'text') IS DISTINCT FROM 'string' OR char_length(input->>'text')>1000 THEN PERFORM dg_native_speaker_error('VALIDATION_FAILED');END IF;
 fixture_value:=input->>'fixture';focus_value:=(input->>'focusVersion')::bigint;sequence_value:=(input->>'sequence')::bigint;text_value:=btrim(input->>'text');
 IF sequence_value>31 OR fixture_value IS NULL OR fixture_value NOT IN('target_partial','target_final','target_crowd_final','other_partial','other_final','other_louder','uncertain_final','overlap_final','echo_final','noise_final','target_speech_started','other_speech_started','tracking_lost','ptt_target_final','replay_match_final') THEN PERFORM dg_native_speaker_error('VALIDATION_FAILED');END IF;
 SELECT * INTO s FROM reception_sessions WHERE id=target;PERFORM dg_native_reception_workspace(s.tenant_id,s.workspace_id,true);PERFORM id FROM reception_terminals WHERE id=s.terminal_id FOR UPDATE;SELECT * INTO s FROM reception_sessions WHERE id=target FOR UPDATE;
 IF(SELECT count(*) FROM _dg_native_speaker_ingress WHERE session_id=target AND created_at>=dg_native_people_iso(clock_timestamp()-interval '60 seconds'))>=500 THEN PERFORM dg_native_speaker_error('RATE_LIMITED');END IF;
 IF(SELECT count(*) FROM _dg_native_speaker_ingress WHERE session_id=target)>=2000 THEN PERFORM dg_native_speaker_error('EVENT_QUOTA_EXCEEDED');END IF;
 IF focus_value<>s.focus_version THEN reason_value:='stale_focus';
 ELSE
  f:=dg_native_speaker_active(target);policy:=dg_native_speaker_policy(target);SELECT * INTO r FROM speaker_references WHERE id=f.reference_id;
  IF s.expires_at<=now_value OR s.activity_at<=dg_native_people_iso(clock_timestamp()-interval '120 seconds') OR r.id IS NULL OR r.status NOT IN('active','pending') OR r.expires_at<=now_value OR f.mode='enrolled' AND NOT dg_native_speaker_reference_valid(r.id) THEN PERFORM dg_native_speaker_error('REFERENCE_EXPIRED');END IF;
  SELECT * INTO stream_value FROM _dg_native_speaker_streams WHERE session_id=target AND focus_version=focus_value AND segment_id=input->>'segmentId';
  IF EXISTS(SELECT 1 FROM speaker_segment_decisions WHERE session_id=target AND focus_version=focus_value AND segment_id=input->>'segmentId' AND(final=1 OR sequence>=sequence_value)) THEN reason_value:='duplicate_or_out_of_order';
  ELSE
   early_value:=policy->>'early'='true';final_value:=fixture_value LIKE '%final' OR fixture_value='other_louder';started_value:=fixture_value LIKE '%speech_started';lost_value:=fixture_value='tracking_lost';requires_ptt:=fixture_value='ptt_target_final';
   attribution_value:=CASE WHEN(NOT final_value AND NOT early_value) OR fixture_value IN('uncertain_final','overlap_final','tracking_lost') THEN 'uncertain' WHEN fixture_value LIKE 'target_%' OR requires_ptt OR fixture_value='replay_match_final' THEN 'target' WHEN fixture_value LIKE 'other_%' OR fixture_value IN('echo_final','noise_final') THEN 'other' ELSE 'uncertain' END;
   usable_value:=fixture_value NOT IN('overlap_final','uncertain_final','noise_final','echo_final');reason_value:='mock_attribution';
   INSERT INTO _dg_native_speaker_streams VALUES(target,focus_value,input->>'segmentId',sequence_value,final_value,least(f.expires_at,dg_native_people_iso(now_value::timestamptz+interval '5 seconds')),now_value) ON CONFLICT(session_id,focus_version,segment_id) DO UPDATE SET last_sequence=excluded.last_sequence,finalized=excluded.finalized;
   IF lost_value THEN DELETE FROM _dg_native_speaker_pending WHERE session_id=target;UPDATE speaker_focus_sessions SET state='uncertain',last_reason='tracking_lost',updated_at=now_value WHERE session_id=target;reason_value:='tracking_lost';
   ELSIF f.fallback='ptt' AND NOT requires_ptt THEN reason_value:='ptt_confirmation_required';
   ELSIF requires_ptt THEN
    SELECT * INTO permit FROM speaker_ptt_permits WHERE session_id=target AND focus_version=focus_value AND consumed_at IS NULL AND expires_at>now_value ORDER BY created_at LIMIT 1 FOR UPDATE;
    IF f.fallback='ptt' AND permit.id IS NOT NULL AND text_value<>'' THEN accepted_value:=true;reason_value:='ptt_target_confirmed_mock';ELSE reason_value:='ptt_confirmation_required';END IF;
   ELSIF f.state<>'locked' OR f.usage_target_token IS NULL THEN reason_value:='focus_not_locked';
   ELSIF started_value THEN
    IF attribution_value='target' AND early_value THEN SELECT EXISTS(SELECT 1 FROM reception_messages WHERE session_id=target AND role='assistant' AND status IN('ready','playing')) INTO interrupted_value;PERFORM dg_native_reception_cancel(target);UPDATE reception_sessions SET reply_epoch=reply_epoch+1,version=version+1 WHERE id=target;reason_value:='target_barge_in_mock';ELSE reason_value:=CASE WHEN attribution_value='other' THEN 'non_target_speech' ELSE 'early_attribution_unavailable' END;END IF;
   ELSIF NOT final_value THEN
    IF attribution_value='other' THEN DELETE FROM _dg_native_speaker_pending WHERE session_id=target AND focus_version=focus_value AND segment_id=input->>'segmentId';reason_value:='non_target_partial';ELSE buffered_value:=dg_native_speaker_partial(target,focus_value,input->>'segmentId',char_length(input->>'text'));reason_value:=CASE WHEN buffered_value THEN 'awaiting_final' ELSE 'partial_buffer_limit' END;END IF;
   ELSIF NOT usable_value THEN
    reason_value:=CASE fixture_value WHEN 'overlap_final' THEN 'overlap_not_separable' WHEN 'uncertain_final' THEN 'attribution_uncertain' WHEN 'echo_final' THEN 'self_echo' ELSE 'background_noise' END;
    IF fixture_value IN('overlap_final','uncertain_final') THEN DELETE FROM _dg_native_speaker_pending WHERE session_id=target;UPDATE speaker_focus_sessions SET state='uncertain',last_reason=reason_value,updated_at=now_value WHERE session_id=target;END IF;
   ELSIF attribution_value<>'target' THEN reason_value:='non_target_final';
   ELSIF text_value='' THEN reason_value:='empty_final';ELSE accepted_value:=true;reason_value:='target_final_confirmed_mock';END IF;
   IF final_value OR lost_value THEN DELETE FROM _dg_native_speaker_pending WHERE session_id=target AND(lost_value OR segment_id=input->>'segmentId');END IF;
   IF accepted_value THEN
    IF(SELECT count(*) FROM reception_messages WHERE session_id=target AND role='visitor' AND created_at>=dg_native_people_iso(clock_timestamp()-interval '60 seconds'))>=20 THEN accepted_value:=false;reason_value:='rate_limited';ELSIF(SELECT count(*) FROM reception_messages WHERE session_id=target)+2>200 THEN accepted_value:=false;reason_value:='quota_exceeded';END IF;
   END IF;
   decision_value:=gen_random_uuid()::text;
   IF accepted_value THEN IF requires_ptt THEN UPDATE speaker_ptt_permits SET consumed_at=now_value WHERE id=permit.id;END IF;SELECT EXISTS(SELECT 1 FROM reception_messages WHERE session_id=target AND role='assistant' AND status='playing') INTO interrupted_value;question_value:=gen_random_uuid()::text;reply_value:=gen_random_uuid()::text;hash_value:=encode(sha256(convert_to(text_value,'UTF8')),'hex');epoch_value:=s.reply_epoch+1;END IF;
   INSERT INTO speaker_segment_decisions(id,session_id,focus_version,segment_id,sequence,fixture,attribution,final,accepted,interrupted,reason,simulated,elapsed_ms,created_at) VALUES(decision_value,target,focus_value,input->>'segmentId',sequence_value,fixture_value,CASE WHEN accepted_value THEN 'target' ELSE attribution_value END,final_value::integer,accepted_value::integer,interrupted_value::integer,reason_value,1,0,now_value);
   descriptor_value:=jsonb_build_object('decisionId',decision_value,'ingressId',ingress_value,'sessionId',target,'tenantId',s.tenant_id,'workspaceId',s.workspace_id,'actorId',current_setting('digitalguide.actor_id',true),'sessionVersion',s.version,'focusVersion',focus_value,'source','mock_speaker_event','provider',f.provider_id,'extraction',f.extraction_id,'configVersion',f.config_version,'channel',f.source_channel_id,'referenceId',r.id,'referenceScope',r.scope,'referenceVersion',r.version,'referenceExpiry',r.expires_at,'focusExpiry',f.expires_at,'segmentId',input->>'segmentId','sequence',sequence_value,'fixture',fixture_value,'attribution',CASE WHEN accepted_value THEN 'target' ELSE attribution_value END,'final',final_value,'accepted',accepted_value,'reason',reason_value,'questionId',question_value,'replyId',reply_value,'replyEpoch',epoch_value,'textHash',hash_value,'capturedAt',now_value,'permitId',CASE WHEN accepted_value AND requires_ptt THEN permit.id END,'permitExpiry',CASE WHEN accepted_value AND requires_ptt THEN permit.expires_at END);
  END IF;
 END IF;
 INSERT INTO _dg_native_speaker_ingress VALUES(ingress_value,target,current_setting('digitalguide.actor_id',true),focus_value,decision_value,accepted_value,buffered_value,interrupted_value,reason_value,now_value,pg_current_xact_id()::text);
 IF decision_value IS NOT NULL THEN
  INSERT INTO _dg_native_speaker_event_origins VALUES(decision_value,ingress_value,target,focus_value,current_setting('digitalguide.actor_id',true),descriptor_value,now_value,pg_current_xact_id()::text);
  IF accepted_value THEN INSERT INTO _dg_native_speaker_message_sources VALUES(decision_value,question_value,reply_value,target,focus_value,epoch_value,hash_value,now_value);END IF;
 END IF;
 RETURN jsonb_build_object('id',ingress_value,'accepted',accepted_value,'descriptor',descriptor_value);
END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_reception_message_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE v_session reception_sessions%ROWTYPE;
BEGIN
 SELECT * INTO v_session FROM reception_sessions WHERE id=NEW.session_id;
 IF v_session.id IS NULL OR NEW.tenant_id<>v_session.tenant_id OR NEW.workspace_id<>v_session.workspace_id OR (NEW.memory_person_id IS NULL AND(NEW.memory_fact_ids<>'[]' OR NEW.native_memory_version IS NOT NULL)) OR(NEW.memory_person_id IS NOT NULL AND(NEW.role<>'assistant' OR NEW.native_memory_version IS NULL OR NEW.native_memory_version<1 OR jsonb_typeof(NEW.memory_fact_ids::jsonb)<>'array')) OR NEW.visual_context IS NOT NULL OR NEW.restaurant_context IS NOT NULL OR(NEW.speaker_decision_id IS NULL AND NEW.input_source IS DISTINCT FROM(CASE WHEN NEW.role='visitor' THEN 'typed' ELSE 'system' END)) OR(NEW.speaker_decision_id IS NOT NULL AND NOT dg_native_speaker_message_valid(NEW)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Reception message needs its bound session and supported input proof';END IF;
 IF TG_OP='INSERT' THEN IF NEW.speaker_decision_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM _dg_native_speaker_event_origins WHERE decision_id=NEW.speaker_decision_id AND transaction_id=pg_current_xact_id()::text) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Audio messages must be inserted in their originating event transaction';END IF;IF NEW.memory_person_id IS NOT NULL AND NOT dg_native_guest_memory_proof(NEW.session_id,NEW.focus_version,jsonb_build_object('personId',NEW.memory_person_id,'version',NEW.native_memory_version,'factIds',NEW.memory_fact_ids::jsonb)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Personalized reply requires the current explicitly confirmed subject and facts';END IF;IF NEW.focus_version<>v_session.focus_version OR NEW.reply_epoch NOT BETWEEN v_session.reply_epoch AND v_session.reply_epoch+1 OR NEW.status IS DISTINCT FROM(CASE WHEN NEW.role='assistant' THEN 'ready' ELSE 'received' END) OR char_length(NEW.text)=0 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Reception message starts from the current typed turn or fixed greeting';END IF;
 ELSE
  IF to_jsonb(NEW)-ARRAY['text','status','knowledge_citations'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['text','status','knowledge_citations'] OR OLD.status='cancelled' AND NEW.status<>'cancelled' OR NEW.text IS DISTINCT FROM OLD.text AND NEW.text<>'' OR NEW.knowledge_citations IS DISTINCT FROM OLD.knowledge_citations AND NEW.knowledge_citations<>'[]' OR NEW.text='' AND NEW.status<>'cancelled' OR NEW.text<>'' AND NEW.knowledge_citations IS DISTINCT FROM OLD.knowledge_citations THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Messages cannot be retargeted, rewritten or replayed after cancellation';END IF;
  IF NEW.text<>'' AND NOT(NEW.status=OLD.status OR NEW.role='assistant' AND((OLD.status='ready' AND NEW.status IN('playing','cancelled')) OR(OLD.status='playing' AND NEW.status IN('completed','cancelled')) OR(OLD.status='completed' AND NEW.status='cancelled'))) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Unsupported reply playback transition';END IF;
 END IF;RETURN NEW;
END;$dg$;

CREATE OR REPLACE FUNCTION dg_native_guest_memory_source(person_value text,session_value text,focus_value bigint,messages_value jsonb,value_value text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE item text;m reception_messages%ROWTYPE;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM people p JOIN memory_session_links l ON l.person_id=p.id JOIN reception_sessions s ON s.id=l.session_id WHERE p.id=person_value AND p.guest_session_id=session_value AND l.session_id=session_value AND l.focus_version=focus_value AND s.focus_version=focus_value AND s.status='active' AND s.expires_at>dg_utc_now() AND s.activity_at>dg_native_people_iso(clock_timestamp()-interval '120 seconds') AND l.transcript_expires_at>dg_utc_now() AND dg_native_reception_source_valid(s.id)) OR jsonb_typeof(messages_value) IS DISTINCT FROM 'array' OR jsonb_array_length(messages_value)>20 THEN PERFORM dg_native_people_error('INVALID_SOURCE');END IF;
 FOR item IN SELECT jsonb_array_elements_text(messages_value) LOOP
  SELECT * INTO m FROM reception_messages WHERE id=item AND session_id=session_value AND focus_version=focus_value AND role='visitor' AND text<>'' AND(input_source='typed' AND speaker_decision_id IS NULL OR input_source='verified_mock_audio' AND speaker_decision_id IS NOT NULL);
  IF m.id IS NULL OR m.input_source='verified_mock_audio' AND NOT dg_native_speaker_message_valid(m) OR dg_native_guest_memory_transcript_deadline(session_value,focus_value)<=dg_utc_now() OR value_value IS NOT NULL AND strpos(m.text,value_value)=0 THEN PERFORM dg_native_people_error('INVALID_SOURCE');END IF;
 END LOOP;
END;$dg$;

CREATE OR REPLACE FUNCTION dg_native_speaker_projection(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s reception_sessions%ROWTYPE;f speaker_focus_sessions%ROWTYPE;r speaker_references%ROWTYPE;policy jsonb;capabilities_value jsonb;
BEGIN
 SELECT * INTO STRICT s FROM reception_sessions WHERE id=target;SELECT * INTO f FROM speaker_focus_sessions WHERE session_id=target;SELECT * INTO r FROM speaker_references WHERE id=f.reference_id;policy:=dg_native_speaker_policy(target,false);
 IF policy IS NOT NULL THEN capabilities_value:=jsonb_build_object('attributionTiming',CASE WHEN policy->>'early'='true' THEN 'early' ELSE 'final' END,'targetBargeIn',policy->'early','targetExtraction','simulated','overlap','reject','processingLocation','local_mock');END IF;
 RETURN jsonb_build_object('state',coalesce(f.state,'idle'),'enabled',policy IS NOT NULL,'configured',policy IS NOT NULL,'simulated',policy IS NOT NULL OR f.session_id IS NOT NULL,'mode',f.mode,'focusVersion',s.focus_version,'sessionVersion',s.version,'fallback',coalesce(f.fallback,'text'),'reason',coalesce(f.last_reason,CASE WHEN policy IS NULL THEN 'not_configured' ELSE 'not_started' END),'reference',CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object('scope',r.scope,'status',r.status,'quality',f.quality,'expiresAt',f.expires_at) END,'capabilities',capabilities_value,'pttReady',EXISTS(SELECT 1 FROM speaker_ptt_permits WHERE session_id=target AND focus_version=s.focus_version AND consumed_at IS NULL AND expires_at>dg_utc_now()),'counts',jsonb_build_object('accepted',(SELECT count(*) FROM speaker_segment_decisions WHERE session_id=target AND focus_version=s.focus_version AND accepted=1),'rejected',(SELECT count(*) FROM speaker_segment_decisions WHERE session_id=target AND focus_version=s.focus_version AND accepted=0 AND reason<>'awaiting_final'),'buffered',(SELECT count(*) FROM _dg_native_speaker_pending WHERE session_id=target AND focus_version=s.focus_version AND expires_at>dg_utc_now())));
END;$dg$;


CREATE FUNCTION dg_native_speaker_pending_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NEW.focus_version IS DISTINCT FROM OLD.focus_version OR NEW.reference_id IS DISTINCT FROM OLD.reference_id OR NEW.fallback IS DISTINCT FROM OLD.fallback OR NEW.state IN('ended','idle','uncertain','reacquiring','handoff_pending') THEN
  DELETE FROM _dg_native_speaker_pending WHERE session_id=NEW.session_id;DELETE FROM _dg_native_speaker_streams WHERE session_id=NEW.session_id;
 END IF;RETURN NULL;
END;$dg$;
CREATE TRIGGER native_speaker_pending_changed AFTER UPDATE ON speaker_focus_sessions FOR EACH ROW EXECUTE FUNCTION dg_native_speaker_pending_changed();
ALTER FUNCTION dg_native_speaker_sweep() RENAME TO dg_native_speaker_sweep_before_events;
CREATE FUNCTION dg_native_speaker_sweep() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE changed bigint;affected bigint;p record;
BEGIN
 changed:=dg_native_speaker_sweep_before_events();
 -- This cleanup does not take parent or reference locks after child locks.
 -- A workspace skipped by the existing sweep must not block this worker.
 FOR p IN SELECT session_id,focus_version,segment_id FROM _dg_native_speaker_pending WHERE expires_at<=dg_utc_now() ORDER BY session_id,focus_version,segment_id FOR UPDATE SKIP LOCKED LOOP
  DELETE FROM _dg_native_speaker_pending WHERE session_id=p.session_id AND focus_version=p.focus_version AND segment_id=p.segment_id;GET DIAGNOSTICS affected=ROW_COUNT;changed:=changed+affected;
 END LOOP;RETURN changed;
END;$dg$;
DO $dg$ DECLARE r record;role_value text;BEGIN
 FOR r IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND p.proname LIKE 'dg_native_speaker_%' LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||r.signature||' FROM PUBLIC';END LOOP;
 FOR role_value IN SELECT app_role FROM _dg_native_runtime_control UNION SELECT worker_role FROM _dg_native_runtime_control LOOP EXECUTE format('REVOKE ALL ON FUNCTION dg_native_speaker_sweep_before_events() FROM %I',role_value);END LOOP;
END;$dg$;
