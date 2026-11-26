CREATE TABLE exhibition_halls (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,venue_id TEXT NOT NULL,
 name TEXT NOT NULL,description TEXT NOT NULL,zones TEXT NOT NULL,opening_hours TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 1,version INTEGER NOT NULL DEFAULT 1,environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX exhibition_hall_scope ON exhibition_halls(tenant_id,workspace_id,environment,app_env,id);
CREATE TABLE exhibits (
 id TEXT PRIMARY KEY,hall_id TEXT NOT NULL REFERENCES exhibition_halls(id),tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,
 code TEXT NOT NULL,title TEXT NOT NULL,zone_id TEXT NOT NULL,tags TEXT NOT NULL,accessible INTEGER NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,draft_version INTEGER NOT NULL,published_version INTEGER,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 UNIQUE(hall_id,code)
);
CREATE TABLE exhibit_versions (
 id TEXT PRIMARY KEY,exhibit_id TEXT NOT NULL REFERENCES exhibits(id),number INTEGER NOT NULL,status TEXT NOT NULL,
 body TEXT NOT NULL,created_at TEXT NOT NULL,published_at TEXT,UNIQUE(exhibit_id,number)
);
CREATE TABLE tour_routes (
 id TEXT PRIMARY KEY,hall_id TEXT NOT NULL REFERENCES exhibition_halls(id),tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,
 name TEXT NOT NULL,steps TEXT NOT NULL,enabled INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE TABLE tour_slots (
 id TEXT PRIMARY KEY,hall_id TEXT NOT NULL REFERENCES exhibition_halls(id),tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,
 starts_at TEXT NOT NULL,ends_at TEXT NOT NULL,capacity INTEGER NOT NULL,open INTEGER NOT NULL DEFAULT 1,version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL
);
CREATE INDEX tour_slot_hall_time ON tour_slots(hall_id,starts_at,ends_at);
CREATE TABLE tour_bookings (
 id TEXT PRIMARY KEY,slot_id TEXT NOT NULL REFERENCES tour_slots(id),tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,
 group_name TEXT NOT NULL,party_size INTEGER NOT NULL,language TEXT NOT NULL,note TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'reserved',
 version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE TABLE exhibit_devices (
 id TEXT PRIMARY KEY,hall_id TEXT NOT NULL REFERENCES exhibition_halls(id),tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,
 name TEXT NOT NULL,provider TEXT NOT NULL,online INTEGER NOT NULL,allowed_actions TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,
 state_version INTEGER NOT NULL DEFAULT 0,display_state TEXT,active_session_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE TABLE tour_sessions (
 id TEXT PRIMARY KEY,hall_id TEXT NOT NULL REFERENCES exhibition_halls(id),tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,
 route_id TEXT NOT NULL REFERENCES tour_routes(id),route_version INTEGER NOT NULL,booking_id TEXT REFERENCES tour_bookings(id),
 snapshot TEXT NOT NULL,scene_snapshot TEXT NOT NULL,language TEXT NOT NULL,group_size INTEGER NOT NULL,device_id TEXT REFERENCES exhibit_devices(id),
 auto_devices INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'ready',cursor TEXT NOT NULL,resume_cursor TEXT,
 active_question_id TEXT,play_started_at TEXT,last_reason TEXT NOT NULL DEFAULT 'awaiting_start',version INTEGER NOT NULL DEFAULT 1,
 focus_version INTEGER NOT NULL DEFAULT 0,playback_epoch INTEGER NOT NULL DEFAULT 0,access_version INTEGER NOT NULL DEFAULT 1,
 environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,expires_at TEXT NOT NULL
);
CREATE UNIQUE INDEX tour_live_device ON tour_sessions(device_id) WHERE device_id IS NOT NULL AND status IN ('ready','explaining','paused','answering','human');
CREATE UNIQUE INDEX tour_live_booking ON tour_sessions(booking_id) WHERE booking_id IS NOT NULL AND status IN ('ready','explaining','paused','answering','human');
CREATE TABLE tour_questions (
 id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES tour_sessions(id),audience_label TEXT NOT NULL,text TEXT NOT NULL,
 answer TEXT,citations TEXT NOT NULL DEFAULT '[]',status TEXT NOT NULL DEFAULT 'queued',focus_version INTEGER NOT NULL,
 created_at TEXT NOT NULL,answered_at TEXT
);
CREATE TABLE exhibit_device_commands (
 id TEXT PRIMARY KEY,device_id TEXT NOT NULL REFERENCES exhibit_devices(id),session_id TEXT NOT NULL REFERENCES tour_sessions(id),
 tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,action TEXT NOT NULL,payload TEXT NOT NULL,kind TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',reason TEXT,fixture TEXT NOT NULL DEFAULT 'success',device_version INTEGER NOT NULL,
 playback_epoch INTEGER NOT NULL,receipt_id TEXT,simulated INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX exhibit_command_queue ON exhibit_device_commands(status,created_at);
CREATE TABLE exhibit_device_receipts (
 command_id TEXT PRIMARY KEY REFERENCES exhibit_device_commands(id),receipt_id TEXT NOT NULL UNIQUE,state TEXT NOT NULL,created_at TEXT NOT NULL
);
