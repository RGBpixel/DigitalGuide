-- Preserve frozen 108; take the original exclusive lock before historical reads.
-- Keep the manager membership tenant condition explicit alongside clock authority.
CREATE OR REPLACE FUNCTION dg_native_bill_context(kind_value text,target text,session_value text DEFAULT NULL,token_value text DEFAULT NULL,csrf_value text DEFAULT NULL,focus_value bigint DEFAULT NULL,write_value boolean DEFAULT false,historical_value boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE order_value text;bill_value text;operation_value text;quote_value text;meta jsonb;p dining_parties%ROWTYPE;
BEGIN
 IF kind_value='restaurant' THEN RETURN dg_native_dining_context('restaurant',target,session_value,token_value,csrf_value,focus_value,write_value);END IF;
 IF kind_value='party' THEN meta:=dg_native_order_context('party',target,session_value,token_value,csrf_value,focus_value,write_value);RETURN meta||jsonb_build_object('billId',NULL,'operationId',NULL,'quoteId',NULL);END IF;
 IF kind_value='order' THEN order_value:=target;SELECT bill_id INTO bill_value FROM _dg_native_bill_origins WHERE order_id=target;
 ELSIF kind_value='bill' THEN SELECT order_id,bill_id INTO order_value,bill_value FROM _dg_native_bill_origins WHERE bill_id=target;
 ELSIF kind_value='quote' THEN quote_value:=target;SELECT fixed.order_id,fixed.bill_id INTO order_value,bill_value FROM restaurant_financial_quotes quote JOIN _dg_native_bill_quote_origins origin ON origin.quote_id=quote.id JOIN _dg_native_bill_origins fixed ON fixed.bill_id=quote.bill_id WHERE quote.id=target;
 ELSIF kind_value='operation' THEN operation_value:=target;SELECT fixed.order_id,fixed.bill_id INTO order_value,bill_value FROM restaurant_financial_operations operation JOIN _dg_native_bill_operation_origins origin ON origin.operation_id=operation.id JOIN _dg_native_bill_origins fixed ON fixed.bill_id=operation.bill_id WHERE operation.id=target;ELSE PERFORM dg_native_bill_error('VALIDATION_FAILED');END IF;
 IF order_value IS NULL THEN PERFORM dg_native_bill_error('NOT_FOUND');END IF;
 IF write_value AND historical_value AND session_value IS NULL THEN
  -- Historical manager writes acquire the exclusive workspace/store lock first.
  -- Taking the read order context first creates an unsafe shared-to-exclusive upgrade.
  SELECT * INTO p FROM dining_parties WHERE id=(SELECT party_id FROM restaurant_orders WHERE id=order_value);IF p.id IS NULL THEN PERFORM dg_native_bill_error('NOT_FOUND');END IF;
  meta:=dg_native_dining_context('restaurant',p.restaurant_id,NULL,NULL,NULL,NULL,true);
  SELECT * INTO p FROM dining_parties WHERE id=p.id FOR UPDATE;
  meta:=dg_native_dining_context('restaurant',p.restaurant_id,NULL,NULL,NULL,NULL,true)||jsonb_build_object('orderId',order_value,'changeId',NULL,'partyId',p.id,'partyVersion',p.version,'partyAccessVersion',p.access_version);
 ELSE meta:=dg_native_order_context('order',order_value,session_value,token_value,csrf_value,focus_value,write_value);END IF;
 RETURN meta||jsonb_build_object('billId',bill_value,'operationId',operation_value,'quoteId',quote_value);
END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_bill_manager(meta jsonb) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT meta->>'actorType'='staff' AND dg_native_dining_clock_authority(meta->>'actorId',meta->>'restaurantId',(meta->>'actorEpoch')::bigint,(meta->>'grantVersion')::bigint) AND EXISTS(SELECT 1 FROM memberships member WHERE member.user_id=meta->>'actorId' AND member.tenant_id=(SELECT tenant_id FROM restaurants WHERE id=meta->>'restaurantId') AND(member.role='admin' OR EXISTS(SELECT 1 FROM restaurant_staff staff WHERE staff.restaurant_id=meta->>'restaurantId' AND staff.user_id=member.user_id AND staff.role='manager' AND staff.enabled=1 AND staff.version=(meta->>'grantVersion')::bigint AND(staff.expires_at IS NULL OR staff.expires_at>dg_native_dining_now()))))
$dg$;

