-- R-117. Sandbox capacity policy; no purchased subscription or identity grants.
CREATE TABLE enterprise_plan_assignments (
 tenant_id TEXT NOT NULL REFERENCES tenants(id),environment TEXT NOT NULL CHECK(environment='mock'),
 app_env TEXT NOT NULL CHECK(app_env IN('development','sandbox')),plan_id TEXT NOT NULL CHECK(plan_id IN('sandbox_basic','sandbox_team','sandbox_enterprise')),
 revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 1000000000),expires_at TEXT NOT NULL,updated_at TEXT NOT NULL,updated_by TEXT NOT NULL,
 PRIMARY KEY(tenant_id,environment,app_env)
) STRICT;
CREATE TABLE enterprise_seats (
 tenant_id TEXT NOT NULL REFERENCES tenants(id),environment TEXT NOT NULL CHECK(environment='mock'),app_env TEXT NOT NULL CHECK(app_env IN('development','sandbox')),
 user_id TEXT NOT NULL,workspace_id TEXT NOT NULL,created_at TEXT NOT NULL,revoked_at TEXT,
 PRIMARY KEY(tenant_id,environment,app_env,user_id)
) STRICT;
CREATE TABLE enterprise_plan_events (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),workspace_id TEXT NOT NULL,environment TEXT NOT NULL CHECK(environment='mock'),
 app_env TEXT NOT NULL CHECK(app_env IN('development','sandbox')),actor_id TEXT NOT NULL,subject_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN('plan.assign','seat.assign','seat.release')),revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 1000000000),created_at TEXT NOT NULL
) STRICT;
CREATE INDEX enterprise_plan_event_scope ON enterprise_plan_events(tenant_id,environment,app_env,workspace_id,created_at,id);
