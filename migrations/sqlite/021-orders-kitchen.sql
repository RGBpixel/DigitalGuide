ALTER TABLE restaurant_staff RENAME TO restaurant_staff_before_kitchen;
CREATE TABLE restaurant_staff (
 restaurant_id TEXT NOT NULL REFERENCES restaurants(id),user_id TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('manager','host','kitchen')),enabled INTEGER NOT NULL,expires_at TEXT,version INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(restaurant_id,user_id)
);
INSERT INTO restaurant_staff SELECT * FROM restaurant_staff_before_kitchen;
DROP TABLE restaurant_staff_before_kitchen;
ALTER TABLE restaurants ADD COLUMN order_counter INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversation_tool_requests ADD COLUMN parameters TEXT;
ALTER TABLE conversation_tool_requests ADD COLUMN preview TEXT;
ALTER TABLE conversation_tool_requests ADD COLUMN source_message_id TEXT;

CREATE TABLE restaurant_pos_configs (
 restaurant_id TEXT PRIMARY KEY REFERENCES restaurants(id),provider_id TEXT NOT NULL,enabled INTEGER NOT NULL,
 scenario TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE TABLE restaurant_orders (
 id TEXT PRIMARY KEY,restaurant_id TEXT NOT NULL REFERENCES restaurants(id),party_id TEXT NOT NULL REFERENCES dining_parties(id),number TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,content_version INTEGER NOT NULL DEFAULT 1,status TEXT NOT NULL DEFAULT 'draft',
 control_mode TEXT NOT NULL DEFAULT 'automatic' CHECK(control_mode IN ('automatic','human')),attention_reason TEXT,
 settlement_status TEXT NOT NULL DEFAULT 'unsettled' CHECK(settlement_status IN ('unsettled','settled')),
 pending_change_id TEXT,remote_order_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 UNIQUE(restaurant_id,number)
);
CREATE UNIQUE INDEX restaurant_one_open_order ON restaurant_orders(party_id) WHERE status NOT IN ('closed','cancelled');
CREATE INDEX restaurant_order_list ON restaurant_orders(restaurant_id,created_at,id);
CREATE TABLE restaurant_order_changes (
 id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES restaurant_orders(id),kind TEXT NOT NULL CHECK(kind IN ('initial','amend','cancel')),
 version INTEGER NOT NULL DEFAULT 1,sequence INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'draft',base_content_version INTEGER NOT NULL,
 input TEXT NOT NULL,current_quote_id TEXT,source TEXT NOT NULL,source_request_id TEXT,
 actor_id TEXT NOT NULL,session_id TEXT,focus_version INTEGER,party_access_version INTEGER NOT NULL,
 confirmed_at TEXT,confirmed_actor_id TEXT,confirmed_focus_version INTEGER,confirmed_quote_id TEXT,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(order_id,sequence)
);
CREATE UNIQUE INDEX restaurant_one_pending_change ON restaurant_order_changes(order_id)
 WHERE status IN ('draft','awaiting_confirmation','confirmed','queued','submitting','submitted','unknown');
CREATE TABLE restaurant_order_quotes (
 id TEXT PRIMARY KEY,change_id TEXT NOT NULL REFERENCES restaurant_order_changes(id),change_version INTEGER NOT NULL,
 hash TEXT NOT NULL,payload TEXT NOT NULL,actor_id TEXT NOT NULL,session_id TEXT,focus_version INTEGER,
 status TEXT NOT NULL DEFAULT 'current',expires_at TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE INDEX restaurant_order_quote_history ON restaurant_order_quotes(change_id,created_at);
CREATE TABLE restaurant_order_dispatches (
 change_id TEXT PRIMARY KEY REFERENCES restaurant_order_changes(id),restaurant_id TEXT NOT NULL REFERENCES restaurants(id),
 provider_id TEXT NOT NULL,config_version INTEGER NOT NULL,config_snapshot TEXT NOT NULL,request_hash TEXT NOT NULL,request_payload TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued',version INTEGER NOT NULL DEFAULT 1,attempts INTEGER NOT NULL DEFAULT 0,
 lease_token TEXT,lease_until TEXT,remote_request_id TEXT,remote_order_id TEXT,last_sequence INTEGER NOT NULL DEFAULT 0,
 error_code TEXT,error_message TEXT,simulated INTEGER NOT NULL,query_requested INTEGER NOT NULL DEFAULT 0,lookups INTEGER NOT NULL DEFAULT 0,last_lookup_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX restaurant_dispatch_queue ON restaurant_order_dispatches(status,created_at);
CREATE TABLE restaurant_order_lines (
 id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES restaurant_orders(id),change_id TEXT NOT NULL REFERENCES restaurant_order_changes(id),
 item_id TEXT NOT NULL,sku_id TEXT NOT NULL REFERENCES restaurant_menu_skus(id),item_name TEXT NOT NULL,sku_name TEXT NOT NULL,
 unit_price_minor INTEGER NOT NULL CHECK(unit_price_minor>=0),quantity INTEGER NOT NULL CHECK(quantity>0),cancelled_quantity INTEGER NOT NULL DEFAULT 0,
 preparation_note TEXT NOT NULL,dietary_tags TEXT NOT NULL,stock_tracked INTEGER NOT NULL,created_at TEXT NOT NULL,
 CHECK(cancelled_quantity>=0 AND cancelled_quantity<=quantity)
);
CREATE TABLE restaurant_kitchen_tickets (
 id TEXT PRIMARY KEY,restaurant_id TEXT NOT NULL REFERENCES restaurants(id),order_id TEXT NOT NULL REFERENCES restaurant_orders(id),
 line_id TEXT NOT NULL UNIQUE REFERENCES restaurant_order_lines(id),table_id TEXT NOT NULL REFERENCES restaurant_tables(id),table_name TEXT NOT NULL,table_code TEXT NOT NULL,
 started_quantity INTEGER NOT NULL DEFAULT 0,ready_quantity INTEGER NOT NULL DEFAULT 0,served_quantity INTEGER NOT NULL DEFAULT 0,
 pending_cancel_quantity INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 1,accepted_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 CHECK(served_quantity>=0 AND ready_quantity>=served_quantity AND started_quantity>=ready_quantity AND pending_cancel_quantity>=0)
);
CREATE INDEX restaurant_kitchen_queue ON restaurant_kitchen_tickets(restaurant_id,accepted_at,id);
CREATE TABLE restaurant_inventory_reservations (
 id TEXT PRIMARY KEY,change_id TEXT NOT NULL REFERENCES restaurant_order_changes(id),sku_id TEXT NOT NULL REFERENCES restaurant_menu_skus(id),
 quantity INTEGER NOT NULL CHECK(quantity>0),tracked INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'reserved',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 UNIQUE(change_id,sku_id)
);
CREATE TABLE restaurant_stock_movements (
 id TEXT PRIMARY KEY,restaurant_id TEXT NOT NULL REFERENCES restaurants(id),sku_id TEXT NOT NULL REFERENCES restaurant_menu_skus(id),
 change_id TEXT NOT NULL REFERENCES restaurant_order_changes(id),kind TEXT NOT NULL,
 before_quantity INTEGER NOT NULL,after_quantity INTEGER NOT NULL,created_at TEXT NOT NULL,
 UNIQUE(change_id,sku_id,kind)
);
CREATE TABLE restaurant_order_events (
 id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES restaurant_orders(id),change_id TEXT,
 actor_id TEXT NOT NULL,kind TEXT NOT NULL,info TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE INDEX restaurant_order_event_history ON restaurant_order_events(order_id,created_at,id);
CREATE TABLE restaurant_pos_callbacks (
 event_id TEXT PRIMARY KEY,change_id TEXT NOT NULL REFERENCES restaurant_order_changes(id),payload_hash TEXT NOT NULL,payload TEXT NOT NULL,
 outcome TEXT NOT NULL,sequence INTEGER NOT NULL,applied INTEGER NOT NULL DEFAULT 0,conflict INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL
);
CREATE TABLE mock_pos_operations (
 change_id TEXT PRIMARY KEY REFERENCES restaurant_order_changes(id),restaurant_id TEXT NOT NULL REFERENCES restaurants(id),
 request_hash TEXT NOT NULL,payload TEXT NOT NULL,remote_request_id TEXT NOT NULL,remote_order_id TEXT NOT NULL,
 outcome TEXT NOT NULL,sequence INTEGER NOT NULL,created_at TEXT NOT NULL
);
