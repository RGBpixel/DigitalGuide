CREATE TABLE memberships_next (
 user_id TEXT PRIMARY KEY REFERENCES users(id),tenant_id TEXT NOT NULL REFERENCES tenants(id),
 role TEXT NOT NULL CHECK(role IN ('admin','editor','viewer','reviewer')),workspace_ids TEXT NOT NULL
);
INSERT INTO memberships_next SELECT user_id,tenant_id,role,workspace_ids FROM memberships;
DROP TABLE memberships;
ALTER TABLE memberships_next RENAME TO memberships;
CREATE TABLE studio_batches (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,name TEXT NOT NULL,
 template_id TEXT NOT NULL,template_version INTEGER NOT NULL,template_snapshot TEXT NOT NULL,input_format TEXT NOT NULL,input_content TEXT NOT NULL,
 kind TEXT NOT NULL,settings TEXT NOT NULL,max_in_flight INTEGER NOT NULL,max_attempts INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'running',version INTEGER NOT NULL DEFAULT 1,plan_hash TEXT NOT NULL,rights_confirmed_at TEXT NOT NULL,
 environment TEXT NOT NULL,app_env TEXT NOT NULL,last_dispatch_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX studio_batch_dispatch ON studio_batches(environment,app_env,status,last_dispatch_at,created_at);
CREATE TABLE studio_batch_items (
 id TEXT PRIMARY KEY,batch_id TEXT NOT NULL REFERENCES studio_batches(id),position INTEGER NOT NULL,name TEXT NOT NULL,variables TEXT NOT NULL,
 document TEXT,source_hash TEXT,status TEXT NOT NULL DEFAULT 'queued',version INTEGER NOT NULL DEFAULT 1,attempts INTEGER NOT NULL DEFAULT 0,
 project_id TEXT REFERENCES studio_projects(id),export_id TEXT REFERENCES studio_exports(id),error_code TEXT,error_message TEXT,updated_at TEXT NOT NULL,
 UNIQUE(batch_id,position)
);
CREATE INDEX studio_batch_item_queue ON studio_batch_items(batch_id,status,position);
CREATE TABLE studio_batch_attempts (
 item_id TEXT NOT NULL REFERENCES studio_batch_items(id),attempt INTEGER NOT NULL,project_id TEXT REFERENCES studio_projects(id),export_id TEXT REFERENCES studio_exports(id),
 status TEXT NOT NULL,error_code TEXT,error_message TEXT,started_at TEXT NOT NULL,finished_at TEXT,
 PRIMARY KEY(item_id,attempt)
);
CREATE TABLE studio_comments (
 id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES studio_projects(id),project_version INTEGER NOT NULL,author_id TEXT NOT NULL,
 parent_id TEXT REFERENCES studio_comments(id),anchor TEXT NOT NULL,body TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,
 resolved_at TEXT,resolved_by TEXT,created_at TEXT NOT NULL
);
CREATE INDEX studio_comment_project ON studio_comments(project_id,created_at,id);
CREATE TABLE studio_reviews (
 id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES studio_projects(id),project_version INTEGER NOT NULL,stage TEXT NOT NULL,
 export_id TEXT REFERENCES studio_exports(id),requester_id TEXT NOT NULL,reviewer_id TEXT NOT NULL,last_editor_id TEXT NOT NULL,
 snapshot_hash TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',version INTEGER NOT NULL DEFAULT 1,
 note TEXT NOT NULL DEFAULT '',decision_at TEXT,invalidated_at TEXT,invalidation_reason TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX studio_review_inbox ON studio_reviews(reviewer_id,status,created_at);
CREATE UNIQUE INDEX studio_review_pending ON studio_reviews(project_id,stage) WHERE status='pending' AND invalidated_at IS NULL;
CREATE TRIGGER studio_reviews_membership_changed AFTER UPDATE OF role,workspace_ids ON memberships
WHEN OLD.role<>NEW.role OR OLD.workspace_ids<>NEW.workspace_ids
BEGIN
 UPDATE studio_reviews SET invalidated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),invalidation_reason='审核人员权限或工作空间已变化，请重新提交。',version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE reviewer_id=OLD.user_id AND invalidated_at IS NULL AND status IN ('pending','approved');
END;
CREATE TRIGGER studio_reviews_membership_removed AFTER DELETE ON memberships
BEGIN
 UPDATE studio_reviews SET invalidated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),invalidation_reason='审核人员已离开当前组织，请重新提交。',version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE reviewer_id=OLD.user_id AND invalidated_at IS NULL AND status IN ('pending','approved');
END;
