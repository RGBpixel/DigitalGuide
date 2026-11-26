ALTER TABLE reception_sessions ADD COLUMN service_scene TEXT NOT NULL DEFAULT 'reception';
ALTER TABLE reception_sessions ADD COLUMN dining_party_id TEXT;
ALTER TABLE reception_messages ADD COLUMN restaurant_context TEXT;
CREATE TABLE restaurants (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,venue_id TEXT NOT NULL REFERENCES venues(id),name TEXT NOT NULL,timezone TEXT NOT NULL,public_guide TEXT NOT NULL,
 profile_id TEXT,scene_app_id TEXT,hold_seconds INTEGER NOT NULL,visit_minutes INTEGER NOT NULL,late_minutes INTEGER NOT NULL,accepting_guests INTEGER NOT NULL DEFAULT 1,opening_windows TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,menu_version INTEGER NOT NULL DEFAULT 1,queue_counter INTEGER NOT NULL DEFAULT 0,booking_counter INTEGER NOT NULL DEFAULT 0,
 environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(venue_id,environment,app_env)
);
CREATE TABLE restaurant_staff (
 restaurant_id TEXT NOT NULL REFERENCES restaurants(id),user_id TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('manager','host')),enabled INTEGER NOT NULL,expires_at TEXT,version INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(restaurant_id,user_id)
);
CREATE TABLE restaurant_terminals (
 terminal_id TEXT PRIMARY KEY REFERENCES reception_terminals(id),restaurant_id TEXT NOT NULL REFERENCES restaurants(id)
);
CREATE TABLE restaurant_tables (
 id TEXT PRIMARY KEY,restaurant_id TEXT NOT NULL REFERENCES restaurants(id),code TEXT NOT NULL,name TEXT NOT NULL,capacity INTEGER NOT NULL,min_party_size INTEGER NOT NULL,zone TEXT NOT NULL,
 x REAL NOT NULL,y REAL NOT NULL,width REAL NOT NULL,height REAL NOT NULL,enabled INTEGER NOT NULL,operation TEXT NOT NULL DEFAULT 'open' CHECK(operation IN ('open','cleaning','blocked')),version INTEGER NOT NULL DEFAULT 1,
 UNIQUE(restaurant_id,code)
);
CREATE TABLE dining_parties (
 id TEXT PRIMARY KEY,restaurant_id TEXT NOT NULL REFERENCES restaurants(id),owner_session_id TEXT REFERENCES reception_sessions(id),created_focus_version INTEGER,actor_id TEXT NOT NULL,
 name TEXT NOT NULL,size INTEGER NOT NULL,visit_minutes INTEGER NOT NULL,guest_note TEXT NOT NULL,status TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,access_version INTEGER NOT NULL DEFAULT 1,
 queue_number INTEGER,queued_at TEXT,current_preference_id TEXT,claim_nonce TEXT NOT NULL,claim_hash TEXT NOT NULL UNIQUE,claim_expires_at TEXT NOT NULL,
 seated_at TEXT,ended_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX dining_party_owner ON dining_parties(owner_session_id,restaurant_id,status);
CREATE TABLE dining_reservations (
 id TEXT PRIMARY KEY,restaurant_id TEXT NOT NULL REFERENCES restaurants(id),party_id TEXT NOT NULL UNIQUE REFERENCES dining_parties(id),table_id TEXT NOT NULL REFERENCES restaurant_tables(id),reference TEXT NOT NULL,
 starts_at TEXT NOT NULL,ends_at TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'confirmed',version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,UNIQUE(restaurant_id,reference)
);
CREATE INDEX dining_reservation_intervals ON dining_reservations(table_id,status,starts_at,ends_at);
CREATE TABLE dining_occupancies (
 id TEXT PRIMARY KEY,restaurant_id TEXT NOT NULL REFERENCES restaurants(id),table_id TEXT NOT NULL REFERENCES restaurant_tables(id),party_id TEXT NOT NULL REFERENCES dining_parties(id),state TEXT NOT NULL,
 expires_at TEXT,expected_end_at TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX dining_one_table_owner ON dining_occupancies(table_id) WHERE state IN ('held','seated');
CREATE UNIQUE INDEX dining_one_party_table ON dining_occupancies(party_id) WHERE state IN ('held','seated');
CREATE INDEX dining_hold_expiry ON dining_occupancies(state,expires_at);
CREATE TABLE dining_hold_plans (
 id TEXT PRIMARY KEY,restaurant_id TEXT NOT NULL REFERENCES restaurants(id),party_id TEXT NOT NULL REFERENCES dining_parties(id),party_version INTEGER NOT NULL,table_id TEXT NOT NULL REFERENCES restaurant_tables(id),
 table_version INTEGER NOT NULL,restaurant_version INTEGER NOT NULL,actor_id TEXT NOT NULL,focus_version INTEGER,expected_end_at TEXT NOT NULL,expires_at TEXT NOT NULL,hash TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TABLE restaurant_menu_items (
 id TEXT PRIMARY KEY,restaurant_id TEXT NOT NULL REFERENCES restaurants(id),name TEXT NOT NULL,category TEXT NOT NULL,description TEXT NOT NULL,ingredient_tags TEXT NOT NULL,allergen_tags TEXT NOT NULL,may_contain_tags TEXT NOT NULL,
 allergen_info_complete INTEGER NOT NULL,flavor_tags TEXT NOT NULL,spice_level INTEGER NOT NULL,is_new INTEGER NOT NULL,listed INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE restaurant_menu_skus (
 id TEXT PRIMARY KEY,item_id TEXT NOT NULL REFERENCES restaurant_menu_items(id),restaurant_id TEXT NOT NULL REFERENCES restaurants(id),name TEXT NOT NULL,price_minor INTEGER NOT NULL,
 stock_tracked INTEGER NOT NULL,stock_remaining INTEGER NOT NULL CHECK(stock_remaining>=0),on_sale INTEGER NOT NULL,portion_people INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 1,archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE dining_preferences (
 id TEXT PRIMARY KEY,party_id TEXT NOT NULL REFERENCES dining_parties(id),revision INTEGER NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL,source TEXT NOT NULL,source_fact_ids TEXT NOT NULL,
 source_import_id TEXT,session_id TEXT,focus_version INTEGER,actor_id TEXT NOT NULL,confirmed_at TEXT,confirmed_by TEXT,confirmed_focus_version INTEGER,expires_at TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(party_id,revision)
);
CREATE TABLE restaurant_stock_adjustments (
 id TEXT PRIMARY KEY,restaurant_id TEXT NOT NULL REFERENCES restaurants(id),sku_id TEXT NOT NULL REFERENCES restaurant_menu_skus(id),actor_id TEXT NOT NULL,
 before_quantity INTEGER NOT NULL,after_quantity INTEGER NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE INDEX restaurant_stock_history ON restaurant_stock_adjustments(sku_id,created_at);
CREATE TABLE dining_memory_imports (
 id TEXT PRIMARY KEY,party_id TEXT NOT NULL REFERENCES dining_parties(id),session_id TEXT NOT NULL REFERENCES reception_sessions(id),focus_version INTEGER NOT NULL,person_id TEXT NOT NULL,
 facts TEXT NOT NULL,expires_at TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TABLE dining_recommendations (
 id TEXT PRIMARY KEY,party_id TEXT NOT NULL REFERENCES dining_parties(id),party_version INTEGER NOT NULL,menu_version INTEGER NOT NULL,preference_id TEXT NOT NULL REFERENCES dining_preferences(id),
 payload TEXT NOT NULL,expires_at TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TABLE dining_obligations (
 id TEXT PRIMARY KEY,party_id TEXT NOT NULL REFERENCES dining_parties(id),kind TEXT NOT NULL,reference_id TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,
 UNIQUE(kind,reference_id)
);
CREATE TABLE dining_claim_limits (
 session_id TEXT NOT NULL,restaurant_id TEXT NOT NULL REFERENCES restaurants(id),failures INTEGER NOT NULL DEFAULT 0,blocked_until TEXT,updated_at TEXT NOT NULL,
 PRIMARY KEY(session_id,restaurant_id)
);
