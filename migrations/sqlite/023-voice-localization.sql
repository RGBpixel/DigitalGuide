CREATE TABLE voice_styles (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,name TEXT NOT NULL,preset TEXT NOT NULL,
 controls TEXT NOT NULL,reference_asset_id TEXT,reference_consent_id TEXT,note TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL DEFAULT 1,
 environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX voice_styles_workspace ON voice_styles(tenant_id,workspace_id,environment,app_env,id);
CREATE TABLE voice_style_versions (style_id TEXT NOT NULL REFERENCES voice_styles(id),version INTEGER NOT NULL,payload TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(style_id,version));
CREATE TABLE pronunciation_books (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,name TEXT NOT NULL,brand_id TEXT,
 entries TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,environment TEXT NOT NULL,app_env TEXT NOT NULL,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX pronunciation_books_workspace ON pronunciation_books(tenant_id,workspace_id,environment,app_env,id);
CREATE TABLE pronunciation_book_versions (book_id TEXT NOT NULL REFERENCES pronunciation_books(id),version INTEGER NOT NULL,payload TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(book_id,version));
CREATE TABLE studio_language_links (
 id TEXT PRIMARY KEY,source_project_id TEXT NOT NULL REFERENCES studio_projects(id),source_version INTEGER NOT NULL,
 target_project_id TEXT NOT NULL UNIQUE REFERENCES studio_projects(id),source_locale TEXT NOT NULL,target_locale TEXT NOT NULL,
 dictionary_id TEXT,dictionary_version INTEGER,source_snapshot TEXT NOT NULL,method TEXT NOT NULL,
 actor_id TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TABLE studio_subtitle_editions (
 id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES studio_projects(id),base_project_version INTEGER NOT NULL,
 locale TEXT NOT NULL,cues TEXT NOT NULL,timing_source TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft',
 version INTEGER NOT NULL DEFAULT 1,applied_project_version INTEGER,applied_track_id TEXT,
 actor_id TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX studio_subtitle_project ON studio_subtitle_editions(project_id,created_at);
CREATE TABLE studio_subtitle_revisions (edition_id TEXT NOT NULL REFERENCES studio_subtitle_editions(id),version INTEGER NOT NULL,payload TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(edition_id,version));
CREATE TABLE studio_speech_jobs (
 id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES studio_projects(id),project_version INTEGER NOT NULL,
 actor_id TEXT NOT NULL,provider_id TEXT NOT NULL,voice_id TEXT NOT NULL,locale TEXT NOT NULL,
 style_id TEXT,style_version INTEGER,dictionary_id TEXT,dictionary_version INTEGER,
 input_snapshot TEXT NOT NULL,input_hash TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',
 version INTEGER NOT NULL DEFAULT 1,attempts INTEGER NOT NULL DEFAULT 0,lease_token TEXT,lease_until TEXT,
 outputs TEXT NOT NULL DEFAULT '[]',error_code TEXT,error_message TEXT,applied_project_version INTEGER,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX studio_speech_jobs_queue ON studio_speech_jobs(status,created_at);
CREATE UNIQUE INDEX studio_speech_live_input ON studio_speech_jobs(project_id,input_hash) WHERE status IN ('queued','rendering');
