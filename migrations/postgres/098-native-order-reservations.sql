-- Native local/mock order drafts, bounded quotes and atomic unsent inventory.

CREATE TABLE _dg_native_order_origins(order_id text PRIMARY KEY REFERENCES restaurant_orders(id),party_id text NOT NULL REFERENCES dining_parties(id),runtime_id text NOT NULL,action_id text NOT NULL UNIQUE REFERENCES _dg_native_dining_actions(id),created_at text NOT NULL);
CREATE TABLE _dg_native_order_change_origins(change_id text PRIMARY KEY REFERENCES restaurant_order_changes(id),order_id text NOT NULL REFERENCES restaurant_orders(id),party_id text NOT NULL REFERENCES dining_parties(id),runtime_id text NOT NULL,action_id text NOT NULL UNIQUE REFERENCES _dg_native_dining_actions(id),created_at text NOT NULL);
CREATE TABLE _dg_native_order_quote_origins(quote_id text PRIMARY KEY REFERENCES restaurant_order_quotes(id),action_id text NOT NULL UNIQUE REFERENCES _dg_native_dining_actions(id),runtime_id text NOT NULL,actor_meta jsonb NOT NULL,confirmation_hash text NOT NULL CHECK(confirmation_hash ~ '^[a-f0-9]{64}$'),payload_hash text NOT NULL,created_at text NOT NULL,expires_at text NOT NULL);
CREATE TABLE _dg_native_order_results(action_id text PRIMARY KEY REFERENCES _dg_native_dining_actions(id),restaurant_id text NOT NULL REFERENCES restaurants(id),order_id text REFERENCES restaurant_orders(id),change_id text REFERENCES restaurant_order_changes(id),quote_id text REFERENCES restaurant_order_quotes(id),party_access_version bigint,created_at text NOT NULL);
CREATE TABLE _dg_native_order_pos_revisions(restaurant_id text NOT NULL REFERENCES restaurants(id),version bigint NOT NULL,action_id text NOT NULL UNIQUE REFERENCES _dg_native_dining_actions(id),provider_id text NOT NULL,enabled bigint NOT NULL,scenario text NOT NULL,created_at text NOT NULL,PRIMARY KEY(restaurant_id,version));
CREATE TABLE _dg_native_order_dispatch_origins(change_id text PRIMARY KEY REFERENCES restaurant_order_dispatches(change_id),action_id text NOT NULL UNIQUE REFERENCES _dg_native_dining_actions(id),quote_id text NOT NULL REFERENCES restaurant_order_quotes(id),runtime_id text NOT NULL,request_hash text NOT NULL,created_at text NOT NULL);
CREATE TABLE _dg_native_order_reservation_origins(reservation_id text PRIMARY KEY REFERENCES restaurant_inventory_reservations(id),change_id text NOT NULL REFERENCES restaurant_order_changes(id),action_id text NOT NULL REFERENCES _dg_native_dining_actions(id),runtime_id text NOT NULL,created_at text NOT NULL);
CREATE TABLE _dg_native_order_change_revisions(change_id text NOT NULL REFERENCES restaurant_order_changes(id),version bigint NOT NULL,action_id text NOT NULL REFERENCES _dg_native_dining_actions(id),row_hash text NOT NULL,created_at text NOT NULL,PRIMARY KEY(change_id,version));
CREATE TRIGGER native_order_origin_immutable BEFORE UPDATE OR DELETE ON _dg_native_order_origins FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_order_change_origin_immutable BEFORE UPDATE OR DELETE ON _dg_native_order_change_origins FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_order_quote_origin_immutable BEFORE UPDATE OR DELETE ON _dg_native_order_quote_origins FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_order_result_immutable BEFORE UPDATE OR DELETE ON _dg_native_order_results FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_order_pos_revision_immutable BEFORE UPDATE OR DELETE ON _dg_native_order_pos_revisions FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_order_dispatch_origin_immutable BEFORE UPDATE OR DELETE ON _dg_native_order_dispatch_origins FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_order_reservation_origin_immutable BEFORE UPDATE OR DELETE ON _dg_native_order_reservation_origins FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_order_change_revision_immutable BEFORE UPDATE OR DELETE ON _dg_native_order_change_revisions FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE UNIQUE INDEX native_order_one_open_party ON restaurant_orders(party_id) WHERE status NOT IN('closed','cancelled');

CREATE FUNCTION dg_native_order_error(code_value text) RETURNS void LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='DGORDER:'||code_value;END;$dg$;

CREATE FUNCTION dg_native_order_context(kind_value text,target text,session_value text DEFAULT NULL,token_value text DEFAULT NULL,csrf_value text DEFAULT NULL,focus_value bigint DEFAULT NULL,write_value boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE party_value text;order_value text;change_value text;meta jsonb;p dining_parties%ROWTYPE;o restaurant_orders%ROWTYPE;
BEGIN
 IF kind_value='restaurant' THEN RETURN dg_native_dining_context('restaurant',target,session_value,token_value,csrf_value,focus_value,write_value);END IF;
 IF kind_value='party' THEN party_value:=target;
 ELSIF kind_value='order' THEN SELECT origin.party_id,origin.order_id INTO party_value,order_value FROM _dg_native_order_origins origin WHERE origin.order_id=target;
 ELSIF kind_value='change' THEN SELECT origin.party_id,origin.order_id,origin.change_id INTO party_value,order_value,change_value FROM _dg_native_order_change_origins origin WHERE origin.change_id=target;
 ELSE PERFORM dg_native_order_error('VALIDATION_FAILED');END IF;
 IF party_value IS NULL THEN PERFORM dg_native_order_error('NOT_FOUND');END IF;
 meta:=dg_native_dining_context('party',party_value,session_value,token_value,csrf_value,focus_value,write_value);
 IF write_value THEN
  SELECT * INTO p FROM dining_parties WHERE id=party_value FOR UPDATE;
  -- Recheck the actual clock and grant after any workspace, store or party wait.
  meta:=dg_native_dining_context('party',party_value,session_value,token_value,csrf_value,focus_value,true);
  IF p.status NOT IN('waiting','reserved','held','seated') THEN PERFORM dg_native_order_error('PARTY_ENDED');END IF;
  IF session_value IS NOT NULL AND p.id IS DISTINCT FROM(SELECT dining_party_id FROM reception_sessions WHERE id=session_value) THEN PERFORM dg_native_order_error('VERSION_CONFLICT');END IF;
 ELSE SELECT * INTO p FROM dining_parties WHERE id=party_value;END IF;
 IF order_value IS NOT NULL THEN SELECT * INTO o FROM restaurant_orders WHERE id=order_value AND party_id=p.id AND restaurant_id=meta->>'restaurantId';IF o.id IS NULL THEN PERFORM dg_native_order_error('NOT_FOUND');END IF;END IF;
 RETURN meta||jsonb_build_object('orderId',order_value,'changeId',change_value,'partyAccessVersion',p.access_version,'partyVersion',p.version);
END;$dg$;

CREATE FUNCTION dg_native_order_input(meta jsonb,input jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' THEN PERFORM dg_native_order_error('VALIDATION_FAILED');END IF;
 IF meta->>'actorType'='guest' AND(dg_native_restaurant_integer(input->'selectionVersion',0,9007199254740991)<>(meta->>'selectionVersion')::bigint OR dg_native_restaurant_integer(input->'focusVersion',0,9007199254740991)<>(meta->>'focusVersion')::bigint) THEN PERFORM dg_native_order_error('VERSION_CONFLICT');END IF;
END;$dg$;

CREATE FUNCTION dg_native_order_pos_project(target text,manager_value boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE config restaurant_pos_configs%ROWTYPE;configured_value boolean;
BEGIN
 SELECT * INTO config FROM restaurant_pos_configs WHERE restaurant_id=target;
 configured_value:=config.restaurant_id IS NOT NULL AND config.provider_id='mock-pos' AND config.enabled=1;
 RETURN jsonb_build_object('restaurantId',target,'providerId',config.provider_id,'enabled',coalesce(config.enabled,0)=1,'scenario',CASE WHEN manager_value THEN config.scenario END,'version',coalesce(config.version,0),'configured',coalesce(configured_value,false),'simulated',coalesce(config.provider_id='mock-pos',false),'mockAllowed',true,'canManage',manager_value,'notice',CASE WHEN configured_value THEN '本地模拟后厨连接，仅产生显式模拟业务回执，不发送真实POS。' WHEN config.provider_id='external-pos' THEN '真实POS尚未接通，不能以模拟成功替代。' ELSE '请由门店经理明确配置本地模拟后厨，或接入并验证真实POS。' END);
END;$dg$;

CREATE FUNCTION dg_native_order_source(meta jsonb,party_value text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE p dining_parties%ROWTYPE;s reception_sessions%ROWTYPE;origin _dg_native_dining_session_origins%ROWTYPE;
BEGIN
 SELECT * INTO p FROM dining_parties WHERE id=party_value;IF p.id IS NULL OR p.restaurant_id IS DISTINCT FROM meta->>'restaurantId' OR p.access_version IS DISTINCT FROM(meta->>'partyAccessVersion')::bigint OR p.status NOT IN('waiting','reserved','held','seated') THEN RETURN false;END IF;
 IF meta->>'actorType'='staff' THEN RETURN dg_native_dining_clock_authority(meta->>'actorId',p.restaurant_id,(meta->>'actorEpoch')::bigint,(meta->>'grantVersion')::bigint);END IF;
 SELECT * INTO s FROM reception_sessions WHERE id=meta->>'sessionId';SELECT * INTO origin FROM _dg_native_dining_session_origins WHERE session_id=s.id;
 RETURN s.id IS NOT NULL AND origin.session_id IS NOT NULL AND s.id=p.owner_session_id AND s.dining_party_id=p.id AND s.status='active'
  AND s.focus_version=(meta->>'focusVersion')::bigint AND s.expires_at>dg_native_dining_now() AND s.activity_at>dg_native_people_iso(clock_timestamp()-interval '120 seconds')
  AND (meta->>'selectionVersion')::bigint=(SELECT coalesce(max(version),0) FROM _dg_native_dining_selection_revisions WHERE session_id=s.id)
  AND EXISTS(SELECT 1 FROM _dg_native_reception_access a WHERE a.id=meta->>'accessId' AND a.session_id=s.id AND a.access_version=s.access_version AND a.expires_at>dg_native_dining_now())
  AND dg_native_dining_clock_authority(origin.actor_id,p.restaurant_id,origin.actor_epoch,origin.grant_version) AND dg_native_reception_source_valid(s.id)
  AND NOT EXISTS(SELECT 1 FROM _dg_native_reception_origins o CROSS JOIN LATERAL jsonb_array_elements(o.assets::jsonb) fixed JOIN assets asset ON asset.id=fixed->>'id' WHERE o.session_id=s.id AND asset.expires_at IS NOT NULL AND asset.expires_at<=dg_native_dining_now());
END;$dg$;

CREATE FUNCTION dg_native_order_fields(raw jsonb,order_value text,kind_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE input jsonb;line jsonb;r restaurant_orders%ROWTYPE;
BEGIN
 input:=raw-ARRAY['focusVersion','selectionVersion','orderVersion','version','kind'];
 PERFORM dg_native_restaurant_fields(input,ARRAY['newLines','reductions','shareDietary','note','recommendationId']);
 IF jsonb_typeof(input->'newLines') IS DISTINCT FROM 'array' OR jsonb_array_length(input->'newLines')>30 OR jsonb_typeof(input->'reductions') IS DISTINCT FROM 'array' OR jsonb_array_length(input->'reductions')>30 OR jsonb_typeof(input->'shareDietary') IS DISTINCT FROM 'boolean' THEN PERFORM dg_native_order_error('VALIDATION_FAILED');END IF;
 PERFORM dg_native_restaurant_text(input->'note',0,200);IF input->'recommendationId' IS DISTINCT FROM 'null'::jsonb AND(input->>'recommendationId') !~ '^[a-f0-9-]{36}$' THEN PERFORM dg_native_order_error('VALIDATION_FAILED');END IF;
 SELECT * INTO r FROM restaurant_orders WHERE id=order_value;
 FOR line IN SELECT * FROM jsonb_array_elements(input->'newLines') LOOP
  PERFORM dg_native_restaurant_fields(line,ARRAY['skuId','quantity','preparationNote']);PERFORM dg_native_restaurant_integer(line->'quantity',1,99);PERFORM dg_native_restaurant_text(line->'preparationNote',0,200);
  IF NOT EXISTS(SELECT 1 FROM restaurant_menu_skus sku WHERE sku.id=line->>'skuId' AND sku.restaurant_id=r.restaurant_id AND sku.archived=0) THEN PERFORM dg_native_order_error('NOT_FOUND');END IF;
 END LOOP;
 IF kind_value='cancel' THEN
  IF jsonb_array_length(input->'newLines')>0 THEN PERFORM dg_native_order_error('ORDER_CANCEL_ADDS');END IF;
  input:=jsonb_set(input,'{reductions}',(SELECT coalesce(jsonb_agg(jsonb_build_object('lineId',l.id,'quantity',l.quantity-l.cancelled_quantity)),'[]') FROM restaurant_order_lines l WHERE l.order_id=r.id AND l.quantity>l.cancelled_quantity));
 END IF;
 FOR line IN SELECT * FROM jsonb_array_elements(input->'reductions') LOOP
  PERFORM dg_native_restaurant_fields(line,ARRAY['lineId','quantity']);PERFORM dg_native_restaurant_integer(line->'quantity',1,99);
  IF NOT EXISTS(SELECT 1 FROM restaurant_order_lines l WHERE l.id=line->>'lineId' AND l.order_id=r.id) THEN PERFORM dg_native_order_error('NOT_FOUND');END IF;
 END LOOP;
 IF jsonb_array_length(input->'reductions')<>(SELECT count(DISTINCT value->>'lineId') FROM jsonb_array_elements(input->'reductions')) THEN PERFORM dg_native_order_error('ORDER_DUPLICATE_REDUCTION');END IF;
 IF kind_value='initial' AND jsonb_array_length(input->'reductions')>0 THEN PERFORM dg_native_order_error('ORDER_INITIAL_REDUCTION');END IF;
 IF jsonb_array_length(input->'newLines')+jsonb_array_length(input->'reductions')=0 THEN PERFORM dg_native_order_error('ORDER_EMPTY');END IF;RETURN input;
END;$dg$;

CREATE FUNCTION dg_native_order_quote_reason(target text,reader_meta jsonb DEFAULT NULL) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE q restaurant_order_quotes%ROWTYPE;origin _dg_native_order_quote_origins%ROWTYPE;c restaurant_order_changes%ROWTYPE;o restaurant_orders%ROWTYPE;p dining_parties%ROWTYPE;r restaurants%ROWTYPE;seat dining_occupancies%ROWTYPE;t restaurant_tables%ROWTYPE;config restaurant_pos_configs%ROWTYPE;snapshot jsonb;pref jsonb;
BEGIN
 SELECT * INTO q FROM restaurant_order_quotes WHERE id=target;SELECT * INTO origin FROM _dg_native_order_quote_origins WHERE quote_id=q.id;
 IF q.id IS NULL OR origin.quote_id IS NULL THEN RETURN '审阅不存在。';END IF;
 IF reader_meta IS NOT NULL AND reader_meta-ARRAY['orderId','changeId','partyVersion','partyAccessVersion'] IS DISTINCT FROM origin.actor_meta-ARRAY['orderId','changeId','partyVersion','partyAccessVersion'] THEN RETURN '审阅属于之前的操作人、授权或发问人，请重新审阅。';END IF;
 IF q.status<>'current' OR q.expires_at<=dg_native_dining_now() THEN RETURN '审阅已到期或被替代，请重新审阅。';END IF;
 SELECT * INTO c FROM restaurant_order_changes WHERE id=q.change_id;SELECT * INTO o FROM restaurant_orders WHERE id=c.order_id;SELECT * INTO p FROM dining_parties WHERE id=o.party_id;SELECT * INTO r FROM restaurants WHERE id=o.restaurant_id;snapshot:=q.payload::jsonb;
 IF c.status NOT IN('awaiting_confirmation','confirmed') OR c.current_quote_id<>q.id OR c.version<>q.change_version+(CASE WHEN c.status='confirmed' THEN 1 ELSE 0 END) OR c.base_content_version<>o.content_version OR o.content_version<>(snapshot->>'contentVersion')::bigint OR dg_native_office_hash(c.input::jsonb)<>snapshot->>'inputHash' THEN RETURN '草稿或已接单明细已有新版本。';END IF;
 IF NOT dg_native_order_source(origin.actor_meta,p.id) OR p.version<>(snapshot->>'partyVersion')::bigint OR p.access_version<>(snapshot->>'partyAccessVersion')::bigint OR o.control_mode<>'automatic' OR o.settlement_status<>'unsettled' THEN RETURN '本次归属、授权、就餐安排或控制状态已变化。';END IF;
 SELECT * INTO seat FROM dining_occupancies WHERE party_id=p.id AND state='seated';SELECT * INTO t FROM restaurant_tables WHERE id=seat.table_id;
 IF p.status<>'seated' OR seat.id IS DISTINCT FROM snapshot->>'occupancyId' OR t.id IS DISTINCT FROM snapshot->>'tableId' OR t.version<>(snapshot->>'tableVersion')::bigint OR t.enabled<>1 OR t.operation<>'open' OR r.version<>(snapshot->>'restaurantVersion')::bigint THEN RETURN '实际入座、桌位或门店设置已变化。';END IF;
 IF r.menu_version<>(snapshot->>'menuVersion')::bigint THEN RETURN '菜单、价格或可售库存已变化。';END IF;
 pref:=dg_native_food_preference(p.id,origin.actor_meta);IF pref IS NULL OR pref->'usable' IS DISTINCT FROM 'true'::jsonb OR pref->>'id' IS DISTINCT FROM snapshot->>'preferenceId' OR dg_native_office_hash(pref)<>snapshot->>'preferenceHash' THEN RETURN '本次偏好或来源授权已变化。';END IF;
 SELECT * INTO config FROM restaurant_pos_configs WHERE restaurant_id=r.id;IF config.restaurant_id IS NULL OR config.enabled<>1 OR config.provider_id<>'mock-pos' OR config.version<>(snapshot->>'posConfigVersion')::bigint THEN RETURN '后厨连接已变化或尚未配置。';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(snapshot->'lines') l JOIN restaurant_kitchen_tickets ticket ON ticket.line_id=l->>'lineId' WHERE l->>'operation'='reduce' AND ticket.version<>(l->>'ticketVersion')::bigint) THEN RETURN '制作进度已变化，请重新核对退菜数量。';END IF;RETURN NULL;
END;$dg$;

CREATE FUNCTION dg_native_order_review(target text,meta jsonb,input jsonb,action_value text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE c restaurant_order_changes%ROWTYPE;o restaurant_orders%ROWTYPE;p dining_parties%ROWTYPE;r restaurants%ROWTYPE;seat dining_occupancies%ROWTYPE;t restaurant_tables%ROWTYPE;config restaurant_pos_configs%ROWTYPE;sku restaurant_menu_skus%ROWTYPE;item restaurant_menu_items%ROWTYPE;line restaurant_order_lines%ROWTYPE;ticket restaurant_kitchen_tickets%ROWTYPE;
 pref jsonb;fields jsonb;f jsonb;l jsonb;lines jsonb:='[]';warnings jsonb:='[]';all_tags jsonb;dietary jsonb;old_total bigint;new_total bigint;created text;expires text;quote_value text:=input->>'_quoteId';snapshot jsonb;recommendation jsonb;
BEGIN
 SELECT * INTO c FROM restaurant_order_changes WHERE id=target;SELECT * INTO o FROM restaurant_orders WHERE id=c.order_id;SELECT * INTO p FROM dining_parties WHERE id=o.party_id;SELECT * INTO r FROM restaurants WHERE id=o.restaurant_id;
 IF c.status NOT IN('draft','awaiting_confirmation','confirmed') OR o.pending_change_id IS DISTINCT FROM c.id OR c.base_content_version<>o.content_version THEN PERFORM dg_native_order_error('ORDER_REVIEW_LOCKED');END IF;
 SELECT * INTO seat FROM dining_occupancies WHERE party_id=p.id AND state='seated' FOR UPDATE;SELECT * INTO t FROM restaurant_tables WHERE id=seat.table_id;
 IF p.status<>'seated' OR seat.id IS NULL OR t.enabled<>1 OR t.operation<>'open' THEN PERFORM dg_native_order_error('ORDER_SEATING_REQUIRED');END IF;
 pref:=dg_native_food_preference(p.id,meta);IF pref IS NULL OR pref->'usable' IS DISTINCT FROM 'true'::jsonb THEN PERFORM dg_native_order_error('PREFERENCE_CONFIRMATION_REQUIRED');END IF;f:=pref->'preferences';
 SELECT * INTO config FROM restaurant_pos_configs WHERE restaurant_id=r.id;IF config.restaurant_id IS NULL OR config.enabled<>1 OR config.provider_id<>'mock-pos' THEN PERFORM dg_native_order_error('POS_NOT_CONFIGURED');END IF;
 fields:=dg_native_order_fields(c.input::jsonb,o.id,c.kind);
 IF fields->>'recommendationId' IS NOT NULL THEN recommendation:=dg_native_food_recommendation_view(fields->>'recommendationId',meta->>'sessionId',(SELECT token_hash FROM _dg_native_reception_access WHERE id=meta->>'accessId'));IF recommendation->>'partyId'<>p.id OR recommendation->>'status'<>'current' THEN PERFORM dg_native_order_error('ORDER_RECOMMENDATION_CHANGED');END IF;END IF;
 IF quote_value IS NULL OR quote_value !~ '^[a-f0-9-]{36}$' OR input->>'_confirmationHash' IS NULL OR input->>'_confirmationHash' !~ '^[a-f0-9]{64}$' THEN PERFORM dg_native_order_error('VALIDATION_FAILED');END IF;
 IF f->>'allergyMode'='not_provided' THEN warnings:=warnings||jsonb_build_array('本次尚未提供过敏信息，请与店员核对后再确认。');END IF;
 FOR l IN SELECT * FROM jsonb_array_elements(fields->'newLines') LOOP
  SELECT * INTO sku FROM restaurant_menu_skus WHERE id=l->>'skuId' AND restaurant_id=r.id AND archived=0;SELECT * INTO item FROM restaurant_menu_items WHERE id=sku.item_id;
  IF sku.id IS NULL OR item.id IS NULL OR sku.on_sale<>1 OR item.listed<>1 THEN PERFORM dg_native_order_error('MENU_UNAVAILABLE');END IF;
  IF sku.stock_tracked=1 AND sku.stock_remaining<(SELECT sum((value->>'quantity')::bigint) FROM jsonb_array_elements(fields->'newLines') WHERE value->>'skuId'=sku.id) THEN PERFORM dg_native_order_error('ORDER_OUT_OF_STOCK');END IF;
  all_tags:=item.ingredient_tags::jsonb||item.allergen_tags::jsonb||item.may_contain_tags::jsonb;
  IF(jsonb_array_length(f->'avoids')>0 OR f->>'allergyMode'='specified') AND(item.allergen_info_complete<>1 OR dg_native_food_matches(all_tags,(f->'avoids')||(f->'allergens'))) THEN PERFORM dg_native_order_error('ORDER_DIETARY_CHECK');END IF;
  IF f->>'allergyMode'='specified' AND fields->'shareDietary'<>'true'::jsonb THEN PERFORM dg_native_order_error('ORDER_DIETARY_SHARING_REQUIRED');END IF;
  IF f->>'maxSpice' IS NOT NULL AND item.spice_level>(f->>'maxSpice')::bigint THEN warnings:=warnings||jsonb_build_array(item.name||'超过本次辣度范围');END IF;
  IF f->>'budgetPerDishMinor' IS NOT NULL AND sku.price_minor>(f->>'budgetPerDishMinor')::bigint THEN warnings:=warnings||jsonb_build_array(item.name||'超过本次单道菜预算');END IF;
  dietary:=CASE WHEN fields->'shareDietary'='true'::jsonb THEN(f->'avoids')||(f->'allergens') ELSE '[]'::jsonb END;
  lines:=lines||jsonb_build_array(jsonb_build_object('operation','add','lineId',gen_random_uuid()::text,'skuId',sku.id,'itemId',item.id,'itemName',item.name,'skuName',sku.name,'quantity',(l->>'quantity')::bigint,'unitPriceMinor',sku.price_minor,'subtotalMinor',sku.price_minor*(l->>'quantity')::bigint,'preparationNote',l->>'preparationNote','dietaryTags',dietary,'tracked',sku.stock_tracked=1,'skuVersion',sku.version,'itemVersion',item.version,'ticketVersion',NULL));
 END LOOP;
 FOR l IN SELECT * FROM jsonb_array_elements(fields->'reductions') LOOP
  SELECT * INTO line FROM restaurant_order_lines WHERE id=l->>'lineId' AND order_id=o.id;SELECT * INTO ticket FROM restaurant_kitchen_tickets WHERE line_id=line.id FOR UPDATE;
  IF line.id IS NULL OR ticket.id IS NULL OR line.quantity-line.cancelled_quantity-ticket.started_quantity-ticket.pending_cancel_quantity<(l->>'quantity')::bigint THEN PERFORM dg_native_order_error('KITCHEN_ALREADY_STARTED');END IF;
  lines:=lines||jsonb_build_array(jsonb_build_object('operation','reduce','lineId',line.id,'skuId',line.sku_id,'itemId',line.item_id,'itemName',line.item_name,'skuName',line.sku_name,'quantity',(l->>'quantity')::bigint,'unitPriceMinor',line.unit_price_minor,'subtotalMinor',line.unit_price_minor*(l->>'quantity')::bigint,'preparationNote',line.preparation_note,'dietaryTags',line.dietary_tags::jsonb,'tracked',line.stock_tracked=1,'skuVersion',0,'itemVersion',0,'ticketVersion',ticket.version));
 END LOOP;
 SELECT coalesce(sum((quantity-cancelled_quantity)*unit_price_minor),0) INTO old_total FROM restaurant_order_lines WHERE order_id=o.id;SELECT old_total+coalesce(sum((value->>'subtotalMinor')::bigint*(CASE WHEN value->>'operation'='add' THEN 1 ELSE -1 END)),0) INTO new_total FROM jsonb_array_elements(lines);
 IF new_total NOT BETWEEN 0 AND 100000000 THEN PERFORM dg_native_order_error('ORDER_AMOUNT_INVALID');END IF;
 SELECT created_at INTO created FROM _dg_native_dining_actions WHERE id=action_value;expires:=dg_native_people_iso(created::timestamptz+interval '120 seconds');SELECT coalesce(jsonb_agg(value ORDER BY value),'[]') INTO warnings FROM(SELECT DISTINCT value FROM jsonb_array_elements(warnings)) deduplicated;
 snapshot:=jsonb_build_object('id',quote_value,'orderId',o.id,'changeId',c.id,'changeVersion',c.version+1,'contentVersion',o.content_version,'inputHash',dg_native_office_hash(fields),'restaurantId',r.id,'restaurantVersion',r.version,'partyId',p.id,'partyVersion',p.version,'partyAccessVersion',p.access_version,'occupancyId',seat.id,'tableId',t.id,'tableVersion',t.version,'tableName',t.name,'tableCode',t.code,'menuVersion',r.menu_version,'posConfigVersion',config.version,'preferenceId',pref->>'id','preferenceHash',dg_native_office_hash(pref),'expiresAt',expires,'oldTotalMinor',old_total,'newTotalMinor',new_total,'lines',lines,'warnings',warnings,'dietaryNotice',CASE WHEN fields->'shareDietary'='true'::jsonb THEN '仅向后厨分享本次必要避让成分，不包含姓名、喜好、单位或聊天。' ELSE '未向后厨分享本次偏好资料。' END);
 FOR quote_value IN SELECT id FROM restaurant_order_quotes WHERE change_id=c.id AND status='current' LOOP PERFORM dg_native_dining_effect(action_value,'restaurant_order_quotes',quote_value);UPDATE restaurant_order_quotes SET status='superseded' WHERE id=quote_value;END LOOP;quote_value:=input->>'_quoteId';
 PERFORM dg_native_dining_effect(action_value,'restaurant_order_quotes',quote_value);INSERT INTO restaurant_order_quotes VALUES(quote_value,c.id,c.version+1,dg_native_office_hash(snapshot),snapshot::text,meta->>'actorId',meta->>'sessionId',(meta->>'focusVersion')::bigint,'current',expires,created);
 INSERT INTO _dg_native_order_quote_origins VALUES(quote_value,action_value,(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1),meta,input->>'_confirmationHash',dg_native_office_hash(snapshot),created,expires);
 PERFORM dg_native_dining_effect(action_value,'restaurant_order_changes',c.id);UPDATE restaurant_order_changes SET status='awaiting_confirmation',version=version+1,current_quote_id=quote_value,confirmed_at=NULL,confirmed_actor_id=NULL,confirmed_focus_version=NULL,confirmed_quote_id=NULL,updated_at=created WHERE id=c.id;RETURN quote_value;
END;$dg$;

CREATE FUNCTION dg_native_order_quote_project(target text,meta jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE q restaurant_order_quotes%ROWTYPE;origin _dg_native_order_quote_origins%ROWTYPE;c restaurant_order_changes%ROWTYPE;snapshot jsonb;reason text;can_confirm boolean;lines jsonb;
BEGIN
 SELECT * INTO q FROM restaurant_order_quotes WHERE id=target;IF q.id IS NULL THEN RETURN NULL;END IF;SELECT * INTO origin FROM _dg_native_order_quote_origins WHERE quote_id=q.id;SELECT * INTO c FROM restaurant_order_changes WHERE id=q.change_id;snapshot:=q.payload::jsonb;reason:=dg_native_order_quote_reason(q.id,meta);can_confirm:=reason IS NULL AND c.status='awaiting_confirmation';
 SELECT coalesce(jsonb_agg(value-ARRAY['tracked','skuVersion','itemVersion','ticketVersion']),'[]') INTO lines FROM jsonb_array_elements(snapshot->'lines');
 RETURN jsonb_build_object('id',q.id,'changeId',q.change_id,'changeVersion',q.change_version,'hash',q.hash,'expiresAt',q.expires_at,'valid',reason IS NULL,'invalidReason',reason,'canConfirm',can_confirm,'confirmationToken',NULL,'menuVersion',(snapshot->>'menuVersion')::bigint,'partyVersion',(snapshot->>'partyVersion')::bigint,'tableName',snapshot->>'tableName','oldTotalMinor',(snapshot->>'oldTotalMinor')::bigint,'newTotalMinor',(snapshot->>'newTotalMinor')::bigint,'deltaMinor',(snapshot->>'newTotalMinor')::bigint-(snapshot->>'oldTotalMinor')::bigint,'lines',lines,'warnings',snapshot->'warnings','dietaryNotice',snapshot->>'dietaryNotice','createdAt',q.created_at,'_confirmation',CASE WHEN can_confirm THEN jsonb_build_object('quoteId',q.id,'meta',origin.actor_meta,'hash',origin.confirmation_hash) END);
END;$dg$;

CREATE FUNCTION dg_native_order_stock_move(action_value text,change_value text,sku_value text,delta_value bigint,kind_value text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE sku restaurant_menu_skus%ROWTYPE;movement_value text:=gen_random_uuid()::text;created text;
BEGIN
 SELECT * INTO sku FROM restaurant_menu_skus WHERE id=sku_value FOR UPDATE;SELECT created_at INTO created FROM _dg_native_dining_actions WHERE id=action_value;
 IF sku.id IS NULL OR sku.stock_remaining+delta_value NOT BETWEEN 0 AND 1000000 OR(kind_value='reserve' AND delta_value>=0) OR(kind_value='release' AND delta_value<=0) OR kind_value NOT IN('reserve','release') THEN PERFORM dg_native_order_error('ORDER_STOCK_CHANGED');END IF;
 PERFORM dg_native_dining_effect(action_value,'restaurant_stock_movements',movement_value);INSERT INTO restaurant_stock_movements VALUES(movement_value,sku.restaurant_id,sku.id,change_value,kind_value,sku.stock_remaining,sku.stock_remaining+delta_value,created);
 PERFORM dg_native_dining_effect(action_value,'restaurant_menu_skus',sku.id);UPDATE restaurant_menu_skus SET stock_remaining=stock_remaining+delta_value,version=version+1 WHERE id=sku.id;
 PERFORM dg_native_dining_effect(action_value,'restaurant_menu_items',sku.item_id);UPDATE restaurant_menu_items SET version=version+1,updated_at=created WHERE id=sku.item_id;
END;$dg$;

CREATE FUNCTION dg_native_order_inventory(action_value text,change_value text,quote_value text,reserve_value boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE q restaurant_order_quotes%ROWTYPE;snapshot jsonb;item record;hold restaurant_inventory_reservations%ROWTYPE;sku restaurant_menu_skus%ROWTYPE;ticket restaurant_kitchen_tickets%ROWTYPE;record_value text;created text;changed boolean:=false;
BEGIN
 SELECT * INTO q FROM restaurant_order_quotes WHERE id=quote_value AND change_id=change_value;snapshot:=q.payload::jsonb;SELECT created_at INTO created FROM _dg_native_dining_actions WHERE id=action_value;
 IF q.id IS NULL THEN PERFORM dg_native_order_error('ORDER_QUOTE_CHANGED');END IF;
 IF reserve_value THEN
  FOR item IN SELECT value->>'skuId' sku_id,sum((value->>'quantity')::bigint)::bigint quantity,min((value->>'skuVersion')::bigint) sku_version,bool_and((value->>'tracked')::boolean) tracked FROM jsonb_array_elements(snapshot->'lines') WHERE value->>'operation'='add' GROUP BY value->>'skuId' ORDER BY value->>'skuId' LOOP
   SELECT * INTO sku FROM restaurant_menu_skus WHERE id=item.sku_id AND restaurant_id=snapshot->>'restaurantId' FOR UPDATE;
   IF sku.id IS NULL OR sku.archived<>0 OR sku.on_sale<>1 OR sku.version<>item.sku_version OR(sku.stock_tracked=1)<>item.tracked OR item.tracked AND sku.stock_remaining<item.quantity THEN PERFORM dg_native_order_error('ORDER_STOCK_CHANGED');END IF;
   record_value:=gen_random_uuid()::text;PERFORM dg_native_dining_effect(action_value,'restaurant_inventory_reservations',record_value);INSERT INTO restaurant_inventory_reservations VALUES(record_value,change_value,sku.id,item.quantity,CASE WHEN item.tracked THEN 1 ELSE 0 END,'reserved',created,created);INSERT INTO _dg_native_order_reservation_origins VALUES(record_value,change_value,action_value,(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1),created);
   IF item.tracked THEN PERFORM dg_native_order_stock_move(action_value,change_value,sku.id,-item.quantity,'reserve');changed:=true;END IF;
  END LOOP;
 ELSE
  FOR hold IN SELECT h.* FROM restaurant_inventory_reservations h JOIN _dg_native_order_reservation_origins origin ON origin.reservation_id=h.id WHERE h.change_id=change_value AND h.status='reserved' ORDER BY h.sku_id FOR UPDATE OF h LOOP
   IF hold.tracked=1 THEN PERFORM dg_native_order_stock_move(action_value,change_value,hold.sku_id,hold.quantity,'release');changed:=true;END IF;
   PERFORM dg_native_dining_effect(action_value,'restaurant_inventory_reservations',hold.id);UPDATE restaurant_inventory_reservations SET status='released',updated_at=created WHERE id=hold.id;
  END LOOP;
 END IF;
 FOR item IN SELECT value->>'lineId' line_id,(value->>'quantity')::bigint quantity,(value->>'ticketVersion')::bigint ticket_version FROM jsonb_array_elements(snapshot->'lines') WHERE value->>'operation'='reduce' ORDER BY value->>'lineId' LOOP
  SELECT * INTO ticket FROM restaurant_kitchen_tickets WHERE line_id=item.line_id FOR UPDATE;
  IF ticket.id IS NULL OR reserve_value AND(ticket.version<>item.ticket_version OR NOT EXISTS(SELECT 1 FROM restaurant_order_lines l WHERE l.id=item.line_id AND l.quantity-l.cancelled_quantity-ticket.started_quantity-ticket.pending_cancel_quantity>=item.quantity)) OR NOT reserve_value AND ticket.pending_cancel_quantity<item.quantity THEN PERFORM dg_native_order_error('KITCHEN_QUANTITY_CHANGED');END IF;
  PERFORM dg_native_dining_effect(action_value,'restaurant_kitchen_tickets',ticket.id);UPDATE restaurant_kitchen_tickets SET pending_cancel_quantity=pending_cancel_quantity+CASE WHEN reserve_value THEN item.quantity ELSE -item.quantity END,version=version+1,updated_at=created WHERE id=ticket.id;
 END LOOP;
 IF changed THEN PERFORM dg_native_dining_effect(action_value,'restaurants',snapshot->>'restaurantId');UPDATE restaurants SET menu_version=menu_version+1,updated_at=created WHERE id=snapshot->>'restaurantId';END IF;
END;$dg$;

CREATE FUNCTION dg_native_order_before_send_reason(change_value text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE c restaurant_order_changes%ROWTYPE;o restaurant_orders%ROWTYPE;d restaurant_order_dispatches%ROWTYPE;q restaurant_order_quotes%ROWTYPE;origin _dg_native_order_quote_origins%ROWTYPE;p dining_parties%ROWTYPE;r restaurants%ROWTYPE;seat dining_occupancies%ROWTYPE;t restaurant_tables%ROWTYPE;config restaurant_pos_configs%ROWTYPE;snapshot jsonb;pref jsonb;
BEGIN
 SELECT * INTO c FROM restaurant_order_changes WHERE id=change_value;SELECT * INTO o FROM restaurant_orders WHERE id=c.order_id;SELECT * INTO d FROM restaurant_order_dispatches WHERE change_id=c.id;SELECT * INTO q FROM restaurant_order_quotes WHERE id=c.confirmed_quote_id;SELECT * INTO origin FROM _dg_native_order_quote_origins WHERE quote_id=q.id;snapshot:=q.payload::jsonb;
 IF q.id IS NULL OR origin.quote_id IS NULL OR q.status<>'current' OR q.expires_at<=dg_native_dining_now() THEN RETURN '原确认期限已到，未发送请求需要重新审阅。';END IF;
 IF c.status<>'queued' OR d.status<>'queued' OR d.attempts<>0 OR o.pending_change_id IS DISTINCT FROM c.id THEN RETURN '此请求已进入发送或核对流程，不能当作未发送处理。';END IF;
 SELECT * INTO p FROM dining_parties WHERE id=o.party_id;SELECT * INTO r FROM restaurants WHERE id=o.restaurant_id;SELECT * INTO seat FROM dining_occupancies WHERE party_id=p.id AND state='seated';SELECT * INTO t FROM restaurant_tables WHERE id=seat.table_id;SELECT * INTO config FROM restaurant_pos_configs WHERE restaurant_id=r.id;pref:=dg_native_food_preference(p.id,origin.actor_meta);
 IF NOT dg_native_order_source(origin.actor_meta,p.id) OR p.version<>(snapshot->>'partyVersion')::bigint OR p.status<>'seated' OR o.control_mode<>'automatic' OR o.settlement_status<>'unsettled' OR o.content_version<>(snapshot->>'contentVersion')::bigint THEN RETURN '发送前服务对象、就餐归属或控制状态已变化。';END IF;
 IF seat.id IS DISTINCT FROM snapshot->>'occupancyId' OR t.id IS DISTINCT FROM snapshot->>'tableId' OR t.version<>(snapshot->>'tableVersion')::bigint OR t.enabled<>1 OR t.operation<>'open' OR r.version<>(snapshot->>'restaurantVersion')::bigint THEN RETURN '发送前桌位或门店配置已变化。';END IF;
 IF pref IS NULL OR pref->'usable' IS DISTINCT FROM 'true'::jsonb OR dg_native_office_hash(pref)<>snapshot->>'preferenceHash' THEN RETURN '发送前偏好或来源授权已变化。';END IF;
 IF config.restaurant_id IS NULL OR config.enabled<>1 OR config.version<>d.config_version OR config.provider_id<>d.provider_id OR config.provider_id<>'mock-pos' THEN RETURN '发送前后厨连接已变化。';END IF;
 -- Current menu/stock versions can change through our own reservation; the
 -- submitted immutable price and allocated quantities remain authoritative.
 RETURN NULL;
END;$dg$;

CREATE FUNCTION dg_native_order_withdraw_internal(change_value text,action_value text,expired_value boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE c restaurant_order_changes%ROWTYPE;o restaurant_orders%ROWTYPE;d restaurant_order_dispatches%ROWTYPE;created text;quote_value text;
BEGIN
 SELECT * INTO c FROM restaurant_order_changes WHERE id=change_value FOR UPDATE;SELECT * INTO o FROM restaurant_orders WHERE id=c.order_id FOR UPDATE;SELECT * INTO d FROM restaurant_order_dispatches WHERE change_id=c.id;SELECT created_at INTO created FROM _dg_native_dining_actions WHERE id=action_value;
 IF c.status NOT IN('draft','awaiting_confirmation','confirmed','queued','rejected','stale') THEN PERFORM dg_native_order_error('ORDER_RESULT_PENDING');END IF;
 IF c.status='queued' THEN
  IF d.status<>'queued' OR d.attempts<>0 THEN PERFORM dg_native_order_error('ORDER_RESULT_PENDING');END IF;
  PERFORM dg_native_order_inventory(action_value,c.id,c.confirmed_quote_id,false);PERFORM dg_native_dining_effect(action_value,'restaurant_order_dispatches',c.id);UPDATE restaurant_order_dispatches SET status='cancelled',version=version+1,error_code=CASE WHEN expired_value THEN 'ORDER_SOURCE_EXPIRED' END,error_message=CASE WHEN expired_value THEN '未发送请求的原期限或来源已失效，预占已释放。' END,updated_at=created WHERE change_id=c.id;
 END IF;
 FOR quote_value IN SELECT id FROM restaurant_order_quotes WHERE change_id=c.id AND status='current' LOOP PERFORM dg_native_dining_effect(action_value,'restaurant_order_quotes',quote_value);UPDATE restaurant_order_quotes SET status=CASE WHEN expired_value AND expires_at<=dg_native_dining_now() THEN 'expired' ELSE 'withdrawn' END WHERE id=quote_value;END LOOP;
 PERFORM dg_native_dining_effect(action_value,'restaurant_order_changes',c.id);UPDATE restaurant_order_changes SET status=CASE WHEN expired_value THEN 'stale' ELSE 'withdrawn' END,version=version+1,updated_at=created WHERE id=c.id;
 PERFORM dg_native_dining_effect(action_value,'restaurant_orders',o.id);UPDATE restaurant_orders SET pending_change_id=NULL,status=CASE WHEN NOT EXISTS(SELECT 1 FROM restaurant_order_lines WHERE order_id=o.id AND quantity>cancelled_quantity) THEN 'cancelled' ELSE 'accepted' END,version=version+1,updated_at=created WHERE id=o.id;
END;$dg$;

CREATE FUNCTION dg_native_order_sweep(restaurant_value text DEFAULT NULL) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE candidate record;meta jsonb;action_value text;changed bigint:=0;
BEGIN
 PERFORM dg_native_reception_runtime(true);
 FOR candidate IN SELECT d.change_id,o.party_id,o.restaurant_id,r.tenant_id,r.workspace_id FROM restaurant_order_dispatches d JOIN _dg_native_order_dispatch_origins origin ON origin.change_id=d.change_id JOIN restaurant_order_changes c ON c.id=d.change_id JOIN restaurant_orders o ON o.id=c.order_id JOIN restaurants r ON r.id=o.restaurant_id WHERE d.status='queued' AND d.attempts=0 AND(restaurant_value IS NULL OR r.id=restaurant_value) ORDER BY r.id,d.change_id LIMIT 100 LOOP
  PERFORM dg_native_reception_workspace(candidate.tenant_id,candidate.workspace_id,true);PERFORM id FROM restaurants WHERE id=candidate.restaurant_id FOR UPDATE;PERFORM id FROM restaurant_orders WHERE party_id=candidate.party_id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM restaurant_order_dispatches WHERE change_id=candidate.change_id AND status='queued' AND attempts=0) AND dg_native_order_before_send_reason(candidate.change_id) IS NOT NULL THEN
   meta:=jsonb_build_object('restaurantId',candidate.restaurant_id,'tenantId',candidate.tenant_id,'workspaceId',candidate.workspace_id,'partyId',candidate.party_id,'actorType','worker','actorId','system:order-expiry','actorEpoch',NULL,'grantVersion',NULL,'sessionId',NULL,'accessId',NULL,'focusVersion',NULL,'selectionVersion',NULL);
   action_value:=dg_native_dining_action(meta,'order_expire','party',candidate.party_id,'{}');PERFORM dg_native_order_withdraw_internal(candidate.change_id,action_value,true);INSERT INTO outbox_events VALUES(gen_random_uuid()::text,candidate.tenant_id,candidate.workspace_id,candidate.party_id,'dining.order_unsent_expired','mock','{}',dg_native_dining_now(),NULL);changed:=changed+1;
  END IF;
 END LOOP;RETURN changed;
END;$dg$;

CREATE FUNCTION dg_native_order_apply(kind_value text,target text,action_value text,input jsonb,session_value text DEFAULT NULL,token_value text DEFAULT NULL,csrf_value text DEFAULT NULL,focus_value bigint DEFAULT NULL) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;body jsonb:=input-ARRAY['focusVersion','selectionVersion'];operation_value text;order_value text;change_value text;quote_value text;created text;fields jsonb;revision_value bigint;counter_value bigint;message_value text;payload jsonb;
 r restaurants%ROWTYPE;p dining_parties%ROWTYPE;o restaurant_orders%ROWTYPE;c restaurant_order_changes%ROWTYPE;q restaurant_order_quotes%ROWTYPE;quote_origin _dg_native_order_quote_origins%ROWTYPE;config restaurant_pos_configs%ROWTYPE;
BEGIN
 IF action_value NOT IN('config','draft','update','review','confirm','submit','withdraw') OR jsonb_typeof(input) IS DISTINCT FROM 'object' THEN PERFORM dg_native_order_error('VALIDATION_FAILED');END IF;
 meta:=dg_native_order_context(kind_value,target,session_value,token_value,csrf_value,focus_value,true);PERFORM dg_native_order_input(meta,input);SELECT * INTO r FROM restaurants WHERE id=meta->>'restaurantId';
 IF action_value='config' THEN
  IF kind_value<>'restaurant' OR meta->>'actorType'<>'staff' THEN PERFORM dg_native_order_error('FORBIDDEN');END IF;PERFORM dg_native_restaurant_prepare('restaurant',r.id,true,true,NULL);
  PERFORM dg_native_restaurant_fields(body,ARRAY['version','providerId','enabled','scenario','confirmed']);IF body->'confirmed' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(body->'enabled') IS DISTINCT FROM 'boolean' OR body->>'providerId' NOT IN('mock-pos','external-pos') OR body->>'scenario' NOT IN('normal','rejected','response_lost','unresolved') THEN PERFORM dg_native_order_error('VALIDATION_FAILED');END IF;
  IF body->>'providerId'='external-pos' AND body->'enabled'='true'::jsonb THEN PERFORM dg_native_order_error('POS_PROVIDER_UNAVAILABLE');END IF;
  SELECT * INTO config FROM restaurant_pos_configs WHERE restaurant_id=r.id FOR UPDATE;IF dg_native_restaurant_integer(body->'version',0,9007199254740991)<>coalesce(config.version,0) THEN PERFORM dg_native_order_error('VERSION_CONFLICT');END IF;
  operation_value:=dg_native_dining_action(meta,'order_config','restaurant',r.id,body);SELECT created_at INTO created FROM _dg_native_dining_actions WHERE id=operation_value;PERFORM dg_native_dining_effect(operation_value,'restaurant_pos_configs',r.id);revision_value:=coalesce(config.version,0)+1;
  INSERT INTO restaurant_pos_configs VALUES(r.id,body->>'providerId',CASE WHEN body->'enabled'='true'::jsonb THEN 1 ELSE 0 END,body->>'scenario',revision_value,created,created) ON CONFLICT(restaurant_id) DO UPDATE SET provider_id=excluded.provider_id,enabled=excluded.enabled,scenario=excluded.scenario,version=excluded.version,updated_at=excluded.updated_at;
  INSERT INTO _dg_native_order_pos_revisions VALUES(r.id,revision_value,operation_value,body->>'providerId',CASE WHEN body->'enabled'='true'::jsonb THEN 1 ELSE 0 END,body->>'scenario',created);INSERT INTO _dg_native_order_results VALUES(operation_value,r.id,NULL,NULL,NULL,NULL,created);RETURN operation_value;
 END IF;
 SELECT * INTO p FROM dining_parties WHERE id=meta->>'partyId';IF action_value='draft' AND kind_value<>'party' OR action_value<>'draft' AND kind_value<>'change' THEN PERFORM dg_native_order_error('VALIDATION_FAILED');END IF;
 IF action_value='draft' THEN
  PERFORM dg_native_restaurant_fields(body,ARRAY['orderVersion','kind','newLines','reductions','shareDietary','note','recommendationId']);
  IF body->>'kind' NOT IN('initial','amend','cancel') OR body->>'kind' IS NULL THEN PERFORM dg_native_order_error('VALIDATION_FAILED');END IF;
  SELECT existing.* INTO o FROM restaurant_orders existing JOIN _dg_native_order_origins origin ON origin.order_id=existing.id WHERE existing.party_id=p.id AND existing.status NOT IN('closed','cancelled') ORDER BY existing.created_at DESC,existing.id DESC LIMIT 1 FOR UPDATE OF existing;
  IF o.id IS NULL THEN IF dg_native_restaurant_integer(body->'orderVersion',0,9007199254740991)<>0 OR body->>'kind'<>'initial' THEN PERFORM dg_native_order_error('ORDER_CHANGED');END IF;
  ELSIF dg_native_restaurant_integer(body->'orderVersion',0,9007199254740991)<>o.version THEN PERFORM dg_native_order_error('ORDER_CHANGED');END IF;
 ELSE SELECT * INTO c FROM restaurant_order_changes WHERE id=target FOR UPDATE;SELECT * INTO o FROM restaurant_orders WHERE id=c.order_id FOR UPDATE;IF c.id IS NULL OR dg_native_restaurant_integer(body->'version',1,9007199254740991)<>c.version THEN PERFORM dg_native_order_error('VERSION_CONFLICT');END IF;END IF;
 IF o.id IS NOT NULL AND(o.settlement_status<>'unsettled' OR o.status IN('closed','cancelled') OR o.control_mode<>'automatic' AND action_value<>'withdraw') THEN PERFORM dg_native_order_error('ORDER_NOT_WRITABLE');END IF;
 IF EXISTS(SELECT 1 FROM restaurant_financial_operations f JOIN restaurant_bills bill ON bill.id=f.bill_id WHERE bill.order_id=o.id AND(f.status IN('queued','submitting','pending','unknown','needs_attention') OR EXISTS(SELECT 1 FROM restaurant_financial_postings post WHERE post.operation_id=f.id AND post.kind='payment'))) THEN PERFORM dg_native_order_error('ORDER_FINANCIAL_PENDING');END IF;
 IF(SELECT count(*) FROM _dg_native_dining_actions WHERE restaurant_id=r.id AND resource_id=p.id AND kind='order_'||action_value AND created_at>dg_native_people_iso(clock_timestamp()-interval '5 minutes'))>=40 THEN PERFORM dg_native_order_error('RATE_LIMITED');END IF;
 operation_value:=dg_native_dining_action(meta,'order_'||action_value,'party',p.id,body-ARRAY['_quoteId','_confirmationHash']);SELECT created_at INTO created FROM _dg_native_dining_actions WHERE id=operation_value;
 IF action_value='draft' THEN
  IF o.id IS NULL THEN
   IF(SELECT count(*) FROM _dg_native_order_origins WHERE party_id=p.id)>=100 THEN PERFORM dg_native_order_error('ORDER_LIMIT');END IF;
   order_value:=gen_random_uuid()::text;PERFORM dg_native_dining_effect(operation_value,'restaurants',r.id);UPDATE restaurants SET order_counter=order_counter+1 WHERE id=r.id RETURNING order_counter INTO counter_value;
   PERFORM dg_native_dining_effect(operation_value,'restaurant_orders',order_value);INSERT INTO restaurant_orders(id,restaurant_id,party_id,number,created_at,updated_at) VALUES(order_value,r.id,p.id,'O-'||lpad(counter_value::text,greatest(6,length(counter_value::text)),'0'),created,created);INSERT INTO _dg_native_order_origins VALUES(order_value,p.id,(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1),operation_value,created);SELECT * INTO o FROM restaurant_orders WHERE id=order_value;
  END IF;
  IF o.pending_change_id IS NOT NULL THEN PERFORM dg_native_order_error('ORDER_CHANGE_PENDING');END IF;
  IF(body->>'kind'='initial')=EXISTS(SELECT 1 FROM restaurant_order_lines WHERE order_id=o.id AND quantity>cancelled_quantity) THEN PERFORM dg_native_order_error('ORDER_KIND_CHANGED');END IF;
  fields:=dg_native_order_fields(body,o.id,body->>'kind');SELECT coalesce(max(sequence),0)+1 INTO revision_value FROM restaurant_order_changes WHERE order_id=o.id;IF revision_value>500 THEN PERFORM dg_native_order_error('ORDER_LIMIT');END IF;change_value:=gen_random_uuid()::text;
  PERFORM dg_native_dining_effect(operation_value,'restaurant_order_changes',change_value);INSERT INTO restaurant_order_changes(id,order_id,kind,sequence,base_content_version,input,source,actor_id,session_id,focus_version,party_access_version,created_at,updated_at) VALUES(change_value,o.id,body->>'kind',revision_value,o.content_version,fields::text,'manual',meta->>'actorId',session_value,focus_value,p.access_version,created,created);INSERT INTO _dg_native_order_change_origins VALUES(change_value,o.id,p.id,(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1),operation_value,created);
  PERFORM dg_native_dining_effect(operation_value,'restaurant_orders',o.id);UPDATE restaurant_orders SET pending_change_id=change_value,status='draft',version=version+1,updated_at=created WHERE id=o.id;message_value:='已保存点单草稿，尚未确认、预占或发送后厨。';
 ELSIF action_value='update' THEN
  PERFORM dg_native_restaurant_fields(body,ARRAY['version','newLines','reductions','shareDietary','note','recommendationId']);IF c.status NOT IN('draft','awaiting_confirmation','confirmed') OR o.pending_change_id IS DISTINCT FROM c.id THEN PERFORM dg_native_order_error('ORDER_ALREADY_SENT');END IF;fields:=dg_native_order_fields(body,o.id,c.kind);
  FOR quote_value IN SELECT id FROM restaurant_order_quotes WHERE change_id=c.id AND status='current' LOOP PERFORM dg_native_dining_effect(operation_value,'restaurant_order_quotes',quote_value);UPDATE restaurant_order_quotes SET status='superseded' WHERE id=quote_value;END LOOP;quote_value:=NULL;
  PERFORM dg_native_dining_effect(operation_value,'restaurant_order_changes',c.id);UPDATE restaurant_order_changes SET input=fields::text,status='draft',version=version+1,base_content_version=o.content_version,actor_id=meta->>'actorId',session_id=session_value,focus_version=focus_value,party_access_version=p.access_version,current_quote_id=NULL,confirmed_at=NULL,confirmed_actor_id=NULL,confirmed_focus_version=NULL,confirmed_quote_id=NULL,updated_at=created WHERE id=c.id;message_value:='草稿已修改，旧审阅与确认已失效。';
 ELSIF action_value='review' THEN
  PERFORM dg_native_restaurant_fields(body,ARRAY['version','_quoteId','_confirmationHash']);quote_value:=dg_native_order_review(c.id,meta,body,operation_value);message_value:='已生成固定两分钟的当前价格、桌位与数量审阅，尚未预占库存。';
 ELSIF action_value='confirm' THEN
  PERFORM dg_native_restaurant_fields(body,ARRAY['version','quoteId','_confirmationHash','warningsAccepted','confirmed']);IF body->'confirmed' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(body->'warningsAccepted') IS DISTINCT FROM 'boolean' THEN PERFORM dg_native_order_error('VALIDATION_FAILED');END IF;
  SELECT * INTO q FROM restaurant_order_quotes WHERE id=body->>'quoteId' AND change_id=c.id;SELECT * INTO quote_origin FROM _dg_native_order_quote_origins WHERE quote_id=q.id;
  IF q.id IS NULL OR c.status<>'awaiting_confirmation' OR dg_native_order_quote_reason(q.id,meta) IS NOT NULL THEN PERFORM dg_native_order_error('ORDER_QUOTE_CHANGED');END IF;
  IF body->>'_confirmationHash' IS DISTINCT FROM quote_origin.confirmation_hash THEN PERFORM dg_native_order_error('ORDER_CONFIRMATION_INVALID');END IF;
  IF jsonb_array_length(q.payload::jsonb->'warnings')>0 AND body->'warningsAccepted' IS DISTINCT FROM 'true'::jsonb THEN PERFORM dg_native_order_error('ORDER_WARNING_CONFIRMATION');END IF;
  PERFORM dg_native_dining_effect(operation_value,'restaurant_order_changes',c.id);UPDATE restaurant_order_changes SET status='confirmed',version=version+1,confirmed_at=created,confirmed_actor_id=meta->>'actorId',confirmed_focus_version=focus_value,confirmed_quote_id=q.id,updated_at=created WHERE id=c.id;quote_value:=q.id;message_value:='已明确确认本次审阅，尚未预占库存或发送后厨。';
 ELSIF action_value='submit' THEN
  PERFORM dg_native_restaurant_fields(body,ARRAY['version','quoteId','confirmed']);IF body->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN PERFORM dg_native_order_error('VALIDATION_FAILED');END IF;SELECT * INTO q FROM restaurant_order_quotes WHERE id=body->>'quoteId' AND change_id=c.id;
  IF q.id IS NULL OR c.status<>'confirmed' OR c.confirmed_quote_id IS DISTINCT FROM q.id OR c.confirmed_actor_id IS DISTINCT FROM meta->>'actorId' OR c.confirmed_focus_version IS DISTINCT FROM focus_value OR dg_native_order_quote_reason(q.id,meta) IS NOT NULL THEN PERFORM dg_native_order_error('ORDER_QUOTE_CHANGED');END IF;
  SELECT * INTO config FROM restaurant_pos_configs WHERE restaurant_id=r.id;PERFORM dg_native_order_inventory(operation_value,c.id,q.id,true);
  payload:=q.payload::jsonb;payload:=jsonb_build_object('requestId',c.id,'restaurantId',r.id,'orderId',o.id,'orderNumber',o.number,'kind',c.kind,'remoteOrderId',o.remote_order_id,'bindingVersion',p.access_version,'table',jsonb_build_object('id',payload->>'tableId','code',payload->>'tableCode','name',payload->>'tableName'),'currency','CNY','previousTotalMinor',(payload->>'oldTotalMinor')::bigint,'proposedTotalMinor',(payload->>'newTotalMinor')::bigint,'adds',(SELECT coalesce(jsonb_agg(value-ARRAY['operation','subtotalMinor','tracked','skuVersion','itemVersion','ticketVersion']),'[]') FROM jsonb_array_elements(payload->'lines') WHERE value->>'operation'='add'),'reductions',(SELECT coalesce(jsonb_agg(jsonb_build_object('lineId',value->>'lineId','quantity',(value->>'quantity')::bigint,'unitPriceMinor',(value->>'unitPriceMinor')::bigint)),'[]') FROM jsonb_array_elements(payload->'lines') WHERE value->>'operation'='reduce'),'kitchenNote',c.input::jsonb->>'note');
  PERFORM dg_native_dining_effect(operation_value,'restaurant_order_dispatches',c.id);INSERT INTO restaurant_order_dispatches(change_id,restaurant_id,provider_id,config_version,config_snapshot,request_hash,request_payload,simulated,created_at,updated_at) VALUES(c.id,r.id,config.provider_id,config.version,to_jsonb(config)::text,dg_native_office_hash(payload),payload::text,1,created,created);INSERT INTO _dg_native_order_dispatch_origins VALUES(c.id,operation_value,q.id,(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1),dg_native_office_hash(payload),created);
  PERFORM dg_native_dining_effect(operation_value,'restaurant_order_changes',c.id);UPDATE restaurant_order_changes SET status='queued',version=version+1,updated_at=created WHERE id=c.id;
  IF q.expires_at<=dg_native_dining_now() OR NOT dg_native_order_source(meta,p.id) THEN PERFORM dg_native_order_error('ORDER_QUOTE_CHANGED');END IF;quote_value:=q.id;message_value:='已原子保存库存预占和待发送请求，尚未发送或接单。';
 ELSE PERFORM dg_native_restaurant_fields(body,ARRAY['version','confirmed']);IF body->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN PERFORM dg_native_order_error('VALIDATION_FAILED');END IF;PERFORM dg_native_order_withdraw_internal(c.id,operation_value,false);message_value:='已撤回尚未发送的请求并释放预占，原业务历史保留。';END IF;
 IF action_value NOT IN('draft','withdraw') THEN PERFORM dg_native_dining_effect(operation_value,'restaurant_orders',o.id);UPDATE restaurant_orders SET version=version+1,status=CASE action_value WHEN 'update' THEN 'draft' WHEN 'review' THEN 'awaiting_confirmation' WHEN 'confirm' THEN 'confirmed' ELSE 'queued' END,updated_at=created WHERE id=o.id;END IF;
 IF action_value<>'draft' THEN change_value:=c.id;END IF;order_value:=o.id;PERFORM dg_native_order_event(operation_value,o.id,change_value,'order_'||action_value,message_value);
 INSERT INTO _dg_native_order_results VALUES(operation_value,r.id,order_value,change_value,quote_value,p.access_version,created);PERFORM dg_native_dining_touch(meta,operation_value);PERFORM dg_native_order_context(kind_value,target,session_value,token_value,csrf_value,focus_value,true);INSERT INTO outbox_events VALUES(gen_random_uuid()::text,r.tenant_id,r.workspace_id,p.id,'dining.order_'||action_value,'mock','{}',created,NULL);RETURN operation_value;
END;$dg$;

CREATE FUNCTION dg_native_order_event(action_value text,order_value text,change_value text,kind_value text,message_value text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE record_value text:=gen_random_uuid()::text;created text;actor_value text;
BEGIN SELECT created_at,actor_id INTO created,actor_value FROM _dg_native_dining_actions WHERE id=action_value;PERFORM dg_native_dining_effect(action_value,'restaurant_order_events',record_value);INSERT INTO restaurant_order_events VALUES(record_value,order_value,change_value,actor_value,kind_value,jsonb_build_object('message',message_value)::text,created);END;$dg$;

CREATE FUNCTION dg_native_order_project(target text,meta jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE o restaurant_orders%ROWTYPE;p dining_parties%ROWTYPE;c restaurant_order_changes%ROWTYPE;d restaurant_order_dispatches%ROWTYPE;line restaurant_order_lines%ROWTYPE;t restaurant_kitchen_tickets%ROWTYPE;sku restaurant_menu_skus%ROWTYPE;item restaurant_menu_items%ROWTYPE;draft_line jsonb;previews jsonb;quote jsonb;lines jsonb:='[]';changes jsonb:='[]';events jsonb;reason text;accepted_total bigint:=0;pending_total bigint;active bigint;state_value text;
BEGIN
 SELECT current_order.* INTO o FROM restaurant_orders current_order JOIN _dg_native_order_origins origin ON origin.order_id=current_order.id WHERE current_order.id=target AND current_order.restaurant_id=meta->>'restaurantId' AND current_order.party_id=meta->>'partyId';IF o.id IS NULL THEN PERFORM dg_native_order_error('NOT_FOUND');END IF;SELECT * INTO p FROM dining_parties WHERE id=o.party_id;
 FOR line IN SELECT * FROM restaurant_order_lines WHERE order_id=o.id ORDER BY created_at,id LOOP
  SELECT * INTO t FROM restaurant_kitchen_tickets WHERE line_id=line.id;IF t.id IS NULL THEN PERFORM dg_native_order_error('ORDER_DATA_INCOMPLETE');END IF;active:=line.quantity-line.cancelled_quantity;accepted_total:=accepted_total+active*line.unit_price_minor;
  state_value:=CASE WHEN active=0 THEN 'cancelled' WHEN t.served_quantity>=active THEN 'served' WHEN t.ready_quantity>=active THEN 'ready' WHEN t.started_quantity>0 THEN 'preparing' ELSE 'accepted' END;
  lines:=lines||jsonb_build_array(jsonb_build_object('id',line.id,'skuId',line.sku_id,'itemId',line.item_id,'itemName',line.item_name,'skuName',line.sku_name,'unitPriceMinor',line.unit_price_minor,'currency','CNY','quantity',line.quantity,'cancelledQuantity',line.cancelled_quantity,'activeQuantity',active,'preparationNote',line.preparation_note,'dietaryTags',line.dietary_tags::jsonb,'subtotalMinor',active*line.unit_price_minor,'kitchen',jsonb_build_object('ticketId',t.id,'version',t.version,'startedQuantity',t.started_quantity,'readyQuantity',t.ready_quantity,'servedQuantity',t.served_quantity,'pendingCancelQuantity',t.pending_cancel_quantity,'state',state_value)));
 END LOOP;
 FOR c IN SELECT * FROM restaurant_order_changes WHERE order_id=o.id ORDER BY sequence LOOP
  previews:='[]';FOR draft_line IN SELECT * FROM jsonb_array_elements(c.input::jsonb->'newLines') LOOP
   SELECT * INTO sku FROM restaurant_menu_skus WHERE id=draft_line->>'skuId';SELECT * INTO item FROM restaurant_menu_items WHERE id=sku.item_id;
   previews:=previews||jsonb_build_array(jsonb_build_object('skuId',draft_line->>'skuId','itemName',coalesce(item.name,'当前菜品不可用'),'skuName',coalesce(sku.name,'规格不可用'),'quantity',(draft_line->>'quantity')::bigint,'preparationNote',draft_line->>'preparationNote','currentPriceMinor',sku.price_minor,'available',coalesce(sku.archived=0 AND sku.on_sale=1 AND item.listed=1 AND(sku.stock_tracked=0 OR sku.stock_remaining>0),false),'reason',CASE WHEN sku.id IS NULL OR sku.archived<>0 OR sku.on_sale<>1 OR item.listed<>1 OR sku.stock_tracked=1 AND sku.stock_remaining=0 THEN '当前规格已停售、下架或无可售数量。' END));
  END LOOP;
  quote:=dg_native_order_quote_project(c.current_quote_id,meta);SELECT * INTO d FROM restaurant_order_dispatches WHERE change_id=c.id;
  changes:=changes||jsonb_build_array(jsonb_build_object('id',c.id,'orderId',o.id,'sequence',c.sequence,'kind',c.kind,'version',c.version,'status',c.status,'source',c.source,'input',c.input::jsonb,'newLinePreviews',previews,'currentQuote',quote,'dispatch',CASE WHEN d.change_id IS NOT NULL THEN jsonb_build_object('id',d.change_id,'version',d.version,'status',d.status,'simulated',d.simulated=1,'attempts',d.attempts,'queryRequested',d.query_requested=1,'lookups',d.lookups,'remoteRequestId',d.remote_request_id,'remoteOrderId',d.remote_order_id,'errorCode',d.error_code,'errorMessage',d.error_message,'createdAt',d.created_at,'updatedAt',d.updated_at) END,'confirmedAt',c.confirmed_at,'createdAt',c.created_at,'updatedAt',c.updated_at));
  IF o.pending_change_id=c.id AND quote IS NOT NULL THEN pending_total:=(quote->>'newTotalMinor')::bigint;END IF;
 END LOOP;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'kind',e.kind,'message',e.info::jsonb->>'message','createdAt',e.created_at) ORDER BY e.created_at,e.id),'[]') INTO events FROM(SELECT * FROM restaurant_order_events WHERE order_id=o.id ORDER BY created_at DESC,id DESC LIMIT 100) e;
 reason:=CASE WHEN p.status NOT IN('waiting','reserved','held','seated') THEN '本次就餐已结束，请联系店员处理历史记录。' WHEN o.status IN('cancelled','closed') OR o.settlement_status='settled' THEN '本订单已结束，后续点单需建立新订单。' WHEN o.control_mode='human' THEN '本单正在人工核对。' WHEN meta->>'actorType'='guest' AND(SELECT status FROM reception_sessions WHERE id=meta->>'sessionId')<>'active' THEN '当前会话已暂停自动处理。' END;
 RETURN jsonb_build_object('id',o.id,'restaurantId',o.restaurant_id,'partyId',o.party_id,'number',o.number,'version',o.version,'contentVersion',o.content_version,'status',o.status,'controlMode',o.control_mode,'attentionReason',o.attention_reason,'settlementStatus',o.settlement_status,'acceptedTotalMinor',accepted_total,'pendingTotalMinor',pending_total,'currency','CNY','pendingChangeId',o.pending_change_id,'lines',lines,'changes',changes,'events',events,'canChange',reason IS NULL,'changeReason',reason,'createdAt',o.created_at,'updatedAt',o.updated_at);
END;$dg$;

CREATE FUNCTION dg_native_order_read(kind_value text,target text,session_value text DEFAULT NULL,token_value text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;order_value text;connection jsonb;
BEGIN
 meta:=dg_native_order_context(kind_value,target,session_value,token_value);
 IF kind_value='restaurant' THEN IF session_value IS NOT NULL THEN PERFORM dg_native_order_error('FORBIDDEN');END IF;PERFORM dg_native_restaurant_prepare('restaurant',target,true,false,NULL);RETURN dg_native_order_pos_project(target,true);END IF;
 IF kind_value='order' THEN RETURN dg_native_order_project(target,meta);END IF;
 IF kind_value<>'party' THEN PERFORM dg_native_order_error('VALIDATION_FAILED');END IF;
 SELECT o.id INTO order_value FROM restaurant_orders o JOIN _dg_native_order_origins origin ON origin.order_id=o.id WHERE o.party_id=meta->>'partyId' ORDER BY(o.status NOT IN('closed','cancelled')) DESC,o.created_at DESC,o.id DESC LIMIT 1;
 connection:=dg_native_order_pos_project(meta->>'restaurantId',false);
 IF session_value IS NOT NULL THEN RETURN jsonb_build_object('partyId',meta->>'partyId','order',CASE WHEN order_value IS NOT NULL THEN dg_native_order_project(order_value,meta) END,'connection',connection-ARRAY['canManage','scenario'],'automatic',(SELECT status='active' FROM reception_sessions WHERE id=session_value));END IF;
 RETURN jsonb_build_object('order',CASE WHEN order_value IS NOT NULL THEN dg_native_order_project(order_value,meta) END,'connection',connection);
END;$dg$;

CREATE FUNCTION dg_native_order_result(target text,session_value text DEFAULT NULL,token_value text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE receipt _dg_native_order_results%ROWTYPE;action _dg_native_dining_actions%ROWTYPE;meta jsonb;
BEGIN
 SELECT * INTO receipt FROM _dg_native_order_results WHERE action_id=target;SELECT * INTO action FROM _dg_native_dining_actions WHERE id=target;IF receipt.action_id IS NULL OR action.id IS NULL THEN PERFORM dg_native_order_error('NOT_FOUND');END IF;
 meta:=dg_native_order_context(CASE WHEN action.resource_type='restaurant' THEN 'restaurant' ELSE 'party' END,action.resource_id,session_value,token_value);
 IF action.actor_type IS DISTINCT FROM meta->>'actorType' OR action.actor_id IS DISTINCT FROM meta->>'actorId' OR action.actor_epoch IS DISTINCT FROM(meta->>'actorEpoch')::bigint OR action.grant_version IS DISTINCT FROM(meta->>'grantVersion')::bigint OR action.session_id IS DISTINCT FROM meta->>'sessionId' OR action.access_id IS DISTINCT FROM meta->>'accessId' OR action.focus_version IS DISTINCT FROM(meta->>'focusVersion')::bigint OR action.selection_version IS DISTINCT FROM(meta->>'selectionVersion')::bigint OR receipt.party_access_version IS DISTINCT FROM(meta->>'partyAccessVersion')::bigint THEN PERFORM dg_native_order_error('AUTHORIZATION_CHANGED');END IF;
 IF action.kind='order_config' THEN PERFORM dg_native_restaurant_prepare('restaurant',receipt.restaurant_id,true,false,NULL);RETURN dg_native_order_pos_project(receipt.restaurant_id,true);END IF;
 RETURN dg_native_order_project(receipt.order_id,meta);
END;$dg$;

CREATE FUNCTION dg_native_order_empty_finishable(target text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT NOT EXISTS(SELECT 1 FROM restaurant_orders o WHERE o.party_id=target AND(o.status<>'cancelled' OR o.pending_change_id IS NOT NULL OR EXISTS(SELECT 1 FROM restaurant_order_lines l WHERE l.order_id=o.id AND l.quantity>l.cancelled_quantity) OR EXISTS(SELECT 1 FROM restaurant_order_dispatches d JOIN restaurant_order_changes c ON c.id=d.change_id WHERE c.order_id=o.id AND(d.status<>'cancelled' OR d.attempts<>0))));
$dg$;

CREATE FUNCTION dg_native_order_record_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j jsonb:=to_jsonb(NEW);previous jsonb:=to_jsonb(OLD);record_value text;restaurant_value text;party_value text;order_value text;action _dg_native_dining_actions%ROWTYPE;
BEGIN
 record_value:=CASE TG_TABLE_NAME WHEN 'restaurant_pos_configs' THEN j->>'restaurant_id' WHEN 'restaurant_order_dispatches' THEN j->>'change_id' ELSE j->>'id' END;
 IF TG_OP='DELETE' OR NOT dg_native_dining_changed(TG_TABLE_NAME,record_value) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native order records require their actual scoped operation';END IF;
 IF TG_TABLE_NAME='restaurant_pos_configs' THEN restaurant_value:=j->>'restaurant_id';
 ELSIF TG_TABLE_NAME='restaurant_orders' THEN restaurant_value:=j->>'restaurant_id';party_value:=j->>'party_id';
 ELSE
  order_value:=CASE WHEN TG_TABLE_NAME='restaurant_order_changes' OR TG_TABLE_NAME='restaurant_order_events' OR TG_TABLE_NAME='restaurant_kitchen_tickets' THEN j->>'order_id' ELSE(SELECT c.order_id FROM restaurant_order_changes c WHERE c.id=j->>'change_id') END;
  SELECT restaurant_id,party_id INTO restaurant_value,party_value FROM restaurant_orders WHERE id=order_value;
 END IF;
 SELECT a.* INTO action FROM _dg_native_dining_changes effect JOIN _dg_native_dining_actions a ON a.id=effect.action_id WHERE effect.table_name=TG_TABLE_NAME AND effect.resource_id=record_value AND effect.transaction_id=pg_current_xact_id()::text AND a.transaction_id=effect.transaction_id AND a.restaurant_id=restaurant_value AND a.resource_id=coalesce(party_value,restaurant_value) AND a.kind IN('order_config','order_draft','order_update','order_review','order_confirm','order_submit','order_withdraw','order_expire','order_quote_expire') ORDER BY a.created_at DESC,a.id DESC LIMIT 1;
 IF action.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Order effects cannot borrow unrelated business actions';END IF;
 IF TG_TABLE_NAME='restaurant_orders' THEN
  IF j->>'control_mode'<>'automatic' OR j->>'settlement_status'<>'unsettled' OR j->>'remote_order_id' IS NOT NULL OR j->>'attention_reason' IS NOT NULL OR(j->>'content_version')::bigint<>1 OR j->>'status' NOT IN('draft','awaiting_confirmation','confirmed','queued','cancelled','accepted') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='This order stage cannot fabricate acceptance, payment or remote facts';END IF;
  IF TG_OP='INSERT' THEN IF action.kind<>'order_draft' OR j->>'status'<>'draft' OR(j->>'version')::bigint<>1 OR j->>'pending_change_id' IS NOT NULL OR j->>'created_at'<>action.created_at THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native order creation is an unsubmitted original draft';END IF;
  ELSIF j-ARRAY['version','status','pending_change_id','updated_at'] IS DISTINCT FROM previous-ARRAY['version','status','pending_change_id','updated_at'] OR(j->>'version')::bigint<>(previous->>'version')::bigint+1 OR previous->>'status' IN('closed','cancelled') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Order identity, accepted content and terminal states cannot be rewritten';END IF;
 ELSIF TG_TABLE_NAME='restaurant_order_changes' THEN
  IF j->>'source'<>'manual' OR j->>'source_request_id' IS NOT NULL OR j->>'kind' NOT IN('initial','amend','cancel') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Drafts cannot claim a fabricated conversation or source';END IF;
  IF TG_OP='INSERT' THEN IF action.kind<>'order_draft' OR j->>'status'<>'draft' OR(j->>'version')::bigint<>1 OR j->>'created_at'<>action.created_at OR j->>'confirmed_at' IS NOT NULL OR j->>'current_quote_id' IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Order changes start as the next editable draft';END IF;
  ELSE
   IF j-ARRAY['version','status','input','base_content_version','actor_id','session_id','focus_version','party_access_version','current_quote_id','confirmed_at','confirmed_actor_id','confirmed_focus_version','confirmed_quote_id','updated_at'] IS DISTINCT FROM previous-ARRAY['version','status','input','base_content_version','actor_id','session_id','focus_version','party_access_version','current_quote_id','confirmed_at','confirmed_actor_id','confirmed_focus_version','confirmed_quote_id','updated_at'] OR(j->>'version')::bigint<>(previous->>'version')::bigint+1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Change scope, sequence, source and version are immutable';END IF;
   IF NOT(action.kind='order_update' AND previous->>'status' IN('draft','awaiting_confirmation','confirmed') AND j->>'status'='draft' OR action.kind='order_review' AND previous->>'status' IN('draft','awaiting_confirmation','confirmed') AND j->>'status'='awaiting_confirmation' OR action.kind='order_confirm' AND previous->>'status'='awaiting_confirmation' AND j->>'status'='confirmed' OR action.kind='order_submit' AND previous->>'status'='confirmed' AND j->>'status'='queued' OR action.kind='order_withdraw' AND previous->>'status' IN('draft','awaiting_confirmation','confirmed','queued','rejected','stale') AND j->>'status'='withdrawn' OR action.kind='order_expire' AND previous->>'status'='queued' AND j->>'status'='stale') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Unsupported order change transition';END IF;
   IF action.kind<>'order_update' AND j-ARRAY['version','status','current_quote_id','confirmed_at','confirmed_actor_id','confirmed_focus_version','confirmed_quote_id','updated_at'] IS DISTINCT FROM previous-ARRAY['version','status','current_quote_id','confirmed_at','confirmed_actor_id','confirmed_focus_version','confirmed_quote_id','updated_at'] THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Review, confirmation and dispatch cannot rewrite draft input or attribution';END IF;
  END IF;
 ELSIF TG_TABLE_NAME='restaurant_order_quotes' THEN
  IF TG_OP='INSERT' THEN IF action.kind<>'order_review' OR j->>'status'<>'current' OR j->>'created_at'<>action.created_at OR(j->>'expires_at')::timestamptz<>(j->>'created_at')::timestamptz+interval '120 seconds' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Quotes keep a fixed original two-minute deadline';END IF;
  ELSIF j-'status' IS DISTINCT FROM previous-'status' OR previous->>'status'<>'current' OR j->>'status' NOT IN('superseded','withdrawn','expired') OR j->>'status'='expired' AND j->>'expires_at'>dg_native_dining_now() THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Quote content, attribution and original deadline cannot be replaced';END IF;
 ELSIF TG_TABLE_NAME='restaurant_pos_configs' THEN
  IF action.kind<>'order_config' OR j->>'provider_id' NOT IN('mock-pos','external-pos') OR(j->>'enabled')::bigint NOT IN(0,1) OR j->>'provider_id'='external-pos' AND j->>'enabled'<>'0' OR j->>'scenario' NOT IN('normal','rejected','response_lost','unresolved') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native POS configuration cannot silently simulate a live provider';END IF;
  IF TG_OP='INSERT' THEN IF(j->>'version')::bigint<>1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='POS config starts at version one';END IF;
  ELSIF j-ARRAY['provider_id','enabled','scenario','version','updated_at'] IS DISTINCT FROM previous-ARRAY['provider_id','enabled','scenario','version','updated_at'] OR(j->>'version')::bigint<>(previous->>'version')::bigint+1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='POS config versions and original creation are guarded';END IF;
 ELSIF TG_TABLE_NAME='restaurant_order_dispatches' THEN
  IF TG_OP='INSERT' THEN IF action.kind<>'order_submit' OR j->>'status'<>'queued' OR j->>'attempts'<>'0' OR j->>'version'<>'1' OR j->>'simulated'<>'1' OR j->>'provider_id'<>'mock-pos' OR j->>'lease_token' IS NOT NULL OR j->>'lease_until' IS NOT NULL OR j->>'remote_request_id' IS NOT NULL OR j->>'remote_order_id' IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='A persistent dispatch is queued and has not claimed external success';END IF;
  ELSIF action.kind NOT IN('order_withdraw','order_expire') OR previous->>'status'<>'queued' OR previous->>'attempts'<>'0' OR j->>'status'<>'cancelled' OR(j->>'version')::bigint<>(previous->>'version')::bigint+1 OR j-ARRAY['status','version','error_code','error_message','updated_at'] IS DISTINCT FROM previous-ARRAY['status','version','error_code','error_message','updated_at'] THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Only definitely unsent dispatches can be withdrawn in this stage';END IF;
 ELSIF TG_TABLE_NAME='restaurant_inventory_reservations' THEN
  IF(j->>'quantity')::bigint<=0 OR j->>'tracked' NOT IN('0','1') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Inventory reservation quantities are positive and explicitly tracked';END IF;
  IF TG_OP='INSERT' THEN IF action.kind<>'order_submit' OR j->>'status'<>'reserved' OR j->>'created_at'<>action.created_at THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Reservations originate in the atomic submit';END IF;
  ELSIF action.kind NOT IN('order_withdraw','order_expire') OR previous->>'status'<>'reserved' OR j->>'status'<>'released' OR j-ARRAY['status','updated_at'] IS DISTINCT FROM previous-ARRAY['status','updated_at'] THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Only original reservations can be released once';END IF;
 ELSIF TG_TABLE_NAME='restaurant_stock_movements' THEN
  IF TG_OP<>'INSERT' OR j->>'kind' NOT IN('reserve','release') OR(j->>'before_quantity')::bigint<0 OR(j->>'after_quantity')::bigint<0 OR NOT(action.kind='order_submit' AND j->>'kind'='reserve' AND(j->>'before_quantity')::bigint>(j->>'after_quantity')::bigint OR action.kind IN('order_withdraw','order_expire') AND j->>'kind'='release' AND(j->>'before_quantity')::bigint<(j->>'after_quantity')::bigint) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Stock movements are append-only actual reservation or release deltas';END IF;
 ELSIF TG_TABLE_NAME='restaurant_order_events' THEN
  IF TG_OP<>'INSERT' OR j->>'actor_id'<>action.actor_id OR j->>'kind'<>action.kind OR j->>'created_at'<>action.created_at THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Order events retain their actual operation and actor';END IF;
 ELSE
  IF TG_TABLE_NAME<>'restaurant_kitchen_tickets' OR TG_OP<>'UPDATE' OR action.kind NOT IN('order_submit','order_withdraw','order_expire') OR j-ARRAY['pending_cancel_quantity','version','updated_at'] IS DISTINCT FROM previous-ARRAY['pending_cancel_quantity','version','updated_at'] OR(j->>'version')::bigint<>(previous->>'version')::bigint+1 OR(j->>'pending_cancel_quantity')::bigint<0 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='This stage cannot fabricate kitchen progress';END IF;
 END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_order_record_guard BEFORE INSERT OR UPDATE OR DELETE ON restaurant_orders FOR EACH ROW EXECUTE FUNCTION dg_native_order_record_guard();
CREATE TRIGGER native_order_change_guard BEFORE INSERT OR UPDATE OR DELETE ON restaurant_order_changes FOR EACH ROW EXECUTE FUNCTION dg_native_order_record_guard();
CREATE TRIGGER native_order_quote_guard BEFORE INSERT OR UPDATE OR DELETE ON restaurant_order_quotes FOR EACH ROW EXECUTE FUNCTION dg_native_order_record_guard();
CREATE TRIGGER native_order_pos_guard BEFORE INSERT OR UPDATE OR DELETE ON restaurant_pos_configs FOR EACH ROW EXECUTE FUNCTION dg_native_order_record_guard();
CREATE TRIGGER native_order_dispatch_guard BEFORE INSERT OR UPDATE OR DELETE ON restaurant_order_dispatches FOR EACH ROW EXECUTE FUNCTION dg_native_order_record_guard();
CREATE TRIGGER native_order_inventory_guard BEFORE INSERT OR UPDATE OR DELETE ON restaurant_inventory_reservations FOR EACH ROW EXECUTE FUNCTION dg_native_order_record_guard();
CREATE TRIGGER native_order_movement_guard BEFORE INSERT OR UPDATE OR DELETE ON restaurant_stock_movements FOR EACH ROW EXECUTE FUNCTION dg_native_order_record_guard();
CREATE TRIGGER native_order_event_guard BEFORE INSERT OR UPDATE OR DELETE ON restaurant_order_events FOR EACH ROW EXECUTE FUNCTION dg_native_order_record_guard();
CREATE TRIGGER native_order_pending_cancel_guard BEFORE INSERT OR UPDATE OR DELETE ON restaurant_kitchen_tickets FOR EACH ROW EXECUTE FUNCTION dg_native_order_record_guard();

CREATE FUNCTION dg_native_order_change_history() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE operation_value text;created text;
BEGIN
 SELECT a.id,a.created_at INTO operation_value,created FROM _dg_native_dining_changes effect JOIN _dg_native_dining_actions a ON a.id=effect.action_id WHERE effect.table_name='restaurant_order_changes' AND effect.resource_id=NEW.id AND effect.transaction_id=pg_current_xact_id()::text AND a.transaction_id=effect.transaction_id ORDER BY a.created_at DESC,a.id DESC LIMIT 1;
 IF operation_value IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Every change revision has its actual operation';END IF;
 INSERT INTO _dg_native_order_change_revisions VALUES(NEW.id,NEW.version,operation_value,dg_native_office_hash(to_jsonb(NEW)),created);RETURN NULL;
END;$dg$;
CREATE TRIGGER native_order_change_history AFTER INSERT OR UPDATE ON restaurant_order_changes FOR EACH ROW EXECUTE FUNCTION dg_native_order_change_history();

CREATE FUNCTION dg_native_order_catalog_guard(table_value text,j jsonb,previous jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE kinds text[];
BEGIN
 SELECT array_agg(a.kind) INTO kinds FROM _dg_native_dining_changes effect JOIN _dg_native_dining_actions a ON a.id=effect.action_id WHERE effect.table_name=table_value AND effect.resource_id=j->>'id' AND effect.transaction_id=pg_current_xact_id()::text AND a.transaction_id=effect.transaction_id AND a.kind IN('order_draft','order_submit','order_withdraw','order_expire');IF kinds IS NULL THEN RETURN false;END IF;
 IF table_value='restaurants' AND 'order_draft'=ANY(kinds) AND j-'order_counter'=previous-'order_counter' AND(j->>'order_counter')::numeric=(previous->>'order_counter')::numeric+1 AND(j->>'order_counter')::numeric<=9007199254740991 THEN RETURN true;END IF;
 IF NOT kinds&&ARRAY['order_submit','order_withdraw','order_expire'] THEN RETURN false;END IF;
 IF table_value='restaurants' AND j-ARRAY['menu_version','updated_at']=previous-ARRAY['menu_version','updated_at'] AND(j->>'menu_version')::bigint=(previous->>'menu_version')::bigint+1 THEN RETURN true;END IF;
 IF table_value='restaurant_menu_skus' AND j-ARRAY['stock_remaining','version']=previous-ARRAY['stock_remaining','version'] AND(j->>'version')::bigint=(previous->>'version')::bigint+1 AND(j->>'stock_remaining')::bigint BETWEEN 0 AND 1000000 THEN RETURN true;END IF;
 IF table_value='restaurant_menu_items' AND j-ARRAY['version','updated_at']=previous-ARRAY['version','updated_at'] AND(j->>'version')::bigint=(previous->>'version')::bigint+1 THEN RETURN true;END IF;RETURN false;
END;$dg$;

-- Validate the final transaction, including private origins that cannot be
-- supplied through the API or worker roles. No remote acceptance is inferred.
CREATE FUNCTION dg_native_order_final() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j jsonb:=to_jsonb(NEW);order_value text;o restaurant_orders%ROWTYPE;c restaurant_order_changes%ROWTYPE;q restaurant_order_quotes%ROWTYPE;d restaurant_order_dispatches%ROWTYPE;origin _dg_native_order_quote_origins%ROWTYPE;config restaurant_pos_configs%ROWTYPE;hold restaurant_inventory_reservations%ROWTYPE;payload jsonb;expected_quantity bigint;
BEGIN
 IF TG_TABLE_NAME='restaurant_pos_configs' THEN
  SELECT * INTO config FROM restaurant_pos_configs WHERE restaurant_id=j->>'restaurant_id';
  IF NOT EXISTS(SELECT 1 FROM _dg_native_order_pos_revisions revision JOIN _dg_native_dining_actions action ON action.id=revision.action_id WHERE revision.restaurant_id=config.restaurant_id AND revision.version=config.version AND revision.provider_id=config.provider_id AND revision.enabled=config.enabled AND revision.scenario=config.scenario AND action.kind='order_config' AND action.resource_id=config.restaurant_id AND action.created_at=config.updated_at) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='POS configuration requires its immutable current revision';END IF;RETURN NULL;
 END IF;
 IF TG_TABLE_NAME='restaurant_orders' THEN order_value:=j->>'id';
 ELSIF TG_TABLE_NAME='restaurant_order_changes' THEN order_value:=j->>'order_id';
 ELSE SELECT change.order_id INTO order_value FROM restaurant_order_changes change WHERE change.id=j->>'change_id';END IF;
 SELECT current_order.* INTO o FROM restaurant_orders current_order JOIN _dg_native_order_origins fixed ON fixed.order_id=current_order.id JOIN _dg_native_dining_actions action ON action.id=fixed.action_id JOIN dining_parties party ON party.id=fixed.party_id WHERE current_order.id=order_value AND fixed.runtime_id=(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1) AND fixed.party_id=current_order.party_id AND current_order.restaurant_id=party.restaurant_id AND fixed.created_at=current_order.created_at AND action.created_at=fixed.created_at AND action.kind='order_draft' AND action.resource_id=party.id;
 IF o.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Order and party require their original scoped creation';END IF;
 IF o.pending_change_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM restaurant_order_changes pending WHERE pending.id=o.pending_change_id AND pending.order_id=o.id AND pending.status=o.status AND pending.status IN('draft','awaiting_confirmation','confirmed','queued')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Pending order state must match its current change';END IF;
 IF TG_TABLE_NAME='restaurant_order_changes' THEN
  SELECT * INTO c FROM restaurant_order_changes WHERE id=j->>'id';
  IF NOT EXISTS(SELECT 1 FROM _dg_native_order_change_origins fixed JOIN _dg_native_dining_actions action ON action.id=fixed.action_id WHERE fixed.change_id=c.id AND fixed.order_id=o.id AND fixed.party_id=o.party_id AND fixed.runtime_id=(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1) AND fixed.created_at=c.created_at AND action.created_at=fixed.created_at AND action.kind='order_draft' AND action.resource_id=o.party_id) OR NOT EXISTS(SELECT 1 FROM _dg_native_order_change_revisions revision WHERE revision.change_id=c.id AND revision.version=c.version AND revision.row_hash=dg_native_office_hash(to_jsonb(c))) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Changes retain their origin and exact immutable latest revision';END IF;
  IF c.status IN('awaiting_confirmation','confirmed','queued') AND NOT EXISTS(SELECT 1 FROM restaurant_order_quotes quote WHERE quote.id=c.current_quote_id AND quote.change_id=c.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='A reviewed change requires its original quote';END IF;
  IF c.status IN('confirmed','queued') AND(c.confirmed_at IS NULL OR c.confirmed_actor_id IS NULL OR c.confirmed_quote_id IS DISTINCT FROM c.current_quote_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Confirmed changes retain their actual explicit confirmation';END IF;
 ELSIF TG_TABLE_NAME='restaurant_order_quotes' THEN
  SELECT * INTO q FROM restaurant_order_quotes WHERE id=j->>'id';SELECT * INTO origin FROM _dg_native_order_quote_origins WHERE quote_id=q.id;SELECT * INTO c FROM restaurant_order_changes WHERE id=q.change_id;payload:=q.payload::jsonb;
  IF origin.quote_id IS NULL OR origin.runtime_id<>(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1) OR origin.payload_hash<>q.hash OR q.hash<>dg_native_office_hash(payload) OR origin.created_at<>q.created_at OR origin.expires_at<>q.expires_at OR payload->>'id'<>q.id OR payload->>'changeId'<>c.id OR payload->>'orderId'<>o.id OR payload->>'restaurantId'<>o.restaurant_id OR payload->>'partyId'<>o.party_id OR payload->>'expiresAt'<>q.expires_at OR origin.actor_meta->>'actorId' IS DISTINCT FROM q.actor_id OR origin.actor_meta->>'sessionId' IS DISTINCT FROM q.session_id OR(origin.actor_meta->>'focusVersion')::bigint IS DISTINCT FROM q.focus_version OR NOT EXISTS(SELECT 1 FROM _dg_native_dining_actions action WHERE action.id=origin.action_id AND action.kind='order_review' AND action.resource_id=o.party_id AND action.created_at=q.created_at) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Quote payload, actor, hash and original deadline require the same review';END IF;
  IF EXISTS(SELECT 1 FROM _dg_native_dining_actions action WHERE action.id=origin.action_id AND action.transaction_id=pg_current_xact_id()::text) AND(q.expires_at<=dg_native_dining_now() OR NOT dg_native_order_source(origin.actor_meta,o.party_id)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='A new quote cannot commit with an expired source';END IF;
 ELSIF TG_TABLE_NAME='restaurant_order_dispatches' THEN
  SELECT * INTO d FROM restaurant_order_dispatches WHERE change_id=j->>'change_id';SELECT * INTO c FROM restaurant_order_changes WHERE id=d.change_id;SELECT * INTO q FROM restaurant_order_quotes WHERE id=c.confirmed_quote_id;payload:=d.request_payload::jsonb;
  IF NOT EXISTS(SELECT 1 FROM _dg_native_order_dispatch_origins fixed JOIN _dg_native_dining_actions action ON action.id=fixed.action_id WHERE fixed.change_id=d.change_id AND fixed.quote_id=q.id AND fixed.runtime_id=(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1) AND fixed.request_hash=d.request_hash AND action.kind='order_submit' AND action.resource_id=o.party_id AND action.created_at=d.created_at AND fixed.created_at=d.created_at) OR d.request_hash<>dg_native_office_hash(payload) OR d.restaurant_id<>o.restaurant_id OR payload->>'requestId'<>c.id OR payload->>'orderId'<>o.id OR payload->>'restaurantId'<>o.restaurant_id OR(d.config_snapshot::jsonb->>'version')::bigint<>d.config_version OR d.config_snapshot::jsonb->>'provider_id'<>d.provider_id OR d.status='queued' AND(c.status<>'queued' OR o.pending_change_id IS DISTINCT FROM c.id) OR d.status='cancelled' AND c.status NOT IN('withdrawn','stale') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Dispatch is the original confirmed atomic request and matching state';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(q.payload::jsonb->'lines') line WHERE line->>'operation'='add' GROUP BY line->>'skuId' HAVING NOT EXISTS(SELECT 1 FROM restaurant_inventory_reservations reservation JOIN _dg_native_order_reservation_origins fixed ON fixed.reservation_id=reservation.id WHERE reservation.change_id=c.id AND reservation.sku_id=line->>'skuId' AND reservation.quantity=(SELECT sum((value->>'quantity')::bigint) FROM jsonb_array_elements(q.payload::jsonb->'lines') WHERE value->>'operation'='add' AND value->>'skuId'=line->>'skuId') AND reservation.status=(CASE WHEN d.status='queued' THEN 'reserved' ELSE 'released' END))) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Every submitted add has the exact aggregated atomic reservation';END IF;
 ELSIF TG_TABLE_NAME='restaurant_inventory_reservations' THEN
  SELECT * INTO hold FROM restaurant_inventory_reservations WHERE id=j->>'id';SELECT * INTO c FROM restaurant_order_changes WHERE id=hold.change_id;SELECT * INTO d FROM restaurant_order_dispatches WHERE change_id=c.id;SELECT * INTO q FROM restaurant_order_quotes WHERE id=c.confirmed_quote_id;
  SELECT sum((value->>'quantity')::bigint) INTO expected_quantity FROM jsonb_array_elements(q.payload::jsonb->'lines') WHERE value->>'operation'='add' AND value->>'skuId'=hold.sku_id;
  IF hold.quantity IS DISTINCT FROM expected_quantity OR d.change_id IS NULL OR hold.status IS DISTINCT FROM(CASE WHEN d.status='queued' THEN 'reserved' ELSE 'released' END) OR NOT EXISTS(SELECT 1 FROM _dg_native_order_reservation_origins fixed JOIN _dg_native_dining_actions action ON action.id=fixed.action_id WHERE fixed.reservation_id=hold.id AND fixed.change_id=c.id AND fixed.runtime_id=(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1) AND action.kind='order_submit' AND action.resource_id=o.party_id AND fixed.created_at=hold.created_at AND action.created_at=hold.created_at) OR(hold.tracked=1) IS DISTINCT FROM(SELECT bool_and((value->>'tracked')::boolean) FROM jsonb_array_elements(q.payload::jsonb->'lines') WHERE value->>'operation'='add' AND value->>'skuId'=hold.sku_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Inventory holds originate in the same confirmed quote and submit';END IF;
  IF hold.tracked=1 AND(SELECT coalesce(sum(before_quantity-after_quantity),0) FROM restaurant_stock_movements WHERE change_id=c.id AND sku_id=hold.sku_id)<>(CASE WHEN hold.status='reserved' THEN hold.quantity ELSE 0 END) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Tracked reservation net movements must equal the retained quantity';END IF;
 END IF;RETURN NULL;
END;$dg$;
DO $order_final$ DECLARE table_value text;BEGIN FOREACH table_value IN ARRAY ARRAY['restaurant_orders','restaurant_order_changes','restaurant_order_quotes','restaurant_pos_configs','restaurant_order_dispatches','restaurant_inventory_reservations'] LOOP EXECUTE format('CREATE CONSTRAINT TRIGGER native_order_final AFTER INSERT OR UPDATE ON %I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_order_final()',table_value);END LOOP;END;$order_final$;

CREATE FUNCTION dg_native_order_stock_final() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE sku_value text;sku restaurant_menu_skus%ROWTYPE;held bigint;
BEGIN
 sku_value:=CASE WHEN TG_TABLE_NAME='restaurant_menu_skus' THEN to_jsonb(NEW)->>'id' ELSE to_jsonb(NEW)->>'sku_id' END;SELECT * INTO sku FROM restaurant_menu_skus WHERE id=sku_value;
 SELECT coalesce(sum(quantity),0) INTO held FROM restaurant_inventory_reservations reservation JOIN _dg_native_order_reservation_origins fixed ON fixed.reservation_id=reservation.id WHERE reservation.sku_id=sku.id AND reservation.status='reserved' AND reservation.tracked=1;
 IF held>0 AND sku.stock_tracked<>1 OR sku.stock_remaining+held>1000000 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Available plus reserved inventory must remain bounded and releasable';END IF;RETURN NULL;
END;$dg$;
CREATE CONSTRAINT TRIGGER native_order_stock_capacity AFTER INSERT OR UPDATE ON restaurant_menu_skus DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_order_stock_final();
CREATE CONSTRAINT TRIGGER native_order_stock_capacity AFTER INSERT OR UPDATE ON restaurant_inventory_reservations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_order_stock_final();

CREATE OR REPLACE FUNCTION dg_native_restaurant_record_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE j jsonb:=to_jsonb(NEW);previous jsonb:=to_jsonb(OLD);
BEGIN
 IF TG_OP='UPDATE' AND dg_native_order_catalog_guard(TG_TABLE_NAME,j,previous) THEN RETURN NEW;END IF;
 IF TG_OP='UPDATE' AND TG_TABLE_NAME IN('restaurants','restaurant_tables') AND dg_native_dining_changed(TG_TABLE_NAME,j->>'id') THEN
  IF TG_TABLE_NAME='restaurants' THEN
   IF j-ARRAY['queue_counter','booking_counter','updated_at'] IS DISTINCT FROM previous-ARRAY['queue_counter','booking_counter','updated_at'] OR NOT((j->>'queue_counter')::bigint=(previous->>'queue_counter')::bigint+1 AND j->'booking_counter'=previous->'booking_counter' OR(j->>'booking_counter')::bigint=(previous->>'booking_counter')::bigint+1 AND j->'queue_counter'=previous->'queue_counter') OR(j->>'queue_counter')::numeric>9007199254740991 OR(j->>'booking_counter')::numeric>9007199254740991 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Dining service counters advance exactly once without rewriting config';END IF;
  ELSE
   IF j-ARRAY['version','operation'] IS DISTINCT FROM previous-ARRAY['version','operation'] OR(j->>'version')::bigint<>(previous->>'version')::bigint+1 OR j->>'operation' IS DISTINCT FROM previous->>'operation' AND NOT(j->>'operation'='cleaning' AND EXISTS(SELECT 1 FROM _dg_native_dining_changes c JOIN _dg_native_dining_actions a ON a.id=c.action_id WHERE c.table_name='restaurant_tables' AND c.resource_id=j->>'id' AND c.transaction_id=pg_current_xact_id()::text AND a.kind='finish')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Dining table lifecycle cannot rewrite table configuration';END IF;
  END IF;RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native restaurant records retain business provenance';END IF;
 IF TG_OP='UPDATE' THEN
  IF TG_TABLE_NAME='restaurants' THEN
   IF j-ARRAY['name','public_guide','profile_id','scene_app_id','hold_seconds','visit_minutes','late_minutes','accepting_guests','opening_windows','version','menu_version','updated_at'] IS DISTINCT FROM previous-ARRAY['name','public_guide','profile_id','scene_app_id','hold_seconds','visit_minutes','late_minutes','accepting_guests','opening_windows','version','menu_version','updated_at'] OR NOT((j->>'version')::bigint=(previous->>'version')::bigint+1 AND j->'menu_version'=previous->'menu_version' OR j->'version'=previous->'version' AND(j->>'menu_version')::bigint=(previous->>'menu_version')::bigint+1 AND j-ARRAY['menu_version','updated_at']=previous-ARRAY['menu_version','updated_at']) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Restaurant scope and separate config/catalog versions are guarded';END IF;
  ELSE
   IF j->>'version' IS NULL OR(j->>'version')::bigint<>(previous->>'version')::bigint+1 OR j->>'id' IS DISTINCT FROM previous->>'id' OR j->>'restaurant_id' IS DISTINCT FROM previous->>'restaurant_id' OR j->>'item_id' IS DISTINCT FROM previous->>'item_id' OR j->>'user_id' IS DISTINCT FROM previous->>'user_id' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Restaurant child scope and versions cannot be retargeted';END IF;
  END IF;
 ELSE
  IF coalesce((j->>'version')::bigint,1)<>1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native restaurant rows start at version one';END IF;
 END IF;
 IF TG_TABLE_NAME='restaurants' THEN
  IF (j->>'environment')<>'mock' OR (j->>'app_env')<>(SELECT app_env FROM _dg_native_runtime_control WHERE id=1) OR (j->>'queue_counter')::numeric NOT BETWEEN 0 AND 9007199254740991 OR (j->>'booking_counter')::numeric NOT BETWEEN 0 AND 9007199254740991 OR (j->>'order_counter')::numeric NOT BETWEEN 0 AND 9007199254740991 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Restaurant catalog does not fabricate service counters';END IF;
 ELSIF TG_TABLE_NAME='restaurant_tables' THEN
  IF (j->>'capacity')::bigint NOT BETWEEN 1 AND 40 OR (j->>'min_party_size')::bigint NOT BETWEEN 1 AND (j->>'capacity')::bigint OR (j->>'enabled')::bigint NOT IN(0,1) OR (j->>'code')!~'^[A-Z0-9_-]{1,20}$' OR (j->>'x')::double precision<0 OR (j->>'y')::double precision<0 OR (j->>'width')::double precision<0.03 OR (j->>'height')::double precision<0.03 OR (j->>'x')::double precision+(j->>'width')::double precision>1.001 OR (j->>'y')::double precision+(j->>'height')::double precision>1.001 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Restaurant table geometry and capacity are bounded';END IF;
  IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM dining_occupancies WHERE table_id=(j->>'id') AND state IN('held','seated')) THEN PERFORM dg_native_restaurant_error('TABLE_BUSY');END IF;
 ELSIF TG_TABLE_NAME='restaurant_menu_skus' THEN
  IF (j->>'price_minor')::bigint NOT BETWEEN 0 AND 10000000 OR (j->>'stock_remaining')::bigint NOT BETWEEN 0 AND 1000000 OR (j->>'stock_tracked')::bigint NOT IN(0,1) OR (j->>'on_sale')::bigint NOT IN(0,1) OR (j->>'archived')::bigint NOT IN(0,1) OR (j->>'portion_people')::bigint NOT BETWEEN 1 AND 40 OR NOT EXISTS(SELECT 1 FROM restaurant_menu_items WHERE id=(j->>'item_id') AND restaurant_id=(j->>'restaurant_id')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SKU price, inventory and parent binding are guarded';END IF;
 ELSIF TG_TABLE_NAME='restaurant_staff' THEN IF (j->>'enabled')::bigint NOT IN(0,1) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Restaurant duties need explicit enabled state';END IF;
 END IF;
 RETURN NEW;
END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_dining_apply(kind_value text,target text,action_value text,input jsonb,session_value text DEFAULT NULL,token_hash_value text DEFAULT NULL,csrf_hash_value text DEFAULT NULL,focus_value bigint DEFAULT NULL) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;body jsonb:=input-ARRAY['confirmed','focusVersion','selectionVersion'];r restaurants%ROWTYPE;p dining_parties%ROWTYPE;b dining_reservations%ROWTYPE;o dining_occupancies%ROWTYPE;t restaurant_tables%ROWTYPE;plan dining_hold_plans%ROWTYPE;booking_clock _dg_native_dining_booking_clocks%ROWTYPE;dining_action_identifier text;resource_value text;party_value text;table_value text;previous_table text;now_value text:=dg_native_dining_now();start_value text;end_value text;counter_value bigint;version_value bigint;party_version bigint;projection jsonb;old_owner reception_sessions%ROWTYPE;
BEGIN
 IF action_value NOT IN('create','reserve','update','reschedule','check_in','plan','hold','seat','release','cancel','finish','select','claim') THEN PERFORM dg_native_dining_error('VALIDATION_FAILED');END IF;
 IF jsonb_typeof(input)<>'object' OR action_value<>'plan' AND input->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN PERFORM dg_native_dining_error('VALIDATION_FAILED');END IF;
 meta:=dg_native_dining_context(kind_value,target,session_value,token_hash_value,csrf_hash_value,focus_value,true);SELECT * INTO r FROM restaurants WHERE id=meta->>'restaurantId';now_value:=dg_native_dining_now();
 IF session_value IS NOT NULL AND dg_native_restaurant_integer(input->'selectionVersion',0,9007199254740991)<>(meta->>'selectionVersion')::bigint THEN PERFORM dg_native_dining_error('VERSION_CONFLICT');END IF;
 IF meta->>'partyId' IS NOT NULL THEN p:=dg_native_dining_owned(meta,meta->>'partyId');END IF;
 IF session_value IS NOT NULL AND p.id IS NOT NULL AND action_value<>'select' AND NOT EXISTS(SELECT 1 FROM reception_sessions WHERE id=session_value AND dining_party_id=p.id) THEN PERFORM dg_native_dining_error('VERSION_CONFLICT');END IF;
 IF action_value IN('create','reserve') THEN party_value:=body->'_ticket'->>'partyId';resource_value:=party_value;
 ELSIF action_value='plan' THEN resource_value:=gen_random_uuid()::text;party_value:=p.id;
 ELSIF action_value='claim' THEN party_value:=body->>'partyId';resource_value:=party_value;
 ELSE party_value:=p.id;resource_value:=party_value;END IF;
 IF resource_value IS NULL THEN PERFORM dg_native_dining_error('VALIDATION_FAILED');END IF;
 dining_action_identifier:=dg_native_dining_action(meta,action_value,CASE WHEN action_value='plan' THEN 'plan' ELSE 'party' END,resource_value,body);
 IF action_value IN('update','cancel','finish','select','plan','reschedule','check_in','seat','release') THEN version_value:=dg_native_restaurant_integer(body->'version',1,9007199254740991);END IF;
 CASE action_value
 WHEN 'create' THEN
  IF kind_value<>'restaurant' THEN PERFORM dg_native_dining_error('VALIDATION_FAILED');END IF;PERFORM dg_native_restaurant_fields(body,ARRAY['name','size','visitMinutes','guestNote','_ticket']);PERFORM dg_native_dining_new_party(meta,dining_action_identifier,body-'_ticket',body->'_ticket');PERFORM dg_native_dining_touch(meta,dining_action_identifier,party_value,true);
 WHEN 'reserve' THEN
  IF kind_value<>'restaurant' THEN PERFORM dg_native_dining_error('VALIDATION_FAILED');END IF;PERFORM dg_native_restaurant_fields(body,ARRAY['party','tableId','startsAt','endsAt','_ticket']);table_value:=dg_native_dining_booking_table(r,body);start_value:=dg_native_dining_iso(body->>'startsAt');end_value:=dg_native_dining_iso(body->>'endsAt');PERFORM dg_native_dining_new_party(meta,dining_action_identifier,body->'party',body->'_ticket',true,dg_native_people_iso(end_value::timestamptz+interval '24 hours'));
  PERFORM dg_native_dining_effect(dining_action_identifier,'restaurants',r.id);UPDATE restaurants SET booking_counter=booking_counter+1,updated_at=now_value WHERE id=r.id RETURNING booking_counter INTO counter_value;
  b.id:=gen_random_uuid()::text;PERFORM dg_native_dining_effect(dining_action_identifier,'dining_reservations',b.id);INSERT INTO dining_reservations(id,restaurant_id,party_id,table_id,reference,starts_at,ends_at,created_at) VALUES(b.id,r.id,party_value,table_value,'R-'||CASE WHEN length(counter_value::text)<6 THEN lpad(counter_value::text,6,'0') ELSE counter_value::text END,start_value,end_value,now_value);INSERT INTO _dg_native_dining_booking_clocks VALUES(b.id,1,start_value,end_value,dg_native_people_iso(start_value::timestamptz-interval '30 minutes'),dg_native_people_iso(start_value::timestamptz+make_interval(mins=>r.late_minutes::integer)),dining_action_identifier,now_value);PERFORM dg_native_dining_table_touch(dining_action_identifier,table_value);PERFORM dg_native_dining_touch(meta,dining_action_identifier,party_value,true);
 WHEN 'update' THEN
  PERFORM dg_native_restaurant_fields(body,ARRAY['name','size','visitMinutes','guestNote','version']);PERFORM dg_native_dining_fields(body-'version');IF p.version<>version_value THEN PERFORM dg_native_dining_error('VERSION_CONFLICT');END IF;IF p.status NOT IN('waiting','reserved') THEN PERFORM dg_native_dining_error('PARTY_ALREADY_ASSIGNED');END IF;
  SELECT * INTO b FROM dining_reservations WHERE party_id=p.id AND status IN('confirmed','checked_in');IF b.id IS NOT NULL THEN SELECT * INTO t FROM restaurant_tables WHERE id=b.table_id;IF NOT dg_native_dining_fits(t,(body->>'size')::bigint) THEN PERFORM dg_native_dining_error('BOOKING_CAPACITY');END IF;END IF;
  PERFORM dg_native_dining_effect(dining_action_identifier,'dining_parties',p.id);UPDATE dining_parties SET name=btrim(body->>'name'),size=(body->>'size')::bigint,visit_minutes=(body->>'visitMinutes')::bigint,guest_note=body->>'guestNote',version=version+1,updated_at=now_value WHERE id=p.id;PERFORM dg_native_dining_touch(meta,dining_action_identifier);
 WHEN 'reschedule' THEN
  PERFORM dg_native_restaurant_fields(body,ARRAY['party','tableId','startsAt','endsAt','version','partyVersion','_ticket']);SELECT * INTO b FROM dining_reservations WHERE id=target;party_version:=dg_native_restaurant_integer(body->'partyVersion',1,9007199254740991);
  IF b.version<>version_value OR p.version<>party_version THEN PERFORM dg_native_dining_error('VERSION_CONFLICT');END IF;IF b.status<>'confirmed' OR p.status<>'reserved' THEN PERFORM dg_native_dining_error('BOOKING_LOCKED');END IF;previous_table:=b.table_id;table_value:=dg_native_dining_booking_table(r,body,p.id);start_value:=dg_native_dining_iso(body->>'startsAt');end_value:=dg_native_dining_iso(body->>'endsAt');
  PERFORM dg_native_dining_ticket_fields(body->'_ticket',p.id);PERFORM dg_native_dining_effect(dining_action_identifier,'dining_reservations',b.id);UPDATE dining_reservations SET table_id=table_value,starts_at=start_value,ends_at=end_value,version=version+1 WHERE id=b.id;PERFORM dg_native_dining_effect(dining_action_identifier,'dining_parties',p.id);UPDATE dining_parties SET name=btrim(body->'party'->>'name'),size=(body->'party'->>'size')::bigint,visit_minutes=(body->'party'->>'visitMinutes')::bigint,guest_note=body->'party'->>'guestNote',claim_nonce=body->'_ticket'->>'nonce',claim_hash=body->'_ticket'->>'sha256',claim_expires_at=dg_native_people_iso(end_value::timestamptz+interval '24 hours'),access_version=access_version+1,version=version+1,updated_at=now_value WHERE id=p.id;
  INSERT INTO _dg_native_dining_booking_clocks VALUES(b.id,b.version+1,start_value,end_value,dg_native_people_iso(start_value::timestamptz-interval '30 minutes'),dg_native_people_iso(start_value::timestamptz+make_interval(mins=>r.late_minutes::integer)),dining_action_identifier,now_value);PERFORM dg_native_dining_table_touch(dining_action_identifier,previous_table);IF previous_table<>table_value THEN PERFORM dg_native_dining_table_touch(dining_action_identifier,table_value);END IF;PERFORM dg_native_dining_touch(meta,dining_action_identifier);
 WHEN 'check_in' THEN
  PERFORM dg_native_restaurant_fields(body,ARRAY['version']);SELECT * INTO b FROM dining_reservations WHERE id=target;IF b.version<>version_value THEN PERFORM dg_native_dining_error('VERSION_CONFLICT');END IF;
  booking_clock:=dg_native_dining_booking_clock(b.id);IF b.status<>'confirmed' OR p.status<>'reserved' OR booking_clock.reservation_id IS NULL OR now_value<booking_clock.checkin_opens_at OR now_value>booking_clock.late_deadline THEN PERFORM dg_native_dining_error('CHECK_IN_WINDOW');END IF;
  PERFORM dg_native_dining_effect(dining_action_identifier,'dining_reservations',b.id);UPDATE dining_reservations SET status='checked_in',version=version+1 WHERE id=b.id;counter_value:=dg_native_dining_queue(r,dining_action_identifier);PERFORM dg_native_dining_effect(dining_action_identifier,'dining_parties',p.id);UPDATE dining_parties SET status='waiting',queue_number=counter_value,queued_at=now_value,version=version+1,updated_at=now_value WHERE id=p.id;PERFORM dg_native_dining_table_touch(dining_action_identifier,b.table_id);PERFORM dg_native_dining_touch(meta,dining_action_identifier);
 WHEN 'plan' THEN
  PERFORM dg_native_restaurant_fields(body,ARRAY['partyId','version','tableId']);IF body->>'partyId' IS DISTINCT FROM p.id OR p.version<>version_value THEN PERFORM dg_native_dining_error('VERSION_CONFLICT');END IF;PERFORM dg_native_dining_plan(meta,p,body->>'tableId',dining_action_identifier,resource_value);PERFORM dg_native_dining_touch(meta,dining_action_identifier);
 WHEN 'hold' THEN
  PERFORM dg_native_restaurant_fields(body,ARRAY['planId','planHash']);SELECT * INTO plan FROM dining_hold_plans WHERE id=target;IF body->>'planId' IS DISTINCT FROM plan.id OR body->>'planHash' IS DISTINCT FROM plan.hash THEN PERFORM dg_native_dining_error('TABLE_PLAN_CHANGED');END IF;projection:=dg_native_dining_plan_projection(plan.id,meta);IF projection->'valid' IS DISTINCT FROM 'true'::jsonb THEN PERFORM dg_native_dining_error('TABLE_PLAN_CHANGED');END IF;PERFORM dg_native_dining_assert_open(r,now_value,plan.expected_end_at);
  o.id:=gen_random_uuid()::text;PERFORM dg_native_dining_effect(dining_action_identifier,'dining_occupancies',o.id);INSERT INTO dining_occupancies(id,restaurant_id,table_id,party_id,state,expires_at,expected_end_at,actor_id,created_at,updated_at) VALUES(o.id,r.id,plan.table_id,p.id,'held',least(dg_native_people_iso(now_value::timestamptz+make_interval(secs=>r.hold_seconds::double precision)),plan.expected_end_at),plan.expected_end_at,meta->>'actorId',now_value,now_value);INSERT INTO _dg_native_dining_occupancy_origins VALUES(o.id,plan.id,dining_action_identifier);PERFORM dg_native_dining_effect(dining_action_identifier,'dining_parties',p.id);UPDATE dining_parties SET status='held',version=version+1,updated_at=now_value WHERE id=p.id;PERFORM dg_native_dining_table_touch(dining_action_identifier,plan.table_id);PERFORM dg_native_dining_touch(meta,dining_action_identifier);
 WHEN 'seat','release' THEN
  PERFORM dg_native_restaurant_fields(body,ARRAY['version','partyVersion','_ticket']);SELECT * INTO o FROM dining_occupancies WHERE id=target;party_version:=dg_native_restaurant_integer(body->'partyVersion',1,9007199254740991);IF o.version<>version_value OR p.version<>party_version THEN PERFORM dg_native_dining_error('VERSION_CONFLICT');END IF;
  IF o.state<>'held' OR o.expires_at IS NULL OR o.expires_at<=now_value OR p.status<>'held' THEN PERFORM dg_native_dining_error('HOLD_EXPIRED');END IF;SELECT * INTO t FROM restaurant_tables WHERE id=o.table_id;
  PERFORM dg_native_dining_effect(dining_action_identifier,'dining_occupancies',o.id);PERFORM dg_native_dining_effect(dining_action_identifier,'dining_parties',p.id);
  IF action_value='release' THEN UPDATE dining_occupancies SET state='released',version=version+1,updated_at=now_value WHERE id=o.id;UPDATE dining_parties SET status='waiting',version=version+1,updated_at=now_value WHERE id=p.id;
  ELSE
   IF t.operation<>'open' OR NOT dg_native_dining_fits(t,p.size) OR dg_native_dining_conflict(r.id,t.id,now_value,o.expected_end_at,p.id) THEN PERFORM dg_native_dining_error('TABLE_CHANGED');END IF;PERFORM dg_native_dining_assert_open(r,now_value,o.expected_end_at);PERFORM dg_native_dining_ticket_fields(body->'_ticket',p.id);
   UPDATE dining_occupancies SET state='seated',expires_at=NULL,version=version+1,updated_at=now_value WHERE id=o.id;UPDATE dining_parties SET status='seated',seated_at=now_value,version=version+1,access_version=access_version+1,claim_nonce=body->'_ticket'->>'nonce',claim_hash=body->'_ticket'->>'sha256',updated_at=now_value WHERE id=p.id;
   SELECT * INTO b FROM dining_reservations WHERE party_id=p.id AND status='checked_in';IF b.id IS NOT NULL THEN PERFORM dg_native_dining_effect(dining_action_identifier,'dining_reservations',b.id);UPDATE dining_reservations SET status='seated',version=version+1 WHERE id=b.id;END IF;
  END IF;PERFORM dg_native_dining_table_touch(dining_action_identifier,t.id);PERFORM dg_native_dining_touch(meta,dining_action_identifier);
 WHEN 'cancel','finish' THEN
  PERFORM dg_native_restaurant_fields(body,ARRAY['version']);IF p.version<>version_value THEN PERFORM dg_native_dining_error('VERSION_CONFLICT');END IF;
  IF p.status NOT IN('waiting','reserved','held','seated') THEN PERFORM dg_native_dining_error('PARTY_ENDED');END IF;
  IF action_value='cancel' AND p.status='seated' THEN PERFORM dg_native_dining_error('PARTY_SEATED');END IF;
  IF action_value='finish' AND(meta->>'actorType'<>'staff' OR p.status<>'seated') THEN PERFORM dg_native_dining_error('FORBIDDEN');END IF;
  IF NOT dg_native_order_empty_finishable(p.id) THEN PERFORM dg_native_dining_error('FINANCIAL_PENDING');END IF;
  SELECT * INTO o FROM dining_occupancies WHERE party_id=p.id AND state IN('held','seated');IF o.id IS NOT NULL THEN PERFORM dg_native_dining_effect(dining_action_identifier,'dining_occupancies',o.id);UPDATE dining_occupancies SET state='released',version=version+1,updated_at=now_value WHERE id=o.id;PERFORM dg_native_dining_table_touch(dining_action_identifier,o.table_id,action_value='finish');END IF;
  SELECT * INTO b FROM dining_reservations WHERE party_id=p.id AND status IN('confirmed','checked_in','seated');IF b.id IS NOT NULL THEN PERFORM dg_native_dining_effect(dining_action_identifier,'dining_reservations',b.id);UPDATE dining_reservations SET status=CASE WHEN action_value='finish' THEN 'completed' ELSE 'cancelled' END,version=version+1 WHERE id=b.id;IF o.id IS NULL OR o.table_id<>b.table_id THEN PERFORM dg_native_dining_table_touch(dining_action_identifier,b.table_id);END IF;END IF;
  PERFORM dg_native_dining_effect(dining_action_identifier,'dining_parties',p.id);UPDATE dining_parties SET status=CASE WHEN action_value='finish' THEN 'completed' ELSE 'cancelled' END,version=version+1,access_version=access_version+1,ended_at=now_value,updated_at=now_value WHERE id=p.id;PERFORM dg_native_dining_touch(meta,dining_action_identifier);
 WHEN 'select' THEN
  PERFORM dg_native_restaurant_fields(body,ARRAY['version']);IF meta->>'actorType'<>'guest' THEN PERFORM dg_native_dining_error('FORBIDDEN');END IF;IF p.version<>version_value THEN PERFORM dg_native_dining_error('VERSION_CONFLICT');END IF;IF p.status NOT IN('waiting','reserved','held','seated') THEN PERFORM dg_native_dining_error('PARTY_ENDED');END IF;PERFORM dg_native_dining_touch(meta,dining_action_identifier,p.id,true);
 WHEN 'claim' THEN
  PERFORM dg_native_restaurant_fields(body,ARRAY['partyId','version','codeHash','_ticket']);IF meta->>'actorType'<>'guest' THEN PERFORM dg_native_dining_error('FORBIDDEN');END IF;SELECT * INTO p FROM dining_parties WHERE id=body->>'partyId' FOR UPDATE;
  IF p.id IS NULL OR p.restaurant_id<>r.id OR NOT EXISTS(SELECT 1 FROM _dg_native_dining_party_origins WHERE party_id=p.id) OR p.status NOT IN('waiting','reserved','held','seated') OR p.claim_expires_at<=now_value OR p.claim_hash IS DISTINCT FROM body->>'codeHash' OR p.version::text IS DISTINCT FROM body->>'version' THEN PERFORM dg_native_dining_error('INVALID_DINING_CLAIM');END IF;
  IF p.owner_session_id IS DISTINCT FROM session_value AND(SELECT count(*) FROM dining_parties WHERE owner_session_id=session_value AND restaurant_id=r.id AND status IN('waiting','reserved','held','seated'))>=5 THEN PERFORM dg_native_dining_error('PARTY_LIMIT');END IF;PERFORM dg_native_dining_ticket_fields(body->'_ticket',p.id);
  SELECT * INTO old_owner FROM reception_sessions WHERE id=p.owner_session_id;IF old_owner.id IS NOT NULL AND old_owner.id<>session_value AND old_owner.status IN('active','human') AND old_owner.dining_party_id=p.id THEN PERFORM dg_native_dining_effect(dining_action_identifier,'reception_sessions',old_owner.id);PERFORM dg_native_reception_cancel(old_owner.id);INSERT INTO _dg_native_dining_selection_revisions SELECT old_owner.id,coalesce(max(version),0)+1,NULL,dining_action_identifier,now_value FROM _dg_native_dining_selection_revisions WHERE session_id=old_owner.id;UPDATE reception_sessions SET dining_party_id=NULL,version=version+1,reply_epoch=reply_epoch+1 WHERE id=old_owner.id;END IF;
  PERFORM dg_native_dining_effect(dining_action_identifier,'dining_parties',p.id);UPDATE dining_parties SET owner_session_id=session_value,created_focus_version=focus_value,version=version+1,access_version=access_version+1,claim_nonce=body->'_ticket'->>'nonce',claim_hash=body->'_ticket'->>'sha256',updated_at=now_value WHERE id=p.id;PERFORM dg_native_dining_touch(meta,dining_action_identifier,p.id,true);
 END CASE;
 INSERT INTO outbox_events VALUES(gen_random_uuid()::text,r.tenant_id,r.workspace_id,party_value,'dining.'||action_value,'mock','{}',now_value,NULL);RETURN dining_action_identifier;
END;$dg$;


DO $order_acl$ DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND p.proname LIKE 'dg_native_order_%' LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||f.signature||' FROM PUBLIC';END LOOP;END;$order_acl$;
