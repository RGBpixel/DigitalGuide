CREATE TABLE conversation_tool_requests (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES reception_sessions(id),
  reply_id TEXT NOT NULL REFERENCES reception_messages(id), app_id TEXT NOT NULL REFERENCES scene_apps(id),
  tool_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'proposed',
  focus_version INTEGER NOT NULL, reply_epoch INTEGER NOT NULL, expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL, confirmed_at TEXT
);
CREATE INDEX conversation_tools_session ON conversation_tool_requests(session_id,status,expires_at);
