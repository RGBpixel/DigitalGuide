-- PostgreSQL plans trigger record fields for every CASE branch. Use JSON keys
-- for the three supported source rows; keep the applied 075 immutable.
CREATE OR REPLACE FUNCTION dg_native_speaker_ticket_final() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE target text;o _dg_native_speaker_ticket_origins%ROWTYPE;t speaker_use_tickets%ROWTYPE;sig _dg_native_speaker_ticket_signatures%ROWTYPE;
BEGIN
 target:=coalesce(to_jsonb(NEW)->>'ticket_id',to_jsonb(NEW)->>'id');SELECT * INTO o FROM _dg_native_speaker_ticket_origins WHERE ticket_id=target;IF o.ticket_id IS NULL THEN RETURN NULL;END IF;SELECT * INTO t FROM speaker_use_tickets WHERE id=target;SELECT * INTO sig FROM _dg_native_speaker_ticket_signatures WHERE ticket_id=target;
 IF t.id IS NULL OR sig.ticket_id IS NULL OR t.reference_id<>o.reference_id OR t.session_id<>o.session_id OR t.focus_version<>o.focus_version OR t.expires_at<>o.expires_at OR t.created_at<>o.created_at OR t.used_at IS NULL AND t.revoked_at IS NULL AND t.token_hash IS DISTINCT FROM sig.token_hash OR(t.used_at IS NOT NULL OR t.revoked_at IS NOT NULL) AND t.token_hash<>'' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Single-use ticket must retain its original signed descriptor';END IF;RETURN NULL;
END;$dg$;
REVOKE ALL ON FUNCTION dg_native_speaker_ticket_final() FROM PUBLIC;
