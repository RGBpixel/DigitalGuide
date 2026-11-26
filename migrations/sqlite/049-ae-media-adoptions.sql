CREATE TABLE ae_media_adoptions (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,
 artifact_id TEXT NOT NULL UNIQUE REFERENCES ae_render_artifacts(id),batch_id TEXT NOT NULL REFERENCES ae_batches(id),job_id TEXT NOT NULL REFERENCES ae_render_jobs(id),
 name TEXT NOT NULL,rights_note TEXT NOT NULL,expires_at TEXT NOT NULL,snapshot TEXT NOT NULL,snapshot_hash TEXT NOT NULL,plan_hash TEXT NOT NULL,
 environment TEXT NOT NULL,app_env TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','succeeded','failed','cancelled','withdrawn')),
 stage TEXT NOT NULL DEFAULT 'queued' CHECK(stage IN ('queued','copying','inspecting','committing','finished')),
 version INTEGER NOT NULL DEFAULT 1,control_version INTEGER NOT NULL DEFAULT 1,progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),lease_token TEXT,lease_until TEXT,
 asset_id TEXT UNIQUE REFERENCES assets(id),project_id TEXT UNIQUE REFERENCES studio_projects(id),
 inspection_runtime TEXT,error_code TEXT,error_message TEXT,withdrawn_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 CHECK(status!='succeeded' OR (asset_id IS NOT NULL AND project_id IS NOT NULL))
);
CREATE TABLE ae_media_attempts (
 adoption_id TEXT NOT NULL REFERENCES ae_media_adoptions(id),attempt INTEGER NOT NULL,status TEXT NOT NULL,
 error_code TEXT,error_message TEXT,created_at TEXT NOT NULL,finished_at TEXT,PRIMARY KEY(adoption_id,attempt)
);
CREATE INDEX ae_media_scope ON ae_media_adoptions(tenant_id,workspace_id,environment,app_env,id);
CREATE INDEX ae_media_queue ON ae_media_adoptions(environment,app_env,status,lease_until,created_at,id);
CREATE TRIGGER ae_media_input_immutable BEFORE UPDATE OF tenant_id,workspace_id,actor_id,artifact_id,batch_id,job_id,name,rights_note,expires_at,snapshot,snapshot_hash,plan_hash,environment,app_env,created_at ON ae_media_adoptions BEGIN SELECT RAISE(ABORT,'AE adoption input is immutable'); END;
CREATE TRIGGER ae_media_result_immutable BEFORE UPDATE OF asset_id,project_id,inspection_runtime ON ae_media_adoptions WHEN OLD.asset_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'AE adoption result is immutable'); END;
CREATE TRIGGER ae_media_withdrawal_final BEFORE UPDATE ON ae_media_adoptions WHEN OLD.status='withdrawn' BEGIN SELECT RAISE(ABORT,'AE adoption withdrawal is final'); END;
CREATE TRIGGER ae_media_result_not_deleted BEFORE DELETE ON ae_media_adoptions WHEN OLD.asset_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'AE adoption provenance cannot be deleted'); END;
