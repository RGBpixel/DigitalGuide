-- R-009/R-058/R-059. A pure dependency inspection context permits precise
-- invalidation in quarantine; it never changes runtime state or enables workers.
CREATE FUNCTION dg_native_recovery_authority_context() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE plan_value text:=current_setting('digitalguide.recovery_authority_plan',true);xid_value text:=current_setting('digitalguide.recovery_authority_xid',true);
BEGIN
 IF session_user IS DISTINCT FROM(SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname=current_schema()) OR xid_value IS DISTINCT FROM pg_current_xact_id_if_assigned()::text OR plan_value IS NULL OR NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND status='recovery_quarantined' AND environment='mock') OR to_regclass('public._dg_native_recovery_control') IS NULL THEN RETURN false;END IF;
 RETURN EXISTS(SELECT 1 FROM public._dg_native_recovery_control r JOIN _dg_native_recovery_journal_plans p ON p.backup_id=r.backup_id AND p.runtime_id=r.runtime_id JOIN _dg_native_recovery_journal_control c ON c.runtime_id=p.runtime_id AND c.stream_id=p.stream_id WHERE r.id=1 AND r.status='quarantined' AND r.schema_name=current_schema() AND p.id=plan_value AND p.status='pending' AND NOT EXISTS(SELECT 1 FROM _dg_native_recovery_journal_plans n WHERE n.backup_id=p.backup_id AND n.stream_id=p.stream_id AND n.generation>p.generation));
END;$dg$;
REVOKE ALL ON FUNCTION dg_native_recovery_authority_context() FROM PUBLIC;

CREATE OR REPLACE FUNCTION dg_native_character_dependencies(p_job text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j character_jobs%ROWTYPE;c studio_characters%ROWTYPE;v jsonb;r jsonb;a assets%ROWTYPE;u uploads%ROWTYPE;t consents%ROWTYPE;q character_jobs%ROWTYPE;app text;
BEGIN
 SELECT * INTO j FROM character_jobs WHERE id=p_job;SELECT app_env INTO app FROM _dg_native_runtime_control WHERE id=1 AND(status='validation_only' OR dg_native_recovery_authority_context());
 IF j.id IS NULL OR j.environment<>'mock' OR j.app_env IS DISTINCT FROM app OR NOT EXISTS(SELECT 1 FROM _dg_native_character_inputs i WHERE i.job_id=j.id AND i.input_hash=j.input_hash AND i.input_snapshot=j.input_snapshot) THEN RETURN false;END IF;
 v:=j.input_snapshot::jsonb;SELECT * INTO c FROM studio_characters WHERE id=j.character_id;
 IF c.id IS NULL OR c.tenant_id<>j.tenant_id OR c.workspace_id<>j.workspace_id OR c.environment<>j.environment OR c.app_env<>j.app_env OR c.archived<>0 OR c.version<>j.character_version OR c.expires_at::timestamptz<=clock_timestamp()
  OR v->'character'->>'id'<>c.id OR(v->'character'->>'version')::bigint<>c.version OR v->'character'->>'workspaceId'<>c.workspace_id OR v->'character'->>'sourceAssetId'<>c.source_asset_id OR(v->'character'->>'sourceVersion')::bigint<>c.source_version OR v->'character'->>'consentId'<>c.consent_id
  OR v->'source'->>'id'<>c.source_asset_id OR(v->'source'->>'version')::bigint<>c.source_version OR v->'source'->>'sha256'<>c.source_sha256
  OR NOT EXISTS(SELECT 1 FROM memberships m JOIN workspaces w ON w.id=j.workspace_id AND w.tenant_id=m.tenant_id WHERE m.user_id=j.actor_id AND m.tenant_id=j.tenant_id AND m.role IN('admin','editor') AND m.workspace_ids::jsonb ? j.workspace_id) THEN RETURN false;END IF;
 SELECT * INTO t FROM consents WHERE id=c.consent_id;
 IF t.id IS NULL OR t.tenant_id<>j.tenant_id OR t.workspace_id<>j.workspace_id OR t.asset_id<>c.source_asset_id OR t.purpose<>'character_use' OR t.revoked_at IS NOT NULL OR t.expires_at::timestamptz<=clock_timestamp() OR t.expires_at::timestamptz<c.expires_at::timestamptz THEN RETURN false;END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(jsonb_build_array(v->'source',v->'voice')) LOOP
  IF r IS NOT NULL AND r<>'null'::jsonb THEN
   SELECT * INTO a FROM assets WHERE id=r->>'id';SELECT * INTO u FROM uploads WHERE id=a.upload_id;
   IF a.id IS NULL OR u.id IS NULL OR a.tenant_id<>j.tenant_id OR a.workspace_id<>j.workspace_id OR a.archived<>0 OR a.version<>(r->>'version')::bigint OR(a.expires_at IS NOT NULL AND a.expires_at::timestamptz<=clock_timestamp()) OR u.tenant_id<>a.tenant_id OR u.workspace_id<>a.workspace_id OR u.sha256<>r->>'sha256' OR u.size<>(r->>'size')::bigint OR u.media_type<>r->>'mediaType' OR u.storage_key<>r->>'storageKey' OR u.specs::jsonb IS DISTINCT FROM r->'specs' OR(a.synthetic=1) IS DISTINCT FROM(r->>'synthetic')::boolean THEN RETURN false;END IF;
  END IF;
 END LOOP;
 IF v->'training'<>'null'::jsonb THEN
  IF j.operation<>'mock_training' OR NOT EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=j.actor_id AND m.tenant_id=j.tenant_id AND m.role='admin' AND m.workspace_ids::jsonb ? j.workspace_id) THEN RETURN false;END IF;
  SELECT * INTO t FROM consents WHERE id=v->'training'->>'consentId';SELECT * INTO q FROM character_jobs WHERE id=v->'training'->>'qualityJobId';
  IF t.id IS NULL OR t.tenant_id<>j.tenant_id OR t.workspace_id<>j.workspace_id OR t.asset_id<>c.source_asset_id OR t.purpose<>'train_avatar' OR t.revoked_at IS NOT NULL OR t.expires_at::timestamptz<=clock_timestamp() OR q.id IS NULL OR q.operation<>'quality' OR q.status<>'succeeded' OR q.character_id<>j.character_id OR q.character_version<>j.character_version OR NOT EXISTS(SELECT 1 FROM _dg_native_character_outputs o WHERE o.job_id=q.id AND o.quality_sha256=v->'training'->>'qualityHash') OR EXISTS(SELECT 1 FROM jsonb_array_elements(q.result::jsonb->'quality'->'findings') f WHERE f->>'level'='blocking') OR NOT dg_native_character_dependencies(q.id) THEN RETURN false;END IF;
 END IF;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $dg$;
