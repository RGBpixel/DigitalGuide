CREATE TABLE studio_content_drafts (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,root_id TEXT NOT NULL,parent_id TEXT,
 payload TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,environment TEXT NOT NULL,app_env TEXT NOT NULL,
 actor_id TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX studio_content_drafts_scope ON studio_content_drafts(tenant_id,workspace_id,environment,app_env,id);
CREATE TABLE studio_content_draft_versions (
 draft_id TEXT NOT NULL REFERENCES studio_content_drafts(id),version INTEGER NOT NULL,payload TEXT NOT NULL,
 actor_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(draft_id,version)
);
CREATE TABLE studio_content_plans (
 id TEXT PRIMARY KEY,draft_id TEXT NOT NULL REFERENCES studio_content_drafts(id),draft_version INTEGER NOT NULL,
 tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,kind TEXT NOT NULL,name TEXT NOT NULL,
 snapshot TEXT NOT NULL,plan_hash TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'review',version INTEGER NOT NULL DEFAULT 1,
 applied_resource_id TEXT,applied_resource_version INTEGER,environment TEXT NOT NULL,app_env TEXT NOT NULL,
 actor_id TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX studio_content_plans_draft ON studio_content_plans(draft_id,created_at);
CREATE TABLE studio_content_plan_versions (
 plan_id TEXT NOT NULL REFERENCES studio_content_plans(id),version INTEGER NOT NULL,snapshot TEXT NOT NULL,plan_hash TEXT NOT NULL,
 actor_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(plan_id,version)
);
CREATE TABLE studio_content_origins (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,draft_id TEXT NOT NULL REFERENCES studio_content_drafts(id),
 draft_version INTEGER NOT NULL,source_refs TEXT NOT NULL,environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT
);
CREATE TABLE studio_content_asset_origins (
 asset_id TEXT NOT NULL REFERENCES assets(id),origin_id TEXT NOT NULL REFERENCES studio_content_origins(id),
 PRIMARY KEY(asset_id,origin_id)
);
