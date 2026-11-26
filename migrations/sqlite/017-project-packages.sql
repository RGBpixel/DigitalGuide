ALTER TABLE media_transfers ADD COLUMN nonportable_confirmed_at TEXT;
CREATE TABLE studio_package_imports (
 transfer_id TEXT PRIMARY KEY REFERENCES media_transfers(id),project_id TEXT NOT NULL REFERENCES studio_projects(id),
 source_sha256 TEXT NOT NULL,asset_id_map TEXT NOT NULL,non_portable TEXT NOT NULL,created_at TEXT NOT NULL
);
