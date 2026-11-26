-- Optional metadata preserves all original template and batch columns/rows.
ALTER TABLE studio_templates ADD COLUMN controls TEXT;
ALTER TABLE studio_batch_items ADD COLUMN parameters TEXT;
CREATE TABLE studio_template_instantiations (
 project_id TEXT PRIMARY KEY REFERENCES studio_projects(id),tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,template_id TEXT NOT NULL,template_version INTEGER NOT NULL,template_snapshot TEXT NOT NULL,
 variables TEXT NOT NULL,parameters TEXT,plan_hash TEXT NOT NULL,document_hash TEXT NOT NULL,
 environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE INDEX studio_template_origin_scope ON studio_template_instantiations(tenant_id,workspace_id,environment,app_env,project_id);
