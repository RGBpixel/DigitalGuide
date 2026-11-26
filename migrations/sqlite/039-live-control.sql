CREATE TABLE live_programs (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,
 name TEXT NOT NULL,definition TEXT NOT NULL,definition_hash TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,
 environment TEXT NOT NULL,app_env TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX live_program_scope ON live_programs(tenant_id,workspace_id,environment,app_env,id);
CREATE TABLE live_program_versions (
 program_id TEXT NOT NULL REFERENCES live_programs(id),version INTEGER NOT NULL,name TEXT NOT NULL,
 definition TEXT NOT NULL,definition_hash TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(program_id,version)
);
CREATE TRIGGER live_program_history_immutable BEFORE UPDATE ON live_program_versions BEGIN SELECT RAISE(ABORT,'Live program history is immutable'); END;
CREATE TABLE live_sessions (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,
 program_id TEXT NOT NULL REFERENCES live_programs(id),program_version INTEGER NOT NULL,name TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('preview','broadcast_simulation')),status TEXT NOT NULL CHECK(status IN ('ready','scheduled','preview','live','ended','failed')),
 snapshot TEXT NOT NULL,snapshot_hash TEXT NOT NULL,state TEXT NOT NULL,state_hash TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,scheduled_at TEXT,started_at TEXT,ended_at TEXT,error_message TEXT,
 environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX live_session_scope ON live_sessions(tenant_id,workspace_id,environment,app_env,id);
CREATE INDEX live_session_running ON live_sessions(environment,app_env,status,scheduled_at);
CREATE TRIGGER live_session_source_immutable BEFORE UPDATE OF tenant_id,workspace_id,actor_id,program_id,program_version,kind,snapshot,snapshot_hash ON live_sessions BEGIN SELECT RAISE(ABORT,'Live session source is immutable'); END;
CREATE TABLE live_destinations (
 id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES live_sessions(id),definition_id TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'idle',version INTEGER NOT NULL DEFAULT 1,attempts INTEGER NOT NULL DEFAULT 0,
 operation_id TEXT,remote_id TEXT,heartbeat_at TEXT,error_message TEXT,updated_at TEXT NOT NULL,UNIQUE(session_id,definition_id)
);
CREATE TABLE live_segments (
 session_id TEXT NOT NULL REFERENCES live_sessions(id),seq INTEGER NOT NULL,segment TEXT NOT NULL,segment_hash TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(session_id,seq)
);
CREATE TRIGGER live_segments_immutable BEFORE UPDATE ON live_segments BEGIN SELECT RAISE(ABORT,'Live playout segments are immutable'); END;
CREATE TABLE live_commands (
 id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES live_sessions(id),actor_id TEXT NOT NULL,action TEXT NOT NULL,
 epoch INTEGER NOT NULL,requested_at TEXT NOT NULL,simulator_applied_at TEXT,status TEXT NOT NULL DEFAULT 'pending'
);
CREATE TABLE live_audience_events (
 id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES live_sessions(id),destination_id TEXT NOT NULL REFERENCES live_destinations(id),
 event_id TEXT NOT NULL,input_hash TEXT NOT NULL,participant_hash TEXT NOT NULL,nickname TEXT NOT NULL,kind TEXT NOT NULL,text TEXT NOT NULL,media_opt_in TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'received',priority INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 1,
 answer TEXT,answer_kind TEXT,citations TEXT NOT NULL DEFAULT '[]',product_id TEXT,prepared_epoch INTEGER,created_at TEXT NOT NULL,
 UNIQUE(session_id,destination_id,event_id)
);
CREATE INDEX live_audience_rate ON live_audience_events(session_id,participant_hash,created_at);
CREATE TRIGGER live_audience_input_immutable BEFORE UPDATE OF session_id,destination_id,event_id,input_hash,participant_hash,nickname,kind,text,media_opt_in ON live_audience_events BEGIN SELECT RAISE(ABORT,'Live audience input is immutable'); END;
CREATE TRIGGER live_answer_immutable BEFORE UPDATE OF answer,answer_kind,citations,product_id,prepared_epoch ON live_audience_events WHEN OLD.answer IS NOT NULL BEGIN SELECT RAISE(ABORT,'Prepared live answer is immutable'); END;
CREATE TABLE live_observations (
 session_id TEXT NOT NULL REFERENCES live_sessions(id),actor_id TEXT NOT NULL,epoch INTEGER NOT NULL,status TEXT NOT NULL,observed_at TEXT NOT NULL,PRIMARY KEY(session_id,actor_id)
);
CREATE TABLE live_recordings (
 id TEXT PRIMARY KEY,session_id TEXT NOT NULL UNIQUE REFERENCES live_sessions(id),tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,
 snapshot TEXT NOT NULL,snapshot_hash TEXT NOT NULL,source_guard TEXT NOT NULL,source_guard_hash TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued',version INTEGER NOT NULL DEFAULT 1,attempts INTEGER NOT NULL DEFAULT 0,
 lease_token TEXT,lease_until TEXT,asset_id TEXT,storage_key TEXT,size INTEGER,sha256 TEXT,error_message TEXT,withdrawn_at TEXT,
 environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX live_recording_queue ON live_recordings(environment,app_env,status,lease_until);
CREATE TRIGGER live_recording_source_immutable BEFORE UPDATE OF session_id,tenant_id,workspace_id,actor_id,snapshot,snapshot_hash,source_guard,source_guard_hash ON live_recordings BEGIN SELECT RAISE(ABORT,'Live recording source is immutable'); END;
CREATE TABLE live_recording_origins (asset_id TEXT PRIMARY KEY REFERENCES assets(id),recording_id TEXT NOT NULL REFERENCES live_recordings(id));
CREATE TABLE live_recording_clips (id TEXT PRIMARY KEY,recording_id TEXT NOT NULL REFERENCES live_recordings(id),project_id TEXT NOT NULL REFERENCES studio_projects(id),actor_id TEXT NOT NULL,start_ms INTEGER NOT NULL,duration_ms INTEGER NOT NULL,created_at TEXT NOT NULL);
