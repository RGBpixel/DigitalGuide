CREATE TABLE _dg_native_order_worker_leases(lease_token text PRIMARY KEY,change_id text NOT NULL REFERENCES restaurant_order_dispatches(change_id),mode text NOT NULL CHECK(mode IN('submit','lookup')),request_hash text NOT NULL,runtime_id text NOT NULL,action_id text NOT NULL UNIQUE REFERENCES _dg_native_dining_actions(id),created_at text NOT NULL,expires_at text NOT NULL);
CREATE TABLE _dg_native_order_receipt_origins(event_id text PRIMARY KEY REFERENCES restaurant_pos_callbacks(event_id),action_id text NOT NULL UNIQUE REFERENCES _dg_native_dining_actions(id),runtime_id text NOT NULL,request_hash text NOT NULL,receipt_hash text NOT NULL,ingress text NOT NULL CHECK(ingress IN('worker','callback')),created_at text NOT NULL);
CREATE TABLE _dg_native_order_line_origins(line_id text PRIMARY KEY REFERENCES restaurant_order_lines(id),change_id text NOT NULL REFERENCES restaurant_order_changes(id),event_id text NOT NULL REFERENCES restaurant_pos_callbacks(event_id),quote_id text NOT NULL REFERENCES restaurant_order_quotes(id),line_hash text NOT NULL,runtime_id text NOT NULL);
CREATE TABLE _dg_native_order_kitchen_origins(ticket_id text PRIMARY KEY REFERENCES restaurant_kitchen_tickets(id),line_id text NOT NULL UNIQUE REFERENCES restaurant_order_lines(id),event_id text NOT NULL REFERENCES restaurant_pos_callbacks(event_id),runtime_id text NOT NULL);
CREATE TABLE _dg_native_order_mock_origins(change_id text PRIMARY KEY REFERENCES mock_pos_operations(change_id),action_id text NOT NULL UNIQUE REFERENCES _dg_native_dining_actions(id),runtime_id text NOT NULL,payload_hash text NOT NULL,created_at text NOT NULL);
CREATE TABLE _dg_native_order_receipt_failures(event_id text PRIMARY KEY REFERENCES restaurant_pos_callbacks(event_id),sqlstate text NOT NULL CHECK(length(sqlstate)=5),failure_site text NOT NULL,created_at text NOT NULL);
DO $transport_append$ DECLARE table_value text;BEGIN FOREACH table_value IN ARRAY ARRAY['_dg_native_order_worker_leases','_dg_native_order_receipt_origins','_dg_native_order_line_origins','_dg_native_order_kitchen_origins','_dg_native_order_mock_origins','_dg_native_order_receipt_failures'] LOOP EXECUTE format('CREATE TRIGGER native_order_transport_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION dg_native_append_only()',table_value);END LOOP;END;$transport_append$;
CREATE UNIQUE INDEX native_order_one_final_application ON restaurant_pos_callbacks(change_id) WHERE applied=1 AND outcome IN('accepted','rejected');

CREATE FUNCTION dg_native_order_transport_lock(change_value text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE r restaurants%ROWTYPE;order_value text;
BEGIN
 PERFORM dg_native_reception_runtime(true);SELECT o.order_id INTO order_value FROM _dg_native_order_change_origins o WHERE o.change_id=change_value;SELECT restaurant.* INTO r FROM restaurant_orders current_order JOIN restaurants restaurant ON restaurant.id=current_order.restaurant_id WHERE current_order.id=order_value;
 IF r.id IS NULL THEN PERFORM dg_native_order_error('NOT_FOUND');END IF;PERFORM dg_native_reception_workspace(r.tenant_id,r.workspace_id,true);PERFORM id FROM restaurants WHERE id=r.id FOR UPDATE;PERFORM id FROM restaurant_orders WHERE id=order_value FOR UPDATE;PERFORM id FROM restaurant_order_changes WHERE id=change_value FOR UPDATE;PERFORM change_id FROM restaurant_order_dispatches WHERE change_id=change_value FOR UPDATE;
END;$dg$;

CREATE FUNCTION dg_native_order_transport_action(change_value text,kind_value text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;
BEGIN
 SELECT jsonb_build_object('restaurantId',r.id,'tenantId',r.tenant_id,'workspaceId',r.workspace_id,'partyId',o.party_id,'actorType','worker','actorId',CASE WHEN kind_value='order_receipt' THEN 'system:pos-receipt' ELSE 'system:order-dispatch' END,'actorEpoch',NULL,'grantVersion',NULL,'sessionId',NULL,'accessId',NULL,'focusVersion',NULL,'selectionVersion',NULL) INTO meta FROM restaurant_order_changes c JOIN restaurant_orders o ON o.id=c.order_id JOIN restaurants r ON r.id=o.restaurant_id WHERE c.id=change_value;
 RETURN dg_native_dining_action(meta,kind_value,'party',meta->>'partyId','{}');
END;$dg$;

CREATE FUNCTION dg_native_order_transport_state(change_value text,action_value text,status_value text,message_value text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE c restaurant_order_changes%ROWTYPE;o restaurant_orders%ROWTYPE;created text;kind_value text;
BEGIN
 SELECT * INTO c FROM restaurant_order_changes WHERE id=change_value;SELECT * INTO o FROM restaurant_orders WHERE id=c.order_id;SELECT created_at,kind INTO created,kind_value FROM _dg_native_dining_actions WHERE id=action_value;
 IF c.status<>status_value THEN PERFORM dg_native_dining_effect(action_value,'restaurant_order_changes',c.id);UPDATE restaurant_order_changes SET status=status_value,version=version+1,updated_at=created WHERE id=c.id;END IF;
 PERFORM dg_native_dining_effect(action_value,'restaurant_orders',o.id);UPDATE restaurant_orders SET status=CASE WHEN status_value='unknown' THEN 'needs_attention' ELSE status_value END,version=version+1,updated_at=created WHERE id=o.id;
 PERFORM dg_native_order_event(action_value,o.id,c.id,kind_value,message_value);
END;$dg$;

CREATE FUNCTION dg_native_order_worker_claim() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE candidate record;d restaurant_order_dispatches%ROWTYPE;c restaurant_order_changes%ROWTYPE;action_value text;created text;expires text;lease_value text;mode_value text;
BEGIN
 PERFORM dg_native_reception_runtime(true);PERFORM dg_native_order_sweep(NULL);
 FOR candidate IN SELECT dispatch.change_id FROM restaurant_order_dispatches dispatch JOIN _dg_native_order_dispatch_origins origin ON origin.change_id=dispatch.change_id WHERE dispatch.status='queued' AND dispatch.attempts=0 OR dispatch.attempts=1 AND(dispatch.lease_token IS NULL OR dispatch.lease_until<=dg_native_dining_now()) AND(dispatch.status='submitting' OR dispatch.status IN('submitted','unknown') AND(dispatch.query_requested=1 OR dispatch.status='submitted' AND(dispatch.last_lookup_at IS NULL OR dispatch.last_lookup_at<=dg_native_people_iso(clock_timestamp()-interval '1 second')))) ORDER BY dispatch.created_at,dispatch.change_id LIMIT 25 LOOP
  PERFORM dg_native_order_transport_lock(candidate.change_id);SELECT * INTO d FROM restaurant_order_dispatches WHERE change_id=candidate.change_id;SELECT * INTO c FROM restaurant_order_changes WHERE id=d.change_id;
  IF d.lease_token IS NOT NULL AND d.lease_until>dg_native_dining_now() OR d.error_code='POS_RECONCILIATION_REQUIRED' OR d.status IN('accepted','rejected','cancelled','stale') THEN CONTINUE;END IF;
  IF d.status='queued' AND d.attempts=0 THEN IF dg_native_order_before_send_reason(d.change_id) IS NOT NULL THEN CONTINUE;END IF;mode_value:='submit';
  ELSIF d.attempts=1 AND(d.status='submitting' OR d.status IN('submitted','unknown') AND(d.query_requested=1 OR d.status='submitted' AND(d.last_lookup_at IS NULL OR d.last_lookup_at<=dg_native_people_iso(clock_timestamp()-interval '1 second')))) THEN mode_value:='lookup';ELSE CONTINUE;END IF;
  action_value:=dg_native_order_transport_action(d.change_id,CASE WHEN mode_value='submit' THEN 'order_send' ELSE 'order_lookup' END);SELECT created_at INTO created FROM _dg_native_dining_actions WHERE id=action_value;lease_value:=gen_random_uuid()::text;expires:=dg_native_people_iso(created::timestamptz+interval '15 seconds');
  PERFORM dg_native_dining_effect(action_value,'restaurant_order_dispatches',d.change_id);
  UPDATE restaurant_order_dispatches SET status=CASE WHEN mode_value='submit' THEN 'submitting' WHEN status='submitting' THEN 'unknown' ELSE status END,attempts=CASE WHEN mode_value='submit' THEN 1 ELSE attempts END,lease_token=lease_value,lease_until=expires,query_requested=0,lookups=lookups+CASE WHEN mode_value='lookup' THEN 1 ELSE 0 END,last_lookup_at=CASE WHEN mode_value='lookup' THEN created ELSE last_lookup_at END,version=version+1,updated_at=created WHERE change_id=d.change_id;
  INSERT INTO _dg_native_order_worker_leases VALUES(lease_value,d.change_id,mode_value,d.request_hash,(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1),action_value,created,expires);
  IF mode_value='submit' THEN PERFORM dg_native_order_transport_state(d.change_id,action_value,'submitting','已持久登记第一次发送尝试，尚未获得后厨确认。');
  ELSIF d.status='submitting' THEN PERFORM dg_native_order_transport_state(d.change_id,action_value,'unknown','原发送租约已到期，只查询原请求，不另发新单。');END IF;
  RETURN jsonb_build_object('changeId',d.change_id,'leaseToken',lease_value,'expiresAt',expires,'mode',mode_value,'requestHash',d.request_hash);
 END LOOP;RETURN NULL;
END;$dg$;

CREATE FUNCTION dg_native_order_worker_context(change_value text,lease_value text,send_value boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE d restaurant_order_dispatches%ROWTYPE;lease _dg_native_order_worker_leases%ROWTYPE;
BEGIN
 PERFORM dg_native_reception_runtime(true);SELECT * INTO d FROM restaurant_order_dispatches WHERE change_id=change_value;SELECT * INTO lease FROM _dg_native_order_worker_leases WHERE lease_token=lease_value AND change_id=d.change_id;
 IF d.change_id IS NULL OR d.lease_token IS DISTINCT FROM lease_value OR lease.lease_token IS NULL OR d.lease_until<=dg_native_dining_now() OR d.lease_until IS DISTINCT FROM lease.expires_at OR lease.runtime_id<>(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1) OR lease.request_hash<>d.request_hash OR d.request_hash<>dg_native_office_hash(d.request_payload::jsonb) OR d.attempts<>1 OR d.provider_id<>'mock-pos' OR d.simulated<>1 OR d.status NOT IN('submitting','submitted','unknown') OR d.error_code='POS_RECONCILIATION_REQUIRED' THEN PERFORM dg_native_order_error('ORDER_WORKER_LEASE');END IF;
 IF send_value AND lease.mode='submit' AND dg_native_order_transport_source_reason(change_value) IS NOT NULL THEN PERFORM dg_native_order_error('ORDER_SOURCE_EXPIRED');END IF;
 RETURN jsonb_build_object('changeId',d.change_id,'leaseToken',lease_value,'mode',lease.mode,'requestHash',d.request_hash,'request',d.request_payload::jsonb,'scenario',d.config_snapshot::jsonb->>'scenario','expiresAt',lease.expires_at,'sourceExpiresAt',(SELECT q.expires_at FROM restaurant_order_changes c JOIN restaurant_order_quotes q ON q.id=c.confirmed_quote_id WHERE c.id=d.change_id));
END;$dg$;

CREATE FUNCTION dg_native_order_mock_record(change_value text,outcome_value text,action_value text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE d restaurant_order_dispatches%ROWTYPE;created text;payload jsonb;
BEGIN
 SELECT * INTO d FROM restaurant_order_dispatches WHERE change_id=change_value;SELECT created_at INTO created FROM _dg_native_dining_actions WHERE id=action_value;payload:=d.request_payload::jsonb;
 IF d.attempts<>1 OR d.provider_id<>'mock-pos' OR d.simulated<>1 OR outcome_value NOT IN('accepted','rejected') THEN PERFORM dg_native_order_error('POS_RECEIPT_MISMATCH');END IF;
 IF EXISTS(SELECT 1 FROM mock_pos_operations WHERE change_id=d.change_id) THEN RETURN;END IF;
 PERFORM dg_native_dining_effect(action_value,'mock_pos_operations',d.change_id);INSERT INTO mock_pos_operations VALUES(d.change_id,d.restaurant_id,d.request_hash,d.request_payload,'mock-pos:'||d.change_id,coalesce(payload->>'remoteOrderId','mock-order:'||(payload->>'orderId')),outcome_value,2,created);
 INSERT INTO _dg_native_order_mock_origins VALUES(d.change_id,action_value,(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1),dg_native_office_hash((SELECT to_jsonb(operation) FROM mock_pos_operations operation WHERE change_id=d.change_id)),created);
END;$dg$;

CREATE FUNCTION dg_native_order_mock_io(change_value text,lease_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE context jsonb;operation mock_pos_operations%ROWTYPE;action_value text;scenario_value text;
BEGIN
 PERFORM dg_native_order_transport_lock(change_value);context:=dg_native_order_worker_context(change_value,lease_value,true);scenario_value:=context->>'scenario';
 IF context->>'mode'='submit' AND scenario_value<>'unresolved' THEN action_value:=dg_native_order_transport_action(change_value,'order_mock_remote');PERFORM dg_native_order_mock_record(change_value,CASE WHEN scenario_value='rejected' THEN 'rejected' ELSE 'accepted' END,action_value);END IF;
 SELECT current_operation.* INTO operation FROM mock_pos_operations current_operation JOIN _dg_native_order_mock_origins origin ON origin.change_id=current_operation.change_id WHERE current_operation.change_id=change_value;
 IF context->>'mode'='submit' AND scenario_value IN('unresolved','response_lost') THEN RETURN jsonb_build_object('errorCode',CASE WHEN scenario_value='unresolved' THEN 'MOCK_RESULT_UNRESOLVED' ELSE 'MOCK_RESPONSE_LOST' END,'receipt',NULL);END IF;
 RETURN jsonb_build_object('errorCode',NULL,'receipt',CASE WHEN operation.change_id IS NOT NULL THEN jsonb_build_object('requestId',operation.change_id,'requestHash',operation.request_hash,'restaurantId',operation.restaurant_id,'remoteRequestId',operation.remote_request_id,'remoteOrderId',operation.remote_order_id,'status',CASE WHEN context->>'mode'='submit' THEN 'submitted' ELSE operation.outcome END,'sequence',CASE WHEN context->>'mode'='submit' THEN 1 ELSE operation.sequence END,'simulated',true,'reasonCode',CASE WHEN context->>'mode'='lookup' AND operation.outcome='rejected' THEN 'MOCK_REJECTED' END) END);
END;$dg$;
