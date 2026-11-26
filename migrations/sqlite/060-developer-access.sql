CREATE TABLE developer_apps(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL REFERENCES workspaces(id),environment TEXT NOT NULL CHECK(environment IN('mock','sandbox','live')),app_env TEXT NOT NULL CHECK(app_env IN('development','sandbox','production')),
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),scopes TEXT NOT NULL CHECK(scopes IN('["projects.read"]','["exports.read"]','["exports.read","projects.read"]')),
 enabled INTEGER NOT NULL CHECK(enabled IN(0,1)),version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 1000000000),created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 UNIQUE(id,tenant_id,workspace_id,environment,app_env)
);
CREATE TABLE developer_credentials(
 id TEXT PRIMARY KEY,app_id TEXT NOT NULL,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,environment TEXT NOT NULL,app_env TEXT NOT NULL,
 secret_hash TEXT NOT NULL CHECK(length(secret_hash)=64),expires_at TEXT NOT NULL,revoked_at TEXT,created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,version INTEGER NOT NULL CHECK(version=1),
 FOREIGN KEY(app_id,tenant_id,workspace_id,environment,app_env) REFERENCES developer_apps(id,tenant_id,workspace_id,environment,app_env)
);
CREATE INDEX developer_credential_app ON developer_credentials(app_id,created_at,id);
CREATE TABLE developer_events(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,environment TEXT NOT NULL,app_env TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),app_id TEXT NOT NULL,credential_id TEXT REFERENCES developer_credentials(id),
 action TEXT NOT NULL CHECK(action IN('app.created','app.updated','credential.issued','credential.revoked')),revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 1000000000),created_at TEXT NOT NULL,
 FOREIGN KEY(app_id,tenant_id,workspace_id,environment,app_env) REFERENCES developer_apps(id,tenant_id,workspace_id,environment,app_env)
);
CREATE INDEX developer_event_scope ON developer_events(tenant_id,workspace_id,environment,app_env,created_at,id);
CREATE TABLE developer_rate_windows(credential_id TEXT PRIMARY KEY REFERENCES developer_credentials(id),window_start TEXT NOT NULL CHECK(length(window_start)=16),request_count INTEGER NOT NULL CHECK(request_count BETWEEN 1 AND 60));
CREATE TRIGGER developer_apps_identity BEFORE UPDATE ON developer_apps WHEN NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.workspace_id<>OLD.workspace_id OR NEW.environment<>OLD.environment OR NEW.app_env<>OLD.app_env OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1 OR ((NEW.scopes<>OLD.scopes OR NEW.enabled=0) AND EXISTS(SELECT 1 FROM developer_credentials c WHERE c.app_id=OLD.id AND c.revoked_at IS NULL)) BEGIN SELECT RAISE(ABORT,'Developer application identity and credential revocation must be preserved');END;
CREATE TRIGGER developer_apps_delete BEFORE DELETE ON developer_apps BEGIN SELECT RAISE(ABORT,'Developer applications retain audit identity');END;
CREATE TRIGGER developer_credentials_identity BEFORE UPDATE ON developer_credentials WHEN NEW.id<>OLD.id OR NEW.app_id<>OLD.app_id OR NEW.tenant_id<>OLD.tenant_id OR NEW.workspace_id<>OLD.workspace_id OR NEW.environment<>OLD.environment OR NEW.app_env<>OLD.app_env OR NEW.secret_hash<>OLD.secret_hash OR NEW.expires_at<>OLD.expires_at OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NOT OLD.revoked_at) BEGIN SELECT RAISE(ABORT,'Developer credential identity and revocation are immutable');END;
CREATE TRIGGER developer_credentials_delete BEFORE DELETE ON developer_credentials BEGIN SELECT RAISE(ABORT,'Developer credentials retain revocation history');END;
CREATE TRIGGER developer_events_update BEFORE UPDATE ON developer_events BEGIN SELECT RAISE(ABORT,'Developer events are immutable');END;
CREATE TRIGGER developer_events_delete BEFORE DELETE ON developer_events BEGIN SELECT RAISE(ABORT,'Developer events are immutable');END;
