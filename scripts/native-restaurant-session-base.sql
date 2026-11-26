-- Private native mock runtime only. Store duties never become organization roles.
CREATE TABLE _dg_native_dining_terminal_origins(
 terminal_id text PRIMARY KEY REFERENCES reception_terminals(id),restaurant_id text NOT NULL REFERENCES restaurants(id),
 actor_id text NOT NULL,runtime_id text NOT NULL,created_at text NOT NULL,transaction_id text NOT NULL
);
CREATE TABLE _dg_native_dining_session_origins(
 session_id text PRIMARY KEY REFERENCES reception_sessions(id),terminal_id text NOT NULL REFERENCES reception_terminals(id),
 restaurant_id text NOT NULL REFERENCES restaurants(id),actor_id text NOT NULL,actor_epoch bigint NOT NULL,grant_version bigint NOT NULL,
 runtime_id text NOT NULL,created_at text NOT NULL,transaction_id text NOT NULL
);
CREATE TABLE _dg_native_dining_operations(
 id text PRIMARY KEY,restaurant_id text NOT NULL REFERENCES restaurants(id),terminal_id text NOT NULL REFERENCES reception_terminals(id),
 session_id text REFERENCES reception_sessions(id),access_id text REFERENCES _dg_native_reception_access(id),kind text NOT NULL CHECK(kind IN('terminal_create','open','next','access')),
 actor_id text NOT NULL,actor_epoch bigint NOT NULL,grant_version bigint NOT NULL,created_at text NOT NULL,transaction_id text NOT NULL
);
CREATE TRIGGER native_dining_terminal_origin_immutable BEFORE UPDATE OR DELETE ON _dg_native_dining_terminal_origins FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_dining_session_origin_immutable BEFORE UPDATE OR DELETE ON _dg_native_dining_session_origins FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_dining_operation_immutable BEFORE UPDATE OR DELETE ON _dg_native_dining_operations FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_dining_terminal_relation_immutable BEFORE UPDATE OR DELETE ON restaurant_terminals FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
ALTER TABLE reception_terminals DROP CONSTRAINT native_reception_terminal_shape;
ALTER TABLE reception_terminals ADD CONSTRAINT native_reception_terminal_shape CHECK(environment='mock' AND version>0 AND char_length(name) BETWEEN 1 AND 80);

CREATE FUNCTION dg_native_dining_authority(actor_value text,restaurant_value text,epoch_value bigint,grant_value bigint) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT EXISTS(SELECT 1 FROM restaurants r JOIN _dg_native_restaurant_origins ro ON ro.restaurant_id=r.id JOIN memberships m ON m.user_id=actor_value AND m.tenant_id=r.tenant_id JOIN _dg_native_restaurant_member_epochs e ON e.user_id=m.user_id AND e.epoch=epoch_value
 WHERE r.id=restaurant_value AND ro.runtime_id=(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1) AND r.environment='mock' AND r.app_env=(SELECT app_env FROM _dg_native_runtime_control WHERE id=1) AND m.workspace_ids::jsonb ? r.workspace_id
 AND(grant_value=0 AND m.role='admin' OR grant_value>0 AND m.role<>'admin' AND EXISTS(SELECT 1 FROM restaurant_staff g WHERE g.restaurant_id=r.id AND g.user_id=m.user_id AND g.version=grant_value AND g.enabled=1 AND g.role IN('host','manager') AND(g.expires_at IS NULL OR g.expires_at>dg_utc_now()))))
$dg$;
CREATE FUNCTION dg_native_dining_stamp(actor_value text,restaurant_value text) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE m memberships%ROWTYPE;r restaurants%ROWTYPE;grant_value bigint;
BEGIN
 SELECT * INTO m FROM dg_native_locked_membership(actor_value);SELECT * INTO r FROM restaurants WHERE id=restaurant_value;
 IF r.id IS NULL OR m.tenant_id IS DISTINCT FROM r.tenant_id OR NOT(m.workspace_ids::jsonb ? r.workspace_id) THEN PERFORM dg_native_restaurant_error('NOT_FOUND');END IF;
 IF m.role='admin' THEN RETURN 0;END IF;
 SELECT version INTO grant_value FROM restaurant_staff WHERE restaurant_id=r.id AND user_id=actor_value AND enabled=1 AND role IN('host','manager') AND(expires_at IS NULL OR expires_at>dg_utc_now());
 IF grant_value IS NULL THEN PERFORM dg_native_restaurant_error('NOT_FOUND');END IF;RETURN grant_value;
END;$dg$;
CREATE FUNCTION dg_native_dining_terminal_prepare(target text,manager_value boolean DEFAULT false,write_value boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE parent_value text;meta jsonb;t reception_terminals%ROWTYPE;
BEGIN
 PERFORM dg_native_restaurant_actor();SELECT d.restaurant_id INTO parent_value FROM _dg_native_dining_terminal_origins d JOIN restaurant_terminals rt ON rt.terminal_id=d.terminal_id AND rt.restaurant_id=d.restaurant_id WHERE d.terminal_id=target AND d.runtime_id=(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1);
 IF parent_value IS NULL THEN PERFORM dg_native_restaurant_error('NOT_FOUND');END IF;
 meta:=dg_native_restaurant_prepare('restaurant',parent_value,manager_value,write_value,NULL);
 IF write_value THEN SELECT * INTO t FROM reception_terminals WHERE id=target FOR UPDATE;ELSE SELECT * INTO t FROM reception_terminals WHERE id=target FOR SHARE;END IF;
 IF NOT EXISTS(SELECT 1 FROM _dg_native_reception_terminals g WHERE g.terminal_id=t.id AND g.tenant_id=t.tenant_id AND g.workspace_id=t.workspace_id AND g.invalidated_at IS NULL AND g.app_env=(SELECT app_env FROM _dg_native_runtime_control WHERE id=1)) THEN PERFORM dg_native_restaurant_error('NOT_FOUND');END IF;
 RETURN meta||jsonb_build_object('terminalId',t.id);
END;$dg$;
CREATE FUNCTION dg_native_dining_terminal_view(target text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT jsonb_build_object('id',t.id,'restaurantId',d.restaurant_id,'name',t.name,'currentSessionId',(SELECT s.id FROM reception_sessions s WHERE s.terminal_id=t.id AND s.status IN('active','human'))) FROM reception_terminals t JOIN _dg_native_dining_terminal_origins d ON d.terminal_id=t.id WHERE t.id=target
$dg$;
CREATE FUNCTION dg_native_dining_terminals(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN PERFORM dg_native_restaurant_prepare('restaurant',target,false,false,NULL);RETURN coalesce((SELECT jsonb_agg(dg_native_dining_terminal_view(d.terminal_id) ORDER BY d.terminal_id) FROM _dg_native_dining_terminal_origins d WHERE d.restaurant_id=target AND d.runtime_id=(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1)),'[]'::jsonb);END;$dg$;
CREATE FUNCTION dg_native_dining_operation(restaurant_value text,terminal_value text,session_value text,access_value text,kind_value text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE m memberships%ROWTYPE;id_value text:=gen_random_uuid()::text;stamp_value bigint;
BEGIN
 m:=dg_native_restaurant_actor();stamp_value:=dg_native_restaurant_role(restaurant_value,kind_value='terminal_create');
 INSERT INTO _dg_native_dining_operations VALUES(id_value,restaurant_value,terminal_value,session_value,access_value,kind_value,m.user_id,(SELECT epoch FROM _dg_native_restaurant_member_epochs WHERE user_id=m.user_id),stamp_value,dg_utc_now(),pg_current_xact_id()::text);
 INSERT INTO audit_events VALUES(gen_random_uuid()::text,m.tenant_id,(SELECT workspace_id FROM restaurants WHERE id=restaurant_value),m.user_id,'restaurant.'||kind_value,coalesce(session_value,terminal_value),'native-dining-operation',dg_utc_now(),'confirmed');RETURN id_value;
END;$dg$;
CREATE FUNCTION dg_native_dining_create_terminal(target text,input jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE r restaurants%ROWTYPE;m memberships%ROWTYPE;id_value text:=gen_random_uuid()::text;created text:=dg_utc_now();name_value text;
BEGIN
 PERFORM dg_native_restaurant_prepare('restaurant',target,true,true,NULL);m:=dg_native_restaurant_actor();SELECT * INTO r FROM restaurants WHERE id=target;
 PERFORM dg_native_restaurant_fields(input,ARRAY['name']);name_value:=btrim(dg_native_restaurant_text(input->'name',1,80));
 IF(SELECT count(*) FROM reception_terminals WHERE tenant_id=r.tenant_id AND workspace_id=r.workspace_id)>=100 THEN PERFORM dg_native_reception_error('QUOTA_EXCEEDED');END IF;
 INSERT INTO reception_terminals VALUES(id_value,r.tenant_id,r.workspace_id,r.venue_id,name_value,'mock',1,created);
 INSERT INTO _dg_native_reception_terminals VALUES(id_value,r.tenant_id,r.workspace_id,m.user_id,r.app_env,NULL,created);
 INSERT INTO restaurant_terminals VALUES(id_value,r.id);INSERT INTO _dg_native_dining_terminal_origins VALUES(id_value,r.id,m.user_id,(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1),created,pg_current_xact_id()::text);
 INSERT INTO outbox_events VALUES(gen_random_uuid()::text,r.tenant_id,r.workspace_id,id_value,'restaurant.terminal_created','mock','{}',created,NULL);
 RETURN dg_native_dining_operation(r.id,id_value,NULL,NULL,'terminal_create');
END;$dg$;
CREATE FUNCTION dg_native_dining_spawn(terminal_value text,actor_value text,source_value text,track_hash_value text,inputs_value jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
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
 PERFORM dg_native_reception_add_message(id_value,'assistant',CASE WHEN scene_value IS NULL THEN '【模拟迎宾】您好，欢迎光临。当前可进行文字咨询或请求店员接待；预约、排队、点单和结账尚未启用。' ELSE '【模拟迎宾】'||(scene_value::jsonb->>'welcomeText') END,'ready',0,0);
 UPDATE reception_terminals SET version=version+1 WHERE id=terminal_value;
 INSERT INTO outbox_events VALUES(gen_random_uuid()::text,r.tenant_id,r.workspace_id,id_value,'session.started','mock','{}',created,NULL);RETURN id_value;
END;$dg$;
