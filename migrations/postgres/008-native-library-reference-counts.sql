-- Count-only access to unported documents. Runtime API receives no document SELECT grant.
CREATE FUNCTION dg_native_library_references(target_tenant text,target_workspace text,asset_ids text[])
RETURNS TABLE(profiles bigint,projects bigint,templates bigint,clones bigint,jobs bigint,consents bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control c WHERE c.id=1 AND c.status='validation_only'
  AND c.environment='mock' AND session_user=c.app_role)
  OR NOT EXISTS(SELECT 1 FROM workspaces w WHERE w.id=target_workspace AND w.tenant_id=target_tenant)
  OR asset_ids IS NULL OR cardinality(asset_ids) NOT BETWEEN 1 AND 100
  OR array_position(asset_ids,NULL) IS NOT NULL THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Native reference count scope is not allowed';
 END IF;
 RETURN QUERY SELECT
  (SELECT count(*) FROM profiles p WHERE p.tenant_id=target_tenant AND p.workspace_id=target_workspace
   AND (p.avatar_asset_id=ANY(asset_ids) OR p.voice_asset_id=ANY(asset_ids))),
  (SELECT count(*) FROM studio_projects p WHERE p.tenant_id=target_tenant AND p.workspace_id=target_workspace
   AND EXISTS(SELECT 1 FROM jsonb_path_query(p.document::jsonb,'strict $.** ? (@.type() == "string")') AS leaf(value)
    WHERE leaf.value #>> '{}' = ANY(asset_ids))),
  (SELECT count(*) FROM studio_templates p WHERE p.tenant_id=target_tenant AND p.workspace_id=target_workspace
   AND EXISTS(SELECT 1 FROM jsonb_path_query(p.document::jsonb,'strict $.** ? (@.type() == "string")') AS leaf(value)
    WHERE leaf.value #>> '{}' = ANY(asset_ids))),
  (SELECT count(*) FROM studio_clones p WHERE p.tenant_id=target_tenant AND p.workspace_id=target_workspace
   AND p.asset_id=ANY(asset_ids)),
  (SELECT count(*) FROM jobs p WHERE p.tenant_id=target_tenant AND p.workspace_id=target_workspace
   AND EXISTS(SELECT 1 FROM jsonb_path_query(p.payload::jsonb,'strict $.** ? (@.type() == "string")') AS leaf(value)
    WHERE leaf.value #>> '{}' = ANY(asset_ids))),
  (SELECT count(*) FROM consents p WHERE p.tenant_id=target_tenant AND p.workspace_id=target_workspace
   AND p.asset_id=ANY(asset_ids) AND p.revoked_at IS NULL AND p.expires_at>dg_utc_now());
END;
$dg$;
REVOKE ALL ON FUNCTION dg_native_library_references(text,text,text[]) FROM PUBLIC;
