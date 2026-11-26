CREATE TABLE enterprise_member_directory (
 user_id text NOT NULL REFERENCES users(id),tenant_id text NOT NULL REFERENCES tenants(id),environment text NOT NULL CHECK(environment IN('mock','sandbox','live')),app_env text NOT NULL CHECK(app_env IN('development','sandbox','production')),
 role text NOT NULL CHECK(role IN('admin','editor','reviewer','viewer')),workspace_ids text NOT NULL CHECK(jsonb_typeof(workspace_ids::jsonb)='array'),
 version bigint NOT NULL CHECK(version BETWEEN 1 AND 1000000000),origin text NOT NULL CHECK(origin IN('existing','provisioned')),created_at text NOT NULL,updated_at text NOT NULL,
 PRIMARY KEY(tenant_id,environment,app_env,user_id)
);
CREATE INDEX enterprise_member_directory_user ON enterprise_member_directory(user_id,origin);
CREATE TABLE enterprise_member_events (
 id text PRIMARY KEY,tenant_id text NOT NULL,workspace_id text NOT NULL,environment text NOT NULL,app_env text NOT NULL,actor_id text NOT NULL,user_id text NOT NULL,
 action text NOT NULL CHECK(action IN('member.create','member.access')),revision bigint NOT NULL,created_at text NOT NULL
);
CREATE INDEX enterprise_member_events_scope ON enterprise_member_events(tenant_id,environment,app_env,created_at,id);
CREATE TRIGGER enterprise_member_events_immutable BEFORE UPDATE OR DELETE ON enterprise_member_events FOR EACH ROW EXECUTE FUNCTION dg_native_identity_event_immutable();
CREATE OR REPLACE FUNCTION dg_native_locked_membership(actor text)
RETURNS TABLE(user_id text,tenant_id text,role text,workspace_ids text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control c WHERE c.id=1 AND c.status='validation_only' AND c.environment='mock' AND session_user IN(c.app_role,c.worker_role)) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Native runtime role is not allowed';END IF;
 PERFORM b.user_id FROM memberships b WHERE b.user_id=actor FOR SHARE;
 RETURN QUERY SELECT b.user_id,b.tenant_id,coalesce(d.role,b.role),coalesce(d.workspace_ids,b.workspace_ids)
 FROM memberships b CROSS JOIN _dg_native_runtime_control c
 LEFT JOIN enterprise_member_directory d ON d.user_id=b.user_id AND d.tenant_id=b.tenant_id AND d.environment=c.environment AND d.app_env=c.app_env
 WHERE c.id=1 AND b.user_id=actor
 AND(d.user_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM enterprise_member_directory origin WHERE origin.user_id=b.user_id AND origin.origin='provisioned'))
 AND NOT EXISTS(SELECT 1 FROM enterprise_member_controls s WHERE s.user_id=b.user_id AND s.tenant_id=b.tenant_id AND s.environment=c.environment AND s.app_env=c.app_env AND s.status='suspended');
END;$dg$;
REVOKE ALL ON FUNCTION dg_native_locked_membership(text) FROM PUBLIC;
CREATE FUNCTION dg_native_identity_create_user(actor text,target text,tenant text,display_name text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE member record;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control c WHERE c.id=1 AND c.status='validation_only' AND c.environment='mock' AND session_user=c.app_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Native member provisioning role is not allowed';END IF;
 SELECT * INTO member FROM dg_native_locked_membership(actor);
 IF member.user_id IS NULL OR member.tenant_id<>tenant OR member.role<>'admin' OR EXISTS(SELECT 1 FROM workspaces w WHERE w.tenant_id=tenant AND NOT jsonb_exists(member.workspace_ids::jsonb,w.id)) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Organization administrator is required';END IF;
 IF char_length(display_name)<1 OR char_length(display_name)>80 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid member name';END IF;
 INSERT INTO users VALUES(target,display_name);
 INSERT INTO memberships VALUES(target,tenant,'viewer','[]');
END;$dg$;
REVOKE ALL ON FUNCTION dg_native_identity_create_user(text,text,text,text) FROM PUBLIC;
