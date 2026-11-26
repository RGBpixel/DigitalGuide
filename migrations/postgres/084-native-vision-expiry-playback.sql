-- Expiring the current visual reply also invalidates its playback epoch.
-- Original grant/session deadlines and activity time remain unchanged.
CREATE OR REPLACE FUNCTION dg_native_visual_sweep() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE candidate record;terminal_value text;count_value bigint:=0;changed bigint;impact_value boolean;
BEGIN
 PERFORM dg_native_reception_runtime(true);
 FOR candidate IN SELECT DISTINCT s.id,s.tenant_id,s.workspace_id,s.terminal_id FROM reception_sessions s JOIN visual_grants g ON g.session_id=s.id WHERE g.status='active' OR EXISTS(SELECT 1 FROM visual_requests r WHERE r.session_id=s.id AND r.status='pending') ORDER BY s.tenant_id,s.workspace_id,s.terminal_id,s.id LOOP
  IF NOT pg_try_advisory_xact_lock_shared(hashtextextended('native-reception-workspace:'||candidate.tenant_id||':'||candidate.workspace_id,0)) THEN CONTINUE;END IF;
  terminal_value:=NULL;SELECT id INTO terminal_value FROM reception_terminals WHERE id=candidate.terminal_id FOR UPDATE SKIP LOCKED;IF terminal_value IS NULL THEN CONTINUE;END IF;PERFORM id FROM reception_sessions WHERE id=candidate.id FOR UPDATE;
  FOR terminal_value IN SELECT id FROM visual_grants WHERE session_id=candidate.id AND status='active' AND NOT dg_native_visual_grant_current(id) LOOP
   SELECT EXISTS(SELECT 1 FROM visual_requests r JOIN reception_sessions s ON s.id=r.session_id WHERE r.grant_id=terminal_value AND r.status IN('pending','completed') AND r.reply_epoch=s.reply_epoch AND s.status='active') INTO impact_value;
   PERFORM dg_native_visual_revoke_internal(terminal_value,'expired_or_context_changed',true);
   IF impact_value THEN PERFORM dg_native_reception_cancel(candidate.id);UPDATE reception_sessions SET version=version+1,reply_epoch=reply_epoch+1 WHERE id=candidate.id AND status='active';END IF;count_value:=count_value+1;END LOOP;
  UPDATE visual_requests SET status='failed',error_code='VISION_TIMEOUT',completed_at=dg_utc_now() WHERE session_id=candidate.id AND status='pending' AND expires_at<=dg_utc_now();GET DIAGNOSTICS changed=ROW_COUNT;count_value:=count_value+changed;
 END LOOP;RETURN count_value;
END;$dg$;
