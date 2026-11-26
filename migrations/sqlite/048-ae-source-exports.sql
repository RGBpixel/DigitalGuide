CREATE TABLE ae_source_exports (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,name TEXT NOT NULL,
 template_id TEXT NOT NULL REFERENCES ae_templates(id),template_version INTEGER NOT NULL,catalog_id TEXT NOT NULL,catalog_revision INTEGER NOT NULL,
 manifest TEXT NOT NULL,manifest_file TEXT NOT NULL,manifest_sha256 TEXT NOT NULL,manifest_size INTEGER NOT NULL,mode TEXT NOT NULL CHECK(mode IN ('local_aerender','contract_test')),plan_hash TEXT NOT NULL,
 environment TEXT NOT NULL,app_env TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','succeeded','failed','cancelled','withdrawn')),
 stage TEXT NOT NULL DEFAULT 'queued' CHECK(stage IN ('queued','preparing','packing','verifying','finished')),
 version INTEGER NOT NULL DEFAULT 1,control_version INTEGER NOT NULL DEFAULT 1,progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),lease_token TEXT,lease_until TEXT,
 storage_key TEXT,size INTEGER,sha256 TEXT,error_code TEXT,error_message TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 CHECK(status!='succeeded' OR (storage_key IS NOT NULL AND size>0 AND sha256 IS NOT NULL))
);
CREATE TABLE ae_source_attempts (
 job_id TEXT NOT NULL REFERENCES ae_source_exports(id),attempt INTEGER NOT NULL,status TEXT NOT NULL,error_code TEXT,error_message TEXT,
 created_at TEXT NOT NULL,finished_at TEXT,PRIMARY KEY(job_id,attempt)
);
CREATE INDEX ae_source_scope ON ae_source_exports(tenant_id,workspace_id,environment,app_env,id);
CREATE INDEX ae_source_queue ON ae_source_exports(environment,app_env,status,lease_until,created_at,id);
CREATE TRIGGER ae_source_input_immutable BEFORE UPDATE OF tenant_id,workspace_id,actor_id,name,template_id,template_version,catalog_id,catalog_revision,manifest,manifest_file,manifest_sha256,manifest_size,mode,plan_hash,environment,app_env,created_at ON ae_source_exports BEGIN SELECT RAISE(ABORT,'AE source inputs are immutable'); END;
CREATE TRIGGER ae_source_withdrawal_final BEFORE UPDATE ON ae_source_exports WHEN OLD.status='withdrawn' BEGIN SELECT RAISE(ABORT,'AE source withdrawal is final'); END;
CREATE TRIGGER ae_source_artifact_immutable BEFORE UPDATE OF storage_key,size,sha256 ON ae_source_exports WHEN OLD.storage_key IS NOT NULL BEGIN SELECT RAISE(ABORT,'AE source artifacts are immutable'); END;
