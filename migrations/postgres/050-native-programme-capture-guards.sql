-- Preserve late accepted-frame provenance; access checks reject withdrawn sources.
CREATE FUNCTION dg_native_programme_span_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE guests jsonb;v jsonb;x _dg_native_programme_instructions%ROWTYPE;c live_guest_programme_connections%ROWTYPE;
BEGIN
 guests:=NEW.frame::jsonb->'guests';IF guests IS NULL THEN RETURN NEW;END IF;
 IF jsonb_typeof(guests)<>'array' OR jsonb_array_length(guests)>3 OR (SELECT count(DISTINCT p->>'connectionId') FROM jsonb_array_elements(guests) p)<>jsonb_array_length(guests) THEN RAISE EXCEPTION 'Native programme frame guest list is invalid';END IF;
 IF jsonb_array_length(guests)>0 AND NOT EXISTS(SELECT 1 FROM live_outputs WHERE id=NEW.output_id AND snapshot::jsonb->'settings'->'guestProgramme'->>'enabled'='true') THEN RAISE EXCEPTION 'Native programme frames require explicit output opt-in';END IF;
 FOR v IN SELECT value FROM jsonb_array_elements(guests) LOOP
  SELECT * INTO x FROM _dg_native_programme_instructions WHERE connection_id=v->>'connectionId' AND version=(v->>'controlVersion')::bigint;SELECT * INTO c FROM live_guest_programme_connections WHERE id=v->>'connectionId';
  IF x.connection_id IS NULL OR c.id IS NULL OR x.generation_id<>NEW.generation_id OR c.output_id<>NEW.output_id OR c.generation_id<>NEW.generation_id OR c.runtime_token<>x.runtime_token OR x.payload::jsonb IS DISTINCT FROM v OR c.grant_id<>v->>'grantId' THEN RAISE EXCEPTION 'Native programme actual frame lacks its fixed worker selection';END IF;
 END LOOP;RETURN NEW;
END $dg$;
CREATE TRIGGER native_programme_span_guard BEFORE INSERT OR UPDATE OF frame,generation_id,output_id ON live_output_spans FOR EACH ROW EXECUTE FUNCTION dg_native_programme_span_guard();

-- The existing actual-capture transaction stays intact and is called only after
-- all actually published guest purposes have been independently checked.
ALTER FUNCTION dg_native_commit_live_capture(text,text,text,text,text,text,text,text,text) RENAME TO dg_native_commit_live_capture_pre_programme;
CREATE FUNCTION dg_native_commit_live_capture(target text,token text,rid text,snapshot_text text,snapshot_digest text,guard_text text,guard_digest text,receipt_text text,receipt_digest text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE source jsonb;expected jsonb:='[]'::jsonb;g jsonb:=guard_text::jsonb;v jsonb:=receipt_text::jsonb;r live_guest_programme_grants%ROWTYPE;prior text;
BEGIN
 FOR source IN SELECT DISTINCT p.value FROM live_output_spans s JOIN live_output_generations n ON n.id=s.generation_id CROSS JOIN LATERAL jsonb_array_elements(coalesce(s.frame::jsonb->'guests','[]'::jsonb)) p WHERE s.output_id=target AND s.first_frame<n.start_frame+n.published_frames AND s.last_frame>=n.start_frame LOOP
  SELECT * INTO STRICT r FROM live_guest_programme_grants WHERE id=source->>'grantId';
  IF NOT dg_native_programme_source_valid(r.id,source->>'connectionId',r.tenant_id,r.workspace_id,true) OR r.consent_hash IS DISTINCT FROM source->>'consentHash' OR r.output_id<>target OR g->>'expiresAt' IS NULL OR (g->>'expiresAt')::timestamptz>r.expires_at::timestamptz THEN RAISE EXCEPTION 'Native programme recording purpose is missing, withdrawn or expired';END IF;
 END LOOP;
 SELECT coalesce(jsonb_agg(q.source ORDER BY q.connection_id),'[]'::jsonb) INTO expected FROM(
  SELECT DISTINCT c.id AS connection_id,jsonb_build_object('grantId',r.id,'connectionId',c.id,'inviteId',r.invite_id,'consentHash',r.consent_hash,'expiresAt',r.expires_at,'recordingAllowed',true) AS source FROM live_output_spans s JOIN live_output_generations n ON n.id=s.generation_id CROSS JOIN LATERAL jsonb_array_elements(coalesce(s.frame::jsonb->'guests','[]'::jsonb)) p JOIN live_guest_programme_connections c ON c.id=p->>'connectionId' JOIN live_guest_programme_grants r ON r.id=c.grant_id WHERE s.output_id=target AND s.first_frame<n.start_frame+n.published_frames AND s.last_frame>=n.start_frame
 )q;
 IF coalesce(g->'guestProgramme','[]'::jsonb) IS DISTINCT FROM expected OR coalesce(v->'guestProgramme','[]'::jsonb) IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Native programme capture must pin every actually published independent recording purpose';END IF;
 prior:=dg_native_commit_live_capture_pre_programme(target,token,rid,snapshot_text,snapshot_digest,guard_text,guard_digest,receipt_text,receipt_digest);RETURN prior;
END $dg$;
REVOKE ALL ON FUNCTION dg_native_programme_span_guard(),dg_native_commit_live_capture(text,text,text,text,text,text,text,text,text) FROM PUBLIC;
