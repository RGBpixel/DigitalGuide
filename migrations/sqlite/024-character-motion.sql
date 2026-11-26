CREATE TABLE studio_characters (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,name TEXT NOT NULL,kind TEXT NOT NULL,visual_style TEXT NOT NULL,
 source_asset_id TEXT NOT NULL,source_version INTEGER NOT NULL,source_sha256 TEXT NOT NULL,consent_id TEXT NOT NULL,parent_id TEXT,
 costume_label TEXT NOT NULL,pose_label TEXT NOT NULL,expires_at TEXT NOT NULL,note TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,
 archived INTEGER NOT NULL DEFAULT 0,environment TEXT NOT NULL,app_env TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX studio_characters_scope ON studio_characters(tenant_id,workspace_id,environment,app_env,id);
CREATE TABLE studio_character_versions (character_id TEXT NOT NULL REFERENCES studio_characters(id),version INTEGER NOT NULL,payload TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(character_id,version));
CREATE TABLE character_motion_plans (
 id TEXT PRIMARY KEY,character_id TEXT NOT NULL REFERENCES studio_characters(id),project_id TEXT NOT NULL REFERENCES studio_projects(id),
 payload TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX character_motion_project ON character_motion_plans(project_id,created_at);
CREATE TABLE character_motion_versions (plan_id TEXT NOT NULL REFERENCES character_motion_plans(id),version INTEGER NOT NULL,payload TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(plan_id,version));
CREATE TABLE character_jobs (
 id TEXT PRIMARY KEY,character_id TEXT NOT NULL REFERENCES studio_characters(id),character_version INTEGER NOT NULL,
 tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,operation TEXT NOT NULL,project_id TEXT,project_version INTEGER,
 input_snapshot TEXT NOT NULL,input_hash TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',version INTEGER NOT NULL DEFAULT 1,
 attempts INTEGER NOT NULL DEFAULT 0,lease_token TEXT,lease_until TEXT,error_code TEXT,error_message TEXT,
 outputs TEXT NOT NULL DEFAULT '[]',result TEXT,applied_project_version INTEGER,environment TEXT NOT NULL,app_env TEXT NOT NULL,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX character_jobs_queue ON character_jobs(environment,app_env,status,created_at);
CREATE UNIQUE INDEX character_jobs_active ON character_jobs(character_id,input_hash) WHERE status IN ('queued','rendering');
CREATE TABLE character_derivations (
 asset_id TEXT PRIMARY KEY REFERENCES assets(id),character_id TEXT NOT NULL REFERENCES studio_characters(id),source_asset_id TEXT NOT NULL,
 source_version INTEGER NOT NULL,consent_id TEXT NOT NULL,voice_asset_id TEXT,voice_version INTEGER,created_at TEXT NOT NULL
);
