-- R-035/R-051/R-052. Current-visit on-site greetings are a separate purpose.
CREATE TABLE _dg_native_proactive_settings(
 id text PRIMARY KEY,session_id text NOT NULL REFERENCES reception_sessions(id),version bigint NOT NULL CHECK(version>0),
 runtime_id text NOT NULL,tenant_id text NOT NULL,workspace_id text NOT NULL,restaurant_id text NOT NULL REFERENCES restaurants(id),
 access_id text NOT NULL REFERENCES _dg_native_reception_access(id),access_version bigint NOT NULL,focus_version bigint NOT NULL,
 selection_version bigint NOT NULL,party_id text REFERENCES dining_parties(id),party_access_version bigint,
 enabled boolean NOT NULL,do_not_disturb boolean NOT NULL,quiet_start text NOT NULL,quiet_end text NOT NULL,
 cooldown_minutes bigint NOT NULL CHECK(cooldown_minutes BETWEEN 5 AND 1440),use_public_nickname boolean NOT NULL,
 person_id text REFERENCES people(id),purpose text NOT NULL CHECK(purpose='onsite_greeting'),notice_version text NOT NULL CHECK(notice_version='proactive-v1'),
 consent_at text,expires_at text NOT NULL,created_at text NOT NULL,transaction_id text NOT NULL,
 UNIQUE(session_id,version),CHECK(quiet_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND quiet_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
 CHECK((enabled AND consent_at=created_at) OR(NOT enabled AND consent_at IS NULL)),
 CHECK((use_public_nickname AND person_id IS NOT NULL) OR(NOT use_public_nickname AND person_id IS NULL)),
 CHECK((party_id IS NULL)=(party_access_version IS NULL))
);
CREATE TABLE _dg_native_proactive_greetings(
 id text PRIMARY KEY,settings_id text NOT NULL REFERENCES _dg_native_proactive_settings(id),session_id text NOT NULL REFERENCES reception_sessions(id),
 message_id text NOT NULL UNIQUE REFERENCES reception_messages(id),focus_version bigint NOT NULL,reply_epoch bigint NOT NULL,
 person_id text REFERENCES people(id),person_version bigint,created_at text NOT NULL,expires_at text NOT NULL,transaction_id text NOT NULL,
 CHECK((person_id IS NULL)=(person_version IS NULL))
);
CREATE TRIGGER native_proactive_settings_immutable BEFORE UPDATE OR DELETE ON _dg_native_proactive_settings FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_proactive_greetings_immutable BEFORE UPDATE OR DELETE ON _dg_native_proactive_greetings FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();

CREATE FUNCTION dg_native_proactive_error(code_value text) RETURNS void LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='DGPROACTIVE:'||code_value;END;$dg$;
CREATE FUNCTION dg_native_proactive_quiet(start_value text,end_value text,zone_value text) RETURNS boolean LANGUAGE sql SET search_path FROM CURRENT AS $dg$
 SELECT start_value=end_value OR(start_value<end_value AND t>=start_value AND t<end_value) OR(start_value>end_value AND(t>=start_value OR t<end_value)) FROM(SELECT to_char(clock_timestamp() AT TIME ZONE zone_value,'HH24:MI') t) q
$dg$;

CREATE FUNCTION dg_native_proactive_reason(r _dg_native_proactive_settings,delivery_value boolean DEFAULT true) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s reception_sessions%ROWTYPE;store restaurants%ROWTYPE;p people%ROWTYPE;party dining_parties%ROWTYPE;local_value timestamp;minute_value bigint;last_value timestamptz;
BEGIN
 IF r.id IS NULL THEN RETURN 'no_consent';END IF;
 SELECT * INTO s FROM reception_sessions WHERE id=r.session_id;
 IF s.id IS NULL OR s.service_scene<>'restaurant' OR s.status<>'active' OR s.expires_at::timestamptz<=clock_timestamp() OR s.activity_at::timestamptz<=clock_timestamp()-interval '120 seconds' THEN RETURN 'session_unavailable';END IF;
 IF r.runtime_id IS DISTINCT FROM(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1) OR r.tenant_id<>s.tenant_id OR r.workspace_id<>s.workspace_id OR r.access_version<>s.access_version OR r.focus_version<>s.focus_version OR r.party_id IS DISTINCT FROM s.dining_party_id OR r.selection_version<>coalesce((SELECT max(version) FROM _dg_native_dining_selection_revisions WHERE session_id=s.id),0) OR NOT dg_native_reception_source_valid(s.id) THEN RETURN 'context_changed';END IF;
 IF NOT EXISTS(SELECT 1 FROM _dg_native_reception_access a WHERE a.id=r.access_id AND a.session_id=s.id AND a.access_version=s.access_version AND a.expires_at::timestamptz>clock_timestamp()) THEN RETURN 'access_changed';END IF;
 IF r.id IS DISTINCT FROM(SELECT id FROM _dg_native_proactive_settings WHERE session_id=s.id ORDER BY version DESC LIMIT 1) THEN RETURN 'settings_changed';END IF;
 IF NOT r.enabled OR r.consent_at IS NULL THEN RETURN 'disabled';END IF;
 IF r.expires_at::timestamptz<=clock_timestamp() THEN RETURN 'expired';END IF;
 IF r.do_not_disturb THEN RETURN 'do_not_disturb';END IF;
 SELECT * INTO store FROM restaurants WHERE id=r.restaurant_id;
 IF store.id IS NULL OR store.tenant_id<>s.tenant_id OR store.workspace_id<>s.workspace_id OR NOT EXISTS(SELECT 1 FROM _dg_native_dining_session_origins WHERE session_id=s.id AND restaurant_id=store.id) THEN RETURN 'context_changed';END IF;
 local_value:=clock_timestamp() AT TIME ZONE store.timezone;minute_value:=extract(hour FROM local_value)::bigint*60+extract(minute FROM local_value)::bigint;
 IF store.accepting_guests<>1 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(store.opening_windows::jsonb) w WHERE w->'days' @> to_jsonb(ARRAY[extract(dow FROM local_value)::bigint]) AND(w->>'startMinute')::bigint<=minute_value AND(w->>'endMinute')::bigint>minute_value) THEN RETURN 'restaurant_paused';END IF;
 IF dg_native_proactive_quiet(r.quiet_start,r.quiet_end,store.timezone) THEN RETURN 'quiet_hours';END IF;
 IF r.party_id IS NOT NULL THEN SELECT * INTO party FROM dining_parties WHERE id=r.party_id;IF party.id IS NULL OR party.owner_session_id<>s.id OR party.restaurant_id<>store.id OR party.access_version<>r.party_access_version OR party.status NOT IN('waiting','reserved','held','seated') THEN RETURN 'party_changed';END IF;END IF;
 SELECT p0.* INTO p FROM people p0 JOIN memory_session_links l ON l.person_id=p0.id AND l.session_id=s.id AND l.focus_version=s.focus_version JOIN _dg_native_people_guards g ON g.person_id=p0.id AND g.invalidated_at IS NULL WHERE p0.guest_session_id=s.id AND p0.status='active' AND p0.expires_at::timestamptz>clock_timestamp();
 IF p.id IS NOT NULL THEN
  IF NOT dg_native_food_memory_scope_matches(p.id,s.id) THEN RETURN 'memory_unavailable';END IF;
  IF p.do_not_disturb=1 THEN RETURN 'do_not_disturb';END IF;
  IF dg_native_proactive_quiet(p.quiet_start,p.quiet_end,store.timezone) THEN RETURN 'quiet_hours';END IF;
 END IF;
 IF r.use_public_nickname AND(p.id IS NULL OR p.id IS DISTINCT FROM r.person_id OR p.personalization<>1) THEN RETURN 'memory_unavailable';END IF;
 IF delivery_value THEN
  SELECT max(created_at::timestamptz) INTO last_value FROM _dg_native_proactive_greetings WHERE session_id=s.id AND focus_version=s.focus_version;
  IF last_value IS NOT NULL AND clock_timestamp()<last_value+make_interval(mins=>r.cooldown_minutes::integer) OR p.id IS NOT NULL AND p.last_greeted_at IS NOT NULL AND clock_timestamp()<p.last_greeted_at::timestamptz+make_interval(mins=>p.cooldown_minutes::integer) THEN RETURN 'cooldown';END IF;
  IF s.activity_at::timestamptz>clock_timestamp()-interval '3 seconds' OR EXISTS(SELECT 1 FROM reception_messages WHERE session_id=s.id AND role='assistant' AND status IN('ready','playing')) OR EXISTS(SELECT 1 FROM _dg_native_service_suggestions proposal WHERE proposal.session_id=s.id AND proposal.reply_epoch=s.reply_epoch AND proposal.expires_at::timestamptz>clock_timestamp() AND NOT EXISTS(SELECT 1 FROM _dg_native_service_confirmations WHERE suggestion_id=proposal.id)) THEN RETURN 'busy';END IF;
  IF(SELECT count(*) FROM reception_messages WHERE session_id=s.id)>=200 THEN RETURN 'message_limit';END IF;
 END IF;
 RETURN NULL;
END;$dg$;

CREATE FUNCTION dg_native_proactive_settings_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s reception_sessions%ROWTYPE;
BEGIN
 SELECT * INTO s FROM reception_sessions WHERE id=NEW.session_id;
 IF session_user IS DISTINCT FROM(SELECT app_role FROM _dg_native_runtime_control WHERE id=1) OR NEW.transaction_id IS DISTINCT FROM pg_current_xact_id()::text OR NEW.runtime_id IS DISTINCT FROM(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1) OR s.id IS NULL OR s.service_scene<>'restaurant' OR s.status<>'active' OR NEW.tenant_id<>s.tenant_id OR NEW.workspace_id<>s.workspace_id OR NEW.access_version<>s.access_version OR NEW.focus_version<>s.focus_version OR NEW.party_id IS DISTINCT FROM s.dining_party_id OR NEW.expires_at<>s.expires_at OR NEW.selection_version<>coalesce((SELECT max(version) FROM _dg_native_dining_selection_revisions WHERE session_id=s.id),0) OR NEW.version<>coalesce((SELECT max(version) FROM _dg_native_proactive_settings WHERE session_id=s.id),0)+1 OR NOT dg_native_reception_source_valid(s.id) OR NOT EXISTS(SELECT 1 FROM _dg_native_reception_access a WHERE a.id=NEW.access_id AND a.session_id=s.id AND a.access_version=s.access_version AND a.expires_at::timestamptz>clock_timestamp()) OR NOT EXISTS(SELECT 1 FROM _dg_native_dining_session_origins WHERE session_id=s.id AND restaurant_id=NEW.restaurant_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Proactive consent requires the current guest action, scope and original deadline';END IF;
 IF NEW.party_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dining_parties WHERE id=NEW.party_id AND restaurant_id=NEW.restaurant_id AND owner_session_id=s.id AND access_version=NEW.party_access_version) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Proactive consent cannot target another dining party';END IF;
 IF NEW.person_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM people p JOIN memory_session_links l ON l.person_id=p.id WHERE p.id=NEW.person_id AND p.guest_session_id=s.id AND l.session_id=s.id AND l.focus_version=s.focus_version AND p.status='active' AND p.personalization=1 AND p.expires_at::timestamptz>clock_timestamp() AND dg_native_food_memory_scope_matches(p.id,s.id)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Public nickname use needs current separately authorized memory';END IF;
 RETURN NEW;
END;$dg$;
CREATE TRIGGER native_proactive_settings_guard BEFORE INSERT ON _dg_native_proactive_settings FOR EACH ROW EXECUTE FUNCTION dg_native_proactive_settings_guard();

CREATE FUNCTION dg_native_proactive_greeting_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE r _dg_native_proactive_settings%ROWTYPE;m reception_messages%ROWTYPE;s reception_sessions%ROWTYPE;
BEGIN
 SELECT * INTO r FROM _dg_native_proactive_settings WHERE id=NEW.settings_id;SELECT * INTO m FROM reception_messages WHERE id=NEW.message_id;SELECT * INTO s FROM reception_sessions WHERE id=NEW.session_id;
 IF session_user IS DISTINCT FROM(SELECT worker_role FROM _dg_native_runtime_control WHERE id=1) OR NEW.transaction_id IS DISTINCT FROM pg_current_xact_id()::text OR r.id IS NULL OR m.id IS NULL OR s.id IS NULL OR NEW.session_id<>r.session_id OR m.session_id<>s.id OR m.focus_version<>r.focus_version OR NEW.focus_version<>r.focus_version OR m.role<>'assistant' OR m.input_source<>'system' OR m.status<>'ready' OR NEW.reply_epoch<>m.reply_epoch OR m.reply_epoch<>s.reply_epoch+1 OR NEW.person_id IS DISTINCT FROM m.memory_person_id OR NEW.person_version IS DISTINCT FROM m.native_memory_version OR NEW.expires_at<>r.expires_at OR m.text NOT LIKE '【模拟主动问候】%' OR dg_native_proactive_reason(r,false) IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Worker greeting must retain its current consent, message and original scope';END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_proactive_greeting_guard BEFORE INSERT ON _dg_native_proactive_greetings FOR EACH ROW EXECUTE FUNCTION dg_native_proactive_greeting_guard();

CREATE FUNCTION dg_native_proactive_tick() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE w record;r _dg_native_proactive_settings%ROWTYPE;s reception_sessions%ROWTYPE;p people%ROWTYPE;greeting_id text;greeting_value jsonb;memory_value jsonb;fact_value text;message_value text;text_value text;time_value text;changed bigint:=0;
BEGIN
 PERFORM dg_native_reception_runtime(true);IF session_user IS DISTINCT FROM(SELECT worker_role FROM _dg_native_runtime_control WHERE id=1) THEN PERFORM dg_native_proactive_error('FORBIDDEN');END IF;
 FOR w IN SELECT DISTINCT tenant_id,workspace_id FROM _dg_native_proactive_settings WHERE expires_at::timestamptz>clock_timestamp() ORDER BY tenant_id,workspace_id LOOP
  IF NOT pg_try_advisory_xact_lock(hashtextextended('native-reception-workspace:'||w.tenant_id||':'||w.workspace_id,0)) THEN CONTINUE;END IF;
  PERFORM id FROM reception_terminals WHERE tenant_id=w.tenant_id AND workspace_id=w.workspace_id ORDER BY id FOR UPDATE;
  FOR r IN SELECT DISTINCT ON(session_id) * FROM _dg_native_proactive_settings WHERE tenant_id=w.tenant_id AND workspace_id=w.workspace_id AND expires_at::timestamptz>clock_timestamp() ORDER BY session_id,version DESC LOOP
   SELECT * INTO s FROM reception_sessions WHERE id=r.session_id FOR UPDATE;IF dg_native_proactive_reason(r) IS NOT NULL THEN CONTINUE;END IF;
   memory_value:=NULL;text_value:='【模拟主动问候】您好，现在方便交流吗？需要帮助时可以告诉我。';
   IF r.use_public_nickname THEN
    p:=dg_native_guest_memory_owned(s.id,false);IF p.id IS DISTINCT FROM r.person_id THEN CONTINUE;END IF;
    greeting_id:=dg_native_people_mutate(p,'greet',jsonb_build_object('version',p.version));SELECT * INTO p FROM people WHERE id=p.id;greeting_value:=dg_native_guest_memory_greeting_value(greeting_id,p);IF NOT(greeting_value->>'allowed')::boolean THEN CONTINUE;END IF;
    SELECT nickname_fact_id INTO fact_value FROM _dg_native_people_greetings WHERE id=greeting_id;memory_value:=jsonb_build_object('personId',p.id,'version',p.version,'factIds',CASE WHEN fact_value IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(fact_value) END);text_value:='【模拟主动问候】'||(greeting_value->>'text');
   END IF;
   IF dg_native_proactive_reason(r,false) IS NOT NULL THEN CONTINUE;END IF;
   IF memory_value IS NULL THEN message_value:=dg_native_reception_add_message(s.id,'assistant',text_value,'ready',s.reply_epoch+1,s.focus_version,'[]'::jsonb);ELSE message_value:=dg_native_guest_memory_add_reply(s.id,text_value,s.reply_epoch+1,s.focus_version,'[]'::jsonb,memory_value);END IF;
   time_value:=dg_utc_now();INSERT INTO _dg_native_proactive_greetings VALUES(gen_random_uuid()::text,r.id,s.id,message_value,s.focus_version,s.reply_epoch+1,memory_value->>'personId',(memory_value->>'version')::bigint,time_value,r.expires_at,pg_current_xact_id()::text);
   UPDATE reception_sessions SET version=version+1,reply_epoch=reply_epoch+1 WHERE id=s.id;
   INSERT INTO outbox_events VALUES(gen_random_uuid()::text,s.tenant_id,s.workspace_id,s.id,'session.proactive_greeting','mock','{}',time_value,NULL);changed:=changed+1;
  END LOOP;
 END LOOP;RETURN changed;
END;$dg$;

CREATE FUNCTION dg_native_proactive_play_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE r _dg_native_proactive_settings%ROWTYPE;
BEGIN
 IF NEW.status='playing' AND OLD.status<>'playing' THEN SELECT setting.* INTO r FROM _dg_native_proactive_greetings g JOIN _dg_native_proactive_settings setting ON setting.id=g.settings_id WHERE g.message_id=NEW.id;IF r.id IS NOT NULL AND(dg_native_proactive_reason(r,false) IS NOT NULL OR NOT dg_native_guest_memory_message_valid(NEW.id)) THEN PERFORM dg_native_reception_error('VERSION_CONFLICT');END IF;END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_proactive_play_guard BEFORE UPDATE ON reception_messages FOR EACH ROW EXECUTE FUNCTION dg_native_proactive_play_guard();

-- Existing memory consent still applies to reception. Restaurant automatic
-- delivery uses its separate on-site purpose and the new worker path only.
ALTER FUNCTION dg_native_guest_memory_greeting_allowed(people,text) RENAME TO dg_native_guest_memory_greeting_allowed_before_proactive;
CREATE FUNCTION dg_native_guest_memory_greeting_allowed(p people,session_value text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN IF EXISTS(SELECT 1 FROM reception_sessions WHERE id=session_value AND service_scene='restaurant') THEN RETURN false;END IF;RETURN dg_native_guest_memory_greeting_allowed_before_proactive(p,session_value);END;$dg$;
ALTER FUNCTION dg_native_guest_memory_sweep(boolean) RENAME TO dg_native_guest_memory_sweep_before_proactive;
CREATE FUNCTION dg_native_guest_memory_sweep(greet_allowed boolean DEFAULT false) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE changed bigint;
BEGIN
 changed:=dg_native_guest_memory_sweep_before_proactive(greet_allowed);IF greet_allowed THEN changed:=changed+dg_native_proactive_tick();END IF;RETURN changed+dg_native_proactive_cancel();
END;$dg$;
ALTER FUNCTION dg_native_reception_project(text) RENAME TO dg_native_reception_project_before_proactive;
CREATE FUNCTION dg_native_reception_project(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE value jsonb:=dg_native_reception_project_before_proactive(target);messages_value jsonb;
BEGIN
 SELECT coalesce(jsonb_agg(CASE WHEN EXISTS(SELECT 1 FROM _dg_native_proactive_greetings g JOIN _dg_native_proactive_settings r ON r.id=g.settings_id WHERE g.message_id=e.item->>'id' AND(dg_native_proactive_reason(r,false) IS NOT NULL OR NOT dg_native_guest_memory_message_valid(g.message_id))) THEN e.item||jsonb_build_object('text','','status','cancelled','citations','[]'::jsonb,'toolRequests','[]'::jsonb) ELSE e.item END ORDER BY e.ordinal),'[]') INTO messages_value FROM jsonb_array_elements(value->'messages') WITH ORDINALITY e(item,ordinal);
 RETURN value||jsonb_build_object('messages',messages_value);
END;$dg$;
ALTER FUNCTION dg_native_reception_guest_apply(text,text,text,text,jsonb) RENAME TO dg_native_reception_guest_apply_before_proactive;
CREATE FUNCTION dg_native_reception_guest_apply(target text,token_hash_value text,csrf_hash_value text,action_value text,input jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN PERFORM dg_native_reception_authorize(target,token_hash_value,csrf_hash_value,true);PERFORM dg_native_proactive_cancel(target);RETURN dg_native_reception_guest_apply_before_proactive(target,token_hash_value,csrf_hash_value,action_value,input);END;$dg$;



CREATE FUNCTION dg_native_proactive_cancel(target text DEFAULT NULL) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE item record;changed bigint:=0;
BEGIN
 FOR item IN SELECT g.message_id,r,r.tenant_id,r.workspace_id FROM _dg_native_proactive_greetings g JOIN _dg_native_proactive_settings r ON r.id=g.settings_id JOIN reception_messages m ON m.id=g.message_id WHERE(target IS NULL OR g.session_id=target) AND m.text<>'' AND m.status<>'cancelled' LOOP
  IF NOT pg_try_advisory_xact_lock(hashtextextended('native-reception-workspace:'||item.tenant_id||':'||item.workspace_id,0)) THEN CONTINUE;END IF;
  IF dg_native_proactive_reason(item.r,false) IS NOT NULL OR NOT dg_native_guest_memory_message_valid(item.message_id) THEN UPDATE reception_messages SET text='',status='cancelled',knowledge_citations='[]' WHERE id=item.message_id;changed:=changed+1;END IF;
 END LOOP;RETURN changed;
END;$dg$;

CREATE FUNCTION dg_native_proactive_project(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s reception_sessions%ROWTYPE;r _dg_native_proactive_settings%ROWTYPE;reason_value text;current_value boolean;last_value text;
BEGIN
 SELECT * INTO s FROM reception_sessions WHERE id=target;SELECT * INTO r FROM _dg_native_proactive_settings WHERE session_id=target ORDER BY version DESC LIMIT 1;reason_value:=dg_native_proactive_reason(r);
 current_value:=r.id IS NOT NULL AND r.access_version=s.access_version AND r.focus_version=s.focus_version AND r.party_id IS NOT DISTINCT FROM s.dining_party_id AND r.selection_version=coalesce((SELECT max(version) FROM _dg_native_dining_selection_revisions WHERE session_id=target),0);
 SELECT max(created_at) INTO last_value FROM _dg_native_proactive_greetings WHERE session_id=target AND focus_version=s.focus_version;
 RETURN jsonb_build_object('sessionId',target,'version',coalesce(r.version,0),'sessionVersion',s.version,'focusVersion',s.focus_version,'selectionVersion',coalesce((SELECT max(version) FROM _dg_native_dining_selection_revisions WHERE session_id=target),0),'purpose','onsite_greeting','noticeVersion','proactive-v1','consented',coalesce(current_value AND r.enabled AND r.consent_at IS NOT NULL AND r.expires_at::timestamptz>clock_timestamp(),false),'settings',CASE WHEN current_value THEN jsonb_build_object('enabled',r.enabled,'doNotDisturb',r.do_not_disturb,'quietStart',r.quiet_start,'quietEnd',r.quiet_end,'cooldownMinutes',r.cooldown_minutes,'usePublicNickname',r.use_public_nickname) END,'blockedReason',reason_value,'lastGreetingAt',last_value,'expiresAt',CASE WHEN current_value THEN r.expires_at END,'simulated',true);
END;$dg$;
CREATE FUNCTION dg_native_proactive_view(target text,token_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s reception_sessions%ROWTYPE;
BEGIN
 PERFORM dg_native_reception_authorize(target,token_value,NULL,false);SELECT * INTO s FROM reception_sessions WHERE id=target;IF s.service_scene<>'restaurant' THEN PERFORM dg_native_proactive_error('NOT_FOUND');END IF;RETURN dg_native_proactive_project(target);
END;$dg$;

CREATE FUNCTION dg_native_proactive_apply(target text,token_value text,csrf_value text,input jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s reception_sessions%ROWTYPE;r _dg_native_proactive_settings%ROWTYPE;previous_version bigint;person_value people%ROWTYPE;party dining_parties%ROWTYPE;time_value text:=dg_utc_now();
BEGIN
 PERFORM dg_native_reception_authorize(target,token_value,csrf_value,true);SELECT * INTO s FROM reception_sessions WHERE id=target;
 IF s.service_scene<>'restaurant' THEN PERFORM dg_native_proactive_error('NOT_FOUND');END IF;
 PERFORM dg_native_reception_fields(input,ARRAY['version','sessionVersion','focusVersion','selectionVersion','enabled','doNotDisturb','quietStart','quietEnd','cooldownMinutes','usePublicNickname','purpose','noticeVersion','consent','confirmed']);
 SELECT coalesce(max(version),0) INTO previous_version FROM _dg_native_proactive_settings WHERE session_id=target;
 IF input->>'version' IS DISTINCT FROM previous_version::text OR input->>'sessionVersion' IS DISTINCT FROM s.version::text OR input->>'focusVersion' IS DISTINCT FROM s.focus_version::text OR input->>'selectionVersion' IS DISTINCT FROM coalesce((SELECT max(version) FROM _dg_native_dining_selection_revisions WHERE session_id=target),0)::text OR s.status<>'active' THEN PERFORM dg_native_proactive_error('VERSION_CONFLICT');END IF;
 IF input->>'purpose' IS DISTINCT FROM 'onsite_greeting' OR input->>'noticeVersion' IS DISTINCT FROM 'proactive-v1' OR input->'confirmed' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(input->'enabled') IS DISTINCT FROM 'boolean' OR jsonb_typeof(input->'doNotDisturb') IS DISTINCT FROM 'boolean' OR jsonb_typeof(input->'usePublicNickname') IS DISTINCT FROM 'boolean' OR jsonb_typeof(input->'consent') IS DISTINCT FROM 'boolean' OR(input->>'enabled')::boolean AND input->'consent' IS DISTINCT FROM 'true'::jsonb OR input->>'quietStart' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR input->>'quietEnd' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR jsonb_typeof(input->'cooldownMinutes') IS DISTINCT FROM 'number' OR input->>'cooldownMinutes' !~ '^[0-9]+$' OR(input->>'cooldownMinutes')::bigint NOT BETWEEN 5 AND 1440 THEN PERFORM dg_native_proactive_error('VALIDATION_FAILED');END IF;
 IF previous_version>=100 THEN PERFORM dg_native_proactive_error('SETTINGS_LIMIT');END IF;
 SELECT * INTO party FROM dining_parties WHERE id=s.dining_party_id;
 IF(input->>'usePublicNickname')::boolean THEN person_value:=dg_native_guest_memory_owned(target,false);IF person_value.id IS NULL OR person_value.personalization<>1 OR NOT dg_native_food_memory_scope_matches(person_value.id,target) THEN PERFORM dg_native_proactive_error('MEMORY_UNAVAILABLE');END IF;END IF;
 r.id:=gen_random_uuid()::text;r.session_id:=target;r.version:=previous_version+1;r.runtime_id:=(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1);r.tenant_id:=s.tenant_id;r.workspace_id:=s.workspace_id;r.restaurant_id:=(SELECT restaurant_id FROM _dg_native_dining_session_origins WHERE session_id=target);r.access_id:=(SELECT id FROM _dg_native_reception_access WHERE session_id=target AND token_hash=token_value AND access_version=s.access_version);r.access_version:=s.access_version;r.focus_version:=s.focus_version;r.selection_version:=(input->>'selectionVersion')::bigint;r.party_id:=party.id;r.party_access_version:=party.access_version;r.enabled:=(input->>'enabled')::boolean;r.do_not_disturb:=(input->>'doNotDisturb')::boolean;r.quiet_start:=input->>'quietStart';r.quiet_end:=input->>'quietEnd';r.cooldown_minutes:=(input->>'cooldownMinutes')::bigint;r.use_public_nickname:=(input->>'usePublicNickname')::boolean;r.person_id:=person_value.id;r.purpose:='onsite_greeting';r.notice_version:='proactive-v1';r.consent_at:=CASE WHEN r.enabled THEN time_value END;r.expires_at:=s.expires_at;r.created_at:=time_value;r.transaction_id:=pg_current_xact_id()::text;
 INSERT INTO _dg_native_proactive_settings SELECT(r).*;PERFORM dg_native_proactive_cancel(target);UPDATE reception_sessions SET version=version+1,activity_at=dg_utc_now() WHERE id=target;
 INSERT INTO outbox_events VALUES(gen_random_uuid()::text,s.tenant_id,s.workspace_id,target,'session.proactive_settings','mock','{}',time_value,NULL);RETURN r.id;
END;$dg$;
CREATE FUNCTION dg_native_proactive_result(target text,session_value text,token_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE r _dg_native_proactive_settings%ROWTYPE;s reception_sessions%ROWTYPE;
BEGIN
 PERFORM dg_native_reception_authorize(session_value,token_value,NULL,false);SELECT * INTO s FROM reception_sessions WHERE id=session_value;SELECT * INTO r FROM _dg_native_proactive_settings WHERE id=target AND session_id=session_value;
 IF r.id IS NULL OR r.focus_version<>s.focus_version OR r.access_version<>s.access_version OR r.party_id IS DISTINCT FROM s.dining_party_id OR r.selection_version<>coalesce((SELECT max(version) FROM _dg_native_dining_selection_revisions WHERE session_id=s.id),0) OR r.id IS DISTINCT FROM(SELECT id FROM _dg_native_proactive_settings WHERE session_id=s.id ORDER BY version DESC LIMIT 1) THEN PERFORM dg_native_proactive_error('DATA_REMOVED');END IF;
 RETURN dg_native_proactive_project(session_value);
END;$dg$;

DO $proactive_acl$ DECLARE f record;BEGIN
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND(p.proname LIKE 'dg_native_proactive_%' OR p.proname=ANY(ARRAY['dg_native_guest_memory_greeting_allowed','dg_native_guest_memory_greeting_allowed_before_proactive','dg_native_guest_memory_sweep','dg_native_guest_memory_sweep_before_proactive','dg_native_reception_project','dg_native_reception_project_before_proactive','dg_native_reception_guest_apply','dg_native_reception_guest_apply_before_proactive'])) LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||f.signature||' FROM PUBLIC';END LOOP;
END;$proactive_acl$;
