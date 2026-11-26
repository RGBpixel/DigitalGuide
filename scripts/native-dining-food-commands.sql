CREATE FUNCTION dg_native_food_apply(target text,action_value text,input jsonb,session_value text DEFAULT NULL,token_value text DEFAULT NULL,csrf_value text DEFAULT NULL,focus_value bigint DEFAULT NULL) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;body jsonb:=input-ARRAY['focusVersion','selectionVersion'];p dining_parties%ROWTYPE;f dining_preferences%ROWTYPE;old_f dining_preferences%ROWTYPE;r restaurants%ROWTYPE;s reception_sessions%ROWTYPE;origin _dg_native_food_preference_origins%ROWTYPE;operation_value text;record_value text;created text;expires text;revision_value bigint;preference_value jsonb;payload_value jsonb;selection_value bigint;
BEGIN
 IF action_value NOT IN('draft','confirm','recommend') OR jsonb_typeof(input) IS DISTINCT FROM 'object' THEN PERFORM dg_native_food_error('VALIDATION_FAILED');END IF;
 meta:=dg_native_food_context(target,input,session_value,token_value,csrf_value,focus_value);p:=dg_native_dining_owned(meta,target);SELECT * INTO r FROM restaurants WHERE id=p.restaurant_id;created:=dg_native_dining_now();
 IF action_value<>'recommend' AND body->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN PERFORM dg_native_food_error('VALIDATION_FAILED');END IF;
 IF(SELECT count(*) FROM _dg_native_dining_actions WHERE resource_id=p.id AND kind='food_'||action_value AND created_at>dg_native_people_iso(clock_timestamp()-interval '5 minutes'))>=20 THEN PERFORM dg_native_food_error('RATE_LIMITED');END IF;
 operation_value:=dg_native_dining_action(meta,'food_'||action_value,'party',p.id,body);record_value:=gen_random_uuid()::text;
 IF action_value='draft' THEN
  PERFORM dg_native_restaurant_fields(body,ARRAY['version','preferences','importId','sourceFactIds','confirmed']);PERFORM dg_native_food_fields(body->'preferences');
  IF body->'importId' IS DISTINCT FROM 'null'::jsonb OR body->'sourceFactIds' IS DISTINCT FROM '[]'::jsonb THEN PERFORM dg_native_food_error('MEMORY_IMPORT_REQUIRED');END IF;
  IF p.current_preference_id IS NOT NULL THEN SELECT * INTO old_f FROM dining_preferences WHERE id=p.current_preference_id;IF old_f.status IN('draft','confirmed') THEN PERFORM dg_native_dining_effect(operation_value,'dining_preferences',old_f.id);UPDATE dining_preferences SET status='superseded' WHERE id=old_f.id;END IF;END IF;
  SELECT coalesce(max(revision),0)+1 INTO revision_value FROM dining_preferences WHERE party_id=p.id;expires:=dg_native_people_iso(created::timestamptz+interval '24 hours');
  PERFORM dg_native_dining_effect(operation_value,'dining_preferences',record_value);
  INSERT INTO dining_preferences(id,party_id,revision,payload,status,source,source_fact_ids,source_import_id,session_id,focus_version,actor_id,expires_at,created_at) VALUES(record_value,p.id,revision_value,(body->'preferences')::text,'draft',CASE WHEN meta->>'actorType'='guest' THEN 'guest_manual' ELSE 'staff_confirmation' END,'[]',NULL,meta->>'sessionId',(meta->>'focusVersion')::bigint,meta->>'actorId',expires,created);
  INSERT INTO _dg_native_food_preference_origins VALUES(record_value,p.id,operation_value,(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1),p.access_version,p.version+1,dg_native_office_hash(body->'preferences'),created,expires);
  PERFORM dg_native_dining_effect(operation_value,'dining_parties',p.id);UPDATE dining_parties SET current_preference_id=record_value,version=version+1,updated_at=created WHERE id=p.id;
 ELSIF action_value='confirm' THEN
  PERFORM dg_native_restaurant_fields(body,ARRAY['version','preferenceId','revision','confirmed']);SELECT * INTO f FROM dining_preferences WHERE id=body->>'preferenceId' AND party_id=p.id;SELECT * INTO origin FROM _dg_native_food_preference_origins WHERE preference_id=f.id;
  IF f.id IS NULL OR origin.preference_id IS NULL OR p.current_preference_id<>f.id OR f.status<>'draft' OR f.revision<>dg_native_restaurant_integer(body->'revision',1,9007199254740991) OR f.expires_at<=created OR origin.draft_party_version<>p.version OR origin.party_access_version<>p.access_version THEN PERFORM dg_native_food_error('PREFERENCE_CHANGED');END IF;
  IF meta->>'actorType'='guest' AND(f.session_id IS DISTINCT FROM meta->>'sessionId' OR f.focus_version IS DISTINCT FROM(meta->>'focusVersion')::bigint) THEN PERFORM dg_native_food_error('PREFERENCE_CHANGED');END IF;
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

CREATE FUNCTION dg_native_food_sweep(restaurant_value text DEFAULT NULL) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE r restaurants%ROWTYPE;f dining_preferences%ROWTYPE;p dining_parties%ROWTYPE;meta jsonb;operation_value text;now_value text;changed bigint:=0;
BEGIN
 PERFORM dg_native_reception_runtime(true);
 FOR r IN SELECT current_store.* FROM restaurants current_store JOIN _dg_native_restaurant_origins origin ON origin.restaurant_id=current_store.id WHERE origin.runtime_id=(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1) AND current_store.environment='mock' AND current_store.app_env=(SELECT app_env FROM _dg_native_runtime_control WHERE id=1) AND(restaurant_value IS NULL OR current_store.id=restaurant_value) ORDER BY current_store.id LOOP
  EXIT WHEN changed>=100;
  IF NOT EXISTS(SELECT 1 FROM dining_preferences pref JOIN _dg_native_food_preference_origins origin ON origin.preference_id=pref.id JOIN dining_parties party ON party.id=pref.party_id WHERE party.restaurant_id=r.id AND pref.status<>'expired' AND pref.expires_at<=dg_native_dining_now()) THEN CONTINUE;END IF;
  PERFORM dg_native_reception_workspace(r.tenant_id,r.workspace_id,true);PERFORM id FROM restaurants WHERE id=r.id FOR UPDATE;now_value:=dg_native_dining_now();
  meta:=jsonb_build_object('restaurantId',r.id,'tenantId',r.tenant_id,'workspaceId',r.workspace_id,'actorType','worker','actorId','system:food-expiry','actorEpoch',NULL,'grantVersion',NULL,'sessionId',NULL,'accessId',NULL,'focusVersion',NULL,'selectionVersion',NULL);
  FOR f IN SELECT pref.* FROM dining_preferences pref JOIN _dg_native_food_preference_origins origin ON origin.preference_id=pref.id JOIN dining_parties party ON party.id=pref.party_id WHERE party.restaurant_id=r.id AND pref.status<>'expired' AND pref.expires_at<=now_value ORDER BY pref.expires_at,pref.id LIMIT(100-changed) FOR UPDATE OF pref LOOP
   SELECT * INTO p FROM dining_parties WHERE id=f.party_id FOR UPDATE;operation_value:=dg_native_dining_action(meta,'food_expire','party',p.id,'{}');PERFORM dg_native_dining_effect(operation_value,'dining_preferences',f.id);UPDATE dining_preferences SET status='expired',payload='{}' WHERE id=f.id;
   IF p.current_preference_id=f.id AND p.status IN('waiting','reserved','held','seated') THEN PERFORM dg_native_dining_effect(operation_value,'dining_parties',p.id);UPDATE dining_parties SET version=version+1,updated_at=now_value WHERE id=p.id;END IF;changed:=changed+1;
  END LOOP;
 END LOOP;RETURN changed;
END;$dg$;
CREATE INDEX native_food_expiry ON dining_preferences(expires_at,id) WHERE status<>'expired';

CREATE FUNCTION dg_native_food_recommendation_view(target text,session_value text DEFAULT NULL,token_value text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE row_value dining_recommendations%ROWTYPE;origin _dg_native_food_recommendation_origins%ROWTYPE;operation _dg_native_dining_actions%ROWTYPE;meta jsonb;p dining_parties%ROWTYPE;r restaurants%ROWTYPE;preference_value jsonb;reason text;
BEGIN
 SELECT * INTO origin FROM _dg_native_food_recommendation_origins WHERE recommendation_id=target;SELECT * INTO row_value FROM dining_recommendations WHERE id=origin.recommendation_id;IF origin.recommendation_id IS NULL THEN PERFORM dg_native_food_error('NOT_FOUND');END IF;
 meta:=dg_native_dining_context('party',origin.party_id,session_value,token_value);SELECT * INTO p FROM dining_parties WHERE id=origin.party_id;SELECT * INTO r FROM restaurants WHERE id=p.restaurant_id;SELECT * INTO operation FROM _dg_native_dining_actions WHERE id=origin.action_id;preference_value:=dg_native_food_preference(p.id,meta);
 reason:=CASE WHEN row_value.expires_at<=dg_native_dining_now() THEN '推荐已超过原15分钟，请刷新当前菜单。' WHEN p.status NOT IN('waiting','reserved','held','seated') THEN '本次就餐已结束。' WHEN p.access_version<>origin.party_access_version THEN '本组操作权已变化。' WHEN r.menu_version<>row_value.menu_version THEN '菜单、价格或库存已更新。' WHEN p.version<>row_value.party_version OR p.current_preference_id<>row_value.preference_id OR preference_value->'usable' IS DISTINCT FROM 'true'::jsonb THEN '本次偏好、人数、安排或来源已变化。' WHEN session_value IS NOT NULL AND(operation.session_id IS DISTINCT FROM session_value OR operation.access_id IS DISTINCT FROM meta->>'accessId' OR operation.focus_version IS DISTINCT FROM(meta->>'focusVersion')::bigint OR operation.selection_version IS DISTINCT FROM(meta->>'selectionVersion')::bigint) THEN '当前发问人或就餐问答对象已变化。' END;
 RETURN jsonb_build_object('id',row_value.id,'partyId',p.id,'menuVersion',row_value.menu_version,'partyVersion',row_value.party_version,'preferenceId',row_value.preference_id,'status',CASE WHEN row_value.expires_at<=dg_native_dining_now() THEN 'expired' WHEN reason IS NOT NULL THEN 'stale' ELSE 'current' END,'staleReason',reason,'createdAt',row_value.created_at)||row_value.payload::jsonb;
END;$dg$;

CREATE FUNCTION dg_native_food_result(target text,session_value text DEFAULT NULL,token_value text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE operation _dg_native_dining_actions%ROWTYPE;party_value jsonb;recommendation_value text;
BEGIN
 SELECT * INTO operation FROM _dg_native_dining_actions WHERE id=target;IF operation.id IS NULL OR operation.kind NOT IN('food_draft','food_confirm','food_recommend') THEN PERFORM dg_native_food_error('NOT_FOUND');END IF;
 -- The existing result guard rechecks the original actor/epoch/grant, access,
 -- current person and selection before any cached resource can be returned.
 party_value:=dg_native_dining_action_result(target,session_value,token_value);
 IF operation.kind<>'food_recommend' THEN RETURN party_value;END IF;
 SELECT recommendation_id INTO recommendation_value FROM _dg_native_food_recommendation_origins WHERE action_id=operation.id;RETURN dg_native_food_recommendation_view(recommendation_value,session_value,token_value);
END;$dg$;
