-- Append-only correction: distinguish purpose record variable from SQL table alias.
CREATE OR REPLACE FUNCTION dg_native_commit_live_capture(target text,token text,rid text,snapshot_text text,snapshot_digest text,guard_text text,guard_digest text,receipt_text text,receipt_digest text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE source jsonb;expected jsonb:='[]'::jsonb;g jsonb:=guard_text::jsonb;v jsonb:=receipt_text::jsonb;r live_guest_programme_grants%ROWTYPE;prior text;
BEGIN
 FOR source IN SELECT DISTINCT p.value FROM live_output_spans s JOIN live_output_generations n ON n.id=s.generation_id CROSS JOIN LATERAL jsonb_array_elements(coalesce(s.frame::jsonb->'guests','[]'::jsonb)) p WHERE s.output_id=target AND s.first_frame<n.start_frame+n.published_frames AND s.last_frame>=n.start_frame LOOP
  SELECT * INTO STRICT r FROM live_guest_programme_grants WHERE id=source->>'grantId';
  IF NOT dg_native_programme_source_valid(r.id,source->>'connectionId',r.tenant_id,r.workspace_id,true) OR r.consent_hash IS DISTINCT FROM source->>'consentHash' OR r.output_id<>target OR g->>'expiresAt' IS NULL OR (g->>'expiresAt')::timestamptz>r.expires_at::timestamptz THEN RAISE EXCEPTION 'Native programme recording purpose is missing, withdrawn or expired';END IF;
 END LOOP;
 SELECT coalesce(jsonb_agg(q.source ORDER BY q.connection_id),'[]'::jsonb) INTO expected FROM(
  SELECT DISTINCT c.id AS connection_id,jsonb_build_object('grantId',purpose_row.id,'connectionId',c.id,'inviteId',purpose_row.invite_id,'consentHash',purpose_row.consent_hash,'expiresAt',purpose_row.expires_at,'recordingAllowed',true) AS source FROM live_output_spans s JOIN live_output_generations n ON n.id=s.generation_id CROSS JOIN LATERAL jsonb_array_elements(coalesce(s.frame::jsonb->'guests','[]'::jsonb)) p JOIN live_guest_programme_connections c ON c.id=p->>'connectionId' JOIN live_guest_programme_grants purpose_row ON purpose_row.id=c.grant_id WHERE s.output_id=target AND s.first_frame<n.start_frame+n.published_frames AND s.last_frame>=n.start_frame
 )q;
 IF coalesce(g->'guestProgramme','[]'::jsonb) IS DISTINCT FROM expected OR coalesce(v->'guestProgramme','[]'::jsonb) IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Native programme capture must pin every actually published independent recording purpose';END IF;
 prior:=dg_native_commit_live_capture_pre_programme(target,token,rid,snapshot_text,snapshot_digest,guard_text,guard_digest,receipt_text,receipt_digest);RETURN prior;
END $dg$;
REVOKE ALL ON FUNCTION dg_native_programme_span_guard(),dg_native_commit_live_capture(text,text,text,text,text,text,text,text,text) FROM PUBLIC;
