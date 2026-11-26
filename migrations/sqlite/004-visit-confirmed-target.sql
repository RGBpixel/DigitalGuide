CREATE TABLE visit_confirmation_targets (
  visit_id TEXT PRIMARY KEY REFERENCES visits(id), user_id TEXT REFERENCES users(id)
);
-- Existing delivery recipients are authoritative. Unsent legacy confirmations
-- have no recoverable recipient snapshot and remain unassigned for manual review.
INSERT INTO visit_confirmation_targets(visit_id,user_id)
SELECT v.id,d.recipient_user_id FROM visits v LEFT JOIN visit_deliveries d ON d.visit_id=v.id
WHERE v.confirmed_at IS NOT NULL;
