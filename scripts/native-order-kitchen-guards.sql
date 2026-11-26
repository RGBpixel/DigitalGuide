CREATE FUNCTION dg_native_order_kitchen_record(table_value text,operation_value text,j jsonb,previous jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE order_value text;record_value text;restaurant_value text;party_value text;action _dg_native_dining_actions%ROWTYPE;column_value text;quantity_value bigint;mode_value text;
BEGIN
 record_value:=j->>'id';IF table_value='restaurant_orders' THEN order_value:=record_value;ELSIF table_value IN('restaurant_kitchen_tickets','restaurant_order_events') THEN order_value:=j->>'order_id';ELSE RETURN false;END IF;SELECT restaurant_id,party_id INTO restaurant_value,party_value FROM restaurant_orders WHERE id=order_value;
 SELECT actual.* INTO action FROM _dg_native_dining_changes effect JOIN _dg_native_dining_actions actual ON actual.id=effect.action_id WHERE effect.table_name=table_value AND effect.resource_id=record_value AND effect.transaction_id=pg_current_xact_id()::text AND actual.transaction_id=effect.transaction_id AND actual.restaurant_id=restaurant_value AND actual.resource_id=party_value AND actual.kind IN('kitchen_start','kitchen_ready','kitchen_serve','order_control') ORDER BY actual.created_at DESC,actual.id DESC LIMIT 1;IF action.id IS NULL THEN RETURN false;END IF;
 IF operation_value='DELETE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Kitchen and human-control business history cannot be deleted';END IF;
 IF table_value='restaurant_kitchen_tickets' THEN
  column_value:=CASE action.kind WHEN 'kitchen_start' THEN 'started_quantity' WHEN 'kitchen_ready' THEN 'ready_quantity' WHEN 'kitchen_serve' THEN 'served_quantity' END;mode_value:=CASE WHEN action.kind='kitchen_serve' THEN 'serve' ELSE 'cook' END;
  IF column_value IS NULL OR operation_value<>'UPDATE' OR j-ARRAY[column_value,'version','updated_at'] IS DISTINCT FROM previous-ARRAY[column_value,'version','updated_at'] OR(j->>'version')::bigint<>(previous->>'version')::bigint+1 OR NOT dg_native_order_kitchen_authority(action.actor_id,restaurant_value,action.actor_epoch,action.grant_version,mode_value) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Kitchen transitions retain exact original scope, authority and other counters';END IF;quantity_value:=(j->>column_value)::bigint-(previous->>column_value)::bigint;
  IF quantity_value NOT BETWEEN 1 AND 99 OR action.body_hash<>dg_native_office_hash(jsonb_build_object('version',(previous->>'version')::bigint,'action',substring(action.kind FROM 9),'quantity',quantity_value,'confirmed',true)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='A monotone kitchen delta is the exact explicitly confirmed operation';END IF;
 ELSIF table_value='restaurant_orders' THEN
  IF operation_value<>'UPDATE' OR(j->>'version')::bigint<>(previous->>'version')::bigint+1 OR j->>'status' NOT IN('draft','awaiting_confirmation','confirmed','queued','submitting','submitted','needs_attention','accepted','preparing','ready','served','cancelled','closed') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Kitchen and human operations advance one current order version';END IF;
  IF action.kind='order_control' THEN
   IF j-ARRAY['status','version','control_mode','attention_reason','updated_at'] IS DISTINCT FROM previous-ARRAY['status','version','control_mode','attention_reason','updated_at'] OR j->>'control_mode' NOT IN('automatic','human') OR j->>'control_mode'=previous->>'control_mode' OR j->>'attention_reason' IS DISTINCT FROM(CASE WHEN j->>'control_mode'='human' THEN '已请求店员核对；已发送请求仍须按原请求确认结果。' END) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Human control cannot change prices, content, payment, request identity or remote facts';END IF;
  ELSIF j-ARRAY['status','version','updated_at'] IS DISTINCT FROM previous-ARRAY['status','version','updated_at'] THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Kitchen progress cannot rewrite order contents, control or settlement';END IF;
 ELSE
  IF operation_value<>'INSERT' OR j->>'actor_id'<>action.actor_id OR j->>'kind'<>action.kind OR j->>'created_at'<>action.created_at THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Kitchen events retain their actual actor and operation';END IF;
 END IF;RETURN true;
END;$dg$;

CREATE FUNCTION dg_native_order_kitchen_history() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE action_value text;created text;
BEGIN
 SELECT action.id,action.created_at INTO action_value,created FROM _dg_native_dining_changes effect JOIN _dg_native_dining_actions action ON action.id=effect.action_id WHERE effect.table_name='restaurant_kitchen_tickets' AND effect.resource_id=NEW.id AND effect.transaction_id=pg_current_xact_id()::text AND action.transaction_id=effect.transaction_id ORDER BY action.created_at DESC,action.id DESC LIMIT 1;IF action_value IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Every kitchen revision has its actual durable operation';END IF;INSERT INTO _dg_native_order_kitchen_revisions VALUES(NEW.id,NEW.version,action_value,dg_native_office_hash(to_jsonb(NEW)),created);RETURN NULL;
END;$dg$;
CREATE TRIGGER native_order_kitchen_history AFTER INSERT OR UPDATE ON restaurant_kitchen_tickets FOR EACH ROW EXECUTE FUNCTION dg_native_order_kitchen_history();

CREATE FUNCTION dg_native_order_kitchen_final() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j jsonb:=to_jsonb(NEW);ticket restaurant_kitchen_tickets%ROWTYPE;o restaurant_orders%ROWTYPE;receipt _dg_native_order_kitchen_results%ROWTYPE;action _dg_native_dining_actions%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='restaurant_orders' THEN SELECT * INTO o FROM restaurant_orders WHERE id=j->>'id';IF o.status IS DISTINCT FROM dg_native_order_status(o.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Order status must match the actual pending change, human control and accepted kitchen counts';END IF;RETURN NULL;
 ELSIF TG_TABLE_NAME='_dg_native_order_kitchen_results' THEN
  SELECT * INTO receipt FROM _dg_native_order_kitchen_results WHERE action_id=j->>'action_id';SELECT * INTO action FROM _dg_native_dining_actions WHERE id=receipt.action_id;SELECT * INTO ticket FROM restaurant_kitchen_tickets WHERE id=receipt.ticket_id;
  IF action.kind NOT IN('kitchen_start','kitchen_ready','kitchen_serve') OR action.created_at<>receipt.created_at OR receipt.mode IS DISTINCT FROM(CASE WHEN action.kind='kitchen_serve' THEN 'serve' ELSE 'cook' END) OR NOT dg_native_order_kitchen_authority(action.actor_id,ticket.restaurant_id,action.actor_epoch,action.grant_version,receipt.mode) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Kitchen operation receipts commit with their original live duty';END IF;RETURN NULL;
 END IF;
 SELECT * INTO ticket FROM restaurant_kitchen_tickets WHERE id=j->>'id';IF NOT EXISTS(SELECT 1 FROM _dg_native_order_kitchen_revisions revision JOIN _dg_native_dining_actions action ON action.id=revision.action_id WHERE revision.ticket_id=ticket.id AND revision.version=ticket.version AND revision.row_hash=dg_native_office_hash(to_jsonb(ticket)) AND revision.created_at=ticket.updated_at AND action.kind IN('order_receipt','order_submit','order_withdraw','order_expire','kitchen_start','kitchen_ready','kitchen_serve')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Kitchen current row equals its latest immutable exact revision';END IF;RETURN NULL;
END;$dg$;
CREATE CONSTRAINT TRIGGER native_order_kitchen_final AFTER INSERT OR UPDATE ON restaurant_kitchen_tickets DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_order_kitchen_final();
CREATE CONSTRAINT TRIGGER native_order_kitchen_final AFTER INSERT ON _dg_native_order_kitchen_results DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_order_kitchen_final();
CREATE CONSTRAINT TRIGGER native_order_kitchen_order_final AFTER INSERT OR UPDATE ON restaurant_orders DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_order_kitchen_final();
