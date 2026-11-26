CREATE TABLE studio_recordings (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,
 name TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,snapshot TEXT NOT NULL,
 subject TEXT NOT NULL,proof TEXT NOT NULL,expires_at TEXT NOT NULL,withdrawn_at TEXT,
 transfer_id TEXT UNIQUE REFERENCES media_transfers(id),duration_hint_ms INTEGER,environment TEXT NOT NULL,app_env TEXT NOT NULL,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX studio_recordings_scope ON studio_recordings(tenant_id,workspace_id,actor_id,environment,app_env,id);
CREATE TABLE studio_recording_versions (
 recording_id TEXT NOT NULL REFERENCES studio_recordings(id),version INTEGER NOT NULL,action TEXT NOT NULL,
 snapshot TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(recording_id,version)
);
CREATE TABLE studio_recording_outputs (
 recording_id TEXT PRIMARY KEY REFERENCES studio_recordings(id),transfer_id TEXT NOT NULL UNIQUE REFERENCES media_transfers(id),
 raw_key TEXT NOT NULL,raw_sha256 TEXT NOT NULL,raw_size INTEGER NOT NULL,input_container TEXT NOT NULL,
 asset_id TEXT NOT NULL UNIQUE REFERENCES assets(id),output_sha256 TEXT NOT NULL,output_size INTEGER NOT NULL,
 source_specs TEXT NOT NULL,specs TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TABLE studio_recording_applications (
 id TEXT PRIMARY KEY,recording_id TEXT NOT NULL REFERENCES studio_recordings(id),request_hash TEXT NOT NULL,
 actor_id TEXT NOT NULL,project_id TEXT NOT NULL REFERENCES studio_projects(id),project_version INTEGER NOT NULL,created_at TEXT NOT NULL,
 UNIQUE(recording_id,actor_id,request_hash)
);
