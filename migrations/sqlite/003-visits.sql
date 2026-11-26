CREATE TABLE reception_hosts (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id), public_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1, UNIQUE(tenant_id,workspace_id,public_name)
);
CREATE TABLE visits (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
  venue_id TEXT NOT NULL REFERENCES venues(id), session_id TEXT NOT NULL UNIQUE REFERENCES reception_sessions(id),
  host_id TEXT REFERENCES reception_hosts(id), host_name TEXT NOT NULL,
  guest_name TEXT NOT NULL, company TEXT NOT NULL, purpose TEXT NOT NULL, appointment_ref TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','awaiting_confirmation','notifying','waiting_host','accepted','declined','escalated','completed','cancelled')),
  version INTEGER NOT NULL DEFAULT 1, focus_version INTEGER NOT NULL,
  confirmed_hash TEXT, confirmed_at TEXT, notice_version TEXT, host_deadline TEXT, responded_by TEXT,
  host_private_note TEXT, guidance_code TEXT, escalated_reason TEXT, completed_at TEXT,
  mock_scenario TEXT NOT NULL DEFAULT 'normal', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX visits_scope ON visits(tenant_id,workspace_id,status);
CREATE TABLE visit_deliveries (
  id TEXT PRIMARY KEY, visit_id TEXT NOT NULL UNIQUE REFERENCES visits(id), tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL, recipient_user_id TEXT NOT NULL, environment TEXT NOT NULL, app_env TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','submitting','submitted','delivered','acknowledged','failed','unknown','cancelled')),
  version INTEGER NOT NULL DEFAULT 1, scenario TEXT NOT NULL DEFAULT 'normal',
  attempts INTEGER NOT NULL DEFAULT 0, lease_token TEXT, lease_until TEXT, remote_id TEXT,
  error_code TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX visit_delivery_queue ON visit_deliveries(environment,app_env,status,lease_until);
CREATE TABLE mock_notification_submissions (
  delivery_id TEXT PRIMARY KEY REFERENCES visit_deliveries(id), request_hash TEXT NOT NULL, remote_id TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE notification_callback_events (
  event_id TEXT PRIMARY KEY, delivery_id TEXT NOT NULL REFERENCES visit_deliveries(id),
  environment TEXT NOT NULL, request_hash TEXT NOT NULL, disposition TEXT NOT NULL, received_at TEXT NOT NULL
);
