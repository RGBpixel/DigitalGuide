-- Applied 046 remains immutable. Match the existing live.start permission (admin).
CREATE OR REPLACE FUNCTION dg_native_peer_actor_valid(p_actor text,p_tenant text,p_workspace text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT EXISTS(SELECT 1 FROM memberships m JOIN workspaces w ON w.id=p_workspace AND w.tenant_id=m.tenant_id WHERE m.user_id=p_actor AND m.tenant_id=p_tenant AND m.role='admin' AND m.workspace_ids::jsonb ? p_workspace)
$dg$;
REVOKE ALL ON FUNCTION dg_native_peer_actor_valid(text,text,text) FROM PUBLIC;
