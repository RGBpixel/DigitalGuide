import fs from 'node:fs';
import assert from 'node:assert/strict';
const actions="'projects.write','exports.submit','exports.cancel','exports.download'",operations="'project.created','project.saved','export.created','export.cancelled','file.download_started'";
const schema=`CREATE TABLE developer_studio_grants(
 app_id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,environment TEXT NOT NULL,app_env TEXT NOT NULL,responsible_user_id TEXT NOT NULL REFERENCES users(id),responsible_role TEXT NOT NULL CHECK(responsible_role IN('admin','editor')),responsible_control_version INTEGER NOT NULL CHECK(responsible_control_version BETWEEN 0 AND 1000000000),responsible_directory_version INTEGER NOT NULL CHECK(responsible_directory_version BETWEEN 0 AND 1000000000),
 actions TEXT NOT NULL,enabled INTEGER NOT NULL CHECK(enabled IN(0,1)),expires_at TEXT NOT NULL,version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 1000000000),created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 UNIQUE(app_id,tenant_id,workspace_id,environment,app_env),FOREIGN KEY(app_id,tenant_id,workspace_id,environment,app_env) REFERENCES developer_apps(id,tenant_id,workspace_id,environment,app_env)
);
CREATE TABLE developer_studio_events(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,environment TEXT NOT NULL,app_env TEXT NOT NULL,actor_id TEXT REFERENCES users(id),origin TEXT NOT NULL CHECK(origin IN('administrator','application_policy')),app_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN('created','configured','policy_disabled')),version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 1000000000),responsible_user_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,
 CHECK((origin='administrator' AND actor_id IS NOT NULL) OR(origin='application_policy' AND actor_id IS NULL)),FOREIGN KEY(app_id,tenant_id,workspace_id,environment,app_env) REFERENCES developer_studio_grants(app_id,tenant_id,workspace_id,environment,app_env)
);
CREATE TABLE developer_studio_operations(
 id TEXT PRIMARY KEY,app_id TEXT NOT NULL,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,environment TEXT NOT NULL,app_env TEXT NOT NULL,credential_id TEXT NOT NULL REFERENCES developer_credentials(id),grant_version INTEGER NOT NULL CHECK(grant_version BETWEEN 1 AND 1000000000),responsible_user_id TEXT NOT NULL REFERENCES users(id),
 kind TEXT NOT NULL CHECK(kind IN(${operations})),request_hash TEXT NOT NULL CHECK(length(request_hash)=64),idempotency_hash TEXT CHECK(length(idempotency_hash)=64),resource_id TEXT NOT NULL,project_id TEXT NOT NULL REFERENCES studio_projects(id),resource_version INTEGER NOT NULL CHECK(resource_version BETWEEN 1 AND 1000000000),request_id TEXT NOT NULL CHECK(length(request_id)<=160),created_at TEXT NOT NULL,
 UNIQUE(app_id,kind,idempotency_hash),UNIQUE(id,app_id,tenant_id,workspace_id,environment,app_env),FOREIGN KEY(app_id,tenant_id,workspace_id,environment,app_env) REFERENCES developer_studio_grants(app_id,tenant_id,workspace_id,environment,app_env)
);
CREATE INDEX developer_studio_operation_history ON developer_studio_operations(tenant_id,workspace_id,environment,app_env,created_at,id);
CREATE TABLE developer_studio_job_origins(
 export_id TEXT PRIMARY KEY REFERENCES studio_exports(id),app_id TEXT NOT NULL,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,environment TEXT NOT NULL,app_env TEXT NOT NULL,grant_version INTEGER NOT NULL CHECK(grant_version BETWEEN 1 AND 1000000000),responsible_user_id TEXT NOT NULL REFERENCES users(id),credential_id TEXT NOT NULL REFERENCES developer_credentials(id),operation_id TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,
 FOREIGN KEY(operation_id,app_id,tenant_id,workspace_id,environment,app_env) REFERENCES developer_studio_operations(id,app_id,tenant_id,workspace_id,environment,app_env),FOREIGN KEY(app_id,tenant_id,workspace_id,environment,app_env) REFERENCES developer_studio_grants(app_id,tenant_id,workspace_id,environment,app_env)
);
`;
const grantIdentity="NEW.app_id<>OLD.app_id OR NEW.tenant_id<>OLD.tenant_id OR NEW.workspace_id<>OLD.workspace_id OR NEW.environment<>OLD.environment OR NEW.app_env<>OLD.app_env OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1";
const sqlite= schema+`
CREATE TRIGGER developer_studio_grant_identity BEFORE UPDATE ON developer_studio_grants WHEN ${grantIdentity} BEGIN SELECT RAISE(ABORT,'Developer studio grant identity is immutable');END;
CREATE TRIGGER developer_studio_grant_no_delete BEFORE DELETE ON developer_studio_grants BEGIN SELECT RAISE(ABORT,'Developer studio grants retain provenance');END;
`+['INSERT','UPDATE'].map(event=>`CREATE TRIGGER developer_studio_grant_${event.toLowerCase()} BEFORE ${event} ON developer_studio_grants BEGIN
 SELECT CASE WHEN json_valid(NEW.actions)=0 OR json_type(NEW.actions)<>'array' OR json_array_length(NEW.actions) NOT BETWEEN 1 AND 4 OR EXISTS(SELECT 1 FROM json_each(NEW.actions) WHERE type<>'text' OR value NOT IN(${actions})) OR(SELECT count(DISTINCT value) FROM json_each(NEW.actions))<>json_array_length(NEW.actions) THEN RAISE(ABORT,'Developer studio actions are invalid') END;
 SELECT CASE WHEN NEW.enabled=1 AND NOT EXISTS(SELECT 1 FROM developer_apps a WHERE a.id=NEW.app_id AND a.enabled=1 AND a.tenant_id=NEW.tenant_id AND a.workspace_id=NEW.workspace_id AND a.environment=NEW.environment AND a.app_env=NEW.app_env AND (NOT EXISTS(SELECT 1 FROM json_each(NEW.actions) WHERE value IN('projects.write','exports.submit')) OR EXISTS(SELECT 1 FROM json_each(a.scopes) WHERE value='projects.read')) AND (NOT EXISTS(SELECT 1 FROM json_each(NEW.actions) WHERE value LIKE 'exports.%') OR EXISTS(SELECT 1 FROM json_each(a.scopes) WHERE value='exports.read'))) THEN RAISE(ABORT,'Developer studio read scope is unavailable') END;
END;
`).join('')+`
CREATE TRIGGER developer_studio_grant_created AFTER INSERT ON developer_studio_grants BEGIN UPDATE developer_credentials SET revoked_at=NEW.updated_at WHERE app_id=NEW.app_id AND revoked_at IS NULL;END;
CREATE TRIGGER developer_studio_grant_changed AFTER UPDATE ON developer_studio_grants BEGIN
 UPDATE developer_credentials SET revoked_at=NEW.updated_at WHERE app_id=NEW.app_id AND revoked_at IS NULL;
 UPDATE studio_exports SET status='cancelled',lease_token=NULL,lease_until=NULL,error_message='应用制作授权已变化，原导出任务已取消，请重新核对后提交。',updated_at=NEW.updated_at WHERE id IN(SELECT export_id FROM developer_studio_job_origins WHERE app_id=NEW.app_id AND grant_version<>NEW.version) AND status IN('queued','rendering');
END;
CREATE TRIGGER developer_studio_app_policy AFTER UPDATE ON developer_apps WHEN NEW.enabled=0 OR NEW.scopes<>OLD.scopes BEGIN
 INSERT INTO developer_studio_events SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-8'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),g.tenant_id,g.workspace_id,g.environment,g.app_env,NULL,'application_policy',g.app_id,'policy_disabled',g.version+1,g.responsible_user_id,NEW.updated_at FROM developer_studio_grants g WHERE g.app_id=NEW.id AND g.enabled=1;
 UPDATE developer_studio_grants SET enabled=0,version=version+1,updated_at=NEW.updated_at WHERE app_id=NEW.id AND enabled=1;
END;
`+['developer_studio_events','developer_studio_operations','developer_studio_job_origins'].flatMap(table=>['UPDATE','DELETE'].map(event=>`CREATE TRIGGER ${table}_${event.toLowerCase()} BEFORE ${event} ON ${table} BEGIN SELECT RAISE(ABORT,'Developer studio provenance is immutable');END;\n`)).join('')+`
CREATE TRIGGER developer_studio_operation_scope BEFORE INSERT ON developer_studio_operations BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM developer_studio_grants g JOIN developer_apps a ON a.id=g.app_id JOIN developer_credentials k ON k.id=NEW.credential_id JOIN studio_projects p ON p.id=NEW.project_id WHERE g.app_id=NEW.app_id AND g.version=NEW.grant_version AND g.responsible_user_id=NEW.responsible_user_id AND g.tenant_id=NEW.tenant_id AND g.workspace_id=NEW.workspace_id AND g.environment=NEW.environment AND g.app_env=NEW.app_env AND g.enabled=1 AND g.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND a.enabled=1 AND k.app_id=a.id AND k.revoked_at IS NULL AND k.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND p.tenant_id=g.tenant_id AND p.workspace_id=g.workspace_id AND p.environment=g.environment AND p.app_env=g.app_env AND EXISTS(SELECT 1 FROM json_each(g.actions) WHERE value=CASE WHEN NEW.kind IN('project.created','project.saved') THEN 'projects.write' WHEN NEW.kind='export.created' THEN 'exports.submit' WHEN NEW.kind='export.cancelled' THEN 'exports.cancel' ELSE 'exports.download' END)) THEN RAISE(ABORT,'Developer studio operation scope changed') END;
END;
CREATE TRIGGER developer_studio_operation_resource BEFORE INSERT ON developer_studio_operations BEGIN
 SELECT CASE WHEN NEW.kind IN('project.created','project.saved') AND NOT EXISTS(SELECT 1 FROM studio_projects p WHERE p.id=NEW.project_id AND NEW.resource_id=p.id AND p.version=NEW.resource_version) THEN RAISE(ABORT,'Developer studio project receipt is invalid') END;
 SELECT CASE WHEN NEW.kind IN('export.created','export.cancelled') AND NOT EXISTS(SELECT 1 FROM studio_exports e WHERE e.id=NEW.resource_id AND e.project_id=NEW.project_id AND e.tenant_id=NEW.tenant_id AND e.workspace_id=NEW.workspace_id AND e.environment=NEW.environment AND e.app_env=NEW.app_env AND e.project_version=NEW.resource_version) THEN RAISE(ABORT,'Developer studio export receipt is invalid') END;
 SELECT CASE WHEN NEW.kind='file.download_started' AND NOT EXISTS(SELECT 1 FROM studio_export_artifacts a JOIN studio_exports e ON e.id=a.export_id WHERE a.id=NEW.resource_id AND e.project_id=NEW.project_id AND e.tenant_id=NEW.tenant_id AND e.workspace_id=NEW.workspace_id AND e.environment=NEW.environment AND e.app_env=NEW.app_env AND e.project_version=NEW.resource_version AND e.status='succeeded') THEN RAISE(ABORT,'Developer studio artifact receipt is invalid') END;
END;
CREATE TRIGGER developer_studio_origin_scope BEFORE INSERT ON developer_studio_job_origins BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM developer_studio_operations o JOIN studio_exports e ON e.id=NEW.export_id WHERE o.id=NEW.operation_id AND o.app_id=NEW.app_id AND o.tenant_id=NEW.tenant_id AND o.workspace_id=NEW.workspace_id AND o.environment=NEW.environment AND o.app_env=NEW.app_env AND o.grant_version=NEW.grant_version AND o.credential_id=NEW.credential_id AND o.responsible_user_id=NEW.responsible_user_id AND o.kind='export.created' AND o.resource_id=e.id AND o.project_id=e.project_id AND e.actor_id=NEW.responsible_user_id AND e.tenant_id=NEW.tenant_id AND e.workspace_id=NEW.workspace_id AND e.environment=NEW.environment AND e.app_env=NEW.app_env) THEN RAISE(ABORT,'Developer studio export origin is invalid') END;
END;
`;
const nativeSchema=schema.replaceAll('TEXT','text').replaceAll('INTEGER','bigint');
const native=nativeSchema+fs.readFileSync('scripts/operations-developer-studio-control.sql','utf8');
assert.equal(fs.existsSync('docs/evidence/T35/developer-studio/062-first-committed.json'),false);assert.equal(fs.existsSync('docs/evidence/T35/developer-studio/141-first-committed.json'),false);
fs.writeFileSync('migrations/sqlite/062-developer-studio.sql',sqlite,{flag:'wx'});fs.writeFileSync('migrations/postgres/141-native-developer-studio.sql',native,{flag:'wx'});
console.log(JSON.stringify({result:'DEVELOPER_STUDIO_SQL_GENERATED_NOT_COMMITTED',tables:4,plannedRuntime:138}));
