CREATE TABLE _dg_native_food_memory_import_origins(
 import_id text PRIMARY KEY REFERENCES dining_memory_imports(id),
 action_id text NOT NULL UNIQUE REFERENCES _dg_native_dining_actions(id),
 runtime_id text NOT NULL,party_id text NOT NULL REFERENCES dining_parties(id),
 person_id text NOT NULL REFERENCES people(id),person_version bigint NOT NULL,
 session_id text NOT NULL REFERENCES reception_sessions(id),focus_version bigint NOT NULL,
 access_id text NOT NULL REFERENCES _dg_native_reception_access(id),
 selection_version bigint NOT NULL,party_access_version bigint NOT NULL,
 facts_hash text NOT NULL,fact_descriptors jsonb NOT NULL,created_at text NOT NULL,expires_at text NOT NULL
);
CREATE TABLE _dg_native_food_memory_import_revocations(
 import_id text PRIMARY KEY REFERENCES _dg_native_food_memory_import_origins(import_id),
 action_id text NOT NULL REFERENCES _dg_native_dining_actions(id),
 reason text NOT NULL CHECK(reason IN('source_changed','source_unavailable','retention_expired')),
 created_at text NOT NULL,transaction_id text NOT NULL
);
CREATE TRIGGER native_food_memory_import_origin_immutable BEFORE UPDATE OR DELETE ON _dg_native_food_memory_import_origins FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_food_memory_import_revocation_immutable BEFORE UPDATE OR DELETE ON _dg_native_food_memory_import_revocations FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();

CREATE FUNCTION dg_native_food_memory_import_valid(target text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT EXISTS(
  SELECT 1 FROM _dg_native_food_memory_import_origins o
  JOIN dining_memory_imports i ON i.id=o.import_id
  JOIN dining_parties party ON party.id=o.party_id
  JOIN people person ON person.id=o.person_id
  JOIN _dg_native_people_guards guard ON guard.person_id=person.id
  JOIN reception_sessions s ON s.id=o.session_id
  JOIN memory_session_links link ON link.session_id=s.id AND link.person_id=person.id AND link.focus_version=o.focus_version
  JOIN _dg_native_reception_access access ON access.id=o.access_id AND access.session_id=s.id AND access.access_version=s.access_version
  JOIN _dg_native_dining_session_origins session_origin ON session_origin.session_id=s.id
  WHERE o.import_id=target AND o.runtime_id=(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1)
   AND NOT EXISTS(SELECT 1 FROM _dg_native_food_memory_import_revocations WHERE import_id=target)
   AND i.expires_at>dg_native_dining_now() AND person.expires_at>dg_native_dining_now()
   AND person.status='active' AND person.personalization=1 AND person.version=o.person_version
   AND person.guest_session_id=s.id AND guard.invalidated_at IS NULL
   AND link.transcript_expires_at>dg_native_dining_now() AND dg_native_food_memory_scope_matches(person.id,s.id)
   AND s.status='active' AND s.focus_version=o.focus_version AND s.expires_at>dg_native_dining_now()
   AND s.activity_at>dg_native_people_iso(clock_timestamp()-interval '120 seconds') AND access.expires_at>dg_native_dining_now()
   AND dg_native_dining_clock_authority(session_origin.actor_id,session_origin.restaurant_id,session_origin.actor_epoch,session_origin.grant_version)
   AND dg_native_reception_source_valid(s.id)
   AND party.owner_session_id=s.id AND party.access_version=o.party_access_version
   AND party.status IN('waiting','reserved','held','seated') AND party.restaurant_id=session_origin.restaurant_id
   AND s.dining_party_id=party.id AND o.selection_version=(SELECT coalesce(max(version),0) FROM _dg_native_dining_selection_revisions WHERE session_id=s.id)
   AND NOT EXISTS(
    SELECT 1 FROM jsonb_array_elements(i.facts::jsonb) snapshot WHERE NOT EXISTS(
     SELECT 1 FROM memory_facts fact JOIN memory_lookup lookup ON lookup.fact_id=fact.id AND lookup.person_id=fact.person_id AND lookup.value=fact.value
     WHERE fact.id=snapshot->>'id' AND fact.person_id=person.id AND fact.fact_key=snapshot->>'key'
      AND fact.value=snapshot->>'value' AND fact.version=(snapshot->>'version')::bigint
      AND fact.expires_at=snapshot->>'expiresAt' AND fact.expires_at>dg_native_dining_now()
      AND fact.status='confirmed' AND fact.visibility='reception' AND fact.fact_key IN('nickname','like','avoid')
    )
   )
 );
$dg$;

CREATE FUNCTION dg_native_food_memory_selected(import_value text,selected jsonb,target text,meta jsonb,preferences jsonb DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE origin _dg_native_food_memory_import_origins%ROWTYPE;snapshot jsonb;fact_value text;
BEGIN
 SELECT * INTO origin FROM _dg_native_food_memory_import_origins WHERE import_id=import_value;
 IF meta->>'actorType'<>'guest' OR origin.import_id IS NULL OR origin.party_id<>target
  OR origin.session_id IS DISTINCT FROM meta->>'sessionId' OR origin.access_id IS DISTINCT FROM meta->>'accessId'
  OR origin.focus_version IS DISTINCT FROM(meta->>'focusVersion')::bigint OR origin.selection_version IS DISTINCT FROM(meta->>'selectionVersion')::bigint
  OR NOT dg_native_food_memory_import_valid(import_value) THEN PERFORM dg_native_food_error('MEMORY_SOURCE_CHANGED');END IF;
 IF jsonb_typeof(selected) IS DISTINCT FROM 'array' OR jsonb_array_length(selected) NOT BETWEEN 1 AND 20 OR(SELECT count(DISTINCT value) FROM jsonb_array_elements_text(selected))<>jsonb_array_length(selected) THEN PERFORM dg_native_food_error('VALIDATION_FAILED');END IF;
 FOR fact_value IN SELECT jsonb_array_elements_text(selected) LOOP
  SELECT value INTO snapshot FROM jsonb_array_elements((SELECT facts::jsonb FROM dining_memory_imports WHERE id=import_value)) WHERE value->>'id'=fact_value;
  IF snapshot IS NULL THEN PERFORM dg_native_food_error('MEMORY_SOURCE_CHANGED');END IF;
  IF preferences IS NOT NULL AND NOT (CASE snapshot->>'key'
    WHEN 'like' THEN preferences->'likes' @> jsonb_build_array(snapshot->>'value')
    WHEN 'avoid' THEN preferences->'avoids' @> jsonb_build_array(snapshot->>'value')
    ELSE strpos(preferences->>'note',snapshot->>'value')>0 END) THEN PERFORM dg_native_food_error('VALIDATION_FAILED');END IF;
 END LOOP;
END;$dg$;

CREATE FUNCTION dg_native_food_memory_import_project(target text,session_value text,token_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE origin _dg_native_food_memory_import_origins%ROWTYPE;meta jsonb;facts_value jsonb;
BEGIN
 SELECT * INTO origin FROM _dg_native_food_memory_import_origins WHERE import_id=target;
 IF origin.import_id IS NULL OR session_value IS NULL THEN PERFORM dg_native_food_error('NOT_FOUND');END IF;
 meta:=dg_native_dining_context('party',origin.party_id,session_value,token_value);
 IF origin.session_id IS DISTINCT FROM session_value OR origin.access_id IS DISTINCT FROM meta->>'accessId' OR origin.focus_version IS DISTINCT FROM(meta->>'focusVersion')::bigint OR origin.selection_version IS DISTINCT FROM(meta->>'selectionVersion')::bigint OR NOT dg_native_food_memory_import_valid(target) THEN PERFORM dg_native_food_error('MEMORY_SOURCE_CHANGED');END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',value->>'id','key',value->>'key','value',value->>'value') ORDER BY value->>'id'),'[]') INTO facts_value FROM jsonb_array_elements((SELECT facts::jsonb FROM dining_memory_imports WHERE id=target));
 RETURN jsonb_build_object('id',target,'expiresAt',origin.expires_at,'facts',facts_value,'notice','仅将所选建议填入本次草稿；仍须重新保存并明确确认，不会推断过敏信息或自动下单。');
END;$dg$;

CREATE FUNCTION dg_native_food_memory_import_create(target text,input jsonb,session_value text,token_value text,csrf_value text,focus_value bigint) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;person people%ROWTYPE;party dining_parties%ROWTYPE;created text;expires text;facts_value jsonb;descriptors jsonb;operation_value text;record_value text:=gen_random_uuid()::text;
BEGIN
 meta:=dg_native_food_context(target,input,session_value,token_value,csrf_value,focus_value);
 IF meta->>'actorType'<>'guest' OR input->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN PERFORM dg_native_food_error('VALIDATION_FAILED');END IF;
 PERFORM dg_native_restaurant_fields(input-ARRAY['focusVersion','selectionVersion'],ARRAY['version','confirmed']);
 PERFORM dg_native_food_memory_authorize(session_value,token_value,csrf_value,focus_value,true);
 person:=dg_native_guest_memory_owned(session_value,false);
 IF person.id IS NULL OR person.personalization<>1 THEN PERFORM dg_native_food_error('MEMORY_CONSENT_REQUIRED');END IF;
 IF(SELECT count(*) FROM _dg_native_food_memory_import_origins WHERE person_id=person.id)>=100 OR(SELECT count(*) FROM _dg_native_dining_actions WHERE resource_id=target AND kind='food_memory' AND created_at>dg_native_people_iso(clock_timestamp()-interval '5 minutes'))>=20 THEN PERFORM dg_native_food_error('RATE_LIMITED');END IF;
 SELECT * INTO party FROM dining_parties WHERE id=target;created:=dg_native_dining_now();
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',fact.id,'key',fact.fact_key,'value',fact.value,'version',fact.version,'expiresAt',fact.expires_at) ORDER BY fact.id),'[]'),least(person.expires_at,dg_native_people_iso(created::timestamptz+interval '24 hours'),min(fact.expires_at)) INTO facts_value,expires FROM(
  SELECT f.* FROM memory_facts f JOIN memory_lookup l ON l.fact_id=f.id AND l.person_id=f.person_id AND l.value=f.value
  WHERE f.person_id=person.id AND f.status='confirmed' AND f.visibility='reception' AND f.expires_at>created AND f.fact_key IN('nickname','like','avoid')
   AND char_length(f.value) BETWEEN 1 AND CASE WHEN f.fact_key='nickname' THEN 60 ELSE 40 END ORDER BY f.id LIMIT 20
 ) fact;
 IF expires<=dg_native_dining_now() THEN PERFORM dg_native_food_error('MEMORY_SOURCE_CHANGED');END IF;
 SELECT coalesce(jsonb_agg((value-'value')||jsonb_build_object('valueHash',dg_native_office_hash(value->'value'))),'[]') INTO descriptors FROM jsonb_array_elements(facts_value);
 operation_value:=dg_native_dining_action(meta,'food_memory','party',target,input-ARRAY['focusVersion','selectionVersion']);PERFORM dg_native_dining_effect(operation_value,'dining_memory_imports',record_value);
 INSERT INTO dining_memory_imports VALUES(record_value,target,session_value,focus_value,person.id,facts_value::text,expires,created);
 INSERT INTO _dg_native_food_memory_import_origins VALUES(record_value,operation_value,(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1),target,person.id,person.version,session_value,focus_value,meta->>'accessId',(meta->>'selectionVersion')::bigint,party.access_version,dg_native_office_hash(facts_value),descriptors,created,expires);
 PERFORM dg_native_dining_touch(meta,operation_value);INSERT INTO outbox_events VALUES(gen_random_uuid()::text,meta->>'tenantId',meta->>'workspaceId',target,'dining.food_memory','mock','{}',created,NULL);RETURN operation_value;
END;$dg$;

CREATE FUNCTION dg_native_food_memory_revoke(target text,reason_value text) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE origin _dg_native_food_memory_import_origins%ROWTYPE;party dining_parties%ROWTYPE;restaurant restaurants%ROWTYPE;pref dining_preferences%ROWTYPE;meta jsonb;operation_value text;created text;
BEGIN
 SELECT * INTO origin FROM _dg_native_food_memory_import_origins WHERE import_id=target;
 IF origin.import_id IS NULL OR EXISTS(SELECT 1 FROM _dg_native_food_memory_import_revocations WHERE import_id=target) THEN RETURN 0;END IF;
 SELECT * INTO party FROM dining_parties WHERE id=origin.party_id;SELECT * INTO restaurant FROM restaurants WHERE id=party.restaurant_id;
 PERFORM dg_native_reception_workspace(restaurant.tenant_id,restaurant.workspace_id,true);PERFORM id FROM restaurants WHERE id=restaurant.id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM _dg_native_food_memory_import_revocations WHERE import_id=target) THEN RETURN 0;END IF;
 SELECT * INTO party FROM dining_parties WHERE id=origin.party_id FOR UPDATE;
 meta:=jsonb_build_object('restaurantId',restaurant.id,'tenantId',restaurant.tenant_id,'workspaceId',restaurant.workspace_id,'actorType','worker','actorId','system:food-privacy','actorEpoch',NULL,'grantVersion',NULL,'sessionId',NULL,'accessId',NULL,'focusVersion',NULL,'selectionVersion',NULL);
 operation_value:=dg_native_dining_action(meta,'food_memory_redact','party',party.id,'{}');SELECT created_at INTO created FROM _dg_native_dining_actions WHERE id=operation_value;
 INSERT INTO _dg_native_food_memory_import_revocations VALUES(target,operation_value,reason_value,created,pg_current_xact_id()::text);
 PERFORM dg_native_dining_effect(operation_value,'dining_memory_imports',target);UPDATE dining_memory_imports SET facts='[]' WHERE id=target;
 FOR pref IN SELECT f.* FROM dining_preferences f JOIN _dg_native_food_preference_origins o ON o.preference_id=f.id WHERE f.source_import_id=target AND f.payload<>'{}' FOR UPDATE OF f LOOP
  PERFORM dg_native_dining_effect(operation_value,'dining_preferences',pref.id);UPDATE dining_preferences SET payload='{}',status=CASE WHEN expires_at<=dg_native_dining_now() THEN 'expired' ELSE 'superseded' END WHERE id=pref.id;
  IF party.current_preference_id=pref.id AND party.status IN('waiting','reserved','held','seated') THEN PERFORM dg_native_dining_effect(operation_value,'dining_parties',party.id);UPDATE dining_parties SET version=version+1,updated_at=created WHERE id=party.id;END IF;
 END LOOP;RETURN 1;
END;$dg$;

ALTER FUNCTION dg_native_people_invalidate(text) RENAME TO dg_native_people_invalidate_before_food_import;
CREATE FUNCTION dg_native_people_invalidate(target text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE item record;
BEGIN
 PERFORM dg_native_people_invalidate_before_food_import(target);
 FOR item IN SELECT o.import_id FROM _dg_native_food_memory_import_origins o WHERE o.person_id=target AND NOT EXISTS(SELECT 1 FROM _dg_native_food_memory_import_revocations r WHERE r.import_id=o.import_id) ORDER BY o.party_id,o.import_id LOOP
  PERFORM dg_native_food_memory_revoke(item.import_id,'source_changed');
 END LOOP;
END;$dg$;

ALTER FUNCTION dg_native_food_sweep(text) RENAME TO dg_native_food_sweep_before_memory_import;
CREATE FUNCTION dg_native_food_sweep(restaurant_value text DEFAULT NULL) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE item record;changed bigint:=0;
BEGIN
 PERFORM dg_native_reception_runtime(true);
 FOR item IN SELECT o.import_id,o.expires_at FROM _dg_native_food_memory_import_origins o JOIN dining_parties p ON p.id=o.party_id WHERE(restaurant_value IS NULL OR p.restaurant_id=restaurant_value) AND NOT EXISTS(SELECT 1 FROM _dg_native_food_memory_import_revocations r WHERE r.import_id=o.import_id) AND NOT dg_native_food_memory_import_valid(o.import_id) ORDER BY p.restaurant_id,o.import_id LIMIT 100 LOOP
  changed:=changed+dg_native_food_memory_revoke(item.import_id,CASE WHEN item.expires_at<=dg_native_dining_now() THEN 'retention_expired' ELSE 'source_unavailable' END);
 END LOOP;RETURN changed+dg_native_food_sweep_before_memory_import(restaurant_value);
END;$dg$;

ALTER FUNCTION dg_native_food_preference(text,jsonb) RENAME TO dg_native_food_preference_before_memory_import;
CREATE FUNCTION dg_native_food_preference(target text,meta jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE value jsonb;pref dining_preferences%ROWTYPE;
BEGIN
 value:=dg_native_food_preference_before_memory_import(target,meta);IF value IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO pref FROM dining_preferences WHERE id=value->>'id';
 IF pref.source='memory_suggestion' AND NOT dg_native_food_memory_import_valid(pref.source_import_id) THEN
  value:=value||jsonb_build_object('preferences',jsonb_build_object('likes','[]'::jsonb,'avoids','[]'::jsonb,'allergens','[]'::jsonb,'allergyMode','not_provided','maxSpice',NULL,'budgetPerDishMinor',NULL,'note',''),'sourceFactIds','[]'::jsonb,'usable',false,'reason','本人记忆授权、来源或当前服务对象已变化，旧建议已失效，请重新核对。');
 END IF;RETURN value;
END;$dg$;

ALTER FUNCTION dg_native_food_result(text,text,text) RENAME TO dg_native_food_result_before_memory_import;
CREATE FUNCTION dg_native_food_result(target text,session_value text DEFAULT NULL,token_value text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE operation _dg_native_dining_actions%ROWTYPE;import_value text;
BEGIN
 SELECT * INTO operation FROM _dg_native_dining_actions WHERE id=target;
 IF operation.kind='food_memory' THEN
  PERFORM dg_native_dining_action_result(target,session_value,token_value);SELECT import_id INTO import_value FROM _dg_native_food_memory_import_origins WHERE action_id=target;RETURN dg_native_food_memory_import_project(import_value,session_value,token_value);
 END IF;RETURN dg_native_food_result_before_memory_import(target,session_value,token_value);
END;$dg$;

CREATE FUNCTION dg_native_food_memory_import_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j jsonb:=to_jsonb(NEW);previous jsonb:=to_jsonb(OLD);
BEGIN
 IF TG_OP='DELETE' OR NOT dg_native_dining_changed('dining_memory_imports',NEW.id) OR NOT EXISTS(
  SELECT 1 FROM _dg_native_dining_changes change JOIN _dg_native_dining_actions action ON action.id=change.action_id
  WHERE change.table_name='dining_memory_imports' AND change.resource_id=NEW.id AND change.transaction_id=pg_current_xact_id()::text
   AND action.transaction_id=change.transaction_id AND action.resource_id=NEW.party_id AND action.kind=CASE WHEN TG_OP='INSERT' THEN 'food_memory' ELSE 'food_memory_redact' END
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Memory snapshots require their actual scoped import or erasure action';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.expires_at<=NEW.created_at OR NEW.expires_at::timestamptz>NEW.created_at::timestamptz+interval '24 hours' OR jsonb_typeof(NEW.facts::jsonb)<>'array' OR jsonb_array_length(NEW.facts::jsonb)>20 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Memory suggestions keep their bounded original snapshot and deadline';END IF;
 ELSE
  IF j-'facts' IS DISTINCT FROM previous-'facts' OR NEW.facts<>'[]' OR NOT EXISTS(SELECT 1 FROM _dg_native_food_memory_import_revocations WHERE import_id=NEW.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Memory snapshot cleanup cannot replace identity, consent or original clocks';END IF;
 END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_food_memory_import_guard BEFORE INSERT OR UPDATE OR DELETE ON dining_memory_imports FOR EACH ROW EXECUTE FUNCTION dg_native_food_memory_import_guard();

CREATE FUNCTION dg_native_food_memory_import_final() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j jsonb:=to_jsonb(NEW);import_value text;o _dg_native_food_memory_import_origins%ROWTYPE;i dining_memory_imports%ROWTYPE;a _dg_native_dining_actions%ROWTYPE;revocation _dg_native_food_memory_import_revocations%ROWTYPE;descriptors jsonb;
BEGIN
 import_value:=CASE WHEN TG_TABLE_NAME='dining_memory_imports' THEN j->>'id' ELSE j->>'import_id' END;
 SELECT * INTO o FROM _dg_native_food_memory_import_origins WHERE import_id=import_value;SELECT * INTO i FROM dining_memory_imports WHERE id=import_value;SELECT * INTO a FROM _dg_native_dining_actions WHERE id=o.action_id;SELECT * INTO revocation FROM _dg_native_food_memory_import_revocations WHERE import_id=import_value;
 IF o.import_id IS NULL OR i.id IS NULL OR o.runtime_id IS DISTINCT FROM(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1)
  OR o.party_id<>i.party_id OR o.person_id<>i.person_id OR o.session_id<>i.session_id OR o.focus_version<>i.focus_version
  OR o.created_at<>i.created_at OR o.expires_at<>i.expires_at OR a.kind<>'food_memory' OR a.actor_type<>'guest' OR a.resource_id<>i.party_id
  OR a.session_id IS DISTINCT FROM i.session_id OR a.access_id IS DISTINCT FROM o.access_id OR a.focus_version IS DISTINCT FROM i.focus_version OR a.selection_version IS DISTINCT FROM o.selection_version
  OR NOT dg_native_food_memory_scope_matches(i.person_id,i.session_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Imported suggestions keep their actual person, scope, source action and original deadline';END IF;
 IF revocation.import_id IS NULL THEN
  SELECT coalesce(jsonb_agg((value-'value')||jsonb_build_object('valueHash',dg_native_office_hash(value->'value'))),'[]') INTO descriptors FROM jsonb_array_elements(i.facts::jsonb);
  IF o.facts_hash<>dg_native_office_hash(i.facts::jsonb) OR o.fact_descriptors<>descriptors OR NOT dg_native_food_memory_import_valid(import_value) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Imported fact values and versions must remain authorized at commit';END IF;
 ELSE
  SELECT * INTO a FROM _dg_native_dining_actions WHERE id=revocation.action_id;
  IF i.facts<>'[]' OR a.kind<>'food_memory_redact' OR a.resource_id<>i.party_id OR revocation.transaction_id<>a.transaction_id OR revocation.created_at<>a.created_at OR EXISTS(SELECT 1 FROM dining_preferences WHERE source_import_id=import_value AND payload<>'{}') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Revocation atomically removes imported and derived private payloads';END IF;
 END IF;RETURN NULL;
END;$dg$;
CREATE CONSTRAINT TRIGGER native_food_memory_snapshot_final AFTER INSERT OR UPDATE ON dining_memory_imports DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_food_memory_import_final();
CREATE CONSTRAINT TRIGGER native_food_memory_import_origin_final AFTER INSERT ON _dg_native_food_memory_import_origins DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_food_memory_import_final();
CREATE CONSTRAINT TRIGGER native_food_memory_import_revocation_final AFTER INSERT ON _dg_native_food_memory_import_revocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_food_memory_import_final();

CREATE FUNCTION dg_native_food_memory_preference_final() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE f dining_preferences%ROWTYPE;o _dg_native_food_memory_import_origins%ROWTYPE;source_value text;
BEGIN
 SELECT * INTO f FROM dining_preferences WHERE id=NEW.id;IF f.source<>'memory_suggestion' THEN RETURN NULL;END IF;SELECT * INTO o FROM _dg_native_food_memory_import_origins WHERE import_id=f.source_import_id;
 IF o.import_id IS NULL OR o.party_id<>f.party_id OR o.session_id IS DISTINCT FROM f.session_id OR o.focus_version IS DISTINCT FROM f.focus_version OR f.expires_at>o.expires_at THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Derived preferences retain their original purpose and source deadline';END IF;
 FOR source_value IN SELECT jsonb_array_elements_text(f.source_fact_ids::jsonb) LOOP
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(o.fact_descriptors) descriptor WHERE descriptor->>'id'=source_value) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Derived preferences only cite selected source facts';END IF;
 END LOOP;RETURN NULL;
END;$dg$;
CREATE CONSTRAINT TRIGGER native_food_memory_preference_final AFTER INSERT OR UPDATE ON dining_preferences DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_food_memory_preference_final();

CREATE OR REPLACE FUNCTION dg_native_food_apply(target text,action_value text,input jsonb,session_value text DEFAULT NULL,token_value text DEFAULT NULL,csrf_value text DEFAULT NULL,focus_value bigint DEFAULT NULL) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;body jsonb:=input-ARRAY['focusVersion','selectionVersion'];p dining_parties%ROWTYPE;f dining_preferences%ROWTYPE;old_f dining_preferences%ROWTYPE;r restaurants%ROWTYPE;s reception_sessions%ROWTYPE;origin _dg_native_food_preference_origins%ROWTYPE;operation_value text;record_value text;created text;expires text;revision_value bigint;preference_value jsonb;payload_value jsonb;selection_value bigint;
BEGIN
 IF action_value='memory' THEN RETURN dg_native_food_memory_import_create(target,input,session_value,token_value,csrf_value,focus_value);END IF;
 IF action_value NOT IN('draft','confirm','recommend') OR jsonb_typeof(input) IS DISTINCT FROM 'object' THEN PERFORM dg_native_food_error('VALIDATION_FAILED');END IF;
 meta:=dg_native_food_context(target,input,session_value,token_value,csrf_value,focus_value);p:=dg_native_dining_owned(meta,target);SELECT * INTO r FROM restaurants WHERE id=p.restaurant_id;created:=dg_native_dining_now();
 IF action_value<>'recommend' AND body->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN PERFORM dg_native_food_error('VALIDATION_FAILED');END IF;
 IF(SELECT count(*) FROM _dg_native_dining_actions WHERE resource_id=p.id AND kind='food_'||action_value AND created_at>dg_native_people_iso(clock_timestamp()-interval '5 minutes'))>=20 THEN PERFORM dg_native_food_error('RATE_LIMITED');END IF;
 operation_value:=dg_native_dining_action(meta,'food_'||action_value,'party',p.id,body);record_value:=gen_random_uuid()::text;
 IF action_value='draft' THEN
  PERFORM dg_native_restaurant_fields(body,ARRAY['version','preferences','importId','sourceFactIds','confirmed']);PERFORM dg_native_food_fields(body->'preferences');
  IF body->'importId' IS DISTINCT FROM 'null'::jsonb THEN PERFORM dg_native_food_memory_selected(body->>'importId',body->'sourceFactIds',target,meta,body->'preferences');ELSIF body->'sourceFactIds' IS DISTINCT FROM '[]'::jsonb THEN PERFORM dg_native_food_error('MEMORY_IMPORT_REQUIRED');END IF;
  IF p.current_preference_id IS NOT NULL THEN SELECT * INTO old_f FROM dining_preferences WHERE id=p.current_preference_id;IF old_f.status IN('draft','confirmed') THEN PERFORM dg_native_dining_effect(operation_value,'dining_preferences',old_f.id);UPDATE dining_preferences SET status='superseded' WHERE id=old_f.id;END IF;END IF;
  SELECT coalesce(max(revision),0)+1 INTO revision_value FROM dining_preferences WHERE party_id=p.id;expires:=least(dg_native_people_iso(created::timestamptz+interval '24 hours'),(SELECT expires_at FROM dining_memory_imports WHERE id=body->>'importId'));
  PERFORM dg_native_dining_effect(operation_value,'dining_preferences',record_value);
  INSERT INTO dining_preferences(id,party_id,revision,payload,status,source,source_fact_ids,source_import_id,session_id,focus_version,actor_id,expires_at,created_at) VALUES(record_value,p.id,revision_value,(body->'preferences')::text,'draft',CASE WHEN body->>'importId' IS NOT NULL THEN 'memory_suggestion' WHEN meta->>'actorType'='guest' THEN 'guest_manual' ELSE 'staff_confirmation' END,(body->'sourceFactIds')::text,body->>'importId',meta->>'sessionId',(meta->>'focusVersion')::bigint,meta->>'actorId',expires,created);
  INSERT INTO _dg_native_food_preference_origins VALUES(record_value,p.id,operation_value,(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1),p.access_version,p.version+1,dg_native_office_hash(body->'preferences'),created,expires);
  PERFORM dg_native_dining_effect(operation_value,'dining_parties',p.id);UPDATE dining_parties SET current_preference_id=record_value,version=version+1,updated_at=created WHERE id=p.id;
 ELSIF action_value='confirm' THEN
  PERFORM dg_native_restaurant_fields(body,ARRAY['version','preferenceId','revision','confirmed']);SELECT * INTO f FROM dining_preferences WHERE id=body->>'preferenceId' AND party_id=p.id;SELECT * INTO origin FROM _dg_native_food_preference_origins WHERE preference_id=f.id;
  IF f.id IS NULL OR origin.preference_id IS NULL OR p.current_preference_id<>f.id OR f.status<>'draft' OR f.revision<>dg_native_restaurant_integer(body->'revision',1,9007199254740991) OR f.expires_at<=created OR origin.draft_party_version<>p.version OR origin.party_access_version<>p.access_version THEN PERFORM dg_native_food_error('PREFERENCE_CHANGED');END IF;
  IF meta->>'actorType'='guest' AND(f.session_id IS DISTINCT FROM meta->>'sessionId' OR f.focus_version IS DISTINCT FROM(meta->>'focusVersion')::bigint) THEN PERFORM dg_native_food_error('PREFERENCE_CHANGED');END IF;
  IF f.source='memory_suggestion' THEN PERFORM dg_native_food_memory_selected(f.source_import_id,f.source_fact_ids::jsonb,target,meta);END IF;
  PERFORM dg_native_dining_effect(operation_value,'dining_preferences',f.id);UPDATE dining_preferences SET status='confirmed',confirmed_at=created,confirmed_by=meta->>'actorId',confirmed_focus_version=(meta->>'focusVersion')::bigint WHERE id=f.id;
  SELECT * INTO s FROM reception_sessions WHERE id=p.owner_session_id;SELECT coalesce(max(version),0) INTO selection_value FROM _dg_native_dining_selection_revisions WHERE session_id=s.id;
  INSERT INTO _dg_native_food_confirmations VALUES(f.id,operation_value,p.version+1,p.access_version,p.owner_session_id,s.focus_version,selection_value,meta->>'actorType',created);
  PERFORM dg_native_dining_effect(operation_value,'dining_parties',p.id);UPDATE dining_parties SET version=version+1,updated_at=created WHERE id=p.id;
 ELSE
  PERFORM dg_native_restaurant_fields(body,ARRAY['version','menuVersion']);IF r.menu_version<>dg_native_restaurant_integer(body->'menuVersion',1,9007199254740991) THEN PERFORM dg_native_food_error('MENU_CHANGED');END IF;
  preference_value:=dg_native_food_preference(p.id,meta);IF preference_value IS NULL OR preference_value->'usable' IS DISTINCT FROM 'true'::jsonb THEN PERFORM dg_native_food_error('PREFERENCE_CONFIRMATION_REQUIRED');END IF;
  payload_value:=dg_native_food_candidates(dg_native_dining_menu_projection(r.id),preference_value->'preferences');expires:=dg_native_people_iso(created::timestamptz+interval '15 minutes');
  PERFORM dg_native_dining_effect(operation_value,'dining_recommendations',record_value);INSERT INTO dining_recommendations VALUES(record_value,p.id,p.version,r.menu_version,p.current_preference_id,payload_value::text,expires,created);
  INSERT INTO _dg_native_food_recommendation_origins VALUES(record_value,p.id,operation_value,p.access_version,dg_native_office_hash(payload_value),created,expires);
 END IF;
 PERFORM dg_native_dining_touch(meta,operation_value);INSERT INTO outbox_events VALUES(gen_random_uuid()::text,r.tenant_id,r.workspace_id,p.id,'dining.food_'||action_value,'mock','{}',created,NULL);RETURN operation_value;
END;$dg$;

CREATE OR REPLACE FUNCTION dg_native_food_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j jsonb:=to_jsonb(NEW);previous jsonb:=to_jsonb(OLD);p dining_parties%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' OR NOT dg_native_dining_changed(TG_TABLE_NAME,j->>'id') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Food records require their scoped native operation';END IF;
 SELECT * INTO p FROM dining_parties WHERE id=j->>'party_id';IF p.id IS NULL OR NOT EXISTS(SELECT 1 FROM _dg_native_dining_party_origins WHERE party_id=p.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Food records retain their native party';END IF;
 IF NOT EXISTS(SELECT 1 FROM _dg_native_dining_changes changed JOIN _dg_native_dining_actions action ON action.id=changed.action_id WHERE changed.table_name=TG_TABLE_NAME AND changed.resource_id=j->>'id' AND changed.transaction_id=pg_current_xact_id()::text AND action.transaction_id=changed.transaction_id AND action.resource_id=p.id AND action.restaurant_id=p.restaurant_id AND action.kind IN('food_draft','food_confirm','food_recommend','food_expire','food_memory_redact')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Food effects cannot borrow unrelated actions';END IF;
 IF TG_TABLE_NAME='dining_preferences' AND TG_OP='UPDATE' AND previous->>'source'='memory_suggestion' AND j->>'payload'='{}' AND EXISTS(SELECT 1 FROM _dg_native_food_memory_import_revocations WHERE import_id=previous->>'source_import_id') THEN
  IF j-ARRAY['status','payload'] IS DISTINCT FROM previous-ARRAY['status','payload'] OR previous->>'status' NOT IN('draft','confirmed','superseded') OR j->>'status' IS DISTINCT FROM (CASE WHEN j->>'expires_at'<=dg_native_dining_now() THEN 'expired' ELSE 'superseded' END) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Source withdrawal only redacts derived payload without rewriting confirmation or deadline';END IF;RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='dining_preferences' THEN
  IF j->>'status' NOT IN('draft','confirmed','superseded','expired') OR j->>'source' NOT IN('guest_manual','staff_confirmation','memory_suggestion') OR (CASE WHEN j->>'source'='memory_suggestion' THEN j->>'source_import_id' IS NULL OR jsonb_typeof((j->>'source_fact_ids')::jsonb) IS DISTINCT FROM 'array' OR jsonb_array_length((j->>'source_fact_ids')::jsonb) NOT BETWEEN 1 AND 20 ELSE j->>'source_fact_ids'<>'[]' OR j->>'source_import_id' IS NOT NULL END) OR j->>'expires_at'<=j->>'created_at' OR(j->>'expires_at')::timestamptz>(j->>'created_at')::timestamptz+interval '24 hours' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Preference source and original deadline are bounded';END IF;
  IF j->>'status'='expired' THEN IF j->>'expires_at'>dg_native_dining_now() OR j->>'payload'<>'{}' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Expired preferences are redacted only at their original deadline';END IF;ELSE PERFORM dg_native_food_fields((j->>'payload')::jsonb);END IF;
  IF TG_OP='INSERT' THEN
   IF j->>'status'<>'draft' OR(j->>'revision')::bigint<>coalesce((SELECT max(revision) FROM dining_preferences WHERE party_id=p.id),0)+1 OR j->>'confirmed_at' IS NOT NULL OR j->>'confirmed_by' IS NOT NULL OR j->>'confirmed_focus_version' IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native preference creation is an unconfirmed next revision';END IF;
  ELSE
   IF j-ARRAY['status','confirmed_at','confirmed_by','confirmed_focus_version','payload'] IS DISTINCT FROM previous-ARRAY['status','confirmed_at','confirmed_by','confirmed_focus_version','payload'] OR j->>'status'=previous->>'status' OR NOT(previous->>'status'='draft' AND j->>'status' IN('confirmed','superseded','expired') OR previous->>'status'='confirmed' AND j->>'status' IN('superseded','expired') OR previous->>'status'='superseded' AND j->>'status'='expired') OR j->>'status'<>'expired' AND j->>'payload' IS DISTINCT FROM previous->>'payload' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Preference payload, source, revision and original expiry are immutable';END IF;
   IF j->>'status'='confirmed' THEN
    IF j->>'confirmed_at' IS NULL OR j->>'confirmed_by' IS NULL OR j->>'confirmed_at'>=j->>'expires_at' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Confirmation is explicit and before the original deadline';END IF;
   ELSIF j-ARRAY['status','payload'] IS DISTINCT FROM previous-ARRAY['status','payload'] THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Superseding or expiring cannot rewrite a previous confirmation';END IF;
  END IF;
 ELSE
  IF TG_TABLE_NAME<>'dining_recommendations' OR TG_OP<>'INSERT' OR j->>'expires_at'<=j->>'created_at' OR(j->>'expires_at')::timestamptz<>(j->>'created_at')::timestamptz+interval '15 minutes' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Recommendation receipts are immutable with the original fifteen-minute expiry';END IF;
 END IF;RETURN NEW;
END;$dg$;

CREATE OR REPLACE FUNCTION dg_native_food_final() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j jsonb:=to_jsonb(NEW);p dining_parties%ROWTYPE;f dining_preferences%ROWTYPE;rec dining_recommendations%ROWTYPE;o _dg_native_food_preference_origins%ROWTYPE;c _dg_native_food_confirmations%ROWTYPE;ro _dg_native_food_recommendation_origins%ROWTYPE;a _dg_native_dining_actions%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='dining_parties' THEN
  SELECT * INTO p FROM dining_parties WHERE id=j->>'id';IF p.current_preference_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM _dg_native_food_preference_origins origin JOIN dining_preferences pref ON pref.id=origin.preference_id WHERE pref.id=p.current_preference_id AND origin.party_id=p.id AND pref.party_id=p.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Current preference pointer belongs to the same native party';END IF;RETURN NULL;
 ELSIF TG_TABLE_NAME IN('dining_preferences','_dg_native_food_preference_origins','_dg_native_food_confirmations') THEN
  SELECT * INTO f FROM dining_preferences WHERE id=CASE WHEN TG_TABLE_NAME='dining_preferences' THEN j->>'id' ELSE j->>'preference_id' END;SELECT * INTO o FROM _dg_native_food_preference_origins WHERE preference_id=f.id;SELECT * INTO p FROM dining_parties WHERE id=f.party_id;SELECT * INTO a FROM _dg_native_dining_actions WHERE id=o.action_id;
  IF f.id IS NULL OR o.preference_id IS NULL OR o.runtime_id IS DISTINCT FROM(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1) OR o.party_id<>f.party_id OR a.kind<>'food_draft' OR a.resource_id<>p.id OR a.restaurant_id<>p.restaurant_id OR o.created_at<>f.created_at OR o.expires_at<>f.expires_at OR f.status<>'expired' AND NOT(f.source='memory_suggestion' AND f.payload='{}' AND EXISTS(SELECT 1 FROM _dg_native_food_memory_import_revocations WHERE import_id=f.source_import_id)) AND o.payload_hash<>dg_native_office_hash(f.payload::jsonb) OR f.session_id IS DISTINCT FROM a.session_id OR f.focus_version IS DISTINCT FROM a.focus_version OR f.actor_id<>a.actor_id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Preference keeps its actual draft action, scope, source payload and original clock';END IF;
  SELECT * INTO c FROM _dg_native_food_confirmations WHERE preference_id=f.id;
  IF f.status='confirmed' AND c.preference_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Confirmed preference needs its immutable confirmation basis';END IF;
  IF c.preference_id IS NOT NULL THEN
   SELECT * INTO a FROM _dg_native_dining_actions WHERE id=c.action_id;
   IF a.kind<>'food_confirm' OR a.resource_id<>p.id OR a.restaurant_id<>p.restaurant_id OR f.confirmed_by IS DISTINCT FROM a.actor_id OR f.confirmed_focus_version IS DISTINCT FROM a.focus_version OR c.actor_type<>a.actor_type OR f.confirmed_at<>c.created_at OR a.transaction_id=pg_current_xact_id()::text AND(c.party_version<>p.version OR c.party_access_version<>p.access_version OR c.owner_session_id IS DISTINCT FROM p.owner_session_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Confirmation keeps the actual actor, party and owner basis';END IF;
  END IF;
 ELSE
  SELECT * INTO rec FROM dining_recommendations WHERE id=CASE WHEN TG_TABLE_NAME='dining_recommendations' THEN j->>'id' ELSE j->>'recommendation_id' END;SELECT * INTO ro FROM _dg_native_food_recommendation_origins WHERE recommendation_id=rec.id;SELECT * INTO p FROM dining_parties WHERE id=rec.party_id;SELECT * INTO a FROM _dg_native_dining_actions WHERE id=ro.action_id;
  IF rec.id IS NULL OR ro.recommendation_id IS NULL OR ro.party_id<>p.id OR a.kind<>'food_recommend' OR a.resource_id<>p.id OR a.restaurant_id<>p.restaurant_id OR ro.created_at<>rec.created_at OR ro.expires_at<>rec.expires_at OR ro.payload_hash<>dg_native_office_hash(rec.payload::jsonb) OR NOT EXISTS(SELECT 1 FROM _dg_native_food_preference_origins WHERE preference_id=rec.preference_id AND party_id=p.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Recommendation retains its actual party, preference, payload and original deadline';END IF;
 END IF;RETURN NULL;
END;$dg$;

DO $food_import_acl$ DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND(p.proname LIKE 'dg_native_food_%' OR p.proname='dg_native_people_invalidate_before_food_import') LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||f.signature||' FROM PUBLIC';END LOOP;END;$food_import_acl$;
