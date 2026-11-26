-- Preserve explicit host consent across late channel failure. Source/host
-- withdrawal still requires manual handoff, and early accepted receipts can
-- establish waiting_host when the original source/deadline remain eligible.
CREATE OR REPLACE FUNCTION dg_native_visit_escalate(target text,reason_value text,preserve_focus boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v visits%ROWTYPE;
BEGIN
 SELECT * INTO STRICT v FROM visits WHERE id=target;
 IF v.status='accepted' AND reason_value IN('notification_failed','notification_unknown') THEN RETURN;END IF;
 PERFORM dg_native_visit_withdraw(target);
 UPDATE _dg_native_visit_origins SET context_invalidated_at=coalesce(context_invalidated_at,dg_utc_now()) WHERE visit_id=target;
 IF v.status IN('completed','cancelled','declined','escalated') THEN RETURN;END IF;
 PERFORM dg_native_visit_state(target,'escalated',reason_value);
 UPDATE reception_messages SET text='',knowledge_citations='[]',status='cancelled' WHERE session_id=v.session_id AND role='assistant' AND status IN('ready','playing');
 UPDATE reception_sessions SET status='human',version=version+1,reply_epoch=reply_epoch+1,focus_version=focus_version+CASE WHEN preserve_focus THEN 0 ELSE 1 END WHERE id=v.session_id AND status='active';
END;$dg$;
CREATE OR REPLACE FUNCTION dg_native_visit_receipt(input jsonb,hash_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE n visit_deliveries%ROWTYPE;old notification_callback_events%ROWTYPE;submitted mock_notification_submissions%ROWTYPE;disposition_value text:='applied';positive boolean:=input->>'status' IN('delivered','acknowledged');
BEGIN
 PERFORM dg_native_reception_runtime();PERFORM dg_native_reception_fields(input,ARRAY['eventId','deliveryId','environment','schemaVersion','status','occurredAt']);
 IF input->>'environment'<>'mock' OR input->>'schemaVersion'<>'1' OR input->>'status' NOT IN('delivered','acknowledged','failed','unknown') OR abs(extract(epoch FROM(clock_timestamp()-(input->>'occurredAt')::timestamptz)))>300 OR hash_value IS DISTINCT FROM dg_native_office_hash(input) THEN PERFORM dg_native_visit_error('VALIDATION_FAILED');END IF;
 n:=dg_native_visit_delivery_lock(input->>'deliveryId');IF n.id IS NULL OR n.native_channel<>'mock' OR n.attempts=0 THEN PERFORM dg_native_visit_error('STATE_CONFLICT');END IF;
 SELECT * INTO old FROM notification_callback_events WHERE event_id=input->>'eventId';IF old.event_id IS NOT NULL THEN IF old.request_hash<>hash_value OR old.delivery_id<>n.id THEN PERFORM dg_native_visit_error('IDEMPOTENCY_CONFLICT');END IF;RETURN jsonb_build_object('accepted',true,'duplicate',true,'deliveryId',n.id,'status',n.status);END IF;
 SELECT * INTO submitted FROM mock_notification_submissions WHERE delivery_id=n.id;
 IF positive AND submitted.delivery_id IS NULL THEN PERFORM dg_native_visit_error('STATE_CONFLICT');END IF;
 IF n.status='acknowledged' OR n.status='delivered' AND input->>'status'<>'acknowledged' THEN disposition_value:='ignored_late';
 ELSE
  UPDATE visit_deliveries SET status=input->>'status',remote_id=coalesce(remote_id,submitted.remote_id),version=version+1,updated_at=dg_utc_now(),lease_token=NULL,lease_until=NULL WHERE id=n.id;
  DELETE FROM _dg_native_visit_tenant_leases WHERE delivery_id=n.id;
  IF NOT positive THEN PERFORM dg_native_visit_escalate(n.visit_id,'notification_'||(input->>'status'));ELSIF dg_native_visit_delivery_eligible(n.id) THEN PERFORM dg_native_visit_state(n.visit_id,'waiting_host');END IF;
 END IF;
 INSERT INTO notification_callback_events VALUES(input->>'eventId',n.id,'mock',hash_value,disposition_value,dg_utc_now());
 RETURN jsonb_build_object('accepted',true,'duplicate',false,'deliveryId',n.id,'status',(SELECT status FROM visit_deliveries WHERE id=n.id),'disposition',disposition_value);
END;$dg$;
