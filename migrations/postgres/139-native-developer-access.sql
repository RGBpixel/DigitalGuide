CREATE TABLE developer_apps(
 id text PRIMARY KEY,tenant_id text NOT NULL,workspace_id text NOT NULL REFERENCES workspaces(id),environment text NOT NULL CHECK(environment IN('mock','sandbox','live')),app_env text NOT NULL CHECK(app_env IN('development','sandbox','production')),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 80),scopes text NOT NULL CHECK(scopes IN('["projects.read"]','["exports.read"]','["exports.read","projects.read"]')),
 enabled integer NOT NULL CHECK(enabled IN(0,1)),version bigint NOT NULL CHECK(version BETWEEN 1 AND 1000000000),created_by text NOT NULL REFERENCES users(id),created_at text NOT NULL,updated_at text NOT NULL,
 UNIQUE(id,tenant_id,workspace_id,environment,app_env)
);
CREATE TABLE developer_credentials(
 id text PRIMARY KEY,app_id text NOT NULL,tenant_id text NOT NULL,workspace_id text NOT NULL,environment text NOT NULL,app_env text NOT NULL,
 secret_hash text NOT NULL CHECK(secret_hash~'^[0-9a-f]{64}$'),expires_at text NOT NULL,revoked_at text,created_by text NOT NULL REFERENCES users(id),created_at text NOT NULL,version integer NOT NULL CHECK(version=1),
 FOREIGN KEY(app_id,tenant_id,workspace_id,environment,app_env) REFERENCES developer_apps(id,tenant_id,workspace_id,environment,app_env)
);
CREATE INDEX developer_credential_app ON developer_credentials(app_id,created_at,id);
CREATE TABLE developer_events(
 id text PRIMARY KEY,tenant_id text NOT NULL,workspace_id text NOT NULL,environment text NOT NULL,app_env text NOT NULL,actor_id text NOT NULL REFERENCES users(id),app_id text NOT NULL,credential_id text REFERENCES developer_credentials(id),
 action text NOT NULL CHECK(action IN('app.created','app.updated','credential.issued','credential.revoked')),revision bigint NOT NULL CHECK(revision BETWEEN 1 AND 1000000000),created_at text NOT NULL,
 FOREIGN KEY(app_id,tenant_id,workspace_id,environment,app_env) REFERENCES developer_apps(id,tenant_id,workspace_id,environment,app_env)
);
CREATE INDEX developer_event_scope ON developer_events(tenant_id,workspace_id,environment,app_env,created_at,id);
CREATE TABLE developer_rate_windows(credential_id text PRIMARY KEY REFERENCES developer_credentials(id),window_start text NOT NULL CHECK(length(window_start)=16),request_count integer NOT NULL CHECK(request_count BETWEEN 1 AND 60));
CREATE FUNCTION dg_native_developer_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
 IF TG_OP IN('DELETE','TRUNCATE') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Developer identities retain audit and revocation history';END IF;
 IF TG_TABLE_NAME='developer_apps' THEN
  IF NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.workspace_id<>OLD.workspace_id OR NEW.environment<>OLD.environment OR NEW.app_env<>OLD.app_env OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1 OR ((NEW.scopes<>OLD.scopes OR NEW.enabled=0) AND EXISTS(SELECT 1 FROM developer_credentials k WHERE k.app_id=OLD.id AND k.revoked_at IS NULL)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Developer application identity or revocation changed';END IF;
 ELSE
  IF NEW.id<>OLD.id OR NEW.app_id<>OLD.app_id OR NEW.tenant_id<>OLD.tenant_id OR NEW.workspace_id<>OLD.workspace_id OR NEW.environment<>OLD.environment OR NEW.app_env<>OLD.app_env OR NEW.secret_hash<>OLD.secret_hash OR NEW.expires_at<>OLD.expires_at OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Developer credential identity or revocation changed';END IF;
 END IF;RETURN NEW;
END;$dg$;
REVOKE ALL ON FUNCTION dg_native_developer_guard() FROM PUBLIC;
CREATE TRIGGER developer_apps_guard BEFORE UPDATE OR DELETE ON developer_apps FOR EACH ROW EXECUTE FUNCTION dg_native_developer_guard();
CREATE TRIGGER developer_apps_no_truncate BEFORE TRUNCATE ON developer_apps FOR EACH STATEMENT EXECUTE FUNCTION dg_native_developer_guard();
CREATE TRIGGER developer_credentials_guard BEFORE UPDATE OR DELETE ON developer_credentials FOR EACH ROW EXECUTE FUNCTION dg_native_developer_guard();
CREATE TRIGGER developer_credentials_no_truncate BEFORE TRUNCATE ON developer_credentials FOR EACH STATEMENT EXECUTE FUNCTION dg_native_developer_guard();
CREATE TRIGGER developer_events_immutable BEFORE UPDATE OR DELETE ON developer_events FOR EACH ROW EXECUTE FUNCTION dg_native_identity_event_immutable();
CREATE TRIGGER developer_events_no_truncate BEFORE TRUNCATE ON developer_events FOR EACH STATEMENT EXECUTE FUNCTION dg_native_identity_event_immutable();

CREATE FUNCTION dg_native_developer_read(d_credential text,d_hash text,d_resource text,d_target text,d_cursor text,d_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE control record;k record;a record;rate record;at text;minute text;required_scope text;items jsonb;row_count integer;detail boolean;next_cursor text;
BEGIN
 SELECT * INTO control FROM _dg_native_runtime_control WHERE id=1;
 IF control.id IS NULL OR control.status<>'validation_only' OR control.environment<>'mock' OR session_user<>control.app_role THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Developer API is unavailable in this runtime';END IF;
 IF d_resource IS NULL OR d_resource NOT IN('context','projects.list','projects.get','exports.list','exports.get') OR d_limit IS NULL OR d_limit<1 OR d_limit>100 OR d_target IS NULL OR d_cursor IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Developer API operation is invalid';END IF;
 IF d_credential IS NULL OR d_hash IS NULL OR d_hash!~'^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('error',jsonb_build_object('code','DEVELOPER_AUTH_REQUIRED','status',401));END IF;
 SELECT * INTO k FROM developer_credentials WHERE id=d_credential;
 IF k.id IS NULL OR k.secret_hash<>d_hash THEN RETURN jsonb_build_object('error',jsonb_build_object('code','DEVELOPER_AUTH_REQUIRED','status',401));END IF;
 SELECT * INTO a FROM developer_apps WHERE id=k.app_id FOR UPDATE;
 SELECT * INTO k FROM developer_credentials WHERE id=d_credential FOR UPDATE;
 at:=dg_utc_now();
 IF a.id IS NULL OR a.enabled<>1 OR a.environment<>control.environment OR a.app_env<>control.app_env OR k.revoked_at IS NOT NULL OR k.expires_at<=at OR k.secret_hash<>d_hash OR NOT EXISTS(SELECT 1 FROM workspaces w WHERE w.id=a.workspace_id AND w.tenant_id=a.tenant_id) THEN RETURN jsonb_build_object('error',jsonb_build_object('code','DEVELOPER_AUTH_REQUIRED','status',401));END IF;
 minute:=left(at,16);SELECT * INTO rate FROM developer_rate_windows WHERE credential_id=d_credential;
 IF rate.window_start=minute AND rate.request_count>=60 THEN RETURN jsonb_build_object('error',jsonb_build_object('code','DEVELOPER_RATE_LIMIT','status',429));END IF;
 INSERT INTO developer_rate_windows VALUES(d_credential,minute,1) ON CONFLICT(credential_id) DO UPDATE SET window_start=excluded.window_start,request_count=CASE WHEN developer_rate_windows.window_start=excluded.window_start THEN developer_rate_windows.request_count+1 ELSE 1 END;
 IF d_resource='context' THEN RETURN jsonb_build_object('data',jsonb_build_object('appId',a.id,'workspaceId',a.workspace_id,'environment',a.environment,'appEnv',a.app_env,'scopes',a.scopes::jsonb,'identity','organization_application','rateLimit',jsonb_build_object('requests',60,'windowSeconds',60)));END IF;
 detail:=right(d_resource,4)='.get';required_scope:=CASE WHEN left(d_resource,9)='projects.' THEN 'projects.read' ELSE 'exports.read' END;
 IF NOT jsonb_exists(a.scopes::jsonb,required_scope) THEN RETURN jsonb_build_object('error',jsonb_build_object('code','DEVELOPER_SCOPE_REQUIRED','status',403));END IF;
 IF required_scope='projects.read' THEN
  SELECT coalesce(jsonb_agg(value ORDER BY id),'[]'::jsonb),count(*)::integer INTO items,row_count FROM(
   SELECT p.id,jsonb_build_object('id',p.id,'name',p.name,'purpose',p.purpose,'version',p.version,'archived',p.archived=1,'createdAt',p.created_at,'updatedAt',p.updated_at) value FROM studio_projects p
   WHERE p.tenant_id=a.tenant_id AND p.workspace_id=a.workspace_id AND p.environment=a.environment AND p.app_env=a.app_env AND((detail AND p.id=d_target) OR(NOT detail AND p.id>d_cursor)) ORDER BY p.id LIMIT CASE WHEN detail THEN 1 ELSE d_limit+1 END
  ) selected;
 ELSE
  SELECT coalesce(jsonb_agg(value ORDER BY id),'[]'::jsonb),count(*)::integer INTO items,row_count FROM(
   SELECT e.id,jsonb_build_object('id',e.id,'projectId',e.project_id,'projectVersion',e.project_version,'kind',e.kind,'status',e.status,'progress',e.progress,'createdAt',e.created_at,'updatedAt',e.updated_at) value FROM studio_exports e JOIN studio_projects p ON p.id=e.project_id AND p.tenant_id=e.tenant_id AND p.workspace_id=e.workspace_id AND p.environment=e.environment AND p.app_env=e.app_env
   WHERE e.tenant_id=a.tenant_id AND e.workspace_id=a.workspace_id AND e.environment=a.environment AND e.app_env=a.app_env AND((detail AND e.id=d_target) OR(NOT detail AND e.id>d_cursor)) ORDER BY e.id LIMIT CASE WHEN detail THEN 1 ELSE d_limit+1 END
  ) selected;
 END IF;
 IF detail THEN IF row_count=0 THEN RETURN jsonb_build_object('error',jsonb_build_object('code','NOT_FOUND','status',404));END IF;RETURN jsonb_build_object('data',items->0);END IF;
 IF row_count>d_limit THEN next_cursor:=items->(d_limit-1)->>'id';items:=items-d_limit;END IF;
 RETURN jsonb_build_object('data',jsonb_build_object('items',items,'nextCursor',next_cursor));
END;$dg$;
REVOKE ALL ON FUNCTION dg_native_developer_read(text,text,text,text,text,integer) FROM PUBLIC;
