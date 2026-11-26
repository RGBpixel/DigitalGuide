-- R-084: catalog metadata is independent from the content/consent version of an asset.
CREATE TABLE asset_library_folders (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,parent_id TEXT REFERENCES asset_library_folders(id),
 name TEXT NOT NULL,name_key TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,archived INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX asset_library_folder_name ON asset_library_folders(tenant_id,workspace_id,coalesce(parent_id,''),name_key) WHERE archived=0;
CREATE INDEX asset_library_folder_scope ON asset_library_folders(tenant_id,workspace_id,archived);
CREATE TABLE asset_library_families (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,name TEXT NOT NULL,name_key TEXT NOT NULL,
 folder_id TEXT REFERENCES asset_library_folders(id),tags TEXT NOT NULL DEFAULT '[]',version INTEGER NOT NULL DEFAULT 1,
 merged_into TEXT REFERENCES asset_library_families(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX asset_library_family_scope ON asset_library_families(tenant_id,workspace_id,merged_into,id);
CREATE INDEX asset_library_family_folder ON asset_library_families(folder_id,id);
CREATE TABLE asset_library_revisions (
 asset_id TEXT PRIMARY KEY REFERENCES assets(id),family_id TEXT NOT NULL REFERENCES asset_library_families(id),ordinal INTEGER NOT NULL,
 upload_id TEXT NOT NULL,sha256 TEXT NOT NULL,size INTEGER NOT NULL,media_type TEXT NOT NULL,
 note TEXT NOT NULL DEFAULT '',actor_id TEXT,created_at TEXT NOT NULL,UNIQUE(family_id,ordinal)
);
CREATE TABLE asset_library_events (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,family_id TEXT NOT NULL REFERENCES asset_library_families(id),
 tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,action TEXT NOT NULL,details TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TABLE asset_library_consent_revocations (
 consent_id TEXT PRIMARY KEY REFERENCES consents(id) ON DELETE CASCADE,asset_id TEXT NOT NULL REFERENCES assets(id),
 asset_version INTEGER NOT NULL,reason TEXT NOT NULL,revoked_at TEXT NOT NULL
);
INSERT INTO asset_library_families(id,tenant_id,workspace_id,name,name_key,created_at,updated_at)
 SELECT id,tenant_id,workspace_id,name,lower(name),created_at,created_at FROM assets;
INSERT INTO asset_library_revisions(asset_id,family_id,ordinal,upload_id,sha256,size,media_type,created_at)
 SELECT a.id,a.id,1,a.upload_id,u.sha256,u.size,u.media_type,a.created_at FROM assets a JOIN uploads u ON u.id=a.upload_id;
-- All existing ingestion paths (uploads, generated media, imported projects) become discoverable.
CREATE TRIGGER asset_library_insert AFTER INSERT ON assets BEGIN
 INSERT INTO asset_library_families(id,tenant_id,workspace_id,name,name_key,created_at,updated_at)
 VALUES(NEW.id,NEW.tenant_id,NEW.workspace_id,NEW.name,lower(NEW.name),NEW.created_at,NEW.created_at);
 INSERT INTO asset_library_revisions(asset_id,family_id,ordinal,upload_id,sha256,size,media_type,created_at)
 SELECT NEW.id,NEW.id,1,NEW.upload_id,sha256,size,media_type,NEW.created_at FROM uploads WHERE id=NEW.upload_id;
END;
-- A legacy archive/restore/name change invalidates catalog plans too, without changing file bytes.
CREATE TRIGGER asset_library_asset_change AFTER UPDATE ON assets BEGIN
 UPDATE asset_library_families SET version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE id=(SELECT family_id FROM asset_library_revisions WHERE asset_id=NEW.id);
END;
-- Restoring inventory never resurrects a prior training/character-use grant.
-- The rule also covers the original asset endpoint and already-archived legacy files.
CREATE TRIGGER asset_library_recycle_consents AFTER UPDATE OF archived ON assets WHEN OLD.archived<>NEW.archived BEGIN
 INSERT OR IGNORE INTO asset_library_consent_revocations(consent_id,asset_id,asset_version,reason,revoked_at)
 SELECT id,NEW.id,NEW.version,'asset_recycle_or_restore',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM consents WHERE asset_id=NEW.id AND revoked_at IS NULL;
 UPDATE consents SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE asset_id=NEW.id AND revoked_at IS NULL;
END;
