CREATE TABLE ad_accounts (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,name TEXT NOT NULL,
 platform TEXT NOT NULL,mode TEXT NOT NULL CHECK(mode='mock'),currency TEXT NOT NULL,timezone TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,enabled INTEGER NOT NULL DEFAULT 1,environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX ad_account_scope ON ad_accounts(tenant_id,workspace_id,environment,app_env,id);
CREATE TRIGGER ad_account_identity_immutable BEFORE UPDATE OF tenant_id,workspace_id,platform,mode,currency,timezone,environment,app_env ON ad_accounts BEGIN SELECT RAISE(ABORT,'Advertising account identity is immutable'); END;
CREATE TABLE ad_access_grants (
 tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,permissions TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,granted_by TEXT NOT NULL,
 environment TEXT NOT NULL,app_env TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(tenant_id,workspace_id,actor_id,environment,app_env)
);
CREATE TABLE ad_budget_policies (
 account_id TEXT PRIMARY KEY REFERENCES ad_accounts(id),definition TEXT NOT NULL,definition_hash TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,actor_id TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE TABLE ad_budget_policy_versions (
 account_id TEXT NOT NULL REFERENCES ad_accounts(id),version INTEGER NOT NULL,definition TEXT NOT NULL,definition_hash TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(account_id,version)
);
CREATE TRIGGER ad_policy_history_immutable BEFORE UPDATE ON ad_budget_policy_versions BEGIN SELECT RAISE(ABORT,'Advertising budget history is immutable'); END;
CREATE TABLE ad_campaigns (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,last_editor_id TEXT NOT NULL,account_id TEXT NOT NULL REFERENCES ad_accounts(id),
 name TEXT NOT NULL,definition TEXT NOT NULL,definition_hash TEXT NOT NULL,definition_version INTEGER NOT NULL DEFAULT 1,version INTEGER NOT NULL DEFAULT 1,
 status TEXT NOT NULL DEFAULT 'draft',current_run_id TEXT,environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX ad_campaign_scope ON ad_campaigns(tenant_id,workspace_id,environment,app_env,id);
CREATE TRIGGER ad_campaign_account_immutable BEFORE UPDATE OF tenant_id,workspace_id,actor_id,account_id,environment,app_env ON ad_campaigns BEGIN SELECT RAISE(ABORT,'Advertising campaign account and scope are immutable'); END;
CREATE TABLE ad_campaign_versions (
 campaign_id TEXT NOT NULL REFERENCES ad_campaigns(id),version INTEGER NOT NULL,name TEXT NOT NULL,definition TEXT NOT NULL,definition_hash TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(campaign_id,version)
);
CREATE TRIGGER ad_campaign_history_immutable BEFORE UPDATE ON ad_campaign_versions BEGIN SELECT RAISE(ABORT,'Advertising plan history is immutable'); END;
CREATE TABLE ad_campaign_reviews (
 id TEXT PRIMARY KEY,campaign_id TEXT NOT NULL REFERENCES ad_campaigns(id),definition_version INTEGER NOT NULL,requester_id TEXT NOT NULL,reviewer_id TEXT NOT NULL,
 snapshot TEXT NOT NULL,snapshot_hash TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',version INTEGER NOT NULL DEFAULT 1,note TEXT NOT NULL DEFAULT '',
 invalidated_at TEXT,invalidation_reason TEXT,decision_at TEXT,created_at TEXT NOT NULL
);
CREATE TRIGGER ad_approval_scope_immutable BEFORE UPDATE OF campaign_id,definition_version,requester_id,reviewer_id,snapshot,snapshot_hash ON ad_campaign_reviews BEGIN SELECT RAISE(ABORT,'Advertising approval scope is immutable'); END;
CREATE TABLE ad_runs (
 id TEXT PRIMARY KEY,campaign_id TEXT NOT NULL REFERENCES ad_campaigns(id),generation INTEGER NOT NULL,definition_version INTEGER NOT NULL,review_id TEXT NOT NULL REFERENCES ad_campaign_reviews(id),actor_id TEXT NOT NULL,
 snapshot TEXT NOT NULL,snapshot_hash TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'scheduled',version INTEGER NOT NULL DEFAULT 1,
 remote_id TEXT,platform_review TEXT NOT NULL DEFAULT 'not_submitted',reason TEXT,scheduled_at TEXT NOT NULL,started_at TEXT,stopped_at TEXT,next_delivery_at TEXT,sequence INTEGER NOT NULL DEFAULT 0,complete_intent INTEGER NOT NULL DEFAULT 0,
 lease_token TEXT,lease_until TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(campaign_id,generation)
);
CREATE INDEX ad_run_queue ON ad_runs(status,scheduled_at,lease_until);
CREATE TRIGGER ad_run_snapshot_immutable BEFORE UPDATE OF campaign_id,generation,definition_version,review_id,actor_id,snapshot,snapshot_hash ON ad_runs BEGIN SELECT RAISE(ABORT,'Advertising execution snapshot is immutable'); END;
CREATE TABLE ad_operations (
 id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES ad_runs(id),action TEXT NOT NULL CHECK(action IN ('activate','pause')),status TEXT NOT NULL DEFAULT 'queued',
 input TEXT NOT NULL,input_hash TEXT NOT NULL,lease_token TEXT,lease_until TEXT,attempts INTEGER NOT NULL DEFAULT 0,error_message TEXT,requested_at TEXT NOT NULL,confirmed_at TEXT,UNIQUE(run_id,action)
);
CREATE TRIGGER ad_operation_input_immutable BEFORE UPDATE OF run_id,action,input,input_hash ON ad_operations BEGIN SELECT RAISE(ABORT,'Advertising operation input is immutable'); END;
CREATE TABLE ad_budget_reservations (
 run_id TEXT PRIMARY KEY REFERENCES ad_runs(id),account_id TEXT NOT NULL REFERENCES ad_accounts(id),campaign_id TEXT NOT NULL REFERENCES ad_campaigns(id),reserved_minor INTEGER NOT NULL CHECK(reserved_minor>=0),updated_at TEXT NOT NULL
);
CREATE INDEX ad_account_reservations ON ad_budget_reservations(account_id,campaign_id);
CREATE TABLE mock_ad_remote_runs (
 run_id TEXT PRIMARY KEY REFERENCES ad_runs(id),remote_id TEXT NOT NULL UNIQUE,snapshot_hash TEXT NOT NULL,status TEXT NOT NULL,platform_review TEXT NOT NULL,
 pause_effective_at TEXT,activated_at TEXT,updated_at TEXT NOT NULL
);
CREATE TABLE mock_ad_operation_results (
 operation_id TEXT PRIMARY KEY REFERENCES ad_operations(id),input_hash TEXT NOT NULL,receipt TEXT NOT NULL,receipt_hash TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TRIGGER mock_ad_operation_result_immutable BEFORE UPDATE ON mock_ad_operation_results BEGIN SELECT RAISE(ABORT,'Simulated advertising receipts are immutable'); END;
CREATE TABLE mock_ad_deliveries (
 id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES ad_runs(id),sequence INTEGER NOT NULL,group_id TEXT NOT NULL,creative_id TEXT NOT NULL,
 cost_minor INTEGER NOT NULL CHECK(cost_minor>0),budget_day TEXT NOT NULL,event_time TEXT NOT NULL,UNIQUE(run_id,sequence)
);
CREATE TRIGGER mock_ad_delivery_immutable BEFORE UPDATE ON mock_ad_deliveries BEGIN SELECT RAISE(ABORT,'Simulated delivered advertising is immutable'); END;
CREATE TABLE mock_ad_reports (
 event_id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES ad_accounts(id),run_id TEXT NOT NULL REFERENCES ad_runs(id),delivery_id TEXT NOT NULL REFERENCES mock_ad_deliveries(id),kind TEXT NOT NULL,
 original_event_id TEXT,payload TEXT NOT NULL,payload_hash TEXT NOT NULL,available_at TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE INDEX mock_ad_due_reports ON mock_ad_reports(available_at,event_id);
CREATE TRIGGER mock_ad_report_immutable BEFORE UPDATE ON mock_ad_reports BEGIN SELECT RAISE(ABORT,'Simulated provider reports are immutable'); END;
CREATE TABLE ad_callback_events (
 event_id TEXT PRIMARY KEY REFERENCES mock_ad_reports(event_id),run_id TEXT NOT NULL REFERENCES ad_runs(id),payload_hash TEXT NOT NULL,status TEXT NOT NULL,first_fetched_at TEXT NOT NULL,applied_at TEXT
);
CREATE TRIGGER ad_callback_source_immutable BEFORE UPDATE OF event_id,run_id,payload_hash,first_fetched_at ON ad_callback_events BEGIN SELECT RAISE(ABORT,'Advertising event source is immutable'); END;
CREATE TABLE ad_spend_ledger (
 id TEXT PRIMARY KEY,event_id TEXT NOT NULL UNIQUE REFERENCES mock_ad_reports(event_id),account_id TEXT NOT NULL REFERENCES ad_accounts(id),campaign_id TEXT NOT NULL REFERENCES ad_campaigns(id),run_id TEXT NOT NULL REFERENCES ad_runs(id),
 group_id TEXT NOT NULL,creative_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('charge','credit')),amount_minor INTEGER NOT NULL,currency TEXT NOT NULL,budget_day TEXT NOT NULL,event_time TEXT NOT NULL,fetched_at TEXT NOT NULL,original_entry_id TEXT REFERENCES ad_spend_ledger(id),entry_hash TEXT NOT NULL
);
CREATE INDEX ad_ledger_account_day ON ad_spend_ledger(account_id,budget_day);
CREATE TRIGGER ad_ledger_immutable BEFORE UPDATE ON ad_spend_ledger BEGIN SELECT RAISE(ABORT,'Advertising spend ledger is append-only'); END;
CREATE TABLE ad_campaign_metrics (
 event_id TEXT PRIMARY KEY REFERENCES mock_ad_reports(event_id),campaign_id TEXT NOT NULL REFERENCES ad_campaigns(id),run_id TEXT NOT NULL REFERENCES ad_runs(id),group_id TEXT NOT NULL,creative_id TEXT NOT NULL,kind TEXT NOT NULL,
 event_time TEXT NOT NULL,fetched_at TEXT NOT NULL,amount_minor INTEGER NOT NULL,impressions INTEGER NOT NULL,clicks INTEGER NOT NULL,conversions INTEGER NOT NULL,attributed_conversions INTEGER NOT NULL,unattributed_conversions INTEGER NOT NULL,conversion_value_minor INTEGER NOT NULL,attribution_window_hours TEXT NOT NULL
);
CREATE TRIGGER ad_metrics_immutable BEFORE UPDATE ON ad_campaign_metrics BEGIN SELECT RAISE(ABORT,'Advertising metric events are append-only'); END;
CREATE TABLE ad_alerts (
 id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES ad_accounts(id),campaign_id TEXT REFERENCES ad_campaigns(id),kind TEXT NOT NULL,day TEXT NOT NULL,message TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open',version INTEGER NOT NULL DEFAULT 1,acknowledged_by TEXT,created_at TEXT NOT NULL,UNIQUE(account_id,campaign_id,kind,day)
);
CREATE UNIQUE INDEX ad_alert_identity ON ad_alerts(account_id,COALESCE(campaign_id,''),kind,day);
CREATE TABLE ad_reconciliations (
 id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES ad_accounts(id),actor_id TEXT NOT NULL,snapshot TEXT NOT NULL,snapshot_hash TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TRIGGER ad_reconciliation_immutable BEFORE UPDATE ON ad_reconciliations BEGIN SELECT RAISE(ABORT,'Advertising reconciliation records are immutable'); END;

CREATE TABLE ad_credit_requests (event_id TEXT PRIMARY KEY REFERENCES mock_ad_reports(event_id),actor_id TEXT NOT NULL,note TEXT NOT NULL,created_at TEXT NOT NULL);
