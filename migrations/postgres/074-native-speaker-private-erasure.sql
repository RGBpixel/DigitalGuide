-- R-133/R-053/R-054: deletion pauses only active focus contexts still linked
-- to this profile. A separately owned enrolled reference is not transferred or
-- deleted by an anonymous guest; the current session's temporary use is ended.
ALTER FUNCTION dg_native_people_erase_internal(text,text) RENAME TO dg_native_people_erase_before_speaker;
CREATE FUNCTION dg_native_people_erase_internal(target text,reason_value text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE linked record;
BEGIN
 FOR linked IN SELECT DISTINCT s.id,s.terminal_id,s.tenant_id,s.workspace_id FROM memory_session_links l JOIN reception_sessions s ON s.id=l.session_id JOIN speaker_focus_sessions f ON f.session_id=s.id AND f.focus_version=l.focus_version AND f.focus_version=s.focus_version WHERE l.person_id=target AND f.state NOT IN('idle','ended','handoff_pending') ORDER BY s.tenant_id,s.workspace_id,s.terminal_id,s.id LOOP
  PERFORM dg_native_reception_workspace(linked.tenant_id,linked.workspace_id,true);PERFORM id FROM reception_terminals WHERE id=linked.terminal_id FOR UPDATE;PERFORM id FROM reception_sessions WHERE id=linked.id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM speaker_focus_sessions f JOIN memory_session_links l ON l.session_id=f.session_id AND l.focus_version=f.focus_version AND l.person_id=target JOIN reception_sessions s ON s.id=f.session_id AND s.focus_version=f.focus_version WHERE f.session_id=linked.id AND f.state NOT IN('idle','ended','handoff_pending')) THEN
   PERFORM dg_native_reception_cancel(linked.id);UPDATE reception_sessions SET status='human',version=version+1,reply_epoch=reply_epoch+1 WHERE id=linked.id AND status='active';PERFORM dg_native_speaker_end(linked.id,'privacy_erased');
  END IF;
 END LOOP;
 RETURN dg_native_people_erase_before_speaker(target,reason_value);
END;$dg$;
REVOKE ALL ON FUNCTION dg_native_people_erase_internal(text,text),dg_native_people_erase_before_speaker(text,text) FROM PUBLIC;
