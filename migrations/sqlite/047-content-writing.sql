CREATE TABLE studio_content_writing_jobs (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 actor_id TEXT NOT NULL REFERENCES users(id),
 environment TEXT NOT NULL,
 app_env TEXT NOT NULL,
 request TEXT NOT NULL,
 engine TEXT NOT NULL,
 input_hash TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,
 control_version INTEGER NOT NULL DEFAULT 1,
 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','succeeded','failed','cancelled','stale')),
 progress REAL NOT NULL DEFAULT 0,
 attempts INTEGER NOT NULL DEFAULT 0,
 lease_token TEXT,
 lease_until TEXT,
 result TEXT,
 evidence TEXT,
 result_hash TEXT,
 error_code TEXT,
 error_message TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX content_writing_claim ON studio_content_writing_jobs(environment,app_env,status,created_at,id);
CREATE INDEX content_writing_space ON studio_content_writing_jobs(tenant_id,workspace_id,environment,app_env,id);
CREATE TABLE studio_content_writing_adoptions (
 job_id TEXT NOT NULL REFERENCES studio_content_writing_jobs(id),
 variant_index INTEGER NOT NULL CHECK(variant_index BETWEEN 0 AND 2),
 draft_id TEXT NOT NULL UNIQUE REFERENCES studio_content_drafts(id),
 actor_id TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL,
 PRIMARY KEY(job_id,variant_index)
);
CREATE TRIGGER content_writing_input_immutable BEFORE UPDATE OF tenant_id,workspace_id,actor_id,environment,app_env,request,engine,input_hash ON studio_content_writing_jobs BEGIN SELECT RAISE(ABORT,'Content writing input is immutable'); END;
CREATE TRIGGER content_writing_result_immutable BEFORE UPDATE OF result,evidence,result_hash ON studio_content_writing_jobs WHEN OLD.result_hash IS NOT NULL BEGIN SELECT RAISE(ABORT,'Content writing result is immutable'); END;
CREATE TRIGGER content_writing_adoption_immutable BEFORE UPDATE ON studio_content_writing_adoptions BEGIN SELECT RAISE(ABORT,'Content writing adoption is immutable'); END;
