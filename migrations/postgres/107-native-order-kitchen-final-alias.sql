-- Keep the operation row variable separate from the revision relation alias.
CREATE OR REPLACE FUNCTION dg_native_order_kitchen_final() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j jsonb:=to_jsonb(NEW);ticket restaurant_kitchen_tickets%ROWTYPE;o restaurant_orders%ROWTYPE;receipt _dg_native_order_kitchen_results%ROWTYPE;action _dg_native_dining_actions%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='restaurant_orders' THEN SELECT * INTO o FROM restaurant_orders WHERE id=j->>'id';IF o.status IS DISTINCT FROM dg_native_order_status(o.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Order status must match the actual pending change, human control and accepted kitchen counts';END IF;RETURN NULL;
 ELSIF TG_TABLE_NAME='_dg_native_order_kitchen_results' THEN
  SELECT * INTO receipt FROM _dg_native_order_kitchen_results WHERE action_id=j->>'action_id';SELECT * INTO action FROM _dg_native_dining_actions WHERE id=receipt.action_id;SELECT * INTO ticket FROM restaurant_kitchen_tickets WHERE id=receipt.ticket_id;
  IF action.kind NOT IN('kitchen_start','kitchen_ready','kitchen_serve') OR action.created_at<>receipt.created_at OR receipt.mode IS DISTINCT FROM(CASE WHEN action.kind='kitchen_serve' THEN 'serve' ELSE 'cook' END) OR NOT dg_native_order_kitchen_authority(action.actor_id,ticket.restaurant_id,action.actor_epoch,action.grant_version,receipt.mode) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Kitchen operation receipts commit with their original live duty';END IF;RETURN NULL;
 END IF;
 SELECT * INTO ticket FROM restaurant_kitchen_tickets WHERE id=j->>'id';IF NOT EXISTS(SELECT 1 FROM _dg_native_order_kitchen_revisions revision JOIN _dg_native_dining_actions revision_action ON revision_action.id=revision.action_id WHERE revision.ticket_id=ticket.id AND revision.version=ticket.version AND revision.row_hash=dg_native_office_hash(to_jsonb(ticket)) AND revision.created_at=ticket.updated_at AND revision_action.kind IN('order_receipt','order_submit','order_withdraw','order_expire','kitchen_start','kitchen_ready','kitchen_serve')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Kitchen current row equals its latest immutable exact revision';END IF;RETURN NULL;
END;$dg$;

