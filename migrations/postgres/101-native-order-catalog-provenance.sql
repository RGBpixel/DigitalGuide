-- Recognize actual atomic order inventory effects without bypassing store scope.
CREATE OR REPLACE FUNCTION dg_native_restaurant_final() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE j jsonb:=to_jsonb(NEW);restaurant_value text;r restaurants%ROWTYPE;o _dg_native_restaurant_origins%ROWTYPE;
BEGIN
 restaurant_value:=CASE WHEN TG_TABLE_NAME='restaurants' THEN j->>'id' ELSE j->>'restaurant_id' END;SELECT * INTO r FROM restaurants WHERE id=restaurant_value;SELECT * INTO o FROM _dg_native_restaurant_origins WHERE restaurant_id=restaurant_value;
 IF r.id IS NULL OR o.restaurant_id IS NULL OR o.runtime_id<>(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1) OR o.tenant_id<>r.tenant_id OR o.workspace_id<>r.workspace_id OR NOT EXISTS(SELECT 1 FROM venues WHERE id=r.venue_id AND tenant_id=r.tenant_id AND workspace_id=r.workspace_id AND timezone=r.timezone) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native restaurant origin and venue scope must remain bound';END IF;
 IF TG_TABLE_NAME='restaurant_staff' AND j->>'enabled'='0' AND EXISTS(SELECT 1 FROM _dg_native_restaurant_member_epochs WHERE user_id=j->>'user_id' AND transaction_id=pg_current_xact_id()::text) THEN RETURN NEW;END IF;
 IF TG_TABLE_NAME IN('restaurants','restaurant_tables') AND dg_native_dining_changed(TG_TABLE_NAME,j->>'id') THEN RETURN NEW;END IF;
 IF TG_OP='UPDATE' AND dg_native_order_catalog_guard(TG_TABLE_NAME,j,to_jsonb(OLD)) THEN RETURN NEW;END IF;
 IF NOT EXISTS(SELECT 1 FROM _dg_native_restaurant_operations WHERE restaurant_id=r.id AND transaction_id=pg_current_xact_id()::text) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Restaurant changes require a durable authorized operation';END IF;
 RETURN NEW;
END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_order_stock_final() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE sku_value text;sku restaurant_menu_skus%ROWTYPE;held bigint;
BEGIN
 sku_value:=CASE WHEN TG_TABLE_NAME='restaurant_menu_skus' THEN to_jsonb(NEW)->>'id' ELSE to_jsonb(NEW)->>'sku_id' END;SELECT * INTO sku FROM restaurant_menu_skus WHERE id=sku_value;
 SELECT coalesce(sum(quantity),0) INTO held FROM restaurant_inventory_reservations reservation JOIN _dg_native_order_reservation_origins fixed ON fixed.reservation_id=reservation.id WHERE reservation.sku_id=sku.id AND reservation.status='reserved' AND reservation.tracked=1;
 IF held>0 AND sku.stock_tracked<>1 OR sku.stock_remaining+held>1000000 THEN PERFORM dg_native_restaurant_error('INVENTORY_BUSY');END IF;RETURN NULL;
END;$dg$;

