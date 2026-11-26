CREATE FUNCTION dg_native_developer_studio_grant_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE application_row record;member_row record;control_row record;
BEGIN
 IF TG_OP IN('DELETE','TRUNCATE') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Developer studio grants retain provenance';END IF;
 IF TG_OP='UPDATE' AND(NEW.app_id<>OLD.app_id OR NEW.tenant_id<>OLD.tenant_id OR NEW.workspace_id<>OLD.workspace_id OR NEW.environment<>OLD.environment OR NEW.app_env<>OLD.app_env OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Developer studio grant identity is immutable';END IF;
 IF jsonb_typeof(NEW.actions::jsonb)<>'array' OR jsonb_array_length(NEW.actions::jsonb) NOT BETWEEN 1 AND 4 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW.actions::jsonb) AS elements(value) WHERE value NOT IN('projects.write','exports.submit','exports.cancel','exports.download')) OR(SELECT count(DISTINCT value) FROM jsonb_array_elements_text(NEW.actions::jsonb) AS elements(value))<>jsonb_array_length(NEW.actions::jsonb) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Developer studio actions are invalid';END IF;
 SELECT * INTO control_row FROM _dg_native_runtime_control WHERE id=1;
 IF NEW.enabled=1 AND session_user=control_row.app_role THEN
  SELECT * INTO application_row FROM developer_apps WHERE id=NEW.app_id;
  IF application_row.id IS NULL OR application_row.enabled<>1 OR application_row.tenant_id<>NEW.tenant_id OR application_row.workspace_id<>NEW.workspace_id OR application_row.environment<>NEW.environment OR application_row.app_env<>NEW.app_env OR((jsonb_exists(NEW.actions::jsonb,'projects.write') OR jsonb_exists(NEW.actions::jsonb,'exports.submit')) AND NOT jsonb_exists(application_row.scopes::jsonb,'projects.read')) OR(EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW.actions::jsonb) AS elements(value) WHERE value LIKE 'exports.%') AND NOT jsonb_exists(application_row.scopes::jsonb,'exports.read')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Developer studio read scope is unavailable';END IF;
  SELECT * INTO member_row FROM dg_native_locked_membership(NEW.responsible_user_id);
  IF NEW.responsible_role IS DISTINCT FROM member_row.role OR NEW.responsible_control_version<>coalesce((SELECT c.version FROM enterprise_member_controls c WHERE c.user_id=NEW.responsible_user_id AND c.tenant_id=NEW.tenant_id AND c.environment=NEW.environment AND c.app_env=NEW.app_env),0) OR NEW.responsible_directory_version<>coalesce((SELECT d.version FROM enterprise_member_directory d WHERE d.user_id=NEW.responsible_user_id AND d.tenant_id=NEW.tenant_id AND d.environment=NEW.environment AND d.app_env=NEW.app_env),0) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Developer studio responsible authority changed';END IF;
  IF member_row.tenant_id IS DISTINCT FROM NEW.tenant_id OR member_row.role NOT IN('admin','editor') OR NOT jsonb_exists(member_row.workspace_ids::jsonb,NEW.workspace_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Developer studio responsible member is unavailable';END IF;
 END IF;
 RETURN NEW;
END;$dg$;
REVOKE ALL ON FUNCTION dg_native_developer_studio_grant_guard() FROM PUBLIC;
CREATE TRIGGER developer_studio_grant_guard BEFORE INSERT OR UPDATE OR DELETE ON developer_studio_grants FOR EACH ROW EXECUTE FUNCTION dg_native_developer_studio_grant_guard();
CREATE TRIGGER developer_studio_grant_no_truncate BEFORE TRUNCATE ON developer_studio_grants FOR EACH STATEMENT EXECUTE FUNCTION dg_native_developer_studio_grant_guard();
CREATE FUNCTION dg_native_developer_studio_grant_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 UPDATE developer_credentials SET revoked_at=NEW.updated_at WHERE app_id=NEW.app_id AND revoked_at IS NULL;
 IF TG_OP='UPDATE' THEN
  UPDATE studio_exports SET status='cancelled',lease_token=NULL,lease_until=NULL,error_message='应用制作授权已变化，原导出任务已取消，请重新核对后提交。',updated_at=NEW.updated_at WHERE id IN(SELECT export_id FROM developer_studio_job_origins WHERE app_id=NEW.app_id AND grant_version<>NEW.version) AND status IN('queued','rendering');
 END IF;RETURN NEW;
END;$dg$;
REVOKE ALL ON FUNCTION dg_native_developer_studio_grant_changed() FROM PUBLIC;
CREATE TRIGGER developer_studio_grant_changed AFTER INSERT OR UPDATE ON developer_studio_grants FOR EACH ROW EXECUTE FUNCTION dg_native_developer_studio_grant_changed();
CREATE FUNCTION dg_native_developer_studio_app_policy() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE old_grant record;
BEGIN
 IF NEW.enabled=0 OR NEW.scopes<>OLD.scopes THEN
  SELECT * INTO old_grant FROM developer_studio_grants WHERE app_id=NEW.id AND enabled=1 FOR UPDATE;
  IF old_grant.app_id IS NOT NULL THEN
   UPDATE developer_studio_grants SET enabled=0,version=version+1,updated_at=NEW.updated_at WHERE app_id=NEW.id;
   INSERT INTO developer_studio_events VALUES(gen_random_uuid()::text,old_grant.tenant_id,old_grant.workspace_id,old_grant.environment,old_grant.app_env,NULL,'application_policy',NEW.id,'policy_disabled',old_grant.version+1,old_grant.responsible_user_id,NEW.updated_at);
  END IF;
 END IF;RETURN NEW;
END;$dg$;
REVOKE ALL ON FUNCTION dg_native_developer_studio_app_policy() FROM PUBLIC;
CREATE TRIGGER developer_studio_app_policy AFTER UPDATE ON developer_apps FOR EACH ROW EXECUTE FUNCTION dg_native_developer_studio_app_policy();
CREATE TRIGGER developer_studio_events_immutable BEFORE UPDATE OR DELETE ON developer_studio_events FOR EACH ROW EXECUTE FUNCTION dg_native_identity_event_immutable();
CREATE TRIGGER developer_studio_events_no_truncate BEFORE TRUNCATE ON developer_studio_events FOR EACH STATEMENT EXECUTE FUNCTION dg_native_identity_event_immutable();
CREATE TRIGGER developer_studio_operations_immutable BEFORE UPDATE OR DELETE ON developer_studio_operations FOR EACH ROW EXECUTE FUNCTION dg_native_identity_event_immutable();
CREATE TRIGGER developer_studio_operations_no_truncate BEFORE TRUNCATE ON developer_studio_operations FOR EACH STATEMENT EXECUTE FUNCTION dg_native_identity_event_immutable();
CREATE TRIGGER developer_studio_origins_immutable BEFORE UPDATE OR DELETE ON developer_studio_job_origins FOR EACH ROW EXECUTE FUNCTION dg_native_identity_event_immutable();
CREATE TRIGGER developer_studio_origins_no_truncate BEFORE TRUNCATE ON developer_studio_job_origins FOR EACH STATEMENT EXECUTE FUNCTION dg_native_identity_event_immutable();
CREATE FUNCTION dg_native_developer_studio_operation_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE grant_row record;key_row record;project_row record;control_row record;needed text;
BEGIN
 SELECT * INTO grant_row FROM developer_studio_grants WHERE app_id=NEW.app_id;
 SELECT * INTO key_row FROM developer_credentials WHERE id=NEW.credential_id;
 SELECT * INTO project_row FROM studio_projects WHERE id=NEW.project_id;
 IF grant_row.app_id IS NULL OR key_row.app_id IS DISTINCT FROM NEW.app_id OR grant_row.tenant_id<>NEW.tenant_id OR grant_row.workspace_id<>NEW.workspace_id OR grant_row.environment<>NEW.environment OR grant_row.app_env<>NEW.app_env OR project_row.tenant_id IS DISTINCT FROM NEW.tenant_id OR project_row.workspace_id IS DISTINCT FROM NEW.workspace_id OR project_row.environment IS DISTINCT FROM NEW.environment OR project_row.app_env IS DISTINCT FROM NEW.app_env THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Developer studio operation scope is invalid';END IF;
 SELECT * INTO control_row FROM _dg_native_runtime_control WHERE id=1;
 IF session_user=control_row.app_role THEN
  needed:=CASE WHEN NEW.kind IN('project.created','project.saved') THEN 'projects.write' WHEN NEW.kind='export.created' THEN 'exports.submit' WHEN NEW.kind='export.cancelled' THEN 'exports.cancel' ELSE 'exports.download' END;
  IF grant_row.version<>NEW.grant_version OR grant_row.responsible_user_id<>NEW.responsible_user_id OR grant_row.enabled<>1 OR grant_row.expires_at<=dg_utc_now() OR NOT jsonb_exists(grant_row.actions::jsonb,needed) OR key_row.revoked_at IS NOT NULL OR key_row.expires_at<=dg_utc_now() OR NOT EXISTS(SELECT 1 FROM developer_apps WHERE id=NEW.app_id AND enabled=1) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Developer studio operation authorization changed';END IF;
  IF NEW.kind IN('project.created','project.saved') THEN
   IF NEW.resource_id<>NEW.project_id OR NEW.resource_version<>project_row.version THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Developer studio project receipt is invalid';END IF;
  ELSIF NEW.kind IN('export.created','export.cancelled') THEN
   IF NOT EXISTS(SELECT 1 FROM studio_exports e WHERE e.id=NEW.resource_id AND e.project_id=NEW.project_id AND e.tenant_id=NEW.tenant_id AND e.workspace_id=NEW.workspace_id AND e.environment=NEW.environment AND e.app_env=NEW.app_env AND e.project_version=NEW.resource_version) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Developer studio export receipt is invalid';END IF;
  ELSE
   IF NOT EXISTS(SELECT 1 FROM studio_export_artifacts a JOIN studio_exports e ON e.id=a.export_id WHERE a.id=NEW.resource_id AND e.project_id=NEW.project_id AND e.tenant_id=NEW.tenant_id AND e.workspace_id=NEW.workspace_id AND e.environment=NEW.environment AND e.app_env=NEW.app_env AND e.project_version=NEW.resource_version AND e.status='succeeded') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Developer studio artifact receipt is invalid';END IF;
  END IF;
 END IF;RETURN NEW;
END;$dg$;
REVOKE ALL ON FUNCTION dg_native_developer_studio_operation_guard() FROM PUBLIC;
CREATE TRIGGER developer_studio_operation_guard BEFORE INSERT ON developer_studio_operations FOR EACH ROW EXECUTE FUNCTION dg_native_developer_studio_operation_guard();
CREATE FUNCTION dg_native_developer_studio_origin_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM developer_studio_operations o JOIN studio_exports e ON e.id=NEW.export_id WHERE o.id=NEW.operation_id AND o.app_id=NEW.app_id AND o.tenant_id=NEW.tenant_id AND o.workspace_id=NEW.workspace_id AND o.environment=NEW.environment AND o.app_env=NEW.app_env AND o.grant_version=NEW.grant_version AND o.credential_id=NEW.credential_id AND o.responsible_user_id=NEW.responsible_user_id AND o.kind='export.created' AND o.resource_id=e.id AND o.project_id=e.project_id AND e.actor_id=NEW.responsible_user_id AND e.tenant_id=NEW.tenant_id AND e.workspace_id=NEW.workspace_id AND e.environment=NEW.environment AND e.app_env=NEW.app_env) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Developer studio export origin is invalid';END IF;RETURN NEW;
END;$dg$;
REVOKE ALL ON FUNCTION dg_native_developer_studio_origin_guard() FROM PUBLIC;
CREATE TRIGGER developer_studio_origin_guard BEFORE INSERT ON developer_studio_job_origins FOR EACH ROW EXECUTE FUNCTION dg_native_developer_studio_origin_guard();
CREATE FUNCTION dg_native_developer_studio_job(export_id text,responsible_id text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE control_row record;member_row record;export_row record;origin_row record;application_row record;grant_row record;organization_key text;
BEGIN
 SELECT * INTO control_row FROM _dg_native_runtime_control WHERE id=1;
 IF control_row.id IS NULL OR control_row.status<>'validation_only' OR control_row.environment<>'mock' OR session_user<>control_row.worker_role THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Developer studio worker role is not allowed';END IF;
 SELECT * INTO export_row FROM studio_exports WHERE id=export_id AND environment=control_row.environment AND app_env=control_row.app_env;
 IF export_row.id IS NULL OR export_row.actor_id IS DISTINCT FROM responsible_id THEN RETURN false;END IF;
 SELECT * INTO origin_row FROM developer_studio_job_origins WHERE developer_studio_job_origins.export_id=export_row.id;
 IF origin_row.export_id IS NULL THEN RETURN true;END IF;
 organization_key:='["enterprise-identity-organization",'||to_json(origin_row.tenant_id)::text||',"mock",'||to_json(control_row.app_env)::text||']';PERFORM pg_advisory_xact_lock_shared(hashtextextended(organization_key,0));
 SELECT * INTO application_row FROM developer_apps WHERE id=origin_row.app_id FOR SHARE;
 SELECT * INTO grant_row FROM developer_studio_grants WHERE app_id=origin_row.app_id FOR SHARE;
 SELECT * INTO member_row FROM dg_native_locked_membership(responsible_id);
 RETURN coalesce(application_row.enabled=1 AND grant_row.enabled=1 AND grant_row.version=origin_row.grant_version AND grant_row.expires_at>dg_utc_now() AND jsonb_exists(grant_row.actions::jsonb,'exports.submit') AND jsonb_exists(application_row.scopes::jsonb,'projects.read') AND jsonb_exists(application_row.scopes::jsonb,'exports.read') AND grant_row.responsible_role=member_row.role AND grant_row.responsible_control_version=coalesce((SELECT c.version FROM enterprise_member_controls c WHERE c.user_id=responsible_id AND c.tenant_id=origin_row.tenant_id AND c.environment=origin_row.environment AND c.app_env=origin_row.app_env),0) AND grant_row.responsible_directory_version=coalesce((SELECT d.version FROM enterprise_member_directory d WHERE d.user_id=responsible_id AND d.tenant_id=origin_row.tenant_id AND d.environment=origin_row.environment AND d.app_env=origin_row.app_env),0) AND origin_row.responsible_user_id=responsible_id AND grant_row.responsible_user_id=responsible_id AND origin_row.tenant_id=export_row.tenant_id AND origin_row.workspace_id=export_row.workspace_id AND origin_row.environment=export_row.environment AND origin_row.app_env=export_row.app_env,false);
END;$dg$;
REVOKE ALL ON FUNCTION dg_native_developer_studio_job(text,text) FROM PUBLIC;
