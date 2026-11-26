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
