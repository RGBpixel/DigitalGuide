CREATE TABLE studio_frame_reviews (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,
 project_id TEXT NOT NULL REFERENCES studio_projects(id),project_version INTEGER NOT NULL,export_id TEXT NOT NULL REFERENCES studio_exports(id),
 artifact_id TEXT NOT NULL REFERENCES studio_export_artifacts(id),name TEXT NOT NULL,rights_note TEXT NOT NULL,
 snapshot TEXT NOT NULL,snapshot_hash TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',version INTEGER NOT NULL DEFAULT 1,
 progress REAL NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,lease_token TEXT,lease_until TEXT,
 media TEXT,media_hash TEXT,storage_key TEXT,invalidated_at TEXT,error_code TEXT,error_message TEXT,
 environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX studio_frame_review_queue ON studio_frame_reviews(environment,app_env,status,lease_until,created_at);
CREATE UNIQUE INDEX studio_frame_review_active ON studio_frame_reviews(tenant_id,actor_id,export_id,snapshot_hash,environment,app_env) WHERE status IN ('queued','preparing');
CREATE TABLE studio_frame_review_links (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,review_id TEXT NOT NULL REFERENCES studio_frame_reviews(id),actor_id TEXT NOT NULL,
 title TEXT NOT NULL,nonce TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,expires_at TEXT NOT NULL,can_comment INTEGER NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,revoked_at TEXT,environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TABLE studio_frame_review_sessions (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,link_id TEXT NOT NULL REFERENCES studio_frame_review_links(id),
 nonce TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,csrf_token TEXT NOT NULL,name TEXT NOT NULL,
 expires_at TEXT NOT NULL,revoked_at TEXT,environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TABLE studio_frame_comments (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,review_id TEXT NOT NULL REFERENCES studio_frame_reviews(id),
 sequence INTEGER NOT NULL,author_type TEXT NOT NULL CHECK(author_type IN ('member','external')),author_id TEXT NOT NULL,author_name TEXT NOT NULL,
 parent_id TEXT REFERENCES studio_frame_comments(id),visibility TEXT NOT NULL CHECK(visibility IN ('team','external')),
 anchor TEXT NOT NULL,body TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,resolved_at TEXT,resolved_by TEXT,
 environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(review_id,sequence)
);
CREATE TABLE studio_frame_feedback (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,review_id TEXT NOT NULL REFERENCES studio_frame_reviews(id),
 session_id TEXT NOT NULL UNIQUE REFERENCES studio_frame_review_sessions(id),name TEXT NOT NULL,decision TEXT NOT NULL,note TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,environment TEXT NOT NULL,app_env TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE TABLE studio_frame_requests (
 scope TEXT NOT NULL,key_hash TEXT NOT NULL,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,
 request_hash TEXT NOT NULL,result_id TEXT NOT NULL,environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,
 PRIMARY KEY(scope,key_hash)
);
CREATE TRIGGER studio_frame_review_project_changed AFTER UPDATE OF version,archived ON studio_projects
WHEN OLD.version<>NEW.version OR OLD.archived<>NEW.archived
BEGIN
 UPDATE studio_frame_review_links SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),version=version+1
 WHERE review_id IN (SELECT id FROM studio_frame_reviews WHERE project_id=OLD.id) AND revoked_at IS NULL;
 UPDATE studio_frame_reviews SET invalidated_at=COALESCE(invalidated_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 status=CASE WHEN status IN ('queued','preparing') THEN 'stale' ELSE status END,lease_token=NULL,lease_until=NULL,
 version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE project_id=OLD.id;
END;
CREATE TRIGGER studio_frame_review_owner_changed AFTER UPDATE OF role,workspace_ids ON memberships
WHEN OLD.role<>NEW.role OR OLD.workspace_ids<>NEW.workspace_ids
BEGIN
 UPDATE studio_frame_review_links SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),version=version+1 WHERE actor_id=OLD.user_id AND revoked_at IS NULL;
 UPDATE studio_frame_reviews SET invalidated_at=COALESCE(invalidated_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 status=CASE WHEN status IN ('queued','preparing') THEN 'stale' ELSE status END,lease_token=NULL,lease_until=NULL,
 version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE actor_id=OLD.user_id;
END;
CREATE TRIGGER studio_frame_review_owner_removed AFTER DELETE ON memberships
BEGIN
 UPDATE studio_frame_review_links SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),version=version+1 WHERE actor_id=OLD.user_id AND revoked_at IS NULL;
 UPDATE studio_frame_reviews SET invalidated_at=COALESCE(invalidated_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 status=CASE WHEN status IN ('queued','preparing') THEN 'stale' ELSE status END,lease_token=NULL,lease_until=NULL,
 version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE actor_id=OLD.user_id;
END;
