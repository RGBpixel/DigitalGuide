CREATE TABLE studio_shares (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,
 name TEXT NOT NULL,variant_id TEXT NOT NULL,definition TEXT NOT NULL,definition_hash TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,
 environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX studio_shares_scope ON studio_shares(tenant_id,workspace_id,environment,app_env,id);
CREATE TABLE studio_share_versions (
 share_id TEXT NOT NULL REFERENCES studio_shares(id),version INTEGER NOT NULL,name TEXT NOT NULL,variant_id TEXT NOT NULL,
 definition TEXT NOT NULL,definition_hash TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(share_id,version)
);
CREATE TABLE studio_share_releases (
 id TEXT PRIMARY KEY,share_id TEXT NOT NULL REFERENCES studio_shares(id),tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,
 share_version INTEGER NOT NULL,name TEXT NOT NULL,snapshot TEXT NOT NULL,release_hash TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,
 withdrawn_at TEXT,environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(share_id,share_version)
);
CREATE TABLE studio_share_links (
 id TEXT PRIMARY KEY,release_id TEXT NOT NULL REFERENCES studio_share_releases(id),tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,
 title TEXT NOT NULL,access TEXT NOT NULL CHECK(access IN ('unlisted','public')),nonce TEXT NOT NULL,token_hash TEXT NOT NULL,
 embed_origins TEXT NOT NULL,recording_enabled INTEGER NOT NULL CHECK(recording_enabled IN (0,1)),retention_days INTEGER NOT NULL CHECK(retention_days BETWEEN 1 AND 90),
 expires_at TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,revoked_at TEXT,environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE INDEX studio_share_links_release ON studio_share_links(release_id,id);
CREATE TABLE studio_share_sessions (
 id TEXT PRIMARY KEY,link_id TEXT NOT NULL REFERENCES studio_share_links(id),link_version INTEGER NOT NULL,nonce TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,
 version INTEGER NOT NULL DEFAULT 1,consent INTEGER NOT NULL DEFAULT 0 CHECK(consent IN (0,1)),position_ms INTEGER NOT NULL DEFAULT 0,event_count INTEGER NOT NULL DEFAULT 0,
 records_expires_at TEXT,expires_at TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX studio_share_sessions_link ON studio_share_sessions(link_id,id);
CREATE INDEX studio_share_sessions_retention ON studio_share_sessions(records_expires_at);
CREATE TABLE studio_share_events (
 id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES studio_share_sessions(id),type TEXT NOT NULL,time_ms INTEGER NOT NULL,
 widget_id TEXT,option_id TEXT,created_at TEXT NOT NULL,expires_at TEXT NOT NULL
);
CREATE INDEX studio_share_events_session ON studio_share_events(session_id,id);
CREATE TABLE studio_share_event_requests (
 session_id TEXT NOT NULL REFERENCES studio_share_sessions(id),key_hash TEXT NOT NULL,request_hash TEXT NOT NULL,
 event_id TEXT NOT NULL REFERENCES studio_share_events(id) ON DELETE CASCADE,PRIMARY KEY(session_id,key_hash)
);
CREATE TABLE studio_share_join_requests (
 link_id TEXT NOT NULL REFERENCES studio_share_links(id),link_version INTEGER NOT NULL,key_hash TEXT NOT NULL,request_hash TEXT NOT NULL,
 session_id TEXT NOT NULL REFERENCES studio_share_sessions(id),PRIMARY KEY(link_id,link_version,key_hash)
);
