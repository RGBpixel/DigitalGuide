-- R-118. A curated workspace catalogue does not grant new source permissions.
CREATE TABLE enterprise_resource_shelf (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),workspace_id TEXT NOT NULL,
 environment TEXT NOT NULL CHECK(environment IN('mock','sandbox','live')),app_env TEXT NOT NULL CHECK(app_env IN('development','sandbox','production')),
 kind TEXT NOT NULL CHECK(kind IN('character','voice','template')),source_id TEXT NOT NULL,source_version INTEGER NOT NULL CHECK(source_version>0),source_hash TEXT NOT NULL,
 title TEXT NOT NULL,description TEXT NOT NULL,tags TEXT NOT NULL,license_note TEXT NOT NULL,expires_at TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN('draft','published','withdrawn')),version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 1000000000),created_at TEXT NOT NULL,updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX enterprise_shelf_scope ON enterprise_resource_shelf(tenant_id,workspace_id,environment,app_env,state,id);
CREATE TABLE enterprise_shelf_events (
 id TEXT PRIMARY KEY,entry_id TEXT NOT NULL REFERENCES enterprise_resource_shelf(id),tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,
 environment TEXT NOT NULL,app_env TEXT NOT NULL,actor_id TEXT NOT NULL,entry_version INTEGER NOT NULL,
 action TEXT NOT NULL CHECK(action IN('create','update','publish','withdraw','select')),snapshot TEXT NOT NULL,created_at TEXT NOT NULL
) STRICT;
CREATE INDEX enterprise_shelf_event_scope ON enterprise_shelf_events(entry_id,created_at,id);
CREATE TABLE enterprise_shelf_selections (
 id TEXT PRIMARY KEY,entry_id TEXT NOT NULL REFERENCES enterprise_resource_shelf(id),entry_version INTEGER NOT NULL,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,
 environment TEXT NOT NULL,app_env TEXT NOT NULL,actor_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN('character','voice','template')),source_id TEXT NOT NULL,source_version INTEGER NOT NULL,
 source_hash TEXT NOT NULL,expires_at TEXT NOT NULL,project_id TEXT,created_at TEXT NOT NULL
) STRICT;
CREATE INDEX enterprise_shelf_selection_scope ON enterprise_shelf_selections(tenant_id,workspace_id,actor_id,id);
