-- Append-only correction: shared reception authorization is used by speaker control.
-- Restrict memory business entry points, not that shared capability primitive.
CREATE OR REPLACE FUNCTION dg_native_guest_memory_session(target text,token_hash_value text,csrf_hash_value text,focus_value bigint,write_value boolean DEFAULT false) RETURNS reception_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s reception_sessions%ROWTYPE;
BEGIN
 PERFORM dg_native_reception_authorize(target,token_hash_value,csrf_hash_value,write_value);SELECT * INTO s FROM reception_sessions WHERE id=target;
 IF focus_value IS NOT NULL AND focus_value<>s.focus_version OR write_value AND s.status<>'active' THEN PERFORM dg_native_people_error('VERSION_CONFLICT');END IF;RETURN s;
END;$dg$;


ALTER FUNCTION dg_native_guest_memory_context(text,text) RENAME TO dg_native_guest_memory_context_before_dining_scope;
CREATE FUNCTION dg_native_guest_memory_context(target text,token_hash_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN IF EXISTS(SELECT 1 FROM reception_sessions WHERE id=target AND service_scene='restaurant') THEN PERFORM dg_native_reception_error('FORBIDDEN');END IF;RETURN dg_native_guest_memory_context_before_dining_scope(target,token_hash_value);END;$dg$;

ALTER FUNCTION dg_native_guest_memory_view(text,text) RENAME TO dg_native_guest_memory_view_before_dining_scope;
CREATE FUNCTION dg_native_guest_memory_view(target text,token_hash_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN IF EXISTS(SELECT 1 FROM reception_sessions WHERE id=target AND service_scene='restaurant') THEN PERFORM dg_native_reception_error('FORBIDDEN');END IF;RETURN dg_native_guest_memory_view_before_dining_scope(target,token_hash_value);END;$dg$;

ALTER FUNCTION dg_native_guest_memory_search(text,text,text) RENAME TO dg_native_guest_memory_search_before_dining_scope;
CREATE FUNCTION dg_native_guest_memory_search(target text,token_hash_value text,query_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN IF EXISTS(SELECT 1 FROM reception_sessions WHERE id=target AND service_scene='restaurant') THEN PERFORM dg_native_reception_error('FORBIDDEN');END IF;RETURN dg_native_guest_memory_search_before_dining_scope(target,token_hash_value,query_value);END;$dg$;

ALTER FUNCTION dg_native_guest_memory_export(text,text) RENAME TO dg_native_guest_memory_export_before_dining_scope;
CREATE FUNCTION dg_native_guest_memory_export(target text,token_hash_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN IF EXISTS(SELECT 1 FROM reception_sessions WHERE id=target AND service_scene='restaurant') THEN PERFORM dg_native_reception_error('FORBIDDEN');END IF;RETURN dg_native_guest_memory_export_before_dining_scope(target,token_hash_value);END;$dg$;

ALTER FUNCTION dg_native_guest_memory_attempt(text,text,text,bigint,text,text) RENAME TO dg_native_guest_memory_attempt_before_dining_scope;
CREATE FUNCTION dg_native_guest_memory_attempt(target text,token_hash_value text,csrf_hash_value text,focus_value bigint,key_hash_value text,body_hash_value text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN IF EXISTS(SELECT 1 FROM reception_sessions WHERE id=target AND service_scene='restaurant') THEN PERFORM dg_native_reception_error('FORBIDDEN');END IF;PERFORM dg_native_guest_memory_attempt_before_dining_scope(target,token_hash_value,csrf_hash_value,focus_value,key_hash_value,body_hash_value);END;$dg$;

ALTER FUNCTION dg_native_guest_memory_recovery_meta(text,text,text,text) RENAME TO dg_native_guest_memory_recovery_meta_before_dining_scope;
CREATE FUNCTION dg_native_guest_memory_recovery_meta(target text,token_hash_value text,credential_value text,code_hash_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN IF EXISTS(SELECT 1 FROM reception_sessions WHERE id=target AND service_scene='restaurant') THEN PERFORM dg_native_reception_error('FORBIDDEN');END IF;RETURN dg_native_guest_memory_recovery_meta_before_dining_scope(target,token_hash_value,credential_value,code_hash_value);END;$dg$;

ALTER FUNCTION dg_native_guest_memory_apply(text,text,text,bigint,text,jsonb) RENAME TO dg_native_guest_memory_apply_before_dining_scope;
CREATE FUNCTION dg_native_guest_memory_apply(target text,token_hash_value text,csrf_hash_value text,focus_value bigint,action_value text,input jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN IF EXISTS(SELECT 1 FROM reception_sessions WHERE id=target AND service_scene='restaurant') THEN PERFORM dg_native_reception_error('FORBIDDEN');END IF;RETURN dg_native_guest_memory_apply_before_dining_scope(target,token_hash_value,csrf_hash_value,focus_value,action_value,input);END;$dg$;

ALTER FUNCTION dg_native_guest_memory_result(text,text) RENAME TO dg_native_guest_memory_result_before_dining_scope;
CREATE FUNCTION dg_native_guest_memory_result(target text,token_hash_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN IF EXISTS(SELECT 1 FROM reception_sessions WHERE id=(SELECT session_id FROM _dg_native_guest_memory_actions WHERE id=target) AND service_scene='restaurant') THEN PERFORM dg_native_reception_error('FORBIDDEN');END IF;RETURN dg_native_guest_memory_result_before_dining_scope(target,token_hash_value);END;$dg$;

CREATE OR REPLACE FUNCTION dg_native_speaker_event_actor(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;
BEGIN
 PERFORM dg_native_reception_runtime();meta:=dg_native_reception_meta(target,NULL);
 IF meta->>'serviceScene'='restaurant' THEN
  IF meta->>'actorId' IS DISTINCT FROM current_setting('digitalguide.actor_id',true) THEN PERFORM dg_native_speaker_error('FORBIDDEN');END IF;
  PERFORM dg_native_dining_meta_authorize(target);
 ELSE PERFORM dg_native_reception_admin(meta->>'workspaceId');END IF;RETURN meta;
END;$dg$;

CREATE OR REPLACE FUNCTION dg_native_speaker_event_context(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;o _dg_native_speaker_event_origins%ROWTYPE;access_hash text;visit_value jsonb;
BEGIN
 meta:=dg_native_speaker_event_current(target);SELECT * INTO o FROM _dg_native_speaker_event_origins WHERE decision_id=target;
 -- Existing guest context is reused internally; no capability or private
 -- recognition handle is returned to the staff event endpoint.
 SELECT token_hash INTO access_hash FROM _dg_native_reception_access WHERE session_id=o.session_id AND access_version=(meta->>'accessVersion')::bigint AND expires_at>dg_utc_now() ORDER BY created_at DESC LIMIT 1;
 IF access_hash IS NOT NULL AND meta->>'serviceScene' IS DISTINCT FROM 'restaurant' THEN visit_value:=dg_native_visit_reply_context(o.session_id,access_hash);END IF;
 RETURN jsonb_build_object('meta',meta,'descriptor',o.descriptor,'signatureHash',(SELECT signature_hash FROM _dg_native_speaker_event_signatures WHERE decision_id=target),'memory',CASE WHEN meta->>'serviceScene'='restaurant' THEN NULL ELSE dg_native_guest_memory_private_context(o.session_id) END,'visit',visit_value);
END;$dg$;


DO $scope_acl$ DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND(p.proname LIKE 'dg_native_guest_memory_%' OR p.proname=ANY(ARRAY['dg_native_speaker_event_actor','dg_native_speaker_event_context'])) LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||f.signature||' FROM PUBLIC';END LOOP;END;$scope_acl$;
