CREATE TABLE studio_assistant_sessions (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,project_id TEXT NOT NULL REFERENCES studio_projects(id),
 project_version INTEGER NOT NULL,name TEXT NOT NULL,base_document TEXT NOT NULL,base_document_hash TEXT NOT NULL,source_hash TEXT NOT NULL,selected_ids TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,status TEXT NOT NULL DEFAULT 'open',current_turn_id TEXT,current_generation_id TEXT,
 applied_project_version INTEGER,applied_document_hash TEXT,environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX studio_assistant_session_scope ON studio_assistant_sessions(tenant_id,workspace_id,environment,app_env,id);
CREATE TRIGGER studio_assistant_source_immutable BEFORE UPDATE OF tenant_id,workspace_id,actor_id,project_id,project_version,base_document,base_document_hash,source_hash,selected_ids,environment,app_env ON studio_assistant_sessions BEGIN SELECT RAISE(ABORT,'Assistant source and selection are immutable'); END;
CREATE TABLE studio_assistant_turns (
 id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES studio_assistant_sessions(id),number INTEGER NOT NULL,parent_turn_id TEXT REFERENCES studio_assistant_turns(id),actor_id TEXT NOT NULL,
 provider TEXT NOT NULL,instruction TEXT NOT NULL,proposal TEXT NOT NULL,proposal_hash TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(session_id,number)
);
CREATE TRIGGER studio_assistant_turn_immutable BEFORE UPDATE ON studio_assistant_turns BEGIN SELECT RAISE(ABORT,'Assistant turns are append-only'); END;
CREATE TABLE studio_assistant_generations (
 id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES studio_assistant_sessions(id),turn_id TEXT NOT NULL REFERENCES studio_assistant_turns(id),number INTEGER NOT NULL,actor_id TEXT NOT NULL,
 plan TEXT NOT NULL,plan_hash TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',version INTEGER NOT NULL DEFAULT 1,branch_project_id TEXT REFERENCES studio_projects(id),
 branch_version INTEGER,branch_document_hash TEXT,speech_job_id TEXT REFERENCES studio_speech_jobs(id),exports TEXT NOT NULL DEFAULT '[]',error_code TEXT,error_message TEXT,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(turn_id,number)
);
CREATE INDEX studio_assistant_generation_queue ON studio_assistant_generations(status,created_at,id);
CREATE TRIGGER studio_assistant_generation_input_immutable BEFORE UPDATE OF session_id,turn_id,number,actor_id,plan,plan_hash ON studio_assistant_generations BEGIN SELECT RAISE(ABORT,'Assistant generation plans are immutable'); END;
CREATE TABLE studio_assistant_applications (
 session_id TEXT PRIMARY KEY REFERENCES studio_assistant_sessions(id),turn_id TEXT NOT NULL REFERENCES studio_assistant_turns(id),generation_id TEXT REFERENCES studio_assistant_generations(id),
 project_id TEXT NOT NULL REFERENCES studio_projects(id),before_version INTEGER NOT NULL,after_version INTEGER NOT NULL,before_hash TEXT NOT NULL,after_hash TEXT NOT NULL,
 changed_segments TEXT NOT NULL,regenerated_segments TEXT NOT NULL,voice_assets TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TRIGGER studio_assistant_application_immutable BEFORE UPDATE ON studio_assistant_applications BEGIN SELECT RAISE(ABORT,'Assistant application history is immutable'); END;
