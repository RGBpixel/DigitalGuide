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
