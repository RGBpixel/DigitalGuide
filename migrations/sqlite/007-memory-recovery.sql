CREATE TABLE memory_recovery_credentials (
  id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES people(id),
  tenant_id TEXT NOT NULL, workspace_id TEXT NOT NULL, token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL, revoked_at TEXT, used_at TEXT,
  created_at TEXT NOT NULL, environment TEXT NOT NULL, app_env TEXT NOT NULL
);
CREATE INDEX memory_recovery_person ON memory_recovery_credentials(person_id,revoked_at,expires_at);
CREATE TABLE memory_session_greetings (
  session_id TEXT PRIMARY KEY REFERENCES reception_sessions(id),
  person_id TEXT NOT NULL REFERENCES people(id), greeted_at TEXT NOT NULL
);
