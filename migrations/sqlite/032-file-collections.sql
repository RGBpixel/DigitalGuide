-- R-084. Upload capability and accepted library usage are independent lifecycles.
CREATE TABLE asset_collections (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,
 name TEXT NOT NULL,instructions TEXT NOT NULL,folder_id TEXT REFERENCES asset_library_folders(id),allowed_types TEXT NOT NULL,
 max_files INTEGER NOT NULL,total_bytes INTEGER NOT NULL,closes_at TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,closed_at TEXT,close_reason TEXT,
 environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE INDEX asset_collection_scope ON asset_collections(tenant_id,workspace_id,environment,app_env,id);
CREATE TABLE asset_collection_links (
 id TEXT PRIMARY KEY,collection_id TEXT NOT NULL REFERENCES asset_collections(id),tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,
 title TEXT NOT NULL,nonce TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,expires_at TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,revoked_at TEXT,environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TABLE asset_collection_sessions (
 id TEXT PRIMARY KEY,link_id TEXT NOT NULL REFERENCES asset_collection_links(id),tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,
 nonce TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,csrf_token TEXT NOT NULL,display_name TEXT NOT NULL,
 expires_at TEXT NOT NULL,revoked_at TEXT,environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TABLE asset_collection_receipts (
 id TEXT PRIMARY KEY,collection_id TEXT NOT NULL REFERENCES asset_collections(id),session_id TEXT NOT NULL REFERENCES asset_collection_sessions(id),
 tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,client_file_id TEXT NOT NULL,request_hash TEXT NOT NULL,
 name TEXT NOT NULL,file_name TEXT NOT NULL,media_type TEXT NOT NULL,size INTEGER NOT NULL,part_hashes TEXT NOT NULL,
 fingerprint TEXT NOT NULL,expected_sha256 TEXT,sha256 TEXT,declared_rights TEXT NOT NULL,declared_expires_at TEXT NOT NULL,declared_synthetic INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'uploading',version INTEGER NOT NULL DEFAULT 1,progress REAL NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,
 lease_token TEXT,lease_until TEXT,result TEXT,result_hash TEXT,error_code TEXT,error_message TEXT,decision_note TEXT,
 upload_deadline TEXT NOT NULL,retention_until TEXT NOT NULL,submitted_at TEXT,decided_at TEXT,asset_id TEXT REFERENCES assets(id),
 chunks_cleaned_at TEXT,quarantine_cleaned_at TEXT,environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 UNIQUE(session_id,client_file_id)
);
CREATE INDEX asset_collection_receipt_scope ON asset_collection_receipts(tenant_id,workspace_id,environment,app_env,collection_id,id);
CREATE INDEX asset_collection_receipt_queue ON asset_collection_receipts(environment,app_env,status,lease_until,created_at);
CREATE TABLE asset_collection_parts (
 receipt_id TEXT NOT NULL REFERENCES asset_collection_receipts(id),part_index INTEGER NOT NULL,size INTEGER NOT NULL,sha256 TEXT NOT NULL,storage_key TEXT NOT NULL UNIQUE,
 PRIMARY KEY(receipt_id,part_index)
);
CREATE TABLE asset_collection_requests (
 scope TEXT NOT NULL,scope_group TEXT NOT NULL,key_hash TEXT NOT NULL,request_hash TEXT NOT NULL,result_id TEXT NOT NULL,
 tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,
 PRIMARY KEY(scope,key_hash,environment,app_env)
);
CREATE INDEX asset_collection_request_budget ON asset_collection_requests(scope_group,environment,app_env);
CREATE TABLE asset_collection_origins (
 asset_id TEXT PRIMARY KEY REFERENCES assets(id),receipt_id TEXT NOT NULL UNIQUE REFERENCES asset_collection_receipts(id),collection_id TEXT NOT NULL REFERENCES asset_collections(id),
 tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,accepted_by TEXT NOT NULL,rights_note TEXT NOT NULL,rights_expires_at TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,revoked_at TEXT,revoke_note TEXT,environment TEXT NOT NULL,app_env TEXT NOT NULL,accepted_at TEXT NOT NULL
);
-- Revocation is permanent for issued links. Restoring a membership does not reopen them.
CREATE TRIGGER asset_collection_membership_change AFTER UPDATE ON memberships BEGIN
 UPDATE asset_collection_links SET revoked_at=coalesce(revoked_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')),version=version+1
 WHERE actor_id=OLD.user_id AND revoked_at IS NULL AND
 (tenant_id<>NEW.tenant_id OR NEW.role NOT IN ('admin','editor') OR NOT EXISTS(SELECT 1 FROM json_each(NEW.workspace_ids) WHERE value=asset_collection_links.workspace_id));
 UPDATE asset_collections SET closed_at=coalesce(closed_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')),close_reason='issuer_permission_changed',version=version+1
 WHERE actor_id=OLD.user_id AND closed_at IS NULL AND
 (tenant_id<>NEW.tenant_id OR NEW.role NOT IN ('admin','editor') OR NOT EXISTS(SELECT 1 FROM json_each(NEW.workspace_ids) WHERE value=asset_collections.workspace_id));
END;
CREATE TRIGGER asset_collection_membership_delete AFTER DELETE ON memberships BEGIN
 UPDATE asset_collection_links SET revoked_at=coalesce(revoked_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')),version=version+1 WHERE actor_id=OLD.user_id AND revoked_at IS NULL;
 UPDATE asset_collections SET closed_at=coalesce(closed_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')),close_reason='issuer_permission_changed',version=version+1 WHERE actor_id=OLD.user_id AND closed_at IS NULL;
END;
