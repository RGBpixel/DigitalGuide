CREATE FUNCTION dg_native_order_record_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j jsonb:=to_jsonb(NEW);previous jsonb:=to_jsonb(OLD);record_value text;restaurant_value text;party_value text;order_value text;action _dg_native_dining_actions%ROWTYPE;
BEGIN
 record_value:=CASE TG_TABLE_NAME WHEN 'restaurant_pos_configs' THEN j->>'restaurant_id' WHEN 'restaurant_order_dispatches' THEN j->>'change_id' ELSE j->>'id' END;
 IF TG_OP='DELETE' OR NOT dg_native_dining_changed(TG_TABLE_NAME,record_value) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native order records require their actual scoped operation';END IF;
 IF TG_TABLE_NAME='restaurant_pos_configs' THEN restaurant_value:=j->>'restaurant_id';
 ELSIF TG_TABLE_NAME='restaurant_orders' THEN restaurant_value:=j->>'restaurant_id';party_value:=j->>'party_id';
 ELSE
  order_value:=CASE WHEN TG_TABLE_NAME='restaurant_order_changes' OR TG_TABLE_NAME='restaurant_order_events' OR TG_TABLE_NAME='restaurant_kitchen_tickets' THEN j->>'order_id' ELSE(SELECT c.order_id FROM restaurant_order_changes c WHERE c.id=j->>'change_id') END;
  SELECT restaurant_id,party_id INTO restaurant_value,party_value FROM restaurant_orders WHERE id=order_value;
 END IF;
 SELECT a.* INTO action FROM _dg_native_dining_changes effect JOIN _dg_native_dining_actions a ON a.id=effect.action_id WHERE effect.table_name=TG_TABLE_NAME AND effect.resource_id=record_value AND effect.transaction_id=pg_current_xact_id()::text AND a.transaction_id=effect.transaction_id AND a.restaurant_id=restaurant_value AND a.resource_id=coalesce(party_value,restaurant_value) AND a.kind IN('order_config','order_draft','order_update','order_review','order_confirm','order_submit','order_withdraw','order_expire','order_quote_expire') ORDER BY a.created_at DESC,a.id DESC LIMIT 1;
 IF action.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Order effects cannot borrow unrelated business actions';END IF;
 IF TG_TABLE_NAME='restaurant_orders' THEN
  IF j->>'control_mode'<>'automatic' OR j->>'settlement_status'<>'unsettled' OR j->>'remote_order_id' IS NOT NULL OR j->>'attention_reason' IS NOT NULL OR(j->>'content_version')::bigint<>1 OR j->>'status' NOT IN('draft','awaiting_confirmation','confirmed','queued','cancelled','accepted') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='This order stage cannot fabricate acceptance, payment or remote facts';END IF;
  IF TG_OP='INSERT' THEN IF action.kind<>'order_draft' OR j->>'status'<>'draft' OR(j->>'version')::bigint<>1 OR j->>'pending_change_id' IS NOT NULL OR j->>'created_at'<>action.created_at THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native order creation is an unsubmitted original draft';END IF;
  ELSIF j-ARRAY['version','status','pending_change_id','updated_at'] IS DISTINCT FROM previous-ARRAY['version','status','pending_change_id','updated_at'] OR(j->>'version')::bigint<>(previous->>'version')::bigint+1 OR previous->>'status' IN('closed','cancelled') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Order identity, accepted content and terminal states cannot be rewritten';END IF;
 ELSIF TG_TABLE_NAME='restaurant_order_changes' THEN
  IF j->>'source'<>'manual' OR j->>'source_request_id' IS NOT NULL OR j->>'kind' NOT IN('initial','amend','cancel') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Drafts cannot claim a fabricated conversation or source';END IF;
  IF TG_OP='INSERT' THEN IF action.kind<>'order_draft' OR j->>'status'<>'draft' OR(j->>'version')::bigint<>1 OR j->>'created_at'<>action.created_at OR j->>'confirmed_at' IS NOT NULL OR j->>'current_quote_id' IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Order changes start as the next editable draft';END IF;
  ELSE
   IF j-ARRAY['version','status','input','base_content_version','actor_id','session_id','focus_version','party_access_version','current_quote_id','confirmed_at','confirmed_actor_id','confirmed_focus_version','confirmed_quote_id','updated_at'] IS DISTINCT FROM previous-ARRAY['version','status','input','base_content_version','actor_id','session_id','focus_version','party_access_version','current_quote_id','confirmed_at','confirmed_actor_id','confirmed_focus_version','confirmed_quote_id','updated_at'] OR(j->>'version')::bigint<>(previous->>'version')::bigint+1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Change scope, sequence, source and version are immutable';END IF;
   IF NOT(action.kind='order_update' AND previous->>'status' IN('draft','awaiting_confirmation','confirmed') AND j->>'status'='draft' OR action.kind='order_review' AND previous->>'status' IN('draft','awaiting_confirmation','confirmed') AND j->>'status'='awaiting_confirmation' OR action.kind='order_confirm' AND previous->>'status'='awaiting_confirmation' AND j->>'status'='confirmed' OR action.kind='order_submit' AND previous->>'status'='confirmed' AND j->>'status'='queued' OR action.kind='order_withdraw' AND previous->>'status' IN('draft','awaiting_confirmation','confirmed','queued','rejected','stale') AND j->>'status'='withdrawn' OR action.kind='order_expire' AND previous->>'status'='queued' AND j->>'status'='stale') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Unsupported order change transition';END IF;
   IF action.kind<>'order_update' AND j-ARRAY['version','status','current_quote_id','confirmed_at','confirmed_actor_id','confirmed_focus_version','confirmed_quote_id','updated_at'] IS DISTINCT FROM previous-ARRAY['version','status','current_quote_id','confirmed_at','confirmed_actor_id','confirmed_focus_version','confirmed_quote_id','updated_at'] THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Review, confirmation and dispatch cannot rewrite draft input or attribution';END IF;
  END IF;
 ELSIF TG_TABLE_NAME='restaurant_order_quotes' THEN
  IF TG_OP='INSERT' THEN IF action.kind<>'order_review' OR j->>'status'<>'current' OR j->>'created_at'<>action.created_at OR(j->>'expires_at')::timestamptz<>(j->>'created_at')::timestamptz+interval '120 seconds' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Quotes keep a fixed original two-minute deadline';END IF;
  ELSIF j-'status' IS DISTINCT FROM previous-'status' OR previous->>'status'<>'current' OR j->>'status' NOT IN('superseded','withdrawn','expired') OR j->>'status'='expired' AND j->>'expires_at'>dg_native_dining_now() THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Quote content, attribution and original deadline cannot be replaced';END IF;
 ELSIF TG_TABLE_NAME='restaurant_pos_configs' THEN
  IF action.kind<>'order_config' OR j->>'provider_id' NOT IN('mock-pos','external-pos') OR(j->>'enabled')::bigint NOT IN(0,1) OR j->>'provider_id'='external-pos' AND j->>'enabled'<>'0' OR j->>'scenario' NOT IN('normal','rejected','response_lost','unresolved') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native POS configuration cannot silently simulate a live provider';END IF;
  IF TG_OP='INSERT' THEN IF(j->>'version')::bigint<>1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='POS config starts at version one';END IF;
  ELSIF j-ARRAY['provider_id','enabled','scenario','version','updated_at'] IS DISTINCT FROM previous-ARRAY['provider_id','enabled','scenario','version','updated_at'] OR(j->>'version')::bigint<>(previous->>'version')::bigint+1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='POS config versions and original creation are guarded';END IF;
 ELSIF TG_TABLE_NAME='restaurant_order_dispatches' THEN
  IF TG_OP='INSERT' THEN IF action.kind<>'order_submit' OR j->>'status'<>'queued' OR j->>'attempts'<>'0' OR j->>'version'<>'1' OR j->>'simulated'<>'1' OR j->>'provider_id'<>'mock-pos' OR j->>'lease_token' IS NOT NULL OR j->>'lease_until' IS NOT NULL OR j->>'remote_request_id' IS NOT NULL OR j->>'remote_order_id' IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='A persistent dispatch is queued and has not claimed external success';END IF;
  ELSIF action.kind NOT IN('order_withdraw','order_expire') OR previous->>'status'<>'queued' OR previous->>'attempts'<>'0' OR j->>'status'<>'cancelled' OR(j->>'version')::bigint<>(previous->>'version')::bigint+1 OR j-ARRAY['status','version','error_code','error_message','updated_at'] IS DISTINCT FROM previous-ARRAY['status','version','error_code','error_message','updated_at'] THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Only definitely unsent dispatches can be withdrawn in this stage';END IF;
 ELSIF TG_TABLE_NAME='restaurant_inventory_reservations' THEN
  IF(j->>'quantity')::bigint<=0 OR j->>'tracked' NOT IN('0','1') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Inventory reservation quantities are positive and explicitly tracked';END IF;
  IF TG_OP='INSERT' THEN IF action.kind<>'order_submit' OR j->>'status'<>'reserved' OR j->>'created_at'<>action.created_at THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Reservations originate in the atomic submit';END IF;
  ELSIF action.kind NOT IN('order_withdraw','order_expire') OR previous->>'status'<>'reserved' OR j->>'status'<>'released' OR j-ARRAY['status','updated_at'] IS DISTINCT FROM previous-ARRAY['status','updated_at'] THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Only original reservations can be released once';END IF;
 ELSIF TG_TABLE_NAME='restaurant_stock_movements' THEN
  IF TG_OP<>'INSERT' OR j->>'kind' NOT IN('reserve','release') OR(j->>'before_quantity')::bigint<0 OR(j->>'after_quantity')::bigint<0 OR NOT(action.kind='order_submit' AND j->>'kind'='reserve' AND(j->>'before_quantity')::bigint>(j->>'after_quantity')::bigint OR action.kind IN('order_withdraw','order_expire') AND j->>'kind'='release' AND(j->>'before_quantity')::bigint<(j->>'after_quantity')::bigint) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Stock movements are append-only actual reservation or release deltas';END IF;
 ELSIF TG_TABLE_NAME='restaurant_order_events' THEN
  IF TG_OP<>'INSERT' OR j->>'actor_id'<>action.actor_id OR j->>'kind'<>action.kind OR j->>'created_at'<>action.created_at THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Order events retain their actual operation and actor';END IF;
 ELSE
  IF TG_TABLE_NAME<>'restaurant_kitchen_tickets' OR TG_OP<>'UPDATE' OR action.kind NOT IN('order_submit','order_withdraw','order_expire') OR j-ARRAY['pending_cancel_quantity','version','updated_at'] IS DISTINCT FROM previous-ARRAY['pending_cancel_quantity','version','updated_at'] OR(j->>'version')::bigint<>(previous->>'version')::bigint+1 OR(j->>'pending_cancel_quantity')::bigint<0 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='This stage cannot fabricate kitchen progress';END IF;
 END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_order_record_guard BEFORE INSERT OR UPDATE OR DELETE ON restaurant_orders FOR EACH ROW EXECUTE FUNCTION dg_native_order_record_guard();
CREATE TRIGGER native_order_change_guard BEFORE INSERT OR UPDATE OR DELETE ON restaurant_order_changes FOR EACH ROW EXECUTE FUNCTION dg_native_order_record_guard();
CREATE TRIGGER native_order_quote_guard BEFORE INSERT OR UPDATE OR DELETE ON restaurant_order_quotes FOR EACH ROW EXECUTE FUNCTION dg_native_order_record_guard();
CREATE TRIGGER native_order_pos_guard BEFORE INSERT OR UPDATE OR DELETE ON restaurant_pos_configs FOR EACH ROW EXECUTE FUNCTION dg_native_order_record_guard();
CREATE TRIGGER native_order_dispatch_guard BEFORE INSERT OR UPDATE OR DELETE ON restaurant_order_dispatches FOR EACH ROW EXECUTE FUNCTION dg_native_order_record_guard();
CREATE TRIGGER native_order_inventory_guard BEFORE INSERT OR UPDATE OR DELETE ON restaurant_inventory_reservations FOR EACH ROW EXECUTE FUNCTION dg_native_order_record_guard();
CREATE TRIGGER native_order_movement_guard BEFORE INSERT OR UPDATE OR DELETE ON restaurant_stock_movements FOR EACH ROW EXECUTE FUNCTION dg_native_order_record_guard();
CREATE TRIGGER native_order_event_guard BEFORE INSERT OR UPDATE OR DELETE ON restaurant_order_events FOR EACH ROW EXECUTE FUNCTION dg_native_order_record_guard();
CREATE TRIGGER native_order_pending_cancel_guard BEFORE INSERT OR UPDATE OR DELETE ON restaurant_kitchen_tickets FOR EACH ROW EXECUTE FUNCTION dg_native_order_record_guard();

CREATE FUNCTION dg_native_order_change_history() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE operation_value text;created text;
BEGIN
 SELECT a.id,a.created_at INTO operation_value,created FROM _dg_native_dining_changes effect JOIN _dg_native_dining_actions a ON a.id=effect.action_id WHERE effect.table_name='restaurant_order_changes' AND effect.resource_id=NEW.id AND effect.transaction_id=pg_current_xact_id()::text AND a.transaction_id=effect.transaction_id ORDER BY a.created_at DESC,a.id DESC LIMIT 1;
 IF operation_value IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Every change revision has its actual operation';END IF;
 INSERT INTO _dg_native_order_change_revisions VALUES(NEW.id,NEW.version,operation_value,dg_native_office_hash(to_jsonb(NEW)),created);RETURN NULL;
END;$dg$;
CREATE TRIGGER native_order_change_history AFTER INSERT OR UPDATE ON restaurant_order_changes FOR EACH ROW EXECUTE FUNCTION dg_native_order_change_history();

CREATE FUNCTION dg_native_order_catalog_guard(table_value text,j jsonb,previous jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE kinds text[];
BEGIN
 SELECT array_agg(a.kind) INTO kinds FROM _dg_native_dining_changes effect JOIN _dg_native_dining_actions a ON a.id=effect.action_id WHERE effect.table_name=table_value AND effect.resource_id=j->>'id' AND effect.transaction_id=pg_current_xact_id()::text AND a.transaction_id=effect.transaction_id AND a.kind IN('order_draft','order_submit','order_withdraw','order_expire');IF kinds IS NULL THEN RETURN false;END IF;
 IF table_value='restaurants' AND 'order_draft'=ANY(kinds) AND j-'order_counter'=previous-'order_counter' AND(j->>'order_counter')::numeric=(previous->>'order_counter')::numeric+1 AND(j->>'order_counter')::numeric<=9007199254740991 THEN RETURN true;END IF;
 IF NOT kinds&&ARRAY['order_submit','order_withdraw','order_expire'] THEN RETURN false;END IF;
 IF table_value='restaurants' AND j-ARRAY['menu_version','updated_at']=previous-ARRAY['menu_version','updated_at'] AND(j->>'menu_version')::bigint=(previous->>'menu_version')::bigint+1 THEN RETURN true;END IF;
 IF table_value='restaurant_menu_skus' AND j-ARRAY['stock_remaining','version']=previous-ARRAY['stock_remaining','version'] AND(j->>'version')::bigint=(previous->>'version')::bigint+1 AND(j->>'stock_remaining')::bigint BETWEEN 0 AND 1000000 THEN RETURN true;END IF;
 IF table_value='restaurant_menu_items' AND j-ARRAY['version','updated_at']=previous-ARRAY['version','updated_at'] AND(j->>'version')::bigint=(previous->>'version')::bigint+1 THEN RETURN true;END IF;RETURN false;
END;$dg$;
