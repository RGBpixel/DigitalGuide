-- New native validation schemas only. Existing account flows share checked mutation logic.
ALTER TABLE _dg_native_people_guards ALTER COLUMN owner_user_id DROP NOT NULL;
ALTER TABLE reception_messages ADD COLUMN native_memory_version bigint;
CREATE TABLE _dg_native_guest_memory_origins(person_id text PRIMARY KEY REFERENCES people(id),session_id text NOT NULL REFERENCES reception_sessions(id),focus_version bigint NOT NULL,tenant_id text NOT NULL,workspace_id text NOT NULL,consent_at text NOT NULL);
CREATE TRIGGER native_guest_memory_origin_immutable BEFORE UPDATE OR DELETE ON _dg_native_guest_memory_origins FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TABLE _dg_native_guest_memory_actions(id text PRIMARY KEY,person_id text NOT NULL REFERENCES people(id),session_id text NOT NULL REFERENCES reception_sessions(id),focus_version bigint NOT NULL,access_id text NOT NULL REFERENCES _dg_native_reception_access(id),kind text NOT NULL,resource_id text NOT NULL,transaction_id text NOT NULL,created_at text NOT NULL);
CREATE TRIGGER native_guest_memory_action_immutable BEFORE UPDATE OR DELETE ON _dg_native_guest_memory_actions FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TABLE _dg_native_guest_memory_recovery_origins(credential_id text PRIMARY KEY REFERENCES memory_recovery_credentials(id),session_id text NOT NULL REFERENCES reception_sessions(id),focus_version bigint NOT NULL,expires_at text NOT NULL);
CREATE TRIGGER native_guest_memory_recovery_origin_immutable BEFORE UPDATE OR DELETE ON _dg_native_guest_memory_recovery_origins FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TABLE _dg_native_guest_memory_attempts(id text PRIMARY KEY,session_id text NOT NULL REFERENCES reception_sessions(id),created_at text NOT NULL);
CREATE TRIGGER native_guest_memory_attempt_immutable BEFORE UPDATE OR DELETE ON _dg_native_guest_memory_attempts FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE INDEX native_guest_memory_action_session ON _dg_native_guest_memory_actions(session_id,created_at);
CREATE INDEX native_guest_memory_attempt_session ON _dg_native_guest_memory_attempts(session_id,created_at);
CREATE INDEX native_guest_memory_person_session ON memory_session_links(person_id,session_id,focus_version);
CREATE OR REPLACE FUNCTION dg_native_guest_memory_roles(input jsonb) RETURNS text LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE result jsonb:='[]';item jsonb;
BEGIN IF jsonb_typeof(input) IS DISTINCT FROM 'array' OR jsonb_array_length(input)>2 THEN PERFORM dg_native_people_error('VALIDATION_FAILED');END IF;FOR item IN SELECT jsonb_array_elements(input) LOOP IF item NOT IN('"visitor"'::jsonb,'"customer"'::jsonb) THEN PERFORM dg_native_people_error('FORBIDDEN');END IF;IF NOT result @> jsonb_build_array(item) THEN result:=result||jsonb_build_array(item);END IF;END LOOP;RETURN result::text;END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_people_mutate(p people,action_value text,input jsonb,source_value jsonb DEFAULT '{}'::jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE target text:=p.id;f memory_facts%ROWTYPE;n memory_notes%ROWTYPE;item_id text:=gen_random_uuid()::text;time_value text:=dg_utc_now();expires_value text;status_value text;fact_value text;roles_value text;clock_value text;zone_value text;reason_value text;nickname memory_facts%ROWTYPE;
BEGIN
 IF p.id IS NULL OR p.status<>'active' OR p.expires_at<=dg_utc_now() THEN PERFORM dg_native_people_error('NOT_FOUND');END IF;
 IF action_value='settings' THEN
  PERFORM dg_native_people_fields(input,ARRAY['version','displayName','roles','personalization','doNotDisturb','quietStart','quietEnd','cooldownMinutes']);
  IF input->>'version' IS DISTINCT FROM p.version::text THEN PERFORM dg_native_people_error('VERSION_CONFLICT');END IF;
  IF jsonb_typeof(input->'displayName') IS DISTINCT FROM 'string' OR char_length(btrim(input->>'displayName')) NOT BETWEEN 1 AND 60 OR jsonb_typeof(input->'personalization') IS DISTINCT FROM 'boolean' OR jsonb_typeof(input->'doNotDisturb') IS DISTINCT FROM 'boolean' OR coalesce(input->>'quietStart','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR coalesce(input->>'quietEnd','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR jsonb_typeof(input->'cooldownMinutes') IS DISTINCT FROM 'number' OR coalesce(input->>'cooldownMinutes','') !~ '^[0-9]{1,4}$' THEN PERFORM dg_native_people_error('VALIDATION_FAILED');END IF;
  IF(input->>'cooldownMinutes')::integer NOT BETWEEN 5 AND 1440 THEN PERFORM dg_native_people_error('VALIDATION_FAILED');END IF;roles_value:=CASE WHEN p.owner_user_id IS NULL THEN dg_native_guest_memory_roles(input->'roles') ELSE dg_native_people_roles(input->'roles') END;
  UPDATE people SET display_name=btrim(input->>'displayName'),roles=roles_value,personalization=CASE WHEN(input->>'personalization')::boolean THEN 1 ELSE 0 END,do_not_disturb=CASE WHEN(input->>'doNotDisturb')::boolean THEN 1 ELSE 0 END,quiet_start=input->>'quietStart',quiet_end=input->>'quietEnd',cooldown_minutes=(input->>'cooldownMinutes')::integer,version=version+1,updated_at=time_value WHERE id=target;
  PERFORM dg_native_people_invalidate(target);PERFORM dg_native_people_reindex(target);
 ELSIF action_value='propose' THEN
  PERFORM dg_native_people_fields(input,ARRAY['key','value','visibility','expiresAt']);
  IF coalesce(input->>'key','') NOT IN('nickname','company','like','avoid','interest') OR coalesce(input->>'visibility','') NOT IN('private','reception') OR jsonb_typeof(input->'value') IS DISTINCT FROM 'string' OR char_length(btrim(input->>'value')) NOT BETWEEN 1 AND 200 THEN PERFORM dg_native_people_error('VALIDATION_FAILED');END IF;
  BEGIN expires_value:=dg_native_people_iso((input->>'expiresAt')::timestamptz);EXCEPTION WHEN OTHERS THEN PERFORM dg_native_people_error('INVALID_EXPIRY');END;
  IF expires_value IS NULL OR expires_value<=time_value OR expires_value>p.expires_at THEN PERFORM dg_native_people_error('INVALID_EXPIRY');END IF;
  IF(SELECT count(*) FROM memory_facts WHERE person_id=target)>=100 THEN PERFORM dg_native_people_error('QUOTA_EXCEEDED');END IF;
  INSERT INTO memory_facts(id,person_id,tenant_id,workspace_id,fact_key,value,source_kind,source_session_id,source_message_id,source_focus_version,visibility,status,version,expires_at,confirmed_at,created_at,updated_at) VALUES(item_id,target,p.tenant_id,p.workspace_id,input->>'key',btrim(input->>'value'),CASE WHEN source_value->>'messageId' IS NULL THEN 'self_statement' ELSE 'session_text' END,source_value->>'sessionId',source_value->>'messageId',(source_value->>'focusVersion')::bigint,input->>'visibility','pending',1,expires_value,NULL,time_value,time_value);
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
  IF input->'reviewed' IS DISTINCT FROM 'true'::jsonb OR (p.owner_user_id IS NOT NULL AND input->'sourceMessageIds' IS DISTINCT FROM '[]'::jsonb) OR coalesce(input->>'kind','') NOT IN('summary','todo') OR jsonb_typeof(input->'text') IS DISTINCT FROM 'string' OR char_length(btrim(input->>'text')) NOT BETWEEN 1 AND 800 THEN PERFORM dg_native_people_error('VALIDATION_FAILED');END IF;
  IF(SELECT count(*) FROM memory_notes WHERE person_id=target)>=100 THEN PERFORM dg_native_people_error('QUOTA_EXCEEDED');END IF;
  INSERT INTO memory_notes(id,person_id,tenant_id,workspace_id,kind,text,source_session_id,source_message_ids,source_focus_version,status,version,expires_at,created_at) VALUES(item_id,target,p.tenant_id,p.workspace_id,input->>'kind',btrim(input->>'text'),source_value->>'sessionId',coalesce(input->'sourceMessageIds','[]'::jsonb)::text,(source_value->>'focusVersion')::bigint,'open',1,least(p.expires_at,dg_native_people_iso(time_value::timestamptz+interval '720 hours')),time_value);PERFORM dg_native_people_touch(target,'memory.note_created');
 ELSIF action_value='note_control' THEN
  PERFORM dg_native_people_fields(input,ARRAY['noteId','version','action']);IF coalesce(input->>'action','') NOT IN('complete','delete') THEN PERFORM dg_native_people_error('VALIDATION_FAILED');END IF;
  SELECT * INTO n FROM memory_notes WHERE id=input->>'noteId' AND person_id=target FOR UPDATE;IF n.id IS NULL THEN PERFORM dg_native_people_error('NOT_FOUND');END IF;IF input->>'version' IS DISTINCT FROM n.version::text THEN PERFORM dg_native_people_error('VERSION_CONFLICT');END IF;
  IF input->>'action'='delete' THEN DELETE FROM memory_notes WHERE id=n.id;ELSE IF n.kind<>'todo' OR n.status<>'open' THEN PERFORM dg_native_people_error('STATE_CONFLICT');END IF;UPDATE memory_notes SET status='completed',version=version+1 WHERE id=n.id;END IF;PERFORM dg_native_people_touch(target,'memory.note_'||(input->>'action'));
 ELSIF action_value='greet' THEN
  PERFORM dg_native_people_fields(input,ARRAY['version']);IF input->>'version' IS DISTINCT FROM p.version::text THEN PERFORM dg_native_people_error('VERSION_CONFLICT');END IF;
  IF p.owner_user_id IS NULL THEN SELECT v.timezone INTO zone_value FROM reception_sessions s JOIN reception_terminals t ON t.id=s.terminal_id JOIN venues v ON v.id=t.venue_id WHERE s.id=p.guest_session_id;ELSE SELECT timezone INTO zone_value FROM venues WHERE workspace_id=p.workspace_id AND tenant_id=p.tenant_id ORDER BY id LIMIT 1;END IF;zone_value:=coalesce(zone_value,'Asia/Shanghai');IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=zone_value) THEN PERFORM dg_native_people_error('STATE_CONFLICT');END IF;clock_value:=to_char(time_value::timestamptz AT TIME ZONE zone_value,'HH24:MI');
  reason_value:=CASE WHEN p.personalization<>1 THEN 'disabled' WHEN p.do_not_disturb=1 THEN 'do_not_disturb' WHEN p.quiet_start=p.quiet_end OR(p.quiet_start<p.quiet_end AND clock_value>=p.quiet_start AND clock_value<p.quiet_end) OR(p.quiet_start>p.quiet_end AND(clock_value>=p.quiet_start OR clock_value<p.quiet_end)) THEN 'quiet_hours' WHEN p.last_greeted_at IS NOT NULL AND time_value::timestamptz<p.last_greeted_at::timestamptz+make_interval(mins=>p.cooldown_minutes::integer) THEN 'cooldown' ELSE NULL END;
  IF reason_value IS NULL THEN
   SELECT m.* INTO nickname FROM memory_facts m JOIN memory_lookup l ON l.fact_id=m.id AND l.person_id=m.person_id AND l.value=m.value WHERE m.person_id=target AND m.fact_key='nickname' AND m.status='confirmed' AND m.visibility='reception' AND m.expires_at>time_value ORDER BY m.created_at,m.id LIMIT 1;
   UPDATE people SET last_greeted_at=time_value,version=version+1,updated_at=time_value WHERE id=target;PERFORM dg_native_people_invalidate(target);p.version:=p.version+1;
  END IF;
  INSERT INTO _dg_native_people_greetings VALUES(item_id,target,p.version,reason_value IS NULL,reason_value,nickname.id,nickname.version,time_value);RETURN item_id;
 ELSIF action_value='erase' THEN
  PERFORM dg_native_people_fields(input,ARRAY['version','confirmed']);IF input->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN PERFORM dg_native_people_error('VALIDATION_FAILED');END IF;IF input->>'version' IS DISTINCT FROM p.version::text THEN PERFORM dg_native_people_error('VERSION_CONFLICT');END IF;RETURN dg_native_people_erase_internal(target,'owner_request');
 ELSE PERFORM dg_native_people_error('VALIDATION_FAILED');END IF;
 RETURN target;
END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_people_apply(target text,action_value text,input jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN RETURN dg_native_people_mutate(dg_native_people_owned(target),action_value,input);END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_people_row_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE api_name text;worker_name text;
BEGIN
 SELECT app_role,worker_role INTO api_name,worker_name FROM _dg_native_runtime_control WHERE id=1;
 IF current_user IN(api_name,worker_name) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Profile writes require a guarded operation';END IF;
 IF TG_OP='INSERT' THEN IF NEW.version<>1 OR NEW.personalization<>0 OR NEW.do_not_disturb<>1 OR NEW.expires_at<=NEW.consent_at OR extract(epoch FROM NEW.expires_at::timestamptz)-extract(epoch FROM NEW.consent_at::timestamptz) NOT IN(30*86400,90*86400,180*86400) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Profile begins with explicit bounded consent and quiet defaults';END IF;
 ELSE IF NEW.version<>OLD.version+1 OR to_jsonb(NEW)-ARRAY['owner_user_id','guest_session_id','display_name','roles','identity_kind','status','version','personalization','do_not_disturb','quiet_start','quiet_end','cooldown_minutes','last_greeted_at','updated_at'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['owner_user_id','guest_session_id','display_name','roles','identity_kind','status','version','personalization','do_not_disturb','quiet_start','quiet_end','cooldown_minutes','last_greeted_at','updated_at'] OR OLD.status='deleted' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Profile identity, consent expiry and terminal deletion are immutable';END IF;END IF;
 IF NEW.status='active' THEN IF NOT((NEW.owner_user_id IS NOT NULL AND NEW.guest_session_id IS NULL AND NEW.identity_kind='account_verified' AND NEW.roles::jsonb @> '["employee"]'::jsonb) OR(NEW.owner_user_id IS NULL AND NEW.guest_session_id IS NOT NULL AND NEW.identity_kind='self_reported' AND NOT NEW.roles::jsonb ? 'employee')) OR jsonb_typeof(NEW.roles::jsonb)<>'array' OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW.roles::jsonb) r WHERE r NOT IN('employee','visitor','customer')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Account business labels do not replace its bound identity';END IF;
 ELSE IF NEW.owner_user_id IS NOT NULL OR NEW.guest_session_id IS NOT NULL OR NEW.display_name<>'已删除资料' OR NEW.roles<>'[]' OR NEW.personalization<>0 OR NEW.last_greeted_at IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Deleted profile must clear its personal fields';END IF;END IF;RETURN NEW;
END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_people_registration() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NEW.status<>'active' OR NOT((NEW.owner_user_id IS NOT NULL AND NEW.guest_session_id IS NULL AND NEW.identity_kind='account_verified' AND dg_native_office_member(NEW.owner_user_id,NEW.tenant_id,NEW.workspace_id)) OR(NEW.owner_user_id IS NULL AND NEW.guest_session_id IS NOT NULL AND NEW.identity_kind='self_reported' AND EXISTS(SELECT 1 FROM reception_sessions s JOIN _dg_native_reception_origins o ON o.session_id=s.id WHERE s.id=NEW.guest_session_id AND s.tenant_id=NEW.tenant_id AND s.workspace_id=NEW.workspace_id AND s.status='active' AND dg_native_reception_source_valid(s.id)))) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native profile requires an active authenticated account scope';END IF;
 INSERT INTO _dg_native_people_guards VALUES(NEW.id,NEW.tenant_id,NEW.workspace_id,NEW.owner_user_id,NULL,dg_utc_now());IF NEW.owner_user_id IS NULL THEN INSERT INTO _dg_native_guest_memory_origins SELECT NEW.id,NEW.guest_session_id,s.focus_version,NEW.tenant_id,NEW.workspace_id,NEW.consent_at FROM reception_sessions s WHERE s.id=NEW.guest_session_id;END IF;RETURN NEW;
END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_people_fact_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE p people%ROWTYPE;
BEGIN
 SELECT * INTO p FROM people WHERE id=NEW.person_id;
 IF p.id IS NULL OR p.status<>'active' OR NEW.tenant_id<>p.tenant_id OR NEW.workspace_id<>p.workspace_id OR NEW.expires_at>p.expires_at OR (p.owner_user_id IS NOT NULL AND(NEW.source_kind<>'self_statement' OR NEW.source_session_id IS NOT NULL OR NEW.source_message_id IS NOT NULL OR NEW.source_focus_version IS NOT NULL)) OR(p.owner_user_id IS NULL AND(NEW.source_kind NOT IN('self_statement','session_text') OR NEW.source_session_id IS NULL OR NEW.source_focus_version IS NULL OR (NEW.source_kind='session_text')<>(NEW.source_message_id IS NOT NULL))) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native account memory needs its current subject and explicit self-statement source';END IF;
 IF TG_OP='INSERT' THEN IF p.owner_user_id IS NULL THEN PERFORM dg_native_guest_memory_source(p.id,NEW.source_session_id,NEW.source_focus_version,CASE WHEN NEW.source_message_id IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(NEW.source_message_id) END,NEW.value);END IF;IF NEW.status<>'pending' OR NEW.version<>1 OR NEW.confirmed_at IS NOT NULL OR NEW.expires_at<=dg_utc_now() THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Memory must start as a pending statement';END IF;
 ELSE IF NEW.version<>OLD.version+1 OR OLD.status NOT IN('pending','confirmed') OR NEW.status='confirmed' AND OLD.status<>'pending' OR to_jsonb(NEW)-ARRAY['value','status','version','confirmed_at','updated_at'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['value','status','version','confirmed_at','updated_at'] THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Memory versions, source and confirmation transitions are guarded';END IF;END IF;RETURN NEW;
END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_people_note_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE p people%ROWTYPE;
BEGIN
 SELECT * INTO p FROM people WHERE id=NEW.person_id;
 IF p.id IS NULL OR p.status<>'active' OR NEW.tenant_id<>p.tenant_id OR NEW.workspace_id<>p.workspace_id OR (p.owner_user_id IS NOT NULL AND(NEW.source_session_id IS NOT NULL OR NEW.source_message_ids::jsonb<>'[]'::jsonb OR NEW.source_focus_version IS NOT NULL)) OR(p.owner_user_id IS NULL AND(NEW.source_session_id IS NULL OR NEW.source_focus_version IS NULL)) OR NEW.expires_at>p.expires_at OR extract(epoch FROM NEW.expires_at::timestamptz)-extract(epoch FROM NEW.created_at::timestamptz)>30*86400 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native account notes need reviewed source scope and bounded retention';END IF;
 IF TG_OP='INSERT' THEN IF p.owner_user_id IS NULL THEN PERFORM dg_native_guest_memory_source(p.id,NEW.source_session_id,NEW.source_focus_version,NEW.source_message_ids::jsonb,NULL);END IF;IF NEW.version<>1 OR NEW.status<>'open' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Note starts from its reviewed open state';END IF;
 ELSE IF NEW.version<>OLD.version+1 OR OLD.kind<>'todo' OR OLD.status<>'open' OR NEW.status<>'completed' OR to_jsonb(NEW)-ARRAY['status','version'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['status','version'] THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Only an open todo may be completed';END IF;END IF;RETURN NEW;
END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_people_final_binding() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE target text;p people%ROWTYPE;g _dg_native_people_guards%ROWTYPE;
BEGIN
 target:=CASE WHEN TG_TABLE_NAME='people' THEN coalesce(to_jsonb(NEW)->>'id',to_jsonb(OLD)->>'id') WHEN TG_TABLE_NAME='_dg_native_people_guards' THEN coalesce(to_jsonb(NEW)->>'person_id',to_jsonb(OLD)->>'person_id') ELSE coalesce(to_jsonb(NEW)->>'person_id',to_jsonb(OLD)->>'person_id') END;
 SELECT * INTO p FROM people WHERE id=target;SELECT * INTO g FROM _dg_native_people_guards WHERE person_id=target;
 IF p.id IS NULL OR g.person_id IS NULL OR p.tenant_id<>g.tenant_id OR p.workspace_id<>g.workspace_id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Profile and immutable consent guard must commit together';END IF;
 IF p.owner_user_id IS NULL AND p.status='active' AND NOT EXISTS(SELECT 1 FROM _dg_native_guest_memory_origins o JOIN memory_session_links l ON l.person_id=o.person_id WHERE o.person_id=p.id AND o.tenant_id=p.tenant_id AND o.workspace_id=p.workspace_id AND l.session_id=p.guest_session_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Guest profile requires immutable consent origin and current session link';END IF;IF p.status='active' THEN IF g.invalidated_at IS NOT NULL OR p.owner_user_id IS DISTINCT FROM g.owner_user_id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Active profile requires its original unrevoked account scope';END IF;
 ELSE IF g.invalidated_at IS NULL OR EXISTS(SELECT 1 FROM memory_facts WHERE person_id=target) OR EXISTS(SELECT 1 FROM memory_notes WHERE person_id=target) OR NOT EXISTS(SELECT 1 FROM privacy_requests WHERE person_id=target AND status='completed') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Deleted profile must commit cleared memory, guard and receipt together';END IF;END IF;
 IF EXISTS(SELECT f.id,f.value FROM memory_facts f WHERE f.person_id=target AND p.status='active' AND p.personalization=1 AND g.invalidated_at IS NULL AND f.status='confirmed' AND f.visibility='reception' AND f.expires_at>dg_utc_now() EXCEPT SELECT l.fact_id,l.value FROM memory_lookup l WHERE l.person_id=target) OR EXISTS(SELECT l.fact_id,l.value FROM memory_lookup l WHERE l.person_id=target EXCEPT SELECT f.id,f.value FROM memory_facts f WHERE f.person_id=target AND p.status='active' AND p.personalization=1 AND g.invalidated_at IS NULL AND f.status='confirmed' AND f.visibility='reception' AND f.expires_at>dg_utc_now()) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Memory lookup must equal only the currently confirmed permitted statements';END IF;RETURN NULL;
END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_people_sweep() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE p people%ROWTYPE;changed bigint:=0;affected bigint;time_value text:=dg_utc_now();current_app text;
BEGIN
 PERFORM dg_native_people_runtime(true);SELECT app_env INTO current_app FROM _dg_native_runtime_control WHERE id=1;
 FOR p IN SELECT * FROM people WHERE owner_user_id IS NOT NULL AND environment='mock' AND app_env=current_app AND status='active' AND id IN(SELECT person_id FROM _dg_native_people_guards) ORDER BY id FOR UPDATE SKIP LOCKED LOOP
  IF p.expires_at<=time_value OR NOT dg_native_office_member(p.owner_user_id,p.tenant_id,p.workspace_id) THEN PERFORM dg_native_people_erase_internal(p.id,CASE WHEN p.expires_at<=time_value THEN 'retention_expired' ELSE 'membership_withdrawn' END);changed:=changed+1;CONTINUE;END IF;
  UPDATE memory_facts SET status='expired',value='',confirmed_at=NULL,version=version+1,updated_at=time_value WHERE person_id=p.id AND expires_at<=time_value AND status IN('pending','confirmed');GET DIAGNOSTICS affected=ROW_COUNT;DELETE FROM memory_notes WHERE person_id=p.id AND expires_at<=time_value;IF FOUND THEN affected:=affected+1;END IF;
  IF affected>0 THEN PERFORM dg_native_people_touch(p.id,'memory.retention_cleaned');changed:=changed+affected;END IF;
 END LOOP;RETURN changed;
END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_reception_authorize(target text,token_hash_value text,csrf_hash_value text,write_value boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v_meta jsonb;v_session reception_sessions%ROWTYPE;v_access _dg_native_reception_access%ROWTYPE;v_terminal _dg_native_reception_terminals%ROWTYPE;
BEGIN
 v_meta:=dg_native_reception_meta(target,token_hash_value);SELECT * INTO v_terminal FROM _dg_native_reception_terminals WHERE terminal_id=v_meta->>'terminalId';PERFORM user_id FROM dg_native_locked_membership(v_meta->>'actorId');PERFORM user_id FROM dg_native_locked_membership(v_terminal.actor_id);PERFORM dg_native_reception_workspace(v_meta->>'tenantId',v_meta->>'workspaceId',write_value);
 IF write_value THEN PERFORM id FROM reception_terminals WHERE id=v_meta->>'terminalId' FOR UPDATE;SELECT * INTO v_session FROM reception_sessions WHERE id=target FOR UPDATE;
 ELSE PERFORM id FROM reception_terminals WHERE id=v_meta->>'terminalId' FOR SHARE;SELECT * INTO v_session FROM reception_sessions WHERE id=target FOR SHARE;END IF;
 PERFORM dg_native_reception_meta(target,token_hash_value);SELECT * INTO v_access FROM _dg_native_reception_access WHERE session_id=target AND token_hash=token_hash_value AND access_version=v_session.access_version;
 IF write_value AND(csrf_hash_value IS NULL OR v_access.csrf_hash IS DISTINCT FROM csrf_hash_value) THEN PERFORM dg_native_reception_error('FORBIDDEN');END IF;
END;$dg$;

-- Guest capabilities enter through these checked wrappers. Internal mutation helpers have no API grant.
CREATE FUNCTION dg_native_guest_memory_session(target text,token_hash_value text,csrf_hash_value text,focus_value bigint,write_value boolean DEFAULT false) RETURNS reception_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s reception_sessions%ROWTYPE;
BEGIN
 PERFORM dg_native_reception_authorize(target,token_hash_value,csrf_hash_value,write_value);SELECT * INTO s FROM reception_sessions WHERE id=target;
 IF focus_value IS NOT NULL AND focus_value<>s.focus_version OR write_value AND s.status<>'active' THEN PERFORM dg_native_people_error('VERSION_CONFLICT');END IF;RETURN s;
END;$dg$;
CREATE FUNCTION dg_native_guest_memory_owned(target text,required_value boolean DEFAULT true) RETURNS people LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE p people%ROWTYPE;s reception_sessions%ROWTYPE;
BEGIN
 SELECT * INTO s FROM reception_sessions WHERE id=target;
 SELECT p0.* INTO p FROM people p0 JOIN _dg_native_people_guards g ON g.person_id=p0.id JOIN _dg_native_guest_memory_origins o ON o.person_id=p0.id JOIN memory_session_links l ON l.person_id=p0.id AND l.session_id=target AND l.focus_version=s.focus_version WHERE p0.guest_session_id=target AND p0.owner_user_id IS NULL AND p0.identity_kind='self_reported' AND p0.tenant_id=s.tenant_id AND p0.workspace_id=s.workspace_id AND p0.environment=s.environment AND p0.app_env=s.app_env AND p0.status='active' AND p0.expires_at>dg_utc_now() AND g.invalidated_at IS NULL FOR UPDATE OF p0;
 IF p.id IS NULL THEN IF EXISTS(SELECT 1 FROM people WHERE guest_session_id=target AND status='active') THEN PERFORM dg_native_people_error('VERSION_CONFLICT');ELSIF required_value THEN PERFORM dg_native_people_error('NOT_FOUND');END IF;END IF;IF p.id IS NOT NULL AND(p.expires_at<=dg_utc_now() OR s.expires_at<=dg_utc_now() OR s.activity_at<=dg_native_people_iso(clock_timestamp()-interval '120 seconds')) THEN PERFORM dg_native_people_error('NOT_FOUND');END IF;RETURN p;
END;$dg$;
CREATE FUNCTION dg_native_guest_memory_source(person_value text,session_value text,focus_value bigint,messages_value jsonb,value_value text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE item text;m reception_messages%ROWTYPE;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM people p JOIN memory_session_links l ON l.person_id=p.id JOIN reception_sessions s ON s.id=l.session_id WHERE p.id=person_value AND p.guest_session_id=session_value AND l.session_id=session_value AND l.focus_version=focus_value AND s.focus_version=focus_value AND s.status='active' AND s.expires_at>dg_utc_now() AND s.activity_at>dg_native_people_iso(clock_timestamp()-interval '120 seconds') AND l.transcript_expires_at>dg_utc_now() AND dg_native_reception_source_valid(s.id)) OR jsonb_typeof(messages_value) IS DISTINCT FROM 'array' OR jsonb_array_length(messages_value)>20 THEN PERFORM dg_native_people_error('INVALID_SOURCE');END IF;
 FOR item IN SELECT jsonb_array_elements_text(messages_value) LOOP
  SELECT * INTO m FROM reception_messages WHERE id=item AND session_id=session_value AND focus_version=focus_value AND role='visitor' AND input_source='typed' AND text<>'';
  IF m.id IS NULL OR dg_native_guest_memory_transcript_deadline(session_value,focus_value)<=dg_utc_now() OR value_value IS NOT NULL AND strpos(m.text,value_value)=0 THEN PERFORM dg_native_people_error('INVALID_SOURCE');END IF;
 END LOOP;
END;$dg$;
CREATE FUNCTION dg_native_guest_memory_transcript_deadline(session_value text,focus_value bigint) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE original_value text;linked_value text;
BEGIN SELECT transcript_expires_at INTO original_value FROM _dg_native_reception_origins WHERE session_id=session_value AND invalidated_at IS NULL;
 IF original_value IS NULL THEN RETURN '';END IF;SELECT l.transcript_expires_at INTO linked_value FROM memory_session_links l JOIN people p ON p.id=l.person_id JOIN _dg_native_people_guards g ON g.person_id=p.id WHERE l.session_id=session_value AND l.focus_version=focus_value AND p.status='active' AND p.expires_at>dg_utc_now() AND g.invalidated_at IS NULL;RETURN greatest(original_value,coalesce(linked_value,''));
END;$dg$;
CREATE FUNCTION dg_native_guest_memory_private_context(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE p people%ROWTYPE;result jsonb;
BEGIN
 p:=dg_native_guest_memory_owned(target,false);IF p.id IS NULL OR p.personalization<>1 THEN RETURN NULL;END IF;
 SELECT coalesce(jsonb_agg(x.value ORDER BY x.id),'[]') INTO result FROM(SELECT f.id,jsonb_build_object('id',f.id,'key',f.fact_key,'value',f.value,'version',f.version) value FROM memory_facts f JOIN memory_lookup l ON l.fact_id=f.id AND l.person_id=f.person_id AND l.value=f.value WHERE f.person_id=p.id AND f.status='confirmed' AND f.visibility='reception' AND f.expires_at>dg_utc_now() ORDER BY f.id LIMIT 100) x;
 RETURN jsonb_build_object('personId',p.id,'version',p.version,'facts',result);
END;$dg$;
CREATE FUNCTION dg_native_guest_memory_context(target text,token_hash_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN PERFORM dg_native_guest_memory_session(target,token_hash_value,NULL,NULL,false);RETURN dg_native_guest_memory_private_context(target);END;$dg$;
CREATE FUNCTION dg_native_guest_memory_view(target text,token_hash_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE p people%ROWTYPE;
BEGIN PERFORM dg_native_guest_memory_session(target,token_hash_value,NULL,NULL,false);p:=dg_native_guest_memory_owned(target,false);IF p.id IS NULL THEN RETURN jsonb_build_object('person',NULL,'facts','[]'::jsonb,'notes','[]'::jsonb);END IF;RETURN dg_native_people_project(p.id);END;$dg$;

CREATE OR REPLACE FUNCTION dg_native_people_invalidate(target text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s record;
BEGIN
 UPDATE idempotency i SET response='{}',redacted=1 FROM _dg_native_people_guards g WHERE g.person_id=target AND i.tenant_id=g.tenant_id AND i.actor_id=g.owner_user_id AND i.action LIKE 'POST /api/v1/people/%' AND i.redacted=0 AND i.response::jsonb->>'resourceId'=target;
 UPDATE idempotency i SET response='{}',redacted=1 FROM _dg_native_guest_memory_actions a WHERE a.person_id=target AND i.redacted=0 AND i.response::jsonb->>'resourceId'=a.id;
 FOR s IN SELECT DISTINCT session_id FROM reception_messages WHERE memory_person_id=target AND text<>'' LOOP
  UPDATE reception_messages SET text='',status='cancelled',knowledge_citations='[]' WHERE session_id=s.session_id AND memory_person_id=target AND(text<>'' OR status<>'cancelled' OR knowledge_citations<>'[]');
  IF FOUND THEN UPDATE reception_sessions SET version=version+1,reply_epoch=reply_epoch+1 WHERE id=s.session_id AND status IN('active','human');END IF;
 END LOOP;
END;$dg$;
CREATE OR REPLACE FUNCTION dg_native_people_erase_internal(target text,reason_value text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE p people%ROWTYPE;receipt_id text;time_value text:=dg_utc_now();s record;
BEGIN
 SELECT * INTO p FROM people WHERE id=target FOR UPDATE;SELECT id INTO receipt_id FROM privacy_requests WHERE person_id=target AND status='completed' ORDER BY created_at,id LIMIT 1;IF receipt_id IS NOT NULL THEN RETURN receipt_id;END IF;
 IF p.id IS NULL OR reason_value NOT IN('owner_request','retention_expired','membership_withdrawn') THEN PERFORM dg_native_people_error('STATE_CONFLICT');END IF;
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

ALTER TABLE _dg_native_guest_memory_attempts ADD COLUMN key_hash text NOT NULL;
ALTER TABLE _dg_native_guest_memory_attempts ADD COLUMN body_hash text NOT NULL;
CREATE UNIQUE INDEX native_guest_memory_attempt_key ON _dg_native_guest_memory_attempts(session_id,key_hash);
CREATE FUNCTION dg_native_guest_memory_attempt(target text,token_hash_value text,csrf_hash_value text,focus_value bigint,key_hash_value text,body_hash_value text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE prior _dg_native_guest_memory_attempts%ROWTYPE;
BEGIN
 PERFORM dg_native_guest_memory_session(target,token_hash_value,csrf_hash_value,focus_value,true);IF key_hash_value !~ '^[a-f0-9]{64}$' OR body_hash_value !~ '^[a-f0-9]{64}$' THEN PERFORM dg_native_people_error('VALIDATION_FAILED');END IF;
 SELECT * INTO prior FROM _dg_native_guest_memory_attempts WHERE session_id=target AND key_hash=key_hash_value;IF prior.id IS NOT NULL THEN IF prior.body_hash<>body_hash_value THEN PERFORM dg_native_people_error('DATA_REMOVED');END IF;RETURN;END IF;
 IF(SELECT count(*) FROM _dg_native_guest_memory_attempts WHERE session_id=target AND created_at>dg_native_people_iso(clock_timestamp()-interval '60 seconds'))>=5 OR(SELECT count(*) FROM _dg_native_guest_memory_attempts WHERE session_id=target)>=1000 THEN PERFORM dg_native_people_error('RATE_LIMITED');END IF;
 INSERT INTO _dg_native_guest_memory_attempts VALUES(gen_random_uuid()::text,target,dg_utc_now(),key_hash_value,body_hash_value);
END;$dg$;

CREATE FUNCTION dg_native_guest_memory_recovery_meta(target text,token_hash_value text,credential_value text,code_hash_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s reception_sessions%ROWTYPE;c memory_recovery_credentials%ROWTYPE;p people%ROWTYPE;
BEGIN
 s:=dg_native_guest_memory_session(target,token_hash_value,NULL,NULL,false);
 SELECT c0.* INTO c FROM memory_recovery_credentials c0 JOIN _dg_native_guest_memory_recovery_origins o ON o.credential_id=c0.id WHERE c0.id=credential_value AND c0.tenant_id=s.tenant_id AND c0.workspace_id=s.workspace_id AND c0.environment=s.environment AND c0.app_env=s.app_env AND c0.token_hash=code_hash_value AND c0.token_hash<>'' AND c0.expires_at>dg_utc_now() AND c0.revoked_at IS NULL AND c0.used_at IS NULL FOR UPDATE OF c0;
 IF c.id IS NULL OR c.expires_at<=dg_utc_now() OR c.token_hash<>code_hash_value OR c.used_at IS NOT NULL OR c.revoked_at IS NOT NULL THEN PERFORM dg_native_people_error('RESTORE_UNAVAILABLE');END IF;
 SELECT p0.* INTO p FROM people p0 JOIN _dg_native_people_guards g ON g.person_id=p0.id WHERE p0.id=c.person_id AND p0.status='active' AND p0.owner_user_id IS NULL AND p0.expires_at>dg_utc_now() AND g.invalidated_at IS NULL FOR UPDATE OF p0;
 IF p.id IS NULL OR p.expires_at<=dg_utc_now() OR EXISTS(SELECT 1 FROM reception_sessions WHERE id=p.guest_session_id AND status IN('active','human')) THEN PERFORM dg_native_people_error('RESTORE_UNAVAILABLE');END IF;
 RETURN jsonb_build_object('personId',p.id,'credentialId',c.id,'expiresAt',c.expires_at);
END;$dg$;
CREATE FUNCTION dg_native_guest_memory_greeting_value(target text,p people) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE r _dg_native_people_greetings%ROWTYPE;nickname text;
BEGIN
 SELECT * INTO r FROM _dg_native_people_greetings WHERE id=target AND person_id=p.id;IF r.id IS NULL OR p.version<>r.person_version THEN PERFORM dg_native_people_error('DATA_REMOVED');END IF;
 IF r.nickname_fact_id IS NOT NULL THEN SELECT f.value INTO nickname FROM memory_facts f JOIN memory_lookup l ON l.fact_id=f.id AND l.value=f.value WHERE f.id=r.nickname_fact_id AND f.person_id=p.id AND f.version=r.nickname_fact_version AND f.status='confirmed' AND f.visibility='reception' AND f.expires_at>dg_utc_now() AND p.personalization=1;IF nickname IS NULL THEN PERFORM dg_native_people_error('DATA_REMOVED');END IF;END IF;
 RETURN jsonb_build_object('personId',p.id,'allowed',r.allowed,'reason',r.reason,'text',CASE WHEN NOT r.allowed THEN NULL WHEN nickname IS NULL THEN '您好，现在方便交流吗？' ELSE nickname||'，您好。现在有什么可以帮您？' END);
END;$dg$;
CREATE FUNCTION dg_native_guest_memory_apply(target text,token_hash_value text,csrf_hash_value text,focus_value bigint,action_value text,input jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
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
 PERFORM dg_native_guest_memory_session(target,token_hash_value,csrf_hash_value,focus_value,true);UPDATE reception_sessions SET version=version+1,activity_at=dg_utc_now() WHERE id=target;
 INSERT INTO _dg_native_guest_memory_actions VALUES(action_id,person_value,target,s.focus_version,access_value,action_value,resource_value,pg_current_xact_id()::text,time_value);
 INSERT INTO outbox_events VALUES(gen_random_uuid()::text,s.tenant_id,s.workspace_id,target,'memory.guest_'||action_value,'mock','{}',time_value,NULL);RETURN action_id;
END;$dg$;
CREATE FUNCTION dg_native_guest_memory_result(target text,token_hash_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE a _dg_native_guest_memory_actions%ROWTYPE;s reception_sessions%ROWTYPE;p people%ROWTYPE;c memory_recovery_credentials%ROWTYPE;r privacy_requests%ROWTYPE;
BEGIN
 SELECT * INTO a FROM _dg_native_guest_memory_actions WHERE id=target;IF a.id IS NULL THEN PERFORM dg_native_people_error('DATA_REMOVED');END IF;
 s:=dg_native_guest_memory_session(a.session_id,token_hash_value,NULL,a.focus_version,false);
 IF NOT EXISTS(SELECT 1 FROM _dg_native_reception_access WHERE id=a.access_id AND token_hash=token_hash_value AND session_id=a.session_id AND access_version=s.access_version) THEN PERFORM dg_native_people_error('DATA_REMOVED');END IF;
 IF a.kind='erase' THEN SELECT * INTO r FROM privacy_requests WHERE id=a.resource_id AND person_id=a.person_id AND status='completed';IF r.id IS NULL THEN PERFORM dg_native_people_error('DATA_REMOVED');END IF;RETURN jsonb_build_object('requestId',r.id,'status','completed','local','completed','external','not_applicable','retained',jsonb_build_array('不含原文的审计及删除回执编号','本人资料删除后的最小授权撤回守卫'));END IF;
 p:=dg_native_guest_memory_owned(a.session_id);IF p.id<>a.person_id THEN PERFORM dg_native_people_error('DATA_REMOVED');END IF;
 IF a.kind='greet' THEN RETURN dg_native_guest_memory_greeting_value(a.resource_id,p);
 ELSIF a.kind='recovery' THEN SELECT * INTO c FROM memory_recovery_credentials WHERE id=a.resource_id AND person_id=p.id AND token_hash<>'' AND revoked_at IS NULL AND used_at IS NULL AND expires_at>dg_utc_now();IF c.id IS NULL THEN PERFORM dg_native_people_error('DATA_REMOVED');END IF;RETURN jsonb_build_object('personId',p.id,'credentialId',c.id,'expiresAt',c.expires_at);
 ELSIF a.kind='revoke' THEN RETURN jsonb_build_object('personId',p.id,'revoked',true);END IF;RETURN dg_native_people_project(p.id);
END;$dg$;
CREATE FUNCTION dg_native_guest_memory_search(target text,token_hash_value text,query_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE p people%ROWTYPE;items jsonb;
BEGIN
 PERFORM dg_native_guest_memory_session(target,token_hash_value,NULL,NULL,false);p:=dg_native_guest_memory_owned(target);IF query_value IS NULL OR char_length(query_value)>100 THEN PERFORM dg_native_people_error('VALIDATION_FAILED');END IF;
 SELECT coalesce(jsonb_agg(value ORDER BY id),'[]') INTO items FROM(SELECT f.id,jsonb_build_object('id',f.id,'key',f.fact_key,'value',f.value) value FROM memory_lookup l JOIN memory_facts f ON f.id=l.fact_id WHERE l.person_id=p.id AND p.personalization=1 AND f.status='confirmed' AND f.visibility='reception' AND f.expires_at>dg_utc_now() AND strpos(f.value,query_value)>0 ORDER BY f.id LIMIT 100) x;RETURN jsonb_build_object('personId',p.id,'items',items);
END;$dg$;
CREATE FUNCTION dg_native_guest_memory_export(target text,token_hash_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE p people%ROWTYPE;transcript_value jsonb;
BEGIN
 PERFORM dg_native_guest_memory_session(target,token_hash_value,NULL,NULL,false);p:=dg_native_guest_memory_owned(target);
 SELECT coalesce(jsonb_agg(value ORDER BY native_ordinal),'[]') INTO transcript_value FROM(SELECT m.native_ordinal,jsonb_build_object('id',m.id,'role',m.role,'text',m.text,'sessionId',m.session_id,'createdAt',m.created_at) value FROM memory_session_links l JOIN reception_messages m ON m.session_id=l.session_id AND m.focus_version=l.focus_version JOIN _dg_native_reception_origins o ON o.session_id=m.session_id WHERE l.person_id=p.id AND m.tenant_id=p.tenant_id AND m.workspace_id=p.workspace_id AND l.transcript_expires_at>dg_utc_now() AND o.invalidated_at IS NULL AND m.text<>'' AND(m.memory_person_id IS NULL OR m.memory_person_id=p.id AND dg_native_guest_memory_message_valid(m.id))) x;
 RETURN jsonb_build_object('schemaVersion',1,'exportedAt',dg_utc_now(),'transcript',transcript_value,'exclusions',jsonb_build_array('其他人员资料','受访人内部备注','登录凭据'))||dg_native_people_project(p.id);
END;$dg$;

CREATE FUNCTION dg_native_guest_memory_link_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE p people%ROWTYPE;s reception_sessions%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Consent links cannot be retargeted or extended';END IF;IF TG_OP='DELETE' THEN RETURN OLD;END IF;
 SELECT * INTO p FROM people WHERE id=NEW.person_id;SELECT * INTO s FROM reception_sessions WHERE id=NEW.session_id;
 IF p.id IS NULL OR s.id IS NULL OR p.owner_user_id IS NOT NULL OR p.status<>'active' OR p.guest_session_id<>s.id OR p.tenant_id<>s.tenant_id OR p.workspace_id<>s.workspace_id OR NEW.focus_version<>s.focus_version OR s.status<>'active' OR NEW.transcript_expires_at<>least(p.expires_at,dg_native_people_iso(NEW.consent_at::timestamptz+interval '30 days')) OR NEW.consent_at< p.consent_at THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Guest transcript consent must match its original scope, current target and bounded retention';END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_guest_memory_link_guard BEFORE INSERT OR UPDATE OR DELETE ON memory_session_links FOR EACH ROW EXECUTE FUNCTION dg_native_guest_memory_link_guard();
CREATE CONSTRAINT TRIGGER native_guest_memory_link_final AFTER INSERT OR UPDATE OR DELETE ON memory_session_links DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_people_final_binding();
CREATE CONSTRAINT TRIGGER native_guest_memory_origin_final AFTER INSERT ON _dg_native_guest_memory_origins DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_people_final_binding();
CREATE FUNCTION dg_native_guest_memory_recovery_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE p people%ROWTYPE;
BEGIN
 SELECT * INTO p FROM people WHERE id=NEW.person_id;
 IF p.id IS NULL OR p.owner_user_id IS NOT NULL OR NEW.tenant_id<>p.tenant_id OR NEW.workspace_id<>p.workspace_id OR NEW.environment<>p.environment OR NEW.app_env<>p.app_env THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Recovery cannot create an account identity or change scope';END IF;
 IF TG_OP='INSERT' THEN IF p.status<>'active' OR NEW.revoked_at IS NOT NULL OR NEW.used_at IS NOT NULL OR NEW.token_hash !~ '^[a-f0-9]{64}$' OR NEW.expires_at<>least(p.expires_at,dg_native_people_iso(NEW.created_at::timestamptz+interval '30 days')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Recovery begins once with original bounded expiry';END IF;
 ELSE IF to_jsonb(NEW)-ARRAY['token_hash','revoked_at','used_at'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['token_hash','revoked_at','used_at'] OR NEW.token_hash IS DISTINCT FROM OLD.token_hash AND NEW.token_hash<>'' OR OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at OR OLD.used_at IS NOT NULL AND NEW.used_at IS DISTINCT FROM OLD.used_at OR(NEW.revoked_at IS NOT NULL OR NEW.used_at IS NOT NULL) AND NEW.token_hash<>'' OR NEW.token_hash='' AND NEW.revoked_at IS NULL AND NEW.used_at IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Recovery revocation and consumption are irreversible';END IF;END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_guest_memory_recovery_guard BEFORE INSERT OR UPDATE ON memory_recovery_credentials FOR EACH ROW EXECUTE FUNCTION dg_native_guest_memory_recovery_guard();

CREATE FUNCTION dg_native_guest_memory_proof(session_value text,focus_value bigint,input jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE context_value jsonb;item text;
BEGIN
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR input-ARRAY['personId','version','factIds']<>'{}'::jsonb OR jsonb_typeof(input->'factIds') IS DISTINCT FROM 'array' OR jsonb_array_length(input->'factIds')>10 OR NOT EXISTS(SELECT 1 FROM reception_sessions WHERE id=session_value AND status='active' AND focus_version=focus_value AND expires_at>dg_utc_now() AND activity_at>dg_native_people_iso(clock_timestamp()-interval '120 seconds')) THEN RETURN false;END IF;
 context_value:=dg_native_guest_memory_private_context(session_value);IF context_value IS NULL OR context_value->>'personId' IS DISTINCT FROM input->>'personId' OR context_value->>'version' IS DISTINCT FROM input->>'version' THEN RETURN false;END IF;
 IF(SELECT count(DISTINCT value) FROM jsonb_array_elements_text(input->'factIds'))<>jsonb_array_length(input->'factIds') THEN RETURN false;END IF;
 FOR item IN SELECT jsonb_array_elements_text(input->'factIds') LOOP IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(context_value->'facts') f WHERE f->>'id'=item) THEN RETURN false;END IF;END LOOP;RETURN true;
END;$dg$;
CREATE FUNCTION dg_native_guest_memory_message_valid(target text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE m reception_messages%ROWTYPE;p people%ROWTYPE;item text;
BEGIN
 SELECT * INTO m FROM reception_messages WHERE id=target;IF m.id IS NULL THEN RETURN false;END IF;IF m.memory_person_id IS NULL THEN RETURN m.native_memory_version IS NULL AND m.memory_fact_ids='[]';END IF;
 SELECT p0.* INTO p FROM people p0 JOIN _dg_native_people_guards g ON g.person_id=p0.id WHERE p0.id=m.memory_person_id AND p0.status='active' AND p0.personalization=1 AND p0.expires_at>dg_utc_now() AND p0.version=m.native_memory_version AND g.invalidated_at IS NULL;
 IF p.id IS NULL THEN RETURN false;END IF;
 FOR item IN SELECT jsonb_array_elements_text(m.memory_fact_ids::jsonb) LOOP IF NOT EXISTS(SELECT 1 FROM memory_facts f JOIN memory_lookup l ON l.fact_id=f.id AND l.person_id=f.person_id AND l.value=f.value WHERE f.id=item AND f.person_id=p.id AND f.status='confirmed' AND f.visibility='reception' AND f.expires_at>dg_utc_now()) THEN RETURN false;END IF;END LOOP;RETURN true;
END;$dg$;
CREATE FUNCTION dg_native_guest_memory_add_reply(target text,text_value text,epoch_value bigint,focus_value bigint,citations_value jsonb,memory_value jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s reception_sessions%ROWTYPE;message_value text:=gen_random_uuid()::text;
BEGIN
 SELECT * INTO s FROM reception_sessions WHERE id=target;IF NOT dg_native_guest_memory_proof(target,focus_value,memory_value) OR NOT dg_native_reception_citations_valid(target,citations_value) OR char_length(text_value)>12000 THEN PERFORM dg_native_people_error('INVALID_SOURCE');END IF;
 INSERT INTO reception_messages(id,session_id,tenant_id,workspace_id,role,text,status,reply_epoch,focus_version,created_at,knowledge_citations,input_source,memory_person_id,memory_fact_ids,native_memory_version) VALUES(message_value,target,s.tenant_id,s.workspace_id,'assistant',text_value,'ready',epoch_value,focus_value,dg_utc_now(),citations_value::text,'system',memory_value->>'personId',(memory_value->'factIds')::text,(memory_value->>'version')::bigint);
 INSERT INTO _dg_native_reception_message_digests VALUES(message_value,dg_native_office_hash(dg_native_reception_message_payload(message_value)));RETURN message_value;
END;$dg$;
CREATE OR REPLACE FUNCTION dg_native_reception_message_payload(target text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT (to_jsonb(m)-CASE WHEN m.native_memory_version IS NULL THEN ARRAY['status','text','native_memory_version'] ELSE ARRAY['status','text'] END)||jsonb_build_object('textHash',encode(sha256(convert_to(m.text,'UTF8')),'hex')) FROM reception_messages m WHERE m.id=target
$dg$;
CREATE FUNCTION dg_native_guest_memory_greeting_allowed(p people,session_value text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE zone_value text;clock_value text;
BEGIN
 IF p.personalization<>1 OR p.do_not_disturb<>0 OR p.last_greeted_at IS NOT NULL AND clock_timestamp()<p.last_greeted_at::timestamptz+make_interval(mins=>p.cooldown_minutes::integer) THEN RETURN false;END IF;
 SELECT v.timezone INTO zone_value FROM reception_sessions s JOIN reception_terminals t ON t.id=s.terminal_id JOIN venues v ON v.id=t.venue_id WHERE s.id=session_value;IF zone_value IS NULL OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=zone_value) THEN RETURN false;END IF;clock_value:=to_char(clock_timestamp() AT TIME ZONE zone_value,'HH24:MI');
 RETURN NOT(p.quiet_start=p.quiet_end OR(p.quiet_start<p.quiet_end AND clock_value>=p.quiet_start AND clock_value<p.quiet_end) OR(p.quiet_start>p.quiet_end AND(clock_value>=p.quiet_start OR clock_value<p.quiet_end)));
END;$dg$;
CREATE FUNCTION dg_native_guest_memory_sweep(greet_allowed boolean DEFAULT false) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE w record;p people%ROWTYPE;s reception_sessions%ROWTYPE;l memory_session_links%ROWTYPE;changed bigint:=0;affected bigint;time_value text:=dg_utc_now();greeting_id text;greeting_value jsonb;fact_value text;memory_value jsonb;
BEGIN
 PERFORM dg_native_people_runtime(true);IF greet_allowed AND session_user<>(SELECT worker_role FROM _dg_native_runtime_control WHERE id=1) THEN PERFORM dg_native_people_error('FORBIDDEN');END IF;
 FOR w IN SELECT DISTINCT p0.tenant_id,p0.workspace_id FROM people p0 JOIN _dg_native_guest_memory_origins o ON o.person_id=p0.id WHERE p0.status='active' ORDER BY p0.tenant_id,p0.workspace_id LOOP
  IF NOT pg_try_advisory_xact_lock(hashtextextended('native-reception-workspace:'||w.tenant_id||':'||w.workspace_id,0)) THEN CONTINUE;END IF;
  PERFORM id FROM reception_terminals WHERE tenant_id=w.tenant_id AND workspace_id=w.workspace_id ORDER BY id FOR UPDATE;
  FOR p IN SELECT p0.* FROM people p0 JOIN _dg_native_guest_memory_origins o ON o.person_id=p0.id WHERE p0.tenant_id=w.tenant_id AND p0.workspace_id=w.workspace_id AND p0.status='active' ORDER BY p0.id FOR UPDATE OF p0 SKIP LOCKED LOOP
   IF p.expires_at<=time_value THEN PERFORM dg_native_people_erase_internal(p.id,'retention_expired');changed:=changed+1;CONTINUE;END IF;
   UPDATE memory_facts SET status='expired',value='',confirmed_at=NULL,version=version+1,updated_at=time_value WHERE person_id=p.id AND expires_at<=time_value AND status IN('pending','confirmed');GET DIAGNOSTICS affected=ROW_COUNT;DELETE FROM memory_notes WHERE person_id=p.id AND expires_at<=time_value;IF FOUND THEN affected:=affected+1;END IF;
   UPDATE memory_recovery_credentials SET token_hash='',revoked_at=coalesce(revoked_at,time_value) WHERE person_id=p.id AND expires_at<=time_value AND token_hash<>'';IF FOUND THEN affected:=affected+1;END IF;
   IF affected>0 THEN PERFORM dg_native_people_touch(p.id,'memory.retention_cleaned');changed:=changed+affected;SELECT * INTO p FROM people WHERE id=p.id;END IF;
   IF NOT greet_allowed THEN CONTINUE;END IF;
   SELECT * INTO s FROM reception_sessions WHERE id=p.guest_session_id;SELECT * INTO l FROM memory_session_links WHERE person_id=p.id AND session_id=s.id AND focus_version=s.focus_version;
   IF s.id IS NULL OR s.status<>'active' OR l.person_id IS NULL OR s.expires_at<=time_value OR s.activity_at<=dg_native_people_iso(time_value::timestamptz-interval '120 seconds') OR s.activity_at>dg_native_people_iso(time_value::timestamptz-interval '3 seconds') OR NOT dg_native_reception_source_valid(s.id) OR NOT dg_native_guest_memory_greeting_allowed(p,s.id) OR EXISTS(SELECT 1 FROM memory_session_greetings WHERE session_id=s.id) OR EXISTS(SELECT 1 FROM reception_messages WHERE session_id=s.id AND role='assistant' AND status IN('ready','playing')) OR(SELECT count(*) FROM reception_messages WHERE session_id=s.id)>=200 THEN CONTINUE;END IF;
   greeting_id:=dg_native_people_mutate(p,'greet',jsonb_build_object('version',p.version));SELECT * INTO p FROM people WHERE id=p.id;greeting_value:=dg_native_guest_memory_greeting_value(greeting_id,p);IF NOT(greeting_value->>'allowed')::boolean THEN CONTINUE;END IF;
   SELECT nickname_fact_id INTO fact_value FROM _dg_native_people_greetings WHERE id=greeting_id;memory_value:=jsonb_build_object('personId',p.id,'version',p.version,'factIds',CASE WHEN fact_value IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(fact_value) END);SELECT * INTO s FROM reception_sessions WHERE id=s.id;
   PERFORM dg_native_guest_memory_add_reply(s.id,'【模拟问候】'||(greeting_value->>'text'),s.reply_epoch+1,s.focus_version,'[]'::jsonb,memory_value);UPDATE reception_sessions SET version=version+1,reply_epoch=reply_epoch+1 WHERE id=s.id;INSERT INTO memory_session_greetings VALUES(s.id,p.id,time_value);INSERT INTO outbox_events VALUES(gen_random_uuid()::text,p.tenant_id,p.workspace_id,s.id,'session.personalized_greeting','mock','{}',time_value,NULL);changed:=changed+1;
  END LOOP;
 END LOOP;RETURN changed;
END;$dg$;


-- Reception projections with guest memory.
CREATE OR REPLACE FUNCTION dg_native_reception_message_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE v_session reception_sessions%ROWTYPE;
BEGIN
 SELECT * INTO v_session FROM reception_sessions WHERE id=NEW.session_id;
 IF v_session.id IS NULL OR NEW.tenant_id<>v_session.tenant_id OR NEW.workspace_id<>v_session.workspace_id OR (NEW.memory_person_id IS NULL AND(NEW.memory_fact_ids<>'[]' OR NEW.native_memory_version IS NOT NULL)) OR(NEW.memory_person_id IS NOT NULL AND(NEW.role<>'assistant' OR NEW.native_memory_version IS NULL OR NEW.native_memory_version<1 OR jsonb_typeof(NEW.memory_fact_ids::jsonb)<>'array')) OR NEW.visual_context IS NOT NULL OR NEW.restaurant_context IS NOT NULL OR NEW.speaker_decision_id IS NOT NULL OR NEW.input_source IS DISTINCT FROM(CASE WHEN NEW.role='visitor' THEN 'typed' ELSE 'system' END) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Reception message needs its bound session and supported input proof';END IF;
 IF TG_OP='INSERT' THEN IF NEW.memory_person_id IS NOT NULL AND NOT dg_native_guest_memory_proof(NEW.session_id,NEW.focus_version,jsonb_build_object('personId',NEW.memory_person_id,'version',NEW.native_memory_version,'factIds',NEW.memory_fact_ids::jsonb)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Personalized reply requires the current explicitly confirmed subject and facts';END IF;IF NEW.focus_version<>v_session.focus_version OR NEW.reply_epoch NOT BETWEEN v_session.reply_epoch AND v_session.reply_epoch+1 OR NEW.status IS DISTINCT FROM(CASE WHEN NEW.role='assistant' THEN 'ready' ELSE 'received' END) OR char_length(NEW.text)=0 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Reception message starts from the current typed turn or fixed greeting';END IF;
 ELSE
  IF to_jsonb(NEW)-ARRAY['text','status','knowledge_citations'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['text','status','knowledge_citations'] OR OLD.status='cancelled' AND NEW.status<>'cancelled' OR NEW.text IS DISTINCT FROM OLD.text AND NEW.text<>'' OR NEW.knowledge_citations IS DISTINCT FROM OLD.knowledge_citations AND NEW.knowledge_citations<>'[]' OR NEW.text='' AND NEW.status<>'cancelled' OR NEW.text<>'' AND NEW.knowledge_citations IS DISTINCT FROM OLD.knowledge_citations THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Messages cannot be retargeted, rewritten or replayed after cancellation';END IF;
  IF NEW.text<>'' AND NOT(NEW.status=OLD.status OR NEW.role='assistant' AND((OLD.status='ready' AND NEW.status IN('playing','cancelled')) OR(OLD.status='playing' AND NEW.status IN('completed','cancelled')) OR(OLD.status='completed' AND NEW.status='cancelled'))) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Unsupported reply playback transition';END IF;
 END IF;RETURN NEW;
END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_reception_guest_apply(target text,token_hash_value text,csrf_hash_value text,action_value text,input jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v_row reception_sessions%ROWTYPE;v_access _dg_native_reception_access%ROWTYPE;v_id text:=gen_random_uuid()::text;v_payload jsonb:='{}';v_text text;v_reply text;v_citations jsonb;v_message reception_messages%ROWTYPE;v_epoch bigint;v_required bigint;v_memory jsonb;
BEGIN
 PERFORM dg_native_reception_authorize(target,token_hash_value,csrf_hash_value,true);SELECT * INTO v_row FROM reception_sessions WHERE id=target;SELECT * INTO v_access FROM _dg_native_reception_access WHERE session_id=target AND token_hash=token_hash_value AND access_version=v_row.access_version;
 IF(SELECT count(*) FROM _dg_native_reception_receipts WHERE session_id=target AND access_id IS NOT NULL AND created_at>dg_native_people_iso(clock_timestamp()-interval '60 seconds'))>=120 THEN PERFORM dg_native_reception_error('RATE_LIMITED');END IF;
 IF(SELECT count(*) FROM _dg_native_reception_receipts WHERE session_id=target AND access_id IS NOT NULL)>=1000 THEN PERFORM dg_native_reception_error('QUOTA_EXCEEDED');END IF;
 IF action_value='message' THEN
  PERFORM dg_native_reception_fields(input,ARRAY['text','version','focusVersion','source','reply','citations','memory']);v_text:=input->>'text';v_reply:=input->>'reply';v_citations:=input->'citations';v_memory:=nullif(input->'memory','null'::jsonb);IF v_memory IS NOT NULL AND NOT dg_native_guest_memory_proof(target,v_row.focus_version,v_memory) THEN PERFORM dg_native_reception_error('VALIDATION_FAILED');END IF;
  IF input->>'version' IS DISTINCT FROM v_row.version::text OR input->>'focusVersion' IS DISTINCT FROM v_row.focus_version::text THEN PERFORM dg_native_reception_error('VERSION_CONFLICT');END IF;
  IF input->>'source' IS DISTINCT FROM 'typed' OR jsonb_typeof(input->'text') IS DISTINCT FROM 'string' OR char_length(btrim(v_text)) NOT BETWEEN 1 AND 1000 OR(v_row.status='active' AND(v_reply IS NULL OR left(v_reply,3)<>'【模拟' OR char_length(v_reply)>12000)) OR(v_row.status='human' AND v_reply IS NOT NULL) OR NOT dg_native_reception_citations_valid(target,v_citations) THEN PERFORM dg_native_reception_error('VALIDATION_FAILED');END IF;
  IF(SELECT count(*) FROM reception_messages WHERE session_id=target AND role='visitor' AND created_at>dg_native_people_iso(clock_timestamp()-interval '60 seconds'))>=20 THEN PERFORM dg_native_reception_error('RATE_LIMITED');END IF;
  v_required:=CASE WHEN v_row.status='active' THEN 2 ELSE 1 END;IF(SELECT count(*) FROM reception_messages WHERE session_id=target)+v_required>200 THEN PERFORM dg_native_reception_error('QUOTA_EXCEEDED');END IF;
  PERFORM dg_native_reception_cancel(target);v_epoch:=v_row.reply_epoch+1;PERFORM dg_native_reception_add_message(target,'visitor',btrim(v_text),'received',v_epoch,v_row.focus_version);
  IF v_row.status='active' THEN IF v_memory IS NULL THEN PERFORM dg_native_reception_add_message(target,'assistant',v_reply,'ready',v_epoch,v_row.focus_version,v_citations);ELSE PERFORM dg_native_guest_memory_add_reply(target,v_reply,v_epoch,v_row.focus_version,v_citations,v_memory);END IF;END IF;
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
   IF v_message.id IS NULL OR v_message.status<>(CASE WHEN input->>'type'='reply.started' THEN 'ready' ELSE 'playing' END) OR NOT dg_native_reception_citations_valid(target,v_message.knowledge_citations::jsonb) OR NOT dg_native_guest_memory_message_valid(v_message.id) THEN PERFORM dg_native_reception_error('STATE_CONFLICT');END IF;
   UPDATE reception_messages SET status=CASE WHEN input->>'type'='reply.started' THEN 'playing' ELSE 'completed' END WHERE id=v_message.id;UPDATE reception_sessions SET version=version+1,activity_at=dg_utc_now() WHERE id=target;INSERT INTO outbox_events VALUES(gen_random_uuid()::text,v_row.tenant_id,v_row.workspace_id,target,input->>'type','mock','{}',dg_utc_now(),NULL);
  END IF;
 ELSE PERFORM dg_native_reception_error('VALIDATION_FAILED');END IF;
 INSERT INTO _dg_native_reception_receipts VALUES(v_id,v_row.terminal_id,target,v_access.id,v_row.focus_version,action_value,v_payload::text,pg_current_xact_id()::text,dg_utc_now());RETURN v_id;
END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_reception_project(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v_row reception_sessions%ROWTYPE;v_origin _dg_native_reception_origins%ROWTYPE;v_messages jsonb;v_retained boolean;
BEGIN
 SELECT * INTO v_row FROM reception_sessions WHERE id=target;SELECT * INTO v_origin FROM _dg_native_reception_origins WHERE session_id=target;
 v_retained:=v_origin.invalidated_at IS NULL;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'role',m.role,'text',CASE WHEN v_retained AND dg_native_guest_memory_transcript_deadline(target,m.focus_version)>dg_utc_now() AND(m.memory_person_id IS NULL OR m.focus_version=v_row.focus_version AND dg_native_guest_memory_message_valid(m.id)) AND dg_native_reception_citations_valid(target,m.knowledge_citations::jsonb) THEN m.text ELSE '' END,'status',CASE WHEN NOT v_retained OR dg_native_guest_memory_transcript_deadline(target,m.focus_version)<=dg_utc_now() OR(m.memory_person_id IS NOT NULL AND(m.focus_version<>v_row.focus_version OR NOT dg_native_guest_memory_message_valid(m.id))) OR NOT dg_native_reception_citations_valid(target,m.knowledge_citations::jsonb) THEN 'cancelled' ELSE m.status END,'replyEpoch',m.reply_epoch,'focusVersion',m.focus_version,'createdAt',m.created_at,'restaurantContext',NULL,'citations',CASE WHEN v_retained AND dg_native_guest_memory_transcript_deadline(target,m.focus_version)>dg_utc_now() AND(m.memory_person_id IS NULL OR m.focus_version=v_row.focus_version AND dg_native_guest_memory_message_valid(m.id)) AND dg_native_reception_citations_valid(target,m.knowledge_citations::jsonb) THEN m.knowledge_citations::jsonb ELSE '[]'::jsonb END,'visualContext',NULL,'toolRequests','[]'::jsonb,'inputSource',m.input_source,'speakerDecisionId',m.speaker_decision_id) ORDER BY m.native_ordinal),'[]') INTO v_messages FROM reception_messages m WHERE m.session_id=target;
 RETURN jsonb_build_object('id',v_row.id,'terminalId',v_row.terminal_id,'status',v_row.status,'version',v_row.version,'replyEpoch',v_row.reply_epoch,'focusVersion',v_row.focus_version,'source',v_row.source,'environment',v_row.environment,'identity','anonymous','scene',v_row.service_scene,'sceneAppId',v_origin.scene::jsonb->>'id','sceneAppName',v_origin.scene::jsonb->>'name','expiresAt',v_row.expires_at,'activityAt',v_row.activity_at,'profileName',v_origin.profile::jsonb->>'name','messages',v_messages,'features',jsonb_build_object('speakerFocus',false,'visitRegistration',false,'personalMemory',true,'visionQuestions',false,'dining',false));
END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_reception_sweep() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v_candidate record;v_row reception_sessions%ROWTYPE;v_origin _dg_native_reception_origins%ROWTYPE;v_count bigint:=0;v_changed bigint;v_time text:=dg_utc_now();v_terminal text;
BEGIN
 PERFORM dg_native_reception_runtime(true);
 FOR v_candidate IN SELECT s.id,s.terminal_id,s.tenant_id,s.workspace_id FROM reception_sessions s JOIN _dg_native_reception_origins g ON g.session_id=s.id WHERE s.environment='mock' AND s.app_env=(SELECT app_env FROM _dg_native_runtime_control WHERE id=1) ORDER BY s.terminal_id,s.id LOOP
  -- Parent terminal always precedes its sessions/messages; maintenance never locks a membership afterwards.
  PERFORM dg_native_reception_workspace(v_candidate.tenant_id,v_candidate.workspace_id);v_terminal:=NULL;SELECT id INTO v_terminal FROM reception_terminals WHERE id=v_candidate.terminal_id FOR UPDATE SKIP LOCKED;IF v_terminal IS NULL THEN CONTINUE;END IF;
  SELECT * INTO v_row FROM reception_sessions WHERE id=v_candidate.id FOR UPDATE SKIP LOCKED;IF v_row.id IS NULL THEN CONTINUE;END IF;SELECT * INTO v_origin FROM _dg_native_reception_origins WHERE session_id=v_row.id;
  IF v_origin.invalidated_at IS NULL AND NOT dg_native_reception_source_valid(v_row.id) THEN PERFORM dg_native_reception_end(v_row.id,'source_unavailable',false,true);v_count:=v_count+1;
  ELSIF v_row.status IN('active','human') AND(v_row.expires_at<=v_time OR v_row.activity_at<=dg_native_people_iso(v_time::timestamptz-interval '120 seconds')) THEN PERFORM dg_native_reception_end(v_row.id,'timeout',true);v_count:=v_count+1;END IF;
  UPDATE reception_messages m SET text='',knowledge_citations='[]',status='cancelled' WHERE session_id=v_row.id AND(text<>'' OR knowledge_citations<>'[]' OR status<>'cancelled') AND dg_native_guest_memory_transcript_deadline(v_row.id,m.focus_version)<=v_time;GET DIAGNOSTICS v_changed=ROW_COUNT;v_count:=v_count+v_changed;
  UPDATE reception_messages m SET text='',knowledge_citations='[]',status='cancelled' WHERE session_id=v_row.id AND text<>'' AND((knowledge_citations<>'[]' AND NOT dg_native_reception_citations_valid(v_row.id,knowledge_citations::jsonb)) OR(memory_person_id IS NOT NULL AND NOT dg_native_guest_memory_message_valid(m.id)));GET DIAGNOSTICS v_changed=ROW_COUNT;
  IF v_changed>0 AND v_row.status IN('active','human') THEN PERFORM dg_native_reception_cancel(v_row.id);UPDATE reception_sessions SET version=version+1,reply_epoch=reply_epoch+1 WHERE id=v_row.id;END IF;v_count:=v_count+v_changed;
 END LOOP;
 FOR v_candidate IN SELECT t.id,t.tenant_id,t.workspace_id FROM reception_terminals t JOIN _dg_native_reception_terminals g ON g.terminal_id=t.id WHERE g.app_env=(SELECT app_env FROM _dg_native_runtime_control WHERE id=1) ORDER BY t.id LOOP
  PERFORM dg_native_reception_workspace(v_candidate.tenant_id,v_candidate.workspace_id);v_terminal:=NULL;SELECT id INTO v_terminal FROM reception_terminals WHERE id=v_candidate.id FOR UPDATE SKIP LOCKED;IF v_terminal IS NULL THEN CONTINUE;END IF;
  UPDATE reception_presence SET queue_at=NULL,queue_sequence=NULL WHERE terminal_id=v_terminal AND queue_at IS NOT NULL AND(present=0 OR last_seen_at<=dg_native_people_iso(v_time::timestamptz-interval '30 seconds'));
  DELETE FROM reception_presence p WHERE p.terminal_id=v_terminal AND p.last_seen_at<=dg_native_people_iso(v_time::timestamptz-interval '24 hours') AND p.cooldown_until<=v_time AND NOT EXISTS(SELECT 1 FROM reception_sessions s WHERE s.terminal_id=v_terminal AND s.track_hash=p.track_hash AND s.status IN('active','human'));
 END LOOP;RETURN v_count;
END;$dg$;


-- All helpers remain private; bootstrap grants only the checked projections and operations.
DO $revoke$ DECLARE r record;BEGIN FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND(p.proname LIKE 'dg_native_guest_memory_%' OR p.proname='dg_native_people_mutate') LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',r.signature);END LOOP;END;$revoke$;
