CREATE TABLE office_relays (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
  sender_user_id TEXT NOT NULL, recipient_user_id TEXT NOT NULL,
  subject TEXT NOT NULL, body TEXT NOT NULL, confidentiality TEXT NOT NULL,
  channel TEXT NOT NULL, scenario TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'draft', version INTEGER NOT NULL DEFAULT 1,
  revision INTEGER NOT NULL DEFAULT 1, scheduled_at TEXT, expires_at TEXT NOT NULL,
  environment TEXT NOT NULL, app_env TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX office_relay_sender ON office_relays(tenant_id,workspace_id,sender_user_id,id);
CREATE TABLE office_calendar_events (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
  organizer_user_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
  location TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, timezone TEXT NOT NULL,
  reminder_minutes INTEGER NOT NULL, channel TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled', version INTEGER NOT NULL DEFAULT 1,
  revision INTEGER NOT NULL DEFAULT 1, expires_at TEXT NOT NULL,
  environment TEXT NOT NULL, app_env TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE office_event_attendees (
  event_id TEXT NOT NULL REFERENCES office_calendar_events(id), user_id TEXT NOT NULL,
  response TEXT NOT NULL DEFAULT 'pending', response_at TEXT, PRIMARY KEY(event_id,user_id)
);
CREATE TABLE office_notifications (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
  source_kind TEXT NOT NULL, source_id TEXT NOT NULL, source_revision INTEGER NOT NULL,
  recipient_user_id TEXT NOT NULL, kind TEXT NOT NULL, due_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  channel TEXT NOT NULL, scenario TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'pending', dispatch_status TEXT NOT NULL DEFAULT 'queued',
  version INTEGER NOT NULL DEFAULT 1, attempts INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT, lease_until TEXT, remote_id TEXT, error_code TEXT,
  read_at TEXT, acknowledged_at TEXT, environment TEXT NOT NULL, app_env TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(source_kind,source_id,source_revision,recipient_user_id,kind)
);
CREATE INDEX office_notification_queue ON office_notifications(environment,app_env,dispatch_status,due_at,lease_until);
CREATE INDEX office_notification_inbox ON office_notifications(tenant_id,workspace_id,recipient_user_id,id);
CREATE TABLE office_mock_submissions (
  notification_id TEXT PRIMARY KEY REFERENCES office_notifications(id), request_hash TEXT NOT NULL,
  remote_id TEXT NOT NULL, created_at TEXT NOT NULL
);
