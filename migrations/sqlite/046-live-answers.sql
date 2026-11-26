-- Local model answers are opt-in and never change the JSON/default mode of an old scene.
CREATE TABLE live_answer_configurations (
 session_id TEXT PRIMARY KEY REFERENCES live_sessions(id),tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,environment TEXT NOT NULL,app_env TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 0,auto_draft INTEGER NOT NULL DEFAULT 0,language TEXT NOT NULL,engine TEXT,generation INTEGER NOT NULL DEFAULT 1,version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE TABLE live_answer_jobs (
 id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES live_sessions(id),question_id TEXT NOT NULL REFERENCES live_audience_events(id),tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,
 environment TEXT NOT NULL,app_env TEXT NOT NULL,session_hash TEXT NOT NULL,request TEXT NOT NULL,configuration TEXT NOT NULL,controller_version INTEGER NOT NULL,question_version INTEGER NOT NULL,configuration_generation INTEGER NOT NULL,input_hash TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued',version INTEGER NOT NULL DEFAULT 1,control_version INTEGER NOT NULL DEFAULT 1,attempts INTEGER NOT NULL DEFAULT 0,progress REAL NOT NULL DEFAULT 0,lease_token TEXT,lease_until TEXT,
 result TEXT,evidence TEXT,result_hash TEXT,withdrawn_at TEXT,error_code TEXT,error_message TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 UNIQUE(question_id,configuration_generation,controller_version,question_version)
);
CREATE INDEX live_answer_queue ON live_answer_jobs(environment,app_env,status,created_at,id);
CREATE INDEX live_answer_session ON live_answer_jobs(session_id,created_at,id);
CREATE TABLE live_answer_origins (
 question_id TEXT PRIMARY KEY REFERENCES live_audience_events(id),job_id TEXT NOT NULL UNIQUE REFERENCES live_answer_jobs(id),accepted_by TEXT NOT NULL,accepted_at TEXT NOT NULL
);
CREATE TRIGGER live_answer_input_immutable BEFORE UPDATE OF session_id,question_id,tenant_id,workspace_id,actor_id,environment,app_env,session_hash,request,configuration,controller_version,question_version,configuration_generation,input_hash ON live_answer_jobs BEGIN SELECT RAISE(ABORT,'Live model answer input is immutable'); END;
CREATE TRIGGER live_answer_result_immutable BEFORE UPDATE OF result,evidence,result_hash ON live_answer_jobs WHEN OLD.result_hash IS NOT NULL BEGIN SELECT RAISE(ABORT,'Live model answer result is immutable'); END;
CREATE TRIGGER live_answer_origin_immutable BEFORE UPDATE ON live_answer_origins BEGIN SELECT RAISE(ABORT,'Live model answer origin is immutable'); END;
CREATE TRIGGER live_answer_origin_preserve BEFORE DELETE ON live_answer_origins BEGIN SELECT RAISE(ABORT,'Live model answer origin cannot be deleted'); END;
