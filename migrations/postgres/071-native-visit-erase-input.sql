-- Require explicit current focus and confirmation even at the controlled SQL boundary.
CREATE OR REPLACE FUNCTION dg_native_visit_session(target text,token_hash_value text,csrf_hash_value text,focus_value bigint,write_value boolean DEFAULT false) RETURNS reception_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s reception_sessions%ROWTYPE;
BEGIN
 PERFORM dg_native_reception_authorize(target,token_hash_value,csrf_hash_value,write_value);SELECT * INTO STRICT s FROM reception_sessions WHERE id=target;
 IF write_value AND focus_value IS NULL THEN PERFORM dg_native_visit_error('VALIDATION_FAILED');END IF;
 IF focus_value IS NOT NULL AND focus_value<>s.focus_version THEN PERFORM dg_native_visit_error('VERSION_CONFLICT');END IF;
 IF write_value AND s.status<>'active' THEN PERFORM dg_native_visit_error('STATE_CONFLICT');END IF;RETURN s;
END;$dg$;
CREATE OR REPLACE FUNCTION dg_native_visit_erase(target text,token_hash_value text,csrf_hash_value text,input jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s reception_sessions%ROWTYPE;v visits%ROWTYPE;
BEGIN
 IF input IS NULL OR jsonb_typeof(input)<>'object' OR jsonb_typeof(input->'confirmed') IS DISTINCT FROM 'boolean' OR input->>'confirmed' IS DISTINCT FROM 'true' OR jsonb_typeof(input->'version') IS DISTINCT FROM 'number' OR coalesce(input->>'version','') !~ '^[1-9][0-9]*$' OR jsonb_typeof(input->'focusVersion') IS DISTINCT FROM 'number' OR coalesce(input->>'focusVersion','') !~ '^[0-9]+$' THEN PERFORM dg_native_visit_error('VALIDATION_FAILED');END IF;
 PERFORM dg_native_reception_fields(input,ARRAY['version','focusVersion','confirmed']);s:=dg_native_visit_session(target,token_hash_value,csrf_hash_value,(input->>'focusVersion')::bigint,true);
 SELECT * INTO v FROM visits WHERE session_id=target AND focus_version=s.focus_version FOR UPDATE;
 IF v.id IS NULL THEN PERFORM dg_native_visit_error('NOT_FOUND');END IF;
 IF input->>'confirmed'<>'true' OR input->>'version' IS DISTINCT FROM v.version::text THEN PERFORM dg_native_visit_error('VERSION_CONFLICT');END IF;
 PERFORM dg_native_visit_redact(v.id,'owner_request');RETURN v.id;
END;$dg$;
