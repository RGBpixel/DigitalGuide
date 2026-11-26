CREATE TABLE studio_projects (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,name TEXT NOT NULL,purpose TEXT NOT NULL,
 document TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,archived INTEGER NOT NULL DEFAULT 0,
 environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX studio_project_scope ON studio_projects(tenant_id,workspace_id,environment,app_env,updated_at,id);
CREATE TABLE studio_project_versions (
 project_id TEXT NOT NULL REFERENCES studio_projects(id),version INTEGER NOT NULL,name TEXT NOT NULL,document TEXT NOT NULL,
 actor_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(project_id,version)
);
CREATE TABLE studio_templates (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,name TEXT NOT NULL,description TEXT NOT NULL,purpose TEXT NOT NULL,
 document TEXT NOT NULL,variables TEXT NOT NULL,license_note TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,
 environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE TABLE studio_template_versions (
 template_id TEXT NOT NULL REFERENCES studio_templates(id),version INTEGER NOT NULL,snapshot TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(template_id,version)
);
CREATE TABLE studio_brand_kits (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,name TEXT NOT NULL,style TEXT NOT NULL,license_note TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE TABLE studio_clones (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,name TEXT NOT NULL,kind TEXT NOT NULL,asset_id TEXT NOT NULL REFERENCES assets(id),
 consent_id TEXT NOT NULL REFERENCES consents(id),job_id TEXT NOT NULL REFERENCES jobs(id),status TEXT NOT NULL DEFAULT 'training',version INTEGER NOT NULL DEFAULT 1,
 accepted_at TEXT,delete_status TEXT NOT NULL DEFAULT 'not_requested',environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE TABLE studio_imports (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,name TEXT NOT NULL,file_name TEXT NOT NULL,
 format TEXT NOT NULL,storage_key TEXT NOT NULL,sha256 TEXT NOT NULL,size INTEGER NOT NULL,rights_note TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued',version INTEGER NOT NULL DEFAULT 1,attempts INTEGER NOT NULL DEFAULT 0,lease_token TEXT,lease_until TEXT,
 result TEXT,error_code TEXT,error_message TEXT,environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX studio_import_queue ON studio_imports(environment,app_env,status,lease_until,created_at);
CREATE TABLE studio_import_media (
 id TEXT PRIMARY KEY,import_id TEXT NOT NULL REFERENCES studio_imports(id),tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,
 storage_key TEXT NOT NULL,sha256 TEXT NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,kind TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TABLE studio_preview_frames (
 id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES studio_projects(id),segment_id TEXT NOT NULL,fingerprint TEXT NOT NULL,
 storage_key TEXT NOT NULL,status TEXT NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,created_at TEXT NOT NULL,
 UNIQUE(project_id,segment_id,fingerprint)
);
CREATE TABLE studio_review_plans (
 id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES studio_projects(id),project_version INTEGER NOT NULL,plan_hash TEXT NOT NULL,
 actor_id TEXT NOT NULL,confirmed_at TEXT NOT NULL
);

CREATE TABLE studio_preview_jobs (
 id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES studio_projects(id),tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,
 project_version INTEGER NOT NULL,plan_hash TEXT NOT NULL,segment_ids TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',attempts INTEGER NOT NULL DEFAULT 0,
 lease_token TEXT,lease_until TEXT,error_message TEXT,environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX studio_preview_queue ON studio_preview_jobs(environment,app_env,status,lease_until,created_at);
