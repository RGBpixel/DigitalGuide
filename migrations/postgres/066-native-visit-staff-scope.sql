-- Append-only correction to applied065: fixed recipient helper name in staff write scope.
CREATE OR REPLACE FUNCTION dg_native_visit_staff_scope(target text,own_only boolean DEFAULT false,write_value boolean DEFAULT false) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE m memberships%ROWTYPE;v visits%ROWTYPE;d _dg_native_visit_drafts%ROWTYPE;terminal_value text;
BEGIN
 PERFORM dg_native_reception_runtime();SELECT * INTO m FROM dg_native_locked_membership(current_setting('digitalguide.actor_id',true));
 IF m.user_id IS NULL OR(own_only AND m.role NOT IN('admin','editor')) OR(NOT own_only AND m.role<>'admin') THEN PERFORM dg_native_visit_error('FORBIDDEN');END IF;
 SELECT * INTO v FROM visits WHERE id=target AND tenant_id=m.tenant_id;IF v.id IS NULL OR NOT(m.workspace_ids::jsonb ? v.workspace_id) THEN PERFORM dg_native_visit_error('NOT_FOUND');END IF;d:=dg_native_visit_draft(v.id);
 IF own_only AND(d.recipient_id IS DISTINCT FROM m.user_id OR NOT dg_native_visit_target_valid(v.id)) THEN PERFORM dg_native_visit_error('NOT_FOUND');END IF;
 IF write_value THEN PERFORM user_id FROM memberships WHERE user_id=d.recipient_id FOR SHARE;END IF;
 IF write_value THEN PERFORM pg_advisory_xact_lock(hashtextextended('["native-asset-workspace",'||to_jsonb(v.tenant_id)::text||','||to_jsonb(v.workspace_id)::text||']',0));ELSE PERFORM pg_advisory_xact_lock_shared(hashtextextended('["native-asset-workspace",'||to_jsonb(v.tenant_id)::text||','||to_jsonb(v.workspace_id)::text||']',0));END IF;
 PERFORM dg_native_reception_workspace(v.tenant_id,v.workspace_id,write_value);
 IF write_value THEN
  SELECT terminal_id INTO terminal_value FROM _dg_native_visit_origins WHERE visit_id=target;PERFORM id FROM reception_terminals WHERE id=terminal_value FOR UPDATE;PERFORM id FROM reception_sessions WHERE id=v.session_id FOR UPDATE;PERFORM id FROM visits WHERE id=target FOR UPDATE;
  IF (SELECT recipient_id FROM dg_native_visit_draft(target)) IS DISTINCT FROM d.recipient_id THEN PERFORM dg_native_visit_error('VERSION_CONFLICT');END IF;
 END IF;
 IF own_only AND NOT dg_native_visit_target_valid(v.id) THEN PERFORM dg_native_visit_error('NOT_FOUND');END IF;RETURN v.workspace_id;
END;$dg$;
