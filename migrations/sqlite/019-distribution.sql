CREATE TABLE distribution_variants (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,last_editor_id TEXT NOT NULL,
 project_id TEXT NOT NULL REFERENCES studio_projects(id),export_id TEXT NOT NULL REFERENCES studio_exports(id),
 platform TEXT NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,tags TEXT NOT NULL,cover_asset_id TEXT NOT NULL REFERENCES assets(id),ai_disclosure TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE TABLE distribution_variant_versions (
 variant_id TEXT NOT NULL REFERENCES distribution_variants(id),version INTEGER NOT NULL,payload TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,
 PRIMARY KEY(variant_id,version)
);
CREATE TABLE distribution_reviews (
 id TEXT PRIMARY KEY,variant_id TEXT NOT NULL REFERENCES distribution_variants(id),variant_version INTEGER NOT NULL,requester_id TEXT NOT NULL,reviewer_id TEXT NOT NULL,
 snapshot_hash TEXT NOT NULL,snapshot TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',version INTEGER NOT NULL DEFAULT 1,note TEXT NOT NULL DEFAULT '',
 invalidated_at TEXT,invalidation_reason TEXT,created_at TEXT NOT NULL,decision_at TEXT
);
CREATE UNIQUE INDEX distribution_one_pending_review ON distribution_reviews(variant_id) WHERE status='pending' AND invalidated_at IS NULL;
CREATE TABLE publishing_accounts (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,name TEXT NOT NULL,platform TEXT NOT NULL,mode TEXT NOT NULL CHECK(mode IN ('manual','mock')),
 scenario TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,version INTEGER NOT NULL DEFAULT 1,environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE TABLE publishing_jobs (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,variant_id TEXT NOT NULL REFERENCES distribution_variants(id),variant_version INTEGER NOT NULL,
 account_id TEXT NOT NULL REFERENCES publishing_accounts(id),account_version INTEGER NOT NULL,creative_hash TEXT NOT NULL,plan_hash TEXT NOT NULL,title TEXT NOT NULL,account_name TEXT NOT NULL,content_snapshot TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'scheduled',version INTEGER NOT NULL DEFAULT 1,scheduled_at TEXT NOT NULL,remote_id TEXT,error_message TEXT,
 lease_token TEXT,lease_until TEXT,environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX publishing_due ON publishing_jobs(environment,app_env,status,scheduled_at,lease_until);
CREATE TABLE publishing_remote_posts (
 job_id TEXT PRIMARY KEY REFERENCES publishing_jobs(id),input_hash TEXT NOT NULL,remote_id TEXT NOT NULL UNIQUE,status TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TABLE publishing_callback_events (
 event_id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES publishing_jobs(id),payload_hash TEXT NOT NULL,status TEXT NOT NULL,occurred_at TEXT NOT NULL,received_at TEXT NOT NULL
);
CREATE TABLE publishing_metrics (
 id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES publishing_jobs(id),event_time TEXT NOT NULL,fetched_at TEXT NOT NULL,views INTEGER NOT NULL,likes INTEGER NOT NULL,comments INTEGER NOT NULL
);
CREATE TABLE publishing_packages (
 id TEXT PRIMARY KEY,variant_id TEXT NOT NULL REFERENCES distribution_variants(id),variant_version INTEGER NOT NULL,actor_id TEXT NOT NULL,snapshot_hash TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued',version INTEGER NOT NULL DEFAULT 1,storage_key TEXT,size INTEGER,sha256 TEXT,error_message TEXT,
 lease_token TEXT,lease_until TEXT,environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX publishing_packages_queue ON publishing_packages(environment,app_env,status,lease_until,created_at);
CREATE TRIGGER distribution_review_authority_update AFTER UPDATE OF role,workspace_ids ON memberships
WHEN OLD.role<>NEW.role OR OLD.workspace_ids<>NEW.workspace_ids
BEGIN
 UPDATE distribution_reviews SET invalidated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),invalidation_reason='审核人员权限或空间范围已变更，请重新提交。',version=version+1
 WHERE reviewer_id=OLD.user_id AND status IN ('pending','approved') AND invalidated_at IS NULL;
END;
CREATE TRIGGER distribution_review_authority_delete AFTER DELETE ON memberships
BEGIN
 UPDATE distribution_reviews SET invalidated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),invalidation_reason='审核人员权限已撤回，请重新提交。',version=version+1
 WHERE reviewer_id=OLD.user_id AND status IN ('pending','approved') AND invalidated_at IS NULL;
END;
