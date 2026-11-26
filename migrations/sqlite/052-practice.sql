CREATE TABLE practice_scenarios (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,
 name TEXT NOT NULL,definition TEXT NOT NULL,definition_hash TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>=1),
 environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX practice_scenario_scope ON practice_scenarios(tenant_id,workspace_id,environment,app_env,id);
CREATE TABLE practice_scenario_versions (
 scenario_id TEXT NOT NULL REFERENCES practice_scenarios(id),version INTEGER NOT NULL,name TEXT NOT NULL,
 definition TEXT NOT NULL,definition_hash TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(scenario_id,version)
);
CREATE TRIGGER practice_version_no_update BEFORE UPDATE ON practice_scenario_versions BEGIN SELECT RAISE(ABORT,'practice revision is immutable');END;
CREATE TRIGGER practice_version_no_delete BEFORE DELETE ON practice_scenario_versions BEGIN SELECT RAISE(ABORT,'practice revision is immutable');END;
CREATE TABLE practice_releases (
 id TEXT PRIMARY KEY,scenario_id TEXT NOT NULL REFERENCES practice_scenarios(id),scenario_version INTEGER NOT NULL,
 tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,name TEXT NOT NULL,
 snapshot TEXT NOT NULL,release_hash TEXT NOT NULL,withdrawn_at TEXT,
 environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(scenario_id,scenario_version)
);
CREATE INDEX practice_release_scope ON practice_releases(tenant_id,workspace_id,environment,app_env,id);
CREATE TRIGGER practice_release_fixed BEFORE UPDATE ON practice_releases WHEN
 NEW.id IS NOT OLD.id OR NEW.scenario_id IS NOT OLD.scenario_id OR NEW.scenario_version IS NOT OLD.scenario_version OR
 NEW.tenant_id IS NOT OLD.tenant_id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.actor_id IS NOT OLD.actor_id OR NEW.name IS NOT OLD.name OR
 NEW.snapshot IS NOT OLD.snapshot OR NEW.release_hash IS NOT OLD.release_hash OR NEW.environment IS NOT OLD.environment OR NEW.app_env IS NOT OLD.app_env OR NEW.created_at IS NOT OLD.created_at OR
 (OLD.withdrawn_at IS NOT NULL AND NEW.withdrawn_at IS NOT OLD.withdrawn_at)
 BEGIN SELECT RAISE(ABORT,'practice release is fixed and withdrawal permanent');END;
CREATE TABLE practice_runs (
 id TEXT PRIMARY KEY,release_id TEXT NOT NULL REFERENCES practice_releases(id),tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,
 release_hash TEXT NOT NULL,state TEXT,state_hash TEXT,version INTEGER NOT NULL DEFAULT 1,
 phase TEXT NOT NULL CHECK(phase IN ('question','feedback','completed','stopped','deleted')),shared_feedback INTEGER NOT NULL CHECK(shared_feedback IN (0,1)),
 expires_at TEXT NOT NULL,deleted_at TEXT,deletion_reason TEXT,
 environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 CHECK((phase='deleted' AND state IS NULL AND state_hash IS NULL AND deleted_at IS NOT NULL AND shared_feedback=0) OR (phase<>'deleted' AND state IS NOT NULL AND state_hash IS NOT NULL AND deleted_at IS NULL))
);
CREATE INDEX practice_run_scope ON practice_runs(tenant_id,workspace_id,environment,app_env,actor_id,id);
CREATE INDEX practice_run_expiry ON practice_runs(environment,app_env,expires_at) WHERE phase<>'deleted';
CREATE TRIGGER practice_run_fixed BEFORE UPDATE ON practice_runs WHEN
 NEW.id IS NOT OLD.id OR NEW.release_id IS NOT OLD.release_id OR NEW.tenant_id IS NOT OLD.tenant_id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.actor_id IS NOT OLD.actor_id OR
 NEW.release_hash IS NOT OLD.release_hash OR NEW.expires_at IS NOT OLD.expires_at OR NEW.environment IS NOT OLD.environment OR NEW.app_env IS NOT OLD.app_env OR NEW.created_at IS NOT OLD.created_at OR
 (OLD.phase='deleted' AND (NEW.phase<>'deleted' OR NEW.deleted_at IS NOT OLD.deleted_at OR NEW.deletion_reason IS NOT OLD.deletion_reason))
 BEGIN SELECT RAISE(ABORT,'practice run source and deletion are fixed');END;
CREATE TABLE practice_turns (
 id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES practice_runs(id),ordinal INTEGER NOT NULL CHECK(ordinal>=1),question_id TEXT NOT NULL,
 prompt TEXT,body TEXT,feedback TEXT,next_question_id TEXT,created_at TEXT NOT NULL,UNIQUE(run_id,ordinal),UNIQUE(run_id,question_id)
);
CREATE TRIGGER practice_turn_fixed BEFORE UPDATE ON practice_turns WHEN
 NEW.id IS NOT OLD.id OR NEW.run_id IS NOT OLD.run_id OR NEW.ordinal IS NOT OLD.ordinal OR NEW.question_id IS NOT OLD.question_id OR
 NEW.next_question_id IS NOT OLD.next_question_id OR NEW.created_at IS NOT OLD.created_at OR
 NOT(NEW.prompt IS NULL AND NEW.body IS NULL AND NEW.feedback IS NULL AND (SELECT phase FROM practice_runs WHERE id=OLD.run_id)='deleted')
 BEGIN SELECT RAISE(ABORT,'practice answer is immutable except full erasure');END;
CREATE TRIGGER practice_turn_no_delete BEFORE DELETE ON practice_turns BEGIN SELECT RAISE(ABORT,'practice answer uses explicit erasure');END;
