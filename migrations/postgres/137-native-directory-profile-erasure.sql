CREATE TABLE enterprise_directory_profile_erasures(
 id text PRIMARY KEY,tenant_id text NOT NULL,environment text NOT NULL,app_env text NOT NULL,connector_id text NOT NULL,user_id text NOT NULL,
 actor_id text NOT NULL REFERENCES users(id),origin text NOT NULL CHECK(origin IN('scim_delete','administrator')),
 source_version bigint NOT NULL CHECK(source_version BETWEEN 1 AND 1000000000),global_name_cleared integer NOT NULL CHECK(global_name_cleared IN(0,1)),bindings_disabled integer NOT NULL CHECK(bindings_disabled BETWEEN 0 AND 1000),created_at text NOT NULL,
 UNIQUE(tenant_id,environment,app_env,connector_id,user_id),FOREIGN KEY(tenant_id,environment,app_env,connector_id,user_id) REFERENCES enterprise_directory_users(tenant_id,environment,app_env,connector_id,id)
);
CREATE TRIGGER enterprise_directory_profile_erasures_immutable BEFORE UPDATE OR DELETE ON enterprise_directory_profile_erasures FOR EACH ROW EXECUTE FUNCTION dg_native_identity_event_immutable();
CREATE TRIGGER enterprise_directory_profile_erasures_no_truncate BEFORE TRUNCATE ON enterprise_directory_profile_erasures FOR EACH STATEMENT EXECUTE FUNCTION dg_native_identity_event_immutable();
CREATE FUNCTION dg_native_directory_profile_no_revival() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
 IF EXISTS(SELECT 1 FROM enterprise_directory_profile_erasures e WHERE e.user_id=OLD.id) AND(NEW.user_name IS DISTINCT FROM OLD.user_name OR NEW.name_key IS DISTINCT FROM OLD.name_key OR NEW.external_id IS DISTINCT FROM OLD.external_id OR NEW.display_name IS DISTINCT FROM OLD.display_name OR NEW.display_key IS DISTINCT FROM OLD.display_key OR NEW.profile_json IS DISTINCT FROM OLD.profile_json OR NEW.deleted<>1 OR NEW.active<>0 OR NEW.review_required<>1) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Erased directory profile cannot be restored';END IF;RETURN NEW;
END;$dg$;
REVOKE ALL ON FUNCTION dg_native_directory_profile_no_revival() FROM PUBLIC;
CREATE TRIGGER enterprise_directory_profile_no_revival BEFORE UPDATE ON enterprise_directory_users FOR EACH ROW EXECUTE FUNCTION dg_native_directory_profile_no_revival();
CREATE FUNCTION dg_native_directory_clear_exclusive_name(actor text,target text,tenant text,connector text,source_revision bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE member record;c record;d record;
BEGIN
 SELECT * INTO c FROM _dg_native_runtime_control WHERE id=1;
 IF c.id IS NULL OR c.status<>'validation_only' OR c.environment<>'mock' OR session_user<>c.app_role OR actor=target THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Directory erasure role is not allowed';END IF;
 SELECT * INTO member FROM dg_native_locked_membership(actor);
 IF member.user_id IS NULL OR member.tenant_id<>tenant OR member.role<>'admin' OR EXISTS(SELECT 1 FROM workspaces w WHERE w.tenant_id=tenant AND NOT jsonb_exists(member.workspace_ids::jsonb,w.id)) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Organization administrator is required';END IF;
 PERFORM dg_native_identity_lock_member(target);
 SELECT * INTO d FROM enterprise_directory_users u WHERE u.id=target AND u.tenant_id=tenant AND u.environment=c.environment AND u.app_env=c.app_env AND u.connector_id=connector FOR UPDATE;
 IF d.id IS NULL OR d.deleted<>1 OR d.active<>0 OR d.version<>source_revision OR NOT EXISTS(SELECT 1 FROM enterprise_member_controls s WHERE s.user_id=target AND s.tenant_id=tenant AND s.environment=c.environment AND s.app_env=c.app_env AND s.status='suspended') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Deleted suspended directory member is required';END IF;
 IF (SELECT count(*) FROM memberships m WHERE m.user_id=target)<>1 OR NOT EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=target AND m.tenant_id=tenant AND m.role='viewer' AND jsonb_array_length(m.workspace_ids::jsonb)=0) OR NOT EXISTS(SELECT 1 FROM enterprise_member_directory m WHERE m.user_id=target AND m.tenant_id=tenant AND m.environment=c.environment AND m.app_env=c.app_env AND m.origin='provisioned') OR EXISTS(SELECT 1 FROM enterprise_member_directory m WHERE m.user_id=target AND(m.tenant_id<>tenant OR m.environment<>c.environment OR m.app_env<>c.app_env)) OR EXISTS(SELECT 1 FROM enterprise_directory_connectors s WHERE s.owner_id=target) THEN RETURN false;END IF;
 UPDATE users SET name='已清理目录成员' WHERE id=target;RETURN true;
END;$dg$;
REVOKE ALL ON FUNCTION dg_native_directory_clear_exclusive_name(text,text,text,text,bigint) FROM PUBLIC;
