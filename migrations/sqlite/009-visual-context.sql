CREATE TABLE visual_grants (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES reception_sessions(id),
  tenant_id TEXT NOT NULL, workspace_id TEXT NOT NULL, environment TEXT NOT NULL, app_env TEXT NOT NULL,
  focus_version INTEGER NOT NULL, source TEXT NOT NULL, provider_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', version INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT NOT NULL, created_at TEXT NOT NULL, revoked_at TEXT, ended_reason TEXT
);
CREATE UNIQUE INDEX visual_one_active ON visual_grants(session_id) WHERE status='active';
CREATE INDEX visual_expiry ON visual_grants(environment,app_env,status,expires_at);
CREATE TABLE visual_requests (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES reception_sessions(id),
  grant_id TEXT NOT NULL REFERENCES visual_grants(id), key_hash TEXT NOT NULL, request_hash TEXT NOT NULL,
  focus_version INTEGER NOT NULL, reply_epoch INTEGER NOT NULL, grant_version INTEGER NOT NULL,
  image_hash TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', reply_id TEXT, error_code TEXT,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL, completed_at TEXT,
  UNIQUE(session_id,key_hash)
);
ALTER TABLE reception_messages ADD COLUMN visual_context TEXT;
