CREATE TABLE studio_media_plans (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,name TEXT NOT NULL,
 payload TEXT NOT NULL,plan_hash TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,withdrawn_at TEXT,
 environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX studio_media_plans_scope ON studio_media_plans(tenant_id,workspace_id,environment,app_env,id);
CREATE TABLE studio_media_plan_versions (
 plan_id TEXT NOT NULL REFERENCES studio_media_plans(id),version INTEGER NOT NULL,payload TEXT NOT NULL,plan_hash TEXT NOT NULL,
 actor_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(plan_id,version)
);
CREATE TABLE studio_media_jobs (
 id TEXT PRIMARY KEY,plan_id TEXT NOT NULL REFERENCES studio_media_plans(id),plan_version INTEGER NOT NULL,
 tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,input_snapshot TEXT NOT NULL,input_hash TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued',version INTEGER NOT NULL DEFAULT 1,progress REAL NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,
 lease_token TEXT,lease_until TEXT,report TEXT,error_code TEXT,error_message TEXT,environment TEXT NOT NULL,app_env TEXT NOT NULL,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX studio_media_jobs_queue ON studio_media_jobs(environment,app_env,status,created_at);
CREATE UNIQUE INDEX studio_media_jobs_active ON studio_media_jobs(plan_id,input_hash) WHERE status IN ('queued','processing');
CREATE TABLE studio_media_outputs (
 id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES studio_media_jobs(id),asset_id TEXT NOT NULL UNIQUE REFERENCES assets(id),
 name TEXT NOT NULL,media_type TEXT NOT NULL,storage_key TEXT NOT NULL,size INTEGER NOT NULL,sha256 TEXT NOT NULL,specs TEXT NOT NULL,
 source_start_ms INTEGER NOT NULL,source_duration_ms INTEGER,alpha INTEGER NOT NULL,
 preview_key TEXT,preview_sha256 TEXT,preview_size INTEGER,created_at TEXT NOT NULL
);
CREATE TABLE studio_media_applications (
 id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES studio_media_jobs(id),request_hash TEXT NOT NULL,actor_id TEXT NOT NULL,
 project_id TEXT NOT NULL REFERENCES studio_projects(id),kind TEXT NOT NULL,previous_version INTEGER,applied_version INTEGER NOT NULL,
 reverted_version INTEGER,created_at TEXT NOT NULL,UNIQUE(job_id,actor_id,request_hash)
);
CREATE TABLE alpha_video_previews (
 asset_id TEXT PRIMARY KEY REFERENCES assets(id),storage_key TEXT NOT NULL,sha256 TEXT NOT NULL,size INTEGER NOT NULL,created_at TEXT NOT NULL
);
CREATE TABLE alpha_video_frames (
 asset_id TEXT NOT NULL REFERENCES assets(id),asset_version INTEGER NOT NULL,frame_number INTEGER NOT NULL,
 storage_key TEXT NOT NULL,sha256 TEXT NOT NULL,size INTEGER NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(asset_id,asset_version,frame_number)
);
