-- Existing sessions remain manual. Models never grant identity or business permissions.
ALTER TABLE studio_presentation_sessions ADD COLUMN answer_mode TEXT NOT NULL DEFAULT 'human_text';
ALTER TABLE studio_presentation_sessions ADD COLUMN answer_configuration TEXT;
ALTER TABLE studio_presentation_sessions ADD COLUMN answer_generation INTEGER NOT NULL DEFAULT 1;
ALTER TABLE studio_presentation_questions ADD COLUMN answer_job_id TEXT;
CREATE TABLE studio_presentation_answer_jobs (
 id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES studio_presentation_sessions(id),question_id TEXT NOT NULL UNIQUE REFERENCES studio_presentation_questions(id),
 tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,environment TEXT NOT NULL,app_env TEXT NOT NULL,
 source_hash TEXT NOT NULL,request TEXT NOT NULL,configuration TEXT NOT NULL,input_hash TEXT NOT NULL,control_generation INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued',version INTEGER NOT NULL DEFAULT 1,attempts INTEGER NOT NULL DEFAULT 0,progress REAL NOT NULL DEFAULT 0,
 lease_token TEXT,lease_until TEXT,result TEXT,evidence TEXT,audio_key TEXT,audio_format TEXT,error_code TEXT,error_message TEXT,
 playback_version INTEGER NOT NULL DEFAULT 0,playback_state TEXT NOT NULL DEFAULT 'idle',playback_actor_id TEXT,playback_client_id TEXT,playback_started_at TEXT,playback_lease_until TEXT,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX studio_presentation_answer_queue ON studio_presentation_answer_jobs(environment,app_env,status,created_at,id);
CREATE UNIQUE INDEX studio_presentation_one_answer ON studio_presentation_answer_jobs(session_id) WHERE status IN ('queued','processing');
CREATE TRIGGER studio_presentation_answer_input_immutable BEFORE UPDATE OF session_id,question_id,tenant_id,workspace_id,actor_id,environment,app_env,source_hash,request,configuration,input_hash ON studio_presentation_answer_jobs BEGIN SELECT RAISE(ABORT,'Presentation answer input is immutable'); END;
CREATE TRIGGER studio_presentation_answer_result_immutable BEFORE UPDATE OF result,evidence,audio_key,audio_format ON studio_presentation_answer_jobs WHEN OLD.status='succeeded' BEGIN SELECT RAISE(ABORT,'Completed presentation answer is immutable'); END;
-- All 4B CPU consumers in one data directory share a lease, including cleanup after cancellation.
CREATE TABLE native_model_leases (resource TEXT PRIMARY KEY,job_kind TEXT NOT NULL,job_id TEXT NOT NULL,token TEXT NOT NULL,lease_until TEXT NOT NULL);
