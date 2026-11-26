CREATE TABLE studio_content_sources (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,
 name TEXT NOT NULL,kind TEXT NOT NULL,text TEXT NOT NULL,paragraphs TEXT NOT NULL,
 material_sha256 TEXT NOT NULL,text_sha256 TEXT NOT NULL,origin TEXT NOT NULL,warnings TEXT NOT NULL,
 subject TEXT NOT NULL,proof TEXT NOT NULL,expires_at TEXT NOT NULL,withdrawn INTEGER NOT NULL DEFAULT 0,
 version INTEGER NOT NULL DEFAULT 1,environment TEXT NOT NULL,app_env TEXT NOT NULL,
 actor_id TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX studio_content_sources_scope ON studio_content_sources(tenant_id,workspace_id,environment,app_env,id);
CREATE TABLE studio_content_source_versions (
 source_id TEXT NOT NULL REFERENCES studio_content_sources(id),version INTEGER NOT NULL,action TEXT NOT NULL,
 material_sha256 TEXT NOT NULL,text_sha256 TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,
 PRIMARY KEY(source_id,version)
);
CREATE TABLE studio_content_briefs (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,configuration TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,environment TEXT NOT NULL,app_env TEXT NOT NULL,
 actor_id TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX studio_content_briefs_scope ON studio_content_briefs(tenant_id,workspace_id,environment,app_env,id);
CREATE TABLE studio_content_brief_versions (
 brief_id TEXT NOT NULL REFERENCES studio_content_briefs(id),version INTEGER NOT NULL,configuration TEXT NOT NULL,
 actor_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(brief_id,version)
);
