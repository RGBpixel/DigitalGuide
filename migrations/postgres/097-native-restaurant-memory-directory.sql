-- Restaurant self-reported memory never enters the enterprise reception directory.
CREATE OR REPLACE FUNCTION dg_native_people_directory(workspaces_value text[],cursor_value text,limit_value integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE actor text:=current_setting('digitalguide.actor_id',true);member record;workspace_value text;result jsonb;
BEGIN
 PERFORM dg_native_people_runtime();SELECT * INTO member FROM dg_native_locked_membership(actor);IF member.role IS DISTINCT FROM 'admin' THEN PERFORM dg_native_people_error('FORBIDDEN');END IF;
 IF workspaces_value IS NULL OR cardinality(workspaces_value)>1000 OR limit_value NOT BETWEEN 1 AND 101 OR cursor_value IS NULL THEN PERFORM dg_native_people_error('VALIDATION_FAILED');END IF;
 FOREACH workspace_value IN ARRAY workspaces_value LOOP IF NOT dg_native_office_member(actor,member.tenant_id,workspace_value) THEN PERFORM dg_native_people_error('NOT_FOUND');END IF;END LOOP;
 SELECT coalesce(jsonb_agg(row_value ORDER BY id),'[]') INTO result FROM(SELECT p.id,jsonb_build_object('id',p.id,'displayName',p.display_name,'workspaceId',p.workspace_id,'roles',p.roles::jsonb,'identity',p.identity_kind,'expiresAt',p.expires_at) row_value FROM people p JOIN _dg_native_people_guards g ON g.person_id=p.id WHERE p.tenant_id=member.tenant_id AND p.workspace_id=ANY(workspaces_value) AND p.status='active' AND p.expires_at>dg_utc_now() AND g.invalidated_at IS NULL AND NOT EXISTS(SELECT 1 FROM _dg_native_food_memory_scopes restaurant_scope WHERE restaurant_scope.person_id=p.id) AND p.id>cursor_value ORDER BY p.id LIMIT limit_value) q;RETURN result;
END;$dg$;

