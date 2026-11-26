-- R-119. External identities bind explicitly to existing local members.
CREATE TABLE enterprise_identity_providers (
 provider_id TEXT NOT NULL,tenant_id TEXT NOT NULL REFERENCES tenants(id),environment TEXT NOT NULL,app_env TEXT NOT NULL,
 name TEXT NOT NULL,issuer TEXT NOT NULL,mode TEXT NOT NULL CHECK(mode IN('oidc','synthetic_oidc')),config_hash TEXT NOT NULL,
 enabled INTEGER NOT NULL CHECK(enabled IN(0,1)),version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 1000000000),updated_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,environment,app_env,provider_id)
);
CREATE TABLE enterprise_member_controls (
 user_id TEXT NOT NULL REFERENCES users(id),tenant_id TEXT NOT NULL REFERENCES tenants(id),environment TEXT NOT NULL,app_env TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('active','suspended')),version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 1000000000),updated_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,environment,app_env,user_id)
);
CREATE TABLE enterprise_identity_bindings (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,environment TEXT NOT NULL,app_env TEXT NOT NULL,provider_id TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),
 issuer_hash TEXT NOT NULL,subject_hash TEXT NOT NULL,enabled INTEGER NOT NULL CHECK(enabled IN(0,1)),version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 1000000000),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 FOREIGN KEY(tenant_id,environment,app_env,provider_id) REFERENCES enterprise_identity_providers(tenant_id,environment,app_env,provider_id),
 UNIQUE(tenant_id,environment,app_env,provider_id,issuer_hash,subject_hash)
);
CREATE INDEX enterprise_identity_binding_member ON enterprise_identity_bindings(tenant_id,environment,app_env,user_id,id);
CREATE TABLE enterprise_login_flows (
 id TEXT PRIMARY KEY,state_hash TEXT NOT NULL UNIQUE,tenant_id TEXT NOT NULL,environment TEXT NOT NULL,app_env TEXT NOT NULL,provider_id TEXT NOT NULL,
 config_hash TEXT NOT NULL,provider_version INTEGER NOT NULL,browser_hash TEXT NOT NULL,secret_ciphertext TEXT,expires_at TEXT NOT NULL,consumed_at TEXT,created_at TEXT NOT NULL,
 CHECK((consumed_at IS NULL AND secret_ciphertext IS NOT NULL) OR(consumed_at IS NOT NULL AND secret_ciphertext IS NULL)),
 FOREIGN KEY(tenant_id,environment,app_env,provider_id) REFERENCES enterprise_identity_providers(tenant_id,environment,app_env,provider_id)
);
CREATE INDEX enterprise_login_flow_expiry ON enterprise_login_flows(environment,app_env,expires_at);
CREATE TABLE enterprise_identity_session_origins (
 token_hash TEXT PRIMARY KEY REFERENCES auth_sessions(token_hash) ON DELETE CASCADE,tenant_id TEXT NOT NULL,environment TEXT NOT NULL,app_env TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),
 provider_id TEXT NOT NULL,provider_version INTEGER NOT NULL,binding_id TEXT NOT NULL REFERENCES enterprise_identity_bindings(id),binding_version INTEGER NOT NULL,member_version INTEGER NOT NULL,config_hash TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE INDEX enterprise_identity_session_provider ON enterprise_identity_session_origins(tenant_id,environment,app_env,provider_id,binding_id);
CREATE TABLE enterprise_identity_events (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,environment TEXT NOT NULL,app_env TEXT NOT NULL,actor_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN('provider.enable','provider.disable','binding.create','binding.enable','binding.disable','member.suspend','member.activate','login.success')),subject_id TEXT NOT NULL,revision INTEGER NOT NULL,created_at TEXT NOT NULL
);
CREATE INDEX enterprise_identity_event_scope ON enterprise_identity_events(tenant_id,workspace_id,environment,app_env,created_at,id);
CREATE TRIGGER enterprise_identity_event_no_update BEFORE UPDATE ON enterprise_identity_events BEGIN SELECT RAISE(ABORT,'Enterprise identity events are append only');END;
CREATE TRIGGER enterprise_identity_event_no_delete BEFORE DELETE ON enterprise_identity_events BEGIN SELECT RAISE(ABORT,'Enterprise identity events are append only');END;
