-- Staff may control only the current anonymous visit of their authorized store terminal.
CREATE FUNCTION dg_native_dining_control(target text,input jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;s reception_sessions%ROWTYPE;
BEGIN
 meta:=dg_native_dining_terminal_prepare(target,false,true);
 PERFORM dg_native_restaurant_fields(input,ARRAY['sessionId','action','version','focusVersion','confirmed']);
 IF input->'confirmed' IS DISTINCT FROM 'true'::jsonb OR input->>'action' IS NULL OR input->>'action' NOT IN('stop','handoff','resume','end') THEN PERFORM dg_native_reception_error('VALIDATION_FAILED');END IF;
 SELECT current_session.* INTO s FROM reception_sessions current_session JOIN _dg_native_dining_session_origins origin ON origin.session_id=current_session.id AND origin.terminal_id=target AND origin.restaurant_id=meta->>'restaurantId' AND origin.runtime_id=(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1) WHERE current_session.terminal_id=target AND current_session.status IN('active','human') FOR UPDATE OF current_session;
 IF s.id IS NULL OR input->>'sessionId' IS DISTINCT FROM s.id THEN PERFORM dg_native_reception_error('VERSION_CONFLICT');END IF;
 IF input->>'action'='resume' AND NOT dg_native_dining_source_valid(s.id) THEN PERFORM dg_native_reception_error('SOURCE_UNAVAILABLE');END IF;
 PERFORM dg_native_reception_control(s.id,input-ARRAY['sessionId','confirmed'],false);
 RETURN s.id;
END;$dg$;

CREATE FUNCTION dg_native_dining_control_view(target text,session_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;s reception_sessions%ROWTYPE;current_value text;
BEGIN
 meta:=dg_native_dining_terminal_prepare(target,false,false);
 SELECT original_session.* INTO s FROM reception_sessions original_session JOIN _dg_native_dining_session_origins origin ON origin.session_id=original_session.id AND origin.terminal_id=target AND origin.restaurant_id=meta->>'restaurantId' AND origin.runtime_id=(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1) WHERE original_session.id=session_value AND original_session.terminal_id=target;
 IF s.id IS NULL THEN PERFORM dg_native_reception_error('NOT_FOUND');END IF;
 SELECT id INTO current_value FROM reception_sessions WHERE terminal_id=target AND status IN('active','human');
 IF current_value IS NOT NULL AND current_value<>s.id THEN PERFORM dg_native_reception_error('VERSION_CONFLICT');END IF;
 IF s.status NOT IN('active','human','ended') THEN PERFORM dg_native_reception_error('SESSION_ENDED');END IF;
 RETURN dg_native_reception_project(s.id);
END;$dg$;
REVOKE ALL ON FUNCTION dg_native_dining_control(text,jsonb),dg_native_dining_control_view(text,text) FROM PUBLIC;
