-- Fulfillment may remain active after a verified payment. Only unsettled active orders share the draft slot.
DROP INDEX native_order_one_open_party;
CREATE UNIQUE INDEX native_order_one_open_party ON restaurant_orders(party_id) WHERE settlement_status='unsettled' AND status NOT IN('closed','cancelled');
