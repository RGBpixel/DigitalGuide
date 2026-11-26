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
