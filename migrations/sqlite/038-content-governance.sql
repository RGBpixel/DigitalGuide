CREATE TABLE content_governance_policies (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,platform TEXT NOT NULL,
 name TEXT NOT NULL,definition TEXT NOT NULL,definition_hash TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,enabled INTEGER NOT NULL DEFAULT 1,
 environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 UNIQUE(tenant_id,workspace_id,platform,environment,app_env)
);
CREATE TABLE content_governance_policy_versions (
 policy_id TEXT NOT NULL REFERENCES content_governance_policies(id),version INTEGER NOT NULL,name TEXT NOT NULL,
 definition TEXT NOT NULL,definition_hash TEXT NOT NULL,enabled INTEGER NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(policy_id,version)
);
CREATE TABLE content_governance_deliveries (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,variant_id TEXT NOT NULL,variant_version INTEGER NOT NULL,
 platform TEXT NOT NULL,policy_id TEXT NOT NULL REFERENCES content_governance_policies(id),policy_version INTEGER NOT NULL,policy_hash TEXT NOT NULL,
 source_hash TEXT NOT NULL,source_snapshot TEXT NOT NULL,input TEXT NOT NULL,plan TEXT NOT NULL,plan_hash TEXT NOT NULL,public_id TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL DEFAULT 'queued',version INTEGER NOT NULL DEFAULT 1,attempts INTEGER NOT NULL DEFAULT 0,progress INTEGER NOT NULL DEFAULT 0,
 lease_token TEXT,lease_until TEXT,error_message TEXT,environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX content_governance_scope ON content_governance_deliveries(tenant_id,workspace_id,environment,app_env,id);
CREATE INDEX content_governance_variant ON content_governance_deliveries(variant_id,created_at);
CREATE TABLE content_governance_artifacts (
 id TEXT PRIMARY KEY,delivery_id TEXT NOT NULL REFERENCES content_governance_deliveries(id),kind TEXT NOT NULL CHECK(kind IN ('video','cover')),
 name TEXT NOT NULL,media_type TEXT NOT NULL,storage_key TEXT NOT NULL,size INTEGER NOT NULL,sha256 TEXT NOT NULL,UNIQUE(delivery_id,kind)
);
CREATE TABLE content_governance_reviews (
 id TEXT PRIMARY KEY,delivery_id TEXT NOT NULL REFERENCES content_governance_deliveries(id),requester_id TEXT NOT NULL,reviewer_id TEXT NOT NULL,
 snapshot_hash TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',version INTEGER NOT NULL DEFAULT 1,note TEXT NOT NULL DEFAULT '',acknowledged_issues TEXT NOT NULL DEFAULT '[]',
 decision_at TEXT,invalidated_at TEXT,invalidation_reason TEXT,created_at TEXT NOT NULL
);
CREATE TABLE content_governance_receipts (
 delivery_id TEXT NOT NULL REFERENCES content_governance_deliveries(id),review_id TEXT NOT NULL REFERENCES content_governance_reviews(id),
 receipt TEXT NOT NULL,receipt_hash TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(delivery_id,review_id)
);
CREATE TRIGGER content_governance_policy_history_immutable BEFORE UPDATE ON content_governance_policy_versions BEGIN SELECT RAISE(ABORT,'Fixed policy history'); END;
CREATE TRIGGER content_governance_delivery_source_immutable BEFORE UPDATE OF tenant_id,workspace_id,actor_id,variant_id,variant_version,platform,policy_id,policy_version,policy_hash,source_hash,source_snapshot,input,plan,plan_hash,public_id,environment,app_env,created_at ON content_governance_deliveries BEGIN SELECT RAISE(ABORT,'Fixed governance intake'); END;
CREATE TRIGGER content_governance_membership_updated AFTER UPDATE ON memberships
 WHEN OLD.tenant_id<>NEW.tenant_id OR OLD.role<>NEW.role OR OLD.workspace_ids<>NEW.workspace_ids
 BEGIN UPDATE content_governance_reviews SET invalidated_at=COALESCE(invalidated_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')),invalidation_reason='审核或提交成员的角色/空间已变化，请重新核对并提交。',version=version+1 WHERE (reviewer_id=OLD.user_id OR requester_id=OLD.user_id) AND invalidated_at IS NULL AND status IN ('pending','approved'); END;
CREATE TRIGGER content_governance_membership_deleted AFTER DELETE ON memberships
 BEGIN UPDATE content_governance_reviews SET invalidated_at=COALESCE(invalidated_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')),invalidation_reason='审核或提交成员已离开，请重新指定。',version=version+1 WHERE (reviewer_id=OLD.user_id OR requester_id=OLD.user_id) AND invalidated_at IS NULL AND status IN ('pending','approved'); END;
