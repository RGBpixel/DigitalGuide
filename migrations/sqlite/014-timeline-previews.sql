CREATE TABLE studio_timeline_previews (
 id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES studio_projects(id),tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,
 project_version INTEGER NOT NULL,plan_hash TEXT NOT NULL,start_ms INTEGER NOT NULL,duration_ms INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued',attempts INTEGER NOT NULL DEFAULT 0,lease_token TEXT,lease_until TEXT,progress REAL NOT NULL DEFAULT 0,
 video_key TEXT,audio_key TEXT,result TEXT,error_message TEXT,
 environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX studio_timeline_queue ON studio_timeline_previews(environment,app_env,status,lease_until,created_at);
