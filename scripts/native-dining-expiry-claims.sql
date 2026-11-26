CREATE FUNCTION dg_native_dining_claim_attempt(target text,token_hash_value text,csrf_hash_value text,focus_value bigint,key_hash_value text,body_hash_value text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;old _dg_native_dining_claim_attempts%ROWTYPE;
BEGIN
 meta:=dg_native_dining_context('restaurant',(SELECT restaurant_id FROM _dg_native_dining_session_origins WHERE session_id=target),target,token_hash_value,csrf_hash_value,focus_value,true);
 IF key_hash_value IS NULL OR key_hash_value!~'^[a-f0-9]{64}$' OR body_hash_value IS NULL OR body_hash_value!~'^[a-f0-9]{64}$' THEN PERFORM dg_native_dining_error('VALIDATION_FAILED');END IF;
 SELECT * INTO old FROM _dg_native_dining_claim_attempts WHERE session_id=target AND key_hash=key_hash_value;
 IF old.id IS NOT NULL THEN IF old.body_hash<>body_hash_value THEN PERFORM dg_native_dining_error('IDEMPOTENCY_CONFLICT');END IF;RETURN;END IF;
 IF(SELECT count(*) FROM _dg_native_dining_claim_attempts WHERE session_id=target AND created_at>dg_native_people_iso(clock_timestamp()-interval '15 minutes'))>=5 THEN PERFORM dg_native_dining_error('CLAIM_RATE_LIMITED');END IF;
 INSERT INTO _dg_native_dining_claim_attempts VALUES(gen_random_uuid()::text,target,meta->>'restaurantId',meta->>'accessId',focus_value,key_hash_value,body_hash_value,dg_utc_now());
END;$dg$;
CREATE FUNCTION dg_native_dining_claim_descriptor(target text,token_hash_value text,csrf_hash_value text,focus_value bigint,party_value text,code_hash_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;p dining_parties%ROWTYPE;
BEGIN
 meta:=dg_native_dining_context('restaurant',(SELECT restaurant_id FROM _dg_native_dining_session_origins WHERE session_id=target),target,token_hash_value,csrf_hash_value,focus_value,true);
 SELECT p0.* INTO p FROM dining_parties p0 JOIN _dg_native_dining_party_origins origin ON origin.party_id=p0.id WHERE p0.id=party_value AND p0.restaurant_id=meta->>'restaurantId' AND p0.status IN('waiting','reserved','held','seated') AND p0.claim_expires_at>dg_utc_now() AND p0.claim_hash=code_hash_value FOR UPDATE OF p0;
 IF p.id IS NULL THEN PERFORM dg_native_dining_error('INVALID_DINING_CLAIM');END IF;RETURN jsonb_build_object('partyId',p.id,'restaurantId',p.restaurant_id,'version',p.version,'accessVersion',p.access_version,'nonce',p.claim_nonce,'sha256',p.claim_hash,'expiresAt',p.claim_expires_at);
END;$dg$;
CREATE FUNCTION dg_native_dining_sweep(restaurant_value text DEFAULT NULL) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE r restaurants%ROWTYPE;o dining_occupancies%ROWTYPE;p dining_parties%ROWTYPE;b dining_reservations%ROWTYPE;meta jsonb;action_value text;now_value text:=dg_utc_now();changed bigint:=0;state_value text;
BEGIN
 PERFORM dg_native_reception_runtime(true);
 FOR r IN SELECT r0.* FROM restaurants r0 JOIN _dg_native_restaurant_origins origin ON origin.restaurant_id=r0.id WHERE origin.runtime_id=(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1) AND r0.environment='mock' AND r0.app_env=(SELECT app_env FROM _dg_native_runtime_control WHERE id=1) AND(restaurant_value IS NULL OR r0.id=restaurant_value) ORDER BY r0.id LOOP
  IF NOT EXISTS(SELECT 1 FROM dining_occupancies WHERE restaurant_id=r.id AND state='held' AND expires_at<=now_value) AND NOT EXISTS(SELECT 1 FROM dining_reservations WHERE restaurant_id=r.id AND(status='confirmed' AND(dg_native_dining_booking_clock(id)).late_deadline<now_value OR status='checked_in' AND ends_at<=now_value)) THEN CONTINUE;END IF;
  PERFORM dg_native_reception_workspace(r.tenant_id,r.workspace_id,true);SELECT current_store.* INTO r FROM restaurants current_store WHERE current_store.id=r.id FOR UPDATE;
  meta:=jsonb_build_object('restaurantId',r.id,'tenantId',r.tenant_id,'workspaceId',r.workspace_id,'actorType','worker','actorId','system:dining-expiry','actorEpoch',NULL,'grantVersion',NULL,'sessionId',NULL,'accessId',NULL,'focusVersion',NULL,'selectionVersion',NULL);
  FOR o IN SELECT current_hold.* FROM dining_occupancies current_hold JOIN _dg_native_dining_occupancy_origins origin ON origin.occupancy_id=current_hold.id WHERE current_hold.restaurant_id=r.id AND current_hold.state='held' AND current_hold.expires_at<=now_value ORDER BY current_hold.id FOR UPDATE OF current_hold LOOP
   SELECT * INTO p FROM dining_parties WHERE id=o.party_id FOR UPDATE;action_value:=dg_native_dining_action(meta,'hold_expired','party',p.id,'{}');PERFORM dg_native_dining_effect(action_value,'dining_occupancies',o.id);UPDATE dining_occupancies SET state='expired',version=version+1,updated_at=now_value WHERE id=o.id;
   IF p.status='held' THEN PERFORM dg_native_dining_effect(action_value,'dining_parties',p.id);UPDATE dining_parties SET status='waiting',version=version+1,updated_at=now_value WHERE id=p.id;END IF;PERFORM dg_native_dining_table_touch(action_value,o.table_id);changed:=changed+1;
  END LOOP;
  FOR b IN SELECT current_booking.* FROM dining_reservations current_booking JOIN _dg_native_dining_party_origins origin ON origin.party_id=current_booking.party_id WHERE current_booking.restaurant_id=r.id AND(current_booking.status='confirmed' AND(dg_native_dining_booking_clock(current_booking.id)).late_deadline<now_value OR current_booking.status='checked_in' AND current_booking.ends_at<=now_value) ORDER BY current_booking.id FOR UPDATE OF current_booking LOOP
   SELECT * INTO p FROM dining_parties WHERE id=b.party_id FOR UPDATE;state_value:=CASE WHEN b.status='confirmed' THEN 'no_show' ELSE 'expired' END;action_value:=dg_native_dining_action(meta,'booking_'||state_value,'party',p.id,'{}');PERFORM dg_native_dining_effect(action_value,'dining_reservations',b.id);UPDATE dining_reservations SET status=state_value,version=version+1 WHERE id=b.id;
   PERFORM dg_native_dining_effect(action_value,'dining_parties',p.id);IF state_value='no_show' THEN UPDATE dining_parties SET status='no_show',version=version+1,access_version=access_version+1,ended_at=now_value,updated_at=now_value WHERE id=p.id;ELSE UPDATE dining_parties SET version=version+1,updated_at=now_value WHERE id=p.id;END IF;PERFORM dg_native_dining_table_touch(action_value,b.table_id);changed:=changed+1;
  END LOOP;
 END LOOP;RETURN changed;
END;$dg$;
