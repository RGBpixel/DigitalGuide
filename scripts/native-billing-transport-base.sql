CREATE TABLE _dg_native_bill_operation_revisions(operation_id text NOT NULL REFERENCES restaurant_financial_operations(id),version bigint NOT NULL,action_id text NOT NULL REFERENCES _dg_native_dining_actions(id),row_hash text NOT NULL,created_at text NOT NULL,PRIMARY KEY(operation_id,version));
CREATE TABLE _dg_native_bill_receipt_revisions(event_id text NOT NULL REFERENCES restaurant_financial_receipts(event_id),revision bigint NOT NULL,action_id text NOT NULL REFERENCES _dg_native_dining_actions(id),row_hash text NOT NULL,created_at text NOT NULL,PRIMARY KEY(event_id,revision));
CREATE TABLE _dg_native_bill_mock_fixture_origins(operation_id text PRIMARY KEY REFERENCES restaurant_financial_operations(id),action_id text NOT NULL UNIQUE REFERENCES _dg_native_dining_actions(id),sequence bigint NOT NULL,created_at text NOT NULL);
DO $bill_transport_immutable$ DECLARE table_value text;BEGIN FOREACH table_value IN ARRAY ARRAY['_dg_native_bill_operation_revisions','_dg_native_bill_receipt_revisions','_dg_native_bill_mock_fixture_origins'] LOOP EXECUTE format('CREATE TRIGGER native_bill_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION dg_native_append_only()',table_value);END LOOP;END;$bill_transport_immutable$;
INSERT INTO _dg_native_bill_operation_revisions SELECT operation.id,operation.version,actual_action.id,dg_native_office_hash(to_jsonb(operation)),operation.updated_at FROM restaurant_financial_operations operation JOIN _dg_native_bill_operation_origins origin ON origin.operation_id=operation.id CROSS JOIN LATERAL(SELECT actual.* FROM _dg_native_dining_changes effect JOIN _dg_native_dining_actions actual ON actual.id=effect.action_id WHERE effect.table_name='restaurant_financial_operations' AND effect.resource_id=operation.id AND actual.created_at=operation.updated_at ORDER BY actual.created_at DESC,actual.id DESC LIMIT 1) actual_action;

CREATE FUNCTION dg_native_bill_transport_lock(target text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE b restaurant_bills%ROWTYPE;r restaurants%ROWTYPE;
BEGIN
 SELECT bill.* INTO b FROM restaurant_financial_operations operation JOIN _dg_native_bill_operation_origins origin ON origin.operation_id=operation.id JOIN restaurant_bills bill ON bill.id=operation.bill_id WHERE operation.id=target;IF b.id IS NULL THEN PERFORM dg_native_bill_error('NOT_FOUND');END IF;SELECT * INTO r FROM restaurants WHERE id=b.restaurant_id;
 PERFORM pg_advisory_xact_lock(hashtextextended('["native-asset-workspace",'||to_jsonb(r.tenant_id)::text||','||to_jsonb(r.workspace_id)::text||']',0));PERFORM id FROM restaurants WHERE id=r.id FOR UPDATE;PERFORM id FROM dining_parties WHERE id=b.party_id FOR UPDATE;PERFORM id FROM restaurant_orders WHERE id=b.order_id FOR UPDATE;PERFORM id FROM restaurant_bills WHERE id=b.id FOR UPDATE;PERFORM id FROM restaurant_financial_operations WHERE id=target FOR UPDATE;
END;$dg$;

CREATE FUNCTION dg_native_bill_transport_action(target text,kind_value text,input jsonb DEFAULT '{}') RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;
BEGIN
 SELECT jsonb_build_object('restaurantId',r.id,'tenantId',r.tenant_id,'workspaceId',r.workspace_id,'partyId',b.party_id,'partyAccessVersion',p.access_version,'actorType','worker','actorId','native-financial-worker','actorEpoch',NULL,'grantVersion',NULL,'sessionId',NULL,'accessId',NULL,'focusVersion',NULL,'selectionVersion',NULL) INTO meta FROM restaurant_financial_operations operation JOIN restaurant_bills b ON b.id=operation.bill_id JOIN restaurants r ON r.id=b.restaurant_id JOIN dining_parties p ON p.id=b.party_id WHERE operation.id=target;
 RETURN dg_native_dining_action(meta,kind_value,'party',meta->>'partyId',input);
END;$dg$;

CREATE FUNCTION dg_native_bill_action_reason(target text,mode_value text,meta jsonb,attempted_value boolean DEFAULT false) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE operation restaurant_financial_operations%ROWTYPE;b restaurant_bills%ROWTYPE;p dining_parties%ROWTYPE;config restaurant_payment_configs%ROWTYPE;t jsonb;
BEGIN
 SELECT * INTO operation FROM restaurant_financial_operations WHERE id=target;SELECT * INTO b FROM restaurant_bills WHERE id=operation.bill_id;SELECT * INTO p FROM dining_parties WHERE id=b.party_id;SELECT * INTO config FROM restaurant_payment_configs WHERE restaurant_id=b.restaurant_id;t:=dg_native_bill_totals(b.id);
 IF mode_value='query' THEN RETURN NULL;END IF;
 IF meta->>'actorType'='staff' THEN IF NOT dg_native_dining_clock_authority(meta->>'actorId',b.restaurant_id,(meta->>'actorEpoch')::bigint,(meta->>'grantVersion')::bigint) THEN RETURN '原人员职责已经变化。';END IF;
 ELSIF NOT dg_native_order_source(meta,p.id) THEN RETURN '本次会话、发问人、选择或就餐归属已经变化。';END IF;
 IF p.access_version IS DISTINCT FROM(meta->>'partyAccessVersion')::bigint THEN RETURN '原就餐归属已经变化。';END IF;
 IF operation.kind<>'payment' OR operation.send_attempts<>1 OR operation.status NOT IN('pending','unknown') OR operation.error_code='FINANCIAL_RECONCILIATION_REQUIRED' OR EXISTS(SELECT 1 FROM restaurant_financial_postings WHERE operation_id=operation.id) THEN RETURN '原请求不允许执行新的付款或关闭动作，请查询原结果。';END IF;
 IF mode_value='simulate' THEN
  IF operation.status<>'pending' OR operation.remote_operation_id IS NULL OR operation.simulate_attempts<>(CASE WHEN attempted_value THEN 1 ELSE 0 END) OR(t->>'balance')::bigint<operation.amount_minor OR dg_native_bill_payment_reason(b.order_id,meta) IS NOT NULL OR(SELECT content_version FROM restaurant_orders WHERE id=b.order_id)<>b.order_content_version THEN RETURN '本次入口、金额、接单明细或模拟付款次数已变化，请查询原请求。';END IF;
  IF config.restaurant_id IS NULL OR config.enabled<>1 OR config.provider_id<>operation.provider_id OR config.version<>operation.config_version OR config.merchant_id<>operation.merchant_id THEN RETURN '原支付连接或商户已经变化，未执行模拟付款。';END IF;
 END IF;RETURN NULL;
END;$dg$;

CREATE FUNCTION dg_native_bill_action(target text,input jsonb,session_value text DEFAULT NULL,token_value text DEFAULT NULL,csrf_value text DEFAULT NULL,focus_value bigint DEFAULT NULL) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;body jsonb:=input-ARRAY['focusVersion','selectionVersion'];operation restaurant_financial_operations%ROWTYPE;b restaurant_bills%ROWTYPE;action_value text;created text;mode_value text:=body->>'action';
BEGIN
 IF mode_value='withdraw' THEN RETURN dg_native_bill_apply('operation',target,'withdraw',input,session_value,token_value,csrf_value,focus_value);END IF;
 meta:=dg_native_bill_context('operation',target,session_value,token_value,csrf_value,focus_value,true,true);PERFORM dg_native_order_input(meta,input);PERFORM dg_native_restaurant_fields(body,ARRAY['version','action','confirmed']);
 IF mode_value IS NULL OR mode_value NOT IN('query','close','simulate') OR body->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN PERFORM dg_native_bill_error('VALIDATION_FAILED');END IF;
 SELECT * INTO operation FROM restaurant_financial_operations WHERE id=target FOR UPDATE;SELECT * INTO b FROM restaurant_bills WHERE id=operation.bill_id;IF dg_native_restaurant_integer(body->'version',1,9007199254740991)<>operation.version THEN PERFORM dg_native_bill_error('VERSION_CONFLICT');END IF;
 IF operation.kind='refund' AND mode_value<>'query' AND NOT dg_native_bill_manager(meta) THEN PERFORM dg_native_bill_error('FORBIDDEN');END IF;
 IF operation.send_attempts<>1 OR operation.status NOT IN('pending','unknown','needs_attention') OR operation.lease_token IS NOT NULL AND(operation.lease_until>dg_native_dining_now() OR mode_value<>'query') OR operation.next_action IS NOT NULL OR dg_native_bill_action_reason(operation.id,mode_value,meta) IS NOT NULL THEN PERFORM dg_native_bill_error('FINANCIAL_ACTION_UNAVAILABLE');END IF;
 action_value:=dg_native_dining_action(meta,'bill_action','party',b.party_id,body);SELECT created_at INTO created FROM _dg_native_dining_actions WHERE id=action_value;
 INSERT INTO _dg_native_bill_action_origins VALUES(action_value,operation.id,mode_value,meta,created);PERFORM dg_native_dining_effect(action_value,'restaurant_financial_operations',operation.id);UPDATE restaurant_financial_operations SET next_action=mode_value,action_actor_id=meta->>'actorId',action_session_id=meta->>'sessionId',action_focus_version=(meta->>'focusVersion')::bigint,action_party_access_version=(meta->>'partyAccessVersion')::bigint,version=version+1,updated_at=created WHERE id=operation.id;
 PERFORM dg_native_bill_refresh(action_value,b.id);PERFORM dg_native_bill_event(action_value,b.id,operation.id,'已明确请求核对原资金操作；未知结果保留原编号，不重新发送付款或退款。');INSERT INTO _dg_native_bill_results VALUES(action_value,b.restaurant_id,b.id,(meta->>'partyAccessVersion')::bigint,created);RETURN action_value;
END;$dg$;
