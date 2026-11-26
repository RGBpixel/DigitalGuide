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
