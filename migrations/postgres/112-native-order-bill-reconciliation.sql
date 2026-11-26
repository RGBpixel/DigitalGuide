-- Verified contradictory POS facts must also project the bill reconciliation state.
-- Keep original payment postings and completed party/table history unchanged.
CREATE OR REPLACE FUNCTION dg_native_order_receipt_conflict(change_value text,event_value text,action_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE c restaurant_order_changes%ROWTYPE;d restaurant_order_dispatches%ROWTYPE;created text;message_value text:='可信回执与已有结果或本地业务投影冲突；原请求、库存和回执保留，请由店员向POS核对，不能自动重发。';
BEGIN
 SELECT * INTO c FROM restaurant_order_changes WHERE id=change_value;SELECT * INTO d FROM restaurant_order_dispatches WHERE change_id=c.id;SELECT created_at INTO created FROM _dg_native_dining_actions WHERE id=action_value;
 PERFORM dg_native_dining_effect(action_value,'restaurant_pos_callbacks',event_value);UPDATE restaurant_pos_callbacks SET conflict=1 WHERE event_id=event_value;
 PERFORM dg_native_dining_effect(action_value,'restaurant_order_dispatches',c.id);UPDATE restaurant_order_dispatches SET status=CASE WHEN status IN('accepted','rejected') THEN status ELSE 'unknown' END,error_code='POS_RECONCILIATION_REQUIRED',error_message=message_value,lease_token=NULL,lease_until=NULL,query_requested=0,version=version+1,updated_at=created WHERE change_id=c.id;
 IF c.status NOT IN('accepted','rejected') THEN PERFORM dg_native_dining_effect(action_value,'restaurant_order_changes',c.id);UPDATE restaurant_order_changes SET status='unknown',version=version+1,updated_at=created WHERE id=c.id;END IF;
 PERFORM dg_native_dining_effect(action_value,'restaurant_orders',c.order_id);UPDATE restaurant_orders SET control_mode='human',attention_reason=message_value,status='needs_attention',version=version+1,updated_at=created WHERE id=c.order_id;PERFORM dg_native_order_event(action_value,c.order_id,c.id,'order_receipt',message_value);
 PERFORM dg_native_bill_order_changed(action_value,c.order_id);
 RETURN jsonb_build_object('duplicate',false,'applied',false,'conflict',true);
END;$dg$;

