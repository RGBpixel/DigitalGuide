-- Native meal facts and immutable recommendation inputs; no external orders.
CREATE TABLE _dg_native_food_preference_origins(
 preference_id text PRIMARY KEY REFERENCES dining_preferences(id),party_id text NOT NULL REFERENCES dining_parties(id),
 action_id text NOT NULL UNIQUE REFERENCES _dg_native_dining_actions(id),runtime_id text NOT NULL,
 party_access_version bigint NOT NULL,draft_party_version bigint NOT NULL,payload_hash text NOT NULL,
 created_at text NOT NULL,expires_at text NOT NULL
);
CREATE TABLE _dg_native_food_confirmations(
 preference_id text PRIMARY KEY REFERENCES dining_preferences(id),action_id text NOT NULL UNIQUE REFERENCES _dg_native_dining_actions(id),
 party_version bigint NOT NULL,party_access_version bigint NOT NULL,owner_session_id text REFERENCES reception_sessions(id),
 owner_focus_version bigint,owner_selection_version bigint,actor_type text NOT NULL CHECK(actor_type IN('staff','guest')),created_at text NOT NULL
);
CREATE TABLE _dg_native_food_recommendation_origins(
 recommendation_id text PRIMARY KEY REFERENCES dining_recommendations(id),party_id text NOT NULL REFERENCES dining_parties(id),
 action_id text NOT NULL UNIQUE REFERENCES _dg_native_dining_actions(id),party_access_version bigint NOT NULL,payload_hash text NOT NULL,
 created_at text NOT NULL,expires_at text NOT NULL
);
CREATE TRIGGER native_food_preference_origin_immutable BEFORE UPDATE OR DELETE ON _dg_native_food_preference_origins FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_food_confirmation_immutable BEFORE UPDATE OR DELETE ON _dg_native_food_confirmations FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_food_recommendation_origin_immutable BEFORE UPDATE OR DELETE ON _dg_native_food_recommendation_origins FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();

CREATE FUNCTION dg_native_food_error(code_value text) RETURNS void LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='DGFOOD:'||code_value;END;$dg$;

CREATE FUNCTION dg_native_food_fields(input jsonb) RETURNS void LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE key_value text;item jsonb;mode_value text;
BEGIN
 PERFORM dg_native_restaurant_fields(input,ARRAY['likes','avoids','allergens','allergyMode','maxSpice','budgetPerDishMinor','note']);
 FOREACH key_value IN ARRAY ARRAY['likes','avoids','allergens'] LOOP
  IF jsonb_typeof(input->key_value) IS DISTINCT FROM 'array' OR jsonb_array_length(input->key_value)>20 THEN PERFORM dg_native_food_error('VALIDATION_FAILED');END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(input->key_value) LOOP PERFORM dg_native_restaurant_text(item,1,40);END LOOP;
 END LOOP;
 mode_value:=input->>'allergyMode';IF mode_value IS NULL OR mode_value NOT IN('not_provided','none_declared','specified') OR(mode_value='specified')<>(jsonb_array_length(input->'allergens')>0) THEN PERFORM dg_native_food_error('VALIDATION_FAILED');END IF;
 IF input->'maxSpice' IS DISTINCT FROM 'null'::jsonb THEN PERFORM dg_native_restaurant_integer(input->'maxSpice',0,3);END IF;
 IF input->'budgetPerDishMinor' IS DISTINCT FROM 'null'::jsonb THEN PERFORM dg_native_restaurant_integer(input->'budgetPerDishMinor',0,10000000);END IF;
 PERFORM dg_native_restaurant_text(input->'note',0,300);
END;$dg$;

CREATE FUNCTION dg_native_food_context(target text,input jsonb,session_value text,token_value text,csrf_value text,focus_value bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;p dining_parties%ROWTYPE;
BEGIN
 meta:=dg_native_dining_context('party',target,session_value,token_value,csrf_value,focus_value,true);p:=dg_native_dining_owned(meta,target);
 IF p.status NOT IN('waiting','reserved','held','seated') THEN PERFORM dg_native_food_error('PARTY_ENDED');END IF;
 IF dg_native_restaurant_integer(input->'version',1,9007199254740991)<>p.version THEN PERFORM dg_native_food_error('VERSION_CONFLICT');END IF;
 IF session_value IS NOT NULL THEN
  IF dg_native_restaurant_integer(input->'selectionVersion',0,9007199254740991)<>(meta->>'selectionVersion')::bigint OR NOT EXISTS(SELECT 1 FROM reception_sessions WHERE id=session_value AND dining_party_id=p.id) THEN PERFORM dg_native_food_error('VERSION_CONFLICT');END IF;
 END IF;RETURN meta;
END;$dg$;

CREATE FUNCTION dg_native_food_preference(target text,meta jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE p dining_parties%ROWTYPE;f dining_preferences%ROWTYPE;o _dg_native_food_preference_origins%ROWTYPE;c _dg_native_food_confirmations%ROWTYPE;s reception_sessions%ROWTYPE;reason text;payload_value jsonb;current_selection bigint;
BEGIN
 SELECT * INTO p FROM dining_parties WHERE id=target;IF p.current_preference_id IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO f FROM dining_preferences WHERE id=p.current_preference_id AND party_id=p.id;SELECT * INTO o FROM _dg_native_food_preference_origins WHERE preference_id=f.id;IF o.preference_id IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO c FROM _dg_native_food_confirmations WHERE preference_id=f.id;
 reason:=CASE WHEN f.expires_at<=dg_native_dining_now() OR f.status='expired' THEN '本次偏好已到期，请重新保存和核对。' WHEN f.status<>'confirmed' OR c.preference_id IS NULL THEN '本次偏好尚未明确确认。' WHEN p.status NOT IN('waiting','reserved','held','seated') THEN '本次就餐已结束。' WHEN p.version<>c.party_version OR p.access_version<>c.party_access_version OR p.owner_session_id IS DISTINCT FROM c.owner_session_id THEN '本组安排或操作权已变化，请重新核对本次偏好。' END;
 IF reason IS NULL AND(c.actor_type='guest' OR meta->>'actorType'='guest') THEN
  SELECT * INTO s FROM reception_sessions WHERE id=p.owner_session_id;SELECT coalesce(max(version),0) INTO current_selection FROM _dg_native_dining_selection_revisions WHERE session_id=s.id;
  IF s.id IS NULL OR s.status<>'active' OR s.expires_at<=dg_native_dining_now() OR s.focus_version IS DISTINCT FROM c.owner_focus_version OR current_selection IS DISTINCT FROM c.owner_selection_version OR s.dining_party_id IS DISTINCT FROM p.id THEN reason:='当前发问人或就餐问答对象已变化，请重新保存和确认。';END IF;
 END IF;
 payload_value:=CASE WHEN f.status='expired' OR f.expires_at<=dg_native_dining_now() THEN jsonb_build_object('likes','[]'::jsonb,'avoids','[]'::jsonb,'allergens','[]'::jsonb,'allergyMode','not_provided','maxSpice',NULL,'budgetPerDishMinor',NULL,'note','') ELSE f.payload::jsonb END;
 RETURN jsonb_build_object('id',f.id,'revision',f.revision,'preferences',payload_value,'status',CASE WHEN f.expires_at<=dg_native_dining_now() THEN 'expired' ELSE f.status END,'source',f.source,'confirmedAt',f.confirmed_at,'expiresAt',f.expires_at,'sourceFactIds',f.source_fact_ids::jsonb,'usable',reason IS NULL,'reason',reason);
END;$dg$;

CREATE FUNCTION dg_native_food_party_projection(target text,credential_value boolean,meta jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN RETURN dg_native_dining_party_projection(target,credential_value)||jsonb_build_object('preference',dg_native_food_preference(target,meta));END;$dg$;

CREATE FUNCTION dg_native_food_matches(registered jsonb,wanted jsonb) RETURNS boolean LANGUAGE sql SET search_path FROM CURRENT AS $dg$
 SELECT EXISTS(SELECT 1 FROM jsonb_array_elements_text(registered) a(value) CROSS JOIN jsonb_array_elements_text(wanted) b(value) WHERE strpos(lower(btrim(normalize(a.value,NFKC))),lower(btrim(normalize(b.value,NFKC))))>0 OR strpos(lower(btrim(normalize(b.value,NFKC))),lower(btrim(normalize(a.value,NFKC))))>0)
$dg$;

CREATE FUNCTION dg_native_food_candidates(menu jsonb,preferences jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE item jsonb;sku jsonb;ingredients jsonb;available jsonb;affordable jsonb;why jsonb;candidates jsonb:='[]';excluded jsonb:='[]';reasons jsonb;liked boolean;result_value jsonb;
BEGIN
 PERFORM dg_native_food_fields(preferences);
 FOR item IN SELECT * FROM jsonb_array_elements(menu->'items') LOOP
  reasons:='[]';ingredients:=(item->'ingredientTags')||(item->'allergenTags')||(item->'mayContainTags');
  SELECT coalesce(jsonb_agg(value),'[]') INTO available FROM jsonb_array_elements(item->'skus') WHERE value->'available'='true'::jsonb;
  IF item->'listed' IS DISTINCT FROM 'true'::jsonb OR jsonb_array_length(available)=0 THEN reasons:=reasons||jsonb_build_array('当前未上架或规格已售罄');END IF;
  IF dg_native_food_matches(ingredients,preferences->'avoids') THEN reasons:=reasons||jsonb_build_array('与本次明确忌口信息冲突');END IF;
  IF preferences->>'allergyMode'='specified' AND(item->'allergenInfoComplete' IS DISTINCT FROM 'true'::jsonb OR dg_native_food_matches(ingredients,preferences->'allergens')) THEN reasons:=reasons||jsonb_build_array(CASE WHEN item->'allergenInfoComplete'='true'::jsonb THEN '含本次需避开或可能接触的成分' ELSE '配料/共用厨房信息尚未核对' END);END IF;
  IF preferences->'maxSpice'<>'null'::jsonb AND(item->>'spiceLevel')::integer>(preferences->>'maxSpice')::integer THEN reasons:=reasons||jsonb_build_array('超过本次可接受辣度');END IF;
  SELECT coalesce(jsonb_agg(value),'[]') INTO affordable FROM jsonb_array_elements(available) WHERE preferences->'budgetPerDishMinor'='null'::jsonb OR(value->>'priceMinor')::bigint<=(preferences->>'budgetPerDishMinor')::bigint;
  IF jsonb_array_length(available)>0 AND jsonb_array_length(affordable)=0 THEN reasons:=reasons||jsonb_build_array('超过本次单道菜预算');END IF;
  IF jsonb_array_length(reasons)>0 THEN excluded:=excluded||jsonb_build_array(jsonb_build_object('itemId',item->>'id','name',item->>'name','reasons',reasons));CONTINUE;END IF;
  FOR sku IN SELECT * FROM jsonb_array_elements(affordable) LOOP
   liked:=dg_native_food_matches((item->'flavorTags')||(item->'ingredientTags')||jsonb_build_array(item->>'name'),preferences->'likes');why:='[]';
   IF liked THEN why:=why||jsonb_build_array('符合本次确认的口味');END IF;IF item->'isNew'='true'::jsonb THEN why:=why||jsonb_build_array('当前新菜');END IF;
   IF preferences->'maxSpice'<>'null'::jsonb THEN why:=why||jsonb_build_array('辣度在本次范围内');END IF;IF preferences->'budgetPerDishMinor'<>'null'::jsonb THEN why:=why||jsonb_build_array('单道菜价格在本次预算内');END IF;IF jsonb_array_length(why)=0 THEN why:=jsonb_build_array('当前菜单可供选择');END IF;
   candidates:=candidates||jsonb_build_array(jsonb_build_object('skuId',sku->>'id','itemId',item->>'id','name',item->>'name','skuName',sku->>'name','priceMinor',(sku->>'priceMinor')::bigint,'currency','CNY','isNew',item->'isNew','reasons',why,'cautions',(CASE WHEN preferences->>'allergyMode'='not_provided' THEN jsonb_build_array('本次未提供过敏信息') ELSE '[]'::jsonb END)||jsonb_build_array('筛选依据菜单登记信息，需避开成分时请让店员再次核对'),'score',(CASE WHEN liked THEN 100 ELSE 0 END)+(CASE WHEN item->'isNew'='true'::jsonb THEN 20 ELSE 0 END)));
  END LOOP;
 END LOOP;
 SELECT coalesce(jsonb_agg(value-'score' ORDER BY(value->>'score')::integer DESC,(value->>'priceMinor')::bigint,value->>'skuId'),'[]') INTO result_value FROM(SELECT value FROM jsonb_array_elements(candidates) ORDER BY(value->>'score')::integer DESC,(value->>'priceMinor')::bigint,value->>'skuId' LIMIT 6) chosen;
 RETURN jsonb_build_object('items',result_value,'excluded',excluded,'notice','仅依据本次已确认偏好和当前本地菜单/库存给出候选，不会自动下单；单道菜预算不代表整单总额。');
END;$dg$;


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


CREATE FUNCTION dg_native_food_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j jsonb:=to_jsonb(NEW);previous jsonb:=to_jsonb(OLD);p dining_parties%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' OR NOT dg_native_dining_changed(TG_TABLE_NAME,j->>'id') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Food records require their scoped native operation';END IF;
 SELECT * INTO p FROM dining_parties WHERE id=j->>'party_id';IF p.id IS NULL OR NOT EXISTS(SELECT 1 FROM _dg_native_dining_party_origins WHERE party_id=p.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Food records retain their native party';END IF;
 IF NOT EXISTS(SELECT 1 FROM _dg_native_dining_changes changed JOIN _dg_native_dining_actions action ON action.id=changed.action_id WHERE changed.table_name=TG_TABLE_NAME AND changed.resource_id=j->>'id' AND changed.transaction_id=pg_current_xact_id()::text AND action.transaction_id=changed.transaction_id AND action.resource_id=p.id AND action.restaurant_id=p.restaurant_id AND action.kind IN('food_draft','food_confirm','food_recommend','food_expire')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Food effects cannot borrow unrelated actions';END IF;
 IF TG_TABLE_NAME='dining_preferences' THEN
  IF j->>'status' NOT IN('draft','confirmed','superseded','expired') OR j->>'source' NOT IN('guest_manual','staff_confirmation') OR j->>'source_fact_ids'<>'[]' OR j->>'source_import_id' IS NOT NULL OR j->>'expires_at'<=j->>'created_at' OR(j->>'expires_at')::timestamptz>(j->>'created_at')::timestamptz+interval '24 hours' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Preference source and original deadline are bounded';END IF;
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
CREATE TRIGGER native_food_preference_guard BEFORE INSERT OR UPDATE OR DELETE ON dining_preferences FOR EACH ROW EXECUTE FUNCTION dg_native_food_guard();
CREATE TRIGGER native_food_recommendation_guard BEFORE INSERT OR UPDATE OR DELETE ON dining_recommendations FOR EACH ROW EXECUTE FUNCTION dg_native_food_guard();

CREATE FUNCTION dg_native_food_final() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j jsonb:=to_jsonb(NEW);p dining_parties%ROWTYPE;f dining_preferences%ROWTYPE;rec dining_recommendations%ROWTYPE;o _dg_native_food_preference_origins%ROWTYPE;c _dg_native_food_confirmations%ROWTYPE;ro _dg_native_food_recommendation_origins%ROWTYPE;a _dg_native_dining_actions%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='dining_parties' THEN
  SELECT * INTO p FROM dining_parties WHERE id=j->>'id';IF p.current_preference_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM _dg_native_food_preference_origins origin JOIN dining_preferences pref ON pref.id=origin.preference_id WHERE pref.id=p.current_preference_id AND origin.party_id=p.id AND pref.party_id=p.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Current preference pointer belongs to the same native party';END IF;RETURN NULL;
 ELSIF TG_TABLE_NAME IN('dining_preferences','_dg_native_food_preference_origins','_dg_native_food_confirmations') THEN
  SELECT * INTO f FROM dining_preferences WHERE id=CASE WHEN TG_TABLE_NAME='dining_preferences' THEN j->>'id' ELSE j->>'preference_id' END;SELECT * INTO o FROM _dg_native_food_preference_origins WHERE preference_id=f.id;SELECT * INTO p FROM dining_parties WHERE id=f.party_id;SELECT * INTO a FROM _dg_native_dining_actions WHERE id=o.action_id;
  IF f.id IS NULL OR o.preference_id IS NULL OR o.runtime_id IS DISTINCT FROM(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1) OR o.party_id<>f.party_id OR a.kind<>'food_draft' OR a.resource_id<>p.id OR a.restaurant_id<>p.restaurant_id OR o.created_at<>f.created_at OR o.expires_at<>f.expires_at OR f.status<>'expired' AND o.payload_hash<>dg_native_office_hash(f.payload::jsonb) OR f.session_id IS DISTINCT FROM a.session_id OR f.focus_version IS DISTINCT FROM a.focus_version OR f.actor_id<>a.actor_id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Preference keeps its actual draft action, scope, source payload and original clock';END IF;
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
CREATE CONSTRAINT TRIGGER native_food_party_pointer_final AFTER INSERT OR UPDATE ON dining_parties DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_food_final();
CREATE CONSTRAINT TRIGGER native_food_preference_final AFTER INSERT OR UPDATE ON dining_preferences DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_food_final();
CREATE CONSTRAINT TRIGGER native_food_preference_origin_final AFTER INSERT ON _dg_native_food_preference_origins DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_food_final();
CREATE CONSTRAINT TRIGGER native_food_confirmation_final AFTER INSERT ON _dg_native_food_confirmations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_food_final();
CREATE CONSTRAINT TRIGGER native_food_recommendation_final AFTER INSERT ON dining_recommendations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_food_final();
CREATE CONSTRAINT TRIGGER native_food_recommendation_origin_final AFTER INSERT ON _dg_native_food_recommendation_origins DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_food_final();


CREATE OR REPLACE FUNCTION dg_native_dining_row_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j jsonb:=to_jsonb(NEW);previous jsonb:=to_jsonb(OLD);r restaurants%ROWTYPE;party_current dining_parties%ROWTYPE;party_previous dining_parties%ROWTYPE;booking_current dining_reservations%ROWTYPE;booking_previous dining_reservations%ROWTYPE;occupancy_current dining_occupancies%ROWTYPE;occupancy_previous dining_occupancies%ROWTYPE;plan_current dining_hold_plans%ROWTYPE;plan_previous dining_hold_plans%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' OR NOT dg_native_dining_changed(TG_TABLE_NAME,j->>'id') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Dining facts require a scoped durable operation in their original transaction';END IF;
 SELECT * INTO r FROM restaurants WHERE id=j->>'restaurant_id';IF r.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Dining facts require their restaurant';END IF;
 IF TG_OP='UPDATE' THEN
  IF j->>'id' IS DISTINCT FROM previous->>'id' OR j->>'restaurant_id' IS DISTINCT FROM previous->>'restaurant_id' OR(j->>'version')::bigint<>(previous->>'version')::bigint+1 OR j->>'created_at' IS DISTINCT FROM previous->>'created_at' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Dining identity, original creation and monotonic versions are immutable';END IF;
 ELSE IF coalesce((j->>'version')::bigint,1)<>1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Dining records start at version one';END IF;END IF;
 IF TG_TABLE_NAME='dining_parties' THEN
party_current:=jsonb_populate_record(NULL::dining_parties,j);party_previous:=jsonb_populate_record(NULL::dining_parties,previous);
  IF party_current.status NOT IN('waiting','reserved','held','seated','cancelled','completed','no_show') OR party_current.size NOT BETWEEN 1 AND 40 OR party_current.visit_minutes NOT BETWEEN 15 AND 240 OR char_length(btrim(party_current.name)) NOT BETWEEN 1 AND 60 OR char_length(party_current.guest_note)>300 OR party_current.claim_hash!~'^[a-f0-9]{64}$' OR party_current.claim_nonce!~'^[a-f0-9-]{36}$' OR party_current.access_version<1 OR party_current.version<1 OR party_current.claim_expires_at<=party_current.created_at OR(party_current.status IN('cancelled','completed','no_show'))<>(party_current.ended_at IS NOT NULL) OR(party_current.status='reserved')<>(party_current.queue_number IS NULL) AND party_current.status NOT IN('cancelled','completed','no_show') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Dining party fields, consent credential and state are bounded';END IF;
  IF TG_OP='INSERT' THEN IF party_current.status NOT IN('waiting','reserved') OR party_current.access_version<>1 OR party_current.seated_at IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='New dining parties are unseated';END IF;
  ELSE
   IF party_previous.status IN('cancelled','completed','no_show') OR party_current.actor_id<>party_previous.actor_id OR party_current.access_version NOT BETWEEN party_previous.access_version AND party_previous.access_version+1 OR(party_current.claim_nonce<>party_previous.claim_nonce OR party_current.claim_hash<>party_previous.claim_hash OR party_current.owner_session_id IS DISTINCT FROM party_previous.owner_session_id) AND party_current.access_version<>party_previous.access_version+1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Dining ownership and credentials cannot be rewritten without revocation';END IF;
   IF party_current.status<>party_previous.status AND NOT(party_previous.status='reserved' AND party_current.status IN('waiting','cancelled','no_show') OR party_previous.status='waiting' AND party_current.status IN('held','cancelled') OR party_previous.status='held' AND party_current.status IN('waiting','seated','cancelled') OR party_previous.status='seated' AND party_current.status='completed') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Unsupported dining party state transition';END IF;
  END IF;
 ELSIF TG_TABLE_NAME='dining_reservations' THEN
booking_current:=jsonb_populate_record(NULL::dining_reservations,j);booking_previous:=jsonb_populate_record(NULL::dining_reservations,previous);
  IF booking_current.status NOT IN('confirmed','checked_in','seated','cancelled','no_show','completed','expired') OR booking_current.ends_at<=booking_current.starts_at OR booking_current.ends_at::timestamptz-booking_current.starts_at::timestamptz>interval '4 hours' OR NOT EXISTS(SELECT 1 FROM restaurant_tables WHERE id=booking_current.table_id AND restaurant_id=booking_current.restaurant_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Dining reservation table and bounded interval are guarded';END IF;
  IF TG_OP='INSERT' THEN IF booking_current.status<>'confirmed' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='New reservations start confirmed';END IF;
  ELSE
   IF booking_current.party_id<>booking_previous.party_id OR booking_current.reference<>booking_previous.reference OR booking_previous.status IN('cancelled','no_show','completed','expired') OR booking_current.status<>booking_previous.status AND NOT(booking_previous.status='confirmed' AND booking_current.status IN('checked_in','cancelled','no_show') OR booking_previous.status='checked_in' AND booking_current.status IN('seated','cancelled','expired') OR booking_previous.status='seated' AND booking_current.status='completed') OR booking_previous.status<>'confirmed' AND(booking_current.table_id<>booking_previous.table_id OR booking_current.starts_at<>booking_previous.starts_at OR booking_current.ends_at<>booking_previous.ends_at) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Reservation identity, finalized times and state are guarded';END IF;
  END IF;
 ELSIF TG_TABLE_NAME='dining_occupancies' THEN
occupancy_current:=jsonb_populate_record(NULL::dining_occupancies,j);occupancy_previous:=jsonb_populate_record(NULL::dining_occupancies,previous);
  IF occupancy_current.state NOT IN('held','seated','released','expired') OR occupancy_current.state='held' AND(occupancy_current.expires_at IS NULL OR occupancy_current.expires_at>occupancy_current.expected_end_at OR occupancy_current.expires_at>dg_native_people_iso(occupancy_current.created_at::timestamptz+make_interval(secs=>r.hold_seconds::double precision))) OR occupancy_current.state='seated' AND occupancy_current.expires_at IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Occupancies keep a bounded original hold and explicit actual seating';END IF;
  IF TG_OP='INSERT' THEN IF occupancy_current.state<>'held' OR occupancy_current.expires_at<=occupancy_current.created_at THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Occupancies start with a future bounded hold';END IF;
  ELSE
   IF occupancy_current.party_id<>occupancy_previous.party_id OR occupancy_current.table_id<>occupancy_previous.table_id OR occupancy_current.actor_id<>occupancy_previous.actor_id OR occupancy_current.expected_end_at<>occupancy_previous.expected_end_at OR occupancy_previous.state IN('released','expired') OR occupancy_current.state=occupancy_previous.state OR NOT(occupancy_previous.state='held' AND occupancy_current.state IN('seated','released','expired') OR occupancy_previous.state='seated' AND occupancy_current.state='released') OR occupancy_current.expires_at IS DISTINCT FROM occupancy_previous.expires_at AND NOT(occupancy_previous.state='held' AND occupancy_current.state='seated' AND occupancy_current.expires_at IS NULL) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Occupancy identity, original clocks and finite transitions are guarded';END IF;
  END IF;
 ELSIF TG_TABLE_NAME='dining_hold_plans' THEN
plan_current:=jsonb_populate_record(NULL::dining_hold_plans,j);plan_previous:=jsonb_populate_record(NULL::dining_hold_plans,previous);
  IF TG_OP<>'INSERT' OR plan_current.hash!~'^[a-f0-9]{64}$' OR plan_current.expires_at<=plan_current.created_at OR plan_current.expires_at>dg_native_people_iso(plan_current.created_at::timestamptz+interval '30 seconds') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Table plans retain the original bounded thirty-second deadline';END IF;
 END IF;RETURN NEW;
END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_dining_party_view(target text,session_value text DEFAULT NULL,token_hash_value text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;p dining_parties%ROWTYPE;
BEGIN meta:=dg_native_dining_context('party',target,session_value,token_hash_value);SELECT * INTO p FROM dining_parties WHERE id=target;RETURN dg_native_food_party_projection(target,session_value IS NOT NULL OR p.owner_session_id IS NULL,meta);END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_dining_parties(target text,kind_value text,cursor_value text,limit_value integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;result jsonb:='[]';row_value record;cursor_sort text;
BEGIN
 meta:=dg_native_dining_context('restaurant',target);IF kind_value NOT IN('queue','reservations','history') OR limit_value NOT BETWEEN 1 AND 101 THEN PERFORM dg_native_dining_error('VALIDATION_FAILED');END IF;
 IF cursor_value<>'' THEN
  SELECT CASE WHEN kind_value='queue' THEN lpad(p.queue_number::text,20,'0') WHEN kind_value='reservations' THEN b.starts_at ELSE p.ended_at END INTO cursor_sort FROM dining_parties p LEFT JOIN dining_reservations b ON b.party_id=p.id WHERE p.id=cursor_value AND p.restaurant_id=target AND(CASE kind_value WHEN 'queue' THEN p.status IN('waiting','held','seated') WHEN 'reservations' THEN b.status IN('confirmed','checked_in','seated') AND p.status IN('reserved','waiting','held','seated') ELSE p.status IN('cancelled','completed','no_show') END);
  IF cursor_sort IS NULL THEN PERFORM dg_native_dining_error('CURSOR_CHANGED');END IF;
 END IF;
 FOR row_value IN SELECT * FROM(SELECT p.id,CASE WHEN kind_value='queue' THEN lpad(p.queue_number::text,20,'0') WHEN kind_value='reservations' THEN b.starts_at ELSE p.ended_at END sort FROM dining_parties p JOIN _dg_native_dining_party_origins origin ON origin.party_id=p.id LEFT JOIN dining_reservations b ON b.party_id=p.id WHERE p.restaurant_id=target AND(CASE kind_value WHEN 'queue' THEN p.status IN('waiting','held','seated') WHEN 'reservations' THEN b.status IN('confirmed','checked_in','seated') AND p.status IN('reserved','waiting','held','seated') ELSE p.status IN('cancelled','completed','no_show') END)) selected WHERE cursor_value='' OR selected.sort>cursor_sort OR selected.sort=cursor_sort AND selected.id>cursor_value ORDER BY selected.sort,selected.id LIMIT limit_value LOOP result:=result||jsonb_build_array(dg_native_food_party_projection(row_value.id,false,meta));END LOOP;RETURN result;
END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_dining_guest_view(target text,token_hash_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;s reception_sessions%ROWTYPE;r restaurants%ROWTYPE;parties_value jsonb;restaurant_value jsonb;
BEGIN
 meta:=dg_native_dining_context('restaurant',(SELECT restaurant_id FROM _dg_native_dining_session_origins WHERE session_id=target),target,token_hash_value);SELECT * INTO s FROM reception_sessions WHERE id=target;SELECT * INTO r FROM restaurants WHERE id=meta->>'restaurantId';
 SELECT coalesce(jsonb_agg(dg_native_food_party_projection(p.id,true,meta) ORDER BY p.created_at,p.id),'[]') INTO parties_value FROM dining_parties p JOIN _dg_native_dining_party_origins origin ON origin.party_id=p.id WHERE p.owner_session_id=target AND p.restaurant_id=r.id;
 restaurant_value:=jsonb_build_object('id',r.id,'name',r.name,'timezone',r.timezone,'publicGuide',r.public_guide,'holdSeconds',r.hold_seconds,'visitMinutes',r.visit_minutes,'lateMinutes',r.late_minutes,'acceptingGuests',r.accepting_guests=1,'openingWindows',r.opening_windows::jsonb,'version',r.version,'menuVersion',r.menu_version,'dataSource','local','businessConnected',false,'capabilities',jsonb_build_object('seating',true,'ordering',false,'payments',false,'hospitality',false,'terminals',true,'sourceDirectory',true,'preferences',false));
 RETURN jsonb_build_object('restaurant',restaurant_value,'parties',parties_value,'menu',dg_native_dining_menu_projection(r.id),'selectedPartyId',CASE WHEN EXISTS(SELECT 1 FROM dining_parties p WHERE p.id=s.dining_party_id AND p.owner_session_id=s.id) THEN s.dining_party_id END,'focusVersion',s.focus_version,'selectionVersion',(meta->>'selectionVersion')::bigint,'automatic',s.status='active');
END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_dining_action_result(target text,session_value text DEFAULT NULL,token_hash_value text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE a _dg_native_dining_actions%ROWTYPE;meta jsonb;p dining_parties%ROWTYPE;
BEGIN
 SELECT * INTO a FROM _dg_native_dining_actions WHERE id=target;IF a.id IS NULL OR a.actor_type='worker' THEN PERFORM dg_native_dining_error('NOT_FOUND');END IF;
 meta:=dg_native_dining_context(CASE WHEN a.resource_type='plan' THEN 'plan' ELSE 'party' END,a.resource_id,session_value,token_hash_value);
 IF a.actor_id IS DISTINCT FROM meta->>'actorId' OR a.actor_type IS DISTINCT FROM meta->>'actorType' OR a.session_id IS DISTINCT FROM meta->>'sessionId' OR a.access_id IS DISTINCT FROM meta->>'accessId' OR a.actor_epoch IS DISTINCT FROM(meta->>'actorEpoch')::bigint OR a.grant_version IS DISTINCT FROM(meta->>'grantVersion')::bigint OR a.focus_version IS DISTINCT FROM(meta->>'focusVersion')::bigint OR a.selection_version IS DISTINCT FROM(meta->>'selectionVersion')::bigint THEN PERFORM dg_native_dining_error('AUTHORIZATION_CHANGED');END IF;
 IF a.resource_type='plan' THEN RETURN dg_native_dining_plan_projection(a.resource_id,meta);END IF;
 SELECT * INTO p FROM dining_parties WHERE id=a.resource_id;RETURN dg_native_food_party_projection(p.id,session_value IS NOT NULL OR p.owner_session_id IS NULL,meta);
END;$dg$;


DO $food_acl$ DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND p.proname LIKE 'dg_native_food_%' LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||f.signature||' FROM PUBLIC';END LOOP;END;$food_acl$;
