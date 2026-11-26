ALTER TABLE live_commands ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE live_commands ADD COLUMN media_applied_at TEXT;
ALTER TABLE live_commands ADD COLUMN media_frame INTEGER;
ALTER TABLE live_recordings ADD COLUMN capture_kind TEXT NOT NULL DEFAULT 'local_timeline_reconstruction';
CREATE TABLE live_outputs (
 id TEXT PRIMARY KEY,session_id TEXT NOT NULL UNIQUE REFERENCES live_sessions(id),tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,
 snapshot TEXT NOT NULL,snapshot_hash TEXT NOT NULL,presentation TEXT NOT NULL,presentation_hash TEXT NOT NULL,presentation_version INTEGER NOT NULL DEFAULT 1,
 status TEXT NOT NULL DEFAULT 'armed',version INTEGER NOT NULL DEFAULT 1,attempts INTEGER NOT NULL DEFAULT 0,
 lease_token TEXT,lease_until TEXT,generation_id TEXT,generation INTEGER NOT NULL DEFAULT 0,
 accepted_frames INTEGER NOT NULL DEFAULT 0,encoded_frames INTEGER NOT NULL DEFAULT 0,published_frames INTEGER NOT NULL DEFAULT 0,published_duration_ms INTEGER NOT NULL DEFAULT 0,
 interruptions INTEGER NOT NULL DEFAULT 0,error_message TEXT,withdrawn_at TEXT,environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX live_output_queue ON live_outputs(environment,app_env,status,lease_until);
CREATE INDEX live_output_scope ON live_outputs(tenant_id,workspace_id,environment,app_env,id);
CREATE TRIGGER live_output_source_immutable BEFORE UPDATE OF session_id,tenant_id,workspace_id,actor_id,snapshot,snapshot_hash ON live_outputs BEGIN SELECT RAISE(ABORT,'Continuous output source is immutable'); END;
CREATE TABLE live_output_generations (
 id TEXT PRIMARY KEY,output_id TEXT NOT NULL REFERENCES live_outputs(id),number INTEGER NOT NULL,lease_token TEXT NOT NULL,work_key TEXT NOT NULL,
 start_frame INTEGER NOT NULL,accepted_frames INTEGER NOT NULL DEFAULT 0,encoded_frames INTEGER NOT NULL DEFAULT 0,published_frames INTEGER NOT NULL DEFAULT 0,
 duration_ms INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'preparing',helper_pid INTEGER,helper_entry TEXT,started_at TEXT NOT NULL,ended_at TEXT,UNIQUE(output_id,number)
);
CREATE TABLE live_output_parts (
 id TEXT PRIMARY KEY,output_id TEXT NOT NULL REFERENCES live_outputs(id),generation_id TEXT NOT NULL REFERENCES live_output_generations(id),kind TEXT NOT NULL CHECK(kind IN ('init','segment')),
 sequence INTEGER NOT NULL,duration_ms INTEGER NOT NULL,media_start_ms INTEGER NOT NULL,storage_key TEXT NOT NULL,size INTEGER NOT NULL,sha256 TEXT NOT NULL,published_at TEXT NOT NULL,
 UNIQUE(generation_id,kind,sequence)
);
CREATE TRIGGER live_output_parts_immutable BEFORE UPDATE ON live_output_parts BEGIN SELECT RAISE(ABORT,'Published continuous fragments are immutable'); END;
CREATE TABLE live_output_spans (
 id TEXT PRIMARY KEY,output_id TEXT NOT NULL REFERENCES live_outputs(id),generation_id TEXT NOT NULL REFERENCES live_output_generations(id),first_frame INTEGER NOT NULL,last_frame INTEGER NOT NULL,
 session_version INTEGER NOT NULL,epoch INTEGER NOT NULL,presentation_version INTEGER NOT NULL,frame TEXT NOT NULL,frame_hash TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(generation_id,first_frame)
);
CREATE TABLE live_output_presentations (
 output_id TEXT NOT NULL REFERENCES live_outputs(id),version INTEGER NOT NULL,presentation TEXT NOT NULL,presentation_hash TEXT NOT NULL,actor_id TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',
 generation_id TEXT,media_frame INTEGER,applied_at TEXT,created_at TEXT NOT NULL,PRIMARY KEY(output_id,version)
);
CREATE TRIGGER live_output_presentation_immutable BEFORE UPDATE OF output_id,version,presentation,presentation_hash,actor_id ON live_output_presentations BEGIN SELECT RAISE(ABORT,'Presentation source is immutable'); END;
CREATE TABLE live_output_recordings (recording_id TEXT PRIMARY KEY REFERENCES live_recordings(id),output_id TEXT NOT NULL UNIQUE REFERENCES live_outputs(id),capture_hash TEXT NOT NULL);
CREATE TABLE live_output_observations (
 output_id TEXT NOT NULL REFERENCES live_outputs(id),actor_id TEXT NOT NULL,client_id TEXT NOT NULL,generation_id TEXT NOT NULL,sequence INTEGER NOT NULL,decoded_frames INTEGER NOT NULL,position_ms INTEGER NOT NULL,status TEXT NOT NULL,observed_at TEXT NOT NULL,
 PRIMARY KEY(output_id,actor_id,client_id)
);
