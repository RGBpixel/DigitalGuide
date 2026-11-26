-- Preserve frozen059. Qualify the nickname relation without colliding with the local fact row variable.
CREATE OR REPLACE FUNCTION dg_native_people_apply(target text,action_value text,input jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
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
   SELECT m.* INTO nickname FROM memory_facts m JOIN memory_lookup l ON l.fact_id=m.id AND l.person_id=m.person_id AND l.value=m.value WHERE m.person_id=target AND m.fact_key='nickname' AND m.status='confirmed' AND m.visibility='reception' AND m.expires_at>time_value ORDER BY m.created_at,m.id LIMIT 1;
   UPDATE people SET last_greeted_at=time_value,version=version+1,updated_at=time_value WHERE id=target;PERFORM dg_native_people_invalidate(target);p.version:=p.version+1;
  END IF;
  INSERT INTO _dg_native_people_greetings VALUES(item_id,target,p.version,reason_value IS NULL,reason_value,nickname.id,nickname.version,time_value);RETURN item_id;
 ELSIF action_value='erase' THEN
  PERFORM dg_native_people_fields(input,ARRAY['version','confirmed']);IF input->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN PERFORM dg_native_people_error('VALIDATION_FAILED');END IF;IF input->>'version' IS DISTINCT FROM p.version::text THEN PERFORM dg_native_people_error('VERSION_CONFLICT');END IF;RETURN dg_native_people_erase_internal(target,'owner_request');
 ELSE PERFORM dg_native_people_error('VALIDATION_FAILED');END IF;
 RETURN target;
END;$dg$;

-- Read only the authenticated ownership scope before acquiring its workspace and person locks.
CREATE FUNCTION dg_native_people_scope(target text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE actor text:=current_setting('digitalguide.actor_id',true);g _dg_native_people_guards%ROWTYPE;
BEGIN PERFORM dg_native_people_runtime();PERFORM user_id FROM dg_native_locked_membership(actor);SELECT * INTO g FROM _dg_native_people_guards WHERE person_id=target AND owner_user_id=actor;IF g.person_id IS NULL OR NOT dg_native_office_member(actor,g.tenant_id,g.workspace_id) THEN PERFORM dg_native_people_error('NOT_FOUND');END IF;RETURN g.workspace_id;END;$dg$;
REVOKE ALL ON FUNCTION dg_native_people_scope(text) FROM PUBLIC;
