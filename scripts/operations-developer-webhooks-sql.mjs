import fs from 'node:fs';
const uuid = "lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-8'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6)))";
const codes = "'HTTP_ACCEPTED','HTTP_REJECTED','HTTP_RETRYABLE','REDIRECT_BLOCKED','TRANSPORT_UNCERTAIN','CONFIG_REQUIRED','CONFIG_CHANGED','EXTERNAL_NOT_AUTHORIZED','SCOPE_WITHDRAWN','LEASE_EXPIRED','PAYLOAD_INVALID'";
function schema(pg) {
  const t = pg ? 'text' : 'TEXT', i = pg ? 'bigint' : 'INTEGER';
  const payload = pg ? "octet_length(payload)<=32768 AND jsonb_typeof(payload::jsonb)='object'" : "length(CAST(payload AS BLOB))<=32768 AND json_valid(payload)";
  return `CREATE TABLE developer_webhook_subscriptions(
 id ${t} PRIMARY KEY,app_id ${t} NOT NULL,tenant_id ${t} NOT NULL,workspace_id ${t} NOT NULL,environment ${t} NOT NULL,app_env ${t} NOT NULL,destination_id ${t} NOT NULL,fingerprint ${t} NOT NULL CHECK(length(fingerprint)=64),
 topics ${t} NOT NULL CHECK(topics IN('["projects.changed"]','["exports.changed"]','["exports.changed","projects.changed"]')),enabled ${i} NOT NULL CHECK(enabled IN(0,1)),version ${i} NOT NULL CHECK(version BETWEEN 1 AND 1000000000),created_by ${t} NOT NULL REFERENCES users(id),created_at ${t} NOT NULL,updated_at ${t} NOT NULL,
 UNIQUE(app_id,destination_id),UNIQUE(id,tenant_id,workspace_id,environment,app_env),FOREIGN KEY(app_id,tenant_id,workspace_id,environment,app_env) REFERENCES developer_apps(id,tenant_id,workspace_id,environment,app_env)
);
CREATE TABLE developer_webhook_sources(topic ${t} NOT NULL CHECK(topic IN('projects.changed','exports.changed','webhook.test')),source_id ${t} NOT NULL,tenant_id ${t} NOT NULL,workspace_id ${t} NOT NULL REFERENCES workspaces(id),environment ${t} NOT NULL,app_env ${t} NOT NULL,sequence ${i} NOT NULL CHECK(sequence BETWEEN 1 AND 1000000000),last_event_id ${t} NOT NULL,PRIMARY KEY(topic,source_id));
CREATE TABLE developer_webhook_events(
 id ${t} PRIMARY KEY,tenant_id ${t} NOT NULL,workspace_id ${t} NOT NULL,environment ${t} NOT NULL,app_env ${t} NOT NULL,topic ${t} NOT NULL,source_id ${t} NOT NULL,sequence ${i} NOT NULL CHECK(sequence BETWEEN 1 AND 1000000000),payload ${t} NOT NULL CHECK(${payload}),created_at ${t} NOT NULL,version ${i} NOT NULL CHECK(version=1),
 UNIQUE(id,tenant_id,workspace_id,environment,app_env),UNIQUE(topic,source_id,sequence),FOREIGN KEY(topic,source_id) REFERENCES developer_webhook_sources(topic,source_id)
);
CREATE TABLE developer_webhook_deliveries(
 id ${t} PRIMARY KEY,subscription_id ${t} NOT NULL,event_id ${t} NOT NULL,tenant_id ${t} NOT NULL,workspace_id ${t} NOT NULL,environment ${t} NOT NULL,app_env ${t} NOT NULL,generation ${i} NOT NULL CHECK(generation BETWEEN 1 AND 1000000000),fingerprint ${t} NOT NULL CHECK(length(fingerprint)=64),
 status ${t} NOT NULL CHECK(status IN('queued','sending','retrying','delivered','failed','unknown','blocked','cancelled')),attempts ${i} NOT NULL DEFAULT 0,max_attempts ${i} NOT NULL DEFAULT 5,available_at ${t} NOT NULL,lease_token ${t},lease_until ${t},last_code ${t} CHECK(last_code IN(${codes})),http_status ${i} CHECK(http_status BETWEEN 100 AND 599),created_at ${t} NOT NULL,updated_at ${t} NOT NULL,
 CHECK(attempts BETWEEN 0 AND max_attempts AND max_attempts BETWEEN 1 AND 20),CHECK((status='sending' AND lease_token IS NOT NULL AND lease_until IS NOT NULL) OR(status<>'sending' AND lease_token IS NULL AND lease_until IS NULL)),
 UNIQUE(subscription_id,event_id),FOREIGN KEY(subscription_id,tenant_id,workspace_id,environment,app_env) REFERENCES developer_webhook_subscriptions(id,tenant_id,workspace_id,environment,app_env),FOREIGN KEY(event_id,tenant_id,workspace_id,environment,app_env) REFERENCES developer_webhook_events(id,tenant_id,workspace_id,environment,app_env)
);
CREATE INDEX developer_webhook_queue ON developer_webhook_deliveries(environment,app_env,status,available_at,created_at,id);
CREATE TABLE developer_webhook_attempts(
 delivery_id ${t} NOT NULL REFERENCES developer_webhook_deliveries(id),attempt ${i} NOT NULL CHECK(attempt BETWEEN 1 AND 20),lease_token ${t} NOT NULL UNIQUE,lease_until ${t} NOT NULL,body_sha256 ${t} CHECK(length(body_sha256)=64),outcome ${t} NOT NULL CHECK(outcome IN('sending','accepted','retryable','rejected','unknown','blocked')),error_code ${t} CHECK(error_code IN(${codes})),http_status ${i} CHECK(http_status BETWEEN 100 AND 599),started_at ${t} NOT NULL,finished_at ${t},scope_withdrawn ${i} NOT NULL DEFAULT 0 CHECK(scope_withdrawn IN(0,1)),PRIMARY KEY(delivery_id,attempt),CHECK((outcome='sending' AND finished_at IS NULL) OR(outcome<>'sending' AND finished_at IS NOT NULL))
);
CREATE TABLE developer_webhook_changes(
 id ${t} PRIMARY KEY,tenant_id ${t} NOT NULL,workspace_id ${t} NOT NULL,environment ${t} NOT NULL,app_env ${t} NOT NULL,actor_id ${t} REFERENCES users(id),origin ${t} NOT NULL CHECK(origin IN('administrator','application_policy')),subscription_id ${t} NOT NULL,action ${t} NOT NULL CHECK(action IN('created','configured','test_queued','retry_queued','policy_disabled')),revision ${i} NOT NULL CHECK(revision BETWEEN 1 AND 1000000000),delivery_id ${t} REFERENCES developer_webhook_deliveries(id),created_at ${t} NOT NULL,
 CHECK((origin='administrator' AND actor_id IS NOT NULL) OR(origin='application_policy' AND actor_id IS NULL)),FOREIGN KEY(subscription_id,tenant_id,workspace_id,environment,app_env) REFERENCES developer_webhook_subscriptions(id,tenant_id,workspace_id,environment,app_env)
);
`;
}
const identityFields = ['id', 'app_id', 'tenant_id', 'workspace_id', 'environment', 'app_env', 'destination_id', 'created_by', 'created_at'];
function sqliteControl() {
  let sql = `CREATE TRIGGER developer_webhook_subscription_identity BEFORE UPDATE ON developer_webhook_subscriptions WHEN ${identityFields.map(f => 'NEW.' + f + '<>OLD.' + f).join(' OR ')} OR NEW.version<>OLD.version+1 BEGIN SELECT RAISE(ABORT,'Webhook subscription identity is immutable');END;
CREATE TRIGGER developer_webhook_subscription_delete BEFORE DELETE ON developer_webhook_subscriptions BEGIN SELECT RAISE(ABORT,'Webhook subscriptions retain audit identity');END;
CREATE TRIGGER developer_webhook_subscription_cancel AFTER UPDATE ON developer_webhook_subscriptions BEGIN
 UPDATE developer_webhook_attempts SET scope_withdrawn=1 WHERE outcome='sending' AND scope_withdrawn=0 AND delivery_id IN(SELECT id FROM developer_webhook_deliveries WHERE subscription_id=NEW.id AND generation<>NEW.version);
 UPDATE developer_webhook_deliveries SET status='cancelled',lease_token=NULL,lease_until=NULL,last_code='SCOPE_WITHDRAWN',updated_at=NEW.updated_at WHERE subscription_id=NEW.id AND generation<>NEW.version AND status NOT IN('delivered','cancelled');
END;
CREATE TRIGGER developer_webhook_application_policy AFTER UPDATE ON developer_apps WHEN NEW.enabled=0 OR NEW.scopes<>OLD.scopes BEGIN
 INSERT INTO developer_webhook_changes SELECT ${uuid},s.tenant_id,s.workspace_id,s.environment,s.app_env,NULL,'application_policy',s.id,'policy_disabled',s.version+1,NULL,NEW.updated_at FROM developer_webhook_subscriptions s WHERE s.app_id=NEW.id AND s.enabled=1;
 UPDATE developer_webhook_subscriptions SET enabled=0,version=version+1,updated_at=NEW.updated_at WHERE app_id=NEW.id AND enabled=1;
END;
`;
  for (const table of ['developer_webhook_events', 'developer_webhook_changes']) for (const op of ['UPDATE', 'DELETE']) sql += `CREATE TRIGGER ${table}_${op.toLowerCase()} BEFORE ${op} ON ${table} BEGIN SELECT RAISE(ABORT,'Webhook events and changes are immutable');END;\n`;
  sql += `CREATE TRIGGER developer_webhook_attempt_identity BEFORE UPDATE ON developer_webhook_attempts WHEN OLD.outcome<>'sending' OR NEW.delivery_id<>OLD.delivery_id OR NEW.attempt<>OLD.attempt OR NEW.lease_token<>OLD.lease_token OR NEW.lease_until<>OLD.lease_until OR NEW.started_at<>OLD.started_at OR NEW.scope_withdrawn<OLD.scope_withdrawn OR(OLD.body_sha256 IS NOT NULL AND NEW.body_sha256 IS NOT OLD.body_sha256) BEGIN SELECT RAISE(ABORT,'Webhook attempt receipt is immutable');END;
CREATE TRIGGER developer_webhook_attempt_delete BEFORE DELETE ON developer_webhook_attempts BEGIN SELECT RAISE(ABORT,'Webhook attempts retain receipts');END;
CREATE TRIGGER developer_webhook_delivery_identity BEFORE UPDATE ON developer_webhook_deliveries WHEN ${['id', 'subscription_id', 'event_id', 'tenant_id', 'workspace_id', 'environment', 'app_env', 'generation', 'fingerprint', 'created_at'].map(f => 'NEW.' + f + '<>OLD.' + f).join(' OR ')} OR NEW.attempts<OLD.attempts OR(OLD.status IN('delivered','cancelled') AND NEW.status<>OLD.status) BEGIN SELECT RAISE(ABORT,'Webhook delivery identity is immutable');END;
CREATE TRIGGER developer_webhook_delivery_delete BEFORE DELETE ON developer_webhook_deliveries BEGIN SELECT RAISE(ABORT,'Webhook deliveries retain receipts');END;\n`;
  return sql;
}
const projectData = ["'id',NEW.id", "'name',NEW.name", "'purpose',NEW.purpose", "'version',NEW.version", "'archived',json(CASE WHEN NEW.archived=1 THEN 'true' ELSE 'false' END)", "'createdAt',NEW.created_at", "'updatedAt',NEW.updated_at"].join(',');
const exportData = ["'id',NEW.id", "'projectId',NEW.project_id", "'projectVersion',NEW.project_version", "'kind',NEW.kind", "'status',NEW.status", "'progress',NEW.progress", "'createdAt',NEW.created_at", "'updatedAt',NEW.updated_at"].join(',');
function sqlitePublisher(table, topic, data, when) {
  const required = topic === 'projects.changed' ? 'projects.read' : 'exports.read';
  const eligible = `SELECT s.id FROM developer_webhook_subscriptions s JOIN developer_apps a ON a.id=s.app_id WHERE s.tenant_id=NEW.tenant_id AND s.workspace_id=NEW.workspace_id AND s.environment=NEW.environment AND s.app_env=NEW.app_env AND s.enabled=1 AND a.enabled=1 AND EXISTS(SELECT 1 FROM json_each(s.topics) WHERE value='${topic}') AND EXISTS(SELECT 1 FROM json_each(a.scopes) WHERE value='${required}')${table === 'studio_exports' ? ' AND EXISTS(SELECT 1 FROM studio_projects p WHERE p.id=NEW.project_id AND p.tenant_id=NEW.tenant_id AND p.workspace_id=NEW.workspace_id AND p.environment=NEW.environment AND p.app_env=NEW.app_env)' : ''}`;
  const source = `r.topic='${topic}' AND r.source_id=NEW.id AND r.tenant_id=NEW.tenant_id AND r.workspace_id=NEW.workspace_id AND r.environment=NEW.environment AND r.app_env=NEW.app_env`;
  const at = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
  const body = `json_object('version',1,'id',r.last_event_id,'type','${topic}','occurredAt',${at},'sequence',r.sequence,'tenantId',r.tenant_id,'workspaceId',r.workspace_id,'environment',r.environment,'appEnv',r.app_env,'data',json_object(${data}))`;
  return ['INSERT', 'UPDATE'].map(op => `CREATE TRIGGER developer_webhook_${table}_${op.toLowerCase()} AFTER ${op} ON ${table}${op === 'UPDATE' ? ' WHEN ' + when : ''} BEGIN
 INSERT INTO developer_webhook_sources SELECT '${topic}',NEW.id,NEW.tenant_id,NEW.workspace_id,NEW.environment,NEW.app_env,1,${uuid} WHERE EXISTS(${eligible}) ON CONFLICT(topic,source_id) DO UPDATE SET sequence=developer_webhook_sources.sequence+1,last_event_id=excluded.last_event_id;
 INSERT INTO developer_webhook_events SELECT r.last_event_id,r.tenant_id,r.workspace_id,r.environment,r.app_env,r.topic,r.source_id,r.sequence,${body},${at},1 FROM developer_webhook_sources r WHERE ${source} AND EXISTS(${eligible});
 INSERT INTO developer_webhook_deliveries(id,subscription_id,event_id,tenant_id,workspace_id,environment,app_env,generation,fingerprint,status,attempts,max_attempts,available_at,created_at,updated_at) SELECT ${uuid},s.id,r.last_event_id,s.tenant_id,s.workspace_id,s.environment,s.app_env,s.version,s.fingerprint,'queued',0,5,${at},${at},${at} FROM developer_webhook_subscriptions s JOIN developer_webhook_sources r ON ${source} WHERE s.id IN(${eligible});
END;\n`).join('');
}
const postgresControl = fs.readFileSync('scripts/operations-developer-webhooks-control.sql', 'utf8');
const postgresQueue = fs.readFileSync('scripts/operations-developer-webhooks-queue.sql', 'utf8');
fs.writeFileSync('migrations/sqlite/061-developer-webhooks.sql', schema(false) + sqliteControl() + sqlitePublisher('studio_projects', 'projects.changed', projectData, 'NEW.version<>OLD.version OR NEW.name<>OLD.name OR NEW.archived<>OLD.archived') + sqlitePublisher('studio_exports', 'exports.changed', exportData, 'NEW.status<>OLD.status'), { flag: 'wx' });
fs.writeFileSync('migrations/postgres/140-native-developer-webhooks.sql', schema(true) + postgresControl + postgresQueue, { flag: 'wx' });
console.log(JSON.stringify({ result: 'WEBHOOK_MIGRATIONS_GENERATED_NOT_TESTED', sqlite: '061', native: '140' }));
