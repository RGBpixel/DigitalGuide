-- 049/050 stay frozen. Return only the backstage leases for this current output.
CREATE FUNCTION dg_native_programme_peer_lease(p_connection text,p_output text,p_generation text,p_token text) RETURNS TABLE(host_lease_until text,guest_lease_until text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT a.host_lease_until,a.guest_lease_until FROM live_guest_programme_connections c JOIN live_guest_programme_grants r ON r.id=c.grant_id JOIN live_peer_attempts a ON a.id=r.peer_attempt_id WHERE c.id=p_connection AND c.output_id=p_output AND c.generation_id=p_generation AND c.status IN('queued','connecting','connected') AND dg_native_programme_output_lease(p_output,p_generation,p_token) AND dg_native_programme_live_valid(r.id)
$dg$;
REVOKE ALL ON FUNCTION dg_native_programme_peer_lease(text,text,text,text) FROM PUBLIC;
