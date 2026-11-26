CREATE TABLE live_peer_invites (
 id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES live_sessions(id),tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,
 public_title TEXT NOT NULL,expires_at TEXT NOT NULL,access_nonce TEXT NOT NULL,access_hash TEXT UNIQUE,consumed_access_hash TEXT,
 status TEXT NOT NULL DEFAULT 'issued' CHECK(status IN ('issued','used','revoked','expired','closed')),version INTEGER NOT NULL DEFAULT 1,
 reason TEXT,environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE TABLE live_peer_guests (
 id TEXT PRIMARY KEY,invite_id TEXT NOT NULL UNIQUE REFERENCES live_peer_invites(id),nickname TEXT NOT NULL DEFAULT '',cookie_hash TEXT UNIQUE,join_key_hash TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'joined' CHECK(status IN ('joined','requested','approved','rejected','withdrawn')),
 version INTEGER NOT NULL DEFAULT 1,consent_version INTEGER NOT NULL DEFAULT 0,camera INTEGER NOT NULL DEFAULT 0,microphone INTEGER NOT NULL DEFAULT 0,
 client_id TEXT,consent_expires_at TEXT,seen_at TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE TABLE live_peer_consents (
 guest_id TEXT NOT NULL REFERENCES live_peer_guests(id),version INTEGER NOT NULL,camera INTEGER NOT NULL,microphone INTEGER NOT NULL,
 statement_version TEXT NOT NULL,purpose TEXT NOT NULL CHECK(purpose='backstage_call'),client_id TEXT NOT NULL,expires_at TEXT NOT NULL,created_at TEXT NOT NULL,withdrawn_at TEXT,
 PRIMARY KEY(guest_id,version)
);
CREATE TABLE live_peer_attempts (
 id TEXT PRIMARY KEY,invite_id TEXT NOT NULL REFERENCES live_peer_invites(id),guest_id TEXT NOT NULL REFERENCES live_peer_guests(id),consent_version INTEGER NOT NULL,
 host_id TEXT NOT NULL,host_client_id TEXT NOT NULL,guest_client_id TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','ended','expired','failed')),version INTEGER NOT NULL DEFAULT 1,
 host_lease_until TEXT NOT NULL,guest_lease_until TEXT NOT NULL,host_sequence INTEGER NOT NULL DEFAULT 0,guest_sequence INTEGER NOT NULL DEFAULT 0,
 host_connection TEXT NOT NULL DEFAULT 'new',guest_connection TEXT NOT NULL DEFAULT 'new',host_received_bytes INTEGER NOT NULL DEFAULT 0,guest_received_bytes INTEGER NOT NULL DEFAULT 0,
 host_decoded_frames INTEGER NOT NULL DEFAULT 0,guest_decoded_frames INTEGER NOT NULL DEFAULT 0,host_program_version INTEGER NOT NULL DEFAULT 0,host_program_ready INTEGER NOT NULL DEFAULT 0,reason TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 FOREIGN KEY(guest_id,consent_version) REFERENCES live_peer_consents(guest_id,version)
);
CREATE TABLE live_peer_signals (
 attempt_id TEXT NOT NULL REFERENCES live_peer_attempts(id),direction TEXT NOT NULL CHECK(direction IN ('host','guest')),sequence INTEGER NOT NULL,
 payload TEXT NOT NULL,payload_hash TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(attempt_id,direction,sequence)
);
CREATE TABLE live_peer_limits (key TEXT PRIMARY KEY,window_at TEXT NOT NULL,count INTEGER NOT NULL);
CREATE UNIQUE INDEX live_peer_one_active ON live_peer_attempts(guest_id) WHERE status='active';
CREATE INDEX live_peer_invite_scope ON live_peer_invites(tenant_id,workspace_id,environment,app_env,session_id,id);
CREATE INDEX live_peer_attempt_lifecycle ON live_peer_attempts(status,host_lease_until,guest_lease_until);
CREATE TRIGGER live_peer_invite_identity BEFORE UPDATE OF id,session_id,tenant_id,workspace_id,actor_id,public_title,expires_at,environment,app_env,created_at ON live_peer_invites BEGIN SELECT RAISE(ABORT,'Live peer invitation input is immutable'); END;
CREATE TRIGGER live_peer_invite_final BEFORE UPDATE ON live_peer_invites WHEN OLD.status IN ('revoked','expired','closed') AND (NEW.status!=OLD.status OR NEW.access_hash IS NOT NULL OR NEW.consumed_access_hash IS NOT NULL) BEGIN SELECT RAISE(ABORT,'Live peer invitation closure is final'); END;
CREATE TRIGGER live_peer_guest_final BEFORE UPDATE ON live_peer_guests WHEN OLD.status='withdrawn' AND (NEW.status!='withdrawn' OR NEW.cookie_hash IS NOT NULL OR NEW.camera!=0 OR NEW.microphone!=0) BEGIN SELECT RAISE(ABORT,'Live peer withdrawal is final'); END;
CREATE TRIGGER live_peer_consent_immutable BEFORE UPDATE OF guest_id,version,camera,microphone,statement_version,purpose,client_id,expires_at,created_at ON live_peer_consents BEGIN SELECT RAISE(ABORT,'Live peer consent is immutable'); END;
CREATE TRIGGER live_peer_attempt_identity BEFORE UPDATE OF id,invite_id,guest_id,consent_version,host_id,host_client_id,guest_client_id,created_at ON live_peer_attempts BEGIN SELECT RAISE(ABORT,'Live peer attempt identity is immutable'); END;
CREATE TRIGGER live_peer_attempt_final BEFORE UPDATE ON live_peer_attempts WHEN OLD.status!='active' AND NEW.status='active' BEGIN SELECT RAISE(ABORT,'Live peer attempt cannot restart'); END;
CREATE TRIGGER live_peer_signal_immutable BEFORE UPDATE ON live_peer_signals BEGIN SELECT RAISE(ABORT,'Live peer signals are immutable'); END;
CREATE TRIGGER live_peer_session_stop AFTER UPDATE OF status ON live_sessions WHEN NEW.status IN ('ended','failed') BEGIN
 UPDATE live_peer_invites SET status='closed',access_hash=NULL,consumed_access_hash=NULL,reason='节目已经结束',version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE session_id=NEW.id AND status IN ('issued','used');
END;
CREATE TRIGGER live_peer_output_withdraw AFTER UPDATE OF status ON live_outputs WHEN NEW.status IN ('withdrawn','cancelled') BEGIN
 UPDATE live_peer_invites SET status='closed',access_hash=NULL,consumed_access_hash=NULL,reason='连续节目媒体已撤回或取消',version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE session_id=NEW.session_id AND status IN ('issued','used');
END;
CREATE TRIGGER live_peer_invite_cleanup AFTER UPDATE OF status ON live_peer_invites WHEN NEW.status IN ('revoked','expired','closed') AND OLD.status NOT IN ('revoked','expired','closed') BEGIN
 UPDATE live_peer_guests SET nickname='已结束来宾',status='withdrawn',cookie_hash=NULL,camera=0,microphone=0,client_id=NULL,version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE invite_id=NEW.id AND status!='withdrawn';
 UPDATE live_peer_consents SET withdrawn_at=COALESCE(withdrawn_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE guest_id IN (SELECT id FROM live_peer_guests WHERE invite_id=NEW.id);
 UPDATE live_peer_attempts SET status='ended',version=version+1,reason=NEW.reason,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE invite_id=NEW.id AND status='active';
 DELETE FROM live_peer_signals WHERE attempt_id IN (SELECT id FROM live_peer_attempts WHERE invite_id=NEW.id);
END;
CREATE TRIGGER live_peer_member_change AFTER UPDATE OF role,workspace_ids,tenant_id ON memberships WHEN NEW.role!=OLD.role OR NEW.workspace_ids!=OLD.workspace_ids OR NEW.tenant_id!=OLD.tenant_id BEGIN
 UPDATE live_peer_invites SET status='revoked',access_hash=NULL,consumed_access_hash=NULL,reason='邀请人的组织或权限已经变化',version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE actor_id=OLD.user_id AND status IN ('issued','used');
 UPDATE live_peer_attempts SET status='ended',version=version+1,reason='主持人的组织或权限已经变化',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE host_id=OLD.user_id AND status='active';
 DELETE FROM live_peer_signals WHERE attempt_id IN (SELECT id FROM live_peer_attempts WHERE host_id=OLD.user_id AND status!='active');
END;
CREATE TRIGGER live_peer_member_delete AFTER DELETE ON memberships BEGIN
 UPDATE live_peer_invites SET status='revoked',access_hash=NULL,consumed_access_hash=NULL,reason='邀请人已经离开组织',version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE actor_id=OLD.user_id AND status IN ('issued','used');
 UPDATE live_peer_attempts SET status='ended',version=version+1,reason='主持人已经离开组织',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE host_id=OLD.user_id AND status='active';
 DELETE FROM live_peer_signals WHERE attempt_id IN (SELECT id FROM live_peer_attempts WHERE host_id=OLD.user_id AND status!='active');
END;
