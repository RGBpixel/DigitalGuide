-- Purpose-bound, self-reported restaurant memory. Existing reception origins
-- retain their original purpose; credentials never grant employee privileges.
CREATE TABLE _dg_native_food_memory_scopes(
 person_id text PRIMARY KEY REFERENCES people(id),
 restaurant_id text NOT NULL REFERENCES restaurants(id),
 origin_session_id text NOT NULL REFERENCES reception_sessions(id),
 origin_focus_version bigint NOT NULL,
 action_id text NOT NULL UNIQUE REFERENCES _dg_native_guest_memory_actions(id),
 runtime_id text NOT NULL,created_at text NOT NULL,transaction_id text NOT NULL
);
CREATE TRIGGER native_food_memory_scope_immutable BEFORE UPDATE OR DELETE ON _dg_native_food_memory_scopes FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();

CREATE FUNCTION dg_native_food_memory_scope_matches(person_value text,session_value text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT EXISTS(
  SELECT 1 FROM people p
  JOIN _dg_native_guest_memory_origins o ON o.person_id=p.id
  JOIN reception_sessions original ON original.id=o.session_id
  JOIN reception_sessions current_session ON current_session.id=session_value
  LEFT JOIN _dg_native_food_memory_scopes scope ON scope.person_id=p.id
  WHERE p.id=person_value AND p.owner_user_id IS NULL AND p.identity_kind='self_reported'
   AND p.tenant_id=current_session.tenant_id AND p.workspace_id=current_session.workspace_id
   AND p.environment=current_session.environment AND p.app_env=current_session.app_env
   AND CASE WHEN current_session.service_scene='restaurant' THEN
    original.service_scene='restaurant' AND scope.origin_session_id=o.session_id
    AND scope.origin_focus_version=o.focus_version
    AND scope.runtime_id=(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1)
    AND EXISTS(SELECT 1 FROM _dg_native_dining_session_origins d WHERE d.session_id=current_session.id AND d.restaurant_id=scope.restaurant_id)
   ELSE current_session.service_scene='reception' AND original.service_scene='reception' AND scope.person_id IS NULL END
 );
$dg$;

CREATE FUNCTION dg_native_food_memory_assert_scope(session_value text,person_value text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE current_person text;
BEGIN
 IF person_value IS NOT NULL THEN
  IF NOT dg_native_food_memory_scope_matches(person_value,session_value) THEN PERFORM dg_native_people_error('FORBIDDEN');END IF;
 ELSE
  FOR current_person IN SELECT id FROM people WHERE guest_session_id=session_value AND status='active' LOOP
   IF NOT dg_native_food_memory_scope_matches(current_person,session_value) THEN PERFORM dg_native_people_error('FORBIDDEN');END IF;
  END LOOP;
 END IF;
END;$dg$;

CREATE FUNCTION dg_native_food_memory_authorize(target text,token_hash_value text,csrf_hash_value text DEFAULT NULL,focus_value bigint DEFAULT NULL,write_value boolean DEFAULT false) RETURNS reception_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s reception_sessions%ROWTYPE;
BEGIN
 s:=dg_native_guest_memory_session(target,token_hash_value,csrf_hash_value,focus_value,write_value);
 IF s.service_scene='restaurant' THEN
  PERFORM dg_native_dining_context('restaurant',(SELECT restaurant_id FROM _dg_native_dining_session_origins WHERE session_id=target),target,token_hash_value,csrf_hash_value,focus_value,write_value);
 END IF;
 PERFORM dg_native_food_memory_assert_scope(target);RETURN s;
END;$dg$;

CREATE FUNCTION dg_native_food_memory_scope_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NEW.runtime_id IS DISTINCT FROM(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1)
  OR NEW.transaction_id IS DISTINCT FROM pg_current_xact_id()::text
  OR NOT EXISTS(
   SELECT 1 FROM _dg_native_guest_memory_actions a
   JOIN _dg_native_guest_memory_origins o ON o.person_id=a.person_id
   JOIN _dg_native_dining_session_origins d ON d.session_id=a.session_id
   JOIN reception_sessions s ON s.id=d.session_id
   WHERE a.id=NEW.action_id AND a.kind='enroll' AND a.person_id=NEW.person_id
    AND a.resource_id=NEW.person_id AND a.session_id=NEW.origin_session_id
    AND a.focus_version=NEW.origin_focus_version AND o.session_id=a.session_id AND o.focus_version=a.focus_version
    AND a.transaction_id=NEW.transaction_id AND a.created_at=NEW.created_at
    AND d.restaurant_id=NEW.restaurant_id AND d.runtime_id=NEW.runtime_id AND s.service_scene='restaurant'
  ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Restaurant memory purpose requires its original same-transaction consent action';END IF;
 RETURN NEW;
END;$dg$;
CREATE TRIGGER native_food_memory_scope_guard BEFORE INSERT ON _dg_native_food_memory_scopes FOR EACH ROW EXECUTE FUNCTION dg_native_food_memory_scope_guard();

CREATE FUNCTION dg_native_food_memory_scope_final() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE person_value text;session_value text;link record;
BEGIN
 IF TG_TABLE_NAME='people' THEN person_value:=NEW.id;ELSE person_value:=NEW.person_id;END IF;
 SELECT guest_session_id INTO session_value FROM people WHERE id=person_value AND owner_user_id IS NULL;
 IF session_value IS NOT NULL AND NOT dg_native_food_memory_scope_matches(person_value,session_value) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Self-reported memory remains within its original purpose and restaurant';
 END IF;
 FOR link IN SELECT session_id FROM memory_session_links WHERE person_id=person_value LOOP
  IF NOT dg_native_food_memory_scope_matches(person_value,link.session_id) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Memory consent links cannot bridge reception purposes or restaurants';
  END IF;
 END LOOP;RETURN NULL;
END;$dg$;
CREATE CONSTRAINT TRIGGER native_food_memory_person_final AFTER INSERT OR UPDATE ON people DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_food_memory_scope_final();
CREATE CONSTRAINT TRIGGER native_food_memory_link_final AFTER INSERT OR UPDATE ON memory_session_links DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_food_memory_scope_final();
CREATE CONSTRAINT TRIGGER native_food_memory_scope_final AFTER INSERT ON _dg_native_food_memory_scopes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_food_memory_scope_final();

ALTER FUNCTION dg_native_guest_memory_private_context(text) RENAME TO dg_native_guest_memory_private_context_before_food_purpose;
CREATE FUNCTION dg_native_guest_memory_private_context(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN PERFORM dg_native_food_memory_assert_scope(target);RETURN dg_native_guest_memory_private_context_before_food_purpose(target);END;$dg$;

CREATE OR REPLACE FUNCTION dg_native_guest_memory_context(target text,token_hash_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN PERFORM dg_native_food_memory_authorize(target,token_hash_value);RETURN dg_native_guest_memory_context_before_dining_scope(target,token_hash_value);END;$dg$;
CREATE OR REPLACE FUNCTION dg_native_guest_memory_view(target text,token_hash_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN PERFORM dg_native_food_memory_authorize(target,token_hash_value);RETURN dg_native_guest_memory_view_before_dining_scope(target,token_hash_value);END;$dg$;
CREATE OR REPLACE FUNCTION dg_native_guest_memory_search(target text,token_hash_value text,query_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN PERFORM dg_native_food_memory_authorize(target,token_hash_value);RETURN dg_native_guest_memory_search_before_dining_scope(target,token_hash_value,query_value);END;$dg$;
CREATE OR REPLACE FUNCTION dg_native_guest_memory_export(target text,token_hash_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN PERFORM dg_native_food_memory_authorize(target,token_hash_value);RETURN dg_native_guest_memory_export_before_dining_scope(target,token_hash_value);END;$dg$;

CREATE OR REPLACE FUNCTION dg_native_guest_memory_attempt(target text,token_hash_value text,csrf_hash_value text,focus_value bigint,key_hash_value text,body_hash_value text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN PERFORM dg_native_food_memory_authorize(target,token_hash_value,csrf_hash_value,focus_value,true);PERFORM dg_native_guest_memory_attempt_before_dining_scope(target,token_hash_value,csrf_hash_value,focus_value,key_hash_value,body_hash_value);END;$dg$;

CREATE OR REPLACE FUNCTION dg_native_guest_memory_recovery_meta(target text,token_hash_value text,credential_value text,code_hash_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE descriptor jsonb;
BEGIN
 PERFORM dg_native_food_memory_authorize(target,token_hash_value);
 descriptor:=dg_native_guest_memory_recovery_meta_before_dining_scope(target,token_hash_value,credential_value,code_hash_value);
 IF NOT dg_native_food_memory_scope_matches(descriptor->>'personId',target) THEN PERFORM dg_native_people_error('RESTORE_UNAVAILABLE');END IF;
 RETURN descriptor;
END;$dg$;

CREATE OR REPLACE FUNCTION dg_native_guest_memory_apply(target text,token_hash_value text,csrf_hash_value text,focus_value bigint,action_value text,input jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s reception_sessions%ROWTYPE;receipt text;a _dg_native_guest_memory_actions%ROWTYPE;
BEGIN
 s:=dg_native_food_memory_authorize(target,token_hash_value,csrf_hash_value,focus_value,true);
 IF action_value='restore' THEN
  PERFORM dg_native_guest_memory_recovery_meta(target,token_hash_value,input->>'credentialId',input->>'codeHash');
 END IF;
 receipt:=dg_native_guest_memory_apply_before_dining_scope(target,token_hash_value,csrf_hash_value,focus_value,action_value,input);
 SELECT * INTO STRICT a FROM _dg_native_guest_memory_actions WHERE id=receipt;
 IF action_value='enroll' AND s.service_scene='restaurant' THEN
  INSERT INTO _dg_native_food_memory_scopes SELECT a.person_id,d.restaurant_id,target,s.focus_version,a.id,d.runtime_id,a.created_at,pg_current_xact_id()::text FROM _dg_native_dining_session_origins d WHERE d.session_id=target;
 END IF;
 PERFORM dg_native_food_memory_assert_scope(target,a.person_id);RETURN receipt;
END;$dg$;

CREATE OR REPLACE FUNCTION dg_native_guest_memory_result(target text,token_hash_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE a _dg_native_guest_memory_actions%ROWTYPE;
BEGIN
 SELECT * INTO a FROM _dg_native_guest_memory_actions WHERE id=target;
 IF a.id IS NULL THEN PERFORM dg_native_people_error('DATA_REMOVED');END IF;
 PERFORM dg_native_food_memory_authorize(a.session_id,token_hash_value,NULL,a.focus_version,false);
 PERFORM dg_native_food_memory_assert_scope(a.session_id,a.person_id);
 RETURN dg_native_guest_memory_result_before_dining_scope(target,token_hash_value);
END;$dg$;

DO $memory_purpose_acl$ DECLARE f record;BEGIN
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND (p.proname LIKE 'dg_native_food_memory_%' OR p.proname LIKE 'dg_native_guest_memory_%') LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION '||f.signature||' FROM PUBLIC';
 END LOOP;
END;$memory_purpose_acl$;
