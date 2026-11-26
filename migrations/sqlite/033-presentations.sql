-- Presentation plans never rewrite their source project. Live sessions bind a full actual MP4.
CREATE TABLE studio_presentation_plans (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,
 source_project_id TEXT NOT NULL REFERENCES studio_projects(id),source_project_version INTEGER NOT NULL,
 source_hash TEXT NOT NULL,name TEXT NOT NULL,definition TEXT NOT NULL,definition_hash TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX studio_presentation_plan_scope ON studio_presentation_plans(tenant_id,workspace_id,environment,app_env,id);
CREATE TABLE studio_presentation_plan_versions (
 plan_id TEXT NOT NULL REFERENCES studio_presentation_plans(id),version INTEGER NOT NULL,name TEXT NOT NULL,
 definition TEXT NOT NULL,definition_hash TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,
 PRIMARY KEY(plan_id,version)
);
CREATE TABLE studio_presentation_applications (
 plan_id TEXT NOT NULL REFERENCES studio_presentation_plans(id),plan_version INTEGER NOT NULL,
 project_id TEXT NOT NULL UNIQUE REFERENCES studio_projects(id),document_hash TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,
 PRIMARY KEY(plan_id,plan_version)
);
CREATE TABLE studio_presentation_sessions (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,
 project_id TEXT NOT NULL REFERENCES studio_projects(id),project_version INTEGER NOT NULL,source_hash TEXT NOT NULL,
 export_id TEXT NOT NULL REFERENCES studio_exports(id),artifact_id TEXT NOT NULL REFERENCES studio_export_artifacts(id),artifact_hash TEXT NOT NULL,
 name TEXT NOT NULL,chapters TEXT NOT NULL,captions TEXT NOT NULL,duration_ms INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'ready',position_ms INTEGER NOT NULL DEFAULT 0,anchor_at TEXT,
 version INTEGER NOT NULL DEFAULT 1,active_question_id TEXT,resume_state TEXT,resume_position_ms INTEGER,
 invalidated_at TEXT,invalidation_reason TEXT,environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX studio_presentation_session_scope ON studio_presentation_sessions(tenant_id,workspace_id,environment,app_env,id);
CREATE TABLE studio_presentation_questions (
 id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES studio_presentation_sessions(id),actor_id TEXT NOT NULL,
 page_id TEXT NOT NULL,position_ms INTEGER NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',
 answer TEXT,answer_by TEXT,answer_at TEXT,version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL
);
CREATE INDEX studio_presentation_question_session ON studio_presentation_questions(session_id,created_at,id);
-- Losing the host's write scope permanently stops an issued session; restoring membership does not revive it.
CREATE TRIGGER studio_presentation_host_change AFTER UPDATE ON memberships BEGIN
 UPDATE studio_presentation_sessions SET invalidated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),invalidation_reason='host_permission_changed',version=version+1
 WHERE actor_id=OLD.user_id AND invalidated_at IS NULL AND
 (tenant_id<>NEW.tenant_id OR NEW.role NOT IN ('admin','editor') OR NOT EXISTS(SELECT 1 FROM json_each(NEW.workspace_ids) WHERE value=studio_presentation_sessions.workspace_id));
END;
CREATE TRIGGER studio_presentation_host_delete AFTER DELETE ON memberships BEGIN
 UPDATE studio_presentation_sessions SET invalidated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),invalidation_reason='host_permission_changed',version=version+1
 WHERE actor_id=OLD.user_id AND invalidated_at IS NULL;
END;
CREATE TRIGGER studio_presentation_project_change AFTER UPDATE OF version,archived ON studio_projects WHEN NEW.version<>OLD.version OR NEW.archived<>OLD.archived BEGIN
 UPDATE studio_presentation_sessions SET invalidated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),invalidation_reason='project_changed',version=version+1
 WHERE project_id=OLD.id AND invalidated_at IS NULL;
END;
