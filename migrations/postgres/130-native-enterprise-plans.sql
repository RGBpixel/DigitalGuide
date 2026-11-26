-- R-117. Sandbox capacity policy; no purchased subscription or identity grants.
CREATE TABLE enterprise_plan_assignments (
 tenant_id text NOT NULL REFERENCES tenants(id),environment text NOT NULL CHECK(environment='mock'),
 app_env text NOT NULL CHECK(app_env IN('development','sandbox')),plan_id text NOT NULL CHECK(plan_id IN('sandbox_basic','sandbox_team','sandbox_enterprise')),
 revision bigint NOT NULL CHECK(revision BETWEEN 1 AND 1000000000),expires_at text NOT NULL,updated_at text NOT NULL,updated_by text NOT NULL,
 PRIMARY KEY(tenant_id,environment,app_env)
);
CREATE TABLE enterprise_seats (
 tenant_id text NOT NULL REFERENCES tenants(id),environment text NOT NULL CHECK(environment='mock'),app_env text NOT NULL CHECK(app_env IN('development','sandbox')),
 user_id text NOT NULL,workspace_id text NOT NULL,created_at text NOT NULL,revoked_at text,
 PRIMARY KEY(tenant_id,environment,app_env,user_id)
);
CREATE TABLE enterprise_plan_events (
 id text PRIMARY KEY,tenant_id text NOT NULL REFERENCES tenants(id),workspace_id text NOT NULL,environment text NOT NULL CHECK(environment='mock'),
 app_env text NOT NULL CHECK(app_env IN('development','sandbox')),actor_id text NOT NULL,subject_id text NOT NULL,
 action text NOT NULL CHECK(action IN('plan.assign','seat.assign','seat.release')),revision bigint NOT NULL CHECK(revision BETWEEN 1 AND 1000000000),created_at text NOT NULL
);
CREATE INDEX enterprise_plan_event_scope ON enterprise_plan_events(tenant_id,environment,app_env,workspace_id,created_at,id);
