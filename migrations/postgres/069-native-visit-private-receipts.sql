-- Administrative reconciliation retains minimal transport facts after visitor
-- redaction. Guest projections continue to omit delivery identifiers.
CREATE FUNCTION dg_native_visit_internal_delivery(target text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT jsonb_build_object('id',id,'status',status,'version',version,'environment',environment,'remoteId',remote_id,'errorCode',error_code,'channel',native_channel,'availability',native_availability) FROM visit_deliveries WHERE visit_id=target
$dg$;
REVOKE ALL ON FUNCTION dg_native_visit_internal_delivery(text) FROM PUBLIC;
CREATE OR REPLACE FUNCTION dg_native_visit_staff_view(target text,own_only boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v visits%ROWTYPE;d _dg_native_visit_drafts%ROWTYPE;
BEGIN
 PERFORM dg_native_visit_staff_scope(target,own_only,false);SELECT * INTO STRICT v FROM visits WHERE id=target;d:=dg_native_visit_draft(target);
 RETURN dg_native_visit_public(target)||jsonb_build_object('workspaceId',v.workspace_id,'delivery',dg_native_visit_internal_delivery(target),'venueId',v.venue_id,'recipientIsMe',coalesce(d.recipient_id=current_setting('digitalguide.actor_id',true),false),'privateNote',v.host_private_note,'escalatedReason',v.escalated_reason,'canRespond',coalesce(d.recipient_id=current_setting('digitalguide.actor_id',true),false) AND v.status='waiting_host' AND dg_native_visit_source_valid(v.id));
END;$dg$;
