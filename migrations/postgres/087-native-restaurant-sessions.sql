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

CREATE OR REPLACE FUNCTION dg_native_dining_source_valid(target text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v_session reception_sessions%ROWTYPE;v_origin _dg_native_reception_origins%ROWTYPE;v_terminal _dg_native_reception_terminals%ROWTYPE;v_profile jsonb;v_scene jsonb;v_asset jsonb;v_app scene_apps%ROWTYPE;
BEGIN
 SELECT * INTO v_session FROM reception_sessions WHERE id=target;SELECT * INTO v_origin FROM _dg_native_reception_origins WHERE session_id=target;SELECT * INTO v_terminal FROM _dg_native_reception_terminals WHERE terminal_id=v_origin.terminal_id;
 IF v_session.id IS NULL OR v_origin.session_id IS NULL OR v_terminal.terminal_id IS NULL OR v_origin.invalidated_at IS NOT NULL OR v_terminal.invalidated_at IS NOT NULL OR v_session.environment<>'mock' OR v_session.app_env IS DISTINCT FROM(SELECT app_env FROM _dg_native_runtime_control WHERE id=1) OR v_origin.inputs_hash<>dg_native_office_hash(jsonb_build_object('profile',v_origin.profile::jsonb,'scene',v_origin.scene::jsonb,'assets',v_origin.assets::jsonb)) THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT 1 FROM _dg_native_dining_session_origins o JOIN _dg_native_dining_terminal_origins t ON t.terminal_id=o.terminal_id AND t.restaurant_id=o.restaurant_id JOIN restaurant_terminals rt ON rt.terminal_id=t.terminal_id AND rt.restaurant_id=t.restaurant_id JOIN restaurants r ON r.id=o.restaurant_id WHERE o.session_id=target AND o.actor_id=v_origin.actor_id AND o.terminal_id=v_session.terminal_id AND o.runtime_id=(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1) AND t.runtime_id=o.runtime_id AND v_session.service_scene='restaurant' AND r.tenant_id=v_origin.tenant_id AND r.workspace_id=v_origin.workspace_id AND r.environment='mock' AND r.app_env=v_session.app_env AND r.scene_app_id IS NOT DISTINCT FROM (v_origin.scene::jsonb->>'id') AND coalesce(r.profile_id,v_origin.scene::jsonb->>'profileId') IS NOT DISTINCT FROM (v_origin.profile::jsonb->>'id') AND dg_native_dining_authority(o.actor_id,o.restaurant_id,o.actor_epoch,o.grant_version)) THEN RETURN false;END IF;
 v_profile:=v_origin.profile::jsonb;v_scene:=v_origin.scene::jsonb;
 IF v_profile IS NOT NULL AND v_profile<>'null'::jsonb THEN
  IF NOT EXISTS(SELECT 1 FROM profiles p JOIN profile_versions h ON h.profile_id=p.id WHERE p.id=v_profile->>'id' AND p.tenant_id=v_origin.tenant_id AND p.workspace_id=v_origin.workspace_id AND h.version=(v_profile->>'version')::bigint AND h.snapshot::jsonb=v_profile AND v_profile->'scenes' ? 'restaurant') THEN RETURN false;END IF;
  IF jsonb_array_length(v_origin.assets::jsonb)<>(CASE WHEN v_profile->>'voiceAssetId' IS NULL THEN 1 ELSE 2 END) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_origin.assets::jsonb) x WHERE x->>'id'=v_profile->>'avatarAssetId') OR v_profile->>'voiceAssetId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_origin.assets::jsonb) x WHERE x->>'id'=v_profile->>'voiceAssetId') THEN RETURN false;END IF;
 ELSE IF jsonb_array_length(v_origin.assets::jsonb)<>0 OR v_scene IS NOT NULL AND v_scene<>'null'::jsonb THEN RETURN false;END IF;END IF;
 FOR v_asset IN SELECT value FROM jsonb_array_elements(v_origin.assets::jsonb) LOOP
  IF NOT EXISTS(SELECT 1 FROM assets a JOIN uploads u ON u.id=a.upload_id AND u.tenant_id=a.tenant_id AND u.workspace_id=a.workspace_id JOIN _dg_native_asset_origins o ON o.asset_id=a.id AND o.upload_id=u.id AND o.sha256=u.sha256 AND o.size=u.size WHERE a.id=v_asset->>'id' AND a.tenant_id=v_origin.tenant_id AND a.workspace_id=v_origin.workspace_id AND o.tenant_id=a.tenant_id AND o.workspace_id=a.workspace_id AND o.environment='mock' AND o.app_env=v_session.app_env AND a.version=(v_asset->>'version')::bigint AND a.archived=0 AND(a.expires_at IS NULL OR a.expires_at>dg_utc_now()) AND u.sha256=v_asset->>'sha256' AND u.size=(v_asset->>'size')::bigint AND u.storage_key=v_asset->>'storageKey') THEN RETURN false;END IF;
 END LOOP;
 IF v_scene IS NOT NULL AND v_scene<>'null'::jsonb THEN
  SELECT * INTO v_app FROM scene_apps WHERE id=v_scene->>'id' AND tenant_id=v_origin.tenant_id AND workspace_id=v_origin.workspace_id AND environment='mock' AND app_env=v_session.app_env;
  IF v_app.id IS NULL OR v_app.enabled<>1 OR v_app.scene<>'restaurant' OR v_app.config::jsonb->>'audience'<>'public' OR(v_app.config::jsonb||jsonb_build_object('id',v_app.id,'workspaceId',v_app.workspace_id,'version',v_app.version,'enabled',v_app.enabled=1,'createdAt',v_app.created_at)) IS DISTINCT FROM v_scene OR v_scene->'profile' IS DISTINCT FROM v_profile THEN RETURN false;END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(v_scene->'collectionIds') selected(id) LEFT JOIN knowledge_collections c ON c.id=selected.id WHERE c.id IS NULL OR c.tenant_id<>v_origin.tenant_id OR c.workspace_id<>v_origin.workspace_id OR c.audience<>'public' OR NOT(c.scenes::jsonb ? 'restaurant') OR c.environment<>'mock' OR c.app_env<>v_session.app_env) THEN RETURN false;END IF;
 END IF;RETURN true;
EXCEPTION WHEN data_exception THEN RETURN false;
END;$dg$;

ALTER FUNCTION dg_native_reception_source_valid(text) RENAME TO dg_native_reception_source_valid_before_dining;
CREATE FUNCTION dg_native_reception_source_valid(target text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN IF EXISTS(SELECT 1 FROM reception_sessions WHERE id=target AND service_scene='restaurant') THEN RETURN dg_native_dining_source_valid(target);END IF;RETURN dg_native_reception_source_valid_before_dining(target);END;$dg$;

CREATE OR REPLACE FUNCTION dg_native_reception_session_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'active' OR NEW.version<>1 OR NEW.reply_epoch<>0 OR NEW.focus_version<>0 OR NEW.access_version<>1 OR (NEW.service_scene NOT IN('reception','restaurant') OR NEW.service_scene='restaurant' AND NOT EXISTS(SELECT 1 FROM restaurant_terminals rt JOIN _dg_native_dining_terminal_origins o ON o.terminal_id=rt.terminal_id AND o.restaurant_id=rt.restaurant_id WHERE rt.terminal_id=NEW.terminal_id)) OR NEW.dining_party_id IS NOT NULL OR NEW.created_at<>NEW.activity_at OR extract(epoch FROM NEW.expires_at::timestamptz)-extract(epoch FROM NEW.created_at::timestamptz)<>900 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native reception starts anonymously with fixed clocks and no completed replies';END IF;
 ELSE
  IF OLD.status IN('ended','expired') OR NEW.version<>OLD.version+1 OR NEW.reply_epoch NOT BETWEEN OLD.reply_epoch AND OLD.reply_epoch+1 OR NEW.focus_version NOT BETWEEN OLD.focus_version AND OLD.focus_version+1 OR NEW.access_version NOT BETWEEN OLD.access_version AND OLD.access_version+1 OR to_jsonb(NEW)-ARRAY['status','version','reply_epoch','focus_version','access_version','activity_at','ended_reason'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['status','version','reply_epoch','focus_version','access_version','activity_at','ended_reason'] OR NEW.activity_at<OLD.activity_at THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Session scope, original expiry and monotonic versions are guarded';END IF;
  IF NEW.status IN('ended','expired') AND(NEW.reply_epoch<>OLD.reply_epoch+1 OR NEW.focus_version<>OLD.focus_version+1 OR NEW.access_version<>OLD.access_version+1 OR NEW.ended_reason IS NULL) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Session closure revokes every old reply, target and access capability';END IF;
 END IF;RETURN NEW;
END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_reception_scope_invalidate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v_guard _dg_native_reception_terminals%ROWTYPE;v_origin _dg_native_reception_origins%ROWTYPE;
BEGIN
 FOR v_guard IN SELECT * FROM _dg_native_reception_terminals WHERE actor_id=OLD.user_id AND invalidated_at IS NULL AND NOT EXISTS(SELECT 1 FROM _dg_native_dining_terminal_origins d WHERE d.terminal_id=_dg_native_reception_terminals.terminal_id) ORDER BY terminal_id LOOP
  IF TG_OP='DELETE' OR NOT EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=v_guard.actor_id AND m.tenant_id=v_guard.tenant_id AND m.role='admin' AND m.workspace_ids::jsonb ? v_guard.workspace_id) THEN
   PERFORM dg_native_reception_workspace(v_guard.tenant_id,v_guard.workspace_id,true);PERFORM id FROM reception_terminals WHERE id=v_guard.terminal_id FOR UPDATE;UPDATE _dg_native_reception_terminals SET invalidated_at=dg_utc_now() WHERE terminal_id=v_guard.terminal_id;UPDATE reception_presence SET present=0,queue_at=NULL,queue_sequence=NULL WHERE terminal_id=v_guard.terminal_id;
   FOR v_origin IN SELECT * FROM _dg_native_reception_origins WHERE terminal_id=v_guard.terminal_id AND invalidated_at IS NULL ORDER BY session_id LOOP PERFORM dg_native_reception_end(v_origin.session_id,'terminal_scope_withdrawn',false,true);END LOOP;
  END IF;
 END LOOP;
 FOR v_origin IN SELECT * FROM _dg_native_reception_origins WHERE actor_id=OLD.user_id AND invalidated_at IS NULL ORDER BY terminal_id,session_id LOOP
  IF EXISTS(SELECT 1 FROM _dg_native_dining_session_origins d WHERE d.session_id=v_origin.session_id) THEN IF NOT dg_native_dining_source_valid(v_origin.session_id) THEN PERFORM dg_native_reception_workspace(v_origin.tenant_id,v_origin.workspace_id,true);PERFORM id FROM reception_terminals WHERE id=v_origin.terminal_id FOR UPDATE;PERFORM dg_native_reception_end(v_origin.session_id,'restaurant_scope_withdrawn',false,true);END IF;ELSIF TG_OP='DELETE' OR NOT EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=v_origin.actor_id AND m.tenant_id=v_origin.tenant_id AND m.role='admin' AND m.workspace_ids::jsonb ? v_origin.workspace_id) THEN PERFORM dg_native_reception_workspace(v_origin.tenant_id,v_origin.workspace_id,true);PERFORM id FROM reception_terminals WHERE id=v_origin.terminal_id FOR UPDATE;PERFORM dg_native_reception_end(v_origin.session_id,'session_scope_withdrawn',false,true);END IF;
 END LOOP;RETURN NULL;
END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_reception_authorize_before_handoff(target text,token_hash_value text,csrf_hash_value text,write_value boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v_meta jsonb;v_session reception_sessions%ROWTYPE;v_access _dg_native_reception_access%ROWTYPE;v_terminal _dg_native_reception_terminals%ROWTYPE;
BEGIN
 v_meta:=dg_native_reception_meta(target,token_hash_value);SELECT * INTO v_terminal FROM _dg_native_reception_terminals WHERE terminal_id=v_meta->>'terminalId';PERFORM user_id FROM dg_native_locked_membership(v_meta->>'actorId');IF NOT EXISTS(SELECT 1 FROM _dg_native_dining_session_origins WHERE session_id=target) THEN PERFORM user_id FROM dg_native_locked_membership(v_terminal.actor_id);END IF;PERFORM dg_native_reception_workspace(v_meta->>'tenantId',v_meta->>'workspaceId',write_value);
 IF write_value THEN PERFORM id FROM reception_terminals WHERE id=v_meta->>'terminalId' FOR UPDATE;SELECT * INTO v_session FROM reception_sessions WHERE id=target FOR UPDATE;
 ELSE PERFORM id FROM reception_terminals WHERE id=v_meta->>'terminalId' FOR SHARE;SELECT * INTO v_session FROM reception_sessions WHERE id=target FOR SHARE;END IF;
 PERFORM dg_native_reception_meta(target,token_hash_value);SELECT * INTO v_access FROM _dg_native_reception_access WHERE session_id=target AND token_hash=token_hash_value AND access_version=v_session.access_version;
 IF write_value AND(csrf_hash_value IS NULL OR v_access.csrf_hash IS DISTINCT FROM csrf_hash_value) THEN PERFORM dg_native_reception_error('FORBIDDEN');END IF;
END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_speaker_prelock(target text,token_hash_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;candidate record;v visits%ROWTYPE;d _dg_native_visit_drafts%ROWTYPE;f speaker_focus_sessions%ROWTYPE;
BEGIN
 PERFORM dg_native_reception_runtime();meta:=dg_native_reception_meta(target,token_hash_value);
 IF token_hash_value IS NULL AND meta->>'serviceScene' IS DISTINCT FROM 'restaurant' THEN PERFORM dg_native_reception_admin(meta->>'workspaceId');END IF;
 SELECT * INTO v FROM visits WHERE session_id=target;d:=dg_native_visit_draft(v.id);SELECT * INTO f FROM speaker_focus_sessions WHERE session_id=target;
 -- Membership locks precede asset/workspace/terminal/session locks.
 FOR candidate IN SELECT DISTINCT user_id FROM(SELECT meta->>'actorId' user_id UNION ALL SELECT actor_id FROM _dg_native_reception_terminals WHERE terminal_id=meta->>'terminalId' AND NOT EXISTS(SELECT 1 FROM _dg_native_dining_session_origins WHERE session_id=target) UNION ALL SELECT d.recipient_id UNION ALL SELECT owner_user_id FROM speaker_references WHERE id=f.reference_id) q WHERE user_id IS NOT NULL ORDER BY user_id LOOP PERFORM user_id FROM dg_native_locked_membership(candidate.user_id);END LOOP;
 RETURN jsonb_build_object('visitId',v.id,'visitVersion',v.version,'recipientId',d.recipient_id,'referenceId',f.reference_id);
END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_speaker_prelock(target text,token_hash_value text,ticket_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;candidate record;v visits%ROWTYPE;d _dg_native_visit_drafts%ROWTYPE;f speaker_focus_sessions%ROWTYPE;new_reference text;original_reference text;locked_ids text[];needed_ids text[];
BEGIN
 PERFORM dg_native_reception_runtime();meta:=dg_native_reception_meta(target,token_hash_value);
 IF token_hash_value IS NULL AND meta->>'serviceScene' IS DISTINCT FROM 'restaurant' THEN PERFORM dg_native_reception_admin(meta->>'workspaceId');END IF;
 SELECT * INTO v FROM visits WHERE session_id=target;d:=dg_native_visit_draft(v.id);SELECT * INTO f FROM speaker_focus_sessions WHERE session_id=target;original_reference:=f.reference_id;
 SELECT o.reference_id INTO new_reference FROM _dg_native_speaker_ticket_origins o JOIN speaker_use_tickets t ON t.id=o.ticket_id WHERE o.ticket_id=ticket_value AND o.session_id=target AND o.tenant_id=meta->>'tenantId' AND o.workspace_id=meta->>'workspaceId';
 SELECT array_agg(user_id ORDER BY user_id) INTO locked_ids FROM(SELECT meta->>'actorId' user_id UNION SELECT actor_id FROM _dg_native_reception_terminals WHERE terminal_id=meta->>'terminalId' AND NOT EXISTS(SELECT 1 FROM _dg_native_dining_session_origins WHERE session_id=target) UNION SELECT d.recipient_id UNION SELECT owner_user_id FROM speaker_references WHERE id IN(f.reference_id,new_reference)) q WHERE user_id IS NOT NULL;
 FOR candidate IN SELECT unnest(locked_ids) user_id LOOP PERFORM user_id FROM dg_native_locked_membership(candidate.user_id);END LOOP;
 FOR candidate IN SELECT id FROM speaker_references WHERE id IN(f.reference_id,new_reference) AND scope='enrolled' ORDER BY id LOOP PERFORM pg_advisory_xact_lock(hashtextextended('native-speaker-reference:'||candidate.id,0));END LOOP;
 -- Recheck after waiting: the current reference or recipient may have changed.
 SELECT * INTO v FROM visits WHERE session_id=target;d:=dg_native_visit_draft(v.id);SELECT * INTO f FROM speaker_focus_sessions WHERE session_id=target;
 SELECT array_agg(user_id ORDER BY user_id) INTO needed_ids FROM(SELECT d.recipient_id user_id UNION SELECT owner_user_id FROM speaker_references WHERE id=f.reference_id) q WHERE user_id IS NOT NULL;
 IF f.reference_id IS NOT NULL AND f.reference_id IS DISTINCT FROM original_reference AND f.reference_id IS DISTINCT FROM new_reference OR NOT coalesce(needed_ids,ARRAY[]::text[]) <@ coalesce(locked_ids,ARRAY[]::text[]) THEN PERFORM dg_native_speaker_error('VERSION_CONFLICT');END IF;
 RETURN jsonb_build_object('visitId',v.id,'visitVersion',v.version,'recipientId',d.recipient_id,'referenceId',f.reference_id);
END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_speaker_handoff_prelock(target text,token_hash_value text,csrf_hash_value text,intent_value text,intent_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;candidate record;v visits%ROWTYPE;d _dg_native_visit_drafts%ROWTYPE;f speaker_focus_sessions%ROWTYPE;
BEGIN
 meta:=dg_native_speaker_handoff_scope(target,token_hash_value,csrf_hash_value,intent_value,intent_hash);SELECT * INTO v FROM visits WHERE session_id=target;d:=dg_native_visit_draft(v.id);SELECT * INTO f FROM speaker_focus_sessions WHERE session_id=target;
 FOR candidate IN SELECT user_id FROM(SELECT meta->>'actorId' user_id UNION SELECT actor_id FROM _dg_native_reception_terminals WHERE terminal_id=meta->>'terminalId' AND NOT EXISTS(SELECT 1 FROM _dg_native_dining_session_origins WHERE session_id=target) UNION SELECT d.recipient_id UNION SELECT owner_user_id FROM speaker_references WHERE id=f.reference_id) q WHERE user_id IS NOT NULL ORDER BY user_id LOOP PERFORM user_id FROM dg_native_locked_membership(candidate.user_id);END LOOP;
 IF f.mode='enrolled' AND f.reference_id IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('native-speaker-reference:'||f.reference_id,0));END IF;
 -- Leave parent locks to the subsequent operation, after Node validates and
 -- locks the fixed assets/core workspace. Store only the membership hint.
 meta:=dg_native_speaker_handoff_scope(target,token_hash_value,csrf_hash_value,intent_value,intent_hash);IF(SELECT state FROM _dg_native_speaker_handoffs WHERE id=intent_value)='prepared' THEN PERFORM dg_native_speaker_check_hint(target,jsonb_build_object('visitId',v.id,'visitVersion',v.version,'recipientId',d.recipient_id,'referenceId',f.reference_id));END IF;PERFORM set_config('digitalguide.native_handoff_hint',jsonb_build_object('sessionId',target,'hint',jsonb_build_object('visitId',v.id,'visitVersion',v.version,'recipientId',d.recipient_id,'referenceId',f.reference_id))::text,true);RETURN meta;
END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_speaker_reference_member_ids(target text,session_value text) RETURNS TABLE(user_id text) LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 WITH sessions AS(SELECT session_value id WHERE session_value IS NOT NULL UNION SELECT f.session_id FROM speaker_focus_sessions f WHERE f.reference_id=target AND f.state NOT IN('idle','ended','handoff_pending'))
 SELECT owner_user_id FROM speaker_references WHERE id=target AND owner_user_id IS NOT NULL
 UNION SELECT o.actor_id FROM _dg_native_reception_origins o JOIN sessions s ON s.id=o.session_id
 UNION SELECT t.actor_id FROM _dg_native_reception_terminals t JOIN _dg_native_reception_origins o ON o.terminal_id=t.terminal_id JOIN sessions s ON s.id=o.session_id WHERE NOT EXISTS(SELECT 1 FROM _dg_native_dining_session_origins d WHERE d.session_id=s.id)
 UNION SELECT d.recipient_id FROM visits v JOIN sessions s ON s.id=v.session_id JOIN LATERAL(SELECT recipient_id FROM _dg_native_visit_drafts WHERE visit_id=v.id ORDER BY version DESC LIMIT 1) d ON true WHERE d.recipient_id IS NOT NULL
$dg$;


CREATE OR REPLACE FUNCTION dg_native_speaker_handoff_scope(target text,token_hash_value text,csrf_hash_value text,intent_value text,intent_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE h _dg_native_speaker_handoffs%ROWTYPE;o _dg_native_speaker_handoff_origins%ROWTYPE;a _dg_native_reception_access%ROWTYPE;s reception_sessions%ROWTYPE;n reception_sessions%ROWTYPE;origin _dg_native_reception_origins%ROWTYPE;snapshot_value jsonb;
BEGIN
 PERFORM dg_native_reception_runtime();
 -- One statement snapshot prevents mixing a prepared intent with the old
 -- session's concurrently committed closure (or a committed intent with an
 -- independently claimed capability).
 SELECT jsonb_build_object('h',to_jsonb(h0),'o',to_jsonb(o0),'a',to_jsonb(a0),'s',to_jsonb(s0),'origin',to_jsonb(r0),'n',to_jsonb(n0)) INTO snapshot_value FROM _dg_native_speaker_handoffs h0 JOIN _dg_native_speaker_handoff_origins o0 ON o0.id=h0.id JOIN _dg_native_reception_access a0 ON a0.id=o0.access_id JOIN reception_sessions s0 ON s0.id=h0.session_id JOIN _dg_native_reception_origins r0 ON r0.session_id=s0.id LEFT JOIN reception_sessions n0 ON n0.id=h0.next_session_id WHERE h0.id=intent_value AND h0.session_id=target;
 h:=jsonb_populate_record(NULL::_dg_native_speaker_handoffs,coalesce(snapshot_value->'h','{}'));o:=jsonb_populate_record(NULL::_dg_native_speaker_handoff_origins,coalesce(snapshot_value->'o','{}'));a:=jsonb_populate_record(NULL::_dg_native_reception_access,coalesce(snapshot_value->'a','{}'));s:=jsonb_populate_record(NULL::reception_sessions,coalesce(snapshot_value->'s','{}'));origin:=jsonb_populate_record(NULL::_dg_native_reception_origins,coalesce(snapshot_value->'origin','{}'));n:=jsonb_populate_record(NULL::reception_sessions,coalesce(nullif(snapshot_value->'n','null'::jsonb),'{}'));
 IF h.id IS NULL OR o.id IS NULL OR h.session_id<>target OR o.session_id<>target OR h.state NOT IN('prepared','committed') OR h.token_hash='' OR h.token_hash IS DISTINCT FROM intent_hash OR o.token_hash IS DISTINCT FROM intent_hash OR o.expires_at<=dg_utc_now() OR a.id IS NULL OR a.session_id<>target OR a.token_hash IS DISTINCT FROM token_hash_value OR csrf_hash_value IS NOT NULL AND a.csrf_hash IS DISTINCT FROM csrf_hash_value OR a.access_version<>o.access_version OR a.expires_at<=dg_utc_now() THEN PERFORM dg_native_speaker_error('HANDOFF_UNAVAILABLE');END IF;
 IF NOT dg_native_reception_source_valid(target) THEN PERFORM dg_native_speaker_error('SOURCE_UNAVAILABLE');END IF;
 IF h.state='prepared' THEN
  IF s.status<>'active' OR s.version<>o.session_version OR s.focus_version<>o.focus_version OR s.access_version<>o.access_version OR s.expires_at<=dg_utc_now() OR s.activity_at<=dg_native_people_iso(clock_timestamp()-interval '120 seconds') THEN PERFORM dg_native_speaker_error('VERSION_CONFLICT');END IF;
 ELSE
  -- n belongs to the same authenticated statement snapshot as h.
  IF s.status<>'ended' OR s.ended_reason<>'speaker_participant_handoff' OR s.focus_version<>o.focus_version+1 OR s.access_version<>o.access_version+1 OR n.id IS NULL OR n.status<>'active' OR n.focus_version<>0 OR n.access_version<>1 OR n.expires_at<=dg_utc_now() OR n.activity_at<=dg_native_people_iso(clock_timestamp()-interval '120 seconds') OR NOT dg_native_reception_source_valid(n.id) THEN PERFORM dg_native_speaker_error('HANDOFF_UNAVAILABLE');END IF;
 END IF;
 RETURN jsonb_build_object('id',s.id,'tenantId',s.tenant_id,'workspaceId',s.workspace_id,'terminalId',s.terminal_id,'actorId',origin.actor_id,'status',s.status,'version',s.version,'focusVersion',s.focus_version,'replyEpoch',s.reply_epoch,'accessVersion',s.access_version,'expiresAt',s.expires_at,'profile',origin.profile::jsonb,'scene',origin.scene::jsonb,'assets',origin.assets::jsonb,'serviceScene',s.service_scene,'restaurantId',(SELECT restaurant_id FROM _dg_native_dining_session_origins WHERE session_id=s.id));
END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_guest_memory_session(target text,token_hash_value text,csrf_hash_value text,focus_value bigint,write_value boolean DEFAULT false) RETURNS reception_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s reception_sessions%ROWTYPE;
BEGIN
 PERFORM dg_native_reception_authorize(target,token_hash_value,csrf_hash_value,write_value);SELECT * INTO s FROM reception_sessions WHERE id=target;
 IF s.service_scene='restaurant' THEN PERFORM dg_native_reception_error('FORBIDDEN');END IF;
 IF focus_value IS NOT NULL AND focus_value<>s.focus_version OR write_value AND s.status<>'active' THEN PERFORM dg_native_people_error('VERSION_CONFLICT');END IF;RETURN s;
END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_visit_session(target text,token_hash_value text,csrf_hash_value text,focus_value bigint,write_value boolean DEFAULT false) RETURNS reception_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s reception_sessions%ROWTYPE;
BEGIN
 PERFORM dg_native_reception_authorize(target,token_hash_value,csrf_hash_value,write_value);SELECT * INTO STRICT s FROM reception_sessions WHERE id=target;
 IF s.service_scene='restaurant' THEN PERFORM dg_native_reception_error('FORBIDDEN');END IF;
 IF focus_value IS NOT NULL AND focus_value<>s.focus_version THEN PERFORM dg_native_visit_error('VERSION_CONFLICT');END IF;
 IF write_value AND s.status<>'active' THEN PERFORM dg_native_visit_error('STATE_CONFLICT');END IF;RETURN s;
END;$dg$;


ALTER FUNCTION dg_native_reception_spawn(text,text,text,text,jsonb) RENAME TO dg_native_reception_spawn_before_dining;
CREATE FUNCTION dg_native_reception_spawn(terminal_value text,actor_value text,source_value text,track_hash_value text,inputs_value jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN IF EXISTS(SELECT 1 FROM _dg_native_dining_terminal_origins WHERE terminal_id=terminal_value) THEN RETURN dg_native_dining_spawn(terminal_value,actor_value,source_value,track_hash_value,inputs_value);END IF;RETURN dg_native_reception_spawn_before_dining(terminal_value,actor_value,source_value,track_hash_value,inputs_value);END;$dg$;
ALTER FUNCTION dg_native_reception_create_session(text,jsonb) RENAME TO dg_native_reception_create_session_before_dining;
CREATE FUNCTION dg_native_reception_create_session(terminal_value text,inputs_value jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN IF EXISTS(SELECT 1 FROM restaurant_terminals WHERE terminal_id=terminal_value) THEN PERFORM dg_native_reception_error('NOT_FOUND');END IF;RETURN dg_native_reception_create_session_before_dining(terminal_value,inputs_value);END;$dg$;
ALTER FUNCTION dg_native_reception_terminal_scope(text) RENAME TO dg_native_reception_terminal_scope_before_dining;
CREATE FUNCTION dg_native_reception_terminal_scope(target text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN IF EXISTS(SELECT 1 FROM _dg_native_dining_terminal_origins WHERE terminal_id=target) THEN RETURN dg_native_dining_terminal_prepare(target,false,false)->>'workspaceId';END IF;RETURN dg_native_reception_terminal_scope_before_dining(target);END;$dg$;

CREATE FUNCTION dg_native_dining_meta(target text,token_hash_value text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s reception_sessions%ROWTYPE;o _dg_native_reception_origins%ROWTYPE;d _dg_native_dining_session_origins%ROWTYPE;a _dg_native_reception_access%ROWTYPE;
BEGIN
 PERFORM dg_native_reception_runtime();SELECT * INTO s FROM reception_sessions WHERE id=target;SELECT * INTO o FROM _dg_native_reception_origins WHERE session_id=target;SELECT * INTO d FROM _dg_native_dining_session_origins WHERE session_id=target;
 IF s.id IS NULL OR d.session_id IS NULL OR o.session_id IS NULL THEN PERFORM dg_native_reception_error('NOT_FOUND');END IF;
 IF token_hash_value IS NULL THEN PERFORM dg_native_dining_terminal_prepare(s.terminal_id,false,false);
 ELSE
  SELECT * INTO a FROM _dg_native_reception_access WHERE session_id=target AND token_hash=token_hash_value AND access_version=s.access_version AND expires_at>dg_utc_now();
  IF a.id IS NULL OR s.status NOT IN('active','human') OR s.expires_at<=dg_utc_now() OR s.activity_at<=dg_native_people_iso(clock_timestamp()-interval '120 seconds') OR NOT dg_native_dining_source_valid(target) THEN PERFORM dg_native_reception_error('AUTH_REQUIRED');END IF;
 END IF;
 IF s.status IN('active','human') THEN PERFORM user_id FROM dg_native_locked_membership(d.actor_id);IF token_hash_value IS NOT NULL AND NOT dg_native_dining_source_valid(target) THEN PERFORM dg_native_reception_error('AUTH_REQUIRED');END IF;END IF;
 RETURN jsonb_build_object('id',s.id,'tenantId',s.tenant_id,'workspaceId',s.workspace_id,'terminalId',s.terminal_id,'actorId',d.actor_id,'status',s.status,'version',s.version,'focusVersion',s.focus_version,'replyEpoch',s.reply_epoch,'accessVersion',s.access_version,'expiresAt',s.expires_at,'profile',o.profile::jsonb,'scene',o.scene::jsonb,'assets',o.assets::jsonb,'serviceScene','restaurant','restaurantId',d.restaurant_id);
END;$dg$;
ALTER FUNCTION dg_native_reception_meta(text,text) RENAME TO dg_native_reception_meta_before_dining;
CREATE FUNCTION dg_native_reception_meta(target text,token_hash_value text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN IF EXISTS(SELECT 1 FROM reception_sessions WHERE id=target AND service_scene='restaurant') THEN RETURN dg_native_dining_meta(target,token_hash_value);END IF;RETURN dg_native_reception_meta_before_dining(target,token_hash_value);END;$dg$;
CREATE FUNCTION dg_native_dining_meta_authorize(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;
BEGIN meta:=dg_native_dining_meta(target,NULL);IF meta->>'status' IN('active','human') AND NOT dg_native_dining_source_valid(target) THEN PERFORM dg_native_reception_error('SOURCE_UNAVAILABLE');END IF;RETURN meta;END;$dg$;

ALTER FUNCTION dg_native_reception_issue(text,text,text,text) RENAME TO dg_native_reception_issue_before_dining;
CREATE FUNCTION dg_native_reception_issue(target text,grant_value text,token_hash_value text,csrf_hash_value text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;s reception_sessions%ROWTYPE;m memberships%ROWTYPE;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_dining_session_origins WHERE session_id=target) THEN RETURN dg_native_reception_issue_before_dining(target,grant_value,token_hash_value,csrf_hash_value);END IF;
 meta:=dg_native_dining_meta(target,NULL);PERFORM dg_native_dining_terminal_prepare(meta->>'terminalId',false,true);m:=dg_native_restaurant_actor();SELECT * INTO s FROM reception_sessions WHERE id=target FOR UPDATE;
 IF s.status NOT IN('active','human') OR s.expires_at<=dg_utc_now() OR s.activity_at<=dg_native_people_iso(clock_timestamp()-interval '120 seconds') THEN PERFORM dg_native_reception_error('SESSION_ENDED');END IF;IF NOT dg_native_dining_source_valid(target) THEN PERFORM dg_native_reception_error('SOURCE_UNAVAILABLE');END IF;
 IF grant_value IS NULL OR token_hash_value IS NULL OR token_hash_value !~ '^[a-f0-9]{64}$' OR csrf_hash_value IS NULL OR csrf_hash_value !~ '^[a-f0-9]{64}$' THEN PERFORM dg_native_reception_error('VALIDATION_FAILED');END IF;
 UPDATE reception_sessions SET access_version=access_version+1,version=version+1 WHERE id=target RETURNING * INTO s;
 INSERT INTO _dg_native_reception_access VALUES(grant_value,target,m.user_id,s.access_version,token_hash_value,csrf_hash_value,s.expires_at,dg_utc_now());RETURN grant_value;
END;$dg$;
ALTER FUNCTION dg_native_reception_access(text) RENAME TO dg_native_reception_access_before_dining;
CREATE FUNCTION dg_native_reception_access(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE a _dg_native_reception_access%ROWTYPE;s reception_sessions%ROWTYPE;m memberships%ROWTYPE;
BEGIN
 SELECT * INTO a FROM _dg_native_reception_access WHERE id=target;
 IF NOT EXISTS(SELECT 1 FROM _dg_native_dining_session_origins WHERE session_id=a.session_id) THEN RETURN dg_native_reception_access_before_dining(target);END IF;
 m:=dg_native_restaurant_actor();IF a.actor_id IS DISTINCT FROM m.user_id THEN PERFORM dg_native_reception_error('NOT_FOUND');END IF;PERFORM dg_native_dining_meta_authorize(a.session_id);SELECT * INTO s FROM reception_sessions WHERE id=a.session_id;
 IF s.status NOT IN('active','human') OR s.expires_at<=dg_utc_now() OR s.activity_at<=dg_native_people_iso(clock_timestamp()-interval '120 seconds') THEN PERFORM dg_native_reception_error('SESSION_ENDED');END IF;IF a.access_version<>s.access_version THEN PERFORM dg_native_reception_error('STATE_CONFLICT');END IF;
 RETURN jsonb_build_object('sessionId',s.id,'expiresAt',a.expires_at);
END;$dg$;
CREATE FUNCTION dg_native_dining_open(target text,input jsonb,inputs_value jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;m memberships%ROWTYPE;s reception_sessions%ROWTYPE;next_value text;
BEGIN
 meta:=dg_native_dining_terminal_prepare(target,false,true);m:=dg_native_restaurant_actor();PERFORM dg_native_restaurant_fields(input,ARRAY['action','confirmed']);IF input->>'action' NOT IN('open','next') OR input->>'action' IS NULL OR input->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN PERFORM dg_native_restaurant_error('VALIDATION_FAILED');END IF;
 SELECT * INTO s FROM reception_sessions WHERE terminal_id=target AND status IN('active','human') FOR UPDATE;
 IF s.id IS NOT NULL AND input->>'action'='open' THEN IF NOT dg_native_dining_source_valid(s.id) THEN PERFORM dg_native_reception_error('SOURCE_UNAVAILABLE');END IF;next_value:=s.id;
 ELSE
  IF s.id IS NOT NULL THEN PERFORM dg_native_reception_end(s.id,'restaurant_next_guest');END IF;
  next_value:=dg_native_dining_spawn(target,m.user_id,'manual',encode(sha256(convert_to(gen_random_uuid()::text,'UTF8')),'hex'),inputs_value);
 END IF;
 RETURN dg_native_dining_operation(meta->>'restaurantId',target,next_value,NULL,input->>'action');
END;$dg$;
CREATE FUNCTION dg_native_dining_issue(target text,grant_value text,token_hash_value text,csrf_hash_value text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;s reception_sessions%ROWTYPE;
BEGIN meta:=dg_native_dining_terminal_prepare(target,false,true);SELECT * INTO s FROM reception_sessions WHERE terminal_id=target AND status IN('active','human');IF s.id IS NULL THEN PERFORM dg_native_reception_error('SESSION_ENDED');END IF;PERFORM dg_native_reception_issue(s.id,grant_value,token_hash_value,csrf_hash_value);RETURN dg_native_dining_operation(meta->>'restaurantId',target,s.id,grant_value,'access');END;$dg$;
CREATE FUNCTION dg_native_dining_result(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE o _dg_native_dining_operations%ROWTYPE;m memberships%ROWTYPE;s reception_sessions%ROWTYPE;
BEGIN
 m:=dg_native_restaurant_actor();SELECT * INTO o FROM _dg_native_dining_operations WHERE id=target AND actor_id=m.user_id;IF o.id IS NULL THEN PERFORM dg_native_restaurant_error('NOT_FOUND');END IF;
 PERFORM dg_native_dining_terminal_prepare(o.terminal_id,o.kind='terminal_create',false);
 IF NOT dg_native_dining_authority(o.actor_id,o.restaurant_id,o.actor_epoch,o.grant_version) THEN PERFORM dg_native_restaurant_error('AUTHORIZATION_CHANGED');END IF;
 IF o.kind='terminal_create' THEN RETURN dg_native_dining_terminal_view(o.terminal_id);END IF;
 SELECT * INTO s FROM reception_sessions WHERE id=o.session_id;IF s.status NOT IN('active','human') OR s.expires_at<=dg_utc_now() OR s.activity_at<=dg_native_people_iso(clock_timestamp()-interval '120 seconds') THEN PERFORM dg_native_reception_error('SESSION_ENDED');END IF;PERFORM dg_native_dining_meta_authorize(s.id);
 IF o.kind='access' THEN PERFORM dg_native_reception_access(o.access_id);RETURN jsonb_build_object('sessionId',s.id,'accessId',o.access_id);END IF;
 RETURN dg_native_reception_project(s.id);
END;$dg$;

CREATE FUNCTION dg_native_dining_invalidate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE candidate record;
BEGIN
 FOR candidate IN SELECT o.session_id,o.terminal_id,r.tenant_id,r.workspace_id FROM _dg_native_dining_session_origins o JOIN restaurants r ON r.id=o.restaurant_id JOIN reception_sessions s ON s.id=o.session_id WHERE s.status IN('active','human') AND(CASE WHEN TG_TABLE_NAME='memberships' THEN o.actor_id=to_jsonb(OLD)->>'user_id' WHEN TG_TABLE_NAME='restaurant_staff' THEN o.restaurant_id=to_jsonb(NEW)->>'restaurant_id' AND o.actor_id=to_jsonb(NEW)->>'user_id' ELSE o.restaurant_id=to_jsonb(NEW)->>'id' END) ORDER BY o.terminal_id,o.session_id LOOP
  IF NOT dg_native_dining_source_valid(candidate.session_id) THEN PERFORM dg_native_reception_workspace(candidate.tenant_id,candidate.workspace_id,true);PERFORM id FROM reception_terminals WHERE id=candidate.terminal_id FOR UPDATE;PERFORM dg_native_reception_end(candidate.session_id,'restaurant_authority_or_source_withdrawn',false,true);END IF;
 END LOOP;RETURN NULL;
END;$dg$;
CREATE TRIGGER zz_native_dining_member_invalidate AFTER UPDATE OR DELETE ON memberships FOR EACH ROW EXECUTE FUNCTION dg_native_dining_invalidate();
CREATE TRIGGER zz_native_dining_staff_invalidate AFTER UPDATE ON restaurant_staff FOR EACH ROW EXECUTE FUNCTION dg_native_dining_invalidate();
CREATE TRIGGER zz_native_dining_config_invalidate AFTER UPDATE ON restaurants FOR EACH ROW EXECUTE FUNCTION dg_native_dining_invalidate();
CREATE FUNCTION dg_native_dining_final() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE key_value text;t reception_terminals%ROWTYPE;d _dg_native_dining_terminal_origins%ROWTYPE;r restaurants%ROWTYPE;o _dg_native_dining_session_origins%ROWTYPE;s reception_sessions%ROWTYPE;
BEGIN
 key_value:=CASE WHEN TG_TABLE_NAME='reception_terminals' THEN to_jsonb(NEW)->>'id' ELSE to_jsonb(NEW)->>'terminal_id' END;
 SELECT * INTO t FROM reception_terminals WHERE id=key_value;SELECT * INTO d FROM _dg_native_dining_terminal_origins WHERE terminal_id=key_value;
 IF d.terminal_id IS NULL THEN IF EXISTS(SELECT 1 FROM restaurant_terminals WHERE terminal_id=key_value) OR char_length(t.name)>60 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Restaurant terminals require a committed scoped origin';END IF;RETURN NULL;END IF;
 SELECT * INTO r FROM restaurants WHERE id=d.restaurant_id;
 IF t.id IS NULL OR r.id IS NULL OR t.tenant_id<>r.tenant_id OR t.workspace_id<>r.workspace_id OR t.venue_id<>r.venue_id OR d.runtime_id IS DISTINCT FROM(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1) OR NOT EXISTS(SELECT 1 FROM restaurant_terminals rt WHERE rt.terminal_id=t.id AND rt.restaurant_id=r.id) OR NOT EXISTS(SELECT 1 FROM _dg_native_reception_terminals rt WHERE rt.terminal_id=t.id AND rt.actor_id=d.actor_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Restaurant terminal relation and immutable store origin must commit together';END IF;
 IF TG_TABLE_NAME='_dg_native_dining_session_origins' THEN
  SELECT * INTO o FROM _dg_native_dining_session_origins WHERE session_id=to_jsonb(NEW)->>'session_id';SELECT * INTO s FROM reception_sessions WHERE id=o.session_id;
  IF s.id IS NULL OR s.service_scene<>'restaurant' OR s.terminal_id<>d.terminal_id OR o.restaurant_id<>d.restaurant_id OR o.runtime_id<>d.runtime_id OR o.created_at<>s.created_at OR NOT EXISTS(SELECT 1 FROM _dg_native_reception_origins ro WHERE ro.session_id=s.id AND ro.actor_id=o.actor_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Restaurant session keeps its actual opener, scoped store and original clocks';END IF;
 END IF;RETURN NULL;
END;$dg$;
CREATE CONSTRAINT TRIGGER native_dining_terminal_final AFTER INSERT OR UPDATE ON reception_terminals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_dining_final();
CREATE CONSTRAINT TRIGGER native_dining_terminal_origin_final AFTER INSERT ON _dg_native_dining_terminal_origins DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_dining_final();
CREATE CONSTRAINT TRIGGER native_dining_terminal_relation_final AFTER INSERT ON restaurant_terminals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_dining_final();
CREATE CONSTRAINT TRIGGER native_dining_session_origin_final AFTER INSERT ON _dg_native_dining_session_origins DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_dining_final();

DO $acl$
DECLARE r record;
BEGIN
 FOR r IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND (p.proname LIKE 'dg_native_dining_%' OR p.proname LIKE '%_before_dining' OR p.proname=ANY(ARRAY['dg_native_reception_source_valid','dg_native_reception_meta','dg_native_reception_terminal_scope','dg_native_reception_spawn','dg_native_reception_create_session','dg_native_reception_issue','dg_native_reception_access'])) LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',r.signature);END LOOP;
END;$acl$;
