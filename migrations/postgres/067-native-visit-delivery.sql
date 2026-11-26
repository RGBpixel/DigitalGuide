-- R-038/R-039: original10-second lease, durable explicit mock receipts and
-- actual local inbox submission. No external gateway is configured or called.
CREATE TABLE _dg_native_visit_dispatch_origins(
 delivery_id text PRIMARY KEY REFERENCES visit_deliveries(id),request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),created_at text NOT NULL
);
CREATE TABLE _dg_native_visit_delivery_attempts(
 delivery_id text NOT NULL REFERENCES visit_deliveries(id),attempt bigint NOT NULL CHECK(attempt BETWEEN 1 AND 3),
 token text UNIQUE NOT NULL,lease_until text NOT NULL,recovering boolean NOT NULL,created_at text NOT NULL,PRIMARY KEY(delivery_id,attempt)
);
CREATE TABLE _dg_native_visit_tenant_leases(tenant_id text PRIMARY KEY,delivery_id text NOT NULL,token text NOT NULL,lease_until text NOT NULL);
CREATE TRIGGER native_visit_dispatch_immutable BEFORE UPDATE OR DELETE ON _dg_native_visit_dispatch_origins FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_visit_attempts_immutable BEFORE UPDATE OR DELETE ON _dg_native_visit_delivery_attempts FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_visit_mock_receipts_immutable BEFORE UPDATE OR DELETE ON mock_notification_submissions FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_visit_callback_immutable BEFORE UPDATE OR DELETE ON notification_callback_events FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE FUNCTION dg_native_visit_worker_check() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN PERFORM dg_native_reception_runtime(true);IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND worker_role=session_user) THEN PERFORM dg_native_visit_error('FORBIDDEN');END IF;END;$dg$;
CREATE FUNCTION dg_native_visit_delivery_lock(target text) RETURNS visit_deliveries LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE n visit_deliveries%ROWTYPE;o _dg_native_visit_origins%ROWTYPE;
BEGIN
 SELECT * INTO n FROM visit_deliveries WHERE id=target;IF n.id IS NULL THEN RETURN NULL;END IF;SELECT * INTO STRICT o FROM _dg_native_visit_origins WHERE visit_id=n.visit_id;
 PERFORM dg_native_reception_workspace(n.tenant_id,n.workspace_id,true);PERFORM id FROM reception_terminals WHERE id=o.terminal_id FOR UPDATE;PERFORM id FROM reception_sessions WHERE id=o.session_id FOR UPDATE;PERFORM id FROM visits WHERE id=n.visit_id FOR UPDATE;SELECT * INTO n FROM visit_deliveries WHERE id=target FOR UPDATE;RETURN n;
END;$dg$;
CREATE FUNCTION dg_native_visit_delivery_eligible(target text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT EXISTS(SELECT 1 FROM visit_deliveries n JOIN visits v ON v.id=n.visit_id WHERE n.id=target AND n.native_availability='active' AND v.status IN('notifying','waiting_host') AND v.host_deadline>dg_utc_now() AND dg_native_visit_source_valid(v.id))
$dg$;
CREATE FUNCTION dg_native_visit_delivery_request(target text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT jsonb_build_object('deliveryId',n.id,'recipientRef',n.recipient_user_id,'visitRef',v.id,'visitorName',v.guest_name,'company',v.company,'purpose',v.purpose,'scenario',n.scenario) FROM visit_deliveries n JOIN visits v ON v.id=n.visit_id WHERE n.id=target
$dg$;
CREATE FUNCTION dg_native_visit_lease(target text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT jsonb_build_object('id',n.id,'visitId',n.visit_id,'tenantId',n.tenant_id,'workspaceId',n.workspace_id,'channel',n.native_channel,'token',n.lease_token,'leaseUntil',n.lease_until,'attempt',n.attempts,'recovering',n.attempts>1) FROM visit_deliveries n WHERE n.id=target
$dg$;
CREATE FUNCTION dg_native_visit_delivery_claim() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE candidate record;n visit_deliveries%ROWTYPE;request_value jsonb;hash_value text;token_value text;until_value text;submitted mock_notification_submissions%ROWTYPE;
BEGIN
 PERFORM dg_native_visit_worker_check();
 FOR candidate IN SELECT id,tenant_id,workspace_id FROM visit_deliveries WHERE status='queued' OR status='submitting' AND lease_until<=dg_utc_now() ORDER BY created_at,id LIMIT 100 LOOP
  IF NOT pg_try_advisory_xact_lock(hashtextextended('native-visit-tenant-dispatch:'||candidate.tenant_id,0)) OR NOT pg_try_advisory_xact_lock(hashtextextended('native-reception-workspace:'||candidate.tenant_id||':'||candidate.workspace_id,0)) THEN CONTINUE;END IF;
  IF EXISTS(SELECT 1 FROM _dg_native_visit_tenant_leases WHERE tenant_id=candidate.tenant_id AND lease_until>dg_utc_now()) THEN CONTINUE;END IF;
  n:=dg_native_visit_delivery_lock(candidate.id);IF n.status NOT IN('queued','submitting') OR n.status='submitting' AND n.lease_until>dg_utc_now() THEN CONTINUE;END IF;
  IF n.status='queued' AND NOT dg_native_visit_delivery_eligible(n.id) THEN PERFORM dg_native_visit_withdraw(n.visit_id);PERFORM dg_native_visit_escalate(n.visit_id,'notification_source_unavailable');CONTINUE;END IF;
  IF n.attempts>=3 THEN
   SELECT * INTO submitted FROM mock_notification_submissions WHERE delivery_id=n.id;
   UPDATE visit_deliveries SET status=CASE WHEN submitted.delivery_id IS NOT NULL THEN 'submitted' ELSE 'unknown' END,remote_id=submitted.remote_id,error_code=CASE WHEN submitted.delivery_id IS NULL THEN 'NOTIFICATION_ATTEMPTS_EXHAUSTED' END,lease_token=NULL,lease_until=NULL,version=version+1,updated_at=dg_utc_now() WHERE id=n.id;
   PERFORM dg_native_visit_escalate(n.visit_id,'notification_recovery_exhausted');DELETE FROM _dg_native_visit_tenant_leases WHERE delivery_id=n.id;CONTINUE;
  END IF;
  IF n.attempts=0 THEN request_value:=dg_native_visit_delivery_request(n.id);hash_value:=dg_native_office_hash(request_value);INSERT INTO _dg_native_visit_dispatch_origins VALUES(n.id,hash_value,dg_utc_now());END IF;
  token_value:=gen_random_uuid()::text;until_value:=dg_native_people_iso(clock_timestamp()+interval '10 seconds');
  UPDATE visit_deliveries SET status='submitting',attempts=attempts+1,lease_token=token_value,lease_until=until_value,version=version+1,updated_at=dg_utc_now() WHERE id=n.id;
  INSERT INTO _dg_native_visit_delivery_attempts VALUES(n.id,n.attempts+1,token_value,until_value,n.attempts>0,dg_utc_now());
  INSERT INTO _dg_native_visit_tenant_leases VALUES(n.tenant_id,n.id,token_value,until_value) ON CONFLICT(tenant_id) DO UPDATE SET delivery_id=excluded.delivery_id,token=excluded.token,lease_until=excluded.lease_until;
  RETURN dg_native_visit_lease(n.id);
 END LOOP;RETURN NULL;
END;$dg$;
CREATE FUNCTION dg_native_visit_delivery_context(target text,token_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE n visit_deliveries%ROWTYPE;request_value jsonb;hash_value text;
BEGIN
 PERFORM dg_native_visit_worker_check();n:=dg_native_visit_delivery_lock(target);
 IF n.id IS NULL OR n.status<>'submitting' OR n.lease_token IS DISTINCT FROM token_value OR n.lease_until<=dg_utc_now() OR NOT EXISTS(SELECT 1 FROM _dg_native_visit_tenant_leases WHERE delivery_id=n.id AND token=token_value AND lease_until>dg_utc_now()) THEN RETURN NULL;END IF;
 SELECT request_hash INTO STRICT hash_value FROM _dg_native_visit_dispatch_origins WHERE delivery_id=n.id;
 IF dg_native_visit_delivery_eligible(n.id) THEN request_value:=dg_native_visit_delivery_request(n.id);IF dg_native_office_hash(request_value)<>hash_value THEN PERFORM dg_native_visit_error('STATE_CONFLICT');END IF;END IF;
 RETURN jsonb_build_object('lease',dg_native_visit_lease(n.id),'request',request_value,'requestHash',hash_value);
END;$dg$;
CREATE FUNCTION dg_native_visit_mock_lookup(target text,token_value text,hash_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE context_value jsonb;receipt mock_notification_submissions%ROWTYPE;
BEGIN
 context_value:=dg_native_visit_delivery_context(target,token_value);IF context_value IS NULL OR context_value->>'requestHash' IS DISTINCT FROM hash_value OR context_value->'lease'->>'channel'<>'mock' THEN PERFORM dg_native_visit_error('STATE_CONFLICT');END IF;
 SELECT * INTO receipt FROM mock_notification_submissions WHERE delivery_id=target AND request_hash=hash_value;
 RETURN CASE WHEN receipt.delivery_id IS NULL THEN NULL ELSE jsonb_build_object('remoteId',receipt.remote_id,'status','submitted','simulated',true) END;
END;$dg$;
CREATE FUNCTION dg_native_visit_mock_submit(target text,token_value text,hash_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE context_value jsonb;receipt mock_notification_submissions%ROWTYPE;
BEGIN
 context_value:=dg_native_visit_delivery_context(target,token_value);
 IF context_value IS NULL OR context_value->>'requestHash' IS DISTINCT FROM hash_value OR context_value->'lease'->>'channel'<>'mock' OR context_value->'lease'->>'recovering'<>'false' OR context_value->'request'='null'::jsonb THEN PERFORM dg_native_visit_error('STATE_CONFLICT');END IF;
 IF context_value->'request'->>'scenario'<>'normal' THEN PERFORM dg_native_visit_error('STATE_CONFLICT');END IF;
 INSERT INTO mock_notification_submissions VALUES(target,hash_value,'mock-notification:'||target,dg_utc_now()) ON CONFLICT(delivery_id) DO NOTHING;
 SELECT * INTO STRICT receipt FROM mock_notification_submissions WHERE delivery_id=target;
 IF receipt.request_hash<>hash_value THEN PERFORM dg_native_visit_error('STATE_CONFLICT');END IF;
 RETURN jsonb_build_object('remoteId',receipt.remote_id,'status','submitted','simulated',true);
END;$dg$;
CREATE FUNCTION dg_native_visit_delivery_finish(target text,token_value text,hash_value text,status_value text,remote_value text,error_value text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE context_value jsonb;n visit_deliveries%ROWTYPE;eligible_value boolean;
BEGIN
 context_value:=dg_native_visit_delivery_context(target,token_value);IF context_value IS NULL OR context_value->>'requestHash' IS DISTINCT FROM hash_value OR status_value NOT IN('submitted','failed','unknown') THEN PERFORM dg_native_visit_error('STATE_CONFLICT');END IF;
 SELECT * INTO STRICT n FROM visit_deliveries WHERE id=target;eligible_value:=dg_native_visit_delivery_eligible(target);
 IF status_value='submitted' THEN
  IF n.native_channel='mock' AND NOT EXISTS(SELECT 1 FROM mock_notification_submissions WHERE delivery_id=target AND request_hash=hash_value AND remote_id=remote_value) THEN PERFORM dg_native_visit_error('STATE_CONFLICT');END IF;
  IF n.native_channel='local' AND(NOT eligible_value OR remote_value IS DISTINCT FROM 'local-inbox:'||target) THEN PERFORM dg_native_visit_error('STATE_CONFLICT');END IF;
 END IF;
 UPDATE visit_deliveries SET status=status_value,remote_id=remote_value,error_code=CASE WHEN status_value='submitted' THEN NULL ELSE left(error_value,100) END,lease_token=NULL,lease_until=NULL,version=version+1,updated_at=dg_utc_now(),native_availability=CASE WHEN eligible_value THEN native_availability ELSE 'withdrawn' END WHERE id=target;
 DELETE FROM _dg_native_visit_tenant_leases WHERE delivery_id=target AND token=token_value;
 IF status_value='submitted' AND eligible_value THEN PERFORM dg_native_visit_state(n.visit_id,'waiting_host');ELSE PERFORM dg_native_visit_escalate(n.visit_id,CASE WHEN status_value='submitted' THEN 'notification_source_withdrawn' ELSE 'notification_'||status_value END);END IF;
END;$dg$;
CREATE FUNCTION dg_native_visit_delivery_fail(target text,token_value text,error_value text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE n visit_deliveries%ROWTYPE;
BEGIN
 PERFORM dg_native_visit_worker_check();n:=dg_native_visit_delivery_lock(target);
 IF n.id IS NULL OR n.status<>'submitting' OR n.lease_token IS DISTINCT FROM token_value THEN RETURN false;END IF;
 UPDATE visit_deliveries SET error_code=left(error_value,100),version=version+1,updated_at=dg_utc_now() WHERE id=target;RETURN true;
END;$dg$;
CREATE FUNCTION dg_native_visit_delivery_release(target text,token_value text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 PERFORM dg_native_visit_worker_check();DELETE FROM _dg_native_visit_tenant_leases l USING visit_deliveries n WHERE l.delivery_id=target AND l.token=token_value AND n.id=target AND n.status<>'submitting';
END;$dg$;

-- The HTTP layer verifies a runtime/app-env domain-separated signature before
-- calling this app-only function. Receipt metadata never implies host consent.
CREATE FUNCTION dg_native_visit_receipt(input jsonb,hash_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
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
  IF NOT positive THEN PERFORM dg_native_visit_escalate(n.visit_id,'notification_'||(input->>'status'));END IF;
 END IF;
 INSERT INTO notification_callback_events VALUES(input->>'eventId',n.id,'mock',hash_value,disposition_value,dg_utc_now());
 RETURN jsonb_build_object('accepted',true,'duplicate',false,'deliveryId',n.id,'status',(SELECT status FROM visit_deliveries WHERE id=n.id),'disposition',disposition_value);
END;$dg$;
DO $dg$ DECLARE r record;BEGIN FOR r IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND p.proname LIKE 'dg_native_visit_%' LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||r.signature||' FROM PUBLIC';END LOOP;END;$dg$;

-- Unknown recipients yield false boolean capability fields, never JSON null.
CREATE OR REPLACE FUNCTION dg_native_visit_staff_view(target text,own_only boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v visits%ROWTYPE;d _dg_native_visit_drafts%ROWTYPE;
BEGIN
 PERFORM dg_native_visit_staff_scope(target,own_only,false);SELECT * INTO STRICT v FROM visits WHERE id=target;d:=dg_native_visit_draft(target);
 RETURN dg_native_visit_public(target)||jsonb_build_object('workspaceId',v.workspace_id,'venueId',v.venue_id,'recipientIsMe',coalesce(d.recipient_id=current_setting('digitalguide.actor_id',true),false),'privateNote',v.host_private_note,'escalatedReason',v.escalated_reason,'canRespond',coalesce(d.recipient_id=current_setting('digitalguide.actor_id',true),false) AND v.status='waiting_host' AND dg_native_visit_source_valid(v.id));
END;$dg$;
