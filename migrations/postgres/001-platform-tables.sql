-- DigitalGuide PostgreSQL baseline, SQLite source through 052.
-- Independently versioned native SQL; apply only through the offline staging importer.

CREATE TABLE "ad_access_grants" (
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "permissions" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "granted_by" text COLLATE "C" NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("tenant_id","workspace_id","actor_id","environment","app_env")
);

CREATE TABLE "ad_accounts" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "platform" text COLLATE "C" NOT NULL,
  "mode" text COLLATE "C" NOT NULL,
  "currency" text COLLATE "C" NOT NULL,
  "timezone" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "enabled" bigint DEFAULT 1 NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  CHECK (mode='mock')
);

CREATE TABLE "ad_alerts" (
  "id" text COLLATE "C" NOT NULL,
  "account_id" text COLLATE "C" NOT NULL,
  "campaign_id" text COLLATE "C",
  "kind" text COLLATE "C" NOT NULL,
  "day" text COLLATE "C" NOT NULL,
  "message" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'open' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "acknowledged_by" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("account_id","campaign_id","kind","day")
);

CREATE TABLE "ad_budget_policies" (
  "account_id" text COLLATE "C" NOT NULL,
  "definition" text COLLATE "C" NOT NULL,
  "definition_hash" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("account_id")
);

CREATE TABLE "ad_budget_policy_versions" (
  "account_id" text COLLATE "C" NOT NULL,
  "version" bigint NOT NULL,
  "definition" text COLLATE "C" NOT NULL,
  "definition_hash" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("account_id","version")
);

CREATE TABLE "ad_budget_reservations" (
  "run_id" text COLLATE "C" NOT NULL,
  "account_id" text COLLATE "C" NOT NULL,
  "campaign_id" text COLLATE "C" NOT NULL,
  "reserved_minor" bigint NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("run_id"),
  CHECK (reserved_minor>=0)
);

CREATE TABLE "ad_callback_events" (
  "event_id" text COLLATE "C" NOT NULL,
  "run_id" text COLLATE "C" NOT NULL,
  "payload_hash" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" NOT NULL,
  "first_fetched_at" text COLLATE "C" NOT NULL,
  "applied_at" text COLLATE "C",
  PRIMARY KEY ("event_id")
);

CREATE TABLE "ad_campaign_metrics" (
  "event_id" text COLLATE "C" NOT NULL,
  "campaign_id" text COLLATE "C" NOT NULL,
  "run_id" text COLLATE "C" NOT NULL,
  "group_id" text COLLATE "C" NOT NULL,
  "creative_id" text COLLATE "C" NOT NULL,
  "kind" text COLLATE "C" NOT NULL,
  "event_time" text COLLATE "C" NOT NULL,
  "fetched_at" text COLLATE "C" NOT NULL,
  "amount_minor" bigint NOT NULL,
  "impressions" bigint NOT NULL,
  "clicks" bigint NOT NULL,
  "conversions" bigint NOT NULL,
  "attributed_conversions" bigint NOT NULL,
  "unattributed_conversions" bigint NOT NULL,
  "conversion_value_minor" bigint NOT NULL,
  "attribution_window_hours" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("event_id")
);

CREATE TABLE "ad_campaign_reviews" (
  "id" text COLLATE "C" NOT NULL,
  "campaign_id" text COLLATE "C" NOT NULL,
  "definition_version" bigint NOT NULL,
  "requester_id" text COLLATE "C" NOT NULL,
  "reviewer_id" text COLLATE "C" NOT NULL,
  "snapshot" text COLLATE "C" NOT NULL,
  "snapshot_hash" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'pending' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "note" text COLLATE "C" DEFAULT '' NOT NULL,
  "invalidated_at" text COLLATE "C",
  "invalidation_reason" text COLLATE "C",
  "decision_at" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "ad_campaign_versions" (
  "campaign_id" text COLLATE "C" NOT NULL,
  "version" bigint NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "definition" text COLLATE "C" NOT NULL,
  "definition_hash" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("campaign_id","version")
);

CREATE TABLE "ad_campaigns" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "last_editor_id" text COLLATE "C" NOT NULL,
  "account_id" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "definition" text COLLATE "C" NOT NULL,
  "definition_hash" text COLLATE "C" NOT NULL,
  "definition_version" bigint DEFAULT 1 NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "status" text COLLATE "C" DEFAULT 'draft' NOT NULL,
  "current_run_id" text COLLATE "C",
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "ad_credit_requests" (
  "event_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "note" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("event_id")
);

CREATE TABLE "ad_operations" (
  "id" text COLLATE "C" NOT NULL,
  "run_id" text COLLATE "C" NOT NULL,
  "action" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'queued' NOT NULL,
  "input" text COLLATE "C" NOT NULL,
  "input_hash" text COLLATE "C" NOT NULL,
  "lease_token" text COLLATE "C",
  "lease_until" text COLLATE "C",
  "attempts" bigint DEFAULT 0 NOT NULL,
  "error_message" text COLLATE "C",
  "requested_at" text COLLATE "C" NOT NULL,
  "confirmed_at" text COLLATE "C",
  PRIMARY KEY ("id"),
  UNIQUE ("run_id","action"),
  CHECK (action IN ('activate','pause'))
);

CREATE TABLE "ad_reconciliations" (
  "id" text COLLATE "C" NOT NULL,
  "account_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "snapshot" text COLLATE "C" NOT NULL,
  "snapshot_hash" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "ad_runs" (
  "id" text COLLATE "C" NOT NULL,
  "campaign_id" text COLLATE "C" NOT NULL,
  "generation" bigint NOT NULL,
  "definition_version" bigint NOT NULL,
  "review_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "snapshot" text COLLATE "C" NOT NULL,
  "snapshot_hash" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'scheduled' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "remote_id" text COLLATE "C",
  "platform_review" text COLLATE "C" DEFAULT 'not_submitted' NOT NULL,
  "reason" text COLLATE "C",
  "scheduled_at" text COLLATE "C" NOT NULL,
  "started_at" text COLLATE "C",
  "stopped_at" text COLLATE "C",
  "next_delivery_at" text COLLATE "C",
  "sequence" bigint DEFAULT 0 NOT NULL,
  "complete_intent" bigint DEFAULT 0 NOT NULL,
  "lease_token" text COLLATE "C",
  "lease_until" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("campaign_id","generation")
);

CREATE TABLE "ad_spend_ledger" (
  "id" text COLLATE "C" NOT NULL,
  "event_id" text COLLATE "C" NOT NULL,
  "account_id" text COLLATE "C" NOT NULL,
  "campaign_id" text COLLATE "C" NOT NULL,
  "run_id" text COLLATE "C" NOT NULL,
  "group_id" text COLLATE "C" NOT NULL,
  "creative_id" text COLLATE "C" NOT NULL,
  "kind" text COLLATE "C" NOT NULL,
  "amount_minor" bigint NOT NULL,
  "currency" text COLLATE "C" NOT NULL,
  "budget_day" text COLLATE "C" NOT NULL,
  "event_time" text COLLATE "C" NOT NULL,
  "fetched_at" text COLLATE "C" NOT NULL,
  "original_entry_id" text COLLATE "C",
  "entry_hash" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("event_id"),
  CHECK (kind IN ('charge','credit'))
);

CREATE TABLE "ae_batches" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "template_id" text COLLATE "C" NOT NULL,
  "template_version" bigint NOT NULL,
  "catalog_id" text COLLATE "C" NOT NULL,
  "catalog_revision" bigint NOT NULL,
  "manifest" text COLLATE "C" NOT NULL,
  "manifest_sha256" text COLLATE "C" NOT NULL,
  "runtime_id" text COLLATE "C" NOT NULL,
  "mode" text COLLATE "C" NOT NULL,
  "kind" text COLLATE "C" NOT NULL,
  "input_format" text COLLATE "C" NOT NULL,
  "input_content" text COLLATE "C" NOT NULL,
  "plan_hash" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'running' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "ae_media_adoptions" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "artifact_id" text COLLATE "C" NOT NULL,
  "batch_id" text COLLATE "C" NOT NULL,
  "job_id" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "rights_note" text COLLATE "C" NOT NULL,
  "expires_at" text COLLATE "C" NOT NULL,
  "snapshot" text COLLATE "C" NOT NULL,
  "snapshot_hash" text COLLATE "C" NOT NULL,
  "plan_hash" text COLLATE "C" NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'queued' NOT NULL,
  "stage" text COLLATE "C" DEFAULT 'queued' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "control_version" bigint DEFAULT 1 NOT NULL,
  "progress" bigint DEFAULT 0 NOT NULL,
  "attempts" bigint DEFAULT 0 NOT NULL,
  "lease_token" text COLLATE "C",
  "lease_until" text COLLATE "C",
  "asset_id" text COLLATE "C",
  "project_id" text COLLATE "C",
  "inspection_runtime" text COLLATE "C",
  "error_code" text COLLATE "C",
  "error_message" text COLLATE "C",
  "withdrawn_at" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("project_id"),
  UNIQUE ("asset_id"),
  UNIQUE ("artifact_id"),
  CHECK (status IN ('queued','processing','succeeded','failed','cancelled','withdrawn')),
  CHECK (stage IN ('queued','copying','inspecting','committing','finished')),
  CHECK (progress BETWEEN 0 AND 100),
  CHECK (attempts BETWEEN 0 AND 3),
  CHECK (status!='succeeded' OR (asset_id IS NOT NULL AND project_id IS NOT NULL))
);

CREATE TABLE "ae_media_attempts" (
  "adoption_id" text COLLATE "C" NOT NULL,
  "attempt" bigint NOT NULL,
  "status" text COLLATE "C" NOT NULL,
  "error_code" text COLLATE "C",
  "error_message" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  "finished_at" text COLLATE "C",
  PRIMARY KEY ("adoption_id","attempt")
);

CREATE TABLE "ae_render_artifacts" (
  "id" text COLLATE "C" NOT NULL,
  "job_id" text COLLATE "C" NOT NULL,
  "kind" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "media_type" text COLLATE "C" NOT NULL,
  "storage_key" text COLLATE "C" NOT NULL,
  "size" bigint NOT NULL,
  "sha256" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "ae_render_attempts" (
  "job_id" text COLLATE "C" NOT NULL,
  "attempt" bigint NOT NULL,
  "status" text COLLATE "C" NOT NULL,
  "parameters" text COLLATE "C" NOT NULL,
  "error_message" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  "finished_at" text COLLATE "C",
  "actor_id" text COLLATE "C",
  PRIMARY KEY ("job_id","attempt")
);

CREATE TABLE "ae_render_jobs" (
  "id" text COLLATE "C" NOT NULL,
  "batch_id" text COLLATE "C" NOT NULL,
  "position" bigint NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "parameters" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C",
  "source_hash" text COLLATE "C",
  "status" text COLLATE "C" NOT NULL,
  "stage" text COLLATE "C" DEFAULT 'queued' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "attempts" bigint DEFAULT 0 NOT NULL,
  "lease_token" text COLLATE "C",
  "lease_until" text COLLATE "C",
  "error_code" text COLLATE "C",
  "error_message" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("batch_id","position")
);

CREATE TABLE "ae_source_attempts" (
  "job_id" text COLLATE "C" NOT NULL,
  "attempt" bigint NOT NULL,
  "status" text COLLATE "C" NOT NULL,
  "error_code" text COLLATE "C",
  "error_message" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  "finished_at" text COLLATE "C",
  PRIMARY KEY ("job_id","attempt")
);

CREATE TABLE "ae_source_exports" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "template_id" text COLLATE "C" NOT NULL,
  "template_version" bigint NOT NULL,
  "catalog_id" text COLLATE "C" NOT NULL,
  "catalog_revision" bigint NOT NULL,
  "manifest" text COLLATE "C" NOT NULL,
  "manifest_file" text COLLATE "C" NOT NULL,
  "manifest_sha256" text COLLATE "C" NOT NULL,
  "manifest_size" bigint NOT NULL,
  "mode" text COLLATE "C" NOT NULL,
  "plan_hash" text COLLATE "C" NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'queued' NOT NULL,
  "stage" text COLLATE "C" DEFAULT 'queued' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "control_version" bigint DEFAULT 1 NOT NULL,
  "progress" bigint DEFAULT 0 NOT NULL,
  "attempts" bigint DEFAULT 0 NOT NULL,
  "lease_token" text COLLATE "C",
  "lease_until" text COLLATE "C",
  "storage_key" text COLLATE "C",
  "size" bigint,
  "sha256" text COLLATE "C",
  "error_code" text COLLATE "C",
  "error_message" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  CHECK (mode IN ('local_aerender','contract_test')),
  CHECK (status IN ('queued','processing','succeeded','failed','cancelled','withdrawn')),
  CHECK (stage IN ('queued','preparing','packing','verifying','finished')),
  CHECK (progress BETWEEN 0 AND 100),
  CHECK (attempts BETWEEN 0 AND 3),
  CHECK (status!='succeeded' OR (storage_key IS NOT NULL AND size>0 AND sha256 IS NOT NULL))
);

CREATE TABLE "ae_template_versions" (
  "template_id" text COLLATE "C" NOT NULL,
  "version" bigint NOT NULL,
  "catalog_revision" bigint NOT NULL,
  "manifest_sha256" text COLLATE "C" NOT NULL,
  "manifest" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("template_id","version")
);

CREATE TABLE "ae_templates" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "catalog_id" text COLLATE "C" NOT NULL,
  "catalog_revision" bigint NOT NULL,
  "manifest_sha256" text COLLATE "C" NOT NULL,
  "manifest" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("tenant_id","workspace_id","environment","app_env","catalog_id")
);

CREATE TABLE "alpha_video_frames" (
  "asset_id" text COLLATE "C" NOT NULL,
  "asset_version" bigint NOT NULL,
  "frame_number" bigint NOT NULL,
  "storage_key" text COLLATE "C" NOT NULL,
  "sha256" text COLLATE "C" NOT NULL,
  "size" bigint NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("asset_id","asset_version","frame_number")
);

CREATE TABLE "alpha_video_previews" (
  "asset_id" text COLLATE "C" NOT NULL,
  "storage_key" text COLLATE "C" NOT NULL,
  "sha256" text COLLATE "C" NOT NULL,
  "size" bigint NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("asset_id")
);

CREATE TABLE "asset_collection_links" (
  "id" text COLLATE "C" NOT NULL,
  "collection_id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "title" text COLLATE "C" NOT NULL,
  "nonce" text COLLATE "C" NOT NULL,
  "token_hash" text COLLATE "C" NOT NULL,
  "expires_at" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "revoked_at" text COLLATE "C",
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("token_hash")
);

CREATE TABLE "asset_collection_origins" (
  "asset_id" text COLLATE "C" NOT NULL,
  "receipt_id" text COLLATE "C" NOT NULL,
  "collection_id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "accepted_by" text COLLATE "C" NOT NULL,
  "rights_note" text COLLATE "C" NOT NULL,
  "rights_expires_at" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "revoked_at" text COLLATE "C",
  "revoke_note" text COLLATE "C",
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "accepted_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("asset_id"),
  UNIQUE ("receipt_id")
);

CREATE TABLE "asset_collection_parts" (
  "receipt_id" text COLLATE "C" NOT NULL,
  "part_index" bigint NOT NULL,
  "size" bigint NOT NULL,
  "sha256" text COLLATE "C" NOT NULL,
  "storage_key" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("receipt_id","part_index"),
  UNIQUE ("storage_key")
);

CREATE TABLE "asset_collection_receipts" (
  "id" text COLLATE "C" NOT NULL,
  "collection_id" text COLLATE "C" NOT NULL,
  "session_id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "client_file_id" text COLLATE "C" NOT NULL,
  "request_hash" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "file_name" text COLLATE "C" NOT NULL,
  "media_type" text COLLATE "C" NOT NULL,
  "size" bigint NOT NULL,
  "part_hashes" text COLLATE "C" NOT NULL,
  "fingerprint" text COLLATE "C" NOT NULL,
  "expected_sha256" text COLLATE "C",
  "sha256" text COLLATE "C",
  "declared_rights" text COLLATE "C" NOT NULL,
  "declared_expires_at" text COLLATE "C" NOT NULL,
  "declared_synthetic" bigint NOT NULL,
  "status" text COLLATE "C" DEFAULT 'uploading' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "progress" double precision DEFAULT 0 NOT NULL,
  "attempts" bigint DEFAULT 0 NOT NULL,
  "lease_token" text COLLATE "C",
  "lease_until" text COLLATE "C",
  "result" text COLLATE "C",
  "result_hash" text COLLATE "C",
  "error_code" text COLLATE "C",
  "error_message" text COLLATE "C",
  "decision_note" text COLLATE "C",
  "upload_deadline" text COLLATE "C" NOT NULL,
  "retention_until" text COLLATE "C" NOT NULL,
  "submitted_at" text COLLATE "C",
  "decided_at" text COLLATE "C",
  "asset_id" text COLLATE "C",
  "chunks_cleaned_at" text COLLATE "C",
  "quarantine_cleaned_at" text COLLATE "C",
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("session_id","client_file_id")
);

CREATE TABLE "asset_collection_requests" (
  "scope" text COLLATE "C" NOT NULL,
  "scope_group" text COLLATE "C" NOT NULL,
  "key_hash" text COLLATE "C" NOT NULL,
  "request_hash" text COLLATE "C" NOT NULL,
  "result_id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("scope","key_hash","environment","app_env")
);

CREATE TABLE "asset_collection_sessions" (
  "id" text COLLATE "C" NOT NULL,
  "link_id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "nonce" text COLLATE "C" NOT NULL,
  "token_hash" text COLLATE "C" NOT NULL,
  "csrf_token" text COLLATE "C" NOT NULL,
  "display_name" text COLLATE "C" NOT NULL,
  "expires_at" text COLLATE "C" NOT NULL,
  "revoked_at" text COLLATE "C",
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("token_hash")
);

CREATE TABLE "asset_collections" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "instructions" text COLLATE "C" NOT NULL,
  "folder_id" text COLLATE "C",
  "allowed_types" text COLLATE "C" NOT NULL,
  "max_files" bigint NOT NULL,
  "total_bytes" bigint NOT NULL,
  "closes_at" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "closed_at" text COLLATE "C",
  "close_reason" text COLLATE "C",
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "asset_library_consent_revocations" (
  "consent_id" text COLLATE "C" NOT NULL,
  "asset_id" text COLLATE "C" NOT NULL,
  "asset_version" bigint NOT NULL,
  "reason" text COLLATE "C" NOT NULL,
  "revoked_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("consent_id")
);

CREATE TABLE "asset_library_events" (
  "sequence" bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  "id" text COLLATE "C" NOT NULL,
  "family_id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "action" text COLLATE "C" NOT NULL,
  "details" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("sequence"),
  UNIQUE ("id")
);

CREATE TABLE "asset_library_families" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "name_key" text COLLATE "C" NOT NULL,
  "folder_id" text COLLATE "C",
  "tags" text COLLATE "C" DEFAULT '[]' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "merged_into" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "asset_library_folders" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "parent_id" text COLLATE "C",
  "name" text COLLATE "C" NOT NULL,
  "name_key" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "archived" bigint DEFAULT 0 NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "asset_library_revisions" (
  "asset_id" text COLLATE "C" NOT NULL,
  "family_id" text COLLATE "C" NOT NULL,
  "ordinal" bigint NOT NULL,
  "upload_id" text COLLATE "C" NOT NULL,
  "sha256" text COLLATE "C" NOT NULL,
  "size" bigint NOT NULL,
  "media_type" text COLLATE "C" NOT NULL,
  "note" text COLLATE "C" DEFAULT '' NOT NULL,
  "actor_id" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("asset_id"),
  UNIQUE ("family_id","ordinal")
);

CREATE TABLE "asset_versions" (
  "asset_id" text COLLATE "C" NOT NULL,
  "version" bigint NOT NULL,
  "snapshot" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("asset_id","version")
);

CREATE TABLE "assets" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "upload_id" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "category" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "archived" bigint DEFAULT 0 NOT NULL,
  "synthetic" bigint DEFAULT 0 NOT NULL,
  "expires_at" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("upload_id")
);

CREATE TABLE "audit_events" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "action" text COLLATE "C" NOT NULL,
  "resource_id" text COLLATE "C" NOT NULL,
  "outcome" text COLLATE "C" NOT NULL,
  "request_id" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "auth_sessions" (
  "token_hash" text COLLATE "C" NOT NULL,
  "user_id" text COLLATE "C" NOT NULL,
  "csrf_token" text COLLATE "C" NOT NULL,
  "expires_at" text COLLATE "C" NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("token_hash")
);

CREATE TABLE "character_derivations" (
  "asset_id" text COLLATE "C" NOT NULL,
  "character_id" text COLLATE "C" NOT NULL,
  "source_asset_id" text COLLATE "C" NOT NULL,
  "source_version" bigint NOT NULL,
  "consent_id" text COLLATE "C" NOT NULL,
  "voice_asset_id" text COLLATE "C",
  "voice_version" bigint,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("asset_id")
);

CREATE TABLE "character_jobs" (
  "id" text COLLATE "C" NOT NULL,
  "character_id" text COLLATE "C" NOT NULL,
  "character_version" bigint NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "operation" text COLLATE "C" NOT NULL,
  "project_id" text COLLATE "C",
  "project_version" bigint,
  "input_snapshot" text COLLATE "C" NOT NULL,
  "input_hash" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'queued' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "attempts" bigint DEFAULT 0 NOT NULL,
  "lease_token" text COLLATE "C",
  "lease_until" text COLLATE "C",
  "error_code" text COLLATE "C",
  "error_message" text COLLATE "C",
  "outputs" text COLLATE "C" DEFAULT '[]' NOT NULL,
  "result" text COLLATE "C",
  "applied_project_version" bigint,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "character_motion_plans" (
  "id" text COLLATE "C" NOT NULL,
  "character_id" text COLLATE "C" NOT NULL,
  "project_id" text COLLATE "C" NOT NULL,
  "payload" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "character_motion_versions" (
  "plan_id" text COLLATE "C" NOT NULL,
  "version" bigint NOT NULL,
  "payload" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("plan_id","version")
);

CREATE TABLE "consents" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "asset_id" text COLLATE "C" NOT NULL,
  "purpose" text COLLATE "C" NOT NULL,
  "subject" text COLLATE "C" NOT NULL,
  "proof" text COLLATE "C" NOT NULL,
  "notice_version" text COLLATE "C" NOT NULL,
  "expires_at" text COLLATE "C" NOT NULL,
  "revoked_at" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "content_governance_artifacts" (
  "id" text COLLATE "C" NOT NULL,
  "delivery_id" text COLLATE "C" NOT NULL,
  "kind" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "media_type" text COLLATE "C" NOT NULL,
  "storage_key" text COLLATE "C" NOT NULL,
  "size" bigint NOT NULL,
  "sha256" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("delivery_id","kind"),
  CHECK (kind IN ('video','cover'))
);

CREATE TABLE "content_governance_deliveries" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "variant_id" text COLLATE "C" NOT NULL,
  "variant_version" bigint NOT NULL,
  "platform" text COLLATE "C" NOT NULL,
  "policy_id" text COLLATE "C" NOT NULL,
  "policy_version" bigint NOT NULL,
  "policy_hash" text COLLATE "C" NOT NULL,
  "source_hash" text COLLATE "C" NOT NULL,
  "source_snapshot" text COLLATE "C" NOT NULL,
  "input" text COLLATE "C" NOT NULL,
  "plan" text COLLATE "C" NOT NULL,
  "plan_hash" text COLLATE "C" NOT NULL,
  "public_id" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'queued' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "attempts" bigint DEFAULT 0 NOT NULL,
  "progress" bigint DEFAULT 0 NOT NULL,
  "lease_token" text COLLATE "C",
  "lease_until" text COLLATE "C",
  "error_message" text COLLATE "C",
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("public_id")
);

CREATE TABLE "content_governance_policies" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "platform" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "definition" text COLLATE "C" NOT NULL,
  "definition_hash" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "enabled" bigint DEFAULT 1 NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("tenant_id","workspace_id","platform","environment","app_env")
);

CREATE TABLE "content_governance_policy_versions" (
  "policy_id" text COLLATE "C" NOT NULL,
  "version" bigint NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "definition" text COLLATE "C" NOT NULL,
  "definition_hash" text COLLATE "C" NOT NULL,
  "enabled" bigint NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("policy_id","version")
);

CREATE TABLE "content_governance_receipts" (
  "delivery_id" text COLLATE "C" NOT NULL,
  "review_id" text COLLATE "C" NOT NULL,
  "receipt" text COLLATE "C" NOT NULL,
  "receipt_hash" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("delivery_id","review_id")
);

CREATE TABLE "content_governance_reviews" (
  "id" text COLLATE "C" NOT NULL,
  "delivery_id" text COLLATE "C" NOT NULL,
  "requester_id" text COLLATE "C" NOT NULL,
  "reviewer_id" text COLLATE "C" NOT NULL,
  "snapshot_hash" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'pending' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "note" text COLLATE "C" DEFAULT '' NOT NULL,
  "acknowledged_issues" text COLLATE "C" DEFAULT '[]' NOT NULL,
  "decision_at" text COLLATE "C",
  "invalidated_at" text COLLATE "C",
  "invalidation_reason" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "conversation_tool_requests" (
  "id" text COLLATE "C" NOT NULL,
  "session_id" text COLLATE "C" NOT NULL,
  "reply_id" text COLLATE "C" NOT NULL,
  "app_id" text COLLATE "C" NOT NULL,
  "tool_name" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'proposed' NOT NULL,
  "focus_version" bigint NOT NULL,
  "reply_epoch" bigint NOT NULL,
  "expires_at" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "confirmed_at" text COLLATE "C",
  "parameters" text COLLATE "C",
  "preview" text COLLATE "C",
  "source_message_id" text COLLATE "C",
  PRIMARY KEY ("id")
);

CREATE TABLE "course_enrollments" (
  "id" text COLLATE "C" NOT NULL,
  "release_id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "assigned_by" text COLLATE "C" NOT NULL,
  "revoked_at" text COLLATE "C",
  "revocation_reason" text COLLATE "C",
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "dining_claim_limits" (
  "session_id" text COLLATE "C" NOT NULL,
  "restaurant_id" text COLLATE "C" NOT NULL,
  "failures" bigint DEFAULT 0 NOT NULL,
  "blocked_until" text COLLATE "C",
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("session_id","restaurant_id")
);

CREATE TABLE "dining_farewells" (
  "party_id" text COLLATE "C" NOT NULL,
  "message" text COLLATE "C" NOT NULL,
  "ended_by" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("party_id")
);

CREATE TABLE "dining_feedback" (
  "id" text COLLATE "C" NOT NULL,
  "party_id" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'active' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "rating" bigint,
  "comment" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "session_id" text COLLATE "C",
  "focus_version" bigint,
  "expires_at" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("party_id")
);

CREATE TABLE "dining_followup_consents" (
  "id" text COLLATE "C" NOT NULL,
  "party_id" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'active' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "purpose" text COLLATE "C" NOT NULL,
  "contact_kind" text COLLATE "C" NOT NULL,
  "contact_cipher" text COLLATE "C",
  "contact_mask" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "session_id" text COLLATE "C" NOT NULL,
  "focus_version" bigint NOT NULL,
  "expires_at" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("party_id"),
  CHECK (purpose='visit_followup'),
  CHECK (contact_kind IN ('phone','email'))
);

CREATE TABLE "dining_hold_plans" (
  "id" text COLLATE "C" NOT NULL,
  "restaurant_id" text COLLATE "C" NOT NULL,
  "party_id" text COLLATE "C" NOT NULL,
  "party_version" bigint NOT NULL,
  "table_id" text COLLATE "C" NOT NULL,
  "table_version" bigint NOT NULL,
  "restaurant_version" bigint NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "focus_version" bigint,
  "expected_end_at" text COLLATE "C" NOT NULL,
  "expires_at" text COLLATE "C" NOT NULL,
  "hash" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "dining_memory_imports" (
  "id" text COLLATE "C" NOT NULL,
  "party_id" text COLLATE "C" NOT NULL,
  "session_id" text COLLATE "C" NOT NULL,
  "focus_version" bigint NOT NULL,
  "person_id" text COLLATE "C" NOT NULL,
  "facts" text COLLATE "C" NOT NULL,
  "expires_at" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "dining_obligations" (
  "id" text COLLATE "C" NOT NULL,
  "party_id" text COLLATE "C" NOT NULL,
  "kind" text COLLATE "C" NOT NULL,
  "reference_id" text COLLATE "C" NOT NULL,
  "active" bigint DEFAULT 1 NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("kind","reference_id")
);

CREATE TABLE "dining_occupancies" (
  "id" text COLLATE "C" NOT NULL,
  "restaurant_id" text COLLATE "C" NOT NULL,
  "table_id" text COLLATE "C" NOT NULL,
  "party_id" text COLLATE "C" NOT NULL,
  "state" text COLLATE "C" NOT NULL,
  "expires_at" text COLLATE "C",
  "expected_end_at" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "dining_parties" (
  "id" text COLLATE "C" NOT NULL,
  "restaurant_id" text COLLATE "C" NOT NULL,
  "owner_session_id" text COLLATE "C",
  "created_focus_version" bigint,
  "actor_id" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "size" bigint NOT NULL,
  "visit_minutes" bigint NOT NULL,
  "guest_note" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "access_version" bigint DEFAULT 1 NOT NULL,
  "queue_number" bigint,
  "queued_at" text COLLATE "C",
  "current_preference_id" text COLLATE "C",
  "claim_nonce" text COLLATE "C" NOT NULL,
  "claim_hash" text COLLATE "C" NOT NULL,
  "claim_expires_at" text COLLATE "C" NOT NULL,
  "seated_at" text COLLATE "C",
  "ended_at" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("claim_hash")
);

CREATE TABLE "dining_preferences" (
  "id" text COLLATE "C" NOT NULL,
  "party_id" text COLLATE "C" NOT NULL,
  "revision" bigint NOT NULL,
  "payload" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" NOT NULL,
  "source" text COLLATE "C" NOT NULL,
  "source_fact_ids" text COLLATE "C" NOT NULL,
  "source_import_id" text COLLATE "C",
  "session_id" text COLLATE "C",
  "focus_version" bigint,
  "actor_id" text COLLATE "C" NOT NULL,
  "confirmed_at" text COLLATE "C",
  "confirmed_by" text COLLATE "C",
  "confirmed_focus_version" bigint,
  "expires_at" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("party_id","revision")
);

CREATE TABLE "dining_recommendations" (
  "id" text COLLATE "C" NOT NULL,
  "party_id" text COLLATE "C" NOT NULL,
  "party_version" bigint NOT NULL,
  "menu_version" bigint NOT NULL,
  "preference_id" text COLLATE "C" NOT NULL,
  "payload" text COLLATE "C" NOT NULL,
  "expires_at" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "dining_reservations" (
  "id" text COLLATE "C" NOT NULL,
  "restaurant_id" text COLLATE "C" NOT NULL,
  "party_id" text COLLATE "C" NOT NULL,
  "table_id" text COLLATE "C" NOT NULL,
  "reference" text COLLATE "C" NOT NULL,
  "starts_at" text COLLATE "C" NOT NULL,
  "ends_at" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'confirmed' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("restaurant_id","reference"),
  UNIQUE ("party_id")
);

CREATE TABLE "dining_service_events" (
  "id" text COLLATE "C" NOT NULL,
  "request_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "kind" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "dining_service_requests" (
  "id" text COLLATE "C" NOT NULL,
  "restaurant_id" text COLLATE "C" NOT NULL,
  "party_id" text COLLATE "C" NOT NULL,
  "kind" text COLLATE "C" NOT NULL,
  "note" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'requested' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "session_id" text COLLATE "C",
  "focus_version" bigint,
  "source_request_id" text COLLATE "C",
  "acknowledged_by" text COLLATE "C",
  "acknowledged_at" text COLLATE "C",
  "resolved_by" text COLLATE "C",
  "resolved_at" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "distribution_reviews" (
  "id" text COLLATE "C" NOT NULL,
  "variant_id" text COLLATE "C" NOT NULL,
  "variant_version" bigint NOT NULL,
  "requester_id" text COLLATE "C" NOT NULL,
  "reviewer_id" text COLLATE "C" NOT NULL,
  "snapshot_hash" text COLLATE "C" NOT NULL,
  "snapshot" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'pending' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "note" text COLLATE "C" DEFAULT '' NOT NULL,
  "invalidated_at" text COLLATE "C",
  "invalidation_reason" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  "decision_at" text COLLATE "C",
  PRIMARY KEY ("id")
);

CREATE TABLE "distribution_variant_versions" (
  "variant_id" text COLLATE "C" NOT NULL,
  "version" bigint NOT NULL,
  "payload" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("variant_id","version")
);

CREATE TABLE "distribution_variants" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "last_editor_id" text COLLATE "C" NOT NULL,
  "project_id" text COLLATE "C" NOT NULL,
  "export_id" text COLLATE "C" NOT NULL,
  "platform" text COLLATE "C" NOT NULL,
  "title" text COLLATE "C" NOT NULL,
  "description" text COLLATE "C" NOT NULL,
  "tags" text COLLATE "C" NOT NULL,
  "cover_asset_id" text COLLATE "C" NOT NULL,
  "ai_disclosure" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "event_deliveries" (
  "event_id" text COLLATE "C" NOT NULL,
  "delivered_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("event_id")
);

CREATE TABLE "exhibit_device_commands" (
  "id" text COLLATE "C" NOT NULL,
  "device_id" text COLLATE "C" NOT NULL,
  "session_id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "action" text COLLATE "C" NOT NULL,
  "payload" text COLLATE "C" NOT NULL,
  "kind" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'pending' NOT NULL,
  "reason" text COLLATE "C",
  "fixture" text COLLATE "C" DEFAULT 'success' NOT NULL,
  "device_version" bigint NOT NULL,
  "playback_epoch" bigint NOT NULL,
  "receipt_id" text COLLATE "C",
  "simulated" bigint DEFAULT 1 NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "exhibit_device_receipts" (
  "command_id" text COLLATE "C" NOT NULL,
  "receipt_id" text COLLATE "C" NOT NULL,
  "state" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("command_id"),
  UNIQUE ("receipt_id")
);

CREATE TABLE "exhibit_devices" (
  "id" text COLLATE "C" NOT NULL,
  "hall_id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "provider" text COLLATE "C" NOT NULL,
  "online" bigint NOT NULL,
  "allowed_actions" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "state_version" bigint DEFAULT 0 NOT NULL,
  "display_state" text COLLATE "C",
  "active_session_id" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "exhibit_versions" (
  "id" text COLLATE "C" NOT NULL,
  "exhibit_id" text COLLATE "C" NOT NULL,
  "number" bigint NOT NULL,
  "status" text COLLATE "C" NOT NULL,
  "body" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "published_at" text COLLATE "C",
  PRIMARY KEY ("id"),
  UNIQUE ("exhibit_id","number")
);

CREATE TABLE "exhibition_halls" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "venue_id" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "description" text COLLATE "C" NOT NULL,
  "zones" text COLLATE "C" NOT NULL,
  "opening_hours" text COLLATE "C" NOT NULL,
  "enabled" bigint DEFAULT 1 NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "exhibits" (
  "id" text COLLATE "C" NOT NULL,
  "hall_id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "code" text COLLATE "C" NOT NULL,
  "title" text COLLATE "C" NOT NULL,
  "zone_id" text COLLATE "C" NOT NULL,
  "tags" text COLLATE "C" NOT NULL,
  "accessible" bigint NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "draft_version" bigint NOT NULL,
  "published_version" bigint,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("hall_id","code")
);

CREATE TABLE "idempotency" (
  "tenant_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "action" text COLLATE "C" NOT NULL,
  "key" text COLLATE "C" NOT NULL,
  "request_hash" text COLLATE "C" NOT NULL,
  "response" text COLLATE "C" NOT NULL,
  "status_code" bigint NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "redacted" bigint DEFAULT 0 NOT NULL,
  PRIMARY KEY ("tenant_id","actor_id","action","key")
);

CREATE TABLE "jobs" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "kind" text COLLATE "C" NOT NULL,
  "payload" text COLLATE "C" NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" NOT NULL,
  "attempts" bigint DEFAULT 0 NOT NULL,
  "max_attempts" bigint DEFAULT 3 NOT NULL,
  "available_at" text COLLATE "C" NOT NULL,
  "lease_token" text COLLATE "C",
  "lease_until" text COLLATE "C",
  "error_code" text COLLATE "C",
  "error_message" text COLLATE "C",
  "result" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "knowledge_chunks" (
  "id" text COLLATE "C" NOT NULL,
  "version_id" text COLLATE "C" NOT NULL,
  "document_id" text COLLATE "C" NOT NULL,
  "sequence" bigint NOT NULL,
  "text" text COLLATE "C" NOT NULL,
  "tokens" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("version_id","sequence")
);

CREATE TABLE "knowledge_collections" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "audience" text COLLATE "C" NOT NULL,
  "reader_roles" text COLLATE "C" NOT NULL,
  "scenes" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "knowledge_documents" (
  "id" text COLLATE "C" NOT NULL,
  "collection_id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "published_version_id" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "knowledge_versions" (
  "id" text COLLATE "C" NOT NULL,
  "document_id" text COLLATE "C" NOT NULL,
  "ordinal" bigint NOT NULL,
  "title" text COLLATE "C" NOT NULL,
  "content" text COLLATE "C" NOT NULL,
  "source_label" text COLLATE "C" NOT NULL,
  "source_url" text COLLATE "C",
  "content_hash" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'draft' NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "published_at" text COLLATE "C",
  PRIMARY KEY ("id"),
  UNIQUE ("document_id","ordinal")
);

CREATE TABLE "learning_attempts" (
  "id" text COLLATE "C" NOT NULL,
  "enrollment_id" text COLLATE "C" NOT NULL,
  "release_id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "release_hash" text COLLATE "C" NOT NULL,
  "state" text COLLATE "C" NOT NULL,
  "state_hash" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "event_count" bigint DEFAULT 0 NOT NULL,
  "completed" bigint DEFAULT 0 NOT NULL,
  "earned" bigint DEFAULT 0 NOT NULL,
  "possible" bigint DEFAULT 0 NOT NULL,
  "percent" double precision DEFAULT 0 NOT NULL,
  "passed" bigint,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "learning_events" (
  "attempt_id" text COLLATE "C" NOT NULL,
  "sequence" bigint NOT NULL,
  "node_id" text COLLATE "C" NOT NULL,
  "kind" text COLLATE "C" NOT NULL,
  "payload" text COLLATE "C" NOT NULL,
  "payload_hash" text COLLATE "C" NOT NULL,
  "state_hash" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("attempt_id","sequence")
);

CREATE TABLE "live_answer_configurations" (
  "session_id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "enabled" bigint DEFAULT 0 NOT NULL,
  "auto_draft" bigint DEFAULT 0 NOT NULL,
  "language" text COLLATE "C" NOT NULL,
  "engine" text COLLATE "C",
  "generation" bigint DEFAULT 1 NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("session_id")
);

CREATE TABLE "live_answer_jobs" (
  "id" text COLLATE "C" NOT NULL,
  "session_id" text COLLATE "C" NOT NULL,
  "question_id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "session_hash" text COLLATE "C" NOT NULL,
  "request" text COLLATE "C" NOT NULL,
  "configuration" text COLLATE "C" NOT NULL,
  "controller_version" bigint NOT NULL,
  "question_version" bigint NOT NULL,
  "configuration_generation" bigint NOT NULL,
  "input_hash" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'queued' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "control_version" bigint DEFAULT 1 NOT NULL,
  "attempts" bigint DEFAULT 0 NOT NULL,
  "progress" double precision DEFAULT 0 NOT NULL,
  "lease_token" text COLLATE "C",
  "lease_until" text COLLATE "C",
  "result" text COLLATE "C",
  "evidence" text COLLATE "C",
  "result_hash" text COLLATE "C",
  "withdrawn_at" text COLLATE "C",
  "error_code" text COLLATE "C",
  "error_message" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("question_id","configuration_generation","controller_version","question_version")
);

CREATE TABLE "live_answer_origins" (
  "question_id" text COLLATE "C" NOT NULL,
  "job_id" text COLLATE "C" NOT NULL,
  "accepted_by" text COLLATE "C" NOT NULL,
  "accepted_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("question_id"),
  UNIQUE ("job_id")
);

CREATE TABLE "live_audience_events" (
  "id" text COLLATE "C" NOT NULL,
  "session_id" text COLLATE "C" NOT NULL,
  "destination_id" text COLLATE "C" NOT NULL,
  "event_id" text COLLATE "C" NOT NULL,
  "input_hash" text COLLATE "C" NOT NULL,
  "participant_hash" text COLLATE "C" NOT NULL,
  "nickname" text COLLATE "C" NOT NULL,
  "kind" text COLLATE "C" NOT NULL,
  "text" text COLLATE "C" NOT NULL,
  "media_opt_in" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'received' NOT NULL,
  "priority" bigint DEFAULT 0 NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "answer" text COLLATE "C",
  "answer_kind" text COLLATE "C",
  "citations" text COLLATE "C" DEFAULT '[]' NOT NULL,
  "product_id" text COLLATE "C",
  "prepared_epoch" bigint,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("session_id","destination_id","event_id")
);

CREATE TABLE "live_commands" (
  "id" text COLLATE "C" NOT NULL,
  "session_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "action" text COLLATE "C" NOT NULL,
  "epoch" bigint NOT NULL,
  "requested_at" text COLLATE "C" NOT NULL,
  "simulator_applied_at" text COLLATE "C",
  "status" text COLLATE "C" DEFAULT 'pending' NOT NULL,
  "session_version" bigint DEFAULT 0 NOT NULL,
  "media_applied_at" text COLLATE "C",
  "media_frame" bigint,
  PRIMARY KEY ("id")
);

CREATE TABLE "live_destinations" (
  "id" text COLLATE "C" NOT NULL,
  "session_id" text COLLATE "C" NOT NULL,
  "definition_id" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'idle' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "attempts" bigint DEFAULT 0 NOT NULL,
  "operation_id" text COLLATE "C",
  "remote_id" text COLLATE "C",
  "heartbeat_at" text COLLATE "C",
  "error_message" text COLLATE "C",
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("session_id","definition_id")
);

CREATE TABLE "live_guest_programme_connections" (
  "id" text COLLATE "C" NOT NULL,
  "grant_id" text COLLATE "C" NOT NULL,
  "peer_attempt_id" text COLLATE "C" NOT NULL,
  "output_id" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'queued' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "mix_state" text COLLATE "C" DEFAULT 'preview' NOT NULL,
  "audio_muted" bigint DEFAULT 0 NOT NULL,
  "video_hidden" bigint DEFAULT 0 NOT NULL,
  "guest_lease_until" text COLLATE "C" NOT NULL,
  "guest_sequence" bigint DEFAULT 0 NOT NULL,
  "generation_id" text COLLATE "C",
  "runtime_token" text COLLATE "C",
  "server_offer" text COLLATE "C",
  "server_offer_hash" text COLLATE "C",
  "guest_answer" text COLLATE "C",
  "guest_answer_hash" text COLLATE "C",
  "rtp_audio" bigint DEFAULT 0 NOT NULL,
  "rtp_video" bigint DEFAULT 0 NOT NULL,
  "decoded_frames" bigint DEFAULT 0 NOT NULL,
  "decoded_pcm_bytes" bigint DEFAULT 0 NOT NULL,
  "video_ready" bigint DEFAULT 0 NOT NULL,
  "audio_ready" bigint DEFAULT 0 NOT NULL,
  "media_at" text COLLATE "C",
  "reason" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("grant_id"),
  CHECK (status IN ('queued','connecting','connected','ended','failed','expired')),
  CHECK (mix_state IN ('preview','on_air','off_air'))
);

CREATE TABLE "live_guest_programme_controls" (
  "id" text COLLATE "C" NOT NULL,
  "connection_id" text COLLATE "C" NOT NULL,
  "output_id" text COLLATE "C" NOT NULL,
  "version" bigint NOT NULL,
  "session_version" bigint NOT NULL,
  "action" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'pending' NOT NULL,
  "requested_at" text COLLATE "C" NOT NULL,
  "applied_at" text COLLATE "C",
  "media_frame" bigint,
  PRIMARY KEY ("id"),
  UNIQUE ("connection_id","version"),
  CHECK (status IN ('pending','applied','superseded'))
);

CREATE TABLE "live_guest_programme_grants" (
  "id" text COLLATE "C" NOT NULL,
  "invite_id" text COLLATE "C" NOT NULL,
  "peer_attempt_id" text COLLATE "C" NOT NULL,
  "guest_id" text COLLATE "C" NOT NULL,
  "session_id" text COLLATE "C" NOT NULL,
  "output_id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'requested' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "available_camera" bigint NOT NULL,
  "available_microphone" bigint NOT NULL,
  "recording_required" bigint NOT NULL,
  "recording_allowed" bigint DEFAULT 0 NOT NULL,
  "camera" bigint DEFAULT 0 NOT NULL,
  "microphone" bigint DEFAULT 0 NOT NULL,
  "public_name" text COLLATE "C" DEFAULT '' NOT NULL,
  "client_id" text COLLATE "C",
  "statement_version" text COLLATE "C",
  "consent_hash" text COLLATE "C",
  "consented_at" text COLLATE "C",
  "expires_at" text COLLATE "C" NOT NULL,
  "cookie_nonce" text COLLATE "C" NOT NULL,
  "cookie_hash" text COLLATE "C",
  "withdrawn_at" text COLLATE "C",
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  CHECK (status IN ('requested','consented','rejected','withdrawn','expired'))
);

CREATE TABLE "live_observations" (
  "session_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "epoch" bigint NOT NULL,
  "status" text COLLATE "C" NOT NULL,
  "observed_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("session_id","actor_id")
);

CREATE TABLE "live_output_generations" (
  "id" text COLLATE "C" NOT NULL,
  "output_id" text COLLATE "C" NOT NULL,
  "number" bigint NOT NULL,
  "lease_token" text COLLATE "C" NOT NULL,
  "work_key" text COLLATE "C" NOT NULL,
  "start_frame" bigint NOT NULL,
  "accepted_frames" bigint DEFAULT 0 NOT NULL,
  "encoded_frames" bigint DEFAULT 0 NOT NULL,
  "published_frames" bigint DEFAULT 0 NOT NULL,
  "duration_ms" bigint DEFAULT 0 NOT NULL,
  "status" text COLLATE "C" DEFAULT 'preparing' NOT NULL,
  "helper_pid" bigint,
  "helper_entry" text COLLATE "C",
  "started_at" text COLLATE "C" NOT NULL,
  "ended_at" text COLLATE "C",
  PRIMARY KEY ("id"),
  UNIQUE ("output_id","number")
);

CREATE TABLE "live_output_observations" (
  "output_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "client_id" text COLLATE "C" NOT NULL,
  "generation_id" text COLLATE "C" NOT NULL,
  "sequence" bigint NOT NULL,
  "decoded_frames" bigint NOT NULL,
  "position_ms" bigint NOT NULL,
  "status" text COLLATE "C" NOT NULL,
  "observed_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("output_id","actor_id","client_id")
);

CREATE TABLE "live_output_parts" (
  "id" text COLLATE "C" NOT NULL,
  "output_id" text COLLATE "C" NOT NULL,
  "generation_id" text COLLATE "C" NOT NULL,
  "kind" text COLLATE "C" NOT NULL,
  "sequence" bigint NOT NULL,
  "duration_ms" bigint NOT NULL,
  "media_start_ms" bigint NOT NULL,
  "storage_key" text COLLATE "C" NOT NULL,
  "size" bigint NOT NULL,
  "sha256" text COLLATE "C" NOT NULL,
  "published_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("generation_id","kind","sequence"),
  CHECK (kind IN ('init','segment'))
);

CREATE TABLE "live_output_presentations" (
  "output_id" text COLLATE "C" NOT NULL,
  "version" bigint NOT NULL,
  "presentation" text COLLATE "C" NOT NULL,
  "presentation_hash" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'pending' NOT NULL,
  "generation_id" text COLLATE "C",
  "media_frame" bigint,
  "applied_at" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("output_id","version")
);

CREATE TABLE "live_output_recordings" (
  "recording_id" text COLLATE "C" NOT NULL,
  "output_id" text COLLATE "C" NOT NULL,
  "capture_hash" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("recording_id"),
  UNIQUE ("output_id")
);

CREATE TABLE "live_output_spans" (
  "id" text COLLATE "C" NOT NULL,
  "output_id" text COLLATE "C" NOT NULL,
  "generation_id" text COLLATE "C" NOT NULL,
  "first_frame" bigint NOT NULL,
  "last_frame" bigint NOT NULL,
  "session_version" bigint NOT NULL,
  "epoch" bigint NOT NULL,
  "presentation_version" bigint NOT NULL,
  "frame" text COLLATE "C" NOT NULL,
  "frame_hash" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("generation_id","first_frame")
);

CREATE TABLE "live_outputs" (
  "id" text COLLATE "C" NOT NULL,
  "session_id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "snapshot" text COLLATE "C" NOT NULL,
  "snapshot_hash" text COLLATE "C" NOT NULL,
  "presentation" text COLLATE "C" NOT NULL,
  "presentation_hash" text COLLATE "C" NOT NULL,
  "presentation_version" bigint DEFAULT 1 NOT NULL,
  "status" text COLLATE "C" DEFAULT 'armed' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "attempts" bigint DEFAULT 0 NOT NULL,
  "lease_token" text COLLATE "C",
  "lease_until" text COLLATE "C",
  "generation_id" text COLLATE "C",
  "generation" bigint DEFAULT 0 NOT NULL,
  "accepted_frames" bigint DEFAULT 0 NOT NULL,
  "encoded_frames" bigint DEFAULT 0 NOT NULL,
  "published_frames" bigint DEFAULT 0 NOT NULL,
  "published_duration_ms" bigint DEFAULT 0 NOT NULL,
  "interruptions" bigint DEFAULT 0 NOT NULL,
  "error_message" text COLLATE "C",
  "withdrawn_at" text COLLATE "C",
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("session_id")
);

CREATE TABLE "live_peer_attempts" (
  "id" text COLLATE "C" NOT NULL,
  "invite_id" text COLLATE "C" NOT NULL,
  "guest_id" text COLLATE "C" NOT NULL,
  "consent_version" bigint NOT NULL,
  "host_id" text COLLATE "C" NOT NULL,
  "host_client_id" text COLLATE "C" NOT NULL,
  "guest_client_id" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'active' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "host_lease_until" text COLLATE "C" NOT NULL,
  "guest_lease_until" text COLLATE "C" NOT NULL,
  "host_sequence" bigint DEFAULT 0 NOT NULL,
  "guest_sequence" bigint DEFAULT 0 NOT NULL,
  "host_connection" text COLLATE "C" DEFAULT 'new' NOT NULL,
  "guest_connection" text COLLATE "C" DEFAULT 'new' NOT NULL,
  "host_received_bytes" bigint DEFAULT 0 NOT NULL,
  "guest_received_bytes" bigint DEFAULT 0 NOT NULL,
  "host_decoded_frames" bigint DEFAULT 0 NOT NULL,
  "guest_decoded_frames" bigint DEFAULT 0 NOT NULL,
  "host_program_version" bigint DEFAULT 0 NOT NULL,
  "host_program_ready" bigint DEFAULT 0 NOT NULL,
  "reason" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  CHECK (status IN ('active','ended','expired','failed'))
);

CREATE TABLE "live_peer_consents" (
  "guest_id" text COLLATE "C" NOT NULL,
  "version" bigint NOT NULL,
  "camera" bigint NOT NULL,
  "microphone" bigint NOT NULL,
  "statement_version" text COLLATE "C" NOT NULL,
  "purpose" text COLLATE "C" NOT NULL,
  "client_id" text COLLATE "C" NOT NULL,
  "expires_at" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "withdrawn_at" text COLLATE "C",
  PRIMARY KEY ("guest_id","version"),
  CHECK (purpose='backstage_call')
);

CREATE TABLE "live_peer_guests" (
  "id" text COLLATE "C" NOT NULL,
  "invite_id" text COLLATE "C" NOT NULL,
  "nickname" text COLLATE "C" DEFAULT '' NOT NULL,
  "cookie_hash" text COLLATE "C",
  "join_key_hash" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'joined' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "consent_version" bigint DEFAULT 0 NOT NULL,
  "camera" bigint DEFAULT 0 NOT NULL,
  "microphone" bigint DEFAULT 0 NOT NULL,
  "client_id" text COLLATE "C",
  "consent_expires_at" text COLLATE "C",
  "seen_at" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("cookie_hash"),
  UNIQUE ("invite_id"),
  CHECK (status IN ('joined','requested','approved','rejected','withdrawn'))
);

CREATE TABLE "live_peer_invites" (
  "id" text COLLATE "C" NOT NULL,
  "session_id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "public_title" text COLLATE "C" NOT NULL,
  "expires_at" text COLLATE "C" NOT NULL,
  "access_nonce" text COLLATE "C" NOT NULL,
  "access_hash" text COLLATE "C",
  "consumed_access_hash" text COLLATE "C",
  "status" text COLLATE "C" DEFAULT 'issued' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "reason" text COLLATE "C",
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("access_hash"),
  CHECK (status IN ('issued','used','revoked','expired','closed'))
);

CREATE TABLE "live_peer_limits" (
  "key" text COLLATE "C" NOT NULL,
  "window_at" text COLLATE "C" NOT NULL,
  "count" bigint NOT NULL,
  PRIMARY KEY ("key")
);

CREATE TABLE "live_peer_signals" (
  "attempt_id" text COLLATE "C" NOT NULL,
  "direction" text COLLATE "C" NOT NULL,
  "sequence" bigint NOT NULL,
  "payload" text COLLATE "C" NOT NULL,
  "payload_hash" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("attempt_id","direction","sequence"),
  CHECK (direction IN ('host','guest'))
);

CREATE TABLE "live_program_versions" (
  "program_id" text COLLATE "C" NOT NULL,
  "version" bigint NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "definition" text COLLATE "C" NOT NULL,
  "definition_hash" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("program_id","version")
);

CREATE TABLE "live_programs" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "definition" text COLLATE "C" NOT NULL,
  "definition_hash" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "live_recording_clips" (
  "id" text COLLATE "C" NOT NULL,
  "recording_id" text COLLATE "C" NOT NULL,
  "project_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "start_ms" bigint NOT NULL,
  "duration_ms" bigint NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "live_recording_origins" (
  "asset_id" text COLLATE "C" NOT NULL,
  "recording_id" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("asset_id")
);

CREATE TABLE "live_recordings" (
  "id" text COLLATE "C" NOT NULL,
  "session_id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "snapshot" text COLLATE "C" NOT NULL,
  "snapshot_hash" text COLLATE "C" NOT NULL,
  "source_guard" text COLLATE "C" NOT NULL,
  "source_guard_hash" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'queued' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "attempts" bigint DEFAULT 0 NOT NULL,
  "lease_token" text COLLATE "C",
  "lease_until" text COLLATE "C",
  "asset_id" text COLLATE "C",
  "storage_key" text COLLATE "C",
  "size" bigint,
  "sha256" text COLLATE "C",
  "error_message" text COLLATE "C",
  "withdrawn_at" text COLLATE "C",
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  "capture_kind" text COLLATE "C" DEFAULT 'local_timeline_reconstruction' NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("session_id")
);

CREATE TABLE "live_segments" (
  "session_id" text COLLATE "C" NOT NULL,
  "seq" bigint NOT NULL,
  "segment" text COLLATE "C" NOT NULL,
  "segment_hash" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("session_id","seq")
);

CREATE TABLE "live_sessions" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "program_id" text COLLATE "C" NOT NULL,
  "program_version" bigint NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "kind" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" NOT NULL,
  "snapshot" text COLLATE "C" NOT NULL,
  "snapshot_hash" text COLLATE "C" NOT NULL,
  "state" text COLLATE "C" NOT NULL,
  "state_hash" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "scheduled_at" text COLLATE "C",
  "started_at" text COLLATE "C",
  "ended_at" text COLLATE "C",
  "error_message" text COLLATE "C",
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  CHECK (kind IN ('preview','broadcast_simulation')),
  CHECK (status IN ('ready','scheduled','preview','live','ended','failed'))
);

CREATE TABLE "live_speech_jobs" (
  "id" text COLLATE "C" NOT NULL,
  "plan_id" text COLLATE "C" NOT NULL,
  "session_id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "source" text COLLATE "C" NOT NULL,
  "input_hash" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'queued' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "control_version" bigint DEFAULT 1 NOT NULL,
  "attempts" bigint DEFAULT 0 NOT NULL,
  "progress" double precision DEFAULT 0 NOT NULL,
  "lease_token" text COLLATE "C",
  "lease_until" text COLLATE "C",
  "wav_key" text COLLATE "C",
  "wav_format" text COLLATE "C",
  "pcm_key" text COLLATE "C",
  "pcm_format" text COLLATE "C",
  "withdrawn_at" text COLLATE "C",
  "error_code" text COLLATE "C",
  "error_message" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "live_speech_plans" (
  "id" text COLLATE "C" NOT NULL,
  "session_id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "session_hash" text COLLATE "C" NOT NULL,
  "voice" text COLLATE "C" NOT NULL,
  "cues" text COLLATE "C" NOT NULL,
  "input_hash" text COLLATE "C" NOT NULL,
  "result_hash" text COLLATE "C",
  "status" text COLLATE "C" DEFAULT 'building' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "withdrawn_at" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "live_speech_playbacks" (
  "session_id" text COLLATE "C" NOT NULL,
  "job_id" text COLLATE "C" NOT NULL,
  "kind" text COLLATE "C" NOT NULL,
  "epoch" bigint NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "position_frames" bigint DEFAULT 0 NOT NULL,
  "program_cue_index" bigint NOT NULL,
  "program_offset_ms" bigint NOT NULL,
  "status" text COLLATE "C" DEFAULT 'active' NOT NULL,
  "started_at" text COLLATE "C" NOT NULL,
  "ended_at" text COLLATE "C",
  PRIMARY KEY ("session_id")
);

CREATE TABLE "media_transfer_parts" (
  "transfer_id" text COLLATE "C" NOT NULL,
  "part_index" bigint NOT NULL,
  "size" bigint NOT NULL,
  "sha256" text COLLATE "C" NOT NULL,
  "storage_key" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("transfer_id","part_index"),
  UNIQUE ("storage_key")
);

CREATE TABLE "media_transfers" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "kind" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "category" text COLLATE "C" NOT NULL,
  "file_name" text COLLATE "C" NOT NULL,
  "size" bigint NOT NULL,
  "expected_sha256" text COLLATE "C",
  "sha256" text COLLATE "C",
  "part_hashes" text COLLATE "C",
  "fingerprint" text COLLATE "C",
  "chunk_size" bigint NOT NULL,
  "chunk_count" bigint NOT NULL,
  "status" text COLLATE "C" DEFAULT 'uploading' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "progress" double precision DEFAULT 0 NOT NULL,
  "attempts" bigint DEFAULT 0 NOT NULL,
  "lease_token" text COLLATE "C",
  "lease_until" text COLLATE "C",
  "asset_id" text COLLATE "C",
  "project_id" text COLLATE "C",
  "warnings" text COLLATE "C" DEFAULT '[]' NOT NULL,
  "error_message" text COLLATE "C",
  "rights_note" text COLLATE "C" NOT NULL,
  "rights_confirmed_at" text COLLATE "C" NOT NULL,
  "chunks_cleaned_at" text COLLATE "C",
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  "nonportable_confirmed_at" text COLLATE "C",
  PRIMARY KEY ("id")
);

CREATE TABLE "memberships" (
  "user_id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "role" text COLLATE "C" NOT NULL,
  "workspace_ids" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("user_id"),
  CHECK (role IN ('admin','editor','viewer','reviewer'))
);

CREATE TABLE "memory_facts" (
  "id" text COLLATE "C" NOT NULL,
  "person_id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "fact_key" text COLLATE "C" NOT NULL,
  "value" text COLLATE "C" NOT NULL,
  "source_kind" text COLLATE "C" NOT NULL,
  "source_session_id" text COLLATE "C",
  "source_message_id" text COLLATE "C",
  "source_focus_version" bigint,
  "visibility" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'pending' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "expires_at" text COLLATE "C" NOT NULL,
  "confirmed_at" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "memory_lookup" (
  "fact_id" text COLLATE "C" NOT NULL,
  "person_id" text COLLATE "C" NOT NULL,
  "value" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("fact_id")
);

CREATE TABLE "memory_notes" (
  "id" text COLLATE "C" NOT NULL,
  "person_id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "kind" text COLLATE "C" NOT NULL,
  "text" text COLLATE "C" NOT NULL,
  "source_session_id" text COLLATE "C",
  "source_message_ids" text COLLATE "C" NOT NULL,
  "source_focus_version" bigint,
  "status" text COLLATE "C" DEFAULT 'open' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "expires_at" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "memory_recovery_credentials" (
  "id" text COLLATE "C" NOT NULL,
  "person_id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "token_hash" text COLLATE "C" NOT NULL,
  "expires_at" text COLLATE "C" NOT NULL,
  "revoked_at" text COLLATE "C",
  "used_at" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "memory_session_greetings" (
  "session_id" text COLLATE "C" NOT NULL,
  "person_id" text COLLATE "C" NOT NULL,
  "greeted_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("session_id")
);

CREATE TABLE "memory_session_links" (
  "session_id" text COLLATE "C" NOT NULL,
  "person_id" text COLLATE "C" NOT NULL,
  "focus_version" bigint NOT NULL,
  "consent_at" text COLLATE "C" NOT NULL,
  "transcript_expires_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("session_id","focus_version")
);

CREATE TABLE "mock_ad_deliveries" (
  "id" text COLLATE "C" NOT NULL,
  "run_id" text COLLATE "C" NOT NULL,
  "sequence" bigint NOT NULL,
  "group_id" text COLLATE "C" NOT NULL,
  "creative_id" text COLLATE "C" NOT NULL,
  "cost_minor" bigint NOT NULL,
  "budget_day" text COLLATE "C" NOT NULL,
  "event_time" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("run_id","sequence"),
  CHECK (cost_minor>0)
);

CREATE TABLE "mock_ad_operation_results" (
  "operation_id" text COLLATE "C" NOT NULL,
  "input_hash" text COLLATE "C" NOT NULL,
  "receipt" text COLLATE "C" NOT NULL,
  "receipt_hash" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("operation_id")
);

CREATE TABLE "mock_ad_remote_runs" (
  "run_id" text COLLATE "C" NOT NULL,
  "remote_id" text COLLATE "C" NOT NULL,
  "snapshot_hash" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" NOT NULL,
  "platform_review" text COLLATE "C" NOT NULL,
  "pause_effective_at" text COLLATE "C",
  "activated_at" text COLLATE "C",
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("run_id"),
  UNIQUE ("remote_id")
);

CREATE TABLE "mock_ad_reports" (
  "event_id" text COLLATE "C" NOT NULL,
  "account_id" text COLLATE "C" NOT NULL,
  "run_id" text COLLATE "C" NOT NULL,
  "delivery_id" text COLLATE "C" NOT NULL,
  "kind" text COLLATE "C" NOT NULL,
  "original_event_id" text COLLATE "C",
  "payload" text COLLATE "C" NOT NULL,
  "payload_hash" text COLLATE "C" NOT NULL,
  "available_at" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("event_id")
);

CREATE TABLE "mock_financial_operations" (
  "operation_id" text COLLATE "C" NOT NULL,
  "request_hash" text COLLATE "C" NOT NULL,
  "payload" text COLLATE "C" NOT NULL,
  "remote_operation_id" text COLLATE "C" NOT NULL,
  "remote_transaction_id" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" NOT NULL,
  "sequence" bigint NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("operation_id")
);

CREATE TABLE "mock_notification_submissions" (
  "delivery_id" text COLLATE "C" NOT NULL,
  "request_hash" text COLLATE "C" NOT NULL,
  "remote_id" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("delivery_id")
);

CREATE TABLE "mock_pos_operations" (
  "change_id" text COLLATE "C" NOT NULL,
  "restaurant_id" text COLLATE "C" NOT NULL,
  "request_hash" text COLLATE "C" NOT NULL,
  "payload" text COLLATE "C" NOT NULL,
  "remote_request_id" text COLLATE "C" NOT NULL,
  "remote_order_id" text COLLATE "C" NOT NULL,
  "outcome" text COLLATE "C" NOT NULL,
  "sequence" bigint NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("change_id")
);

CREATE TABLE "native_model_leases" (
  "resource" text COLLATE "C" NOT NULL,
  "job_kind" text COLLATE "C" NOT NULL,
  "job_id" text COLLATE "C" NOT NULL,
  "token" text COLLATE "C" NOT NULL,
  "lease_until" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("resource")
);

CREATE TABLE "notification_callback_events" (
  "event_id" text COLLATE "C" NOT NULL,
  "delivery_id" text COLLATE "C" NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "request_hash" text COLLATE "C" NOT NULL,
  "disposition" text COLLATE "C" NOT NULL,
  "received_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("event_id")
);

CREATE TABLE "office_calendar_events" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "organizer_user_id" text COLLATE "C" NOT NULL,
  "title" text COLLATE "C" NOT NULL,
  "description" text COLLATE "C" NOT NULL,
  "location" text COLLATE "C" NOT NULL,
  "starts_at" text COLLATE "C" NOT NULL,
  "ends_at" text COLLATE "C" NOT NULL,
  "timezone" text COLLATE "C" NOT NULL,
  "reminder_minutes" bigint NOT NULL,
  "channel" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'scheduled' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "revision" bigint DEFAULT 1 NOT NULL,
  "expires_at" text COLLATE "C" NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "office_event_attendees" (
  "event_id" text COLLATE "C" NOT NULL,
  "user_id" text COLLATE "C" NOT NULL,
  "response" text COLLATE "C" DEFAULT 'pending' NOT NULL,
  "response_at" text COLLATE "C",
  PRIMARY KEY ("event_id","user_id")
);

CREATE TABLE "office_mock_submissions" (
  "notification_id" text COLLATE "C" NOT NULL,
  "request_hash" text COLLATE "C" NOT NULL,
  "remote_id" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("notification_id")
);

CREATE TABLE "office_notifications" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "source_kind" text COLLATE "C" NOT NULL,
  "source_id" text COLLATE "C" NOT NULL,
  "source_revision" bigint NOT NULL,
  "recipient_user_id" text COLLATE "C" NOT NULL,
  "kind" text COLLATE "C" NOT NULL,
  "due_at" text COLLATE "C" NOT NULL,
  "expires_at" text COLLATE "C" NOT NULL,
  "channel" text COLLATE "C" NOT NULL,
  "scenario" text COLLATE "C" DEFAULT 'normal' NOT NULL,
  "status" text COLLATE "C" DEFAULT 'pending' NOT NULL,
  "dispatch_status" text COLLATE "C" DEFAULT 'queued' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "attempts" bigint DEFAULT 0 NOT NULL,
  "lease_token" text COLLATE "C",
  "lease_until" text COLLATE "C",
  "remote_id" text COLLATE "C",
  "error_code" text COLLATE "C",
  "read_at" text COLLATE "C",
  "acknowledged_at" text COLLATE "C",
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("source_kind","source_id","source_revision","recipient_user_id","kind")
);

CREATE TABLE "office_relays" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "sender_user_id" text COLLATE "C" NOT NULL,
  "recipient_user_id" text COLLATE "C" NOT NULL,
  "subject" text COLLATE "C" NOT NULL,
  "body" text COLLATE "C" NOT NULL,
  "confidentiality" text COLLATE "C" NOT NULL,
  "channel" text COLLATE "C" NOT NULL,
  "scenario" text COLLATE "C" DEFAULT 'normal' NOT NULL,
  "status" text COLLATE "C" DEFAULT 'draft' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "revision" bigint DEFAULT 1 NOT NULL,
  "scheduled_at" text COLLATE "C",
  "expires_at" text COLLATE "C" NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "outbox_events" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "aggregate_id" text COLLATE "C" NOT NULL,
  "type" text COLLATE "C" NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "payload" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "delivered_at" text COLLATE "C",
  PRIMARY KEY ("id")
);

CREATE TABLE "people" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "owner_user_id" text COLLATE "C",
  "guest_session_id" text COLLATE "C",
  "display_name" text COLLATE "C" NOT NULL,
  "roles" text COLLATE "C" NOT NULL,
  "identity_kind" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'active' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "personalization" bigint DEFAULT 0 NOT NULL,
  "do_not_disturb" bigint DEFAULT 1 NOT NULL,
  "quiet_start" text COLLATE "C" DEFAULT '22:00' NOT NULL,
  "quiet_end" text COLLATE "C" DEFAULT '08:00' NOT NULL,
  "cooldown_minutes" bigint DEFAULT 60 NOT NULL,
  "last_greeted_at" text COLLATE "C",
  "notice_version" text COLLATE "C" NOT NULL,
  "consent_at" text COLLATE "C" NOT NULL,
  "expires_at" text COLLATE "C" NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "practice_releases" (
  "id" text COLLATE "C" NOT NULL,
  "scenario_id" text COLLATE "C" NOT NULL,
  "scenario_version" bigint NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "snapshot" text COLLATE "C" NOT NULL,
  "release_hash" text COLLATE "C" NOT NULL,
  "withdrawn_at" text COLLATE "C",
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("scenario_id","scenario_version")
);

CREATE TABLE "practice_runs" (
  "id" text COLLATE "C" NOT NULL,
  "release_id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "release_hash" text COLLATE "C" NOT NULL,
  "state" text COLLATE "C",
  "state_hash" text COLLATE "C",
  "version" bigint DEFAULT 1 NOT NULL,
  "phase" text COLLATE "C" NOT NULL,
  "shared_feedback" bigint NOT NULL,
  "expires_at" text COLLATE "C" NOT NULL,
  "deleted_at" text COLLATE "C",
  "deletion_reason" text COLLATE "C",
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  CHECK (phase IN ('question','feedback','completed','stopped','deleted')),
  CHECK (shared_feedback IN (0,1)),
  CHECK ((phase='deleted' AND state IS NULL AND state_hash IS NULL AND deleted_at IS NOT NULL AND shared_feedback=0) OR (phase<>'deleted' AND state IS NOT NULL AND state_hash IS NOT NULL AND deleted_at IS NULL))
);

CREATE TABLE "practice_scenario_versions" (
  "scenario_id" text COLLATE "C" NOT NULL,
  "version" bigint NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "definition" text COLLATE "C" NOT NULL,
  "definition_hash" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("scenario_id","version")
);

CREATE TABLE "practice_scenarios" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "definition" text COLLATE "C" NOT NULL,
  "definition_hash" text COLLATE "C" NOT NULL,
  "version" bigint NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  CHECK (version>=1)
);

CREATE TABLE "practice_turns" (
  "id" text COLLATE "C" NOT NULL,
  "run_id" text COLLATE "C" NOT NULL,
  "ordinal" bigint NOT NULL,
  "question_id" text COLLATE "C" NOT NULL,
  "prompt" text COLLATE "C",
  "body" text COLLATE "C",
  "feedback" text COLLATE "C",
  "next_question_id" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("run_id","question_id"),
  UNIQUE ("run_id","ordinal"),
  CHECK (ordinal>=1)
);

CREATE TABLE "privacy_requests" (
  "id" text COLLATE "C" NOT NULL,
  "person_id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "reason" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" NOT NULL,
  "local_completed_at" text COLLATE "C" NOT NULL,
  "external_status" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "profile_versions" (
  "profile_id" text COLLATE "C" NOT NULL,
  "version" bigint NOT NULL,
  "snapshot" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("profile_id","version")
);

CREATE TABLE "profiles" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "avatar_asset_id" text COLLATE "C" NOT NULL,
  "voice_asset_id" text COLLATE "C",
  "scenes" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "pronunciation_book_versions" (
  "book_id" text COLLATE "C" NOT NULL,
  "version" bigint NOT NULL,
  "payload" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("book_id","version")
);

CREATE TABLE "pronunciation_books" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "brand_id" text COLLATE "C",
  "entries" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "provider_health" (
  "tenant_id" text COLLATE "C" NOT NULL,
  "provider_id" text COLLATE "C" NOT NULL,
  "failures" bigint DEFAULT 0 NOT NULL,
  "open_until" text COLLATE "C",
  PRIMARY KEY ("tenant_id","provider_id")
);

CREATE TABLE "provider_usage" (
  "job_id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "units" bigint NOT NULL,
  "cost_minor" bigint,
  "currency" text COLLATE "C" DEFAULT 'CNY' NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("job_id")
);

CREATE TABLE "publishing_accounts" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "platform" text COLLATE "C" NOT NULL,
  "mode" text COLLATE "C" NOT NULL,
  "scenario" text COLLATE "C" NOT NULL,
  "enabled" bigint DEFAULT 1 NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  CHECK (mode IN ('manual','mock'))
);

CREATE TABLE "publishing_callback_events" (
  "event_id" text COLLATE "C" NOT NULL,
  "job_id" text COLLATE "C" NOT NULL,
  "payload_hash" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" NOT NULL,
  "occurred_at" text COLLATE "C" NOT NULL,
  "received_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("event_id")
);

CREATE TABLE "publishing_jobs" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "variant_id" text COLLATE "C" NOT NULL,
  "variant_version" bigint NOT NULL,
  "account_id" text COLLATE "C" NOT NULL,
  "account_version" bigint NOT NULL,
  "creative_hash" text COLLATE "C" NOT NULL,
  "plan_hash" text COLLATE "C" NOT NULL,
  "title" text COLLATE "C" NOT NULL,
  "account_name" text COLLATE "C" NOT NULL,
  "content_snapshot" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'scheduled' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "scheduled_at" text COLLATE "C" NOT NULL,
  "remote_id" text COLLATE "C",
  "error_message" text COLLATE "C",
  "lease_token" text COLLATE "C",
  "lease_until" text COLLATE "C",
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "publishing_metrics" (
  "id" text COLLATE "C" NOT NULL,
  "job_id" text COLLATE "C" NOT NULL,
  "event_time" text COLLATE "C" NOT NULL,
  "fetched_at" text COLLATE "C" NOT NULL,
  "views" bigint NOT NULL,
  "likes" bigint NOT NULL,
  "comments" bigint NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "publishing_packages" (
  "id" text COLLATE "C" NOT NULL,
  "variant_id" text COLLATE "C" NOT NULL,
  "variant_version" bigint NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "snapshot_hash" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'queued' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "storage_key" text COLLATE "C",
  "size" bigint,
  "sha256" text COLLATE "C",
  "error_message" text COLLATE "C",
  "lease_token" text COLLATE "C",
  "lease_until" text COLLATE "C",
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "publishing_remote_posts" (
  "job_id" text COLLATE "C" NOT NULL,
  "input_hash" text COLLATE "C" NOT NULL,
  "remote_id" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("job_id"),
  UNIQUE ("remote_id")
);

CREATE TABLE "reception_hosts" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "user_id" text COLLATE "C" NOT NULL,
  "public_name" text COLLATE "C" NOT NULL,
  "enabled" bigint DEFAULT 1 NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("tenant_id","workspace_id","public_name")
);

CREATE TABLE "reception_messages" (
  "id" text COLLATE "C" NOT NULL,
  "session_id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "role" text COLLATE "C" NOT NULL,
  "text" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" NOT NULL,
  "reply_epoch" bigint NOT NULL,
  "focus_version" bigint NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "memory_person_id" text COLLATE "C",
  "memory_fact_ids" text COLLATE "C" DEFAULT '[]' NOT NULL,
  "knowledge_citations" text COLLATE "C" DEFAULT '[]' NOT NULL,
  "visual_context" text COLLATE "C",
  "input_source" text COLLATE "C" DEFAULT 'typed' NOT NULL,
  "speaker_decision_id" text COLLATE "C",
  "restaurant_context" text COLLATE "C",
  PRIMARY KEY ("id"),
  CHECK (role IN ('visitor','assistant','system'))
);

CREATE TABLE "reception_presence" (
  "terminal_id" text COLLATE "C" NOT NULL,
  "track_hash" text COLLATE "C" NOT NULL,
  "last_seen_at" text COLLATE "C" NOT NULL,
  "cooldown_until" text COLLATE "C" NOT NULL,
  "queue_at" text COLLATE "C",
  PRIMARY KEY ("terminal_id","track_hash")
);

CREATE TABLE "reception_sessions" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "terminal_id" text COLLATE "C" NOT NULL,
  "track_hash" text COLLATE "C" NOT NULL,
  "source" text COLLATE "C" NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "reply_epoch" bigint DEFAULT 0 NOT NULL,
  "focus_version" bigint DEFAULT 0 NOT NULL,
  "access_version" bigint DEFAULT 1 NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "activity_at" text COLLATE "C" NOT NULL,
  "expires_at" text COLLATE "C" NOT NULL,
  "profile_snapshot" text COLLATE "C",
  "ended_reason" text COLLATE "C",
  "scene_app_snapshot" text COLLATE "C",
  "service_scene" text COLLATE "C" DEFAULT 'reception' NOT NULL,
  "dining_party_id" text COLLATE "C",
  PRIMARY KEY ("id"),
  CHECK (status IN ('active','human','ended','expired'))
);

CREATE TABLE "reception_terminals" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "venue_id" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "restaurant_bills" (
  "id" text COLLATE "C" NOT NULL,
  "restaurant_id" text COLLATE "C" NOT NULL,
  "party_id" text COLLATE "C" NOT NULL,
  "order_id" text COLLATE "C" NOT NULL,
  "number" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "order_content_version" bigint NOT NULL,
  "amount_minor" bigint NOT NULL,
  "snapshot" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'open' NOT NULL,
  "attention_reason" text COLLATE "C",
  "settled_at" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("order_id"),
  CHECK (amount_minor>=0)
);

CREATE TABLE "restaurant_financial_events" (
  "id" text COLLATE "C" NOT NULL,
  "bill_id" text COLLATE "C" NOT NULL,
  "operation_id" text COLLATE "C",
  "actor_id" text COLLATE "C" NOT NULL,
  "kind" text COLLATE "C" NOT NULL,
  "info" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "restaurant_financial_operations" (
  "id" text COLLATE "C" NOT NULL,
  "bill_id" text COLLATE "C" NOT NULL,
  "kind" text COLLATE "C" NOT NULL,
  "parent_payment_id" text COLLATE "C",
  "quote_id" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'queued' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "amount_minor" bigint NOT NULL,
  "provider_id" text COLLATE "C" NOT NULL,
  "merchant_id" text COLLATE "C" NOT NULL,
  "config_version" bigint NOT NULL,
  "config_snapshot" text COLLATE "C" NOT NULL,
  "request_payload" text COLLATE "C" NOT NULL,
  "request_hash" text COLLATE "C" NOT NULL,
  "reason" text COLLATE "C" NOT NULL,
  "simulated" bigint NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "session_id" text COLLATE "C",
  "focus_version" bigint,
  "party_access_version" bigint NOT NULL,
  "send_attempts" bigint DEFAULT 0 NOT NULL,
  "simulate_attempts" bigint DEFAULT 0 NOT NULL,
  "lookups" bigint DEFAULT 0 NOT NULL,
  "next_action" text COLLATE "C",
  "action_actor_id" text COLLATE "C",
  "action_session_id" text COLLATE "C",
  "action_focus_version" bigint,
  "action_party_access_version" bigint,
  "lease_action" text COLLATE "C",
  "lease_token" text COLLATE "C",
  "lease_until" text COLLATE "C",
  "last_lookup_at" text COLLATE "C",
  "remote_operation_id" text COLLATE "C",
  "remote_transaction_id" text COLLATE "C",
  "last_sequence" bigint DEFAULT 0 NOT NULL,
  "error_code" text COLLATE "C",
  "error_message" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  CHECK (kind IN ('payment','refund')),
  CHECK (amount_minor>0)
);

CREATE TABLE "restaurant_financial_postings" (
  "id" text COLLATE "C" NOT NULL,
  "bill_id" text COLLATE "C" NOT NULL,
  "operation_id" text COLLATE "C" NOT NULL,
  "kind" text COLLATE "C" NOT NULL,
  "amount_minor" bigint NOT NULL,
  "currency" text COLLATE "C" NOT NULL,
  "provider_id" text COLLATE "C" NOT NULL,
  "merchant_id" text COLLATE "C" NOT NULL,
  "remote_transaction_id" text COLLATE "C" NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("provider_id","merchant_id","remote_transaction_id","environment","app_env"),
  UNIQUE ("operation_id"),
  CHECK (kind IN ('payment','refund')),
  CHECK (amount_minor>0),
  CHECK (currency='CNY')
);

CREATE TABLE "restaurant_financial_quotes" (
  "id" text COLLATE "C" NOT NULL,
  "bill_id" text COLLATE "C" NOT NULL,
  "kind" text COLLATE "C" NOT NULL,
  "parent_payment_id" text COLLATE "C",
  "hash" text COLLATE "C" NOT NULL,
  "payload" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "session_id" text COLLATE "C",
  "focus_version" bigint,
  "status" text COLLATE "C" DEFAULT 'current' NOT NULL,
  "expires_at" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  CHECK (kind IN ('payment','refund'))
);

CREATE TABLE "restaurant_financial_receipts" (
  "event_id" text COLLATE "C" NOT NULL,
  "operation_id" text COLLATE "C" NOT NULL,
  "payload_hash" text COLLATE "C" NOT NULL,
  "payload" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" NOT NULL,
  "sequence" bigint NOT NULL,
  "applied" bigint DEFAULT 0 NOT NULL,
  "attention" bigint DEFAULT 0 NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("event_id")
);

CREATE TABLE "restaurant_inventory_reservations" (
  "id" text COLLATE "C" NOT NULL,
  "change_id" text COLLATE "C" NOT NULL,
  "sku_id" text COLLATE "C" NOT NULL,
  "quantity" bigint NOT NULL,
  "tracked" bigint NOT NULL,
  "status" text COLLATE "C" DEFAULT 'reserved' NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("change_id","sku_id"),
  CHECK (quantity>0)
);

CREATE TABLE "restaurant_kitchen_tickets" (
  "id" text COLLATE "C" NOT NULL,
  "restaurant_id" text COLLATE "C" NOT NULL,
  "order_id" text COLLATE "C" NOT NULL,
  "line_id" text COLLATE "C" NOT NULL,
  "table_id" text COLLATE "C" NOT NULL,
  "table_name" text COLLATE "C" NOT NULL,
  "table_code" text COLLATE "C" NOT NULL,
  "started_quantity" bigint DEFAULT 0 NOT NULL,
  "ready_quantity" bigint DEFAULT 0 NOT NULL,
  "served_quantity" bigint DEFAULT 0 NOT NULL,
  "pending_cancel_quantity" bigint DEFAULT 0 NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "accepted_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("line_id"),
  CHECK (served_quantity>=0 AND ready_quantity>=served_quantity AND started_quantity>=ready_quantity AND pending_cancel_quantity>=0)
);

CREATE TABLE "restaurant_menu_items" (
  "id" text COLLATE "C" NOT NULL,
  "restaurant_id" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "category" text COLLATE "C" NOT NULL,
  "description" text COLLATE "C" NOT NULL,
  "ingredient_tags" text COLLATE "C" NOT NULL,
  "allergen_tags" text COLLATE "C" NOT NULL,
  "may_contain_tags" text COLLATE "C" NOT NULL,
  "allergen_info_complete" bigint NOT NULL,
  "flavor_tags" text COLLATE "C" NOT NULL,
  "spice_level" bigint NOT NULL,
  "is_new" bigint NOT NULL,
  "listed" bigint NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "restaurant_menu_skus" (
  "id" text COLLATE "C" NOT NULL,
  "item_id" text COLLATE "C" NOT NULL,
  "restaurant_id" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "price_minor" bigint NOT NULL,
  "stock_tracked" bigint NOT NULL,
  "stock_remaining" bigint NOT NULL,
  "on_sale" bigint NOT NULL,
  "portion_people" bigint NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "archived" bigint DEFAULT 0 NOT NULL,
  PRIMARY KEY ("id"),
  CHECK (stock_remaining>=0)
);

CREATE TABLE "restaurant_order_changes" (
  "id" text COLLATE "C" NOT NULL,
  "order_id" text COLLATE "C" NOT NULL,
  "kind" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "sequence" bigint NOT NULL,
  "status" text COLLATE "C" DEFAULT 'draft' NOT NULL,
  "base_content_version" bigint NOT NULL,
  "input" text COLLATE "C" NOT NULL,
  "current_quote_id" text COLLATE "C",
  "source" text COLLATE "C" NOT NULL,
  "source_request_id" text COLLATE "C",
  "actor_id" text COLLATE "C" NOT NULL,
  "session_id" text COLLATE "C",
  "focus_version" bigint,
  "party_access_version" bigint NOT NULL,
  "confirmed_at" text COLLATE "C",
  "confirmed_actor_id" text COLLATE "C",
  "confirmed_focus_version" bigint,
  "confirmed_quote_id" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("order_id","sequence"),
  CHECK (kind IN ('initial','amend','cancel'))
);

CREATE TABLE "restaurant_order_dispatches" (
  "change_id" text COLLATE "C" NOT NULL,
  "restaurant_id" text COLLATE "C" NOT NULL,
  "provider_id" text COLLATE "C" NOT NULL,
  "config_version" bigint NOT NULL,
  "config_snapshot" text COLLATE "C" NOT NULL,
  "request_hash" text COLLATE "C" NOT NULL,
  "request_payload" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'queued' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "attempts" bigint DEFAULT 0 NOT NULL,
  "lease_token" text COLLATE "C",
  "lease_until" text COLLATE "C",
  "remote_request_id" text COLLATE "C",
  "remote_order_id" text COLLATE "C",
  "last_sequence" bigint DEFAULT 0 NOT NULL,
  "error_code" text COLLATE "C",
  "error_message" text COLLATE "C",
  "simulated" bigint NOT NULL,
  "query_requested" bigint DEFAULT 0 NOT NULL,
  "lookups" bigint DEFAULT 0 NOT NULL,
  "last_lookup_at" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("change_id")
);

CREATE TABLE "restaurant_order_events" (
  "id" text COLLATE "C" NOT NULL,
  "order_id" text COLLATE "C" NOT NULL,
  "change_id" text COLLATE "C",
  "actor_id" text COLLATE "C" NOT NULL,
  "kind" text COLLATE "C" NOT NULL,
  "info" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "restaurant_order_lines" (
  "id" text COLLATE "C" NOT NULL,
  "order_id" text COLLATE "C" NOT NULL,
  "change_id" text COLLATE "C" NOT NULL,
  "item_id" text COLLATE "C" NOT NULL,
  "sku_id" text COLLATE "C" NOT NULL,
  "item_name" text COLLATE "C" NOT NULL,
  "sku_name" text COLLATE "C" NOT NULL,
  "unit_price_minor" bigint NOT NULL,
  "quantity" bigint NOT NULL,
  "cancelled_quantity" bigint DEFAULT 0 NOT NULL,
  "preparation_note" text COLLATE "C" NOT NULL,
  "dietary_tags" text COLLATE "C" NOT NULL,
  "stock_tracked" bigint NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  CHECK (unit_price_minor>=0),
  CHECK (quantity>0),
  CHECK (cancelled_quantity>=0 AND cancelled_quantity<=quantity)
);

CREATE TABLE "restaurant_order_quotes" (
  "id" text COLLATE "C" NOT NULL,
  "change_id" text COLLATE "C" NOT NULL,
  "change_version" bigint NOT NULL,
  "hash" text COLLATE "C" NOT NULL,
  "payload" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "session_id" text COLLATE "C",
  "focus_version" bigint,
  "status" text COLLATE "C" DEFAULT 'current' NOT NULL,
  "expires_at" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "restaurant_orders" (
  "id" text COLLATE "C" NOT NULL,
  "restaurant_id" text COLLATE "C" NOT NULL,
  "party_id" text COLLATE "C" NOT NULL,
  "number" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "content_version" bigint DEFAULT 1 NOT NULL,
  "status" text COLLATE "C" DEFAULT 'draft' NOT NULL,
  "control_mode" text COLLATE "C" DEFAULT 'automatic' NOT NULL,
  "attention_reason" text COLLATE "C",
  "settlement_status" text COLLATE "C" DEFAULT 'unsettled' NOT NULL,
  "pending_change_id" text COLLATE "C",
  "remote_order_id" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("restaurant_id","number"),
  CHECK (control_mode IN ('automatic','human')),
  CHECK (settlement_status IN ('unsettled','settled'))
);

CREATE TABLE "restaurant_payment_configs" (
  "restaurant_id" text COLLATE "C" NOT NULL,
  "provider_id" text COLLATE "C" NOT NULL,
  "enabled" bigint NOT NULL,
  "merchant_id" text COLLATE "C" NOT NULL,
  "scenario" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("restaurant_id")
);

CREATE TABLE "restaurant_pos_callbacks" (
  "event_id" text COLLATE "C" NOT NULL,
  "change_id" text COLLATE "C" NOT NULL,
  "payload_hash" text COLLATE "C" NOT NULL,
  "payload" text COLLATE "C" NOT NULL,
  "outcome" text COLLATE "C" NOT NULL,
  "sequence" bigint NOT NULL,
  "applied" bigint DEFAULT 0 NOT NULL,
  "conflict" bigint DEFAULT 0 NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("event_id")
);

CREATE TABLE "restaurant_pos_configs" (
  "restaurant_id" text COLLATE "C" NOT NULL,
  "provider_id" text COLLATE "C" NOT NULL,
  "enabled" bigint NOT NULL,
  "scenario" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("restaurant_id")
);

CREATE TABLE "restaurant_staff" (
  "restaurant_id" text COLLATE "C" NOT NULL,
  "user_id" text COLLATE "C" NOT NULL,
  "role" text COLLATE "C" NOT NULL,
  "enabled" bigint NOT NULL,
  "expires_at" text COLLATE "C",
  "version" bigint DEFAULT 1 NOT NULL,
  PRIMARY KEY ("restaurant_id","user_id"),
  CHECK (role IN ('manager','host','kitchen'))
);

CREATE TABLE "restaurant_stock_adjustments" (
  "id" text COLLATE "C" NOT NULL,
  "restaurant_id" text COLLATE "C" NOT NULL,
  "sku_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "before_quantity" bigint NOT NULL,
  "after_quantity" bigint NOT NULL,
  "reason" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "restaurant_stock_movements" (
  "id" text COLLATE "C" NOT NULL,
  "restaurant_id" text COLLATE "C" NOT NULL,
  "sku_id" text COLLATE "C" NOT NULL,
  "change_id" text COLLATE "C" NOT NULL,
  "kind" text COLLATE "C" NOT NULL,
  "before_quantity" bigint NOT NULL,
  "after_quantity" bigint NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("change_id","sku_id","kind")
);

CREATE TABLE "restaurant_tables" (
  "id" text COLLATE "C" NOT NULL,
  "restaurant_id" text COLLATE "C" NOT NULL,
  "code" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "capacity" bigint NOT NULL,
  "min_party_size" bigint NOT NULL,
  "zone" text COLLATE "C" NOT NULL,
  "x" double precision NOT NULL,
  "y" double precision NOT NULL,
  "width" double precision NOT NULL,
  "height" double precision NOT NULL,
  "enabled" bigint NOT NULL,
  "operation" text COLLATE "C" DEFAULT 'open' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("restaurant_id","code"),
  CHECK (operation IN ('open','cleaning','blocked'))
);

CREATE TABLE "restaurant_terminals" (
  "terminal_id" text COLLATE "C" NOT NULL,
  "restaurant_id" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("terminal_id")
);

CREATE TABLE "restaurants" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "venue_id" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "timezone" text COLLATE "C" NOT NULL,
  "public_guide" text COLLATE "C" NOT NULL,
  "profile_id" text COLLATE "C",
  "scene_app_id" text COLLATE "C",
  "hold_seconds" bigint NOT NULL,
  "visit_minutes" bigint NOT NULL,
  "late_minutes" bigint NOT NULL,
  "accepting_guests" bigint DEFAULT 1 NOT NULL,
  "opening_windows" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "menu_version" bigint DEFAULT 1 NOT NULL,
  "queue_counter" bigint DEFAULT 0 NOT NULL,
  "booking_counter" bigint DEFAULT 0 NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  "order_counter" bigint DEFAULT 0 NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("venue_id","environment","app_env")
);

CREATE TABLE "scene_app_versions" (
  "app_id" text COLLATE "C" NOT NULL,
  "version" bigint NOT NULL,
  "snapshot" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("app_id","version")
);

CREATE TABLE "scene_apps" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "profile_id" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "scene" text COLLATE "C" NOT NULL,
  "channel_key" text COLLATE "C" NOT NULL,
  "config" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "enabled" bigint DEFAULT 1 NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("tenant_id","workspace_id","channel_key","environment","app_env")
);

CREATE TABLE "schema_migrations" (
  "name" text COLLATE "C" NOT NULL,
  "applied_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("name")
);

CREATE TABLE "speaker_focus_sessions" (
  "session_id" text COLLATE "C" NOT NULL,
  "state" text COLLATE "C" NOT NULL,
  "reference_id" text COLLATE "C",
  "mode" text COLLATE "C" NOT NULL,
  "provider_id" text COLLATE "C" NOT NULL,
  "extraction_id" text COLLATE "C" NOT NULL,
  "source_channel_id" text COLLATE "C" NOT NULL,
  "focus_version" bigint NOT NULL,
  "config_version" bigint NOT NULL,
  "fallback" text COLLATE "C" DEFAULT 'text' NOT NULL,
  "last_reason" text COLLATE "C" NOT NULL,
  "usage_target_token" text COLLATE "C",
  "quality" text COLLATE "C" DEFAULT 'pending' NOT NULL,
  "expires_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("session_id")
);

CREATE TABLE "speaker_ptt_permits" (
  "id" text COLLATE "C" NOT NULL,
  "session_id" text COLLATE "C" NOT NULL,
  "focus_version" bigint NOT NULL,
  "expires_at" text COLLATE "C" NOT NULL,
  "consumed_at" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "speaker_references" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "owner_user_id" text COLLATE "C",
  "session_id" text COLLATE "C",
  "scope" text COLLATE "C" NOT NULL,
  "label" text COLLATE "C" NOT NULL,
  "provider_id" text COLLATE "C" NOT NULL,
  "provider_reference" text COLLATE "C",
  "target_token" text COLLATE "C",
  "quality" text COLLATE "C" DEFAULT 'pending' NOT NULL,
  "status" text COLLATE "C" DEFAULT 'pending' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "purpose" text COLLATE "C" NOT NULL,
  "notice_version" text COLLATE "C" NOT NULL,
  "consent_at" text COLLATE "C" NOT NULL,
  "expires_at" text COLLATE "C" NOT NULL,
  "delete_status" text COLLATE "C" DEFAULT 'not_requested' NOT NULL,
  "deleted_at" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  CHECK ((scope='temporary' AND session_id IS NOT NULL AND owner_user_id IS NULL) OR (scope='enrolled' AND owner_user_id IS NOT NULL AND session_id IS NULL))
);

CREATE TABLE "speaker_segment_decisions" (
  "id" text COLLATE "C" NOT NULL,
  "session_id" text COLLATE "C" NOT NULL,
  "focus_version" bigint NOT NULL,
  "segment_id" text COLLATE "C" NOT NULL,
  "sequence" bigint NOT NULL,
  "fixture" text COLLATE "C" NOT NULL,
  "attribution" text COLLATE "C" NOT NULL,
  "final" bigint NOT NULL,
  "accepted" bigint NOT NULL,
  "interrupted" bigint DEFAULT 0 NOT NULL,
  "reason" text COLLATE "C" NOT NULL,
  "simulated" bigint DEFAULT 1 NOT NULL,
  "elapsed_ms" bigint NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("session_id","focus_version","segment_id","sequence")
);

CREATE TABLE "speaker_use_tickets" (
  "id" text COLLATE "C" NOT NULL,
  "reference_id" text COLLATE "C" NOT NULL,
  "session_id" text COLLATE "C" NOT NULL,
  "focus_version" bigint NOT NULL,
  "token_hash" text COLLATE "C" NOT NULL,
  "expires_at" text COLLATE "C" NOT NULL,
  "used_at" text COLLATE "C",
  "revoked_at" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "studio_assistant_applications" (
  "session_id" text COLLATE "C" NOT NULL,
  "turn_id" text COLLATE "C" NOT NULL,
  "generation_id" text COLLATE "C",
  "project_id" text COLLATE "C" NOT NULL,
  "before_version" bigint NOT NULL,
  "after_version" bigint NOT NULL,
  "before_hash" text COLLATE "C" NOT NULL,
  "after_hash" text COLLATE "C" NOT NULL,
  "changed_segments" text COLLATE "C" NOT NULL,
  "regenerated_segments" text COLLATE "C" NOT NULL,
  "voice_assets" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("session_id")
);

CREATE TABLE "studio_assistant_generations" (
  "id" text COLLATE "C" NOT NULL,
  "session_id" text COLLATE "C" NOT NULL,
  "turn_id" text COLLATE "C" NOT NULL,
  "number" bigint NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "plan" text COLLATE "C" NOT NULL,
  "plan_hash" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'queued' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "branch_project_id" text COLLATE "C",
  "branch_version" bigint,
  "branch_document_hash" text COLLATE "C",
  "speech_job_id" text COLLATE "C",
  "exports" text COLLATE "C" DEFAULT '[]' NOT NULL,
  "error_code" text COLLATE "C",
  "error_message" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("turn_id","number")
);

CREATE TABLE "studio_assistant_interpretations" (
  "id" text COLLATE "C" NOT NULL,
  "session_id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "session_version" bigint NOT NULL,
  "parent_turn_id" text COLLATE "C",
  "request" text COLLATE "C" NOT NULL,
  "context_hash" text COLLATE "C" NOT NULL,
  "engine" text COLLATE "C" NOT NULL,
  "input_hash" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'queued' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "control_version" bigint DEFAULT 1 NOT NULL,
  "attempts" bigint DEFAULT 0 NOT NULL,
  "progress" double precision DEFAULT 0 NOT NULL,
  "lease_token" text COLLATE "C",
  "lease_until" text COLLATE "C",
  "turn_id" text COLLATE "C",
  "evidence" text COLLATE "C",
  "error_code" text COLLATE "C",
  "error_message" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "studio_assistant_sessions" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "project_id" text COLLATE "C" NOT NULL,
  "project_version" bigint NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "base_document" text COLLATE "C" NOT NULL,
  "base_document_hash" text COLLATE "C" NOT NULL,
  "source_hash" text COLLATE "C" NOT NULL,
  "selected_ids" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "status" text COLLATE "C" DEFAULT 'open' NOT NULL,
  "current_turn_id" text COLLATE "C",
  "current_generation_id" text COLLATE "C",
  "applied_project_version" bigint,
  "applied_document_hash" text COLLATE "C",
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "studio_assistant_turns" (
  "id" text COLLATE "C" NOT NULL,
  "session_id" text COLLATE "C" NOT NULL,
  "number" bigint NOT NULL,
  "parent_turn_id" text COLLATE "C",
  "actor_id" text COLLATE "C" NOT NULL,
  "provider" text COLLATE "C" NOT NULL,
  "instruction" text COLLATE "C" NOT NULL,
  "proposal" text COLLATE "C" NOT NULL,
  "proposal_hash" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("session_id","number")
);

CREATE TABLE "studio_batch_attempts" (
  "item_id" text COLLATE "C" NOT NULL,
  "attempt" bigint NOT NULL,
  "project_id" text COLLATE "C",
  "export_id" text COLLATE "C",
  "status" text COLLATE "C" NOT NULL,
  "error_code" text COLLATE "C",
  "error_message" text COLLATE "C",
  "started_at" text COLLATE "C" NOT NULL,
  "finished_at" text COLLATE "C",
  PRIMARY KEY ("item_id","attempt")
);

CREATE TABLE "studio_batch_items" (
  "id" text COLLATE "C" NOT NULL,
  "batch_id" text COLLATE "C" NOT NULL,
  "position" bigint NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "variables" text COLLATE "C" NOT NULL,
  "document" text COLLATE "C",
  "source_hash" text COLLATE "C",
  "status" text COLLATE "C" DEFAULT 'queued' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "attempts" bigint DEFAULT 0 NOT NULL,
  "project_id" text COLLATE "C",
  "export_id" text COLLATE "C",
  "error_code" text COLLATE "C",
  "error_message" text COLLATE "C",
  "updated_at" text COLLATE "C" NOT NULL,
  "parameters" text COLLATE "C",
  PRIMARY KEY ("id"),
  UNIQUE ("batch_id","position")
);

CREATE TABLE "studio_batches" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "template_id" text COLLATE "C" NOT NULL,
  "template_version" bigint NOT NULL,
  "template_snapshot" text COLLATE "C" NOT NULL,
  "input_format" text COLLATE "C" NOT NULL,
  "input_content" text COLLATE "C" NOT NULL,
  "kind" text COLLATE "C" NOT NULL,
  "settings" text COLLATE "C" NOT NULL,
  "max_in_flight" bigint NOT NULL,
  "max_attempts" bigint NOT NULL,
  "status" text COLLATE "C" DEFAULT 'running' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "plan_hash" text COLLATE "C" NOT NULL,
  "rights_confirmed_at" text COLLATE "C" NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "last_dispatch_at" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "studio_brand_kits" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "style" text COLLATE "C" NOT NULL,
  "license_note" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "studio_character_versions" (
  "character_id" text COLLATE "C" NOT NULL,
  "version" bigint NOT NULL,
  "payload" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("character_id","version")
);

CREATE TABLE "studio_characters" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "kind" text COLLATE "C" NOT NULL,
  "visual_style" text COLLATE "C" NOT NULL,
  "source_asset_id" text COLLATE "C" NOT NULL,
  "source_version" bigint NOT NULL,
  "source_sha256" text COLLATE "C" NOT NULL,
  "consent_id" text COLLATE "C" NOT NULL,
  "parent_id" text COLLATE "C",
  "costume_label" text COLLATE "C" NOT NULL,
  "pose_label" text COLLATE "C" NOT NULL,
  "expires_at" text COLLATE "C" NOT NULL,
  "note" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "archived" bigint DEFAULT 0 NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "studio_clones" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "kind" text COLLATE "C" NOT NULL,
  "asset_id" text COLLATE "C" NOT NULL,
  "consent_id" text COLLATE "C" NOT NULL,
  "job_id" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'training' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "accepted_at" text COLLATE "C",
  "delete_status" text COLLATE "C" DEFAULT 'not_requested' NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "studio_comments" (
  "id" text COLLATE "C" NOT NULL,
  "project_id" text COLLATE "C" NOT NULL,
  "project_version" bigint NOT NULL,
  "author_id" text COLLATE "C" NOT NULL,
  "parent_id" text COLLATE "C",
  "anchor" text COLLATE "C" NOT NULL,
  "body" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "resolved_at" text COLLATE "C",
  "resolved_by" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "studio_content_asset_origins" (
  "asset_id" text COLLATE "C" NOT NULL,
  "origin_id" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("asset_id","origin_id")
);

CREATE TABLE "studio_content_brief_versions" (
  "brief_id" text COLLATE "C" NOT NULL,
  "version" bigint NOT NULL,
  "configuration" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("brief_id","version")
);

CREATE TABLE "studio_content_briefs" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "configuration" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "studio_content_draft_versions" (
  "draft_id" text COLLATE "C" NOT NULL,
  "version" bigint NOT NULL,
  "payload" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("draft_id","version")
);

CREATE TABLE "studio_content_drafts" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "root_id" text COLLATE "C" NOT NULL,
  "parent_id" text COLLATE "C",
  "payload" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "studio_content_origins" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "draft_id" text COLLATE "C" NOT NULL,
  "draft_version" bigint NOT NULL,
  "source_refs" text COLLATE "C" NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "expires_at" text COLLATE "C",
  PRIMARY KEY ("id")
);

CREATE TABLE "studio_content_plan_versions" (
  "plan_id" text COLLATE "C" NOT NULL,
  "version" bigint NOT NULL,
  "snapshot" text COLLATE "C" NOT NULL,
  "plan_hash" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("plan_id","version")
);

CREATE TABLE "studio_content_plans" (
  "id" text COLLATE "C" NOT NULL,
  "draft_id" text COLLATE "C" NOT NULL,
  "draft_version" bigint NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "kind" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "snapshot" text COLLATE "C" NOT NULL,
  "plan_hash" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'review' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "applied_resource_id" text COLLATE "C",
  "applied_resource_version" bigint,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "studio_content_source_versions" (
  "source_id" text COLLATE "C" NOT NULL,
  "version" bigint NOT NULL,
  "action" text COLLATE "C" NOT NULL,
  "material_sha256" text COLLATE "C" NOT NULL,
  "text_sha256" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("source_id","version")
);

CREATE TABLE "studio_content_sources" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "kind" text COLLATE "C" NOT NULL,
  "text" text COLLATE "C" NOT NULL,
  "paragraphs" text COLLATE "C" NOT NULL,
  "material_sha256" text COLLATE "C" NOT NULL,
  "text_sha256" text COLLATE "C" NOT NULL,
  "origin" text COLLATE "C" NOT NULL,
  "warnings" text COLLATE "C" NOT NULL,
  "subject" text COLLATE "C" NOT NULL,
  "proof" text COLLATE "C" NOT NULL,
  "expires_at" text COLLATE "C" NOT NULL,
  "withdrawn" bigint DEFAULT 0 NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "studio_content_writing_adoptions" (
  "job_id" text COLLATE "C" NOT NULL,
  "variant_index" bigint NOT NULL,
  "draft_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("job_id","variant_index"),
  UNIQUE ("draft_id"),
  CHECK (variant_index BETWEEN 0 AND 2)
);

CREATE TABLE "studio_content_writing_jobs" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "request" text COLLATE "C" NOT NULL,
  "engine" text COLLATE "C" NOT NULL,
  "input_hash" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "control_version" bigint DEFAULT 1 NOT NULL,
  "status" text COLLATE "C" DEFAULT 'queued' NOT NULL,
  "progress" double precision DEFAULT 0 NOT NULL,
  "attempts" bigint DEFAULT 0 NOT NULL,
  "lease_token" text COLLATE "C",
  "lease_until" text COLLATE "C",
  "result" text COLLATE "C",
  "evidence" text COLLATE "C",
  "result_hash" text COLLATE "C",
  "error_code" text COLLATE "C",
  "error_message" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  CHECK (status IN ('queued','processing','succeeded','failed','cancelled','stale'))
);

CREATE TABLE "studio_course_exports" (
  "id" text COLLATE "C" NOT NULL,
  "release_id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "standard" text COLLATE "C" NOT NULL,
  "plan_hash" text COLLATE "C" NOT NULL,
  "release_hash" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'queued' NOT NULL,
  "progress" bigint DEFAULT 0 NOT NULL,
  "attempts" bigint DEFAULT 0 NOT NULL,
  "lease_token" text COLLATE "C",
  "lease_until" text COLLATE "C",
  "storage_key" text COLLATE "C",
  "size" bigint,
  "sha256" text COLLATE "C",
  "error_message" text COLLATE "C",
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "studio_course_releases" (
  "id" text COLLATE "C" NOT NULL,
  "course_id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "course_version" bigint NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "snapshot" text COLLATE "C" NOT NULL,
  "release_hash" text COLLATE "C" NOT NULL,
  "withdrawn_at" text COLLATE "C",
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("course_id","course_version")
);

CREATE TABLE "studio_course_versions" (
  "course_id" text COLLATE "C" NOT NULL,
  "version" bigint NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "definition" text COLLATE "C" NOT NULL,
  "definition_hash" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("course_id","version")
);

CREATE TABLE "studio_courses" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "definition" text COLLATE "C" NOT NULL,
  "definition_hash" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "studio_export_artifacts" (
  "id" text COLLATE "C" NOT NULL,
  "export_id" text COLLATE "C" NOT NULL,
  "kind" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "media_type" text COLLATE "C" NOT NULL,
  "storage_key" text COLLATE "C" NOT NULL,
  "size" bigint NOT NULL,
  "sha256" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("storage_key")
);

CREATE TABLE "studio_exports" (
  "id" text COLLATE "C" NOT NULL,
  "project_id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "project_version" bigint NOT NULL,
  "plan_hash" text COLLATE "C" NOT NULL,
  "kind" text COLLATE "C" NOT NULL,
  "settings" text COLLATE "C" NOT NULL,
  "start_ms" bigint NOT NULL,
  "duration_ms" bigint NOT NULL,
  "status" text COLLATE "C" DEFAULT 'queued' NOT NULL,
  "attempts" bigint DEFAULT 0 NOT NULL,
  "lease_token" text COLLATE "C",
  "lease_until" text COLLATE "C",
  "progress" double precision DEFAULT 0 NOT NULL,
  "result" text COLLATE "C",
  "error_message" text COLLATE "C",
  "rights_confirmed_at" text COLLATE "C" NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "studio_frame_comments" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "review_id" text COLLATE "C" NOT NULL,
  "sequence" bigint NOT NULL,
  "author_type" text COLLATE "C" NOT NULL,
  "author_id" text COLLATE "C" NOT NULL,
  "author_name" text COLLATE "C" NOT NULL,
  "parent_id" text COLLATE "C",
  "visibility" text COLLATE "C" NOT NULL,
  "anchor" text COLLATE "C" NOT NULL,
  "body" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "resolved_at" text COLLATE "C",
  "resolved_by" text COLLATE "C",
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("review_id","sequence"),
  CHECK (author_type IN ('member','external')),
  CHECK (visibility IN ('team','external'))
);

CREATE TABLE "studio_frame_feedback" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "review_id" text COLLATE "C" NOT NULL,
  "session_id" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "decision" text COLLATE "C" NOT NULL,
  "note" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("session_id")
);

CREATE TABLE "studio_frame_requests" (
  "scope" text COLLATE "C" NOT NULL,
  "key_hash" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "request_hash" text COLLATE "C" NOT NULL,
  "result_id" text COLLATE "C" NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("scope","key_hash")
);

CREATE TABLE "studio_frame_review_links" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "review_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "title" text COLLATE "C" NOT NULL,
  "nonce" text COLLATE "C" NOT NULL,
  "token_hash" text COLLATE "C" NOT NULL,
  "expires_at" text COLLATE "C" NOT NULL,
  "can_comment" bigint NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "revoked_at" text COLLATE "C",
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("token_hash")
);

CREATE TABLE "studio_frame_review_sessions" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "link_id" text COLLATE "C" NOT NULL,
  "nonce" text COLLATE "C" NOT NULL,
  "token_hash" text COLLATE "C" NOT NULL,
  "csrf_token" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "expires_at" text COLLATE "C" NOT NULL,
  "revoked_at" text COLLATE "C",
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("token_hash")
);

CREATE TABLE "studio_frame_reviews" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "project_id" text COLLATE "C" NOT NULL,
  "project_version" bigint NOT NULL,
  "export_id" text COLLATE "C" NOT NULL,
  "artifact_id" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "rights_note" text COLLATE "C" NOT NULL,
  "snapshot" text COLLATE "C" NOT NULL,
  "snapshot_hash" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'queued' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "progress" double precision DEFAULT 0 NOT NULL,
  "attempts" bigint DEFAULT 0 NOT NULL,
  "lease_token" text COLLATE "C",
  "lease_until" text COLLATE "C",
  "media" text COLLATE "C",
  "media_hash" text COLLATE "C",
  "storage_key" text COLLATE "C",
  "invalidated_at" text COLLATE "C",
  "error_code" text COLLATE "C",
  "error_message" text COLLATE "C",
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "studio_import_media" (
  "id" text COLLATE "C" NOT NULL,
  "import_id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "storage_key" text COLLATE "C" NOT NULL,
  "sha256" text COLLATE "C" NOT NULL,
  "width" bigint NOT NULL,
  "height" bigint NOT NULL,
  "kind" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "studio_imports" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "file_name" text COLLATE "C" NOT NULL,
  "format" text COLLATE "C" NOT NULL,
  "storage_key" text COLLATE "C" NOT NULL,
  "sha256" text COLLATE "C" NOT NULL,
  "size" bigint NOT NULL,
  "rights_note" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'queued' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "attempts" bigint DEFAULT 0 NOT NULL,
  "lease_token" text COLLATE "C",
  "lease_until" text COLLATE "C",
  "result" text COLLATE "C",
  "error_code" text COLLATE "C",
  "error_message" text COLLATE "C",
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "studio_language_links" (
  "id" text COLLATE "C" NOT NULL,
  "source_project_id" text COLLATE "C" NOT NULL,
  "source_version" bigint NOT NULL,
  "target_project_id" text COLLATE "C" NOT NULL,
  "source_locale" text COLLATE "C" NOT NULL,
  "target_locale" text COLLATE "C" NOT NULL,
  "dictionary_id" text COLLATE "C",
  "dictionary_version" bigint,
  "source_snapshot" text COLLATE "C" NOT NULL,
  "method" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("target_project_id")
);

CREATE TABLE "studio_media_applications" (
  "id" text COLLATE "C" NOT NULL,
  "job_id" text COLLATE "C" NOT NULL,
  "request_hash" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "project_id" text COLLATE "C" NOT NULL,
  "kind" text COLLATE "C" NOT NULL,
  "previous_version" bigint,
  "applied_version" bigint NOT NULL,
  "reverted_version" bigint,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("job_id","actor_id","request_hash")
);

CREATE TABLE "studio_media_jobs" (
  "id" text COLLATE "C" NOT NULL,
  "plan_id" text COLLATE "C" NOT NULL,
  "plan_version" bigint NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "input_snapshot" text COLLATE "C" NOT NULL,
  "input_hash" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'queued' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "progress" double precision DEFAULT 0 NOT NULL,
  "attempts" bigint DEFAULT 0 NOT NULL,
  "lease_token" text COLLATE "C",
  "lease_until" text COLLATE "C",
  "report" text COLLATE "C",
  "error_code" text COLLATE "C",
  "error_message" text COLLATE "C",
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "studio_media_outputs" (
  "id" text COLLATE "C" NOT NULL,
  "job_id" text COLLATE "C" NOT NULL,
  "asset_id" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "media_type" text COLLATE "C" NOT NULL,
  "storage_key" text COLLATE "C" NOT NULL,
  "size" bigint NOT NULL,
  "sha256" text COLLATE "C" NOT NULL,
  "specs" text COLLATE "C" NOT NULL,
  "source_start_ms" bigint NOT NULL,
  "source_duration_ms" bigint,
  "alpha" bigint NOT NULL,
  "preview_key" text COLLATE "C",
  "preview_sha256" text COLLATE "C",
  "preview_size" bigint,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("asset_id")
);

CREATE TABLE "studio_media_plan_versions" (
  "plan_id" text COLLATE "C" NOT NULL,
  "version" bigint NOT NULL,
  "payload" text COLLATE "C" NOT NULL,
  "plan_hash" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("plan_id","version")
);

CREATE TABLE "studio_media_plans" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "payload" text COLLATE "C" NOT NULL,
  "plan_hash" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "withdrawn_at" text COLLATE "C",
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "studio_package_imports" (
  "transfer_id" text COLLATE "C" NOT NULL,
  "project_id" text COLLATE "C" NOT NULL,
  "source_sha256" text COLLATE "C" NOT NULL,
  "asset_id_map" text COLLATE "C" NOT NULL,
  "non_portable" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("transfer_id")
);

CREATE TABLE "studio_presentation_answer_jobs" (
  "id" text COLLATE "C" NOT NULL,
  "session_id" text COLLATE "C" NOT NULL,
  "question_id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "source_hash" text COLLATE "C" NOT NULL,
  "request" text COLLATE "C" NOT NULL,
  "configuration" text COLLATE "C" NOT NULL,
  "input_hash" text COLLATE "C" NOT NULL,
  "control_generation" bigint NOT NULL,
  "status" text COLLATE "C" DEFAULT 'queued' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "attempts" bigint DEFAULT 0 NOT NULL,
  "progress" double precision DEFAULT 0 NOT NULL,
  "lease_token" text COLLATE "C",
  "lease_until" text COLLATE "C",
  "result" text COLLATE "C",
  "evidence" text COLLATE "C",
  "audio_key" text COLLATE "C",
  "audio_format" text COLLATE "C",
  "error_code" text COLLATE "C",
  "error_message" text COLLATE "C",
  "playback_version" bigint DEFAULT 0 NOT NULL,
  "playback_state" text COLLATE "C" DEFAULT 'idle' NOT NULL,
  "playback_actor_id" text COLLATE "C",
  "playback_client_id" text COLLATE "C",
  "playback_started_at" text COLLATE "C",
  "playback_lease_until" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("question_id")
);

CREATE TABLE "studio_presentation_applications" (
  "plan_id" text COLLATE "C" NOT NULL,
  "plan_version" bigint NOT NULL,
  "project_id" text COLLATE "C" NOT NULL,
  "document_hash" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("plan_id","plan_version"),
  UNIQUE ("project_id")
);

CREATE TABLE "studio_presentation_plan_versions" (
  "plan_id" text COLLATE "C" NOT NULL,
  "version" bigint NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "definition" text COLLATE "C" NOT NULL,
  "definition_hash" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("plan_id","version")
);

CREATE TABLE "studio_presentation_plans" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "source_project_id" text COLLATE "C" NOT NULL,
  "source_project_version" bigint NOT NULL,
  "source_hash" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "definition" text COLLATE "C" NOT NULL,
  "definition_hash" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "studio_presentation_questions" (
  "id" text COLLATE "C" NOT NULL,
  "session_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "page_id" text COLLATE "C" NOT NULL,
  "position_ms" bigint NOT NULL,
  "body" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'pending' NOT NULL,
  "answer" text COLLATE "C",
  "answer_by" text COLLATE "C",
  "answer_at" text COLLATE "C",
  "version" bigint DEFAULT 1 NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "answer_job_id" text COLLATE "C",
  PRIMARY KEY ("id")
);

CREATE TABLE "studio_presentation_sessions" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "project_id" text COLLATE "C" NOT NULL,
  "project_version" bigint NOT NULL,
  "source_hash" text COLLATE "C" NOT NULL,
  "export_id" text COLLATE "C" NOT NULL,
  "artifact_id" text COLLATE "C" NOT NULL,
  "artifact_hash" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "chapters" text COLLATE "C" NOT NULL,
  "captions" text COLLATE "C" NOT NULL,
  "duration_ms" bigint NOT NULL,
  "state" text COLLATE "C" DEFAULT 'ready' NOT NULL,
  "position_ms" bigint DEFAULT 0 NOT NULL,
  "anchor_at" text COLLATE "C",
  "version" bigint DEFAULT 1 NOT NULL,
  "active_question_id" text COLLATE "C",
  "resume_state" text COLLATE "C",
  "resume_position_ms" bigint,
  "invalidated_at" text COLLATE "C",
  "invalidation_reason" text COLLATE "C",
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  "answer_mode" text COLLATE "C" DEFAULT 'human_text' NOT NULL,
  "answer_configuration" text COLLATE "C",
  "answer_generation" bigint DEFAULT 1 NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "studio_preview_frames" (
  "id" text COLLATE "C" NOT NULL,
  "project_id" text COLLATE "C" NOT NULL,
  "segment_id" text COLLATE "C" NOT NULL,
  "fingerprint" text COLLATE "C" NOT NULL,
  "storage_key" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" NOT NULL,
  "width" bigint NOT NULL,
  "height" bigint NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("project_id","segment_id","fingerprint")
);

CREATE TABLE "studio_preview_jobs" (
  "id" text COLLATE "C" NOT NULL,
  "project_id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "project_version" bigint NOT NULL,
  "plan_hash" text COLLATE "C" NOT NULL,
  "segment_ids" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'queued' NOT NULL,
  "attempts" bigint DEFAULT 0 NOT NULL,
  "lease_token" text COLLATE "C",
  "lease_until" text COLLATE "C",
  "error_message" text COLLATE "C",
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "studio_project_versions" (
  "project_id" text COLLATE "C" NOT NULL,
  "version" bigint NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "document" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("project_id","version")
);

CREATE TABLE "studio_projects" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "purpose" text COLLATE "C" NOT NULL,
  "document" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "archived" bigint DEFAULT 0 NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "studio_recording_applications" (
  "id" text COLLATE "C" NOT NULL,
  "recording_id" text COLLATE "C" NOT NULL,
  "request_hash" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "project_id" text COLLATE "C" NOT NULL,
  "project_version" bigint NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("recording_id","actor_id","request_hash")
);

CREATE TABLE "studio_recording_outputs" (
  "recording_id" text COLLATE "C" NOT NULL,
  "transfer_id" text COLLATE "C" NOT NULL,
  "raw_key" text COLLATE "C" NOT NULL,
  "raw_sha256" text COLLATE "C" NOT NULL,
  "raw_size" bigint NOT NULL,
  "input_container" text COLLATE "C" NOT NULL,
  "asset_id" text COLLATE "C" NOT NULL,
  "output_sha256" text COLLATE "C" NOT NULL,
  "output_size" bigint NOT NULL,
  "source_specs" text COLLATE "C" NOT NULL,
  "specs" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("recording_id"),
  UNIQUE ("asset_id"),
  UNIQUE ("transfer_id")
);

CREATE TABLE "studio_recording_versions" (
  "recording_id" text COLLATE "C" NOT NULL,
  "version" bigint NOT NULL,
  "action" text COLLATE "C" NOT NULL,
  "snapshot" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("recording_id","version")
);

CREATE TABLE "studio_recordings" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "snapshot" text COLLATE "C" NOT NULL,
  "subject" text COLLATE "C" NOT NULL,
  "proof" text COLLATE "C" NOT NULL,
  "expires_at" text COLLATE "C" NOT NULL,
  "withdrawn_at" text COLLATE "C",
  "transfer_id" text COLLATE "C",
  "duration_hint_ms" bigint,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("transfer_id")
);

CREATE TABLE "studio_review_plans" (
  "id" text COLLATE "C" NOT NULL,
  "project_id" text COLLATE "C" NOT NULL,
  "project_version" bigint NOT NULL,
  "plan_hash" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "confirmed_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "studio_reviews" (
  "id" text COLLATE "C" NOT NULL,
  "project_id" text COLLATE "C" NOT NULL,
  "project_version" bigint NOT NULL,
  "stage" text COLLATE "C" NOT NULL,
  "export_id" text COLLATE "C",
  "requester_id" text COLLATE "C" NOT NULL,
  "reviewer_id" text COLLATE "C" NOT NULL,
  "last_editor_id" text COLLATE "C" NOT NULL,
  "snapshot_hash" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'pending' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "note" text COLLATE "C" DEFAULT '' NOT NULL,
  "decision_at" text COLLATE "C",
  "invalidated_at" text COLLATE "C",
  "invalidation_reason" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "studio_share_event_requests" (
  "session_id" text COLLATE "C" NOT NULL,
  "key_hash" text COLLATE "C" NOT NULL,
  "request_hash" text COLLATE "C" NOT NULL,
  "event_id" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("session_id","key_hash")
);

CREATE TABLE "studio_share_events" (
  "id" text COLLATE "C" NOT NULL,
  "session_id" text COLLATE "C" NOT NULL,
  "type" text COLLATE "C" NOT NULL,
  "time_ms" bigint NOT NULL,
  "widget_id" text COLLATE "C",
  "option_id" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  "expires_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "studio_share_join_requests" (
  "link_id" text COLLATE "C" NOT NULL,
  "link_version" bigint NOT NULL,
  "key_hash" text COLLATE "C" NOT NULL,
  "request_hash" text COLLATE "C" NOT NULL,
  "session_id" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("link_id","link_version","key_hash")
);

CREATE TABLE "studio_share_links" (
  "id" text COLLATE "C" NOT NULL,
  "release_id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "title" text COLLATE "C" NOT NULL,
  "access" text COLLATE "C" NOT NULL,
  "nonce" text COLLATE "C" NOT NULL,
  "token_hash" text COLLATE "C" NOT NULL,
  "embed_origins" text COLLATE "C" NOT NULL,
  "recording_enabled" bigint NOT NULL,
  "retention_days" bigint NOT NULL,
  "expires_at" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "revoked_at" text COLLATE "C",
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  CHECK (access IN ('unlisted','public')),
  CHECK (recording_enabled IN (0,1)),
  CHECK (retention_days BETWEEN 1 AND 90)
);

CREATE TABLE "studio_share_releases" (
  "id" text COLLATE "C" NOT NULL,
  "share_id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "share_version" bigint NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "snapshot" text COLLATE "C" NOT NULL,
  "release_hash" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "withdrawn_at" text COLLATE "C",
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("share_id","share_version")
);

CREATE TABLE "studio_share_sessions" (
  "id" text COLLATE "C" NOT NULL,
  "link_id" text COLLATE "C" NOT NULL,
  "link_version" bigint NOT NULL,
  "nonce" text COLLATE "C" NOT NULL,
  "token_hash" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "consent" bigint DEFAULT 0 NOT NULL,
  "position_ms" bigint DEFAULT 0 NOT NULL,
  "event_count" bigint DEFAULT 0 NOT NULL,
  "records_expires_at" text COLLATE "C",
  "expires_at" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("token_hash"),
  CHECK (consent IN (0,1))
);

CREATE TABLE "studio_share_versions" (
  "share_id" text COLLATE "C" NOT NULL,
  "version" bigint NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "variant_id" text COLLATE "C" NOT NULL,
  "definition" text COLLATE "C" NOT NULL,
  "definition_hash" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("share_id","version")
);

CREATE TABLE "studio_shares" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "variant_id" text COLLATE "C" NOT NULL,
  "definition" text COLLATE "C" NOT NULL,
  "definition_hash" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "studio_speech_jobs" (
  "id" text COLLATE "C" NOT NULL,
  "project_id" text COLLATE "C" NOT NULL,
  "project_version" bigint NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "provider_id" text COLLATE "C" NOT NULL,
  "voice_id" text COLLATE "C" NOT NULL,
  "locale" text COLLATE "C" NOT NULL,
  "style_id" text COLLATE "C",
  "style_version" bigint,
  "dictionary_id" text COLLATE "C",
  "dictionary_version" bigint,
  "input_snapshot" text COLLATE "C" NOT NULL,
  "input_hash" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'queued' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "attempts" bigint DEFAULT 0 NOT NULL,
  "lease_token" text COLLATE "C",
  "lease_until" text COLLATE "C",
  "outputs" text COLLATE "C" DEFAULT '[]' NOT NULL,
  "error_code" text COLLATE "C",
  "error_message" text COLLATE "C",
  "applied_project_version" bigint,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "studio_subtitle_editions" (
  "id" text COLLATE "C" NOT NULL,
  "project_id" text COLLATE "C" NOT NULL,
  "base_project_version" bigint NOT NULL,
  "locale" text COLLATE "C" NOT NULL,
  "cues" text COLLATE "C" NOT NULL,
  "timing_source" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'draft' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "applied_project_version" bigint,
  "applied_track_id" text COLLATE "C",
  "actor_id" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "studio_subtitle_revisions" (
  "edition_id" text COLLATE "C" NOT NULL,
  "version" bigint NOT NULL,
  "payload" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("edition_id","version")
);

CREATE TABLE "studio_template_instantiations" (
  "project_id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "template_id" text COLLATE "C" NOT NULL,
  "template_version" bigint NOT NULL,
  "template_snapshot" text COLLATE "C" NOT NULL,
  "variables" text COLLATE "C" NOT NULL,
  "parameters" text COLLATE "C",
  "plan_hash" text COLLATE "C" NOT NULL,
  "document_hash" text COLLATE "C" NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("project_id")
);

CREATE TABLE "studio_template_versions" (
  "template_id" text COLLATE "C" NOT NULL,
  "version" bigint NOT NULL,
  "snapshot" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("template_id","version")
);

CREATE TABLE "studio_templates" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "description" text COLLATE "C" NOT NULL,
  "purpose" text COLLATE "C" NOT NULL,
  "document" text COLLATE "C" NOT NULL,
  "variables" text COLLATE "C" NOT NULL,
  "license_note" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  "controls" text COLLATE "C",
  PRIMARY KEY ("id")
);

CREATE TABLE "studio_timeline_previews" (
  "id" text COLLATE "C" NOT NULL,
  "project_id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "project_version" bigint NOT NULL,
  "plan_hash" text COLLATE "C" NOT NULL,
  "start_ms" bigint NOT NULL,
  "duration_ms" bigint NOT NULL,
  "status" text COLLATE "C" DEFAULT 'queued' NOT NULL,
  "attempts" bigint DEFAULT 0 NOT NULL,
  "lease_token" text COLLATE "C",
  "lease_until" text COLLATE "C",
  "progress" double precision DEFAULT 0 NOT NULL,
  "video_key" text COLLATE "C",
  "audio_key" text COLLATE "C",
  "result" text COLLATE "C",
  "error_message" text COLLATE "C",
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "studio_transcription_revisions" (
  "transcription_id" text COLLATE "C" NOT NULL,
  "version" bigint NOT NULL,
  "review" text COLLATE "C" NOT NULL,
  "review_hash" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("transcription_id","version")
);

CREATE TABLE "studio_transcription_sources" (
  "source_id" text COLLATE "C" NOT NULL,
  "transcription_id" text COLLATE "C" NOT NULL,
  "review_version" bigint NOT NULL,
  "review_hash" text COLLATE "C" NOT NULL,
  "confirmation_hash" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("source_id"),
  UNIQUE ("transcription_id","review_version")
);

CREATE TABLE "studio_transcriptions" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "snapshot" text COLLATE "C" NOT NULL,
  "input_hash" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'queued' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "progress" double precision DEFAULT 0 NOT NULL,
  "attempts" bigint DEFAULT 0 NOT NULL,
  "lease_token" text COLLATE "C",
  "lease_until" text COLLATE "C",
  "analysis" text COLLATE "C",
  "analysis_hash" text COLLATE "C",
  "audio_key" text COLLATE "C",
  "audio_sha256" text COLLATE "C",
  "audio_size" bigint,
  "review" text COLLATE "C",
  "review_version" bigint,
  "review_hash" text COLLATE "C",
  "source_id" text COLLATE "C",
  "withdrawn_at" text COLLATE "C",
  "error_code" text COLLATE "C",
  "error_message" text COLLATE "C",
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "tenants" (
  "id" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "daily_limit" bigint DEFAULT 100 NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "tour_bookings" (
  "id" text COLLATE "C" NOT NULL,
  "slot_id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "group_name" text COLLATE "C" NOT NULL,
  "party_size" bigint NOT NULL,
  "language" text COLLATE "C" NOT NULL,
  "note" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'reserved' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "tour_questions" (
  "id" text COLLATE "C" NOT NULL,
  "session_id" text COLLATE "C" NOT NULL,
  "audience_label" text COLLATE "C" NOT NULL,
  "text" text COLLATE "C" NOT NULL,
  "answer" text COLLATE "C",
  "citations" text COLLATE "C" DEFAULT '[]' NOT NULL,
  "status" text COLLATE "C" DEFAULT 'queued' NOT NULL,
  "focus_version" bigint NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "answered_at" text COLLATE "C",
  PRIMARY KEY ("id")
);

CREATE TABLE "tour_routes" (
  "id" text COLLATE "C" NOT NULL,
  "hall_id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "steps" text COLLATE "C" NOT NULL,
  "enabled" bigint NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "tour_sessions" (
  "id" text COLLATE "C" NOT NULL,
  "hall_id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "route_id" text COLLATE "C" NOT NULL,
  "route_version" bigint NOT NULL,
  "booking_id" text COLLATE "C",
  "snapshot" text COLLATE "C" NOT NULL,
  "scene_snapshot" text COLLATE "C" NOT NULL,
  "language" text COLLATE "C" NOT NULL,
  "group_size" bigint NOT NULL,
  "device_id" text COLLATE "C",
  "auto_devices" bigint DEFAULT 0 NOT NULL,
  "status" text COLLATE "C" DEFAULT 'ready' NOT NULL,
  "cursor" text COLLATE "C" NOT NULL,
  "resume_cursor" text COLLATE "C",
  "active_question_id" text COLLATE "C",
  "play_started_at" text COLLATE "C",
  "last_reason" text COLLATE "C" DEFAULT 'awaiting_start' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "focus_version" bigint DEFAULT 0 NOT NULL,
  "playback_epoch" bigint DEFAULT 0 NOT NULL,
  "access_version" bigint DEFAULT 1 NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  "expires_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "tour_slots" (
  "id" text COLLATE "C" NOT NULL,
  "hall_id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "starts_at" text COLLATE "C" NOT NULL,
  "ends_at" text COLLATE "C" NOT NULL,
  "capacity" bigint NOT NULL,
  "open" bigint DEFAULT 1 NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "uploads" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "owner_id" text COLLATE "C" NOT NULL,
  "storage_key" text COLLATE "C" NOT NULL,
  "sha256" text COLLATE "C" NOT NULL,
  "size" bigint NOT NULL,
  "media_type" text COLLATE "C" NOT NULL,
  "specs" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "users" (
  "id" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "venues" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "timezone" text COLLATE "C" DEFAULT 'Asia/Shanghai' NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "video_sources" (
  "asset_id" text COLLATE "C" NOT NULL,
  "poster_key" text COLLATE "C" NOT NULL,
  "poster_sha256" text COLLATE "C" NOT NULL,
  "poster_size" bigint NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("asset_id"),
  UNIQUE ("poster_key")
);

CREATE TABLE "visit_confirmation_targets" (
  "visit_id" text COLLATE "C" NOT NULL,
  "user_id" text COLLATE "C",
  PRIMARY KEY ("visit_id")
);

CREATE TABLE "visit_deliveries" (
  "id" text COLLATE "C" NOT NULL,
  "visit_id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "recipient_user_id" text COLLATE "C" NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "scenario" text COLLATE "C" DEFAULT 'normal' NOT NULL,
  "attempts" bigint DEFAULT 0 NOT NULL,
  "lease_token" text COLLATE "C",
  "lease_until" text COLLATE "C",
  "remote_id" text COLLATE "C",
  "error_code" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("visit_id"),
  CHECK (status IN ('queued','submitting','submitted','delivered','acknowledged','failed','unknown','cancelled'))
);

CREATE TABLE "visits" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "venue_id" text COLLATE "C" NOT NULL,
  "session_id" text COLLATE "C" NOT NULL,
  "host_id" text COLLATE "C",
  "host_name" text COLLATE "C" NOT NULL,
  "guest_name" text COLLATE "C" NOT NULL,
  "company" text COLLATE "C" NOT NULL,
  "purpose" text COLLATE "C" NOT NULL,
  "appointment_ref" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "focus_version" bigint NOT NULL,
  "confirmed_hash" text COLLATE "C",
  "confirmed_at" text COLLATE "C",
  "notice_version" text COLLATE "C",
  "host_deadline" text COLLATE "C",
  "responded_by" text COLLATE "C",
  "host_private_note" text COLLATE "C",
  "guidance_code" text COLLATE "C",
  "escalated_reason" text COLLATE "C",
  "completed_at" text COLLATE "C",
  "mock_scenario" text COLLATE "C" DEFAULT 'normal' NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("session_id"),
  CHECK (status IN ('draft','awaiting_confirmation','notifying','waiting_host','accepted','declined','escalated','completed','cancelled'))
);

CREATE TABLE "visual_grants" (
  "id" text COLLATE "C" NOT NULL,
  "session_id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "focus_version" bigint NOT NULL,
  "source" text COLLATE "C" NOT NULL,
  "provider_id" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" DEFAULT 'active' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "expires_at" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "revoked_at" text COLLATE "C",
  "ended_reason" text COLLATE "C",
  PRIMARY KEY ("id")
);

CREATE TABLE "visual_requests" (
  "id" text COLLATE "C" NOT NULL,
  "session_id" text COLLATE "C" NOT NULL,
  "grant_id" text COLLATE "C" NOT NULL,
  "key_hash" text COLLATE "C" NOT NULL,
  "request_hash" text COLLATE "C" NOT NULL,
  "focus_version" bigint NOT NULL,
  "reply_epoch" bigint NOT NULL,
  "grant_version" bigint NOT NULL,
  "image_hash" text COLLATE "C" NOT NULL,
  "width" bigint NOT NULL,
  "height" bigint NOT NULL,
  "status" text COLLATE "C" DEFAULT 'pending' NOT NULL,
  "reply_id" text COLLATE "C",
  "error_code" text COLLATE "C",
  "created_at" text COLLATE "C" NOT NULL,
  "expires_at" text COLLATE "C" NOT NULL,
  "completed_at" text COLLATE "C",
  PRIMARY KEY ("id"),
  UNIQUE ("session_id","key_hash")
);

CREATE TABLE "voice_style_versions" (
  "style_id" text COLLATE "C" NOT NULL,
  "version" bigint NOT NULL,
  "payload" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("style_id","version")
);

CREATE TABLE "voice_styles" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "workspace_id" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "preset" text COLLATE "C" NOT NULL,
  "controls" text COLLATE "C" NOT NULL,
  "reference_asset_id" text COLLATE "C",
  "reference_consent_id" text COLLATE "C",
  "note" text COLLATE "C" DEFAULT '' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "environment" text COLLATE "C" NOT NULL,
  "app_env" text COLLATE "C" NOT NULL,
  "created_at" text COLLATE "C" NOT NULL,
  "updated_at" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "workspaces" (
  "id" text COLLATE "C" NOT NULL,
  "tenant_id" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  PRIMARY KEY ("id")
);

CREATE INDEX ad_account_reservations ON ad_budget_reservations(account_id,campaign_id);

CREATE INDEX ad_account_scope ON ad_accounts(tenant_id,workspace_id,environment,app_env,id);

CREATE UNIQUE INDEX ad_alert_identity ON ad_alerts(account_id,COALESCE(campaign_id,''),kind,day);

CREATE INDEX ad_campaign_scope ON ad_campaigns(tenant_id,workspace_id,environment,app_env,id);

CREATE INDEX ad_ledger_account_day ON ad_spend_ledger(account_id,budget_day);

CREATE INDEX ad_run_queue ON ad_runs(status,scheduled_at,lease_until);

CREATE INDEX ae_batch_scope ON ae_batches(tenant_id,workspace_id,environment,app_env,id);

CREATE INDEX ae_job_queue ON ae_render_jobs(status,lease_until,created_at,id);

CREATE INDEX ae_media_queue ON ae_media_adoptions(environment,app_env,status,lease_until,created_at,id);

CREATE INDEX ae_media_scope ON ae_media_adoptions(tenant_id,workspace_id,environment,app_env,id);

CREATE INDEX ae_source_queue ON ae_source_exports(environment,app_env,status,lease_until,created_at,id);

CREATE INDEX ae_source_scope ON ae_source_exports(tenant_id,workspace_id,environment,app_env,id);

CREATE INDEX asset_collection_receipt_queue ON asset_collection_receipts(environment,app_env,status,lease_until,created_at);

CREATE INDEX asset_collection_receipt_scope ON asset_collection_receipts(tenant_id,workspace_id,environment,app_env,collection_id,id);

CREATE INDEX asset_collection_request_budget ON asset_collection_requests(scope_group,environment,app_env);

CREATE INDEX asset_collection_scope ON asset_collections(tenant_id,workspace_id,environment,app_env,id);

CREATE INDEX asset_library_family_folder ON asset_library_families(folder_id,id);

CREATE INDEX asset_library_family_scope ON asset_library_families(tenant_id,workspace_id,merged_into,id);

CREATE UNIQUE INDEX asset_library_folder_name ON asset_library_folders(tenant_id,workspace_id,coalesce(parent_id,''),name_key) WHERE archived=0;

CREATE INDEX asset_library_folder_scope ON asset_library_folders(tenant_id,workspace_id,archived);

CREATE UNIQUE INDEX character_jobs_active ON character_jobs(character_id,input_hash) WHERE status IN ('queued','rendering');

CREATE INDEX character_jobs_queue ON character_jobs(environment,app_env,status,created_at);

CREATE INDEX character_motion_project ON character_motion_plans(project_id,created_at);

CREATE INDEX content_governance_scope ON content_governance_deliveries(tenant_id,workspace_id,environment,app_env,id);

CREATE INDEX content_governance_variant ON content_governance_deliveries(variant_id,created_at);

CREATE INDEX content_writing_claim ON studio_content_writing_jobs(environment,app_env,status,created_at,id);

CREATE INDEX content_writing_space ON studio_content_writing_jobs(tenant_id,workspace_id,environment,app_env,id);

CREATE INDEX conversation_tools_session ON conversation_tool_requests(session_id,status,expires_at);

CREATE UNIQUE INDEX course_active_enrollment ON course_enrollments(release_id,actor_id) WHERE revoked_at IS NULL;

CREATE INDEX course_learner_scope ON course_enrollments(tenant_id,workspace_id,environment,app_env,actor_id,id);

CREATE INDEX dining_hold_expiry ON dining_occupancies(state,expires_at);

CREATE UNIQUE INDEX dining_one_party_table ON dining_occupancies(party_id) WHERE state IN ('held','seated');

CREATE UNIQUE INDEX dining_one_table_owner ON dining_occupancies(table_id) WHERE state IN ('held','seated');

CREATE INDEX dining_party_owner ON dining_parties(owner_session_id,restaurant_id,status);

CREATE INDEX dining_reservation_intervals ON dining_reservations(table_id,status,starts_at,ends_at);

CREATE INDEX dining_service_queue ON dining_service_requests(restaurant_id,status,created_at,id);

CREATE UNIQUE INDEX dining_service_source_once ON dining_service_requests(source_request_id) WHERE source_request_id IS NOT NULL;

CREATE UNIQUE INDEX distribution_one_pending_review ON distribution_reviews(variant_id) WHERE status='pending' AND invalidated_at IS NULL;

CREATE INDEX exhibit_command_queue ON exhibit_device_commands(status,created_at);

CREATE INDEX exhibition_hall_scope ON exhibition_halls(tenant_id,workspace_id,environment,app_env,id);

CREATE INDEX jobs_queue ON jobs(environment, status, available_at, lease_until);

CREATE INDEX knowledge_document_collection ON knowledge_documents(collection_id,published_version_id);

CREATE UNIQUE INDEX learning_active_attempt ON learning_attempts(enrollment_id) WHERE completed=0;

CREATE INDEX learning_attempt_scope ON learning_attempts(tenant_id,workspace_id,environment,app_env,actor_id,id);

CREATE INDEX live_answer_queue ON live_answer_jobs(environment,app_env,status,created_at,id);

CREATE INDEX live_answer_session ON live_answer_jobs(session_id,created_at,id);

CREATE INDEX live_audience_rate ON live_audience_events(session_id,participant_hash,created_at);

CREATE UNIQUE INDEX live_guest_programme_one_peer ON live_guest_programme_connections(peer_attempt_id) WHERE status IN ('queued','connecting','connected');

CREATE INDEX live_guest_programme_runtime ON live_guest_programme_connections(output_id,status,guest_lease_until);

CREATE INDEX live_guest_programme_scope ON live_guest_programme_grants(tenant_id,workspace_id,environment,app_env,output_id,status);

CREATE INDEX live_output_queue ON live_outputs(environment,app_env,status,lease_until);

CREATE INDEX live_output_scope ON live_outputs(tenant_id,workspace_id,environment,app_env,id);

CREATE INDEX live_peer_attempt_lifecycle ON live_peer_attempts(status,host_lease_until,guest_lease_until);

CREATE INDEX live_peer_invite_scope ON live_peer_invites(tenant_id,workspace_id,environment,app_env,session_id,id);

CREATE UNIQUE INDEX live_peer_one_active ON live_peer_attempts(guest_id) WHERE status='active';

CREATE INDEX live_program_scope ON live_programs(tenant_id,workspace_id,environment,app_env,id);

CREATE INDEX live_recording_queue ON live_recordings(environment,app_env,status,lease_until);

CREATE INDEX live_session_running ON live_sessions(environment,app_env,status,scheduled_at);

CREATE INDEX live_session_scope ON live_sessions(tenant_id,workspace_id,environment,app_env,id);

CREATE UNIQUE INDEX live_speech_cue_once ON live_speech_jobs(plan_id,((source::jsonb)->'cueId')) WHERE (source::jsonb)->'kind'='"cue"'::jsonb;

CREATE INDEX live_speech_job_plan ON live_speech_jobs(plan_id,created_at,id);

CREATE INDEX live_speech_job_queue ON live_speech_jobs(environment,app_env,status,created_at,id);

CREATE INDEX live_speech_plan_scope ON live_speech_plans(session_id,created_at,id);

CREATE INDEX media_transfer_queue ON media_transfers(environment,app_env,status,lease_until,created_at);

CREATE INDEX memory_facts_person ON memory_facts(person_id,status,expires_at);

CREATE INDEX memory_links_person ON memory_session_links(person_id,session_id);

CREATE INDEX memory_recovery_person ON memory_recovery_credentials(person_id,revoked_at,expires_at);

CREATE INDEX mock_ad_due_reports ON mock_ad_reports(available_at,event_id);

CREATE INDEX office_notification_inbox ON office_notifications(tenant_id,workspace_id,recipient_user_id,id);

CREATE INDEX office_notification_queue ON office_notifications(environment,app_env,dispatch_status,due_at,lease_until);

CREATE INDEX office_relay_sender ON office_relays(tenant_id,workspace_id,sender_user_id,id);

CREATE UNIQUE INDEX one_active_reception_session ON reception_sessions(terminal_id) WHERE status IN ('active','human');

CREATE UNIQUE INDEX person_guest_scope ON people(guest_session_id) WHERE status='active' AND guest_session_id IS NOT NULL;

CREATE UNIQUE INDEX person_user_scope ON people(tenant_id,workspace_id,owner_user_id,environment,app_env) WHERE status='active' AND owner_user_id IS NOT NULL;

CREATE INDEX practice_release_scope ON practice_releases(tenant_id,workspace_id,environment,app_env,id);

CREATE INDEX practice_run_expiry ON practice_runs(environment,app_env,expires_at) WHERE phase<>'deleted';

CREATE INDEX practice_run_scope ON practice_runs(tenant_id,workspace_id,environment,app_env,actor_id,id);

CREATE INDEX practice_scenario_scope ON practice_scenarios(tenant_id,workspace_id,environment,app_env,id);

CREATE INDEX pronunciation_books_workspace ON pronunciation_books(tenant_id,workspace_id,environment,app_env,id);

CREATE INDEX publishing_due ON publishing_jobs(environment,app_env,status,scheduled_at,lease_until);

CREATE INDEX publishing_packages_queue ON publishing_packages(environment,app_env,status,lease_until,created_at);

CREATE INDEX reception_messages_session ON reception_messages(session_id,created_at,id);

CREATE INDEX restaurant_bill_list ON restaurant_bills(restaurant_id,party_id,created_at,id);

CREATE INDEX restaurant_dispatch_queue ON restaurant_order_dispatches(status,created_at);

CREATE INDEX restaurant_financial_queue ON restaurant_financial_operations(status,next_action,created_at,id);

CREATE UNIQUE INDEX restaurant_financial_quote_once ON restaurant_financial_operations(quote_id);

CREATE INDEX restaurant_kitchen_queue ON restaurant_kitchen_tickets(restaurant_id,accepted_at,id);

CREATE UNIQUE INDEX restaurant_one_pending_change ON restaurant_order_changes(order_id)
 WHERE status IN ('draft','awaiting_confirmation','confirmed','queued','submitting','submitted','unknown');

CREATE UNIQUE INDEX restaurant_one_pending_payment ON restaurant_financial_operations(bill_id)
 WHERE kind='payment' AND status IN ('queued','submitting','pending','unknown');

CREATE UNIQUE INDEX restaurant_one_unsettled_order ON restaurant_orders(party_id)
 WHERE status NOT IN ('closed','cancelled') AND settlement_status='unsettled';

CREATE INDEX restaurant_order_event_history ON restaurant_order_events(order_id,created_at,id);

CREATE INDEX restaurant_order_list ON restaurant_orders(restaurant_id,created_at,id);

CREATE INDEX restaurant_order_quote_history ON restaurant_order_quotes(change_id,created_at);

CREATE INDEX restaurant_stock_history ON restaurant_stock_adjustments(sku_id,created_at);

CREATE INDEX speaker_reference_owner ON speaker_references(tenant_id,workspace_id,owner_user_id,status,expires_at);

CREATE UNIQUE INDEX speaker_segment_final ON speaker_segment_decisions(session_id,focus_version,segment_id) WHERE final=1;

CREATE INDEX studio_assistant_generation_queue ON studio_assistant_generations(status,created_at,id);

CREATE INDEX studio_assistant_interpretation_queue ON studio_assistant_interpretations(environment,app_env,status,created_at,id);

CREATE UNIQUE INDEX studio_assistant_interpretation_turn ON studio_assistant_interpretations(turn_id) WHERE turn_id IS NOT NULL;

CREATE UNIQUE INDEX studio_assistant_one_interpretation ON studio_assistant_interpretations(session_id) WHERE status IN ('queued','processing');

CREATE INDEX studio_assistant_session_scope ON studio_assistant_sessions(tenant_id,workspace_id,environment,app_env,id);

CREATE INDEX studio_batch_dispatch ON studio_batches(environment,app_env,status,last_dispatch_at,created_at);

CREATE INDEX studio_batch_item_queue ON studio_batch_items(batch_id,status,position);

CREATE INDEX studio_characters_scope ON studio_characters(tenant_id,workspace_id,environment,app_env,id);

CREATE INDEX studio_comment_project ON studio_comments(project_id,created_at,id);

CREATE INDEX studio_content_briefs_scope ON studio_content_briefs(tenant_id,workspace_id,environment,app_env,id);

CREATE INDEX studio_content_drafts_scope ON studio_content_drafts(tenant_id,workspace_id,environment,app_env,id);

CREATE INDEX studio_content_plans_draft ON studio_content_plans(draft_id,created_at);

CREATE INDEX studio_content_sources_scope ON studio_content_sources(tenant_id,workspace_id,environment,app_env,id);

CREATE INDEX studio_course_export_queue ON studio_course_exports(environment,app_env,status,created_at,id);

CREATE INDEX studio_course_release_scope ON studio_course_releases(tenant_id,workspace_id,environment,app_env,id);

CREATE INDEX studio_course_scope ON studio_courses(tenant_id,workspace_id,environment,app_env,id);

CREATE INDEX studio_export_queue ON studio_exports(environment,app_env,status,lease_until,created_at);

CREATE UNIQUE INDEX studio_frame_review_active ON studio_frame_reviews(tenant_id,actor_id,export_id,snapshot_hash,environment,app_env) WHERE status IN ('queued','preparing');

CREATE INDEX studio_frame_review_queue ON studio_frame_reviews(environment,app_env,status,lease_until,created_at);

CREATE INDEX studio_import_queue ON studio_imports(environment,app_env,status,lease_until,created_at);

CREATE UNIQUE INDEX studio_media_jobs_active ON studio_media_jobs(plan_id,input_hash) WHERE status IN ('queued','processing');

CREATE INDEX studio_media_jobs_queue ON studio_media_jobs(environment,app_env,status,created_at);

CREATE INDEX studio_media_plans_scope ON studio_media_plans(tenant_id,workspace_id,environment,app_env,id);

CREATE INDEX studio_presentation_answer_queue ON studio_presentation_answer_jobs(environment,app_env,status,created_at,id);

CREATE UNIQUE INDEX studio_presentation_one_answer ON studio_presentation_answer_jobs(session_id) WHERE status IN ('queued','processing');

CREATE INDEX studio_presentation_plan_scope ON studio_presentation_plans(tenant_id,workspace_id,environment,app_env,id);

CREATE INDEX studio_presentation_question_session ON studio_presentation_questions(session_id,created_at,id);

CREATE INDEX studio_presentation_session_scope ON studio_presentation_sessions(tenant_id,workspace_id,environment,app_env,id);

CREATE INDEX studio_preview_queue ON studio_preview_jobs(environment,app_env,status,lease_until,created_at);

CREATE INDEX studio_project_scope ON studio_projects(tenant_id,workspace_id,environment,app_env,updated_at,id);

CREATE INDEX studio_recordings_scope ON studio_recordings(tenant_id,workspace_id,actor_id,environment,app_env,id);

CREATE INDEX studio_review_inbox ON studio_reviews(reviewer_id,status,created_at);

CREATE UNIQUE INDEX studio_review_pending ON studio_reviews(project_id,stage) WHERE status='pending' AND invalidated_at IS NULL;

CREATE INDEX studio_share_events_session ON studio_share_events(session_id,id);

CREATE INDEX studio_share_links_release ON studio_share_links(release_id,id);

CREATE INDEX studio_share_sessions_link ON studio_share_sessions(link_id,id);

CREATE INDEX studio_share_sessions_retention ON studio_share_sessions(records_expires_at);

CREATE INDEX studio_shares_scope ON studio_shares(tenant_id,workspace_id,environment,app_env,id);

CREATE INDEX studio_speech_jobs_queue ON studio_speech_jobs(status,created_at);

CREATE UNIQUE INDEX studio_speech_live_input ON studio_speech_jobs(project_id,input_hash) WHERE status IN ('queued','rendering');

CREATE INDEX studio_subtitle_project ON studio_subtitle_editions(project_id,created_at);

CREATE INDEX studio_template_origin_scope ON studio_template_instantiations(tenant_id,workspace_id,environment,app_env,project_id);

CREATE INDEX studio_timeline_queue ON studio_timeline_previews(environment,app_env,status,lease_until,created_at);

CREATE UNIQUE INDEX studio_transcriptions_active ON studio_transcriptions(tenant_id,workspace_id,actor_id,input_hash,environment,app_env) WHERE status IN ('queued','transcribing');

CREATE INDEX studio_transcriptions_queue ON studio_transcriptions(environment,app_env,status,created_at);

CREATE UNIQUE INDEX tour_live_booking ON tour_sessions(booking_id) WHERE booking_id IS NOT NULL AND status IN ('ready','explaining','paused','answering','human');

CREATE UNIQUE INDEX tour_live_device ON tour_sessions(device_id) WHERE device_id IS NOT NULL AND status IN ('ready','explaining','paused','answering','human');

CREATE INDEX tour_slot_hall_time ON tour_slots(hall_id,starts_at,ends_at);

CREATE INDEX visit_delivery_queue ON visit_deliveries(environment,app_env,status,lease_until);

CREATE INDEX visits_scope ON visits(tenant_id,workspace_id,status);

CREATE INDEX visual_expiry ON visual_grants(environment,app_env,status,expires_at);

CREATE UNIQUE INDEX visual_one_active ON visual_grants(session_id) WHERE status='active';

CREATE INDEX voice_styles_workspace ON voice_styles(tenant_id,workspace_id,environment,app_env,id);
