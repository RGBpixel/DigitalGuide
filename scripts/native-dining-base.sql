-- Private development/sandbox mock runtime. Confirmed dining facts outlive a conversation.
CREATE TABLE _dg_native_dining_party_origins(
 party_id text PRIMARY KEY REFERENCES dining_parties(id),restaurant_id text NOT NULL REFERENCES restaurants(id),
 runtime_id text NOT NULL,tenant_id text NOT NULL,workspace_id text NOT NULL,created_at text NOT NULL,transaction_id text NOT NULL
);
CREATE TABLE _dg_native_dining_actions(
 id text PRIMARY KEY,restaurant_id text NOT NULL REFERENCES restaurants(id),actor_type text NOT NULL CHECK(actor_type IN('staff','guest','worker')),
 actor_id text NOT NULL,actor_epoch bigint,grant_version bigint,session_id text REFERENCES reception_sessions(id),access_id text REFERENCES _dg_native_reception_access(id),focus_version bigint,selection_version bigint,
 kind text NOT NULL,resource_type text NOT NULL,resource_id text NOT NULL,body_hash text NOT NULL CHECK(body_hash~'^[a-f0-9]{64}$'),created_at text NOT NULL,transaction_id text NOT NULL
);
CREATE TABLE _dg_native_dining_changes(action_id text NOT NULL REFERENCES _dg_native_dining_actions(id),table_name text NOT NULL,resource_id text NOT NULL,transaction_id text NOT NULL,PRIMARY KEY(action_id,table_name,resource_id));
CREATE TABLE _dg_native_dining_plan_origins(plan_id text PRIMARY KEY REFERENCES dining_hold_plans(id),action_id text NOT NULL UNIQUE REFERENCES _dg_native_dining_actions(id),selection_version bigint);
CREATE TABLE _dg_native_dining_selection_revisions(session_id text NOT NULL REFERENCES reception_sessions(id),version bigint NOT NULL,party_id text REFERENCES dining_parties(id),action_id text NOT NULL REFERENCES _dg_native_dining_actions(id),created_at text NOT NULL,PRIMARY KEY(session_id,version));
CREATE TABLE _dg_native_dining_occupancy_origins(occupancy_id text PRIMARY KEY REFERENCES dining_occupancies(id),plan_id text NOT NULL UNIQUE REFERENCES dining_hold_plans(id),action_id text NOT NULL UNIQUE REFERENCES _dg_native_dining_actions(id));
CREATE TABLE _dg_native_dining_claim_attempts(
 id text PRIMARY KEY,session_id text NOT NULL REFERENCES reception_sessions(id),restaurant_id text NOT NULL REFERENCES restaurants(id),
 access_id text NOT NULL REFERENCES _dg_native_reception_access(id),focus_version bigint NOT NULL,key_hash text NOT NULL,body_hash text NOT NULL,created_at text NOT NULL,
 UNIQUE(session_id,key_hash),CHECK(key_hash~'^[a-f0-9]{64}$' AND body_hash~'^[a-f0-9]{64}$')
);
CREATE INDEX native_dining_claim_window ON _dg_native_dining_claim_attempts(session_id,created_at);
CREATE TABLE _dg_native_dining_booking_clocks(reservation_id text NOT NULL REFERENCES dining_reservations(id),revision bigint NOT NULL,starts_at text NOT NULL,ends_at text NOT NULL,checkin_opens_at text NOT NULL,late_deadline text NOT NULL,action_id text NOT NULL REFERENCES _dg_native_dining_actions(id),created_at text NOT NULL,PRIMARY KEY(reservation_id,revision));
CREATE TRIGGER native_dining_party_origin_immutable BEFORE UPDATE OR DELETE ON _dg_native_dining_party_origins FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_dining_action_immutable BEFORE UPDATE OR DELETE ON _dg_native_dining_actions FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_dining_change_immutable BEFORE UPDATE OR DELETE ON _dg_native_dining_changes FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_dining_plan_origin_immutable BEFORE UPDATE OR DELETE ON _dg_native_dining_plan_origins FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_dining_selection_immutable BEFORE UPDATE OR DELETE ON _dg_native_dining_selection_revisions FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_dining_occupancy_origin_immutable BEFORE UPDATE OR DELETE ON _dg_native_dining_occupancy_origins FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_dining_claim_attempt_immutable BEFORE UPDATE OR DELETE ON _dg_native_dining_claim_attempts FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_dining_booking_clock_immutable BEFORE UPDATE OR DELETE ON _dg_native_dining_booking_clocks FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_dining_plan_immutable BEFORE UPDATE OR DELETE ON dining_hold_plans FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();

CREATE FUNCTION dg_native_dining_error(code_value text) RETURNS void LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='DGDINING:'||code_value;END;$dg$;
CREATE FUNCTION dg_native_dining_iso(value text) RETURNS text LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE result text;
BEGIN IF value IS NULL OR char_length(value)>40 THEN PERFORM dg_native_dining_error('VALIDATION_FAILED');END IF;BEGIN result:=dg_native_people_iso(value::timestamptz);EXCEPTION WHEN data_exception THEN PERFORM dg_native_dining_error('VALIDATION_FAILED');END;RETURN result;END;$dg$;
CREATE FUNCTION dg_native_dining_open_interval(r restaurants,start_value text,end_value text) RETURNS boolean LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE point_value timestamptz;last_value timestamptz;local_value timestamp;minute_value integer;
BEGIN
 IF end_value::timestamptz<=start_value::timestamptz OR end_value::timestamptz-start_value::timestamptz>interval '4 hours' THEN PERFORM dg_native_dining_error('INVALID_DINING_INTERVAL');END IF;
 point_value:=start_value::timestamptz;last_value:=end_value::timestamptz-interval '1 millisecond';
 LOOP
  local_value:=point_value AT TIME ZONE r.timezone;minute_value:=extract(hour FROM local_value)::integer*60+extract(minute FROM local_value)::integer;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.opening_windows::jsonb) window_value WHERE window_value->'days' @> to_jsonb(ARRAY[extract(dow FROM local_value)::integer]) AND(window_value->>'startMinute')::integer<=minute_value AND(window_value->>'endMinute')::integer>minute_value) THEN RETURN false;END IF;
  EXIT WHEN point_value=last_value;point_value:=least(point_value+interval '1 minute',last_value);
 END LOOP;RETURN true;
END;$dg$;
CREATE FUNCTION dg_native_dining_fields(input jsonb) RETURNS void LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
 PERFORM dg_native_restaurant_fields(input,ARRAY['name','size','visitMinutes','guestNote']);PERFORM dg_native_restaurant_text(input->'name',1,60);PERFORM dg_native_restaurant_text(input->'guestNote',0,300);PERFORM dg_native_restaurant_integer(input->'size',1,40);PERFORM dg_native_restaurant_integer(input->'visitMinutes',15,240);
END;$dg$;
CREATE FUNCTION dg_native_dining_context(kind_value text,target text,session_value text DEFAULT NULL,token_hash_value text DEFAULT NULL,csrf_hash_value text DEFAULT NULL,focus_value bigint DEFAULT NULL,write_value boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE restaurant_value text;m memberships%ROWTYPE;meta jsonb;a _dg_native_reception_access%ROWTYPE;s reception_sessions%ROWTYPE;p dining_parties%ROWTYPE;r restaurants%ROWTYPE;stamp_value bigint;
BEGIN
 PERFORM dg_native_reception_runtime();
 IF kind_value='restaurant' THEN restaurant_value:=target;
 ELSIF kind_value='party' THEN SELECT restaurant_id INTO restaurant_value FROM _dg_native_dining_party_origins WHERE party_id=target;
 ELSIF kind_value='reservation' THEN SELECT b.restaurant_id INTO restaurant_value FROM dining_reservations b JOIN _dg_native_dining_party_origins o ON o.party_id=b.party_id WHERE b.id=target;
 ELSIF kind_value='plan' THEN SELECT b.restaurant_id INTO restaurant_value FROM dining_hold_plans b JOIN _dg_native_dining_plan_origins o ON o.plan_id=b.id WHERE b.id=target;
 ELSIF kind_value='hold' THEN SELECT b.restaurant_id INTO restaurant_value FROM dining_occupancies b JOIN _dg_native_dining_occupancy_origins o ON o.occupancy_id=b.id WHERE b.id=target;
 ELSE PERFORM dg_native_dining_error('VALIDATION_FAILED');END IF;
 IF restaurant_value IS NULL THEN PERFORM dg_native_dining_error('NOT_FOUND');END IF;
 IF session_value IS NULL THEN
  m:=dg_native_restaurant_actor();PERFORM dg_native_restaurant_prepare('restaurant',restaurant_value,false,write_value,NULL);stamp_value:=dg_native_restaurant_role(restaurant_value,false);
  meta:=jsonb_build_object('actorType','staff','actorId',m.user_id,'actorEpoch',(SELECT epoch FROM _dg_native_restaurant_member_epochs WHERE user_id=m.user_id),'grantVersion',stamp_value,'sessionId',NULL,'accessId',NULL,'focusVersion',NULL);
 ELSE
  PERFORM dg_native_reception_authorize(session_value,token_hash_value,csrf_hash_value,write_value);SELECT * INTO s FROM reception_sessions WHERE id=session_value;
  IF s.service_scene<>'restaurant' OR NOT EXISTS(SELECT 1 FROM _dg_native_dining_session_origins o WHERE o.session_id=s.id AND o.restaurant_id=restaurant_value) THEN PERFORM dg_native_dining_error('NOT_FOUND');END IF;
  IF focus_value IS NOT NULL AND focus_value<>s.focus_version OR write_value AND(s.status<>'active' OR focus_value IS NULL) THEN PERFORM dg_native_dining_error('VERSION_CONFLICT');END IF;
  SELECT * INTO a FROM _dg_native_reception_access WHERE session_id=s.id AND token_hash=token_hash_value AND access_version=s.access_version;
  PERFORM dg_native_reception_workspace(s.tenant_id,s.workspace_id,write_value);
  IF write_value THEN PERFORM id FROM restaurants WHERE id=restaurant_value FOR UPDATE;ELSE PERFORM id FROM restaurants WHERE id=restaurant_value FOR SHARE;END IF;
  meta:=jsonb_build_object('actorType','guest','actorId','guest:'||s.id,'actorEpoch',NULL,'grantVersion',NULL,'sessionId',s.id,'accessId',a.id,'focusVersion',s.focus_version);
 END IF;
 SELECT * INTO r FROM restaurants WHERE id=restaurant_value;
 IF r.id IS NULL OR r.environment<>'mock' OR r.app_env IS DISTINCT FROM(SELECT app_env FROM _dg_native_runtime_control WHERE id=1) OR NOT EXISTS(SELECT 1 FROM _dg_native_restaurant_origins o WHERE o.restaurant_id=r.id AND o.runtime_id=(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1)) THEN PERFORM dg_native_dining_error('NOT_FOUND');END IF;
 IF kind_value<>'restaurant' THEN
  SELECT p0.* INTO p FROM dining_parties p0 WHERE p0.id=CASE kind_value WHEN 'party' THEN target WHEN 'reservation' THEN(SELECT party_id FROM dining_reservations WHERE id=target) WHEN 'plan' THEN(SELECT party_id FROM dining_hold_plans WHERE id=target) ELSE(SELECT party_id FROM dining_occupancies WHERE id=target) END;
  IF p.id IS NULL OR p.restaurant_id<>r.id OR session_value IS NOT NULL AND p.owner_session_id IS DISTINCT FROM session_value THEN PERFORM dg_native_dining_error('NOT_FOUND');END IF;
 END IF;
 RETURN meta||jsonb_build_object('restaurantId',r.id,'workspaceId',r.workspace_id,'tenantId',r.tenant_id,'partyId',p.id,'selectionVersion',CASE WHEN session_value IS NOT NULL THEN coalesce((SELECT max(version) FROM _dg_native_dining_selection_revisions WHERE session_id=session_value),0) END);
END;$dg$;
CREATE FUNCTION dg_native_dining_action(meta jsonb,kind_value text,type_value text,resource_value text,input jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE id_value text:=gen_random_uuid()::text;
BEGIN
 INSERT INTO _dg_native_dining_actions VALUES(id_value,meta->>'restaurantId',meta->>'actorType',meta->>'actorId',(meta->>'actorEpoch')::bigint,(meta->>'grantVersion')::bigint,meta->>'sessionId',meta->>'accessId',(meta->>'focusVersion')::bigint,CASE WHEN meta->>'actorType'='guest' THEN(meta->>'selectionVersion')::bigint+CASE WHEN kind_value IN('create','reserve','select','claim') THEN 1 ELSE 0 END END,kind_value,type_value,resource_value,dg_native_office_hash(input),dg_utc_now(),pg_current_xact_id()::text);
 INSERT INTO audit_events VALUES(gen_random_uuid()::text,meta->>'tenantId',meta->>'workspaceId',meta->>'actorId','dining.'||kind_value,resource_value,'native-dining-operation',dg_utc_now(),'confirmed');RETURN id_value;
END;$dg$;
CREATE FUNCTION dg_native_dining_effect(action_value text,table_value text,target text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_dining_actions WHERE id=action_value AND transaction_id=pg_current_xact_id()::text) THEN PERFORM dg_native_dining_error('FORBIDDEN');END IF;
 INSERT INTO _dg_native_dining_changes VALUES(action_value,table_value,target,pg_current_xact_id()::text) ON CONFLICT DO NOTHING;
END;$dg$;
CREATE FUNCTION dg_native_dining_changed(table_value text,target text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT EXISTS(SELECT 1 FROM _dg_native_dining_changes c JOIN _dg_native_dining_actions a ON a.id=c.action_id WHERE c.table_name=table_value AND c.resource_id=target AND c.transaction_id=pg_current_xact_id()::text AND a.transaction_id=c.transaction_id)
$dg$;
CREATE FUNCTION dg_native_dining_owned(meta jsonb,target text) RETURNS dining_parties LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE p dining_parties%ROWTYPE;
BEGIN SELECT * INTO p FROM dining_parties WHERE id=target FOR UPDATE;IF p.id IS NULL OR p.restaurant_id IS DISTINCT FROM meta->>'restaurantId' OR NOT EXISTS(SELECT 1 FROM _dg_native_dining_party_origins WHERE party_id=p.id) OR meta->>'actorType'='guest' AND p.owner_session_id IS DISTINCT FROM meta->>'sessionId' THEN PERFORM dg_native_dining_error('NOT_FOUND');END IF;RETURN p;END;$dg$;
CREATE FUNCTION dg_native_dining_fits(t restaurant_tables,size_value bigint) RETURNS boolean LANGUAGE sql SET search_path FROM CURRENT AS $dg$
 SELECT t.enabled=1 AND size_value BETWEEN t.min_party_size AND t.capacity
$dg$;
CREATE FUNCTION dg_native_dining_booking_clock(target text) RETURNS _dg_native_dining_booking_clocks LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT * FROM _dg_native_dining_booking_clocks WHERE reservation_id=target ORDER BY revision DESC LIMIT 1
$dg$;
CREATE FUNCTION dg_native_dining_conflict(restaurant_value text,table_value text,start_value text,end_value text,party_value text DEFAULT NULL) RETURNS boolean LANGUAGE sql SET search_path FROM CURRENT AS $dg$
 SELECT EXISTS(SELECT 1 FROM dining_reservations b WHERE b.restaurant_id=restaurant_value AND b.table_id=table_value AND b.status IN('confirmed','checked_in') AND b.party_id IS DISTINCT FROM party_value AND b.starts_at<end_value AND b.ends_at>start_value)
$dg$;
CREATE FUNCTION dg_native_dining_available(r restaurants,p dining_parties,t restaurant_tables,end_value text) RETURNS boolean LANGUAGE sql SET search_path FROM CURRENT AS $dg$
 SELECT dg_native_dining_fits(t,p.size) AND t.operation='open' AND t.restaurant_id=r.id AND NOT EXISTS(SELECT 1 FROM dining_occupancies o WHERE o.table_id=t.id AND o.state IN('held','seated')) AND NOT dg_native_dining_conflict(r.id,t.id,dg_utc_now(),end_value,p.id)
$dg$;
CREATE FUNCTION dg_native_dining_touch(meta jsonb,action_value text,party_value text DEFAULT NULL,select_value boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s reception_sessions%ROWTYPE;
BEGIN
 IF meta->>'actorType'<>'guest' THEN RETURN;END IF;SELECT * INTO s FROM reception_sessions WHERE id=meta->>'sessionId' FOR UPDATE;
 PERFORM dg_native_dining_effect(action_value,'reception_sessions',s.id);PERFORM dg_native_reception_cancel(s.id);
 IF select_value THEN INSERT INTO _dg_native_dining_selection_revisions SELECT s.id,coalesce(max(version),0)+1,party_value,action_value,dg_utc_now() FROM _dg_native_dining_selection_revisions WHERE session_id=s.id;END IF;
 UPDATE reception_sessions SET dining_party_id=CASE WHEN select_value THEN party_value ELSE dining_party_id END,version=version+1,reply_epoch=reply_epoch+1,activity_at=dg_utc_now() WHERE id=s.id;
END;$dg$;
CREATE FUNCTION dg_native_dining_queue(r restaurants,action_value text) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE value bigint;
BEGIN PERFORM dg_native_dining_effect(action_value,'restaurants',r.id);UPDATE restaurants SET queue_counter=queue_counter+1,updated_at=dg_utc_now() WHERE id=r.id RETURNING queue_counter INTO value;RETURN value;END;$dg$;
