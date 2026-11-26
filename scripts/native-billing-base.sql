CREATE TABLE _dg_native_bill_origins(bill_id text PRIMARY KEY REFERENCES restaurant_bills(id),order_id text NOT NULL UNIQUE REFERENCES restaurant_orders(id),party_id text NOT NULL REFERENCES dining_parties(id),runtime_id text NOT NULL,action_id text NOT NULL UNIQUE REFERENCES _dg_native_dining_actions(id),created_at text NOT NULL);
CREATE TABLE _dg_native_bill_revisions(bill_id text NOT NULL REFERENCES restaurant_bills(id),version bigint NOT NULL,action_id text NOT NULL REFERENCES _dg_native_dining_actions(id),row_hash text NOT NULL,created_at text NOT NULL,PRIMARY KEY(bill_id,version));
CREATE TABLE _dg_native_bill_quote_origins(quote_id text PRIMARY KEY REFERENCES restaurant_financial_quotes(id),action_id text NOT NULL UNIQUE REFERENCES _dg_native_dining_actions(id),runtime_id text NOT NULL,actor_meta jsonb NOT NULL,confirmation_hash text NOT NULL CHECK(confirmation_hash~'^[a-f0-9]{64}$'),payload_hash text NOT NULL,created_at text NOT NULL,expires_at text NOT NULL);
CREATE TABLE _dg_native_bill_operation_origins(operation_id text PRIMARY KEY REFERENCES restaurant_financial_operations(id),action_id text NOT NULL UNIQUE REFERENCES _dg_native_dining_actions(id),quote_id text NOT NULL UNIQUE REFERENCES restaurant_financial_quotes(id),runtime_id text NOT NULL,request_hash text NOT NULL,created_at text NOT NULL);
CREATE TABLE _dg_native_bill_results(action_id text PRIMARY KEY REFERENCES _dg_native_dining_actions(id),restaurant_id text NOT NULL REFERENCES restaurants(id),bill_id text REFERENCES restaurant_bills(id),party_access_version bigint,created_at text NOT NULL);
CREATE TABLE _dg_native_bill_config_revisions(restaurant_id text NOT NULL REFERENCES restaurants(id),version bigint NOT NULL,action_id text NOT NULL UNIQUE REFERENCES _dg_native_dining_actions(id),provider_id text NOT NULL,enabled bigint NOT NULL,merchant_id text NOT NULL,scenario text NOT NULL,created_at text NOT NULL,PRIMARY KEY(restaurant_id,version));
CREATE TABLE _dg_native_bill_worker_leases(lease_token text PRIMARY KEY,operation_id text NOT NULL REFERENCES restaurant_financial_operations(id),mode text NOT NULL CHECK(mode IN('send','query','close','simulate')),request_hash text NOT NULL,runtime_id text NOT NULL,action_id text NOT NULL UNIQUE REFERENCES _dg_native_dining_actions(id),created_at text NOT NULL,expires_at text NOT NULL);
CREATE TABLE _dg_native_bill_receipt_origins(event_id text PRIMARY KEY REFERENCES restaurant_financial_receipts(event_id),action_id text NOT NULL UNIQUE REFERENCES _dg_native_dining_actions(id),runtime_id text NOT NULL,request_hash text NOT NULL,receipt_hash text NOT NULL,ingress text NOT NULL CHECK(ingress IN('worker','callback','mock_fixture')),created_at text NOT NULL);
CREATE TABLE _dg_native_bill_posting_origins(posting_id text PRIMARY KEY REFERENCES restaurant_financial_postings(id),event_id text NOT NULL UNIQUE REFERENCES restaurant_financial_receipts(event_id),operation_id text NOT NULL UNIQUE REFERENCES restaurant_financial_operations(id),runtime_id text NOT NULL,action_id text NOT NULL UNIQUE REFERENCES _dg_native_dining_actions(id));
CREATE TABLE _dg_native_bill_mock_revisions(operation_id text NOT NULL REFERENCES mock_financial_operations(operation_id),sequence bigint NOT NULL,action_id text NOT NULL UNIQUE REFERENCES _dg_native_dining_actions(id),row_hash text NOT NULL,created_at text NOT NULL,PRIMARY KEY(operation_id,sequence));
CREATE TABLE _dg_native_bill_action_origins(action_id text PRIMARY KEY REFERENCES _dg_native_dining_actions(id),operation_id text NOT NULL REFERENCES restaurant_financial_operations(id),mode text NOT NULL CHECK(mode IN('query','close','simulate')),actor_meta jsonb NOT NULL,created_at text NOT NULL);
CREATE TABLE _dg_native_bill_receipt_failures(event_id text PRIMARY KEY REFERENCES restaurant_financial_receipts(event_id),sqlstate text NOT NULL CHECK(length(sqlstate)=5),failure_site text NOT NULL,created_at text NOT NULL);
DO $bill_immutable$ DECLARE table_value text;BEGIN FOREACH table_value IN ARRAY ARRAY['_dg_native_bill_origins','_dg_native_bill_revisions','_dg_native_bill_quote_origins','_dg_native_bill_operation_origins','_dg_native_bill_results','_dg_native_bill_config_revisions','_dg_native_bill_worker_leases','_dg_native_bill_receipt_origins','_dg_native_bill_posting_origins','_dg_native_bill_mock_revisions','_dg_native_bill_action_origins','_dg_native_bill_receipt_failures'] LOOP EXECUTE format('CREATE TRIGGER native_bill_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION dg_native_append_only()',table_value);END LOOP;END;$bill_immutable$;

CREATE FUNCTION dg_native_bill_error(code_value text) RETURNS void LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$ BEGIN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='DGBILL:'||code_value;END;$dg$;
CREATE FUNCTION dg_native_bill_manager(meta jsonb) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT meta->>'actorType'='staff' AND dg_native_dining_clock_authority(meta->>'actorId',meta->>'restaurantId',(meta->>'actorEpoch')::bigint,(meta->>'grantVersion')::bigint) AND EXISTS(SELECT 1 FROM memberships member WHERE member.user_id=meta->>'actorId' AND(member.role='admin' OR EXISTS(SELECT 1 FROM restaurant_staff staff WHERE staff.restaurant_id=meta->>'restaurantId' AND staff.user_id=member.user_id AND staff.role='manager' AND staff.enabled=1 AND staff.version=(meta->>'grantVersion')::bigint AND(staff.expires_at IS NULL OR staff.expires_at>dg_native_dining_now()))))
$dg$;

CREATE FUNCTION dg_native_bill_context(kind_value text,target text,session_value text DEFAULT NULL,token_value text DEFAULT NULL,csrf_value text DEFAULT NULL,focus_value bigint DEFAULT NULL,write_value boolean DEFAULT false,historical_value boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE order_value text;bill_value text;operation_value text;quote_value text;meta jsonb;p dining_parties%ROWTYPE;
BEGIN
 IF kind_value='restaurant' THEN RETURN dg_native_dining_context('restaurant',target,session_value,token_value,csrf_value,focus_value,write_value);END IF;
 IF kind_value='party' THEN meta:=dg_native_order_context('party',target,session_value,token_value,csrf_value,focus_value,write_value);RETURN meta||jsonb_build_object('billId',NULL,'operationId',NULL,'quoteId',NULL);END IF;
 IF kind_value='order' THEN order_value:=target;SELECT bill_id INTO bill_value FROM _dg_native_bill_origins WHERE order_id=target;
 ELSIF kind_value='bill' THEN SELECT order_id,bill_id INTO order_value,bill_value FROM _dg_native_bill_origins WHERE bill_id=target;
 ELSIF kind_value='quote' THEN quote_value:=target;SELECT fixed.order_id,fixed.bill_id INTO order_value,bill_value FROM restaurant_financial_quotes quote JOIN _dg_native_bill_quote_origins origin ON origin.quote_id=quote.id JOIN _dg_native_bill_origins fixed ON fixed.bill_id=quote.bill_id WHERE quote.id=target;
 ELSIF kind_value='operation' THEN operation_value:=target;SELECT fixed.order_id,fixed.bill_id INTO order_value,bill_value FROM restaurant_financial_operations operation JOIN _dg_native_bill_operation_origins origin ON origin.operation_id=operation.id JOIN _dg_native_bill_origins fixed ON fixed.bill_id=operation.bill_id WHERE operation.id=target;ELSE PERFORM dg_native_bill_error('VALIDATION_FAILED');END IF;
 IF order_value IS NULL THEN PERFORM dg_native_bill_error('NOT_FOUND');END IF;
 meta:=dg_native_order_context('order',order_value,session_value,token_value,csrf_value,focus_value,write_value AND NOT(historical_value AND session_value IS NULL));
 IF write_value AND historical_value AND session_value IS NULL THEN
  meta:=meta||dg_native_dining_context('restaurant',meta->>'restaurantId',NULL,NULL,NULL,NULL,true);SELECT * INTO p FROM dining_parties WHERE id=(SELECT party_id FROM restaurant_orders WHERE id=order_value) FOR UPDATE;meta:=meta||jsonb_build_object('orderId',order_value,'partyId',p.id,'partyVersion',p.version,'partyAccessVersion',p.access_version);
 END IF;
 RETURN meta||jsonb_build_object('billId',bill_value,'operationId',operation_value,'quoteId',quote_value);
END;$dg$;

CREATE FUNCTION dg_native_bill_connection(target text,manager_value boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE config restaurant_payment_configs%ROWTYPE;configured_value boolean;
BEGIN SELECT * INTO config FROM restaurant_payment_configs WHERE restaurant_id=target;configured_value:=coalesce(config.enabled=1 AND config.provider_id='mock-payments',false);RETURN jsonb_build_object('restaurantId',target,'providerId',config.provider_id,'enabled',coalesce(config.enabled=1,false),'scenario',CASE WHEN config.restaurant_id IS NOT NULL THEN config.scenario END,'version',coalesce(config.version,0),'configured',configured_value,'simulated',coalesce(config.provider_id='mock-payments',false),'mockAllowed',true,'canManage',manager_value,'notice',CASE WHEN configured_value THEN '明确本地模拟收银与退款，没有真实资金往来。' WHEN config.provider_id='external-payments' THEN '真实支付尚未接通，不能回退为模拟成功。' ELSE '请经理配置明确的本地模拟支付连接，或接入并验证真实支付。' END);END;$dg$;

CREATE FUNCTION dg_native_bill_totals(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE b restaurant_bills%ROWTYPE;paid bigint;refunded bigint;reserved bigint;payments bigint;refunds bigint;
BEGIN
 SELECT * INTO b FROM restaurant_bills WHERE id=target;SELECT coalesce(sum(amount_minor) FILTER(WHERE kind='payment'),0),coalesce(sum(amount_minor) FILTER(WHERE kind='refund'),0) INTO paid,refunded FROM restaurant_financial_postings WHERE bill_id=b.id;
 SELECT count(*) FILTER(WHERE kind='payment'),count(*) FILTER(WHERE kind='refund'),coalesce(sum(amount_minor) FILTER(WHERE kind='refund' AND NOT EXISTS(SELECT 1 FROM restaurant_financial_postings posting WHERE posting.operation_id=operation.id)),0) INTO payments,refunds,reserved FROM restaurant_financial_operations operation WHERE bill_id=b.id AND status IN('queued','submitting','pending','unknown','needs_attention');
 RETURN jsonb_build_object('paid',paid,'refunded',refunded,'reserved',reserved,'activePayments',payments,'activeRefunds',refunds,'balance',b.amount_minor-paid);
END;$dg$;

CREATE FUNCTION dg_native_bill_refundable(payment_value text,except_value text DEFAULT '') RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT CASE WHEN payment.kind='payment' AND EXISTS(SELECT 1 FROM restaurant_financial_postings posting WHERE posting.operation_id=payment.id AND posting.kind='payment') THEN greatest(0,payment.amount_minor-(SELECT coalesce(sum(refund.amount_minor),0) FROM restaurant_financial_operations refund WHERE refund.parent_payment_id=payment.id AND refund.id<>except_value AND(refund.status IN('queued','submitting','pending','unknown','needs_attention') OR EXISTS(SELECT 1 FROM restaurant_financial_postings posting WHERE posting.operation_id=refund.id)))) ELSE 0 END FROM restaurant_financial_operations payment WHERE payment.id=payment_value
$dg$;

CREATE FUNCTION dg_native_bill_lines(order_value text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT coalesce(jsonb_agg(jsonb_build_object('lineId',line.id,'itemName',line.item_name,'skuName',line.sku_name,'unitPriceMinor',line.unit_price_minor,'quantity',line.quantity-line.cancelled_quantity,'subtotalMinor',(line.quantity-line.cancelled_quantity)*line.unit_price_minor) ORDER BY line.created_at,line.id),'[]') FROM restaurant_order_lines line JOIN _dg_native_order_line_origins fixed ON fixed.line_id=line.id WHERE line.order_id=order_value AND line.quantity>line.cancelled_quantity
$dg$;

CREATE FUNCTION dg_native_bill_payment_reason(order_value text,meta jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE o restaurant_orders%ROWTYPE;p dining_parties%ROWTYPE;
BEGIN SELECT * INTO o FROM restaurant_orders WHERE id=order_value;SELECT * INTO p FROM dining_parties WHERE id=o.party_id;
 IF p.status<>'seated' OR NOT EXISTS(SELECT 1 FROM dining_occupancies WHERE party_id=p.id AND state='seated') THEN RETURN '请先核对本次实际入座与当前桌位。';END IF;
 IF o.pending_change_id IS NOT NULL OR o.control_mode<>'automatic' OR EXISTS(SELECT 1 FROM restaurant_order_dispatches dispatch JOIN restaurant_order_changes change ON change.id=dispatch.change_id WHERE change.order_id=o.id AND(dispatch.status IN('queued','submitting','submitted','unknown') OR dispatch.error_code='POS_RECONCILIATION_REQUIRED')) THEN RETURN '订单仍有变更、未知派单或人工核对，请先确认实际接单明细。';END IF;
 IF meta->>'actorType'='guest' AND NOT dg_native_order_source(meta,p.id) THEN RETURN '本次会话、发问人、选择或就餐归属已经变化。';END IF;RETURN NULL;
END;$dg$;

CREATE FUNCTION dg_native_bill_event(action_value text,bill_value text,operation_value text,message_value text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE id_value text:=gen_random_uuid()::text;a _dg_native_dining_actions%ROWTYPE;
BEGIN SELECT * INTO a FROM _dg_native_dining_actions WHERE id=action_value;PERFORM dg_native_dining_effect(a.id,'restaurant_financial_events',id_value);INSERT INTO restaurant_financial_events VALUES(id_value,bill_value,operation_value,a.actor_id,a.kind,jsonb_build_object('message',message_value)::text,a.created_at);END;$dg$;
