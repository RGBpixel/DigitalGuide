CREATE FUNCTION dg_native_order_receipt_conflict(change_value text,event_value text,action_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE c restaurant_order_changes%ROWTYPE;d restaurant_order_dispatches%ROWTYPE;created text;message_value text:='可信回执与已有结果或本地业务投影冲突；原请求、库存和回执保留，请由店员向POS核对，不能自动重发。';
BEGIN
 SELECT * INTO c FROM restaurant_order_changes WHERE id=change_value;SELECT * INTO d FROM restaurant_order_dispatches WHERE change_id=c.id;SELECT created_at INTO created FROM _dg_native_dining_actions WHERE id=action_value;
 PERFORM dg_native_dining_effect(action_value,'restaurant_pos_callbacks',event_value);UPDATE restaurant_pos_callbacks SET conflict=1 WHERE event_id=event_value;
 PERFORM dg_native_dining_effect(action_value,'restaurant_order_dispatches',c.id);UPDATE restaurant_order_dispatches SET status=CASE WHEN status IN('accepted','rejected') THEN status ELSE 'unknown' END,error_code='POS_RECONCILIATION_REQUIRED',error_message=message_value,lease_token=NULL,lease_until=NULL,query_requested=0,version=version+1,updated_at=created WHERE change_id=c.id;
 IF c.status NOT IN('accepted','rejected') THEN PERFORM dg_native_dining_effect(action_value,'restaurant_order_changes',c.id);UPDATE restaurant_order_changes SET status='unknown',version=version+1,updated_at=created WHERE id=c.id;END IF;
 PERFORM dg_native_dining_effect(action_value,'restaurant_orders',c.order_id);UPDATE restaurant_orders SET control_mode='human',attention_reason=message_value,status='needs_attention',version=version+1,updated_at=created WHERE id=c.order_id;PERFORM dg_native_order_event(action_value,c.order_id,c.id,'order_receipt',message_value);
 RETURN jsonb_build_object('duplicate',false,'applied',false,'conflict',true);
END;$dg$;

CREATE FUNCTION dg_native_order_receipt_business(change_value text,event_value text,action_value text,status_value text,receipt jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE c restaurant_order_changes%ROWTYPE;o restaurant_orders%ROWTYPE;q restaurant_order_quotes%ROWTYPE;hold restaurant_inventory_reservations%ROWTYPE;line restaurant_order_lines%ROWTYPE;ticket restaurant_kitchen_tickets%ROWTYPE;snapshot jsonb;item jsonb;created text;ticket_value text;current_total bigint;changed boolean:=false;
BEGIN
 SELECT * INTO c FROM restaurant_order_changes WHERE id=change_value;SELECT * INTO o FROM restaurant_orders WHERE id=c.order_id;SELECT * INTO q FROM restaurant_order_quotes WHERE id=c.confirmed_quote_id;snapshot:=q.payload::jsonb;SELECT created_at INTO created FROM _dg_native_dining_actions WHERE id=action_value;
 SELECT coalesce(sum((quantity-cancelled_quantity)*unit_price_minor),0) INTO current_total FROM restaurant_order_lines WHERE order_id=o.id;
 IF q.id IS NULL OR o.pending_change_id IS DISTINCT FROM c.id OR o.content_version<>(snapshot->>'contentVersion')::bigint OR current_total<>(snapshot->>'oldTotalMinor')::bigint THEN PERFORM dg_native_order_error('ORDER_DATA_INCOMPLETE');END IF;
 IF status_value='accepted' THEN
  FOR hold IN SELECT reservation.* FROM restaurant_inventory_reservations reservation JOIN _dg_native_order_reservation_origins origin ON origin.reservation_id=reservation.id WHERE reservation.change_id=c.id AND reservation.status='reserved' ORDER BY reservation.sku_id FOR UPDATE OF reservation LOOP
   PERFORM dg_native_dining_effect(action_value,'restaurant_inventory_reservations',hold.id);UPDATE restaurant_inventory_reservations SET status='committed',updated_at=created WHERE id=hold.id;
  END LOOP;
  FOR item IN SELECT * FROM jsonb_array_elements(snapshot->'lines') WHERE value->>'operation'='reduce' ORDER BY value->>'lineId' LOOP
   SELECT * INTO line FROM restaurant_order_lines WHERE id=item->>'lineId' AND order_id=o.id FOR UPDATE;SELECT * INTO ticket FROM restaurant_kitchen_tickets WHERE line_id=line.id FOR UPDATE;
   IF line.id IS NULL OR ticket.id IS NULL OR ticket.pending_cancel_quantity<(item->>'quantity')::bigint OR line.quantity-line.cancelled_quantity-ticket.started_quantity<(item->>'quantity')::bigint THEN PERFORM dg_native_order_error('KITCHEN_QUANTITY_CHANGED');END IF;
   PERFORM dg_native_dining_effect(action_value,'restaurant_order_lines',line.id);UPDATE restaurant_order_lines SET cancelled_quantity=cancelled_quantity+(item->>'quantity')::bigint WHERE id=line.id;
   PERFORM dg_native_dining_effect(action_value,'restaurant_kitchen_tickets',ticket.id);UPDATE restaurant_kitchen_tickets SET pending_cancel_quantity=pending_cancel_quantity-(item->>'quantity')::bigint,version=version+1,updated_at=created WHERE id=ticket.id;
  END LOOP;
  -- Return each original tracked SKU once for trusted, accepted reductions.
  FOR item IN SELECT jsonb_build_object('skuId',value->>'skuId','quantity',sum((value->>'quantity')::bigint)) FROM jsonb_array_elements(snapshot->'lines') WHERE value->>'operation'='reduce' AND(value->>'tracked')::boolean GROUP BY value->>'skuId' ORDER BY value->>'skuId' LOOP
   PERFORM dg_native_order_stock_move(action_value,c.id,item->>'skuId',(item->>'quantity')::bigint,'cancel_return');changed:=true;
  END LOOP;
  IF changed THEN PERFORM dg_native_dining_effect(action_value,'restaurants',o.restaurant_id);UPDATE restaurants SET menu_version=menu_version+1,updated_at=created WHERE id=o.restaurant_id;END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(snapshot->'lines') WHERE value->>'operation'='add' LOOP
   PERFORM dg_native_dining_effect(action_value,'restaurant_order_lines',item->>'lineId');INSERT INTO restaurant_order_lines(id,order_id,change_id,item_id,sku_id,item_name,sku_name,unit_price_minor,quantity,preparation_note,dietary_tags,stock_tracked,created_at) VALUES(item->>'lineId',o.id,c.id,item->>'itemId',item->>'skuId',item->>'itemName',item->>'skuName',(item->>'unitPriceMinor')::bigint,(item->>'quantity')::bigint,item->>'preparationNote',(item->'dietaryTags')::text,CASE WHEN(item->>'tracked')::boolean THEN 1 ELSE 0 END,created);
   INSERT INTO _dg_native_order_line_origins VALUES(item->>'lineId',c.id,event_value,q.id,dg_native_office_hash(item),(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1));
   ticket_value:=gen_random_uuid()::text;PERFORM dg_native_dining_effect(action_value,'restaurant_kitchen_tickets',ticket_value);INSERT INTO restaurant_kitchen_tickets(id,restaurant_id,order_id,line_id,table_id,table_name,table_code,accepted_at,updated_at) VALUES(ticket_value,o.restaurant_id,o.id,item->>'lineId',snapshot->>'tableId',snapshot->>'tableName',snapshot->>'tableCode',created,created);INSERT INTO _dg_native_order_kitchen_origins VALUES(ticket_value,item->>'lineId',event_value,(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1));
  END LOOP;
  SELECT coalesce(sum((quantity-cancelled_quantity)*unit_price_minor),0) INTO current_total FROM restaurant_order_lines WHERE order_id=o.id;IF current_total<>(snapshot->>'newTotalMinor')::bigint THEN PERFORM dg_native_order_error('ORDER_AMOUNT_INVALID');END IF;
 ELSE PERFORM dg_native_order_inventory(action_value,c.id,q.id,false);END IF;
 PERFORM dg_native_dining_effect(action_value,'restaurant_order_quotes',q.id);UPDATE restaurant_order_quotes SET status=status_value WHERE id=q.id;
 PERFORM dg_native_dining_effect(action_value,'restaurant_order_changes',c.id);UPDATE restaurant_order_changes SET status=status_value,version=version+1,updated_at=created WHERE id=c.id;
 PERFORM dg_native_dining_effect(action_value,'restaurant_order_dispatches',c.id);UPDATE restaurant_order_dispatches SET status=status_value,last_sequence=(receipt->>'sequence')::bigint,remote_request_id=receipt->>'remoteRequestId',remote_order_id=receipt->>'remoteOrderId',lease_token=NULL,lease_until=NULL,query_requested=0,error_code=CASE WHEN status_value='rejected' THEN 'POS_REJECTED' END,error_message=CASE WHEN status_value='rejected' THEN '模拟后厨明确拒绝本次变更，预占已释放。' END,version=version+1,updated_at=created WHERE change_id=c.id;
 PERFORM dg_native_dining_effect(action_value,'restaurant_orders',o.id);UPDATE restaurant_orders SET pending_change_id=NULL,content_version=content_version+CASE WHEN status_value='accepted' THEN 1 ELSE 0 END,remote_order_id=CASE WHEN status_value='accepted' THEN receipt->>'remoteOrderId' ELSE remote_order_id END,status=CASE WHEN NOT EXISTS(SELECT 1 FROM restaurant_order_lines WHERE order_id=o.id AND quantity>cancelled_quantity) THEN CASE WHEN EXISTS(SELECT 1 FROM restaurant_order_lines WHERE order_id=o.id) THEN 'cancelled' ELSE 'draft' END ELSE 'accepted' END,attention_reason=NULL,version=version+1,updated_at=created WHERE id=o.id;
 PERFORM dg_native_dining_effect(action_value,'restaurant_pos_callbacks',event_value);UPDATE restaurant_pos_callbacks SET applied=1 WHERE event_id=event_value;PERFORM dg_native_order_event(action_value,o.id,c.id,'order_receipt',CASE WHEN status_value='accepted' THEN '模拟后厨已确认，价格快照和制作项目已持久保存，尚未结算。' ELSE '模拟后厨明确拒绝此次变更，原已接单内容保留。' END);
END;$dg$;

CREATE FUNCTION dg_native_order_receipt_apply(event_value text,receipt jsonb,ingress_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE d restaurant_order_dispatches%ROWTYPE;c restaurant_order_changes%ROWTYPE;o restaurant_orders%ROWTYPE;previous restaurant_pos_callbacks%ROWTYPE;payload_hash_value text;action_value text;created text;status_value text:=receipt->>'status';sequence_value bigint;request jsonb;failure_code text;failure_context text;
BEGIN
 PERFORM dg_native_reception_runtime(true);PERFORM dg_native_restaurant_fields(receipt,ARRAY['requestId','requestHash','restaurantId','remoteRequestId','remoteOrderId','status','sequence','simulated','reasonCode']);sequence_value:=dg_native_restaurant_integer(receipt->'sequence',1,9007199254740991);
 IF event_value IS NULL OR event_value!~'^[a-f0-9-]{36}$' OR ingress_value NOT IN('worker','callback') OR status_value NOT IN('submitted','accepted','rejected') OR receipt->'simulated' IS DISTINCT FROM 'true'::jsonb THEN PERFORM dg_native_order_error('VALIDATION_FAILED');END IF;
 PERFORM dg_native_order_transport_lock(receipt->>'requestId');SELECT * INTO d FROM restaurant_order_dispatches WHERE change_id=receipt->>'requestId';SELECT * INTO c FROM restaurant_order_changes WHERE id=d.change_id;SELECT * INTO o FROM restaurant_orders WHERE id=c.order_id;request:=d.request_payload::jsonb;
 IF d.change_id IS NULL OR d.request_hash IS DISTINCT FROM receipt->>'requestHash' OR d.restaurant_id IS DISTINCT FROM receipt->>'restaurantId' OR d.provider_id<>'mock-pos' OR d.simulated<>1 OR receipt->>'remoteRequestId' IS DISTINCT FROM 'mock-pos:'||d.change_id OR receipt->>'remoteOrderId' IS DISTINCT FROM coalesce(request->>'remoteOrderId','mock-order:'||o.id) THEN PERFORM dg_native_order_error('POS_RECEIPT_MISMATCH');END IF;
 IF d.attempts<>1 THEN PERFORM dg_native_order_error('POS_REQUEST_NOT_SENT');END IF;
 payload_hash_value:=dg_native_office_hash(jsonb_build_object('eventId',event_value,'receipt',receipt));SELECT * INTO previous FROM restaurant_pos_callbacks WHERE event_id=event_value;
 IF previous.event_id IS NOT NULL THEN IF previous.payload_hash<>payload_hash_value THEN PERFORM dg_native_order_error('POS_EVENT_CONFLICT');END IF;RETURN jsonb_build_object('duplicate',true,'applied',previous.applied=1,'conflict',previous.conflict=1);END IF;
 action_value:=dg_native_order_transport_action(c.id,'order_receipt');SELECT created_at INTO created FROM _dg_native_dining_actions WHERE id=action_value;PERFORM dg_native_dining_effect(action_value,'restaurant_pos_callbacks',event_value);INSERT INTO restaurant_pos_callbacks VALUES(event_value,c.id,payload_hash_value,receipt::text,status_value,sequence_value,0,0,created);INSERT INTO _dg_native_order_receipt_origins VALUES(event_value,action_value,(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1),d.request_hash,dg_native_office_hash(receipt),ingress_value,created);
 IF d.status IN('accepted','rejected') THEN
  IF status_value IN('accepted','rejected') AND status_value<>d.status THEN RETURN dg_native_order_receipt_conflict(c.id,event_value,action_value);END IF;
  IF status_value=d.status AND sequence_value>d.last_sequence THEN PERFORM dg_native_dining_effect(action_value,'restaurant_order_dispatches',c.id);UPDATE restaurant_order_dispatches SET last_sequence=sequence_value,version=version+1,updated_at=created WHERE change_id=c.id;END IF;RETURN jsonb_build_object('duplicate',false,'applied',false,'conflict',false);
 END IF;
 IF d.error_code='POS_RECONCILIATION_REQUIRED' OR d.status NOT IN('submitting','submitted','unknown') THEN RETURN dg_native_order_receipt_conflict(c.id,event_value,action_value);END IF;
 IF sequence_value<=d.last_sequence THEN
  IF status_value IN('accepted','rejected') THEN RETURN dg_native_order_receipt_conflict(c.id,event_value,action_value);END IF;RETURN jsonb_build_object('duplicate',false,'applied',false,'conflict',false);
 END IF;
 IF status_value='submitted' THEN
  PERFORM dg_native_dining_effect(action_value,'restaurant_order_dispatches',c.id);UPDATE restaurant_order_dispatches SET status='submitted',last_sequence=sequence_value,remote_request_id=receipt->>'remoteRequestId',remote_order_id=receipt->>'remoteOrderId',lease_token=NULL,lease_until=NULL,error_code=NULL,error_message=NULL,query_requested=0,version=version+1,updated_at=created WHERE change_id=c.id;PERFORM dg_native_order_transport_state(c.id,action_value,'submitted','模拟渠道已接收原请求，仍等待后厨确认。');UPDATE restaurant_pos_callbacks SET applied=1 WHERE event_id=event_value;RETURN jsonb_build_object('duplicate',false,'applied',true,'conflict',false);
 END IF;
 BEGIN
  PERFORM dg_native_order_receipt_business(c.id,event_value,action_value,status_value,receipt);
  -- Catch deferred business invariant failures before returning success, while
  -- retaining the trusted receipt outside this subtransaction.
  SET CONSTRAINTS ALL IMMEDIATE;SET CONSTRAINTS ALL DEFERRED;
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS failure_code=RETURNED_SQLSTATE,failure_context=PG_EXCEPTION_CONTEXT;
  INSERT INTO _dg_native_order_receipt_failures VALUES(event_value,failure_code,coalesce(substring(failure_context FROM 'PL/pgSQL function [a-z_]+\([^\n]*line [0-9]+'),'business invariant'),created);
  RETURN dg_native_order_receipt_conflict(c.id,event_value,action_value);
 END;
 RETURN jsonb_build_object('duplicate',false,'applied',true,'conflict',false);
END;$dg$;

CREATE FUNCTION dg_native_order_worker_complete(change_value text,lease_value text,receipt jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE context jsonb;action_value text;created text;mode_value text;
BEGIN
 PERFORM dg_native_order_transport_lock(change_value);context:=dg_native_order_worker_context(change_value,lease_value);
 IF receipt IS NOT NULL THEN IF receipt->>'requestId' IS DISTINCT FROM change_value OR receipt->>'requestHash' IS DISTINCT FROM context->>'requestHash' THEN PERFORM dg_native_order_error('POS_RECEIPT_MISMATCH');END IF;RETURN dg_native_order_receipt_apply(gen_random_uuid()::text,receipt,'worker');END IF;
 action_value:=dg_native_order_transport_action(change_value,'order_unknown');SELECT created_at INTO created FROM _dg_native_dining_actions WHERE id=action_value;PERFORM dg_native_dining_effect(action_value,'restaurant_order_dispatches',change_value);UPDATE restaurant_order_dispatches SET status='unknown',lease_token=NULL,lease_until=NULL,error_code='POS_RESULT_UNKNOWN',error_message='原请求结果尚未核实，库存与请求保留；仅可查询原请求或联系店员。',query_requested=0,version=version+1,updated_at=created WHERE change_id=change_value;PERFORM dg_native_order_transport_state(change_value,action_value,'unknown','原请求结果未知，未释放库存，也不会自动另发新单。');RETURN jsonb_build_object('duplicate',false,'applied',false,'conflict',false);
END;$dg$;
