-- Immutable course releases and learner-owned, durable attempts. No camera or identity enrolment.
CREATE TABLE studio_courses (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,
 name TEXT NOT NULL,definition TEXT NOT NULL,definition_hash TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,
 environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX studio_course_scope ON studio_courses(tenant_id,workspace_id,environment,app_env,id);
CREATE TABLE studio_course_versions (
 course_id TEXT NOT NULL REFERENCES studio_courses(id),version INTEGER NOT NULL,name TEXT NOT NULL,
 definition TEXT NOT NULL,definition_hash TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,
 PRIMARY KEY(course_id,version)
);
CREATE TABLE studio_course_releases (
 id TEXT PRIMARY KEY,course_id TEXT NOT NULL REFERENCES studio_courses(id),tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,course_version INTEGER NOT NULL,name TEXT NOT NULL,snapshot TEXT NOT NULL,release_hash TEXT NOT NULL,
 withdrawn_at TEXT,environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,
 UNIQUE(course_id,course_version)
);
CREATE INDEX studio_course_release_scope ON studio_course_releases(tenant_id,workspace_id,environment,app_env,id);
CREATE TRIGGER studio_course_release_immutable BEFORE UPDATE OF snapshot,release_hash,course_id,course_version,tenant_id,workspace_id,name,environment,app_env ON studio_course_releases BEGIN SELECT RAISE(ABORT,'course release is immutable'); END;
CREATE TRIGGER studio_course_release_withdrawn BEFORE UPDATE OF withdrawn_at ON studio_course_releases WHEN OLD.withdrawn_at IS NOT NULL BEGIN SELECT RAISE(ABORT,'course withdrawal is permanent'); END;
CREATE TABLE course_enrollments (
 id TEXT PRIMARY KEY,release_id TEXT NOT NULL REFERENCES studio_course_releases(id),tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,assigned_by TEXT NOT NULL,revoked_at TEXT,revocation_reason TEXT,
 environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX course_active_enrollment ON course_enrollments(release_id,actor_id) WHERE revoked_at IS NULL;
CREATE INDEX course_learner_scope ON course_enrollments(tenant_id,workspace_id,environment,app_env,actor_id,id);
CREATE TRIGGER course_enrollment_revoked BEFORE UPDATE OF revoked_at ON course_enrollments WHEN OLD.revoked_at IS NOT NULL BEGIN SELECT RAISE(ABORT,'course enrolment revocation is permanent'); END;
CREATE TRIGGER course_learner_membership_update AFTER UPDATE ON memberships BEGIN
 UPDATE course_enrollments SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),revocation_reason='membership_scope_changed'
 WHERE actor_id=OLD.user_id AND revoked_at IS NULL AND
 (tenant_id<>NEW.tenant_id OR NOT EXISTS(SELECT 1 FROM json_each(NEW.workspace_ids) WHERE value=course_enrollments.workspace_id));
END;
CREATE TRIGGER course_learner_membership_delete AFTER DELETE ON memberships BEGIN
 UPDATE course_enrollments SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),revocation_reason='membership_removed' WHERE actor_id=OLD.user_id AND revoked_at IS NULL;
END;
CREATE TABLE learning_attempts (
 id TEXT PRIMARY KEY,enrollment_id TEXT NOT NULL REFERENCES course_enrollments(id),release_id TEXT NOT NULL REFERENCES studio_course_releases(id),
 tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,release_hash TEXT NOT NULL,
 state TEXT NOT NULL,state_hash TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,event_count INTEGER NOT NULL DEFAULT 0,
 completed INTEGER NOT NULL DEFAULT 0,earned INTEGER NOT NULL DEFAULT 0,possible INTEGER NOT NULL DEFAULT 0,percent REAL NOT NULL DEFAULT 0,passed INTEGER,
 environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX learning_active_attempt ON learning_attempts(enrollment_id) WHERE completed=0;
CREATE INDEX learning_attempt_scope ON learning_attempts(tenant_id,workspace_id,environment,app_env,actor_id,id);
CREATE TABLE learning_events (
 attempt_id TEXT NOT NULL REFERENCES learning_attempts(id),sequence INTEGER NOT NULL,node_id TEXT NOT NULL,
 kind TEXT NOT NULL,payload TEXT NOT NULL,payload_hash TEXT NOT NULL,state_hash TEXT NOT NULL,created_at TEXT NOT NULL,
 PRIMARY KEY(attempt_id,sequence)
);
CREATE TABLE studio_course_exports (
 id TEXT PRIMARY KEY,release_id TEXT NOT NULL REFERENCES studio_course_releases(id),tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,standard TEXT NOT NULL,plan_hash TEXT NOT NULL,release_hash TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued',progress INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,
 lease_token TEXT,lease_until TEXT,storage_key TEXT,size INTEGER,sha256 TEXT,error_message TEXT,
 environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX studio_course_export_queue ON studio_course_exports(environment,app_env,status,created_at,id);
