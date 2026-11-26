-- Same visitor: advance the current session before inserting its new consent link.
-- Keep the existing link guard and original retention deadline unchanged.
CREATE OR REPLACE FUNCTION dg_native_speaker_advance(target text,reason_value text,action_value text,activity_value boolean DEFAULT true) RETURNS reception_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s reception_sessions%ROWTYPE;p people%ROWTYPE;v visits%ROWTYPE;o _dg_native_visit_origins%ROWTYPE;d _dg_native_visit_drafts%ROWTYPE;next_value bigint;new_version bigint;hash_value text;now_value text:=dg_utc_now();
BEGIN
 SELECT * INTO STRICT s FROM reception_sessions WHERE id=target;next_value:=s.focus_version+1;
 PERFORM dg_native_reception_cancel(target);
 p:=dg_native_guest_memory_owned(target,false);
 SELECT * INTO v FROM visits WHERE session_id=target AND focus_version=s.focus_version;SELECT * INTO o FROM _dg_native_visit_origins WHERE visit_id=v.id;
 IF v.id IS NOT NULL AND o.context_invalidated_at IS NULL AND o.redacted_at IS NULL THEN
  d:=dg_native_visit_draft(v.id);INSERT INTO _dg_native_speaker_visit_focus_links VALUES(v.id,next_value,action_value,now_value);
  IF v.status='notifying' AND NOT EXISTS(SELECT 1 FROM visit_deliveries WHERE visit_id=v.id) THEN DELETE FROM visit_confirmation_targets WHERE visit_id=v.id;v.status:='awaiting_confirmation';END IF;
  UPDATE visits SET focus_version=next_value,version=version+1,status=v.status,confirmed_hash=CASE WHEN v.status='awaiting_confirmation' THEN NULL ELSE confirmed_hash END,confirmed_at=CASE WHEN v.status='awaiting_confirmation' THEN NULL ELSE confirmed_at END,notice_version=CASE WHEN v.status='awaiting_confirmation' THEN NULL ELSE notice_version END,updated_at=now_value WHERE id=v.id RETURNING version INTO new_version;
  IF v.status='awaiting_confirmation' THEN
   hash_value:=dg_native_office_hash(jsonb_build_object('guestName',v.guest_name,'company',v.company,'hostName',v.host_name,'purpose',v.purpose,'appointmentRef',v.appointment_ref,'sessionId',s.id,'focusVersion',next_value,'hostId',d.host_id,'hostVersion',d.host_version,'recipientId',d.recipient_id,'channel',d.channel));
   INSERT INTO _dg_native_visit_drafts VALUES(v.id,new_version,d.host_id,d.host_version,d.recipient_id,hash_value,d.channel,d.confirmation_expires_at,pg_current_xact_id()::text,now_value);
  END IF;
 END IF;
 UPDATE reception_sessions SET focus_version=next_value,version=version+1,reply_epoch=reply_epoch+1,activity_at=CASE WHEN activity_value THEN now_value ELSE activity_at END WHERE id=target;
 IF p.id IS NOT NULL THEN
  INSERT INTO memory_session_links(session_id,person_id,focus_version,consent_at,transcript_expires_at) SELECT session_id,person_id,next_value,consent_at,transcript_expires_at FROM memory_session_links WHERE session_id=target AND person_id=p.id AND focus_version=s.focus_version ON CONFLICT DO NOTHING;
  UPDATE people SET version=version+1,updated_at=now_value WHERE id=p.id;PERFORM dg_native_people_invalidate(p.id);
 END IF;
 INSERT INTO outbox_events VALUES(gen_random_uuid()::text,s.tenant_id,s.workspace_id,s.id,'speaker.focus_version_changed','mock','{}',now_value,NULL);
 SELECT * INTO s FROM reception_sessions WHERE id=target;RETURN s;
END;$dg$;
