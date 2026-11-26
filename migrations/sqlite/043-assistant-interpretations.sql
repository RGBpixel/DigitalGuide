CREATE TABLE studio_assistant_interpretations (
 id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES studio_assistant_sessions(id),tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,
 environment TEXT NOT NULL,app_env TEXT NOT NULL,session_version INTEGER NOT NULL,parent_turn_id TEXT REFERENCES studio_assistant_turns(id),
 request TEXT NOT NULL,context_hash TEXT NOT NULL,engine TEXT NOT NULL,input_hash TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued',version INTEGER NOT NULL DEFAULT 1,control_version INTEGER NOT NULL DEFAULT 1,attempts INTEGER NOT NULL DEFAULT 0,progress REAL NOT NULL DEFAULT 0,
 lease_token TEXT,lease_until TEXT,turn_id TEXT REFERENCES studio_assistant_turns(id),evidence TEXT,error_code TEXT,error_message TEXT,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX studio_assistant_interpretation_queue ON studio_assistant_interpretations(environment,app_env,status,created_at,id);
CREATE UNIQUE INDEX studio_assistant_one_interpretation ON studio_assistant_interpretations(session_id) WHERE status IN ('queued','processing');
CREATE UNIQUE INDEX studio_assistant_interpretation_turn ON studio_assistant_interpretations(turn_id) WHERE turn_id IS NOT NULL;
CREATE TRIGGER studio_assistant_interpretation_input_immutable BEFORE UPDATE OF session_id,tenant_id,workspace_id,actor_id,environment,app_env,session_version,parent_turn_id,request,context_hash,engine,input_hash ON studio_assistant_interpretations BEGIN SELECT RAISE(ABORT,'Assistant interpretation input is immutable'); END;
CREATE TRIGGER studio_assistant_interpretation_success_immutable BEFORE UPDATE ON studio_assistant_interpretations WHEN OLD.status='succeeded' BEGIN SELECT RAISE(ABORT,'Completed assistant interpretation is immutable'); END;
