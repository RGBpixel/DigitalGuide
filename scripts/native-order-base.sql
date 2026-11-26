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
