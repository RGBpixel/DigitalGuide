CREATE FUNCTION dg_native_webhook_allowed(delivery text) RETURNS boolean LANGUAGE sql STABLE SET search_path FROM CURRENT AS $dg$
 SELECT coalesce((SELECT a.enabled=1 AND s.enabled=1 AND s.version=d.generation AND s.fingerprint=d.fingerprint AND(e.topic='webhook.test' OR(jsonb_exists(s.topics::jsonb,e.topic) AND jsonb_exists(a.scopes::jsonb,CASE WHEN e.topic='projects.changed' THEN 'projects.read' ELSE 'exports.read' END))) FROM developer_webhook_deliveries d JOIN developer_webhook_subscriptions s ON s.id=d.subscription_id JOIN developer_apps a ON a.id=s.app_id JOIN developer_webhook_events e ON e.id=d.event_id WHERE d.id=delivery),false);
$dg$;
REVOKE ALL ON FUNCTION dg_native_webhook_allowed(text) FROM PUBLIC;
CREATE FUNCTION dg_native_webhook_queue(operation text,input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE control record;candidate record;d record;s record;a record;expired record;event_row record;attempt_row record;at text;until_at text;token text;allowed boolean;withdrawn boolean;next_status text;result_code text;outcome_value text;status_value integer;delay_seconds integer;body_hash text;
BEGIN
 SELECT * INTO control FROM _dg_native_runtime_control WHERE id=1;
 IF control.id IS NULL OR control.status<>'validation_only' OR control.environment<>'mock' OR session_user<>control.worker_role THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Webhook worker role is not allowed';END IF;
 IF input IS NULL OR jsonb_typeof(input)<>'object' OR length(input::text)>2048 OR operation IS NULL OR operation NOT IN('claim','ready','finish') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Webhook queue operation is invalid';END IF;
 at:=dg_utc_now();token:=input->>'leaseToken';
 IF token IS NULL OR token!~'^[0-9a-f-]{36}$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Webhook lease token is invalid';END IF;
 IF operation='claim' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('digitalguide-webhook-claim:'||current_schema(),0));at:=dg_utc_now();
  FOR expired IN SELECT r.delivery_id,r.attempt,r.lease_token,qd.subscription_id,qs.app_id FROM developer_webhook_attempts r JOIN developer_webhook_deliveries qd ON qd.id=r.delivery_id JOIN developer_webhook_subscriptions qs ON qs.id=qd.subscription_id WHERE r.outcome='sending' AND r.lease_until<=at AND qd.environment=control.environment AND qd.app_env=control.app_env ORDER BY qd.id,r.attempt LIMIT 100 LOOP
   PERFORM 1 FROM developer_apps WHERE id=expired.app_id FOR SHARE;PERFORM 1 FROM developer_webhook_subscriptions WHERE id=expired.subscription_id FOR SHARE;
   SELECT * INTO d FROM developer_webhook_deliveries WHERE id=expired.delivery_id FOR UPDATE;
   SELECT * INTO attempt_row FROM developer_webhook_attempts WHERE delivery_id=d.id AND attempt=expired.attempt FOR UPDATE;
   at:=dg_utc_now();IF attempt_row.outcome<>'sending' OR attempt_row.lease_until>at THEN CONTINUE;END IF;
   allowed:=dg_native_webhook_allowed(d.id);withdrawn:=NOT allowed OR d.status='cancelled' OR attempt_row.scope_withdrawn=1;
   UPDATE developer_webhook_attempts SET outcome='unknown',error_code=CASE WHEN withdrawn THEN 'SCOPE_WITHDRAWN' ELSE 'LEASE_EXPIRED' END,finished_at=at,scope_withdrawn=CASE WHEN withdrawn THEN 1 ELSE 0 END WHERE delivery_id=d.id AND attempt=expired.attempt;
   IF d.status='sending' AND d.lease_token=expired.lease_token THEN
    next_status:=CASE WHEN NOT allowed THEN 'cancelled' WHEN d.attempts<d.max_attempts THEN 'retrying' ELSE 'unknown' END;
    UPDATE developer_webhook_deliveries SET status=next_status,last_code=CASE WHEN NOT allowed THEN 'SCOPE_WITHDRAWN' ELSE 'LEASE_EXPIRED' END,lease_token=NULL,lease_until=NULL,available_at=to_char((clock_timestamp()+interval '5 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),updated_at=at WHERE id=d.id;
   END IF;
  END LOOP;
  IF (SELECT count(*) FROM developer_webhook_deliveries WHERE environment=control.environment AND app_env=control.app_env AND status='sending' AND lease_until>dg_utc_now())>=4 THEN RETURN 'null'::jsonb;END IF;
  FOR candidate IN SELECT qd.id,qd.subscription_id,qs.app_id FROM developer_webhook_deliveries qd JOIN developer_webhook_subscriptions qs ON qs.id=qd.subscription_id WHERE qd.environment=control.environment AND qd.app_env=control.app_env AND qd.status IN('queued','retrying') AND qd.available_at<=dg_utc_now() AND qd.attempts<qd.max_attempts ORDER BY qd.created_at,qd.id LIMIT 100 LOOP
   SELECT * INTO a FROM developer_apps WHERE id=candidate.app_id FOR SHARE;
   SELECT * INTO s FROM developer_webhook_subscriptions WHERE id=candidate.subscription_id FOR SHARE;
   SELECT * INTO d FROM developer_webhook_deliveries WHERE id=candidate.id FOR UPDATE SKIP LOCKED;
   at:=dg_utc_now();IF d.id IS NULL OR d.status NOT IN('queued','retrying') OR d.available_at>at OR d.attempts>=d.max_attempts THEN CONTINUE;END IF;
   IF NOT dg_native_webhook_allowed(d.id) THEN UPDATE developer_webhook_deliveries SET status='cancelled',last_code='SCOPE_WITHDRAWN',updated_at=at WHERE id=d.id;CONTINUE;END IF;
   until_at:=to_char((clock_timestamp()+interval '20 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
   UPDATE developer_webhook_deliveries SET status='sending',attempts=attempts+1,lease_token=token,lease_until=until_at,updated_at=at WHERE id=d.id RETURNING * INTO d;
   INSERT INTO developer_webhook_attempts(delivery_id,attempt,lease_token,lease_until,outcome,started_at,scope_withdrawn) VALUES(d.id,d.attempts,token,until_at,'sending',at,0);
   SELECT * INTO event_row FROM developer_webhook_events WHERE id=d.event_id;
   RETURN jsonb_build_object('id',d.id,'eventId',event_row.id,'subscriptionId',s.id,'applicationId',a.id,'destinationId',s.destination_id,'fingerprint',d.fingerprint,'tenantId',d.tenant_id,'workspaceId',d.workspace_id,'environment',d.environment,'appEnv',d.app_env,'generation',d.generation,'attempt',d.attempts,'maxAttempts',d.max_attempts,'leaseToken',token,'leaseUntil',until_at,'event',event_row.payload::jsonb);
  END LOOP;RETURN 'null'::jsonb;
 END IF;
 SELECT qd.id,qd.subscription_id,qs.app_id INTO candidate FROM developer_webhook_deliveries qd JOIN developer_webhook_subscriptions qs ON qs.id=qd.subscription_id WHERE qd.id=input->>'id' AND qd.environment=control.environment AND qd.app_env=control.app_env;
 IF candidate.id IS NULL THEN RETURN jsonb_build_object('ready',false,'recorded',false,'status','cancelled');END IF;
 SELECT * INTO a FROM developer_apps WHERE id=candidate.app_id FOR SHARE;SELECT * INTO s FROM developer_webhook_subscriptions WHERE id=candidate.subscription_id FOR SHARE;
 SELECT * INTO d FROM developer_webhook_deliveries WHERE id=candidate.id FOR UPDATE;
 SELECT * INTO attempt_row FROM developer_webhook_attempts WHERE delivery_id=d.id AND lease_token=token FOR UPDATE;
 at:=dg_utc_now();IF attempt_row.delivery_id IS NULL OR attempt_row.outcome<>'sending' OR attempt_row.lease_until<=at THEN RETURN jsonb_build_object('ready',false,'recorded',false,'status',d.status);END IF;
 allowed:=dg_native_webhook_allowed(d.id);withdrawn:=NOT allowed OR d.status<>'sending' OR d.lease_token IS DISTINCT FROM token OR attempt_row.scope_withdrawn=1;
 IF operation='ready' THEN
  body_hash:=input->>'bodySHA256';IF body_hash IS NULL OR body_hash!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Webhook body digest is invalid';END IF;
  IF withdrawn OR input->>'fingerprint' IS DISTINCT FROM d.fingerprint THEN
   result_code:=CASE WHEN withdrawn THEN 'SCOPE_WITHDRAWN' ELSE 'CONFIG_CHANGED' END;next_status:=CASE WHEN withdrawn THEN 'cancelled' ELSE 'blocked' END;
   UPDATE developer_webhook_attempts SET outcome='blocked',error_code=result_code,finished_at=at,scope_withdrawn=CASE WHEN withdrawn THEN 1 ELSE 0 END WHERE delivery_id=d.id AND attempt=attempt_row.attempt;
   UPDATE developer_webhook_deliveries SET status=next_status,last_code=result_code,lease_token=NULL,lease_until=NULL,updated_at=at WHERE id=d.id;
   RETURN jsonb_build_object('ready',false,'status',next_status,'code',result_code);
  END IF;
  UPDATE developer_webhook_attempts SET body_sha256=body_hash WHERE delivery_id=d.id AND attempt=attempt_row.attempt;
  RETURN jsonb_build_object('ready',true,'status','sending');
 END IF;
 outcome_value:=input->>'outcome';result_code:=input->>'code';status_value:=(input->>'httpStatus')::integer;
 IF outcome_value IS NULL OR outcome_value NOT IN('accepted','retryable','rejected','unknown','blocked') OR result_code IS NULL OR result_code NOT IN('HTTP_ACCEPTED','HTTP_REJECTED','HTTP_RETRYABLE','REDIRECT_BLOCKED','TRANSPORT_UNCERTAIN','CONFIG_REQUIRED','CONFIG_CHANGED','EXTERNAL_NOT_AUTHORIZED','SCOPE_WITHDRAWN','LEASE_EXPIRED','PAYLOAD_INVALID') OR(status_value IS NOT NULL AND(status_value<100 OR status_value>599)) OR(outcome_value<>'blocked' AND attempt_row.body_sha256 IS NULL) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Webhook outcome is invalid';END IF;
 IF (outcome_value='accepted' AND(status_value IS NULL OR status_value<200 OR status_value>=300 OR result_code<>'HTTP_ACCEPTED')) OR(outcome_value='unknown' AND(status_value IS NOT NULL OR result_code<>'TRANSPORT_UNCERTAIN')) OR(outcome_value='retryable' AND(status_value IS NULL OR NOT(status_value=429 OR status_value>=500) OR result_code<>'HTTP_RETRYABLE')) OR(outcome_value='blocked' AND(status_value IS NOT NULL OR result_code NOT IN('CONFIG_REQUIRED','CONFIG_CHANGED','EXTERNAL_NOT_AUTHORIZED','SCOPE_WITHDRAWN','PAYLOAD_INVALID'))) OR(outcome_value='rejected' AND(status_value IS NULL OR status_value<300 OR status_value>=500 OR status_value=429 OR result_code NOT IN('REDIRECT_BLOCKED','HTTP_REJECTED'))) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Webhook outcome contradicts HTTP receipt';END IF;
 UPDATE developer_webhook_attempts SET outcome=outcome_value,error_code=result_code,http_status=status_value,finished_at=at,scope_withdrawn=CASE WHEN withdrawn THEN 1 ELSE 0 END WHERE delivery_id=d.id AND attempt=attempt_row.attempt;
 IF withdrawn THEN
  UPDATE developer_webhook_deliveries SET status='cancelled',last_code='SCOPE_WITHDRAWN',http_status=status_value,lease_token=NULL,lease_until=NULL,updated_at=at WHERE id=d.id;
  RETURN jsonb_build_object('recorded',true,'status','cancelled','scopeWithdrawn',true);
 END IF;
 next_status:=CASE WHEN outcome_value='accepted' THEN 'delivered' WHEN outcome_value='rejected' THEN 'failed' WHEN outcome_value='blocked' THEN 'blocked' WHEN d.attempts<d.max_attempts THEN 'retrying' WHEN outcome_value='unknown' THEN 'unknown' ELSE 'failed' END;
 delay_seconds:=greatest(least(300,(5*power(3,least(4,d.attempts-1)))::integer),least(3600,greatest(0,coalesce((input->>'retryAfterSeconds')::integer,0))));
 UPDATE developer_webhook_deliveries SET status=next_status,last_code=result_code,http_status=status_value,lease_token=NULL,lease_until=NULL,available_at=CASE WHEN next_status='retrying' THEN to_char((clock_timestamp()+make_interval(secs=>delay_seconds)) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') ELSE available_at END,updated_at=at WHERE id=d.id;
 RETURN jsonb_build_object('recorded',true,'status',next_status,'scopeWithdrawn',false);
END;$dg$;
REVOKE ALL ON FUNCTION dg_native_webhook_queue(text,jsonb) FROM PUBLIC;
