-- Menu item has a catalog version; its schema has no updated_at column.
CREATE OR REPLACE FUNCTION dg_native_order_stock_move(action_value text,change_value text,sku_value text,delta_value bigint,kind_value text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE sku restaurant_menu_skus%ROWTYPE;movement_value text:=gen_random_uuid()::text;created text;
BEGIN
 SELECT * INTO sku FROM restaurant_menu_skus WHERE id=sku_value FOR UPDATE;SELECT created_at INTO created FROM _dg_native_dining_actions WHERE id=action_value;
 IF sku.id IS NULL OR sku.stock_remaining+delta_value NOT BETWEEN 0 AND 1000000 OR(kind_value='reserve' AND delta_value>=0) OR(kind_value='release' AND delta_value<=0) OR kind_value NOT IN('reserve','release') THEN PERFORM dg_native_order_error('ORDER_STOCK_CHANGED');END IF;
 PERFORM dg_native_dining_effect(action_value,'restaurant_stock_movements',movement_value);INSERT INTO restaurant_stock_movements VALUES(movement_value,sku.restaurant_id,sku.id,change_value,kind_value,sku.stock_remaining,sku.stock_remaining+delta_value,created);
 PERFORM dg_native_dining_effect(action_value,'restaurant_menu_skus',sku.id);UPDATE restaurant_menu_skus SET stock_remaining=stock_remaining+delta_value,version=version+1 WHERE id=sku.id;
 PERFORM dg_native_dining_effect(action_value,'restaurant_menu_items',sku.item_id);UPDATE restaurant_menu_items SET version=version+1 WHERE id=sku.item_id;
END;$dg$;

