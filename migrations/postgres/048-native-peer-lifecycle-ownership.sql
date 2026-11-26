-- 003/046/047 stay frozen. Native 046 owns these lifecycle transitions.
-- Remove the superseded invoker cleanup; otherwise it repeats withdrawals and versions.
DROP TRIGGER live_peer_invite_cleanup ON live_peer_invites;
DROP TRIGGER live_peer_session_stop ON live_sessions;
DROP TRIGGER live_peer_output_withdraw ON live_outputs;
DROP TRIGGER live_peer_member_change ON memberships;
DROP TRIGGER live_peer_member_delete ON memberships;

-- Preserve independent programme cleanup without granting API direct programme writes.
ALTER FUNCTION dg_trigger_a23bee0fff5428c61de10394() SECURITY DEFINER SET search_path FROM CURRENT;
ALTER FUNCTION dg_trigger_acc9cd36afd80095ae427cce() SECURITY DEFINER SET search_path FROM CURRENT;
REVOKE ALL ON FUNCTION dg_trigger_a23bee0fff5428c61de10394(),dg_trigger_acc9cd36afd80095ae427cce() FROM PUBLIC;
