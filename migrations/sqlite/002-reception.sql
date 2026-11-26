CREATE TABLE reception_terminals (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
  venue_id TEXT NOT NULL REFERENCES venues(id), name TEXT NOT NULL,
  environment TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE reception_sessions (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
  terminal_id TEXT NOT NULL REFERENCES reception_terminals(id), track_hash TEXT NOT NULL,
  source TEXT NOT NULL, environment TEXT NOT NULL, app_env TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','human','ended','expired')),
  version INTEGER NOT NULL DEFAULT 1, reply_epoch INTEGER NOT NULL DEFAULT 0,
  focus_version INTEGER NOT NULL DEFAULT 0, access_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, activity_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  profile_snapshot TEXT, ended_reason TEXT
);
CREATE UNIQUE INDEX one_active_reception_session ON reception_sessions(terminal_id) WHERE status IN ('active','human');
CREATE TABLE reception_presence (
  terminal_id TEXT NOT NULL REFERENCES reception_terminals(id), track_hash TEXT NOT NULL,
  last_seen_at TEXT NOT NULL, cooldown_until TEXT NOT NULL, queue_at TEXT,
  PRIMARY KEY(terminal_id,track_hash)
);
CREATE TABLE reception_messages (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES reception_sessions(id),
  tenant_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('visitor','assistant','system')),
  text TEXT NOT NULL, status TEXT NOT NULL,
  reply_epoch INTEGER NOT NULL, focus_version INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX reception_messages_session ON reception_messages(session_id,created_at,id);
