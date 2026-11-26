CREATE TABLE live_guest_programme_grants (
 id TEXT PRIMARY KEY,invite_id TEXT NOT NULL REFERENCES live_peer_invites(id),peer_attempt_id TEXT NOT NULL REFERENCES live_peer_attempts(id),guest_id TEXT NOT NULL REFERENCES live_peer_guests(id),
 session_id TEXT NOT NULL REFERENCES live_sessions(id),output_id TEXT NOT NULL REFERENCES live_outputs(id),tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','consented','rejected','withdrawn','expired')),version INTEGER NOT NULL DEFAULT 1,
 available_camera INTEGER NOT NULL,available_microphone INTEGER NOT NULL,recording_required INTEGER NOT NULL,recording_allowed INTEGER NOT NULL DEFAULT 0,
 camera INTEGER NOT NULL DEFAULT 0,microphone INTEGER NOT NULL DEFAULT 0,public_name TEXT NOT NULL DEFAULT '',client_id TEXT,statement_version TEXT,consent_hash TEXT,consented_at TEXT,
 expires_at TEXT NOT NULL,cookie_nonce TEXT NOT NULL,cookie_hash TEXT,withdrawn_at TEXT,environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE TABLE live_guest_programme_connections (
 id TEXT PRIMARY KEY,grant_id TEXT NOT NULL UNIQUE REFERENCES live_guest_programme_grants(id),peer_attempt_id TEXT NOT NULL REFERENCES live_peer_attempts(id),output_id TEXT NOT NULL REFERENCES live_outputs(id),
 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','connecting','connected','ended','failed','expired')),version INTEGER NOT NULL DEFAULT 1,
 mix_state TEXT NOT NULL DEFAULT 'preview' CHECK(mix_state IN ('preview','on_air','off_air')),audio_muted INTEGER NOT NULL DEFAULT 0,video_hidden INTEGER NOT NULL DEFAULT 0,
 guest_lease_until TEXT NOT NULL,guest_sequence INTEGER NOT NULL DEFAULT 0,generation_id TEXT REFERENCES live_output_generations(id),runtime_token TEXT,
 server_offer TEXT,server_offer_hash TEXT,guest_answer TEXT,guest_answer_hash TEXT,rtp_audio INTEGER NOT NULL DEFAULT 0,rtp_video INTEGER NOT NULL DEFAULT 0,decoded_frames INTEGER NOT NULL DEFAULT 0,decoded_pcm_bytes INTEGER NOT NULL DEFAULT 0,
 video_ready INTEGER NOT NULL DEFAULT 0,audio_ready INTEGER NOT NULL DEFAULT 0,media_at TEXT,reason TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE TABLE live_guest_programme_controls (
 id TEXT PRIMARY KEY,connection_id TEXT NOT NULL REFERENCES live_guest_programme_connections(id),output_id TEXT NOT NULL REFERENCES live_outputs(id),version INTEGER NOT NULL,session_version INTEGER NOT NULL,
 action TEXT NOT NULL,actor_id TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied','superseded')),requested_at TEXT NOT NULL,applied_at TEXT,media_frame INTEGER,
 UNIQUE(connection_id,version)
);
CREATE INDEX live_guest_programme_scope ON live_guest_programme_grants(tenant_id,workspace_id,environment,app_env,output_id,status);
CREATE UNIQUE INDEX live_guest_programme_one_peer ON live_guest_programme_connections(peer_attempt_id) WHERE status IN ('queued','connecting','connected');
CREATE INDEX live_guest_programme_runtime ON live_guest_programme_connections(output_id,status,guest_lease_until);
CREATE TRIGGER live_guest_programme_identity BEFORE UPDATE OF id,invite_id,peer_attempt_id,guest_id,session_id,output_id,tenant_id,workspace_id,actor_id,available_camera,available_microphone,recording_required,expires_at,cookie_nonce,environment,app_env,created_at ON live_guest_programme_grants BEGIN SELECT RAISE(ABORT,'Programme invitation identity is immutable'); END;
CREATE TRIGGER live_guest_programme_consent BEFORE UPDATE OF camera,microphone,public_name,client_id,statement_version,consent_hash,consented_at,recording_allowed ON live_guest_programme_grants WHEN OLD.status!='requested' BEGIN SELECT RAISE(ABORT,'Programme consent is immutable'); END;
CREATE TRIGGER live_guest_programme_final BEFORE UPDATE ON live_guest_programme_grants WHEN OLD.status IN ('rejected','withdrawn','expired') AND (NEW.status!=OLD.status OR NEW.cookie_hash IS NOT NULL) BEGIN SELECT RAISE(ABORT,'Programme withdrawal is final'); END;
CREATE TRIGGER live_guest_programme_connection_identity BEFORE UPDATE OF id,grant_id,peer_attempt_id,output_id,created_at ON live_guest_programme_connections BEGIN SELECT RAISE(ABORT,'Programme connection identity is immutable'); END;
CREATE TRIGGER live_guest_programme_runtime_identity BEFORE UPDATE OF generation_id,runtime_token ON live_guest_programme_connections WHEN OLD.generation_id IS NOT NULL AND (NEW.generation_id IS NOT OLD.generation_id OR NEW.runtime_token IS NOT OLD.runtime_token) BEGIN SELECT RAISE(ABORT,'Programme runtime cannot be rebound'); END;
CREATE TRIGGER live_guest_programme_connection_final BEFORE UPDATE ON live_guest_programme_connections WHEN OLD.status IN ('ended','failed','expired') AND (NEW.status!=OLD.status OR NEW.mix_state!='off_air' OR NEW.server_offer IS NOT NULL OR NEW.guest_answer IS NOT NULL) BEGIN SELECT RAISE(ABORT,'Programme connection cannot restart'); END;
CREATE TRIGGER live_guest_programme_grant_cleanup AFTER UPDATE OF status ON live_guest_programme_grants WHEN NEW.status IN ('rejected','withdrawn','expired') AND OLD.status NOT IN ('rejected','withdrawn','expired') BEGIN
 UPDATE live_guest_programme_grants SET cookie_hash=NULL,withdrawn_at=COALESCE(withdrawn_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id=NEW.id;
 UPDATE live_guest_programme_connections SET status='ended',mix_state='off_air',version=version+1,server_offer=NULL,server_offer_hash=NULL,guest_answer=NULL,guest_answer_hash=NULL,video_ready=0,audio_ready=0,reason='节目及录制用途已撤回或到期',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE grant_id=NEW.id AND status IN ('queued','connecting','connected');
END;
CREATE TRIGGER live_guest_programme_peer_end AFTER UPDATE OF status ON live_peer_attempts WHEN NEW.status!='active' BEGIN
 UPDATE live_guest_programme_connections SET status='ended',mix_state='off_air',version=version+1,server_offer=NULL,server_offer_hash=NULL,guest_answer=NULL,guest_answer_hash=NULL,video_ready=0,audio_ready=0,reason='后台设备连接已结束，节目设备也已停止',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE peer_attempt_id=NEW.id AND status IN ('queued','connecting','connected');
END;
-- A normal programme end stops devices, but does not revoke the separately
-- agreed recording purpose. Its independent privacy cookie remains usable.
CREATE TRIGGER live_guest_programme_invite_close AFTER UPDATE OF status ON live_peer_invites WHEN NEW.status IN ('revoked','expired','closed') AND NOT (NEW.status='closed' AND EXISTS(SELECT 1 FROM live_sessions s WHERE s.id=NEW.session_id AND s.status='ended')) BEGIN
 UPDATE live_guest_programme_grants SET status=CASE WHEN NEW.status='expired' THEN 'expired' ELSE 'withdrawn' END,version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE invite_id=NEW.id AND status IN ('requested','consented');
END;
CREATE TRIGGER live_guest_programme_generation_change AFTER UPDATE OF generation_id ON live_outputs WHEN OLD.generation_id IS NOT NULL AND NEW.generation_id!=OLD.generation_id BEGIN
 UPDATE live_guest_programme_connections SET status='ended',mix_state='off_air',version=version+1,server_offer=NULL,server_offer_hash=NULL,guest_answer=NULL,guest_answer_hash=NULL,video_ready=0,audio_ready=0,reason='节目编码代次已变化，需要新的主动授权',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE output_id=NEW.id AND status IN ('queued','connecting','connected');
END;
CREATE TRIGGER live_guest_programme_mix_change AFTER UPDATE OF mix_state,audio_muted,video_hidden ON live_guest_programme_connections WHEN NEW.mix_state!=OLD.mix_state OR NEW.audio_muted!=OLD.audio_muted OR NEW.video_hidden!=OLD.video_hidden BEGIN
 UPDATE live_sessions SET version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=(SELECT session_id FROM live_outputs WHERE id=NEW.output_id) AND status IN ('live','preview');
END;

CREATE TRIGGER live_guest_programme_control_identity BEFORE UPDATE OF id,connection_id,output_id,version,session_version,action,actor_id,requested_at ON live_guest_programme_controls BEGIN SELECT RAISE(ABORT,'Programme control input is immutable'); END;
