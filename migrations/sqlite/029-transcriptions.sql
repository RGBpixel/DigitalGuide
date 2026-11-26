CREATE TABLE studio_transcriptions (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,name TEXT NOT NULL,
 snapshot TEXT NOT NULL,input_hash TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',version INTEGER NOT NULL DEFAULT 1,
 progress REAL NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,lease_token TEXT,lease_until TEXT,
 analysis TEXT,analysis_hash TEXT,audio_key TEXT,audio_sha256 TEXT,audio_size INTEGER,
 review TEXT,review_version INTEGER,review_hash TEXT,source_id TEXT REFERENCES studio_content_sources(id),withdrawn_at TEXT,
 error_code TEXT,error_message TEXT,environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX studio_transcriptions_queue ON studio_transcriptions(environment,app_env,status,created_at);
CREATE UNIQUE INDEX studio_transcriptions_active ON studio_transcriptions(tenant_id,workspace_id,actor_id,input_hash,environment,app_env) WHERE status IN ('queued','transcribing');
CREATE TABLE studio_transcription_revisions (
 transcription_id TEXT NOT NULL REFERENCES studio_transcriptions(id),version INTEGER NOT NULL,review TEXT NOT NULL,review_hash TEXT NOT NULL,
 actor_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(transcription_id,version)
);
CREATE TABLE studio_transcription_sources (
 source_id TEXT PRIMARY KEY REFERENCES studio_content_sources(id),transcription_id TEXT NOT NULL REFERENCES studio_transcriptions(id),
 review_version INTEGER NOT NULL,review_hash TEXT NOT NULL,confirmation_hash TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,
 UNIQUE(transcription_id,review_version)
);
