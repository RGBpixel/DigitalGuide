CREATE FUNCTION dg_native_bill_mock_receipt(target text,status_value text DEFAULT NULL,sequence_value bigint DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE operation restaurant_financial_operations%ROWTYPE;b restaurant_bills%ROWTYPE;remote mock_financial_operations%ROWTYPE;
BEGIN SELECT * INTO operation FROM restaurant_financial_operations WHERE id=target;SELECT * INTO b FROM restaurant_bills WHERE id=operation.bill_id;SELECT * INTO remote FROM mock_financial_operations WHERE operation_id=target;IF remote.operation_id IS NULL THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('operationId',operation.id,'kind',operation.kind,'requestHash',operation.request_hash,'restaurantId',b.restaurant_id,'billId',b.id,'merchantId',operation.merchant_id,'amountMinor',operation.amount_minor,'currency','CNY','remoteOperationId',remote.remote_operation_id,'remoteTransactionId',remote.remote_transaction_id,'status',coalesce(status_value,remote.status),'sequence',coalesce(sequence_value,remote.sequence),'simulated',true);
END;$dg$;

CREATE FUNCTION dg_native_bill_mock_record(target text,status_value text,sequence_value bigint,action_value text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE operation restaurant_financial_operations%ROWTYPE;remote mock_financial_operations%ROWTYPE;created text;
BEGIN SELECT * INTO operation FROM restaurant_financial_operations WHERE id=target;SELECT * INTO remote FROM mock_financial_operations WHERE operation_id=target;SELECT created_at INTO created FROM _dg_native_dining_actions WHERE id=action_value;PERFORM dg_native_dining_effect(action_value,'mock_financial_operations',target);
 IF remote.operation_id IS NULL THEN INSERT INTO mock_financial_operations VALUES(operation.id,operation.request_hash,operation.request_payload,(CASE WHEN operation.kind='payment' THEN 'mock-pay:' ELSE 'mock-refund:' END)||operation.id,(CASE WHEN operation.kind='payment' THEN 'mock-charge:' ELSE 'mock-refund-tx:' END)||operation.id,status_value,sequence_value,created,created);
 ELSE UPDATE mock_financial_operations SET status=status_value,sequence=sequence_value,updated_at=created WHERE operation_id=target;END IF;
END;$dg$;

CREATE FUNCTION dg_native_bill_mock_io(target text,lease_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE context_value jsonb;operation restaurant_financial_operations%ROWTYPE;remote mock_financial_operations%ROWTYPE;mode_value text;scenario_value text;action_value text;status_value text;sequence_value bigint;
BEGIN
 PERFORM dg_native_reception_runtime(true);PERFORM dg_native_bill_transport_lock(target);context_value:=dg_native_bill_worker_context(target,lease_value,true);SELECT * INTO operation FROM restaurant_financial_operations WHERE id=target;SELECT * INTO remote FROM mock_financial_operations WHERE operation_id=target;mode_value:=context_value->>'mode';scenario_value:=context_value->>'scenario';
 IF remote.operation_id IS NOT NULL AND(remote.request_hash<>operation.request_hash OR remote.payload::jsonb IS DISTINCT FROM operation.request_payload::jsonb) THEN PERFORM dg_native_bill_error('FINANCIAL_REQUEST_MISMATCH');END IF;
 IF mode_value='query' THEN RETURN jsonb_build_object('receipt',dg_native_bill_mock_receipt(target),'errorCode',NULL);END IF;
 IF mode_value='send' THEN
  IF remote.operation_id IS NOT NULL THEN RETURN jsonb_build_object('receipt',dg_native_bill_mock_receipt(target),'errorCode',NULL);END IF;
  IF scenario_value='unresolved' THEN RETURN jsonb_build_object('receipt',NULL,'errorCode','MOCK_FINANCIAL_UNRESOLVED');END IF;
  IF operation.kind='refund' AND(operation.parent_payment_id IS NULL OR operation.request_payload::jsonb->>'parentRemoteTransactionId' IS NULL) THEN PERFORM dg_native_bill_error('REFUND_UNAVAILABLE');END IF;
  status_value:=CASE WHEN operation.kind='payment' THEN 'pending' WHEN scenario_value='failed' THEN 'failed' ELSE 'succeeded' END;sequence_value:=CASE WHEN operation.kind='payment' THEN 1 ELSE 2 END;
 ELSIF mode_value='simulate' THEN
  IF remote.operation_id IS NULL OR operation.kind<>'payment' THEN PERFORM dg_native_bill_error('FINANCIAL_ACTION_UNAVAILABLE');END IF;IF remote.status<>'pending' THEN RETURN jsonb_build_object('receipt',dg_native_bill_mock_receipt(target),'errorCode',NULL);END IF;
  IF scenario_value='unresolved' THEN RETURN jsonb_build_object('receipt',NULL,'errorCode','MOCK_CHECKOUT_UNRESOLVED');END IF;status_value:=CASE WHEN scenario_value='failed' THEN 'failed' ELSE 'succeeded' END;sequence_value:=remote.sequence+1;
 ELSE
  IF remote.operation_id IS NULL OR operation.kind<>'payment' THEN RETURN jsonb_build_object('receipt',NULL,'errorCode',NULL);END IF;IF remote.status<>'pending' THEN RETURN jsonb_build_object('receipt',dg_native_bill_mock_receipt(target),'errorCode',NULL);END IF;status_value:='expired';sequence_value:=remote.sequence+1;
 END IF;
 action_value:=dg_native_bill_transport_action(target,'bill_mock',jsonb_build_object('mode',mode_value,'status',status_value,'sequence',sequence_value));PERFORM dg_native_bill_mock_record(target,status_value,sequence_value,action_value);
 IF scenario_value='response_lost' AND mode_value IN('send','simulate') THEN RETURN jsonb_build_object('receipt',NULL,'errorCode','MOCK_FINANCIAL_RESPONSE_LOST');END IF;
 RETURN jsonb_build_object('receipt',CASE WHEN mode_value='send' AND operation.kind='refund' THEN dg_native_bill_mock_receipt(target,'pending',1) ELSE dg_native_bill_mock_receipt(target) END,'errorCode',NULL);
END;$dg$;

CREATE FUNCTION dg_native_bill_mock_fixture(target text,input jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;operation restaurant_financial_operations%ROWTYPE;remote mock_financial_operations%ROWTYPE;b restaurant_bills%ROWTYPE;action_value text;created text;sequence_value bigint;
BEGIN
 meta:=dg_native_bill_context('operation',target,NULL,NULL,NULL,NULL,true,true);IF NOT dg_native_bill_manager(meta) THEN PERFORM dg_native_bill_error('FORBIDDEN');END IF;PERFORM dg_native_restaurant_fields(input,ARRAY['version','status','confirmed']);SELECT * INTO operation FROM restaurant_financial_operations WHERE id=target FOR UPDATE;SELECT * INTO b FROM restaurant_bills WHERE id=operation.bill_id;SELECT * INTO remote FROM mock_financial_operations WHERE operation_id=target;
 IF input->'confirmed' IS DISTINCT FROM 'true'::jsonb OR input->>'status' IS NULL OR input->>'status' NOT IN('pending','succeeded','failed','expired') THEN PERFORM dg_native_bill_error('VALIDATION_FAILED');END IF;IF dg_native_restaurant_integer(input->'version',1,9007199254740991)<>operation.version THEN PERFORM dg_native_bill_error('VERSION_CONFLICT');END IF;
 IF operation.provider_id<>'mock-payments' OR operation.simulated<>1 OR operation.status<>'unknown' OR operation.send_attempts<>1 OR operation.lease_token IS NOT NULL OR operation.next_action IS NOT NULL OR remote.operation_id IS NOT NULL AND remote.status<>'pending' OR EXISTS(SELECT 1 FROM _dg_native_bill_mock_fixture_origins WHERE operation_id=target) THEN PERFORM dg_native_bill_error('FINANCIAL_FIXTURE_UNAVAILABLE');END IF;
 action_value:=dg_native_dining_action(meta,'bill_fixture','party',b.party_id,input);SELECT created_at INTO created FROM _dg_native_dining_actions WHERE id=action_value;sequence_value:=coalesce(remote.sequence,0)+1;INSERT INTO _dg_native_bill_mock_fixture_origins VALUES(target,action_value,sequence_value,created);PERFORM dg_native_bill_mock_record(target,input->>'status',sequence_value,action_value);PERFORM dg_native_bill_event(action_value,b.id,target,'经理已明确建立一次本地模拟远端事实，尚须查询并核对原请求，未直接改变收款或退款。');INSERT INTO _dg_native_bill_results VALUES(action_value,b.restaurant_id,b.id,(meta->>'partyAccessVersion')::bigint,created);RETURN action_value;
END;$dg$;
