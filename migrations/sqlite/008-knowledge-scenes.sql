CREATE TABLE knowledge_collections (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
  name TEXT NOT NULL, audience TEXT NOT NULL, reader_roles TEXT NOT NULL, scenes TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, environment TEXT NOT NULL, app_env TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE knowledge_documents (
  id TEXT PRIMARY KEY, collection_id TEXT NOT NULL REFERENCES knowledge_collections(id),
  tenant_id TEXT NOT NULL, workspace_id TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  published_version_id TEXT, created_at TEXT NOT NULL
);
CREATE TABLE knowledge_versions (
  id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES knowledge_documents(id),
  ordinal INTEGER NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, source_label TEXT NOT NULL,
  source_url TEXT, content_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL, published_at TEXT, UNIQUE(document_id,ordinal)
);
CREATE TABLE knowledge_chunks (
  id TEXT PRIMARY KEY, version_id TEXT NOT NULL REFERENCES knowledge_versions(id),
  document_id TEXT NOT NULL REFERENCES knowledge_documents(id), sequence INTEGER NOT NULL,
  text TEXT NOT NULL, tokens TEXT NOT NULL, UNIQUE(version_id,sequence)
);
CREATE INDEX knowledge_document_collection ON knowledge_documents(collection_id,published_version_id);
CREATE TABLE scene_apps (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
  profile_id TEXT NOT NULL REFERENCES profiles(id), name TEXT NOT NULL,
  scene TEXT NOT NULL, channel_key TEXT NOT NULL, config TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, enabled INTEGER NOT NULL DEFAULT 1,
  environment TEXT NOT NULL, app_env TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,workspace_id,channel_key,environment,app_env)
);
CREATE TABLE scene_app_versions (
  app_id TEXT NOT NULL REFERENCES scene_apps(id), version INTEGER NOT NULL,
  snapshot TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(app_id,version)
);
ALTER TABLE reception_sessions ADD COLUMN scene_app_snapshot TEXT;
ALTER TABLE reception_messages ADD COLUMN knowledge_citations TEXT NOT NULL DEFAULT '[]';
