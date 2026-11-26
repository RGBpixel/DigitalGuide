-- A concurrent original-key retry may observe the reference just installed by
-- the same ticket. Its owner and reference advisory lock were already acquired.
-- Reject genuinely unknown references; do not reject this known current grant.
CREATE OR REPLACE FUNCTION dg_native_speaker_prelock(target text,token_hash_value text,ticket_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;candidate record;v visits%ROWTYPE;d _dg_native_visit_drafts%ROWTYPE;f speaker_focus_sessions%ROWTYPE;new_reference text;original_reference text;locked_ids text[];needed_ids text[];
BEGIN
 PERFORM dg_native_reception_runtime();meta:=dg_native_reception_meta(target,token_hash_value);
 IF token_hash_value IS NULL THEN PERFORM dg_native_reception_admin(meta->>'workspaceId');END IF;
 SELECT * INTO v FROM visits WHERE session_id=target;d:=dg_native_visit_draft(v.id);SELECT * INTO f FROM speaker_focus_sessions WHERE session_id=target;original_reference:=f.reference_id;
 SELECT o.reference_id INTO new_reference FROM _dg_native_speaker_ticket_origins o JOIN speaker_use_tickets t ON t.id=o.ticket_id WHERE o.ticket_id=ticket_value AND o.session_id=target AND o.tenant_id=meta->>'tenantId' AND o.workspace_id=meta->>'workspaceId';
 SELECT array_agg(user_id ORDER BY user_id) INTO locked_ids FROM(SELECT meta->>'actorId' user_id UNION SELECT actor_id FROM _dg_native_reception_terminals WHERE terminal_id=meta->>'terminalId' UNION SELECT d.recipient_id UNION SELECT owner_user_id FROM speaker_references WHERE id IN(f.reference_id,new_reference)) q WHERE user_id IS NOT NULL;
 FOR candidate IN SELECT unnest(locked_ids) user_id LOOP PERFORM user_id FROM dg_native_locked_membership(candidate.user_id);END LOOP;
 FOR candidate IN SELECT id FROM speaker_references WHERE id IN(f.reference_id,new_reference) AND scope='enrolled' ORDER BY id LOOP PERFORM pg_advisory_xact_lock(hashtextextended('native-speaker-reference:'||candidate.id,0));END LOOP;
 -- Recheck after waiting: the current reference or recipient may have changed.
 SELECT * INTO v FROM visits WHERE session_id=target;d:=dg_native_visit_draft(v.id);SELECT * INTO f FROM speaker_focus_sessions WHERE session_id=target;
 SELECT array_agg(user_id ORDER BY user_id) INTO needed_ids FROM(SELECT d.recipient_id user_id UNION SELECT owner_user_id FROM speaker_references WHERE id=f.reference_id) q WHERE user_id IS NOT NULL;
 IF f.reference_id IS NOT NULL AND f.reference_id IS DISTINCT FROM original_reference AND f.reference_id IS DISTINCT FROM new_reference OR NOT coalesce(needed_ids,ARRAY[]::text[]) <@ coalesce(locked_ids,ARRAY[]::text[]) THEN PERFORM dg_native_speaker_error('VERSION_CONFLICT');END IF;
 RETURN jsonb_build_object('visitId',v.id,'visitVersion',v.version,'recipientId',d.recipient_id,'referenceId',f.reference_id);
END;$dg$;
REVOKE ALL ON FUNCTION dg_native_speaker_prelock(text,text,text) FROM PUBLIC;
