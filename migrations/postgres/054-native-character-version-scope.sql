-- 053 is immutable. Project and motion status only; never grant raw bodies.
CREATE FUNCTION dg_native_character_version_reason(p_job text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j character_jobs%ROWTYPE;v jsonb;app text;
BEGIN
 SELECT app_env INTO app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND(session_user=app_role OR session_user=worker_role);
 IF app IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Native character application role required';END IF;
 SELECT * INTO j FROM character_jobs WHERE id=p_job;
 IF j.id IS NULL OR j.environment<>'mock' OR j.app_env<>app THEN RETURN 'scope';END IF;
 v:=j.input_snapshot::jsonb;
 IF v->'project'<>'null'::jsonb AND NOT EXISTS(SELECT 1 FROM studio_projects p WHERE p.id=j.project_id AND p.tenant_id=j.tenant_id AND p.workspace_id=j.workspace_id AND p.archived=0 AND p.version=coalesce(j.applied_project_version,j.project_version)) THEN RETURN 'project';END IF;
 IF v->'motion'<>'null'::jsonb AND j.applied_project_version IS NULL AND NOT EXISTS(SELECT 1 FROM character_motion_plans p WHERE p.id=v->'motion'->>'id' AND p.character_id=j.character_id AND p.project_id=j.project_id AND p.version=(v->'motion'->>'version')::bigint AND p.payload::jsonb=v->'motion'->'content') THEN RETURN 'motion';END IF;
 RETURN NULL;
END $dg$;
REVOKE ALL ON FUNCTION dg_native_character_version_reason(text) FROM PUBLIC;
