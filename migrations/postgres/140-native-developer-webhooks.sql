CREATE TABLE developer_webhook_subscriptions(
 id text PRIMARY KEY,app_id text NOT NULL,tenant_id text NOT NULL,workspace_id text NOT NULL,environment text NOT NULL,app_env text NOT NULL,destination_id text NOT NULL,fingerprint text NOT NULL CHECK(length(fingerprint)=64),
 topics text NOT NULL CHECK(topics IN('["projects.changed"]','["exports.changed"]','["exports.changed","projects.changed"]')),enabled bigint NOT NULL CHECK(enabled IN(0,1)),version bigint NOT NULL CHECK(version BETWEEN 1 AND 1000000000),created_by text NOT NULL REFERENCES users(id),created_at text NOT NULL,updated_at text NOT NULL,
 UNIQUE(app_id,destination_id),UNIQUE(id,tenant_id,workspace_id,environment,app_env),FOREIGN KEY(app_id,tenant_id,workspace_id,environment,app_env) REFERENCES developer_apps(id,tenant_id,workspace_id,environment,app_env)
);
CREATE TABLE developer_webhook_sources(topic text NOT NULL CHECK(topic IN('projects.changed','exports.changed','webhook.test')),source_id text NOT NULL,tenant_id text NOT NULL,workspace_id text NOT NULL REFERENCES workspaces(id),environment text NOT NULL,app_env text NOT NULL,sequence bigint NOT NULL CHECK(sequence BETWEEN 1 AND 1000000000),last_event_id text NOT NULL,PRIMARY KEY(topic,source_id));
CREATE TABLE developer_webhook_events(
 id text PRIMARY KEY,tenant_id text NOT NULL,workspace_id text NOT NULL,environment text NOT NULL,app_env text NOT NULL,topic text NOT NULL,source_id text NOT NULL,sequence bigint NOT NULL CHECK(sequence BETWEEN 1 AND 1000000000),payload text NOT NULL CHECK(octet_length(payload)<=32768 AND jsonb_typeof(payload::jsonb)='object'),created_at text NOT NULL,version bigint NOT NULL CHECK(version=1),
 UNIQUE(id,tenant_id,workspace_id,environment,app_env),UNIQUE(topic,source_id,sequence),FOREIGN KEY(topic,source_id) REFERENCES developer_webhook_sources(topic,source_id)
);
CREATE TABLE developer_webhook_deliveries(
 id text PRIMARY KEY,subscription_id text NOT NULL,event_id text NOT NULL,tenant_id text NOT NULL,workspace_id text NOT NULL,environment text NOT NULL,app_env text NOT NULL,generation bigint NOT NULL CHECK(generation BETWEEN 1 AND 1000000000),fingerprint text NOT NULL CHECK(length(fingerprint)=64),
 status text NOT NULL CHECK(status IN('queued','sending','retrying','delivered','failed','unknown','blocked','cancelled')),attempts bigint NOT NULL DEFAULT 0,max_attempts bigint NOT NULL DEFAULT 5,available_at text NOT NULL,lease_token text,lease_until text,last_code text CHECK(last_code IN('HTTP_ACCEPTED','HTTP_REJECTED','HTTP_RETRYABLE','REDIRECT_BLOCKED','TRANSPORT_UNCERTAIN','CONFIG_REQUIRED','CONFIG_CHANGED','EXTERNAL_NOT_AUTHORIZED','SCOPE_WITHDRAWN','LEASE_EXPIRED','PAYLOAD_INVALID')),http_status bigint CHECK(http_status BETWEEN 100 AND 599),created_at text NOT NULL,updated_at text NOT NULL,
 CHECK(attempts BETWEEN 0 AND max_attempts AND max_attempts BETWEEN 1 AND 20),CHECK((status='sending' AND lease_token IS NOT NULL AND lease_until IS NOT NULL) OR(status<>'sending' AND lease_token IS NULL AND lease_until IS NULL)),
 UNIQUE(subscription_id,event_id),FOREIGN KEY(subscription_id,tenant_id,workspace_id,environment,app_env) REFERENCES developer_webhook_subscriptions(id,tenant_id,workspace_id,environment,app_env),FOREIGN KEY(event_id,tenant_id,workspace_id,environment,app_env) REFERENCES developer_webhook_events(id,tenant_id,workspace_id,environment,app_env)
);
CREATE INDEX developer_webhook_queue ON developer_webhook_deliveries(environment,app_env,status,available_at,created_at,id);
CREATE TABLE developer_webhook_attempts(
 delivery_id text NOT NULL REFERENCES developer_webhook_deliveries(id),attempt bigint NOT NULL CHECK(attempt BETWEEN 1 AND 20),lease_token text NOT NULL UNIQUE,lease_until text NOT NULL,body_sha256 text CHECK(length(body_sha256)=64),outcome text NOT NULL CHECK(outcome IN('sending','accepted','retryable','rejected','unknown','blocked')),error_code text CHECK(error_code IN('HTTP_ACCEPTED','HTTP_REJECTED','HTTP_RETRYABLE','REDIRECT_BLOCKED','TRANSPORT_UNCERTAIN','CONFIG_REQUIRED','CONFIG_CHANGED','EXTERNAL_NOT_AUTHORIZED','SCOPE_WITHDRAWN','LEASE_EXPIRED','PAYLOAD_INVALID')),http_status bigint CHECK(http_status BETWEEN 100 AND 599),started_at text NOT NULL,finished_at text,scope_withdrawn bigint NOT NULL DEFAULT 0 CHECK(scope_withdrawn IN(0,1)),PRIMARY KEY(delivery_id,attempt),CHECK((outcome='sending' AND finished_at IS NULL) OR(outcome<>'sending' AND finished_at IS NOT NULL))
);
CREATE TABLE developer_webhook_changes(
 id text PRIMARY KEY,tenant_id text NOT NULL,workspace_id text NOT NULL,environment text NOT NULL,app_env text NOT NULL,actor_id text REFERENCES users(id),origin text NOT NULL CHECK(origin IN('administrator','application_policy')),subscription_id text NOT NULL,action text NOT NULL CHECK(action IN('created','configured','test_queued','retry_queued','policy_disabled')),revision bigint NOT NULL CHECK(revision BETWEEN 1 AND 1000000000),delivery_id text REFERENCES developer_webhook_deliveries(id),created_at text NOT NULL,
 CHECK((origin='administrator' AND actor_id IS NOT NULL) OR(origin='application_policy' AND actor_id IS NULL)),FOREIGN KEY(subscription_id,tenant_id,workspace_id,environment,app_env) REFERENCES developer_webhook_subscriptions(id,tenant_id,workspace_id,environment,app_env)
);
CREATE FUNCTION dg_native_webhook_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
 IF TG_OP IN('DELETE','TRUNCATE') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Webhook identities retain audit history';END IF;
 IF TG_TABLE_NAME='developer_webhook_subscriptions' THEN
  IF NEW.id<>OLD.id OR NEW.app_id<>OLD.app_id OR NEW.tenant_id<>OLD.tenant_id OR NEW.workspace_id<>OLD.workspace_id OR NEW.environment<>OLD.environment OR NEW.app_env<>OLD.app_env OR NEW.destination_id<>OLD.destination_id OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Webhook subscription identity is immutable';END IF;
 ELSIF TG_TABLE_NAME='developer_webhook_attempts' THEN
  IF OLD.outcome<>'sending' OR NEW.delivery_id<>OLD.delivery_id OR NEW.attempt<>OLD.attempt OR NEW.lease_token<>OLD.lease_token OR NEW.lease_until<>OLD.lease_until OR NEW.started_at<>OLD.started_at OR NEW.scope_withdrawn<OLD.scope_withdrawn OR(OLD.body_sha256 IS NOT NULL AND NEW.body_sha256 IS DISTINCT FROM OLD.body_sha256) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Webhook attempt receipt is immutable';END IF;
 ELSE
  IF NEW.id<>OLD.id OR NEW.subscription_id<>OLD.subscription_id OR NEW.event_id<>OLD.event_id OR NEW.tenant_id<>OLD.tenant_id OR NEW.workspace_id<>OLD.workspace_id OR NEW.environment<>OLD.environment OR NEW.app_env<>OLD.app_env OR NEW.generation<>OLD.generation OR NEW.fingerprint<>OLD.fingerprint OR NEW.created_at<>OLD.created_at OR NEW.attempts<OLD.attempts OR(OLD.status IN('delivered','cancelled') AND NEW.status<>OLD.status) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Webhook delivery identity is immutable';END IF;
 END IF;RETURN NEW;
END;$dg$;
REVOKE ALL ON FUNCTION dg_native_webhook_guard() FROM PUBLIC;
CREATE TRIGGER developer_webhook_subscription_guard BEFORE UPDATE OR DELETE ON developer_webhook_subscriptions FOR EACH ROW EXECUTE FUNCTION dg_native_webhook_guard();
CREATE TRIGGER developer_webhook_subscription_no_truncate BEFORE TRUNCATE ON developer_webhook_subscriptions FOR EACH STATEMENT EXECUTE FUNCTION dg_native_webhook_guard();
CREATE TRIGGER developer_webhook_delivery_guard BEFORE UPDATE OR DELETE ON developer_webhook_deliveries FOR EACH ROW EXECUTE FUNCTION dg_native_webhook_guard();
CREATE TRIGGER developer_webhook_delivery_no_truncate BEFORE TRUNCATE ON developer_webhook_deliveries FOR EACH STATEMENT EXECUTE FUNCTION dg_native_webhook_guard();
CREATE TRIGGER developer_webhook_attempt_guard BEFORE UPDATE OR DELETE ON developer_webhook_attempts FOR EACH ROW EXECUTE FUNCTION dg_native_webhook_guard();
CREATE TRIGGER developer_webhook_attempt_no_truncate BEFORE TRUNCATE ON developer_webhook_attempts FOR EACH STATEMENT EXECUTE FUNCTION dg_native_webhook_guard();
CREATE TRIGGER developer_webhook_events_immutable BEFORE UPDATE OR DELETE ON developer_webhook_events FOR EACH ROW EXECUTE FUNCTION dg_native_identity_event_immutable();
CREATE TRIGGER developer_webhook_events_no_truncate BEFORE TRUNCATE ON developer_webhook_events FOR EACH STATEMENT EXECUTE FUNCTION dg_native_identity_event_immutable();
CREATE TRIGGER developer_webhook_changes_immutable BEFORE UPDATE OR DELETE ON developer_webhook_changes FOR EACH ROW EXECUTE FUNCTION dg_native_identity_event_immutable();
CREATE TRIGGER developer_webhook_changes_no_truncate BEFORE TRUNCATE ON developer_webhook_changes FOR EACH STATEMENT EXECUTE FUNCTION dg_native_identity_event_immutable();

CREATE FUNCTION dg_native_webhook_subscription_cancel() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 UPDATE developer_webhook_attempts SET scope_withdrawn=1 WHERE outcome='sending' AND scope_withdrawn=0 AND delivery_id IN(SELECT id FROM developer_webhook_deliveries WHERE subscription_id=NEW.id AND generation<>NEW.version);
 UPDATE developer_webhook_deliveries SET status='cancelled',lease_token=NULL,lease_until=NULL,last_code='SCOPE_WITHDRAWN',updated_at=NEW.updated_at WHERE subscription_id=NEW.id AND generation<>NEW.version AND status NOT IN('delivered','cancelled');RETURN NEW;
END;$dg$;
REVOKE ALL ON FUNCTION dg_native_webhook_subscription_cancel() FROM PUBLIC;
CREATE TRIGGER developer_webhook_subscription_cancel AFTER UPDATE ON developer_webhook_subscriptions FOR EACH ROW EXECUTE FUNCTION dg_native_webhook_subscription_cancel();
CREATE FUNCTION dg_native_webhook_application_policy() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE old_sub record;
BEGIN
 IF NEW.enabled=0 OR NEW.scopes<>OLD.scopes THEN
  FOR old_sub IN SELECT * FROM developer_webhook_subscriptions WHERE app_id=NEW.id AND enabled=1 ORDER BY id FOR UPDATE LOOP
   UPDATE developer_webhook_subscriptions SET enabled=0,version=version+1,updated_at=NEW.updated_at WHERE id=old_sub.id;
   INSERT INTO developer_webhook_changes VALUES(gen_random_uuid()::text,old_sub.tenant_id,old_sub.workspace_id,old_sub.environment,old_sub.app_env,NULL,'application_policy',old_sub.id,'policy_disabled',old_sub.version+1,NULL,NEW.updated_at);
  END LOOP;
 END IF;RETURN NEW;
END;$dg$;
REVOKE ALL ON FUNCTION dg_native_webhook_application_policy() FROM PUBLIC;
CREATE TRIGGER developer_webhook_application_policy AFTER UPDATE ON developer_apps FOR EACH ROW EXECUTE FUNCTION dg_native_webhook_application_policy();

CREATE FUNCTION dg_native_webhook_capture() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE control record;event_topic text;required_scope text;body_data jsonb;source_row record;event_id text;at text;
BEGIN
 SELECT * INTO control FROM _dg_native_runtime_control WHERE id=1;
 IF control.id IS NULL OR control.status<>'validation_only' OR session_user NOT IN(control.app_role,control.worker_role) OR NEW.environment<>control.environment OR NEW.app_env<>control.app_env THEN RETURN NEW;END IF;
 IF TG_TABLE_NAME='studio_projects' THEN
  IF TG_OP='UPDATE' AND NEW.version=OLD.version AND NEW.name=OLD.name AND NEW.archived=OLD.archived THEN RETURN NEW;END IF;
  event_topic:='projects.changed';required_scope:='projects.read';body_data:=jsonb_build_object('id',NEW.id,'name',NEW.name,'purpose',NEW.purpose,'version',NEW.version,'archived',NEW.archived=1,'createdAt',NEW.created_at,'updatedAt',NEW.updated_at);
 ELSE
  IF TG_OP='UPDATE' AND NEW.status=OLD.status THEN RETURN NEW;END IF;
  IF NOT EXISTS(SELECT 1 FROM studio_projects p WHERE p.id=NEW.project_id AND p.tenant_id=NEW.tenant_id AND p.workspace_id=NEW.workspace_id AND p.environment=NEW.environment AND p.app_env=NEW.app_env) THEN RETURN NEW;END IF;
  event_topic:='exports.changed';required_scope:='exports.read';body_data:=jsonb_build_object('id',NEW.id,'projectId',NEW.project_id,'projectVersion',NEW.project_version,'kind',NEW.kind,'status',NEW.status,'progress',NEW.progress,'createdAt',NEW.created_at,'updatedAt',NEW.updated_at);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM developer_webhook_subscriptions s JOIN developer_apps a ON a.id=s.app_id WHERE s.tenant_id=NEW.tenant_id AND s.workspace_id=NEW.workspace_id AND s.environment=NEW.environment AND s.app_env=NEW.app_env AND s.enabled=1 AND a.enabled=1 AND jsonb_exists(s.topics::jsonb,event_topic) AND jsonb_exists(a.scopes::jsonb,required_scope)) THEN RETURN NEW;END IF;
 event_id:=gen_random_uuid()::text;at:=dg_utc_now();
 INSERT INTO developer_webhook_sources VALUES(event_topic,NEW.id,NEW.tenant_id,NEW.workspace_id,NEW.environment,NEW.app_env,1,event_id) ON CONFLICT(topic,source_id) DO UPDATE SET sequence=developer_webhook_sources.sequence+1,last_event_id=excluded.last_event_id RETURNING * INTO source_row;
 IF source_row.tenant_id<>NEW.tenant_id OR source_row.workspace_id<>NEW.workspace_id OR source_row.environment<>NEW.environment OR source_row.app_env<>NEW.app_env THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Webhook source identity changed';END IF;
 INSERT INTO developer_webhook_events VALUES(event_id,NEW.tenant_id,NEW.workspace_id,NEW.environment,NEW.app_env,event_topic,NEW.id,source_row.sequence,jsonb_build_object('version',1,'id',event_id,'type',event_topic,'occurredAt',at,'sequence',source_row.sequence,'tenantId',NEW.tenant_id,'workspaceId',NEW.workspace_id,'environment',NEW.environment,'appEnv',NEW.app_env,'data',body_data)::text,at,1);
 INSERT INTO developer_webhook_deliveries(id,subscription_id,event_id,tenant_id,workspace_id,environment,app_env,generation,fingerprint,status,attempts,max_attempts,available_at,created_at,updated_at)
 SELECT gen_random_uuid()::text,s.id,event_id,s.tenant_id,s.workspace_id,s.environment,s.app_env,s.version,s.fingerprint,'queued',0,5,at,at,at FROM developer_webhook_subscriptions s JOIN developer_apps a ON a.id=s.app_id WHERE s.tenant_id=NEW.tenant_id AND s.workspace_id=NEW.workspace_id AND s.environment=NEW.environment AND s.app_env=NEW.app_env AND s.enabled=1 AND a.enabled=1 AND jsonb_exists(s.topics::jsonb,event_topic) AND jsonb_exists(a.scopes::jsonb,required_scope);
 RETURN NEW;
END;$dg$;
REVOKE ALL ON FUNCTION dg_native_webhook_capture() FROM PUBLIC;
CREATE TRIGGER developer_webhook_project_capture AFTER INSERT OR UPDATE ON studio_projects FOR EACH ROW EXECUTE FUNCTION dg_native_webhook_capture();
CREATE TRIGGER developer_webhook_export_capture AFTER INSERT OR UPDATE ON studio_exports FOR EACH ROW EXECUTE FUNCTION dg_native_webhook_capture();
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
