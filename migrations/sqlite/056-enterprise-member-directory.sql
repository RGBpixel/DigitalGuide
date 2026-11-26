-- R-119. The legacy membership is never overwritten by a scoped administration action.
CREATE TABLE enterprise_member_directory (
 user_id TEXT NOT NULL REFERENCES users(id),tenant_id TEXT NOT NULL REFERENCES tenants(id),environment TEXT NOT NULL CHECK(environment IN('mock','sandbox','live')),app_env TEXT NOT NULL CHECK(app_env IN('development','sandbox','production')),
 role TEXT NOT NULL CHECK(role IN('admin','editor','reviewer','viewer')),workspace_ids TEXT NOT NULL CHECK(json_valid(workspace_ids) AND json_type(workspace_ids)='array'),
 version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 1000000000),origin TEXT NOT NULL CHECK(origin IN('existing','provisioned')),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,environment,app_env,user_id)
);
CREATE INDEX enterprise_member_directory_user ON enterprise_member_directory(user_id,origin);
CREATE TABLE enterprise_member_events (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,environment TEXT NOT NULL,app_env TEXT NOT NULL,actor_id TEXT NOT NULL,user_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN('member.create','member.access')),revision INTEGER NOT NULL,created_at TEXT NOT NULL
);
CREATE INDEX enterprise_member_events_scope ON enterprise_member_events(tenant_id,environment,app_env,created_at,id);
CREATE TRIGGER enterprise_member_events_immutable_update BEFORE UPDATE ON enterprise_member_events BEGIN SELECT RAISE(ABORT,'Member events are append only');END;
CREATE TRIGGER enterprise_member_events_immutable_delete BEFORE DELETE ON enterprise_member_events BEGIN SELECT RAISE(ABORT,'Member events are append only');END;
