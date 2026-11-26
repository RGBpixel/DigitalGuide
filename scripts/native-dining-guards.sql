CREATE FUNCTION dg_native_dining_row_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j jsonb:=to_jsonb(NEW);previous jsonb:=to_jsonb(OLD);r restaurants%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' OR NOT dg_native_dining_changed(TG_TABLE_NAME,j->>'id') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Dining facts require a scoped durable operation in their original transaction';END IF;
 SELECT * INTO r FROM restaurants WHERE id=j->>'restaurant_id';IF r.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Dining facts require their restaurant';END IF;
 IF TG_OP='UPDATE' THEN
  IF j->>'id' IS DISTINCT FROM previous->>'id' OR j->>'restaurant_id' IS DISTINCT FROM previous->>'restaurant_id' OR(j->>'version')::bigint<>(previous->>'version')::bigint+1 OR j->>'created_at' IS DISTINCT FROM previous->>'created_at' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Dining identity, original creation and monotonic versions are immutable';END IF;
 ELSE IF coalesce((j->>'version')::bigint,1)<>1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Dining records start at version one';END IF;END IF;
 IF TG_TABLE_NAME='dining_parties' THEN
  IF NEW.status NOT IN('waiting','reserved','held','seated','cancelled','completed','no_show') OR NEW.size NOT BETWEEN 1 AND 40 OR NEW.visit_minutes NOT BETWEEN 15 AND 240 OR char_length(btrim(NEW.name)) NOT BETWEEN 1 AND 60 OR char_length(NEW.guest_note)>300 OR NEW.current_preference_id IS NOT NULL OR NEW.claim_hash!~'^[a-f0-9]{64}$' OR NEW.claim_nonce!~'^[a-f0-9-]{36}$' OR NEW.access_version<1 OR NEW.version<1 OR NEW.claim_expires_at<=NEW.created_at OR(NEW.status IN('cancelled','completed','no_show'))<>(NEW.ended_at IS NOT NULL) OR(NEW.status='reserved')<>(NEW.queue_number IS NULL) AND NEW.status NOT IN('cancelled','completed','no_show') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Dining party fields, consent credential and state are bounded';END IF;
  IF TG_OP='INSERT' THEN IF NEW.status NOT IN('waiting','reserved') OR NEW.access_version<>1 OR NEW.seated_at IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='New dining parties are unseated';END IF;
  ELSE
   IF OLD.status IN('cancelled','completed','no_show') OR NEW.actor_id<>OLD.actor_id OR NEW.access_version NOT BETWEEN OLD.access_version AND OLD.access_version+1 OR(NEW.claim_nonce<>OLD.claim_nonce OR NEW.claim_hash<>OLD.claim_hash OR NEW.owner_session_id IS DISTINCT FROM OLD.owner_session_id) AND NEW.access_version<>OLD.access_version+1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Dining ownership and credentials cannot be rewritten without revocation';END IF;
   IF NEW.status<>OLD.status AND NOT(OLD.status='reserved' AND NEW.status IN('waiting','cancelled','no_show') OR OLD.status='waiting' AND NEW.status IN('held','cancelled') OR OLD.status='held' AND NEW.status IN('waiting','seated','cancelled') OR OLD.status='seated' AND NEW.status='completed') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Unsupported dining party state transition';END IF;
  END IF;
 ELSIF TG_TABLE_NAME='dining_reservations' THEN
  IF NEW.status NOT IN('confirmed','checked_in','seated','cancelled','no_show','completed','expired') OR NEW.ends_at<=NEW.starts_at OR NEW.ends_at::timestamptz-NEW.starts_at::timestamptz>interval '4 hours' OR NOT EXISTS(SELECT 1 FROM restaurant_tables WHERE id=NEW.table_id AND restaurant_id=NEW.restaurant_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Dining reservation table and bounded interval are guarded';END IF;
  IF TG_OP='INSERT' THEN IF NEW.status<>'confirmed' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='New reservations start confirmed';END IF;
  ELSE
   IF NEW.party_id<>OLD.party_id OR NEW.reference<>OLD.reference OR OLD.status IN('cancelled','no_show','completed','expired') OR NEW.status<>OLD.status AND NOT(OLD.status='confirmed' AND NEW.status IN('checked_in','cancelled','no_show') OR OLD.status='checked_in' AND NEW.status IN('seated','cancelled','expired') OR OLD.status='seated' AND NEW.status='completed') OR OLD.status<>'confirmed' AND(NEW.table_id<>OLD.table_id OR NEW.starts_at<>OLD.starts_at OR NEW.ends_at<>OLD.ends_at) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Reservation identity, finalized times and state are guarded';END IF;
  END IF;
 ELSIF TG_TABLE_NAME='dining_occupancies' THEN
  IF NEW.state NOT IN('held','seated','released','expired') OR NEW.state='held' AND(NEW.expires_at IS NULL OR NEW.expires_at>NEW.expected_end_at OR NEW.expires_at>dg_native_people_iso(NEW.created_at::timestamptz+make_interval(secs=>r.hold_seconds::double precision))) OR NEW.state='seated' AND NEW.expires_at IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Occupancies keep a bounded original hold and explicit actual seating';END IF;
  IF TG_OP='INSERT' THEN IF NEW.state<>'held' OR NEW.expires_at<=NEW.created_at THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Occupancies start with a future bounded hold';END IF;
  ELSE
   IF NEW.party_id<>OLD.party_id OR NEW.table_id<>OLD.table_id OR NEW.actor_id<>OLD.actor_id OR NEW.expected_end_at<>OLD.expected_end_at OR OLD.state IN('released','expired') OR NEW.state=OLD.state OR NOT(OLD.state='held' AND NEW.state IN('seated','released','expired') OR OLD.state='seated' AND NEW.state='released') OR NEW.expires_at IS DISTINCT FROM OLD.expires_at AND NOT(OLD.state='held' AND NEW.state='seated' AND NEW.expires_at IS NULL) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Occupancy identity, original clocks and finite transitions are guarded';END IF;
  END IF;
 ELSIF TG_TABLE_NAME='dining_hold_plans' THEN
  IF TG_OP<>'INSERT' OR NEW.hash!~'^[a-f0-9]{64}$' OR NEW.expires_at<=NEW.created_at OR NEW.expires_at>dg_native_people_iso(NEW.created_at::timestamptz+interval '30 seconds') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Table plans retain the original bounded thirty-second deadline';END IF;
 END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_dining_party_guard BEFORE INSERT OR UPDATE OR DELETE ON dining_parties FOR EACH ROW EXECUTE FUNCTION dg_native_dining_row_guard();
CREATE TRIGGER native_dining_reservation_guard BEFORE INSERT OR UPDATE OR DELETE ON dining_reservations FOR EACH ROW EXECUTE FUNCTION dg_native_dining_row_guard();
CREATE TRIGGER native_dining_occupancy_guard BEFORE INSERT OR UPDATE OR DELETE ON dining_occupancies FOR EACH ROW EXECUTE FUNCTION dg_native_dining_row_guard();
CREATE TRIGGER native_dining_plan_guard BEFORE INSERT ON dining_hold_plans FOR EACH ROW EXECUTE FUNCTION dg_native_dining_row_guard();
CREATE UNIQUE INDEX native_dining_queue_number ON dining_parties(restaurant_id,queue_number) WHERE queue_number IS NOT NULL;

CREATE FUNCTION dg_native_dining_business_final() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j jsonb:=to_jsonb(NEW);party_value text;p dining_parties%ROWTYPE;r restaurants%ROWTYPE;origin _dg_native_dining_party_origins%ROWTYPE;b dining_reservations%ROWTYPE;o dining_occupancies%ROWTYPE;t restaurant_tables%ROWTYPE;plan dining_hold_plans%ROWTYPE;a _dg_native_dining_actions%ROWTYPE;s reception_sessions%ROWTYPE;booking_clock _dg_native_dining_booking_clocks%ROWTYPE;latest record;
BEGIN
 IF TG_TABLE_NAME='_dg_native_dining_actions' THEN
  SELECT * INTO a FROM _dg_native_dining_actions WHERE id=j->>'id';SELECT * INTO r FROM restaurants WHERE id=a.restaurant_id;
  IF a.actor_type='staff' AND NOT dg_native_dining_authority(a.actor_id,a.restaurant_id,a.actor_epoch,a.grant_version) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Dining staff operation must commit with its original current authority';END IF;
  IF a.actor_type='guest' THEN SELECT * INTO s FROM reception_sessions WHERE id=a.session_id;IF s.status<>'active' OR NOT dg_native_reception_source_valid(s.id) OR s.focus_version<>a.focus_version OR NOT EXISTS(SELECT 1 FROM _dg_native_reception_access WHERE id=a.access_id AND session_id=s.id AND access_version=s.access_version) OR coalesce((SELECT max(version) FROM _dg_native_dining_selection_revisions WHERE session_id=s.id),0)<>a.selection_version THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Dining guest operation keeps its actual session, access, person and selection';END IF;END IF;
  IF a.resource_type='plan' THEN SELECT party_id INTO party_value FROM dining_hold_plans WHERE id=a.resource_id;ELSE party_value:=a.resource_id;END IF;
 ELSIF TG_TABLE_NAME='_dg_native_dining_selection_revisions' THEN
  SELECT * INTO s FROM reception_sessions WHERE id=j->>'session_id';SELECT * INTO a FROM _dg_native_dining_actions WHERE id=j->>'action_id';SELECT version,party_id INTO latest FROM _dg_native_dining_selection_revisions WHERE session_id=s.id ORDER BY version DESC LIMIT 1;
  IF s.service_scene<>'restaurant' OR latest.party_id IS DISTINCT FROM s.dining_party_id OR (j->>'version')::bigint<>coalesce((SELECT max(version) FROM _dg_native_dining_selection_revisions WHERE session_id=s.id AND version<(j->>'version')::bigint),0)+1 OR a.transaction_id<>pg_current_xact_id()::text OR a.kind NOT IN('create','reserve','select','claim') OR NOT dg_native_dining_changed('reception_sessions',s.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Dining selection revisions preserve their original monotonic target';END IF;RETURN NULL;
 ELSIF TG_TABLE_NAME='dining_parties' THEN party_value:=j->>'id';
 ELSIF TG_TABLE_NAME='_dg_native_dining_party_origins' THEN party_value:=j->>'party_id';
 ELSIF TG_TABLE_NAME IN('dining_reservations','dining_occupancies','dining_hold_plans') THEN party_value:=j->>'party_id';
 ELSIF TG_TABLE_NAME='_dg_native_dining_plan_origins' THEN SELECT * INTO plan FROM dining_hold_plans WHERE id=j->>'plan_id';party_value:=plan.party_id;
 ELSIF TG_TABLE_NAME='_dg_native_dining_occupancy_origins' THEN SELECT * INTO o FROM dining_occupancies WHERE id=j->>'occupancy_id';party_value:=o.party_id;
 ELSIF TG_TABLE_NAME='_dg_native_dining_booking_clocks' THEN
  SELECT * INTO b FROM dining_reservations WHERE id=j->>'reservation_id';SELECT * INTO a FROM _dg_native_dining_actions WHERE id=j->>'action_id';party_value:=b.party_id;
  IF a.transaction_id<>pg_current_xact_id()::text OR a.kind NOT IN('reserve','reschedule') OR a.resource_id<>party_value OR(j->>'revision')::bigint<>b.version OR j->>'starts_at' IS DISTINCT FROM b.starts_at OR j->>'ends_at' IS DISTINCT FROM b.ends_at THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Booking clock revisions require the actual confirmed time operation';END IF;
 ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Unsupported dining invariant source';END IF;
 SELECT * INTO p FROM dining_parties WHERE id=party_value;SELECT * INTO origin FROM _dg_native_dining_party_origins WHERE party_id=p.id;SELECT * INTO r FROM restaurants WHERE id=p.restaurant_id;
 IF p.id IS NULL OR origin.party_id IS NULL OR origin.restaurant_id<>p.restaurant_id OR origin.runtime_id IS DISTINCT FROM(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1) OR origin.tenant_id<>r.tenant_id OR origin.workspace_id<>r.workspace_id OR origin.created_at<>p.created_at OR p.owner_session_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM _dg_native_dining_session_origins WHERE session_id=p.owner_session_id AND restaurant_id=r.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Dining facts retain native runtime, store and consent ownership';END IF;
 SELECT * INTO b FROM dining_reservations WHERE party_id=p.id;SELECT * INTO o FROM dining_occupancies WHERE party_id=p.id AND state IN('held','seated');
 IF p.status='reserved' AND(b.id IS NULL OR b.status<>'confirmed') OR p.status='held' AND(o.id IS NULL OR o.state<>'held') OR p.status='seated' AND(o.id IS NULL OR o.state<>'seated') OR p.status NOT IN('held','seated') AND o.id IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Dining party state and actual occupancy must agree';END IF;
 IF b.id IS NOT NULL THEN
  booking_clock:=dg_native_dining_booking_clock(b.id);IF booking_clock.reservation_id IS NULL OR booking_clock.starts_at<>b.starts_at OR booking_clock.ends_at<>b.ends_at OR booking_clock.checkin_opens_at<>dg_native_people_iso(b.starts_at::timestamptz-interval '30 minutes') OR booking_clock.late_deadline<b.starts_at OR booking_clock.late_deadline>dg_native_people_iso(b.starts_at::timestamptz+interval '60 minutes') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Reservation clocks retain their original confirmed time revision';END IF;
  SELECT * INTO t FROM restaurant_tables WHERE id=b.table_id;IF b.restaurant_id<>r.id OR t.restaurant_id<>r.id OR b.status IN('confirmed','checked_in') AND NOT dg_native_dining_fits(t,p.size) OR EXISTS(SELECT 1 FROM dining_reservations other WHERE other.restaurant_id=r.id AND other.id<>b.id AND other.table_id=b.table_id AND other.status IN('confirmed','checked_in') AND b.status IN('confirmed','checked_in') AND other.starts_at<b.ends_at AND other.ends_at>b.starts_at) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Dining reservations cannot overlap or lose their scoped table capacity';END IF;
 END IF;
 IF o.id IS NOT NULL THEN
  SELECT * INTO t FROM restaurant_tables WHERE id=o.table_id;IF o.restaurant_id<>r.id OR t.restaurant_id<>r.id OR NOT dg_native_dining_fits(t,p.size) OR t.operation<>'open' OR NOT EXISTS(SELECT 1 FROM _dg_native_dining_occupancy_origins WHERE occupancy_id=o.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Active dining occupancy requires its actual scoped, enabled table and immutable plan';END IF;
 END IF;
 IF TG_TABLE_NAME IN('dining_hold_plans','_dg_native_dining_plan_origins') THEN
  SELECT * INTO plan FROM dining_hold_plans WHERE id=CASE WHEN TG_TABLE_NAME='dining_hold_plans' THEN j->>'id' ELSE j->>'plan_id' END;SELECT action.* INTO a FROM _dg_native_dining_plan_origins binding JOIN _dg_native_dining_actions action ON action.id=binding.action_id WHERE binding.plan_id=plan.id;
  IF plan.id IS NULL OR a.id IS NULL OR a.kind<>'plan' OR a.resource_id<>plan.id OR a.restaurant_id<>plan.restaurant_id OR a.actor_id<>plan.actor_id OR a.focus_version IS DISTINCT FROM plan.focus_version OR NOT EXISTS(SELECT 1 FROM restaurant_tables WHERE id=plan.table_id AND restaurant_id=plan.restaurant_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Dining plans keep the actual immutable action and table source';END IF;
 END IF;RETURN NULL;
END;$dg$;
CREATE CONSTRAINT TRIGGER native_dining_action_final AFTER INSERT ON _dg_native_dining_actions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_dining_business_final();
CREATE CONSTRAINT TRIGGER native_dining_selection_final AFTER INSERT ON _dg_native_dining_selection_revisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_dining_business_final();
CREATE CONSTRAINT TRIGGER native_dining_party_final AFTER INSERT OR UPDATE ON dining_parties DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_dining_business_final();
CREATE CONSTRAINT TRIGGER native_dining_party_origin_final AFTER INSERT ON _dg_native_dining_party_origins DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_dining_business_final();
CREATE CONSTRAINT TRIGGER native_dining_reservation_final AFTER INSERT OR UPDATE ON dining_reservations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_dining_business_final();
CREATE CONSTRAINT TRIGGER native_dining_occupancy_final AFTER INSERT OR UPDATE ON dining_occupancies DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_dining_business_final();
CREATE CONSTRAINT TRIGGER native_dining_plan_final AFTER INSERT ON dining_hold_plans DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_dining_business_final();
CREATE CONSTRAINT TRIGGER native_dining_plan_origin_final AFTER INSERT ON _dg_native_dining_plan_origins DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_dining_business_final();
CREATE CONSTRAINT TRIGGER native_dining_occupancy_origin_final AFTER INSERT ON _dg_native_dining_occupancy_origins DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_dining_business_final();
CREATE CONSTRAINT TRIGGER native_dining_booking_clock_final AFTER INSERT ON _dg_native_dining_booking_clocks DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_dining_business_final();
