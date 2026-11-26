CREATE TABLE media_transfers (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,kind TEXT NOT NULL,name TEXT NOT NULL,category TEXT NOT NULL,file_name TEXT NOT NULL,
 size INTEGER NOT NULL,expected_sha256 TEXT,sha256 TEXT,part_hashes TEXT,fingerprint TEXT,chunk_size INTEGER NOT NULL,chunk_count INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'uploading',version INTEGER NOT NULL DEFAULT 1,progress REAL NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,lease_token TEXT,lease_until TEXT,
 asset_id TEXT REFERENCES assets(id),project_id TEXT REFERENCES studio_projects(id),warnings TEXT NOT NULL DEFAULT '[]',error_message TEXT,rights_note TEXT NOT NULL,rights_confirmed_at TEXT NOT NULL,chunks_cleaned_at TEXT,
 environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE TABLE media_transfer_parts (
 transfer_id TEXT NOT NULL REFERENCES media_transfers(id),part_index INTEGER NOT NULL,size INTEGER NOT NULL,sha256 TEXT NOT NULL,storage_key TEXT NOT NULL UNIQUE,
 PRIMARY KEY(transfer_id,part_index)
);
CREATE INDEX media_transfer_queue ON media_transfers(environment,app_env,status,lease_until,created_at);
CREATE TABLE video_sources (
 asset_id TEXT PRIMARY KEY REFERENCES assets(id),poster_key TEXT NOT NULL UNIQUE,poster_sha256 TEXT NOT NULL,poster_size INTEGER NOT NULL,created_at TEXT NOT NULL
);
