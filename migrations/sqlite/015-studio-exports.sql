CREATE TABLE studio_exports (
 id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES studio_projects(id),tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,
 project_version INTEGER NOT NULL,plan_hash TEXT NOT NULL,kind TEXT NOT NULL,settings TEXT NOT NULL,start_ms INTEGER NOT NULL,duration_ms INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued',attempts INTEGER NOT NULL DEFAULT 0,lease_token TEXT,lease_until TEXT,progress REAL NOT NULL DEFAULT 0,
 result TEXT,error_message TEXT,rights_confirmed_at TEXT NOT NULL,
 environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX studio_export_queue ON studio_exports(environment,app_env,status,lease_until,created_at);
CREATE TABLE studio_export_artifacts (
 id TEXT PRIMARY KEY,export_id TEXT NOT NULL REFERENCES studio_exports(id),kind TEXT NOT NULL,name TEXT NOT NULL,media_type TEXT NOT NULL,
 storage_key TEXT NOT NULL UNIQUE,size INTEGER NOT NULL,sha256 TEXT NOT NULL,created_at TEXT NOT NULL
);
