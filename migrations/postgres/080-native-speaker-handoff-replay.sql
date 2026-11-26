-- Append-only correction to SQL079. Prepared intents still require the current
-- membership/reference hint. A committed original intent authenticates only its
-- own unclaimed delivery; the retired reference is no longer an action source.

CREATE OR REPLACE FUNCTION dg_native_speaker_handoff_scope(target text,token_hash_value text,csrf_hash_value text,intent_value text,intent_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE h _dg_native_speaker_handoffs%ROWTYPE;o _dg_native_speaker_handoff_origins%ROWTYPE;a _dg_native_reception_access%ROWTYPE;s reception_sessions%ROWTYPE;n reception_sessions%ROWTYPE;origin _dg_native_reception_origins%ROWTYPE;snapshot_value jsonb;
BEGIN
 PERFORM dg_native_reception_runtime();
 -- One statement snapshot prevents mixing a prepared intent with the old
 -- session's concurrently committed closure (or a committed intent with an
 -- independently claimed capability).
 SELECT jsonb_build_object('h',to_jsonb(h0),'o',to_jsonb(o0),'a',to_jsonb(a0),'s',to_jsonb(s0),'origin',to_jsonb(r0),'n',to_jsonb(n0)) INTO snapshot_value FROM _dg_native_speaker_handoffs h0 JOIN _dg_native_speaker_handoff_origins o0 ON o0.id=h0.id JOIN _dg_native_reception_access a0 ON a0.id=o0.access_id JOIN reception_sessions s0 ON s0.id=h0.session_id JOIN _dg_native_reception_origins r0 ON r0.session_id=s0.id LEFT JOIN reception_sessions n0 ON n0.id=h0.next_session_id WHERE h0.id=intent_value AND h0.session_id=target;
 h:=jsonb_populate_record(NULL::_dg_native_speaker_handoffs,coalesce(snapshot_value->'h','{}'));o:=jsonb_populate_record(NULL::_dg_native_speaker_handoff_origins,coalesce(snapshot_value->'o','{}'));a:=jsonb_populate_record(NULL::_dg_native_reception_access,coalesce(snapshot_value->'a','{}'));s:=jsonb_populate_record(NULL::reception_sessions,coalesce(snapshot_value->'s','{}'));origin:=jsonb_populate_record(NULL::_dg_native_reception_origins,coalesce(snapshot_value->'origin','{}'));n:=jsonb_populate_record(NULL::reception_sessions,coalesce(nullif(snapshot_value->'n','null'::jsonb),'{}'));
 IF h.id IS NULL OR o.id IS NULL OR h.session_id<>target OR o.session_id<>target OR h.state NOT IN('prepared','committed') OR h.token_hash='' OR h.token_hash IS DISTINCT FROM intent_hash OR o.token_hash IS DISTINCT FROM intent_hash OR o.expires_at<=dg_utc_now() OR a.id IS NULL OR a.session_id<>target OR a.token_hash IS DISTINCT FROM token_hash_value OR csrf_hash_value IS NOT NULL AND a.csrf_hash IS DISTINCT FROM csrf_hash_value OR a.access_version<>o.access_version OR a.expires_at<=dg_utc_now() THEN PERFORM dg_native_speaker_error('HANDOFF_UNAVAILABLE');END IF;
 IF NOT dg_native_reception_source_valid(target) THEN PERFORM dg_native_speaker_error('SOURCE_UNAVAILABLE');END IF;
 IF h.state='prepared' THEN
  IF s.status<>'active' OR s.version<>o.session_version OR s.focus_version<>o.focus_version OR s.access_version<>o.access_version OR s.expires_at<=dg_utc_now() OR s.activity_at<=dg_native_people_iso(clock_timestamp()-interval '120 seconds') THEN PERFORM dg_native_speaker_error('VERSION_CONFLICT');END IF;
 ELSE
  -- n belongs to the same authenticated statement snapshot as h.
  IF s.status<>'ended' OR s.ended_reason<>'speaker_participant_handoff' OR s.focus_version<>o.focus_version+1 OR s.access_version<>o.access_version+1 OR n.id IS NULL OR n.status<>'active' OR n.focus_version<>0 OR n.access_version<>1 OR n.expires_at<=dg_utc_now() OR n.activity_at<=dg_native_people_iso(clock_timestamp()-interval '120 seconds') OR NOT dg_native_reception_source_valid(n.id) THEN PERFORM dg_native_speaker_error('HANDOFF_UNAVAILABLE');END IF;
 END IF;
 RETURN jsonb_build_object('id',s.id,'tenantId',s.tenant_id,'workspaceId',s.workspace_id,'terminalId',s.terminal_id,'actorId',origin.actor_id,'status',s.status,'version',s.version,'focusVersion',s.focus_version,'replyEpoch',s.reply_epoch,'accessVersion',s.access_version,'expiresAt',s.expires_at,'profile',origin.profile::jsonb,'scene',origin.scene::jsonb,'assets',origin.assets::jsonb);
END;$dg$;

CREATE OR REPLACE FUNCTION dg_native_speaker_handoff_prelock(target text,token_hash_value text,csrf_hash_value text,intent_value text,intent_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;candidate record;v visits%ROWTYPE;d _dg_native_visit_drafts%ROWTYPE;f speaker_focus_sessions%ROWTYPE;
BEGIN
 meta:=dg_native_speaker_handoff_scope(target,token_hash_value,csrf_hash_value,intent_value,intent_hash);SELECT * INTO v FROM visits WHERE session_id=target;d:=dg_native_visit_draft(v.id);SELECT * INTO f FROM speaker_focus_sessions WHERE session_id=target;
 FOR candidate IN SELECT user_id FROM(SELECT meta->>'actorId' user_id UNION SELECT actor_id FROM _dg_native_reception_terminals WHERE terminal_id=meta->>'terminalId' UNION SELECT d.recipient_id UNION SELECT owner_user_id FROM speaker_references WHERE id=f.reference_id) q WHERE user_id IS NOT NULL ORDER BY user_id LOOP PERFORM user_id FROM dg_native_locked_membership(candidate.user_id);END LOOP;
 IF f.mode='enrolled' AND f.reference_id IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('native-speaker-reference:'||f.reference_id,0));END IF;
 -- Leave parent locks to the subsequent operation, after Node validates and
 -- locks the fixed assets/core workspace. Store only the membership hint.
 meta:=dg_native_speaker_handoff_scope(target,token_hash_value,csrf_hash_value,intent_value,intent_hash);IF(SELECT state FROM _dg_native_speaker_handoffs WHERE id=intent_value)='prepared' THEN PERFORM dg_native_speaker_check_hint(target,jsonb_build_object('visitId',v.id,'visitVersion',v.version,'recipientId',d.recipient_id,'referenceId',f.reference_id));END IF;PERFORM set_config('digitalguide.native_handoff_hint',jsonb_build_object('sessionId',target,'hint',jsonb_build_object('visitId',v.id,'visitVersion',v.version,'recipientId',d.recipient_id,'referenceId',f.reference_id))::text,true);RETURN meta;
END;$dg$;

CREATE OR REPLACE FUNCTION dg_native_speaker_handoff_lock(target text,token_hash_value text,csrf_hash_value text,intent_value text,intent_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;hint_value jsonb;h _dg_native_speaker_handoffs%ROWTYPE;
BEGIN
 hint_value:=nullif(current_setting('digitalguide.native_handoff_hint',true),'')::jsonb;IF hint_value->>'sessionId' IS DISTINCT FROM target OR jsonb_typeof(hint_value->'hint') IS DISTINCT FROM 'object' THEN PERFORM dg_native_speaker_error('FORBIDDEN');END IF;
 meta:=dg_native_speaker_handoff_scope(target,token_hash_value,csrf_hash_value,intent_value,intent_hash);PERFORM dg_native_reception_workspace(meta->>'tenantId',meta->>'workspaceId',true);PERFORM id FROM reception_terminals WHERE id=meta->>'terminalId' FOR UPDATE;PERFORM id FROM reception_sessions WHERE id=target FOR UPDATE;SELECT * INTO h FROM _dg_native_speaker_handoffs WHERE id=intent_value FOR UPDATE;
 IF h.state='prepared' THEN PERFORM dg_native_speaker_check_hint(target,hint_value->'hint');END IF;
 RETURN dg_native_speaker_handoff_scope(target,token_hash_value,csrf_hash_value,intent_value,intent_hash);
END;$dg$;
