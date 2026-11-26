CREATE TABLE ae_templates (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,
 catalog_id TEXT NOT NULL,catalog_revision INTEGER NOT NULL,manifest_sha256 TEXT NOT NULL,manifest TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 UNIQUE(tenant_id,workspace_id,environment,app_env,catalog_id)
);
CREATE TABLE ae_template_versions (template_id TEXT NOT NULL REFERENCES ae_templates(id),version INTEGER NOT NULL,catalog_revision INTEGER NOT NULL,manifest_sha256 TEXT NOT NULL,manifest TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(template_id,version));
CREATE TABLE ae_batches (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,name TEXT NOT NULL,
 template_id TEXT NOT NULL REFERENCES ae_templates(id),template_version INTEGER NOT NULL,catalog_id TEXT NOT NULL,catalog_revision INTEGER NOT NULL,
 manifest TEXT NOT NULL,manifest_sha256 TEXT NOT NULL,runtime_id TEXT NOT NULL,mode TEXT NOT NULL,kind TEXT NOT NULL,
 input_format TEXT NOT NULL,input_content TEXT NOT NULL,plan_hash TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'running',version INTEGER NOT NULL DEFAULT 1,
 environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE TABLE ae_render_jobs (
 id TEXT PRIMARY KEY,batch_id TEXT NOT NULL REFERENCES ae_batches(id),position INTEGER NOT NULL,name TEXT NOT NULL,
 parameters TEXT NOT NULL,actor_id TEXT,source_hash TEXT,status TEXT NOT NULL,stage TEXT NOT NULL DEFAULT 'queued',version INTEGER NOT NULL DEFAULT 1,
 attempts INTEGER NOT NULL DEFAULT 0,lease_token TEXT,lease_until TEXT,error_code TEXT,error_message TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 UNIQUE(batch_id,position)
);
CREATE TABLE ae_render_attempts (
 job_id TEXT NOT NULL REFERENCES ae_render_jobs(id),attempt INTEGER NOT NULL,status TEXT NOT NULL,parameters TEXT NOT NULL,
 error_message TEXT,created_at TEXT NOT NULL,finished_at TEXT,actor_id TEXT,PRIMARY KEY(job_id,attempt)
);
CREATE TABLE ae_render_artifacts (
 id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES ae_render_jobs(id),kind TEXT NOT NULL,name TEXT NOT NULL,media_type TEXT NOT NULL,
 storage_key TEXT NOT NULL,size INTEGER NOT NULL,sha256 TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE INDEX ae_batch_scope ON ae_batches(tenant_id,workspace_id,environment,app_env,id);
CREATE INDEX ae_job_queue ON ae_render_jobs(status,lease_until,created_at,id);
CREATE TRIGGER ae_template_version_immutable BEFORE UPDATE ON ae_template_versions BEGIN SELECT RAISE(ABORT,'AE template revisions are immutable'); END;
CREATE TRIGGER ae_template_version_no_delete BEFORE DELETE ON ae_template_versions BEGIN SELECT RAISE(ABORT,'AE template revisions are retained'); END;
CREATE TRIGGER ae_batch_source_immutable BEFORE UPDATE OF tenant_id,workspace_id,actor_id,template_id,template_version,catalog_id,catalog_revision,manifest,manifest_sha256,runtime_id,mode,kind,input_format,input_content,plan_hash,environment,app_env ON ae_batches BEGIN SELECT RAISE(ABORT,'AE batch sources are immutable'); END;
