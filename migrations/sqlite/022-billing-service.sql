DROP INDEX restaurant_one_open_order;
CREATE UNIQUE INDEX restaurant_one_unsettled_order ON restaurant_orders(party_id)
 WHERE status NOT IN ('closed','cancelled') AND settlement_status='unsettled';

CREATE TABLE restaurant_payment_configs (
 restaurant_id TEXT PRIMARY KEY REFERENCES restaurants(id),provider_id TEXT NOT NULL,enabled INTEGER NOT NULL,
 merchant_id TEXT NOT NULL,scenario TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE TABLE restaurant_bills (
 id TEXT PRIMARY KEY,restaurant_id TEXT NOT NULL REFERENCES restaurants(id),party_id TEXT NOT NULL REFERENCES dining_parties(id),
 order_id TEXT NOT NULL UNIQUE REFERENCES restaurant_orders(id),number TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,
 order_content_version INTEGER NOT NULL,amount_minor INTEGER NOT NULL CHECK(amount_minor>=0),snapshot TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open',attention_reason TEXT,settled_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX restaurant_bill_list ON restaurant_bills(restaurant_id,party_id,created_at,id);
CREATE TABLE restaurant_financial_quotes (
 id TEXT PRIMARY KEY,bill_id TEXT NOT NULL REFERENCES restaurant_bills(id),kind TEXT NOT NULL CHECK(kind IN ('payment','refund')),
 parent_payment_id TEXT,hash TEXT NOT NULL,payload TEXT NOT NULL,actor_id TEXT NOT NULL,session_id TEXT,focus_version INTEGER,
 status TEXT NOT NULL DEFAULT 'current',expires_at TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TABLE restaurant_financial_operations (
 id TEXT PRIMARY KEY,bill_id TEXT NOT NULL REFERENCES restaurant_bills(id),kind TEXT NOT NULL CHECK(kind IN ('payment','refund')),
 parent_payment_id TEXT REFERENCES restaurant_financial_operations(id),quote_id TEXT NOT NULL REFERENCES restaurant_financial_quotes(id),
 status TEXT NOT NULL DEFAULT 'queued',version INTEGER NOT NULL DEFAULT 1,amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
 provider_id TEXT NOT NULL,merchant_id TEXT NOT NULL,config_version INTEGER NOT NULL,config_snapshot TEXT NOT NULL,
 request_payload TEXT NOT NULL,request_hash TEXT NOT NULL,reason TEXT NOT NULL,simulated INTEGER NOT NULL,
 actor_id TEXT NOT NULL,session_id TEXT,focus_version INTEGER,party_access_version INTEGER NOT NULL,
 send_attempts INTEGER NOT NULL DEFAULT 0,simulate_attempts INTEGER NOT NULL DEFAULT 0,lookups INTEGER NOT NULL DEFAULT 0,
 next_action TEXT,action_actor_id TEXT,action_session_id TEXT,action_focus_version INTEGER,action_party_access_version INTEGER,
 lease_action TEXT,lease_token TEXT,lease_until TEXT,last_lookup_at TEXT,
 remote_operation_id TEXT,remote_transaction_id TEXT,last_sequence INTEGER NOT NULL DEFAULT 0,error_code TEXT,error_message TEXT,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX restaurant_one_pending_payment ON restaurant_financial_operations(bill_id)
 WHERE kind='payment' AND status IN ('queued','submitting','pending','unknown');
CREATE UNIQUE INDEX restaurant_financial_quote_once ON restaurant_financial_operations(quote_id);
CREATE INDEX restaurant_financial_queue ON restaurant_financial_operations(status,next_action,created_at,id);
CREATE TABLE restaurant_financial_postings (
 id TEXT PRIMARY KEY,bill_id TEXT NOT NULL REFERENCES restaurant_bills(id),operation_id TEXT NOT NULL UNIQUE REFERENCES restaurant_financial_operations(id),
 kind TEXT NOT NULL CHECK(kind IN ('payment','refund')),amount_minor INTEGER NOT NULL CHECK(amount_minor>0),currency TEXT NOT NULL CHECK(currency='CNY'),
 provider_id TEXT NOT NULL,merchant_id TEXT NOT NULL,remote_transaction_id TEXT NOT NULL,environment TEXT NOT NULL,app_env TEXT NOT NULL,created_at TEXT NOT NULL,
 UNIQUE(provider_id,merchant_id,remote_transaction_id,environment,app_env)
);
CREATE TABLE restaurant_financial_receipts (
 event_id TEXT PRIMARY KEY,operation_id TEXT NOT NULL REFERENCES restaurant_financial_operations(id),payload_hash TEXT NOT NULL,payload TEXT NOT NULL,
 status TEXT NOT NULL,sequence INTEGER NOT NULL,applied INTEGER NOT NULL DEFAULT 0,attention INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL
);
CREATE TABLE restaurant_financial_events (
 id TEXT PRIMARY KEY,bill_id TEXT NOT NULL REFERENCES restaurant_bills(id),operation_id TEXT,actor_id TEXT NOT NULL,kind TEXT NOT NULL,info TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TABLE mock_financial_operations (
 operation_id TEXT PRIMARY KEY REFERENCES restaurant_financial_operations(id),request_hash TEXT NOT NULL,payload TEXT NOT NULL,
 remote_operation_id TEXT NOT NULL,remote_transaction_id TEXT NOT NULL,status TEXT NOT NULL,sequence INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);

CREATE TABLE dining_service_requests (
 id TEXT PRIMARY KEY,restaurant_id TEXT NOT NULL REFERENCES restaurants(id),party_id TEXT NOT NULL REFERENCES dining_parties(id),
 kind TEXT NOT NULL,note TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'requested',version INTEGER NOT NULL DEFAULT 1,
 actor_id TEXT NOT NULL,session_id TEXT,focus_version INTEGER,source_request_id TEXT,
 acknowledged_by TEXT,acknowledged_at TEXT,resolved_by TEXT,resolved_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX dining_service_queue ON dining_service_requests(restaurant_id,status,created_at,id);
CREATE UNIQUE INDEX dining_service_source_once ON dining_service_requests(source_request_id) WHERE source_request_id IS NOT NULL;
CREATE TABLE dining_service_events (
 id TEXT PRIMARY KEY,request_id TEXT NOT NULL REFERENCES dining_service_requests(id),actor_id TEXT NOT NULL,kind TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TABLE dining_farewells (
 party_id TEXT PRIMARY KEY REFERENCES dining_parties(id),message TEXT NOT NULL,ended_by TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TABLE dining_feedback (
 id TEXT PRIMARY KEY,party_id TEXT NOT NULL UNIQUE REFERENCES dining_parties(id),status TEXT NOT NULL DEFAULT 'active',version INTEGER NOT NULL DEFAULT 1,
 rating INTEGER,comment TEXT NOT NULL,actor_id TEXT NOT NULL,session_id TEXT,focus_version INTEGER,expires_at TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE TABLE dining_followup_consents (
 id TEXT PRIMARY KEY,party_id TEXT NOT NULL UNIQUE REFERENCES dining_parties(id),status TEXT NOT NULL DEFAULT 'active',version INTEGER NOT NULL DEFAULT 1,
 purpose TEXT NOT NULL CHECK(purpose='visit_followup'),contact_kind TEXT NOT NULL CHECK(contact_kind IN ('phone','email')),
 contact_cipher TEXT,contact_mask TEXT NOT NULL,actor_id TEXT NOT NULL,session_id TEXT NOT NULL,focus_version INTEGER NOT NULL,
 expires_at TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
