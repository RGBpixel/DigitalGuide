-- R-118. A curated workspace catalogue does not grant new source permissions.
CREATE TABLE enterprise_resource_shelf (
 id text PRIMARY KEY,tenant_id text NOT NULL REFERENCES tenants(id),workspace_id text NOT NULL,
 environment text NOT NULL CHECK(environment IN('mock','sandbox','live')),app_env text NOT NULL CHECK(app_env IN('development','sandbox','production')),
 kind text NOT NULL CHECK(kind IN('character','voice','template')),source_id text NOT NULL,source_version bigint NOT NULL CHECK(source_version>0),source_hash text NOT NULL,
 title text NOT NULL,description text NOT NULL,tags text NOT NULL,license_note text NOT NULL,expires_at text NOT NULL,
 state text NOT NULL CHECK(state IN('draft','published','withdrawn')),version bigint NOT NULL CHECK(version BETWEEN 1 AND 1000000000),created_at text NOT NULL,updated_at text NOT NULL
);
CREATE INDEX enterprise_shelf_scope ON enterprise_resource_shelf(tenant_id,workspace_id,environment,app_env,state,id);
CREATE TABLE enterprise_shelf_events (
 id text PRIMARY KEY,entry_id text NOT NULL REFERENCES enterprise_resource_shelf(id),tenant_id text NOT NULL,workspace_id text NOT NULL,
 environment text NOT NULL,app_env text NOT NULL,actor_id text NOT NULL,entry_version bigint NOT NULL,
 action text NOT NULL CHECK(action IN('create','update','publish','withdraw','select')),snapshot text NOT NULL,created_at text NOT NULL
);
CREATE INDEX enterprise_shelf_event_scope ON enterprise_shelf_events(entry_id,created_at,id);
CREATE TABLE enterprise_shelf_selections (
 id text PRIMARY KEY,entry_id text NOT NULL REFERENCES enterprise_resource_shelf(id),entry_version bigint NOT NULL,tenant_id text NOT NULL,workspace_id text NOT NULL,
 environment text NOT NULL,app_env text NOT NULL,actor_id text NOT NULL,kind text NOT NULL CHECK(kind IN('character','voice','template')),source_id text NOT NULL,source_version bigint NOT NULL,
 source_hash text NOT NULL,expires_at text NOT NULL,project_id text,created_at text NOT NULL
);
CREATE INDEX enterprise_shelf_selection_scope ON enterprise_shelf_selections(tenant_id,workspace_id,actor_id,id);
CREATE TRIGGER native_shelf_event_immutable BEFORE UPDATE OR DELETE ON enterprise_shelf_events FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
