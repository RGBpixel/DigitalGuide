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
