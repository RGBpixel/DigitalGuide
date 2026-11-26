CREATE TABLE enterprise_directory_access_bases(
 tenant_id text NOT NULL,environment text NOT NULL,app_env text NOT NULL,connector_id text NOT NULL,user_id text NOT NULL,
 role text NOT NULL CHECK(role IN('editor','reviewer','viewer')),workspace_ids text NOT NULL CHECK(jsonb_typeof(workspace_ids::jsonb)='array'),policy_hash text NOT NULL CHECK(length(policy_hash)=64),
 version bigint NOT NULL CHECK(version BETWEEN 1 AND 1000000000),created_at text NOT NULL,updated_at text NOT NULL,
 PRIMARY KEY(tenant_id,environment,app_env,connector_id,user_id),
 FOREIGN KEY(tenant_id,environment,app_env,connector_id,user_id) REFERENCES enterprise_directory_users(tenant_id,environment,app_env,connector_id,id)
);
CREATE TABLE enterprise_directory_group_access(
 tenant_id text NOT NULL,environment text NOT NULL,app_env text NOT NULL,connector_id text NOT NULL,group_id text NOT NULL,
 workspace_ids text NOT NULL CHECK(jsonb_typeof(workspace_ids::jsonb)='array'),enabled integer NOT NULL CHECK(enabled IN(0,1)),version bigint NOT NULL CHECK(version BETWEEN 1 AND 1000000000),
 actor_id text NOT NULL REFERENCES users(id),created_at text NOT NULL,updated_at text NOT NULL,
 PRIMARY KEY(tenant_id,environment,app_env,connector_id,group_id),
 FOREIGN KEY(tenant_id,environment,app_env,connector_id,group_id) REFERENCES enterprise_directory_groups(tenant_id,environment,app_env,connector_id,id)
);
CREATE INDEX enterprise_directory_group_user_scope ON enterprise_directory_group_members(tenant_id,environment,app_env,connector_id,user_id,group_id);
ALTER TABLE enterprise_directory_events ADD COLUMN details_json text CHECK(details_json IS NULL OR jsonb_typeof(details_json::jsonb)='object');
CREATE UNIQUE INDEX enterprise_directory_group_access_revision ON enterprise_directory_events(tenant_id,environment,app_env,connector_id,resource_id,revision) WHERE action IN('group.access.enable','group.access.update','group.access.disable','group.access.retire');
