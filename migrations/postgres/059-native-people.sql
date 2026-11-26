-- Native validation only. Account-owned profiles first; anonymous reception bindings follow separately.
CREATE TABLE _dg_native_people_guards(
 person_id text PRIMARY KEY REFERENCES people(id),tenant_id text NOT NULL,workspace_id text NOT NULL,
 owner_user_id text NOT NULL,invalidated_at text,created_at text NOT NULL
);
CREATE TABLE _dg_native_people_greetings(
 id text PRIMARY KEY,person_id text NOT NULL REFERENCES people(id),person_version bigint NOT NULL,
 allowed boolean NOT NULL,reason text,nickname_fact_id text,nickname_fact_version bigint,created_at text NOT NULL,
 CHECK((allowed AND reason IS NULL) OR(NOT allowed AND reason IN('disabled','do_not_disturb','quiet_hours','cooldown'))),
 CHECK((nickname_fact_id IS NULL)=(nickname_fact_version IS NULL))
);
CREATE TRIGGER native_people_greeting_immutable BEFORE UPDATE OR DELETE ON _dg_native_people_greetings FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
ALTER TABLE people ADD CONSTRAINT native_people_shape CHECK(status IN('active','deleted') AND version>0 AND environment='mock' AND app_env IN('development','sandbox') AND notice_version='memory-v1' AND personalization IN(0,1) AND do_not_disturb IN(0,1) AND quiet_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND quiet_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND cooldown_minutes BETWEEN 5 AND 1440 AND char_length(display_name) BETWEEN 1 AND 60);
ALTER TABLE memory_facts ADD CONSTRAINT native_memory_fact_shape CHECK(version>0 AND fact_key IN('nickname','company','like','avoid','interest') AND visibility IN('private','reception') AND source_kind IN('self_statement','session_text','verified_mock_audio') AND status IN('pending','confirmed','rejected','revoked','expired') AND char_length(value)<=200 AND((status IN('pending','confirmed') AND char_length(value)>0) OR(status IN('rejected','revoked','expired') AND value='')) AND((status='confirmed')=(confirmed_at IS NOT NULL)));
ALTER TABLE memory_notes ADD CONSTRAINT native_memory_note_shape CHECK(version>0 AND kind IN('summary','todo') AND status IN('open','completed') AND char_length(text) BETWEEN 1 AND 800 AND(kind='todo' OR status='open'));

CREATE FUNCTION dg_native_people_error(code_value text) RETURNS void LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='DGPEOPLE:'||code_value;END;$dg$;
CREATE FUNCTION dg_native_people_iso(value timestamptz) RETURNS text LANGUAGE sql IMMUTABLE SET search_path FROM CURRENT AS $dg$
 SELECT to_char(value AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$dg$;
CREATE FUNCTION dg_native_people_runtime(worker_allowed boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND environment='mock' AND(session_user=app_role OR worker_allowed AND session_user=worker_role)) THEN PERFORM dg_native_people_error('FORBIDDEN');END IF;END;$dg$;
CREATE FUNCTION dg_native_people_fields(input jsonb,keys_value text[]) RETURNS void LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN IF input IS NULL OR jsonb_typeof(input)<>'object' OR input-keys_value<>'{}'::jsonb THEN PERFORM dg_native_people_error('VALIDATION_FAILED');END IF;END;$dg$;
CREATE FUNCTION dg_native_people_roles(input jsonb) RETURNS text LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE result jsonb:='["employee"]';value jsonb;
BEGIN
 IF input IS NULL OR jsonb_typeof(input)<>'array' OR jsonb_array_length(input)>2 THEN PERFORM dg_native_people_error('VALIDATION_FAILED');END IF;
 FOR value IN SELECT jsonb_array_elements(input) LOOP IF value NOT IN('"visitor"'::jsonb,'"customer"'::jsonb) THEN PERFORM dg_native_people_error('VALIDATION_FAILED');END IF;IF NOT result @> jsonb_build_array(value) THEN result:=result||jsonb_build_array(value);END IF;END LOOP;RETURN result::text;
END;$dg$;
CREATE FUNCTION dg_native_people_apply(target text,action_value text,input jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE p people%ROWTYPE;f memory_facts%ROWTYPE;n memory_notes%ROWTYPE;item_id text:=gen_random_uuid()::text;time_value text:=dg_utc_now();expires_value text;status_value text;fact_value text;roles_value text;clock_value text;zone_value text;reason_value text;nickname memory_facts%ROWTYPE;
BEGIN
 p:=dg_native_people_owned(target);
 IF action_value='settings' THEN
  PERFORM dg_native_people_fields(input,ARRAY['version','displayName','roles','personalization','doNotDisturb','quietStart','quietEnd','cooldownMinutes']);
  IF input->>'version' IS DISTINCT FROM p.version::text THEN PERFORM dg_native_people_error('VERSION_CONFLICT');END IF;
  IF jsonb_typeof(input->'displayName') IS DISTINCT FROM 'string' OR char_length(btrim(input->>'displayName')) NOT BETWEEN 1 AND 60 OR jsonb_typeof(input->'personalization') IS DISTINCT FROM 'boolean' OR jsonb_typeof(input->'doNotDisturb') IS DISTINCT FROM 'boolean' OR coalesce(input->>'quietStart','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR coalesce(input->>'quietEnd','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR jsonb_typeof(input->'cooldownMinutes') IS DISTINCT FROM 'number' OR coalesce(input->>'cooldownMinutes','') !~ '^[0-9]{1,4}$' THEN PERFORM dg_native_people_error('VALIDATION_FAILED');END IF;
  IF(input->>'cooldownMinutes')::integer NOT BETWEEN 5 AND 1440 THEN PERFORM dg_native_people_error('VALIDATION_FAILED');END IF;roles_value:=dg_native_people_roles(input->'roles');
  UPDATE people SET display_name=btrim(input->>'displayName'),roles=roles_value,personalization=CASE WHEN(input->>'personalization')::boolean THEN 1 ELSE 0 END,do_not_disturb=CASE WHEN(input->>'doNotDisturb')::boolean THEN 1 ELSE 0 END,quiet_start=input->>'quietStart',quiet_end=input->>'quietEnd',cooldown_minutes=(input->>'cooldownMinutes')::integer,version=version+1,updated_at=time_value WHERE id=target;
  PERFORM dg_native_people_invalidate(target);PERFORM dg_native_people_reindex(target);
 ELSIF action_value='propose' THEN
  PERFORM dg_native_people_fields(input,ARRAY['key','value','visibility','expiresAt']);
  IF coalesce(input->>'key','') NOT IN('nickname','company','like','avoid','interest') OR coalesce(input->>'visibility','') NOT IN('private','reception') OR jsonb_typeof(input->'value') IS DISTINCT FROM 'string' OR char_length(btrim(input->>'value')) NOT BETWEEN 1 AND 200 THEN PERFORM dg_native_people_error('VALIDATION_FAILED');END IF;
  BEGIN expires_value:=dg_native_people_iso((input->>'expiresAt')::timestamptz);EXCEPTION WHEN OTHERS THEN PERFORM dg_native_people_error('INVALID_EXPIRY');END;
  IF expires_value IS NULL OR expires_value<=time_value OR expires_value>p.expires_at THEN PERFORM dg_native_people_error('INVALID_EXPIRY');END IF;
  IF(SELECT count(*) FROM memory_facts WHERE person_id=target)>=100 THEN PERFORM dg_native_people_error('QUOTA_EXCEEDED');END IF;
  INSERT INTO memory_facts(id,person_id,tenant_id,workspace_id,fact_key,value,source_kind,source_session_id,source_message_id,source_focus_version,visibility,status,version,expires_at,confirmed_at,created_at,updated_at) VALUES(item_id,target,p.tenant_id,p.workspace_id,input->>'key',btrim(input->>'value'),'self_statement',NULL,NULL,NULL,input->>'visibility','pending',1,expires_value,NULL,time_value,time_value);
  PERFORM dg_native_people_touch(target,'memory.proposed');
 ELSIF action_value='decide' THEN
  PERFORM dg_native_people_fields(input,ARRAY['factId','version','action','value','confirmed']);
  IF input->'confirmed' IS DISTINCT FROM 'true'::jsonb OR coalesce(input->>'action','') NOT IN('confirm','reject','revoke','correct') THEN PERFORM dg_native_people_error('VALIDATION_FAILED');END IF;
  SELECT * INTO f FROM memory_facts WHERE id=input->>'factId' AND person_id=target FOR UPDATE;IF f.id IS NULL THEN PERFORM dg_native_people_error('NOT_FOUND');END IF;
  IF input->>'version' IS DISTINCT FROM f.version::text THEN PERFORM dg_native_people_error('VERSION_CONFLICT');END IF;
  IF f.status NOT IN('pending','confirmed') OR f.expires_at<=time_value OR input->>'action'='confirm' AND f.status<>'pending' THEN PERFORM dg_native_people_error('STATE_CONFLICT');END IF;
  IF input->>'action'='correct' AND(jsonb_typeof(input->'value') IS DISTINCT FROM 'string' OR char_length(btrim(input->>'value')) NOT BETWEEN 1 AND 200) THEN PERFORM dg_native_people_error('VALIDATION_FAILED');END IF;
  status_value:=CASE input->>'action' WHEN 'confirm' THEN 'confirmed' WHEN 'correct' THEN 'pending' WHEN 'reject' THEN 'rejected' ELSE 'revoked' END;fact_value:=CASE input->>'action' WHEN 'correct' THEN btrim(input->>'value') WHEN 'confirm' THEN f.value ELSE '' END;
  DELETE FROM memory_lookup WHERE fact_id=f.id;UPDATE memory_facts SET status=status_value,value=fact_value,version=version+1,confirmed_at=CASE WHEN status_value='confirmed' THEN time_value ELSE NULL END,updated_at=time_value WHERE id=f.id;PERFORM dg_native_people_touch(target,'memory.'||(input->>'action'));
 ELSIF action_value='note' THEN
  PERFORM dg_native_people_fields(input,ARRAY['kind','text','sourceMessageIds','reviewed']);
  IF input->'reviewed' IS DISTINCT FROM 'true'::jsonb OR input->'sourceMessageIds' IS DISTINCT FROM '[]'::jsonb OR coalesce(input->>'kind','') NOT IN('summary','todo') OR jsonb_typeof(input->'text') IS DISTINCT FROM 'string' OR char_length(btrim(input->>'text')) NOT BETWEEN 1 AND 800 THEN PERFORM dg_native_people_error('VALIDATION_FAILED');END IF;
  IF(SELECT count(*) FROM memory_notes WHERE person_id=target)>=100 THEN PERFORM dg_native_people_error('QUOTA_EXCEEDED');END IF;
  INSERT INTO memory_notes(id,person_id,tenant_id,workspace_id,kind,text,source_session_id,source_message_ids,source_focus_version,status,version,expires_at,created_at) VALUES(item_id,target,p.tenant_id,p.workspace_id,input->>'kind',btrim(input->>'text'),NULL,'[]',NULL,'open',1,least(p.expires_at,dg_native_people_iso(time_value::timestamptz+interval '720 hours')),time_value);PERFORM dg_native_people_touch(target,'memory.note_created');
 ELSIF action_value='note_control' THEN
  PERFORM dg_native_people_fields(input,ARRAY['noteId','version','action']);IF coalesce(input->>'action','') NOT IN('complete','delete') THEN PERFORM dg_native_people_error('VALIDATION_FAILED');END IF;
  SELECT * INTO n FROM memory_notes WHERE id=input->>'noteId' AND person_id=target FOR UPDATE;IF n.id IS NULL THEN PERFORM dg_native_people_error('NOT_FOUND');END IF;IF input->>'version' IS DISTINCT FROM n.version::text THEN PERFORM dg_native_people_error('VERSION_CONFLICT');END IF;
  IF input->>'action'='delete' THEN DELETE FROM memory_notes WHERE id=n.id;ELSE IF n.kind<>'todo' OR n.status<>'open' THEN PERFORM dg_native_people_error('STATE_CONFLICT');END IF;UPDATE memory_notes SET status='completed',version=version+1 WHERE id=n.id;END IF;PERFORM dg_native_people_touch(target,'memory.note_'||(input->>'action'));
 ELSIF action_value='greet' THEN
  PERFORM dg_native_people_fields(input,ARRAY['version']);IF input->>'version' IS DISTINCT FROM p.version::text THEN PERFORM dg_native_people_error('VERSION_CONFLICT');END IF;
  SELECT timezone INTO zone_value FROM venues WHERE workspace_id=p.workspace_id AND tenant_id=p.tenant_id ORDER BY id LIMIT 1;zone_value:=coalesce(zone_value,'Asia/Shanghai');IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=zone_value) THEN PERFORM dg_native_people_error('STATE_CONFLICT');END IF;clock_value:=to_char(time_value::timestamptz AT TIME ZONE zone_value,'HH24:MI');
  reason_value:=CASE WHEN p.personalization<>1 THEN 'disabled' WHEN p.do_not_disturb=1 THEN 'do_not_disturb' WHEN p.quiet_start=p.quiet_end OR(p.quiet_start<p.quiet_end AND clock_value>=p.quiet_start AND clock_value<p.quiet_end) OR(p.quiet_start>p.quiet_end AND(clock_value>=p.quiet_start OR clock_value<p.quiet_end)) THEN 'quiet_hours' WHEN p.last_greeted_at IS NOT NULL AND time_value::timestamptz<p.last_greeted_at::timestamptz+make_interval(mins=>p.cooldown_minutes::integer) THEN 'cooldown' ELSE NULL END;
  IF reason_value IS NULL THEN
   SELECT f.* INTO nickname FROM memory_facts f JOIN memory_lookup l ON l.fact_id=f.id AND l.person_id=f.person_id AND l.value=f.value WHERE f.person_id=target AND f.fact_key='nickname' AND f.status='confirmed' AND f.visibility='reception' AND f.expires_at>time_value ORDER BY f.created_at,f.id LIMIT 1;
   UPDATE people SET last_greeted_at=time_value,version=version+1,updated_at=time_value WHERE id=target;PERFORM dg_native_people_invalidate(target);p.version:=p.version+1;
  END IF;
  INSERT INTO _dg_native_people_greetings VALUES(item_id,target,p.version,reason_value IS NULL,reason_value,nickname.id,nickname.version,time_value);RETURN item_id;
 ELSIF action_value='erase' THEN
  PERFORM dg_native_people_fields(input,ARRAY['version','confirmed']);IF input->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN PERFORM dg_native_people_error('VALIDATION_FAILED');END IF;IF input->>'version' IS DISTINCT FROM p.version::text THEN PERFORM dg_native_people_error('VERSION_CONFLICT');END IF;RETURN dg_native_people_erase_internal(target,'owner_request');
 ELSE PERFORM dg_native_people_error('VALIDATION_FAILED');END IF;
 RETURN target;
END;$dg$;
CREATE FUNCTION dg_native_people_greeting(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE r _dg_native_people_greetings%ROWTYPE;p people%ROWTYPE;nickname text;
BEGIN
 PERFORM dg_native_people_runtime();SELECT * INTO r FROM _dg_native_people_greetings WHERE id=target;IF r.id IS NULL THEN PERFORM dg_native_people_error('NOT_FOUND');END IF;p:=dg_native_people_owned(r.person_id);IF p.version<>r.person_version THEN PERFORM dg_native_people_error('DATA_REMOVED');END IF;
 IF r.nickname_fact_id IS NOT NULL THEN SELECT f.value INTO nickname FROM memory_facts f JOIN memory_lookup l ON l.fact_id=f.id AND l.value=f.value WHERE f.id=r.nickname_fact_id AND f.person_id=r.person_id AND f.version=r.nickname_fact_version AND f.status='confirmed' AND f.visibility='reception' AND f.expires_at>dg_utc_now() AND p.personalization=1;IF nickname IS NULL THEN PERFORM dg_native_people_error('DATA_REMOVED');END IF;END IF;
 RETURN jsonb_build_object('personId',r.person_id,'allowed',r.allowed,'reason',r.reason,'text',CASE WHEN NOT r.allowed THEN NULL WHEN nickname IS NULL THEN '您好，现在方便交流吗？' ELSE nickname||'，您好。现在有什么可以帮您？' END);
END;$dg$;
CREATE FUNCTION dg_native_people_receipt(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE r privacy_requests%ROWTYPE;
BEGIN
 PERFORM dg_native_people_runtime();SELECT * INTO r FROM privacy_requests WHERE id=target;IF r.id IS NULL THEN PERFORM dg_native_people_error('NOT_FOUND');END IF;PERFORM dg_native_people_owned(r.person_id,true);
 RETURN jsonb_build_object('requestId',r.id,'status','completed','local','completed','external','not_applicable','retained',jsonb_build_array('不含原文的审计及删除回执编号','本人资料删除后的最小授权撤回守卫'));
END;$dg$;
CREATE FUNCTION dg_native_people_registration() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NEW.owner_user_id IS NULL OR NEW.guest_session_id IS NOT NULL OR NEW.status<>'active' OR NEW.identity_kind<>'account_verified' OR NOT dg_native_office_member(NEW.owner_user_id,NEW.tenant_id,NEW.workspace_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native profile requires an active authenticated account scope';END IF;
 INSERT INTO _dg_native_people_guards VALUES(NEW.id,NEW.tenant_id,NEW.workspace_id,NEW.owner_user_id,NULL,dg_utc_now());RETURN NEW;
END;$dg$;
CREATE TRIGGER native_people_registration AFTER INSERT ON people FOR EACH ROW EXECUTE FUNCTION dg_native_people_registration();
CREATE FUNCTION dg_native_people_row_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE api_name text;worker_name text;
BEGIN
 SELECT app_role,worker_role INTO api_name,worker_name FROM _dg_native_runtime_control WHERE id=1;
 IF current_user IN(api_name,worker_name) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Profile writes require a guarded operation';END IF;
 IF TG_OP='INSERT' THEN IF NEW.version<>1 OR NEW.personalization<>0 OR NEW.do_not_disturb<>1 OR NEW.expires_at<=NEW.consent_at OR extract(epoch FROM NEW.expires_at::timestamptz)-extract(epoch FROM NEW.consent_at::timestamptz) NOT IN(30*86400,90*86400,180*86400) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Profile begins with explicit bounded consent and quiet defaults';END IF;
 ELSE IF NEW.version<>OLD.version+1 OR to_jsonb(NEW)-ARRAY['owner_user_id','guest_session_id','display_name','roles','identity_kind','status','version','personalization','do_not_disturb','quiet_start','quiet_end','cooldown_minutes','last_greeted_at','updated_at'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['owner_user_id','guest_session_id','display_name','roles','identity_kind','status','version','personalization','do_not_disturb','quiet_start','quiet_end','cooldown_minutes','last_greeted_at','updated_at'] OR OLD.status='deleted' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Profile identity, consent expiry and terminal deletion are immutable';END IF;END IF;
 IF NEW.status='active' THEN IF NEW.owner_user_id IS NULL OR NEW.guest_session_id IS NOT NULL OR NEW.identity_kind<>'account_verified' OR jsonb_typeof(NEW.roles::jsonb)<>'array' OR NOT NEW.roles::jsonb @> '["employee"]'::jsonb OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW.roles::jsonb) r WHERE r NOT IN('employee','visitor','customer')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Account business labels do not replace its bound identity';END IF;
 ELSE IF NEW.owner_user_id IS NOT NULL OR NEW.guest_session_id IS NOT NULL OR NEW.display_name<>'已删除资料' OR NEW.roles<>'[]' OR NEW.personalization<>0 OR NEW.last_greeted_at IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Deleted profile must clear its personal fields';END IF;END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_people_row_guard BEFORE INSERT OR UPDATE ON people FOR EACH ROW EXECUTE FUNCTION dg_native_people_row_guard();
CREATE FUNCTION dg_native_people_fact_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE p people%ROWTYPE;
BEGIN
 SELECT * INTO p FROM people WHERE id=NEW.person_id;
 IF p.id IS NULL OR p.status<>'active' OR NEW.tenant_id<>p.tenant_id OR NEW.workspace_id<>p.workspace_id OR NEW.expires_at>p.expires_at OR NEW.source_kind<>'self_statement' OR NEW.source_session_id IS NOT NULL OR NEW.source_message_id IS NOT NULL OR NEW.source_focus_version IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native account memory needs its current subject and explicit self-statement source';END IF;
 IF TG_OP='INSERT' THEN IF NEW.status<>'pending' OR NEW.version<>1 OR NEW.confirmed_at IS NOT NULL OR NEW.expires_at<=dg_utc_now() THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Memory must start as a pending statement';END IF;
 ELSE IF NEW.version<>OLD.version+1 OR OLD.status NOT IN('pending','confirmed') OR NEW.status='confirmed' AND OLD.status<>'pending' OR to_jsonb(NEW)-ARRAY['value','status','version','confirmed_at','updated_at'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['value','status','version','confirmed_at','updated_at'] THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Memory versions, source and confirmation transitions are guarded';END IF;END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_people_fact_guard BEFORE INSERT OR UPDATE ON memory_facts FOR EACH ROW EXECUTE FUNCTION dg_native_people_fact_guard();
CREATE FUNCTION dg_native_people_note_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE p people%ROWTYPE;
BEGIN
 SELECT * INTO p FROM people WHERE id=NEW.person_id;
 IF p.id IS NULL OR p.status<>'active' OR NEW.tenant_id<>p.tenant_id OR NEW.workspace_id<>p.workspace_id OR NEW.source_session_id IS NOT NULL OR NEW.source_message_ids::jsonb<>'[]'::jsonb OR NEW.source_focus_version IS NOT NULL OR NEW.expires_at>p.expires_at OR extract(epoch FROM NEW.expires_at::timestamptz)-extract(epoch FROM NEW.created_at::timestamptz)>30*86400 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native account notes need reviewed source scope and bounded retention';END IF;
 IF TG_OP='INSERT' THEN IF NEW.version<>1 OR NEW.status<>'open' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Note starts from its reviewed open state';END IF;
 ELSE IF NEW.version<>OLD.version+1 OR OLD.kind<>'todo' OR OLD.status<>'open' OR NEW.status<>'completed' OR to_jsonb(NEW)-ARRAY['status','version'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['status','version'] THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Only an open todo may be completed';END IF;END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_people_note_guard BEFORE INSERT OR UPDATE ON memory_notes FOR EACH ROW EXECUTE FUNCTION dg_native_people_note_guard();
CREATE FUNCTION dg_native_people_guard_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN IF TG_OP='DELETE' OR to_jsonb(NEW)-'invalidated_at' IS DISTINCT FROM to_jsonb(OLD)-'invalidated_at' OR OLD.invalidated_at IS NOT NULL AND NEW.invalidated_at IS DISTINCT FROM OLD.invalidated_at THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Original profile consent scope cannot be rebound or revived';END IF;RETURN NEW;END;$dg$;
CREATE TRIGGER native_people_guard_immutable BEFORE UPDATE OR DELETE ON _dg_native_people_guards FOR EACH ROW EXECUTE FUNCTION dg_native_people_guard_immutable();
CREATE FUNCTION dg_native_people_final_binding() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE target text;p people%ROWTYPE;g _dg_native_people_guards%ROWTYPE;
BEGIN
 target:=CASE WHEN TG_TABLE_NAME='people' THEN coalesce(to_jsonb(NEW)->>'id',to_jsonb(OLD)->>'id') WHEN TG_TABLE_NAME='_dg_native_people_guards' THEN coalesce(to_jsonb(NEW)->>'person_id',to_jsonb(OLD)->>'person_id') ELSE coalesce(to_jsonb(NEW)->>'person_id',to_jsonb(OLD)->>'person_id') END;
 SELECT * INTO p FROM people WHERE id=target;SELECT * INTO g FROM _dg_native_people_guards WHERE person_id=target;
 IF p.id IS NULL OR g.person_id IS NULL OR p.tenant_id<>g.tenant_id OR p.workspace_id<>g.workspace_id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Profile and immutable consent guard must commit together';END IF;
 IF p.status='active' THEN IF g.invalidated_at IS NOT NULL OR p.owner_user_id IS DISTINCT FROM g.owner_user_id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Active profile requires its original unrevoked account scope';END IF;
 ELSE IF g.invalidated_at IS NULL OR EXISTS(SELECT 1 FROM memory_facts WHERE person_id=target) OR EXISTS(SELECT 1 FROM memory_notes WHERE person_id=target) OR NOT EXISTS(SELECT 1 FROM privacy_requests WHERE person_id=target AND status='completed') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Deleted profile must commit cleared memory, guard and receipt together';END IF;END IF;
 IF EXISTS(SELECT f.id,f.value FROM memory_facts f WHERE f.person_id=target AND p.status='active' AND p.personalization=1 AND g.invalidated_at IS NULL AND f.status='confirmed' AND f.visibility='reception' AND f.expires_at>dg_utc_now() EXCEPT SELECT l.fact_id,l.value FROM memory_lookup l WHERE l.person_id=target) OR EXISTS(SELECT l.fact_id,l.value FROM memory_lookup l WHERE l.person_id=target EXCEPT SELECT f.id,f.value FROM memory_facts f WHERE f.person_id=target AND p.status='active' AND p.personalization=1 AND g.invalidated_at IS NULL AND f.status='confirmed' AND f.visibility='reception' AND f.expires_at>dg_utc_now()) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Memory lookup must equal only the currently confirmed permitted statements';END IF;RETURN NULL;
END;$dg$;
CREATE CONSTRAINT TRIGGER native_people_final AFTER INSERT OR UPDATE ON people DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_people_final_binding();
CREATE CONSTRAINT TRIGGER native_people_guard_final AFTER INSERT OR UPDATE ON _dg_native_people_guards DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_people_final_binding();
CREATE CONSTRAINT TRIGGER native_people_fact_final AFTER INSERT OR UPDATE OR DELETE ON memory_facts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_people_final_binding();
CREATE CONSTRAINT TRIGGER native_people_note_final AFTER INSERT OR UPDATE OR DELETE ON memory_notes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_people_final_binding();
CREATE CONSTRAINT TRIGGER native_people_lookup_final AFTER INSERT OR UPDATE OR DELETE ON memory_lookup DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_people_final_binding();
CREATE FUNCTION dg_native_people_member_invalidate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE g _dg_native_people_guards%ROWTYPE;
BEGIN
 FOR g IN SELECT * FROM _dg_native_people_guards WHERE owner_user_id=OLD.user_id AND invalidated_at IS NULL ORDER BY person_id LOOP IF TG_OP='DELETE' OR NOT dg_native_office_member(g.owner_user_id,g.tenant_id,g.workspace_id) THEN PERFORM dg_native_people_erase_internal(g.person_id,'membership_withdrawn');END IF;END LOOP;RETURN NULL;
END;$dg$;
CREATE TRIGGER native_people_member_invalidate AFTER UPDATE OR DELETE ON memberships FOR EACH ROW EXECUTE FUNCTION dg_native_people_member_invalidate();
CREATE FUNCTION dg_native_people_owned(target text,allow_deleted boolean DEFAULT false) RETURNS people LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE actor text:=current_setting('digitalguide.actor_id',true);g _dg_native_people_guards%ROWTYPE;p people%ROWTYPE;
BEGIN
 PERFORM dg_native_people_runtime();PERFORM user_id FROM dg_native_locked_membership(actor);SELECT * INTO g FROM _dg_native_people_guards WHERE person_id=target AND owner_user_id=actor;
 IF g.person_id IS NULL OR NOT dg_native_office_member(actor,g.tenant_id,g.workspace_id) THEN PERFORM dg_native_people_error('NOT_FOUND');END IF;
 SELECT * INTO p FROM people WHERE id=target FOR UPDATE;
 IF p.id IS NULL OR p.tenant_id<>g.tenant_id OR p.workspace_id<>g.workspace_id OR p.environment<>'mock' OR p.app_env IS DISTINCT FROM(SELECT app_env FROM _dg_native_runtime_control WHERE id=1) OR(NOT allow_deleted AND(p.status<>'active' OR p.expires_at<=dg_utc_now() OR g.invalidated_at IS NOT NULL OR p.owner_user_id IS DISTINCT FROM actor)) THEN PERFORM dg_native_people_error('NOT_FOUND');END IF;RETURN p;
END;$dg$;
CREATE FUNCTION dg_native_people_reindex(target text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 DELETE FROM memory_lookup WHERE person_id=target;
 INSERT INTO memory_lookup(fact_id,person_id,value) SELECT f.id,p.id,f.value FROM memory_facts f JOIN people p ON p.id=f.person_id JOIN _dg_native_people_guards g ON g.person_id=p.id WHERE p.id=target AND p.status='active' AND p.expires_at>dg_utc_now() AND p.personalization=1 AND g.invalidated_at IS NULL AND f.status='confirmed' AND f.visibility='reception' AND f.expires_at>dg_utc_now();
END;$dg$;
CREATE FUNCTION dg_native_people_invalidate(target text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 UPDATE idempotency i SET response='{}',redacted=1 FROM _dg_native_people_guards g WHERE g.person_id=target AND i.tenant_id=g.tenant_id AND i.actor_id=g.owner_user_id AND i.action LIKE 'POST /api/v1/people/%' AND i.redacted=0 AND i.response::jsonb->>'resourceId'=target;
END;$dg$;
CREATE FUNCTION dg_native_people_touch(target text,event_value text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE p people%ROWTYPE;
BEGIN
 PERFORM dg_native_people_invalidate(target);UPDATE people SET version=version+1,updated_at=dg_utc_now() WHERE id=target RETURNING * INTO p;PERFORM dg_native_people_reindex(target);
 INSERT INTO outbox_events VALUES(gen_random_uuid()::text,p.tenant_id,p.workspace_id,p.id,event_value,'mock','{}',dg_utc_now(),NULL);
END;$dg$;
CREATE FUNCTION dg_native_people_erase_internal(target text,reason_value text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE p people%ROWTYPE;receipt_id text;time_value text:=dg_utc_now();
BEGIN
 SELECT * INTO p FROM people WHERE id=target FOR UPDATE;SELECT id INTO receipt_id FROM privacy_requests WHERE person_id=target AND status='completed' ORDER BY created_at,id LIMIT 1;IF receipt_id IS NOT NULL THEN RETURN receipt_id;END IF;
 IF p.id IS NULL OR reason_value NOT IN('owner_request','retention_expired','membership_withdrawn') OR EXISTS(SELECT 1 FROM memory_session_links WHERE person_id=target) THEN PERFORM dg_native_people_error('STATE_CONFLICT');END IF;
 DELETE FROM memory_lookup WHERE person_id=target;DELETE FROM memory_facts WHERE person_id=target;DELETE FROM memory_notes WHERE person_id=target;
 UPDATE memory_recovery_credentials SET token_hash='',revoked_at=coalesce(revoked_at,time_value) WHERE person_id=target;
 PERFORM dg_native_people_invalidate(target);UPDATE _dg_native_people_guards SET invalidated_at=coalesce(invalidated_at,time_value) WHERE person_id=target;
 UPDATE people SET display_name='已删除资料',roles='[]',identity_kind='self_reported',owner_user_id=NULL,guest_session_id=NULL,status='deleted',personalization=0,do_not_disturb=1,quiet_start='22:00',quiet_end='08:00',cooldown_minutes=60,last_greeted_at=NULL,version=version+1,updated_at=time_value WHERE id=target;
 receipt_id:=gen_random_uuid()::text;INSERT INTO privacy_requests VALUES(receipt_id,p.id,p.tenant_id,p.workspace_id,reason_value,'completed',time_value,'not_applicable',time_value);
 INSERT INTO outbox_events VALUES(gen_random_uuid()::text,p.tenant_id,p.workspace_id,receipt_id,'privacy.local_completed','mock','{}',time_value,NULL);RETURN receipt_id;
END;$dg$;
CREATE FUNCTION dg_native_people_sweep() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE p people%ROWTYPE;changed bigint:=0;affected bigint;time_value text:=dg_utc_now();current_app text;
BEGIN
 PERFORM dg_native_people_runtime(true);SELECT app_env INTO current_app FROM _dg_native_runtime_control WHERE id=1;
 FOR p IN SELECT * FROM people WHERE environment='mock' AND app_env=current_app AND status='active' AND id IN(SELECT person_id FROM _dg_native_people_guards) ORDER BY id FOR UPDATE SKIP LOCKED LOOP
  IF p.expires_at<=time_value OR NOT dg_native_office_member(p.owner_user_id,p.tenant_id,p.workspace_id) THEN PERFORM dg_native_people_erase_internal(p.id,CASE WHEN p.expires_at<=time_value THEN 'retention_expired' ELSE 'membership_withdrawn' END);changed:=changed+1;CONTINUE;END IF;
  UPDATE memory_facts SET status='expired',value='',confirmed_at=NULL,version=version+1,updated_at=time_value WHERE person_id=p.id AND expires_at<=time_value AND status IN('pending','confirmed');GET DIAGNOSTICS affected=ROW_COUNT;DELETE FROM memory_notes WHERE person_id=p.id AND expires_at<=time_value;IF FOUND THEN affected:=affected+1;END IF;
  IF affected>0 THEN PERFORM dg_native_people_touch(p.id,'memory.retention_cleaned');changed:=changed+affected;END IF;
 END LOOP;RETURN changed;
END;$dg$;
CREATE FUNCTION dg_native_people_project(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE p people%ROWTYPE;facts_value jsonb;notes_value jsonb;
BEGIN
 SELECT * INTO p FROM people WHERE id=target;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'personId',f.person_id,'key',f.fact_key,'value',CASE WHEN f.expires_at<=dg_utc_now() THEN '' ELSE f.value END,'sourceKind',f.source_kind,'sourceSessionId',f.source_session_id,'sourceMessageId',f.source_message_id,'visibility',f.visibility,'status',CASE WHEN f.expires_at<=dg_utc_now() AND f.status IN('pending','confirmed') THEN 'expired' ELSE f.status END,'version',f.version,'expiresAt',f.expires_at,'confirmedAt',CASE WHEN f.expires_at<=dg_utc_now() THEN NULL ELSE f.confirmed_at END,'createdAt',f.created_at) ORDER BY f.created_at,f.id),'[]') INTO facts_value FROM memory_facts f WHERE f.person_id=target;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',n.id,'personId',n.person_id,'kind',n.kind,'text',n.text,'sourceSessionId',n.source_session_id,'sourceMessageIds',n.source_message_ids::jsonb,'status',n.status,'version',n.version,'expiresAt',n.expires_at) ORDER BY n.created_at,n.id),'[]') INTO notes_value FROM memory_notes n WHERE n.person_id=target AND n.expires_at>dg_utc_now();
 RETURN jsonb_build_object('person',jsonb_build_object('id',p.id,'workspaceId',p.workspace_id,'displayName',p.display_name,'roles',p.roles::jsonb,'identity',p.identity_kind,'version',p.version,'personalization',p.personalization=1,'doNotDisturb',p.do_not_disturb=1,'quietStart',p.quiet_start,'quietEnd',p.quiet_end,'cooldownMinutes',p.cooldown_minutes,'expiresAt',p.expires_at,'consentAt',p.consent_at,'noticeVersion',p.notice_version),'facts',facts_value,'notes',notes_value);
END;$dg$;
CREATE FUNCTION dg_native_people_view(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN PERFORM dg_native_people_owned(target);RETURN dg_native_people_project(target);END;$dg$;
CREATE FUNCTION dg_native_people_self(workspace_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE actor text:=current_setting('digitalguide.actor_id',true);target text;tenant text;
BEGIN
 PERFORM dg_native_people_runtime();SELECT tenant_id INTO tenant FROM dg_native_locked_membership(actor);IF NOT dg_native_office_member(actor,tenant,workspace_value) THEN PERFORM dg_native_people_error('NOT_FOUND');END IF;
 SELECT id INTO target FROM people WHERE owner_user_id=actor AND tenant_id=tenant AND workspace_id=workspace_value AND status='active' AND environment='mock' AND app_env=(SELECT app_env FROM _dg_native_runtime_control WHERE id=1);
 IF target IS NULL THEN RETURN jsonb_build_object('person',NULL,'facts','[]'::jsonb,'notes','[]'::jsonb);END IF;RETURN dg_native_people_view(target);
END;$dg$;
CREATE FUNCTION dg_native_people_enroll(workspace_value text,input jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE actor text:=current_setting('digitalguide.actor_id',true);tenant text;target text:=gen_random_uuid()::text;time_value text:=dg_utc_now();roles_value text;
BEGIN
 PERFORM dg_native_people_runtime();SELECT tenant_id INTO tenant FROM dg_native_locked_membership(actor);IF NOT dg_native_office_member(actor,tenant,workspace_value) THEN PERFORM dg_native_people_error('NOT_FOUND');END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('native-people-enroll:'||tenant||':'||workspace_value||':'||actor,0));
 IF EXISTS(SELECT 1 FROM people WHERE owner_user_id=actor AND tenant_id=tenant AND workspace_id=workspace_value AND status='active') THEN PERFORM dg_native_people_error('STATE_CONFLICT');END IF;
 PERFORM dg_native_people_fields(input,ARRAY['displayName','roles','consent','noticeVersion','retentionDays']);
 IF input->'consent' IS DISTINCT FROM 'true'::jsonb OR input->>'noticeVersion' IS DISTINCT FROM 'memory-v1' OR jsonb_typeof(input->'displayName') IS DISTINCT FROM 'string' OR char_length(btrim(input->>'displayName')) NOT BETWEEN 1 AND 60 OR jsonb_typeof(input->'retentionDays') IS DISTINCT FROM 'number' OR input->>'retentionDays' NOT IN('30','90','180') THEN PERFORM dg_native_people_error('VALIDATION_FAILED');END IF;roles_value:=dg_native_people_roles(input->'roles');
 INSERT INTO people(id,tenant_id,workspace_id,owner_user_id,guest_session_id,display_name,roles,identity_kind,status,version,personalization,do_not_disturb,quiet_start,quiet_end,cooldown_minutes,notice_version,consent_at,expires_at,environment,app_env,created_at,updated_at)
 VALUES(target,tenant,workspace_value,actor,NULL,btrim(input->>'displayName'),roles_value,'account_verified','active',1,0,1,'22:00','08:00',60,'memory-v1',time_value,dg_native_people_iso(time_value::timestamptz+(input->>'retentionDays')::integer*interval '24 hours'),'mock',(SELECT app_env FROM _dg_native_runtime_control WHERE id=1),time_value,time_value);
 INSERT INTO outbox_events VALUES(gen_random_uuid()::text,tenant,workspace_value,target,'person.enrolled','mock','{}',time_value,NULL);RETURN target;
END;$dg$;
CREATE FUNCTION dg_native_people_search(target text,query_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE p people%ROWTYPE;result jsonb;
BEGIN
 p:=dg_native_people_owned(target);IF query_value IS NULL OR char_length(query_value)>100 THEN PERFORM dg_native_people_error('VALIDATION_FAILED');END IF;IF p.personalization<>1 THEN RETURN '[]';END IF;
 SELECT coalesce(jsonb_agg(row_value ORDER BY created_at,id),'[]') INTO result FROM(SELECT jsonb_build_object('id',f.id,'key',f.fact_key,'value',f.value) row_value,f.created_at,f.id FROM memory_lookup l JOIN memory_facts f ON f.id=l.fact_id AND f.person_id=l.person_id WHERE l.person_id=target AND f.status='confirmed' AND f.visibility='reception' AND f.expires_at>dg_utc_now() AND l.value=f.value AND strpos(l.value,query_value)>0 ORDER BY f.created_at,f.id LIMIT 20) q;RETURN result;
END;$dg$;
CREATE FUNCTION dg_native_people_export(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN PERFORM dg_native_people_owned(target);RETURN jsonb_build_object('schemaVersion',1,'exportedAt',dg_utc_now(),'transcript','[]'::jsonb,'exclusions',jsonb_build_array('其他人员资料','受访人内部备注','登录凭据'))||dg_native_people_project(target);END;$dg$;
CREATE FUNCTION dg_native_people_directory(workspaces_value text[],cursor_value text,limit_value integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE actor text:=current_setting('digitalguide.actor_id',true);member record;workspace_value text;result jsonb;
BEGIN
 PERFORM dg_native_people_runtime();SELECT * INTO member FROM dg_native_locked_membership(actor);IF member.role IS DISTINCT FROM 'admin' THEN PERFORM dg_native_people_error('FORBIDDEN');END IF;
 IF workspaces_value IS NULL OR cardinality(workspaces_value)>1000 OR limit_value NOT BETWEEN 1 AND 101 OR cursor_value IS NULL THEN PERFORM dg_native_people_error('VALIDATION_FAILED');END IF;
 FOREACH workspace_value IN ARRAY workspaces_value LOOP IF NOT dg_native_office_member(actor,member.tenant_id,workspace_value) THEN PERFORM dg_native_people_error('NOT_FOUND');END IF;END LOOP;
 SELECT coalesce(jsonb_agg(row_value ORDER BY id),'[]') INTO result FROM(SELECT p.id,jsonb_build_object('id',p.id,'displayName',p.display_name,'workspaceId',p.workspace_id,'roles',p.roles::jsonb,'identity',p.identity_kind,'expiresAt',p.expires_at) row_value FROM people p JOIN _dg_native_people_guards g ON g.person_id=p.id WHERE p.tenant_id=member.tenant_id AND p.workspace_id=ANY(workspaces_value) AND p.status='active' AND p.expires_at>dg_utc_now() AND g.invalidated_at IS NULL AND p.id>cursor_value ORDER BY p.id LIMIT limit_value) q;RETURN result;
END;$dg$;

CREATE TRIGGER native_people_privacy_receipt_immutable BEFORE UPDATE OR DELETE ON privacy_requests FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
DO $dg$ DECLARE r record;BEGIN FOR r IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND p.proname LIKE 'dg_native_people_%' LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||r.signature||' FROM PUBLIC';END LOOP;END;$dg$;
