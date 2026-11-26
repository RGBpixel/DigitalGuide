-- R-119. Existing member permissions remain authoritative after OIDC login.
CREATE TABLE enterprise_identity_providers (
 provider_id text NOT NULL,tenant_id text NOT NULL REFERENCES tenants(id),environment text NOT NULL,app_env text NOT NULL,
 name text NOT NULL,issuer text NOT NULL,mode text NOT NULL CHECK(mode IN('oidc','synthetic_oidc')),config_hash text NOT NULL,
 enabled integer NOT NULL CHECK(enabled IN(0,1)),version bigint NOT NULL CHECK(version BETWEEN 1 AND 1000000000),updated_at text NOT NULL,
 PRIMARY KEY(tenant_id,environment,app_env,provider_id)
);
CREATE TABLE enterprise_member_controls (
 user_id text NOT NULL REFERENCES users(id),tenant_id text NOT NULL REFERENCES tenants(id),environment text NOT NULL,app_env text NOT NULL,
 status text NOT NULL CHECK(status IN('active','suspended')),version bigint NOT NULL CHECK(version BETWEEN 1 AND 1000000000),updated_at text NOT NULL,
 PRIMARY KEY(tenant_id,environment,app_env,user_id)
);
CREATE TABLE enterprise_identity_bindings (
 id text PRIMARY KEY,tenant_id text NOT NULL,environment text NOT NULL,app_env text NOT NULL,provider_id text NOT NULL,user_id text NOT NULL REFERENCES users(id),
 issuer_hash text NOT NULL,subject_hash text NOT NULL,enabled integer NOT NULL CHECK(enabled IN(0,1)),version bigint NOT NULL CHECK(version BETWEEN 1 AND 1000000000),created_at text NOT NULL,updated_at text NOT NULL,
 FOREIGN KEY(tenant_id,environment,app_env,provider_id) REFERENCES enterprise_identity_providers(tenant_id,environment,app_env,provider_id),
 UNIQUE(tenant_id,environment,app_env,provider_id,issuer_hash,subject_hash)
);
CREATE INDEX enterprise_identity_binding_member ON enterprise_identity_bindings(tenant_id,environment,app_env,user_id,id);
CREATE TABLE enterprise_login_flows (
 id text PRIMARY KEY,state_hash text NOT NULL UNIQUE,tenant_id text NOT NULL,environment text NOT NULL,app_env text NOT NULL,provider_id text NOT NULL,
 config_hash text NOT NULL,provider_version bigint NOT NULL,browser_hash text NOT NULL,secret_ciphertext text,expires_at text NOT NULL,consumed_at text,created_at text NOT NULL,
 CHECK((consumed_at IS NULL AND secret_ciphertext IS NOT NULL) OR(consumed_at IS NOT NULL AND secret_ciphertext IS NULL)),
 FOREIGN KEY(tenant_id,environment,app_env,provider_id) REFERENCES enterprise_identity_providers(tenant_id,environment,app_env,provider_id)
);
CREATE INDEX enterprise_login_flow_expiry ON enterprise_login_flows(environment,app_env,expires_at);
CREATE TABLE enterprise_identity_session_origins (
 token_hash text PRIMARY KEY REFERENCES auth_sessions(token_hash) ON DELETE CASCADE,tenant_id text NOT NULL,environment text NOT NULL,app_env text NOT NULL,user_id text NOT NULL REFERENCES users(id),
 provider_id text NOT NULL,provider_version bigint NOT NULL,binding_id text NOT NULL REFERENCES enterprise_identity_bindings(id),binding_version bigint NOT NULL,member_version bigint NOT NULL,config_hash text NOT NULL,created_at text NOT NULL
);
CREATE INDEX enterprise_identity_session_provider ON enterprise_identity_session_origins(tenant_id,environment,app_env,provider_id,binding_id);
CREATE TABLE enterprise_identity_events (
 id text PRIMARY KEY,tenant_id text NOT NULL,workspace_id text NOT NULL,environment text NOT NULL,app_env text NOT NULL,actor_id text NOT NULL,
 action text NOT NULL CHECK(action IN('provider.enable','provider.disable','binding.create','binding.enable','binding.disable','member.suspend','member.activate','login.success')),subject_id text NOT NULL,revision bigint NOT NULL,created_at text NOT NULL
);
CREATE INDEX enterprise_identity_event_scope ON enterprise_identity_events(tenant_id,workspace_id,environment,app_env,created_at,id);
CREATE FUNCTION dg_native_identity_event_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Enterprise identity events are append only';END;$dg$;
CREATE TRIGGER enterprise_identity_event_immutable BEFORE UPDATE OR DELETE ON enterprise_identity_events FOR EACH ROW EXECUTE FUNCTION dg_native_identity_event_immutable();
REVOKE ALL ON FUNCTION dg_native_identity_event_immutable() FROM PUBLIC;
CREATE FUNCTION dg_native_identity_lock_member(target text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control c WHERE c.id=1 AND c.status='validation_only' AND c.environment='mock' AND session_user=c.app_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Native identity role is not allowed';END IF;
 PERFORM m.user_id FROM memberships m WHERE m.user_id=target FOR UPDATE;
END;$dg$;
REVOKE ALL ON FUNCTION dg_native_identity_lock_member(text) FROM PUBLIC;
CREATE OR REPLACE FUNCTION dg_native_locked_membership(actor text)
RETURNS TABLE(user_id text,tenant_id text,role text,workspace_ids text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control c WHERE c.id=1 AND c.status='validation_only' AND c.environment='mock' AND session_user IN(c.app_role,c.worker_role)) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Native runtime role is not allowed';END IF;
 -- Read controls after any membership wait, using a new command snapshot.
 PERFORM m.user_id FROM memberships m WHERE m.user_id=actor FOR SHARE;
 RETURN QUERY SELECT m.user_id,m.tenant_id,m.role,m.workspace_ids FROM memberships m WHERE m.user_id=actor AND NOT EXISTS(
  SELECT 1 FROM enterprise_member_controls s JOIN _dg_native_runtime_control c ON c.id=1 WHERE s.user_id=m.user_id AND s.tenant_id=m.tenant_id AND s.environment=c.environment AND s.app_env=c.app_env AND s.status='suspended');
END;$dg$;
REVOKE ALL ON FUNCTION dg_native_locked_membership(text) FROM PUBLIC;
