CREATE TABLE enterprise_directory_access_bases(
 tenant_id TEXT NOT NULL,environment TEXT NOT NULL,app_env TEXT NOT NULL,connector_id TEXT NOT NULL,user_id TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN('editor','reviewer','viewer')),workspace_ids TEXT NOT NULL CHECK(json_valid(workspace_ids) AND json_type(workspace_ids)='array'),policy_hash TEXT NOT NULL CHECK(length(policy_hash)=64),
 version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 1000000000),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,environment,app_env,connector_id,user_id),
 FOREIGN KEY(tenant_id,environment,app_env,connector_id,user_id) REFERENCES enterprise_directory_users(tenant_id,environment,app_env,connector_id,id)
);
CREATE TABLE enterprise_directory_group_access(
 tenant_id TEXT NOT NULL,environment TEXT NOT NULL,app_env TEXT NOT NULL,connector_id TEXT NOT NULL,group_id TEXT NOT NULL,
 workspace_ids TEXT NOT NULL CHECK(json_valid(workspace_ids) AND json_type(workspace_ids)='array'),enabled INTEGER NOT NULL CHECK(enabled IN(0,1)),version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 1000000000),
 actor_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,environment,app_env,connector_id,group_id),
 FOREIGN KEY(tenant_id,environment,app_env,connector_id,group_id) REFERENCES enterprise_directory_groups(tenant_id,environment,app_env,connector_id,id)
);
CREATE INDEX enterprise_directory_group_user_scope ON enterprise_directory_group_members(tenant_id,environment,app_env,connector_id,user_id,group_id);
ALTER TABLE enterprise_directory_events ADD COLUMN details_json TEXT CHECK(details_json IS NULL OR (json_valid(details_json) AND json_type(details_json)='object'));
CREATE UNIQUE INDEX enterprise_directory_group_access_revision ON enterprise_directory_events(tenant_id,environment,app_env,connector_id,resource_id,revision) WHERE action IN('group.access.enable','group.access.update','group.access.disable','group.access.retire');
