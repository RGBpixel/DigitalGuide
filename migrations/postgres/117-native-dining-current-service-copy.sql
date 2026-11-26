-- Default greetings direct guests to currently available forms without claiming implemented services are missing.
CREATE OR REPLACE FUNCTION dg_native_dining_spawn(terminal_value text,actor_value text,source_value text,track_hash_value text,inputs_value jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE t reception_terminals%ROWTYPE;r restaurants%ROWTYPE;s reception_sessions%ROWTYPE;id_value text:=gen_random_uuid()::text;created text:=dg_utc_now();profile_value text;scene_value text;grant_value bigint;local_value timestamp;minute_value bigint;
BEGIN
 SELECT r0.* INTO r FROM restaurants r0 JOIN _dg_native_dining_terminal_origins d ON d.restaurant_id=r0.id WHERE d.terminal_id=terminal_value AND d.runtime_id=(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1);
 IF r.id IS NULL THEN PERFORM dg_native_reception_error('NOT_FOUND');END IF;grant_value:=dg_native_dining_stamp(actor_value,r.id);
 PERFORM dg_native_reception_workspace(r.tenant_id,r.workspace_id,true);SELECT current_store.* INTO r FROM restaurants current_store WHERE current_store.id=r.id FOR UPDATE;grant_value:=dg_native_dining_stamp(actor_value,r.id);SELECT * INTO t FROM reception_terminals WHERE id=terminal_value FOR UPDATE;
 SELECT * INTO s FROM reception_sessions WHERE terminal_id=terminal_value AND status IN('active','human');IF s.id IS NOT NULL THEN PERFORM dg_native_reception_error('STATE_CONFLICT');END IF;
 local_value:=clock_timestamp() AT TIME ZONE r.timezone;minute_value:=extract(hour FROM local_value)::bigint*60+extract(minute FROM local_value)::bigint;
 IF r.accepting_guests<>1 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.opening_windows::jsonb) w WHERE w->'days' @> to_jsonb(ARRAY[extract(dow FROM local_value)::bigint]) AND(w->>'startMinute')::bigint<=minute_value AND(w->>'endMinute')::bigint>minute_value) THEN PERFORM dg_native_restaurant_error('RESTAURANT_PAUSED');END IF;
 PERFORM dg_native_restaurant_fields(inputs_value,ARRAY['profile','scene','assets']);
 IF source_value<>'manual' OR track_hash_value !~ '^[a-f0-9]{64}$' OR jsonb_typeof(inputs_value->'assets') IS DISTINCT FROM 'array' THEN PERFORM dg_native_reception_error('VALIDATION_FAILED');END IF;
 profile_value:=CASE WHEN inputs_value->'profile'='null'::jsonb THEN NULL ELSE(inputs_value->'profile')::text END;scene_value:=CASE WHEN inputs_value->'scene'='null'::jsonb THEN NULL ELSE(inputs_value->'scene')::text END;
 INSERT INTO reception_sessions(id,tenant_id,workspace_id,terminal_id,track_hash,source,environment,app_env,status,version,reply_epoch,focus_version,access_version,created_at,activity_at,expires_at,profile_snapshot,scene_app_snapshot,service_scene) VALUES(id_value,r.tenant_id,r.workspace_id,terminal_value,track_hash_value,'manual','mock',r.app_env,'active',1,0,0,1,created,created,dg_native_people_iso(created::timestamptz+interval '900 seconds'),profile_value,scene_value,'restaurant');
 INSERT INTO _dg_native_reception_origins VALUES(id_value,terminal_value,r.tenant_id,r.workspace_id,actor_value,profile_value,scene_value,(inputs_value->'assets')::text,dg_native_office_hash(jsonb_build_object('profile',profile_value::jsonb,'scene',scene_value::jsonb,'assets',inputs_value->'assets')),dg_native_people_iso(created::timestamptz+interval '24 hours'),NULL,created);
 INSERT INTO _dg_native_dining_session_origins VALUES(id_value,terminal_value,r.id,actor_value,(SELECT epoch FROM _dg_native_restaurant_member_epochs WHERE user_id=actor_value),grant_value,(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1),created,pg_current_xact_id()::text);
 IF NOT dg_native_reception_source_valid(id_value) THEN PERFORM dg_native_reception_error('SOURCE_UNAVAILABLE');END IF;
 PERFORM dg_native_reception_add_message(id_value,'assistant',CASE WHEN scene_value IS NULL THEN '【模拟迎宾】您好，欢迎光临。请查看本页当前可用的就餐服务，逐项核对后再确认；需要帮助时可随时请求店员。' ELSE '【模拟迎宾】'||(scene_value::jsonb->>'welcomeText') END,'ready',0,0);
 UPDATE reception_terminals SET version=version+1 WHERE id=terminal_value;
 INSERT INTO outbox_events VALUES(gen_random_uuid()::text,r.tenant_id,r.workspace_id,id_value,'session.started','mock','{}',created,NULL);RETURN id_value;
END;$dg$;

