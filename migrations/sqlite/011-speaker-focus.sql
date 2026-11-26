CREATE TABLE memory_session_links_next (
  session_id TEXT NOT NULL REFERENCES reception_sessions(id), person_id TEXT NOT NULL REFERENCES people(id),
  focus_version INTEGER NOT NULL, consent_at TEXT NOT NULL, transcript_expires_at TEXT NOT NULL,
  PRIMARY KEY(session_id,focus_version)
);
INSERT INTO memory_session_links_next SELECT * FROM memory_session_links;
DROP TABLE memory_session_links;
ALTER TABLE memory_session_links_next RENAME TO memory_session_links;
CREATE INDEX memory_links_person ON memory_session_links(person_id,session_id);
CREATE TABLE speaker_references (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
  owner_user_id TEXT, session_id TEXT REFERENCES reception_sessions(id), scope TEXT NOT NULL,
  label TEXT NOT NULL, provider_id TEXT NOT NULL, provider_reference TEXT, target_token TEXT,
  quality TEXT NOT NULL DEFAULT 'pending', status TEXT NOT NULL DEFAULT 'pending', version INTEGER NOT NULL DEFAULT 1,
  purpose TEXT NOT NULL, notice_version TEXT NOT NULL, consent_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  delete_status TEXT NOT NULL DEFAULT 'not_requested', deleted_at TEXT, created_at TEXT NOT NULL,
  environment TEXT NOT NULL, app_env TEXT NOT NULL,
  CHECK((scope='temporary' AND session_id IS NOT NULL AND owner_user_id IS NULL) OR (scope='enrolled' AND owner_user_id IS NOT NULL AND session_id IS NULL))
);
CREATE INDEX speaker_reference_owner ON speaker_references(tenant_id,workspace_id,owner_user_id,status,expires_at);
CREATE TABLE speaker_focus_sessions (
  session_id TEXT PRIMARY KEY REFERENCES reception_sessions(id), state TEXT NOT NULL,
  reference_id TEXT REFERENCES speaker_references(id), mode TEXT NOT NULL, provider_id TEXT NOT NULL,
  extraction_id TEXT NOT NULL, source_channel_id TEXT NOT NULL, focus_version INTEGER NOT NULL,
  config_version INTEGER NOT NULL, fallback TEXT NOT NULL DEFAULT 'text', last_reason TEXT NOT NULL,
  usage_target_token TEXT, quality TEXT NOT NULL DEFAULT 'pending',
  expires_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE speaker_segment_decisions (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES reception_sessions(id), focus_version INTEGER NOT NULL,
  segment_id TEXT NOT NULL, sequence INTEGER NOT NULL, fixture TEXT NOT NULL,
  attribution TEXT NOT NULL, final INTEGER NOT NULL, accepted INTEGER NOT NULL,
  interrupted INTEGER NOT NULL DEFAULT 0, reason TEXT NOT NULL, simulated INTEGER NOT NULL DEFAULT 1,
  elapsed_ms INTEGER NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(session_id,focus_version,segment_id,sequence)
);
CREATE UNIQUE INDEX speaker_segment_final ON speaker_segment_decisions(session_id,focus_version,segment_id) WHERE final=1;
CREATE TABLE speaker_use_tickets (
  id TEXT PRIMARY KEY, reference_id TEXT NOT NULL REFERENCES speaker_references(id), session_id TEXT NOT NULL REFERENCES reception_sessions(id),
  focus_version INTEGER NOT NULL, token_hash TEXT NOT NULL, expires_at TEXT NOT NULL,
  used_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE speaker_ptt_permits (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES reception_sessions(id), focus_version INTEGER NOT NULL,
  expires_at TEXT NOT NULL, consumed_at TEXT, created_at TEXT NOT NULL
);
ALTER TABLE reception_messages ADD COLUMN input_source TEXT NOT NULL DEFAULT 'typed';
ALTER TABLE reception_messages ADD COLUMN speaker_decision_id TEXT;
