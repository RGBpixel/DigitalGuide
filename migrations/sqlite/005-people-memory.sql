CREATE TABLE people (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
  owner_user_id TEXT, guest_session_id TEXT REFERENCES reception_sessions(id),
  display_name TEXT NOT NULL, roles TEXT NOT NULL, identity_kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', version INTEGER NOT NULL DEFAULT 1,
  personalization INTEGER NOT NULL DEFAULT 0, do_not_disturb INTEGER NOT NULL DEFAULT 1,
  quiet_start TEXT NOT NULL DEFAULT '22:00', quiet_end TEXT NOT NULL DEFAULT '08:00',
  cooldown_minutes INTEGER NOT NULL DEFAULT 60, last_greeted_at TEXT,
  notice_version TEXT NOT NULL, consent_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  environment TEXT NOT NULL, app_env TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX person_user_scope ON people(tenant_id,workspace_id,owner_user_id,environment,app_env) WHERE status='active' AND owner_user_id IS NOT NULL;
CREATE UNIQUE INDEX person_guest_scope ON people(guest_session_id) WHERE status='active' AND guest_session_id IS NOT NULL;
CREATE TABLE memory_session_links (
  session_id TEXT PRIMARY KEY REFERENCES reception_sessions(id), person_id TEXT NOT NULL REFERENCES people(id),
  focus_version INTEGER NOT NULL, consent_at TEXT NOT NULL, transcript_expires_at TEXT NOT NULL
);
CREATE TABLE memory_facts (
  id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES people(id), tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL, fact_key TEXT NOT NULL, value TEXT NOT NULL,
  source_kind TEXT NOT NULL, source_session_id TEXT, source_message_id TEXT, source_focus_version INTEGER,
  visibility TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', version INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT NOT NULL, confirmed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX memory_facts_person ON memory_facts(person_id,status,expires_at);
CREATE TABLE memory_lookup (
  fact_id TEXT PRIMARY KEY REFERENCES memory_facts(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL, value TEXT NOT NULL
);
CREATE TABLE memory_notes (
  id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES people(id), tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, source_session_id TEXT,
  source_message_ids TEXT NOT NULL, source_focus_version INTEGER, status TEXT NOT NULL DEFAULT 'open',
  version INTEGER NOT NULL DEFAULT 1, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE privacy_requests (
  id TEXT PRIMARY KEY, person_id TEXT NOT NULL, tenant_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
  reason TEXT NOT NULL, status TEXT NOT NULL, local_completed_at TEXT NOT NULL,
  external_status TEXT NOT NULL, created_at TEXT NOT NULL
);
ALTER TABLE idempotency ADD COLUMN redacted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reception_messages ADD COLUMN memory_person_id TEXT;
ALTER TABLE reception_messages ADD COLUMN memory_fact_ids TEXT NOT NULL DEFAULT '[]';
