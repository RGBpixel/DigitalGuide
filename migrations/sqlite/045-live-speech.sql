-- Optional speech plans do not opt any existing output or JSON snapshot into narration.
CREATE TABLE live_speech_plans (
 id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES live_sessions(id),tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,
 environment TEXT NOT NULL,app_env TEXT NOT NULL,session_hash TEXT NOT NULL,voice TEXT NOT NULL,cues TEXT NOT NULL,input_hash TEXT NOT NULL,result_hash TEXT,
 status TEXT NOT NULL DEFAULT 'building',version INTEGER NOT NULL DEFAULT 1,withdrawn_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX live_speech_plan_scope ON live_speech_plans(session_id,created_at,id);
CREATE TABLE live_speech_jobs (
 id TEXT PRIMARY KEY,plan_id TEXT NOT NULL REFERENCES live_speech_plans(id),session_id TEXT NOT NULL REFERENCES live_sessions(id),tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,
 environment TEXT NOT NULL,app_env TEXT NOT NULL,source TEXT NOT NULL,input_hash TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued',version INTEGER NOT NULL DEFAULT 1,control_version INTEGER NOT NULL DEFAULT 1,attempts INTEGER NOT NULL DEFAULT 0,progress REAL NOT NULL DEFAULT 0,
 lease_token TEXT,lease_until TEXT,wav_key TEXT,wav_format TEXT,pcm_key TEXT,pcm_format TEXT,withdrawn_at TEXT,error_code TEXT,error_message TEXT,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX live_speech_job_queue ON live_speech_jobs(environment,app_env,status,created_at,id);
CREATE INDEX live_speech_job_plan ON live_speech_jobs(plan_id,created_at,id);
CREATE UNIQUE INDEX live_speech_cue_once ON live_speech_jobs(plan_id,json_extract(source,'$.cueId')) WHERE json_extract(source,'$.kind')='cue';
CREATE TABLE live_speech_playbacks (
 session_id TEXT PRIMARY KEY REFERENCES live_sessions(id),job_id TEXT NOT NULL REFERENCES live_speech_jobs(id),kind TEXT NOT NULL,epoch INTEGER NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,position_frames INTEGER NOT NULL DEFAULT 0,program_cue_index INTEGER NOT NULL,program_offset_ms INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'active',started_at TEXT NOT NULL,ended_at TEXT
);
CREATE TRIGGER live_speech_plan_input_immutable BEFORE UPDATE OF session_id,tenant_id,workspace_id,actor_id,environment,app_env,session_hash,voice,cues,input_hash ON live_speech_plans BEGIN SELECT RAISE(ABORT,'Live speech plan input is immutable'); END;
CREATE TRIGGER live_speech_plan_result_immutable BEFORE UPDATE OF result_hash ON live_speech_plans WHEN OLD.result_hash IS NOT NULL BEGIN SELECT RAISE(ABORT,'Live speech plan result is immutable'); END;
CREATE TRIGGER live_speech_job_input_immutable BEFORE UPDATE OF plan_id,session_id,tenant_id,workspace_id,actor_id,environment,app_env,source,input_hash ON live_speech_jobs BEGIN SELECT RAISE(ABORT,'Live speech job input is immutable'); END;
CREATE TRIGGER live_speech_job_result_immutable BEFORE UPDATE OF wav_key,wav_format,pcm_key,pcm_format ON live_speech_jobs WHEN OLD.status='succeeded' BEGIN SELECT RAISE(ABORT,'Live speech audio result is immutable'); END;
