CREATE TABLE enterprise_directory_profile_erasures(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,environment TEXT NOT NULL,app_env TEXT NOT NULL,connector_id TEXT NOT NULL,user_id TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES users(id),origin TEXT NOT NULL CHECK(origin IN('scim_delete','administrator')),
 source_version INTEGER NOT NULL CHECK(source_version BETWEEN 1 AND 1000000000),global_name_cleared INTEGER NOT NULL CHECK(global_name_cleared IN(0,1)),bindings_disabled INTEGER NOT NULL CHECK(bindings_disabled BETWEEN 0 AND 1000),created_at TEXT NOT NULL,
 UNIQUE(tenant_id,environment,app_env,connector_id,user_id),FOREIGN KEY(tenant_id,environment,app_env,connector_id,user_id) REFERENCES enterprise_directory_users(tenant_id,environment,app_env,connector_id,id)
);
CREATE TRIGGER directory_profile_erasure_update BEFORE UPDATE ON enterprise_directory_profile_erasures BEGIN SELECT RAISE(ABORT,'Directory profile erasure receipts are immutable');END;
CREATE TRIGGER directory_profile_erasure_delete BEFORE DELETE ON enterprise_directory_profile_erasures BEGIN SELECT RAISE(ABORT,'Directory profile erasure receipts are immutable');END;
CREATE TRIGGER directory_profile_no_revival BEFORE UPDATE ON enterprise_directory_users WHEN EXISTS(SELECT 1 FROM enterprise_directory_profile_erasures e WHERE e.user_id=OLD.id) AND(NEW.user_name<>OLD.user_name OR NEW.name_key<>OLD.name_key OR NEW.external_id IS NOT OLD.external_id OR NEW.display_name<>OLD.display_name OR NEW.display_key<>OLD.display_key OR NEW.profile_json<>OLD.profile_json OR NEW.deleted<>1 OR NEW.active<>0 OR NEW.review_required<>1) BEGIN SELECT RAISE(ABORT,'Erased directory profile cannot be restored');END;
