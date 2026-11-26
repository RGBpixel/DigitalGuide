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
