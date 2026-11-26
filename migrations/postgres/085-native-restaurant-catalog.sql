-- R-046/R-047/T20: native restaurant configuration, separate duties and catalog.
-- Seating, ordering, payment and guest terminals remain explicit later stages.
CREATE TABLE _dg_native_restaurant_origins(
 restaurant_id text PRIMARY KEY REFERENCES restaurants(id),runtime_id text NOT NULL,
 actor_id text NOT NULL,tenant_id text NOT NULL,workspace_id text NOT NULL,
 created_at text NOT NULL,transaction_id text NOT NULL
);
CREATE TABLE _dg_native_restaurant_member_epochs(user_id text PRIMARY KEY,epoch bigint NOT NULL CHECK(epoch>0),transaction_id text NOT NULL);
CREATE TABLE _dg_native_restaurant_staff_revisions(
 restaurant_id text NOT NULL,user_id text NOT NULL,version bigint NOT NULL,
 role text NOT NULL,enabled bigint NOT NULL,expires_at text,created_at text NOT NULL,
 PRIMARY KEY(restaurant_id,user_id,version)
);
CREATE TABLE _dg_native_restaurant_operations(
 id text PRIMARY KEY,restaurant_id text NOT NULL REFERENCES restaurants(id),actor_id text NOT NULL,
 actor_epoch bigint NOT NULL,grant_version bigint NOT NULL,manager_required boolean NOT NULL,
 resource_type text NOT NULL CHECK(resource_type IN('restaurant','table','item','staff')),
 resource_id text NOT NULL,action text NOT NULL,input_hash text NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),
 created_at text NOT NULL,transaction_id text NOT NULL
);
CREATE TRIGGER native_restaurant_origin_immutable BEFORE UPDATE OR DELETE ON _dg_native_restaurant_origins FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_restaurant_operation_immutable BEFORE UPDATE OR DELETE ON _dg_native_restaurant_operations FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_restaurant_staff_revision_immutable BEFORE UPDATE OR DELETE ON _dg_native_restaurant_staff_revisions FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();

CREATE FUNCTION dg_native_restaurant_error(code_value text) RETURNS void LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='DGRESTAURANT:'||code_value;END;$dg$;
CREATE FUNCTION dg_native_restaurant_fields(input jsonb,allowed text[]) RETURNS void LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN IF input IS NULL OR jsonb_typeof(input)<>'object' OR input-allowed<>'{}'::jsonb THEN PERFORM dg_native_restaurant_error('VALIDATION_FAILED');END IF;END;$dg$;
CREATE FUNCTION dg_native_restaurant_integer(value jsonb,lo bigint,hi bigint) RETURNS bigint LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE n numeric;
BEGIN
 IF value IS NULL OR jsonb_typeof(value)<>'number' OR char_length(value::text)>20 OR value::text!~'^-?[0-9]+$' THEN PERFORM dg_native_restaurant_error('VALIDATION_FAILED');END IF;
 n:=(value#>>'{}')::numeric;IF n<>trunc(n) OR n<lo OR n>hi THEN PERFORM dg_native_restaurant_error('VALIDATION_FAILED');END IF;RETURN n::bigint;
END;$dg$;

CREATE FUNCTION dg_native_restaurant_apply(target text,action_value text,input jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE m memberships%ROWTYPE;r restaurants%ROWTYPE;v venues%ROWTYPE;t restaurant_tables%ROWTYPE;i restaurant_menu_items%ROWTYPE;s restaurant_menu_skus%ROWTYPE;g restaurant_staff%ROWTYPE;kind_value text;meta jsonb;body jsonb;sku jsonb;resource_value text;resource_type_value text;manager_value boolean:=action_value<>'table_state';grant_value bigint;epoch_value bigint;version_value bigint;created text:=dg_utc_now();operation_value text:=gen_random_uuid()::text;expires_value text;reserved_value bigint;
BEGIN
 m:=dg_native_restaurant_actor();
 IF action_value NOT IN('create','update','grant','table_create','table_update','table_state','item_create','item_update','stock') THEN PERFORM dg_native_restaurant_error('VALIDATION_FAILED');END IF;
 kind_value:=CASE WHEN action_value='create' THEN 'venue' WHEN action_value IN('table_update','table_state') THEN 'table' WHEN action_value='item_update' THEN 'item' WHEN action_value='stock' THEN 'sku' ELSE 'restaurant' END;
 meta:=dg_native_restaurant_prepare(kind_value,CASE WHEN action_value='create' THEN input->>'venueId' ELSE target END,manager_value,true,CASE WHEN action_value='grant' THEN input->>'userId' END);
 IF action_value='create' THEN
  IF input->>'venueId' IS DISTINCT FROM target THEN PERFORM dg_native_restaurant_error('VALIDATION_FAILED');END IF;
  body:=input-'venueId';PERFORM dg_native_restaurant_validate_config(body,m.tenant_id,meta->>'workspaceId');SELECT * INTO v FROM venues WHERE id=target;IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=v.timezone) THEN PERFORM dg_native_restaurant_error('VALIDATION_FAILED');END IF;
  IF EXISTS(SELECT 1 FROM restaurants WHERE venue_id=target AND environment='mock' AND app_env=(SELECT app_env FROM _dg_native_runtime_control WHERE id=1)) THEN PERFORM dg_native_restaurant_error('RESTAURANT_EXISTS');END IF;
  resource_value:=gen_random_uuid()::text;resource_type_value:='restaurant';
  INSERT INTO restaurants(id,tenant_id,workspace_id,venue_id,name,timezone,public_guide,profile_id,scene_app_id,hold_seconds,visit_minutes,late_minutes,accepting_guests,opening_windows,environment,app_env,created_at,updated_at) VALUES(resource_value,m.tenant_id,v.workspace_id,v.id,btrim(body->>'name'),v.timezone,body->>'publicGuide',body->>'profileId',body->>'sceneAppId',(body->>'holdSeconds')::bigint,(body->>'visitMinutes')::bigint,(body->>'lateMinutes')::bigint,dg_native_restaurant_bit(body->'acceptingGuests'),(body->'openingWindows')::text,'mock',(SELECT app_env FROM _dg_native_runtime_control WHERE id=1),created,created);
  INSERT INTO _dg_native_restaurant_origins VALUES(resource_value,(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1),m.user_id,m.tenant_id,v.workspace_id,created,pg_current_xact_id()::text);SELECT * INTO r FROM restaurants WHERE id=resource_value;grant_value:=0;
 ELSE
  SELECT * INTO r FROM restaurants WHERE id=meta->>'restaurantId';grant_value:=dg_native_restaurant_role(r.id,manager_value);resource_value:=r.id;resource_type_value:='restaurant';
  IF action_value IN('update','grant','table_update','table_state','item_update','stock') THEN version_value:=dg_native_restaurant_integer(input->'version',CASE WHEN action_value='grant' THEN 0 ELSE 1 END,9007199254740991);END IF;
  CASE action_value
  WHEN 'update' THEN
   body:=input-'version';PERFORM dg_native_restaurant_validate_config(body,r.tenant_id,r.workspace_id);IF r.version<>version_value THEN PERFORM dg_native_restaurant_error('VERSION_CONFLICT');END IF;
   UPDATE restaurants SET name=btrim(body->>'name'),public_guide=body->>'publicGuide',profile_id=body->>'profileId',scene_app_id=body->>'sceneAppId',hold_seconds=(body->>'holdSeconds')::bigint,visit_minutes=(body->>'visitMinutes')::bigint,late_minutes=(body->>'lateMinutes')::bigint,accepting_guests=dg_native_restaurant_bit(body->'acceptingGuests'),opening_windows=(body->'openingWindows')::text,version=version+1,updated_at=created WHERE id=r.id;
  WHEN 'grant' THEN
   PERFORM dg_native_restaurant_fields(input,ARRAY['userId','role','enabled','expiresAt','version']);IF input->>'role' NOT IN('manager','host','kitchen') OR input->>'role' IS NULL THEN PERFORM dg_native_restaurant_error('VALIDATION_FAILED');END IF;PERFORM dg_native_restaurant_bit(input->'enabled');
   IF NOT dg_native_office_member(input->>'userId',r.tenant_id,r.workspace_id,false) THEN PERFORM dg_native_restaurant_error('NOT_FOUND');END IF;
   IF m.user_id=input->>'userId' AND m.role<>'admin' THEN PERFORM dg_native_restaurant_error('SELF_GRANT_LOCKED');END IF;
   SELECT * INTO g FROM restaurant_staff WHERE restaurant_id=r.id AND user_id=input->>'userId';IF coalesce(g.version,0)<>version_value THEN PERFORM dg_native_restaurant_error('VERSION_CONFLICT');END IF;
   IF input->>'expiresAt' IS NOT NULL THEN BEGIN expires_value:=dg_native_people_iso((input->>'expiresAt')::timestamptz);EXCEPTION WHEN OTHERS THEN PERFORM dg_native_restaurant_error('VALIDATION_FAILED');END;IF expires_value<=created THEN PERFORM dg_native_restaurant_error('GRANT_EXPIRED');END IF;END IF;
   INSERT INTO restaurant_staff(restaurant_id,user_id,role,enabled,expires_at) VALUES(r.id,input->>'userId',input->>'role',dg_native_restaurant_bit(input->'enabled'),expires_value) ON CONFLICT(restaurant_id,user_id) DO UPDATE SET role=excluded.role,enabled=excluded.enabled,expires_at=excluded.expires_at,version=restaurant_staff.version+1;resource_type_value:='staff';
  WHEN 'table_create','table_update' THEN
   IF action_value='table_update' THEN PERFORM dg_native_restaurant_fields(input,ARRAY['version','table']);body:=input->'table';SELECT * INTO t FROM restaurant_tables WHERE id=target;IF t.version<>version_value THEN PERFORM dg_native_restaurant_error('VERSION_CONFLICT');END IF;ELSE body:=input;END IF;PERFORM dg_native_restaurant_table_fields(body);
   IF EXISTS(SELECT 1 FROM restaurant_tables WHERE restaurant_id=r.id AND code=upper(body->>'code') AND id<>coalesce(t.id,'')) THEN PERFORM dg_native_restaurant_error('DUPLICATE_TABLE_CODE');END IF;
   IF t.id IS NULL THEN
    IF(SELECT count(*) FROM restaurant_tables WHERE restaurant_id=r.id)>=200 THEN PERFORM dg_native_restaurant_error('TABLE_LIMIT');END IF;resource_value:=gen_random_uuid()::text;
    INSERT INTO restaurant_tables(id,restaurant_id,code,name,capacity,min_party_size,zone,x,y,width,height,enabled) VALUES(resource_value,r.id,upper(body->>'code'),btrim(body->>'name'),(body->>'capacity')::bigint,(body->>'minPartySize')::bigint,btrim(body->>'zone'),(body->>'x')::double precision,(body->>'y')::double precision,(body->>'width')::double precision,(body->>'height')::double precision,dg_native_restaurant_bit(body->'enabled'));
   ELSE
    IF EXISTS(SELECT 1 FROM dining_occupancies WHERE table_id=t.id AND state IN('held','seated')) THEN PERFORM dg_native_restaurant_error('TABLE_BUSY');END IF;
    IF EXISTS(SELECT 1 FROM dining_reservations b JOIN dining_parties p ON p.id=b.party_id WHERE b.table_id=t.id AND b.status IN('confirmed','checked_in') AND b.ends_at>created AND(dg_native_restaurant_bit(body->'enabled')=0 OR p.size>(body->>'capacity')::bigint OR p.size<(body->>'minPartySize')::bigint)) THEN PERFORM dg_native_restaurant_error('RESERVATION_CONFLICT');END IF;
    UPDATE restaurant_tables SET code=upper(body->>'code'),name=btrim(body->>'name'),capacity=(body->>'capacity')::bigint,min_party_size=(body->>'minPartySize')::bigint,zone=btrim(body->>'zone'),x=(body->>'x')::double precision,y=(body->>'y')::double precision,width=(body->>'width')::double precision,height=(body->>'height')::double precision,enabled=dg_native_restaurant_bit(body->'enabled'),version=version+1 WHERE id=t.id;resource_value:=t.id;
   END IF;resource_type_value:='table';
  WHEN 'table_state' THEN
   PERFORM dg_native_restaurant_fields(input,ARRAY['version','action','confirmed']);IF input->'confirmed' IS DISTINCT FROM 'true'::jsonb OR input->>'action' NOT IN('open','clean','block') OR input->>'action' IS NULL THEN PERFORM dg_native_restaurant_error('VALIDATION_FAILED');END IF;SELECT * INTO t FROM restaurant_tables WHERE id=target;IF t.version<>version_value THEN PERFORM dg_native_restaurant_error('VERSION_CONFLICT');END IF;IF EXISTS(SELECT 1 FROM dining_occupancies WHERE table_id=t.id AND state IN('held','seated')) THEN PERFORM dg_native_restaurant_error('TABLE_BUSY');END IF;
   UPDATE restaurant_tables SET operation=CASE input->>'action' WHEN 'clean' THEN 'cleaning' WHEN 'block' THEN 'blocked' ELSE 'open' END,version=version+1 WHERE id=t.id;resource_value:=t.id;resource_type_value:='table';
  WHEN 'item_create','item_update' THEN
   IF action_value='item_update' THEN PERFORM dg_native_restaurant_fields(input,ARRAY['version','item']);body:=input->'item';SELECT * INTO i FROM restaurant_menu_items WHERE id=target;IF i.version<>version_value THEN PERFORM dg_native_restaurant_error('VERSION_CONFLICT');END IF;ELSE body:=input;END IF;PERFORM dg_native_restaurant_item_fields(body);
   IF i.id IS NULL THEN
    IF(SELECT count(*) FROM restaurant_menu_items WHERE restaurant_id=r.id)>=500 THEN PERFORM dg_native_restaurant_error('MENU_LIMIT');END IF;resource_value:=gen_random_uuid()::text;
    INSERT INTO restaurant_menu_items(id,restaurant_id,name,category,description,ingredient_tags,allergen_tags,may_contain_tags,allergen_info_complete,flavor_tags,spice_level,is_new,listed) VALUES(resource_value,r.id,btrim(body->>'name'),btrim(body->>'category'),body->>'description',(body->'ingredientTags')::text,(body->'allergenTags')::text,(body->'mayContainTags')::text,dg_native_restaurant_bit(body->'allergenInfoComplete'),(body->'flavorTags')::text,(body->>'spiceLevel')::bigint,dg_native_restaurant_bit(body->'isNew'),dg_native_restaurant_bit(body->'listed'));
   ELSE
    resource_value:=i.id;UPDATE restaurant_menu_items SET name=btrim(body->>'name'),category=btrim(body->>'category'),description=body->>'description',ingredient_tags=(body->'ingredientTags')::text,allergen_tags=(body->'allergenTags')::text,may_contain_tags=(body->'mayContainTags')::text,allergen_info_complete=dg_native_restaurant_bit(body->'allergenInfoComplete'),flavor_tags=(body->'flavorTags')::text,spice_level=(body->>'spiceLevel')::bigint,is_new=dg_native_restaurant_bit(body->'isNew'),listed=dg_native_restaurant_bit(body->'listed'),version=version+1 WHERE id=i.id;
    UPDATE restaurant_menu_skus SET archived=1,version=version+1 WHERE item_id=i.id AND archived=0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(body->'skus') z WHERE z->>'id'=restaurant_menu_skus.id);
   END IF;
   FOR sku IN SELECT jsonb_array_elements(body->'skus') LOOP
    IF sku->>'id' IS NOT NULL THEN
     SELECT * INTO s FROM restaurant_menu_skus WHERE id=sku->>'id' AND restaurant_id=r.id AND item_id=resource_value FOR UPDATE;IF s.id IS NULL THEN PERFORM dg_native_restaurant_error('SKU_NOT_FOUND');END IF;
     SELECT coalesce(sum(quantity),0) INTO reserved_value FROM restaurant_inventory_reservations WHERE sku_id=s.id AND status='reserved' AND tracked=1;
     IF s.stock_tracked=1 AND dg_native_restaurant_bit(sku->'stockTracked')=0 AND reserved_value>0 THEN PERFORM dg_native_restaurant_error('INVENTORY_BUSY');END IF;
     UPDATE restaurant_menu_skus SET name=btrim(sku->>'name'),price_minor=(sku->>'priceMinor')::bigint,stock_tracked=dg_native_restaurant_bit(sku->'stockTracked'),stock_remaining=(sku->>'stockRemaining')::bigint,on_sale=dg_native_restaurant_bit(sku->'onSale'),portion_people=(sku->>'portionPeople')::bigint,archived=0,version=version+1 WHERE id=s.id;
    ELSE INSERT INTO restaurant_menu_skus(id,item_id,restaurant_id,name,price_minor,stock_tracked,stock_remaining,on_sale,portion_people) VALUES(gen_random_uuid()::text,resource_value,r.id,btrim(sku->>'name'),(sku->>'priceMinor')::bigint,dg_native_restaurant_bit(sku->'stockTracked'),(sku->>'stockRemaining')::bigint,dg_native_restaurant_bit(sku->'onSale'),(sku->>'portionPeople')::bigint);END IF;
   END LOOP;UPDATE restaurants SET menu_version=menu_version+1,updated_at=created WHERE id=r.id;resource_type_value:='item';
  WHEN 'stock' THEN
   PERFORM dg_native_restaurant_fields(input,ARRAY['version','quantity','reason']);PERFORM dg_native_restaurant_integer(input->'quantity',0,1000000);PERFORM dg_native_restaurant_text(input->'reason',1,120);SELECT * INTO s FROM restaurant_menu_skus WHERE id=target;IF s.version<>version_value THEN PERFORM dg_native_restaurant_error('VERSION_CONFLICT');END IF;IF s.stock_tracked<>1 THEN PERFORM dg_native_restaurant_error('STOCK_UNTRACKED');END IF;
   INSERT INTO restaurant_stock_adjustments VALUES(gen_random_uuid()::text,r.id,s.id,m.user_id,s.stock_remaining,(input->>'quantity')::bigint,btrim(input->>'reason'),created);UPDATE restaurant_menu_skus SET stock_remaining=(input->>'quantity')::bigint,version=version+1 WHERE id=s.id;UPDATE restaurant_menu_items SET version=version+1 WHERE id=s.item_id;UPDATE restaurants SET menu_version=menu_version+1,updated_at=created WHERE id=r.id;resource_value:=s.item_id;resource_type_value:='item';
  ELSE PERFORM dg_native_restaurant_error('VALIDATION_FAILED');END CASE;
 END IF;
 SELECT coalesce((SELECT epoch FROM _dg_native_restaurant_member_epochs WHERE user_id=m.user_id),0) INTO epoch_value;
 INSERT INTO _dg_native_restaurant_operations VALUES(operation_value,r.id,m.user_id,epoch_value,grant_value,manager_value,resource_type_value,resource_value,action_value,encode(sha256(convert_to(input::text,'UTF8')),'hex'),created,pg_current_xact_id()::text);
 INSERT INTO audit_events(id,tenant_id,workspace_id,actor_id,action,resource_id,outcome,request_id,created_at) VALUES(gen_random_uuid()::text,r.tenant_id,r.workspace_id,m.user_id,'restaurant.'||action_value,resource_value,'confirmed',operation_value,created);
 RETURN operation_value;
END;$dg$;
CREATE FUNCTION dg_native_restaurant_result(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE o _dg_native_restaurant_operations%ROWTYPE;m memberships%ROWTYPE;epoch_value bigint;result_value jsonb;
BEGIN
 m:=dg_native_restaurant_actor();SELECT * INTO o FROM _dg_native_restaurant_operations WHERE id=target AND actor_id=m.user_id;IF o.id IS NULL THEN PERFORM dg_native_restaurant_error('NOT_FOUND');END IF;
 PERFORM dg_native_restaurant_prepare('restaurant',o.restaurant_id,o.manager_required,false);SELECT coalesce((SELECT epoch FROM _dg_native_restaurant_member_epochs WHERE user_id=m.user_id),0) INTO epoch_value;
 IF epoch_value<>o.actor_epoch OR dg_native_restaurant_role(o.restaurant_id,o.manager_required)<>o.grant_version THEN PERFORM dg_native_restaurant_error('AUTHORIZATION_CHANGED');END IF;
 CASE o.resource_type WHEN 'restaurant' THEN RETURN dg_native_restaurant_view(o.resource_id);WHEN 'table' THEN RETURN dg_native_restaurant_table_view(o.resource_id);WHEN 'staff' THEN RETURN dg_native_restaurant_staff(o.restaurant_id);WHEN 'item' THEN SELECT x.value INTO result_value FROM jsonb_array_elements(dg_native_restaurant_menu(o.restaurant_id)->'items') AS x(value) WHERE x.value->>'id'=o.resource_id;IF result_value IS NULL THEN PERFORM dg_native_restaurant_error('NOT_FOUND');END IF;RETURN result_value;ELSE PERFORM dg_native_restaurant_error('VALIDATION_FAILED');END CASE;RETURN NULL;
END;$dg$;
CREATE FUNCTION dg_native_restaurant_text(value jsonb,lo integer,hi integer) RETURNS text LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE s text;
BEGIN IF value IS NULL OR jsonb_typeof(value)<>'string' THEN PERFORM dg_native_restaurant_error('VALIDATION_FAILED');END IF;s:=btrim(value#>>'{}');IF char_length(s) NOT BETWEEN lo AND hi THEN PERFORM dg_native_restaurant_error('VALIDATION_FAILED');END IF;RETURN s;END;$dg$;
CREATE FUNCTION dg_native_restaurant_bit(value jsonb) RETURNS bigint LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN IF value IS NULL OR jsonb_typeof(value)<>'boolean' THEN PERFORM dg_native_restaurant_error('VALIDATION_FAILED');END IF;RETURN CASE WHEN value='true'::jsonb THEN 1 ELSE 0 END;END;$dg$;
CREATE FUNCTION dg_native_restaurant_tags(value jsonb) RETURNS text LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE item jsonb;
BEGIN IF value IS NULL OR jsonb_typeof(value)<>'array' OR jsonb_array_length(value)>20 THEN PERFORM dg_native_restaurant_error('VALIDATION_FAILED');END IF;FOR item IN SELECT jsonb_array_elements(value) LOOP PERFORM dg_native_restaurant_text(item,1,40);END LOOP;RETURN value::text;END;$dg$;
CREATE FUNCTION dg_native_restaurant_actor() RETURNS memberships LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE m memberships%ROWTYPE;
BEGIN PERFORM dg_native_people_runtime();SELECT * INTO m FROM dg_native_locked_membership(current_setting('digitalguide.actor_id',true));IF m.user_id IS NULL THEN PERFORM dg_native_restaurant_error('AUTH_REQUIRED');END IF;RETURN m;END;$dg$;
CREATE FUNCTION dg_native_restaurant_role(target text,manager_value boolean DEFAULT false) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE m memberships%ROWTYPE;r restaurants%ROWTYPE;g restaurant_staff%ROWTYPE;
BEGIN
 m:=dg_native_restaurant_actor();SELECT * INTO r FROM restaurants WHERE id=target AND tenant_id=m.tenant_id AND environment='mock' AND app_env=(SELECT app_env FROM _dg_native_runtime_control WHERE id=1) AND workspace_id IN(SELECT id FROM workspaces WHERE tenant_id=m.tenant_id AND m.workspace_ids::jsonb ? id) AND EXISTS(SELECT 1 FROM _dg_native_restaurant_origins o WHERE o.restaurant_id=target AND o.runtime_id=(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1));
 IF r.id IS NULL THEN PERFORM dg_native_restaurant_error('NOT_FOUND');END IF;IF m.role='admin' THEN RETURN 0;END IF;
 SELECT * INTO g FROM restaurant_staff WHERE restaurant_id=r.id AND user_id=m.user_id AND enabled=1 AND(expires_at IS NULL OR expires_at>dg_utc_now()) AND(role='manager' OR NOT manager_value AND role='host');
 IF g.user_id IS NULL THEN PERFORM dg_native_restaurant_error('NOT_FOUND');END IF;RETURN g.version;
END;$dg$;
CREATE FUNCTION dg_native_restaurant_prepare(kind_value text,target text,manager_value boolean,write_value boolean,recipient_value text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE m memberships%ROWTYPE;r restaurants%ROWTYPE;w text;t text;
BEGIN
 m:=dg_native_restaurant_actor();IF recipient_value IS NOT NULL THEN PERFORM user_id FROM memberships WHERE user_id=recipient_value FOR SHARE;END IF;
 IF kind_value='venue' THEN
  IF m.role<>'admin' THEN PERFORM dg_native_restaurant_error('FORBIDDEN');END IF;
  SELECT workspace_id INTO w FROM venues WHERE id=target AND tenant_id=m.tenant_id AND m.workspace_ids::jsonb ? workspace_id;
 ELSE
  CASE kind_value WHEN 'restaurant' THEN t:=target;WHEN 'table' THEN SELECT restaurant_id INTO t FROM restaurant_tables WHERE id=target;WHEN 'item' THEN SELECT restaurant_id INTO t FROM restaurant_menu_items WHERE id=target;WHEN 'sku' THEN SELECT restaurant_id INTO t FROM restaurant_menu_skus WHERE id=target AND archived=0;ELSE PERFORM dg_native_restaurant_error('VALIDATION_FAILED');END CASE;
  PERFORM dg_native_restaurant_role(t,manager_value);SELECT * INTO r FROM restaurants WHERE id=t;w:=r.workspace_id;
 END IF;
 IF w IS NULL THEN PERFORM dg_native_restaurant_error('NOT_FOUND');END IF;
 IF write_value THEN PERFORM pg_advisory_xact_lock(hashtextextended('["native-asset-workspace",'||to_jsonb(m.tenant_id)::text||','||to_jsonb(w)::text||']',0));ELSE PERFORM pg_advisory_xact_lock_shared(hashtextextended('["native-asset-workspace",'||to_jsonb(m.tenant_id)::text||','||to_jsonb(w)::text||']',0));END IF;
 IF t IS NOT NULL THEN IF write_value THEN PERFORM id FROM restaurants WHERE id=t FOR UPDATE;ELSE PERFORM id FROM restaurants WHERE id=t FOR SHARE;END IF;PERFORM dg_native_restaurant_role(t,manager_value);END IF;
 RETURN jsonb_build_object('workspaceId',w,'restaurantId',t);
END;$dg$;
CREATE FUNCTION dg_native_restaurant_validate_config(input jsonb,tenant_value text,workspace_value text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE win jsonb;day_value jsonb;p profiles%ROWTYPE;s scene_apps%ROWTYPE;start_value bigint;
BEGIN
 PERFORM dg_native_restaurant_fields(input,ARRAY['name','publicGuide','profileId','sceneAppId','holdSeconds','visitMinutes','lateMinutes','acceptingGuests','openingWindows']);
 PERFORM dg_native_restaurant_text(input->'name',1,80);PERFORM dg_native_restaurant_text(input->'publicGuide',0,1000);PERFORM dg_native_restaurant_integer(input->'holdSeconds',30,600);PERFORM dg_native_restaurant_integer(input->'visitMinutes',15,240);PERFORM dg_native_restaurant_integer(input->'lateMinutes',0,60);PERFORM dg_native_restaurant_bit(input->'acceptingGuests');
 IF jsonb_typeof(input->'openingWindows') IS DISTINCT FROM 'array' OR jsonb_array_length(input->'openingWindows') NOT BETWEEN 1 AND 28 THEN PERFORM dg_native_restaurant_error('VALIDATION_FAILED');END IF;
 FOR win IN SELECT jsonb_array_elements(input->'openingWindows') LOOP
  PERFORM dg_native_restaurant_fields(win,ARRAY['days','startMinute','endMinute']);IF jsonb_typeof(win->'days') IS DISTINCT FROM 'array' OR jsonb_array_length(win->'days') NOT BETWEEN 1 AND 7 THEN PERFORM dg_native_restaurant_error('VALIDATION_FAILED');END IF;
  FOR day_value IN SELECT jsonb_array_elements(win->'days') LOOP PERFORM dg_native_restaurant_integer(day_value,0,6);END LOOP;start_value:=dg_native_restaurant_integer(win->'startMinute',0,1439);IF dg_native_restaurant_integer(win->'endMinute',1,1440)<=start_value THEN PERFORM dg_native_restaurant_error('VALIDATION_FAILED');END IF;
 END LOOP;
 IF input->>'profileId' IS NOT NULL THEN SELECT * INTO p FROM profiles WHERE id=input->>'profileId' AND tenant_id=tenant_value AND workspace_id=workspace_value AND scenes::jsonb ? 'restaurant';IF p.id IS NULL THEN PERFORM dg_native_restaurant_error('SOURCE_UNAVAILABLE');END IF;END IF;
 IF input->>'sceneAppId' IS NOT NULL THEN SELECT * INTO s FROM scene_apps WHERE id=input->>'sceneAppId' AND tenant_id=tenant_value AND workspace_id=workspace_value AND scene='restaurant' AND enabled=1 AND environment='mock' AND app_env=(SELECT app_env FROM _dg_native_runtime_control WHERE id=1) AND config::jsonb->>'audience'='public';IF s.id IS NULL OR p.id IS NOT NULL AND p.id<>s.profile_id THEN PERFORM dg_native_restaurant_error('SOURCE_UNAVAILABLE');END IF;END IF;
END;$dg$;
CREATE FUNCTION dg_native_restaurant_view(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE r restaurants%ROWTYPE;m memberships%ROWTYPE;manage_value boolean;
BEGIN
 PERFORM dg_native_restaurant_prepare('restaurant',target,false,false);SELECT * INTO r FROM restaurants WHERE id=target;m:=dg_native_restaurant_actor();manage_value:=m.role='admin' OR EXISTS(SELECT 1 FROM restaurant_staff WHERE restaurant_id=target AND user_id=m.user_id AND role='manager' AND enabled=1 AND(expires_at IS NULL OR expires_at>dg_utc_now()));
 RETURN jsonb_build_object('id',r.id,'workspaceId',r.workspace_id,'venueId',r.venue_id,'name',r.name,'timezone',r.timezone,'publicGuide',r.public_guide,'profileId',r.profile_id,'sceneAppId',r.scene_app_id,'holdSeconds',r.hold_seconds,'visitMinutes',r.visit_minutes,'lateMinutes',r.late_minutes,'acceptingGuests',r.accepting_guests=1,'openingWindows',r.opening_windows::jsonb,'version',r.version,'menuVersion',r.menu_version,'canManage',manage_value,'canHost',true,'dataSource','local','businessConnected',false,'capabilities',jsonb_build_object('seating',false,'ordering',false,'payments',false,'hospitality',false,'terminals',false,'sourceDirectory',true));
END;$dg$;
CREATE FUNCTION dg_native_restaurant_list(workspace_values text[],cursor_value text,limit_value integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE m memberships%ROWTYPE;r record;w text;items jsonb:='[]';
BEGIN
 m:=dg_native_restaurant_actor();IF limit_value NOT BETWEEN 1 AND 101 OR workspace_values IS NULL THEN PERFORM dg_native_restaurant_error('VALIDATION_FAILED');END IF;
 FOREACH w IN ARRAY workspace_values LOOP IF NOT EXISTS(SELECT 1 FROM workspaces WHERE id=w AND tenant_id=m.tenant_id AND m.workspace_ids::jsonb ? id) THEN PERFORM dg_native_restaurant_error('NOT_FOUND');END IF;END LOOP;
 FOR r IN SELECT a.id FROM restaurants a JOIN _dg_native_restaurant_origins o ON o.restaurant_id=a.id WHERE a.tenant_id=m.tenant_id AND a.workspace_id=ANY(workspace_values) AND a.environment='mock' AND a.app_env=(SELECT app_env FROM _dg_native_runtime_control WHERE id=1) AND a.id>coalesce(cursor_value,'') AND(m.role='admin' OR EXISTS(SELECT 1 FROM restaurant_staff g WHERE g.restaurant_id=a.id AND g.user_id=m.user_id AND g.enabled=1 AND(g.expires_at IS NULL OR g.expires_at>dg_utc_now()) AND g.role IN('manager','host'))) ORDER BY a.id LIMIT limit_value LOOP items:=items||jsonb_build_array(dg_native_restaurant_view(r.id));END LOOP;RETURN items;
END;$dg$;
CREATE FUNCTION dg_native_restaurant_table_view(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE t restaurant_tables%ROWTYPE;o dining_occupancies%ROWTYPE;
BEGIN
 PERFORM dg_native_restaurant_prepare('table',target,false,false);SELECT * INTO t FROM restaurant_tables WHERE id=target;SELECT * INTO o FROM dining_occupancies WHERE table_id=target AND state IN('held','seated');
 RETURN jsonb_build_object('id',t.id,'restaurantId',t.restaurant_id,'code',t.code,'name',t.name,'capacity',t.capacity,'minPartySize',t.min_party_size,'zone',t.zone,'x',t.x,'y',t.y,'width',t.width,'height',t.height,'enabled',t.enabled=1,'operation',t.operation,'state',CASE WHEN t.enabled<>1 THEN 'disabled' WHEN t.operation='cleaning' THEN 'cleaning' WHEN t.operation='blocked' THEN 'blocked' WHEN o.id IS NOT NULL THEN o.state ELSE 'available' END,'version',t.version,'partyId',o.party_id,'holdExpiresAt',CASE WHEN o.state='held' THEN o.expires_at END,'expectedEndAt',o.expected_end_at);
END;$dg$;
CREATE FUNCTION dg_native_restaurant_tables(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE t record;items jsonb:='[]';
BEGIN PERFORM dg_native_restaurant_prepare('restaurant',target,false,false);FOR t IN SELECT id FROM restaurant_tables WHERE restaurant_id=target ORDER BY zone,code,id LOOP items:=items||jsonb_build_array(dg_native_restaurant_table_view(t.id));END LOOP;RETURN items;END;$dg$;
CREATE FUNCTION dg_native_restaurant_menu(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE r restaurants%ROWTYPE;i restaurant_menu_items%ROWTYPE;s restaurant_menu_skus%ROWTYPE;items jsonb:='[]';skus jsonb;reserved_value bigint;
BEGIN
 PERFORM dg_native_restaurant_prepare('restaurant',target,false,false);SELECT * INTO r FROM restaurants WHERE id=target;
 FOR i IN SELECT * FROM restaurant_menu_items WHERE restaurant_id=target ORDER BY category,name,id LOOP
  skus:='[]';FOR s IN SELECT * FROM restaurant_menu_skus WHERE restaurant_id=target AND item_id=i.id AND archived=0 ORDER BY price_minor,id LOOP
   SELECT coalesce(sum(quantity),0) INTO reserved_value FROM restaurant_inventory_reservations WHERE sku_id=s.id AND status='reserved' AND tracked=1;
   skus:=skus||jsonb_build_array(jsonb_build_object('id',s.id,'name',s.name,'priceMinor',s.price_minor,'currency','CNY','portionPeople',s.portion_people,'version',s.version,'available',i.listed=1 AND s.on_sale=1 AND(s.stock_tracked=0 OR s.stock_remaining>0),'unavailableReason',CASE WHEN i.listed<>1 THEN '未上架' WHEN s.on_sale<>1 THEN '规格停售' WHEN s.stock_tracked=1 AND s.stock_remaining=0 THEN '已售罄' END,'stockTracked',s.stock_tracked=1,'stockRemaining',s.stock_remaining,'reservedQuantity',reserved_value,'onSale',s.on_sale=1));
  END LOOP;
  items:=items||jsonb_build_array(jsonb_build_object('id',i.id,'name',i.name,'category',i.category,'description',i.description,'ingredientTags',i.ingredient_tags::jsonb,'allergenTags',i.allergen_tags::jsonb,'mayContainTags',i.may_contain_tags::jsonb,'allergenInfoComplete',i.allergen_info_complete=1,'flavorTags',i.flavor_tags::jsonb,'spiceLevel',i.spice_level,'isNew',i.is_new=1,'listed',i.listed=1,'version',i.version,'skus',skus));
 END LOOP;RETURN jsonb_build_object('restaurantId',r.id,'version',r.menu_version,'items',items,'source','local','notice','菜单与库存来自当前本地服务器；真实POS未接入。价格和可供状态变动后需要重新核对。');
END;$dg$;
CREATE FUNCTION dg_native_restaurant_staff(target text,members_value boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE r restaurants%ROWTYPE;items jsonb;
BEGIN
 PERFORM dg_native_restaurant_prepare('restaurant',target,true,false);SELECT * INTO r FROM restaurants WHERE id=target;
 IF members_value THEN SELECT coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',u.name) ORDER BY u.name,u.id),'[]'::jsonb) INTO items FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.tenant_id=r.tenant_id AND m.workspace_ids::jsonb ? r.workspace_id;
 ELSE SELECT coalesce(jsonb_agg(jsonb_build_object('userId',g.user_id,'name',u.name,'role',g.role,'enabled',g.enabled=1,'expiresAt',g.expires_at,'version',g.version) ORDER BY u.name,u.id),'[]'::jsonb) INTO items FROM restaurant_staff g JOIN users u ON u.id=g.user_id WHERE g.restaurant_id=target;END IF;RETURN items;
END;$dg$;
CREATE FUNCTION dg_native_restaurant_stock_history(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE items jsonb;
BEGIN PERFORM dg_native_restaurant_prepare('sku',target,true,false);SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'skuId',a.sku_id,'beforeQuantity',a.before_quantity,'afterQuantity',a.after_quantity,'reason',a.reason,'actorName',u.name,'createdAt',a.created_at) ORDER BY a.created_at DESC,a.id DESC),'[]'::jsonb) INTO items FROM(SELECT * FROM restaurant_stock_adjustments WHERE sku_id=target ORDER BY created_at DESC,id DESC LIMIT 50)a JOIN users u ON u.id=a.actor_id;RETURN items;END;$dg$;

CREATE FUNCTION dg_native_restaurant_table_fields(input jsonb) RETURNS void LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE v jsonb;k text;n numeric;x_value numeric;y_value numeric;
BEGIN
 PERFORM dg_native_restaurant_fields(input,ARRAY['code','name','capacity','minPartySize','zone','x','y','width','height','enabled']);IF dg_native_restaurant_text(input->'code',1,20)!~'^[A-Za-z0-9_-]+$' THEN PERFORM dg_native_restaurant_error('VALIDATION_FAILED');END IF;PERFORM dg_native_restaurant_text(input->'name',1,80);PERFORM dg_native_restaurant_text(input->'zone',0,40);PERFORM dg_native_restaurant_bit(input->'enabled');
 IF dg_native_restaurant_integer(input->'minPartySize',1,40)>dg_native_restaurant_integer(input->'capacity',1,40) THEN PERFORM dg_native_restaurant_error('VALIDATION_FAILED');END IF;
 FOREACH k IN ARRAY ARRAY['x','y','width','height'] LOOP v:=input->k;IF jsonb_typeof(v) IS DISTINCT FROM 'number' OR char_length(v::text)>32 THEN PERFORM dg_native_restaurant_error('VALIDATION_FAILED');END IF;n:=(v#>>'{}')::numeric;IF n<(CASE WHEN k IN('width','height') THEN 0.03 ELSE 0 END) OR n>1 THEN PERFORM dg_native_restaurant_error('VALIDATION_FAILED');END IF;END LOOP;
 x_value:=(input->>'x')::numeric+(input->>'width')::numeric;y_value:=(input->>'y')::numeric+(input->>'height')::numeric;IF x_value>1.001 OR y_value>1.001 THEN PERFORM dg_native_restaurant_error('VALIDATION_FAILED');END IF;
END;$dg$;
CREATE FUNCTION dg_native_restaurant_item_fields(input jsonb) RETURNS void LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE s jsonb;
BEGIN
 PERFORM dg_native_restaurant_fields(input,ARRAY['name','category','description','ingredientTags','allergenTags','mayContainTags','allergenInfoComplete','flavorTags','spiceLevel','isNew','listed','skus']);PERFORM dg_native_restaurant_text(input->'name',1,80);PERFORM dg_native_restaurant_text(input->'category',1,40);PERFORM dg_native_restaurant_text(input->'description',0,600);PERFORM dg_native_restaurant_tags(input->'ingredientTags');PERFORM dg_native_restaurant_tags(input->'allergenTags');PERFORM dg_native_restaurant_tags(input->'mayContainTags');PERFORM dg_native_restaurant_tags(input->'flavorTags');PERFORM dg_native_restaurant_bit(input->'allergenInfoComplete');PERFORM dg_native_restaurant_bit(input->'isNew');PERFORM dg_native_restaurant_bit(input->'listed');PERFORM dg_native_restaurant_integer(input->'spiceLevel',0,3);
 IF jsonb_typeof(input->'skus') IS DISTINCT FROM 'array' OR jsonb_array_length(input->'skus') NOT BETWEEN 1 AND 12 THEN PERFORM dg_native_restaurant_error('VALIDATION_FAILED');END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(input->'skus') s GROUP BY lower(btrim(s->>'name')) HAVING count(*)>1) THEN PERFORM dg_native_restaurant_error('DUPLICATE_SKU_NAME');END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(input->'skus') s WHERE s->>'id' IS NOT NULL GROUP BY s->>'id' HAVING count(*)>1) THEN PERFORM dg_native_restaurant_error('DUPLICATE_SKU');END IF;
 FOR s IN SELECT jsonb_array_elements(input->'skus') LOOP PERFORM dg_native_restaurant_fields(s,ARRAY['id','name','priceMinor','stockTracked','stockRemaining','onSale','portionPeople']);PERFORM dg_native_restaurant_text(s->'name',1,80);PERFORM dg_native_restaurant_integer(s->'priceMinor',0,10000000);PERFORM dg_native_restaurant_integer(s->'stockRemaining',0,1000000);PERFORM dg_native_restaurant_integer(s->'portionPeople',1,40);PERFORM dg_native_restaurant_bit(s->'stockTracked');PERFORM dg_native_restaurant_bit(s->'onSale');END LOOP;
END;$dg$;

CREATE FUNCTION dg_native_restaurant_member_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE actor text;
BEGIN
 IF TG_OP='UPDATE' AND to_jsonb(OLD)=to_jsonb(NEW) THEN RETURN NEW;END IF;
 actor:=CASE WHEN TG_OP='DELETE' THEN OLD.user_id ELSE NEW.user_id END;
 INSERT INTO _dg_native_restaurant_member_epochs VALUES(actor,1,pg_current_xact_id()::text) ON CONFLICT(user_id) DO UPDATE SET epoch=_dg_native_restaurant_member_epochs.epoch+1,transaction_id=pg_current_xact_id()::text;
 UPDATE restaurant_staff g SET enabled=0,version=g.version+1 FROM restaurants r JOIN _dg_native_restaurant_origins o ON o.restaurant_id=r.id WHERE g.restaurant_id=r.id AND g.user_id=actor AND g.enabled=1 AND NOT dg_native_office_member(actor,r.tenant_id,r.workspace_id,false);
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_restaurant_member_changed AFTER INSERT OR UPDATE OR DELETE ON memberships FOR EACH ROW EXECUTE FUNCTION dg_native_restaurant_member_changed();
CREATE FUNCTION dg_native_restaurant_staff_revision() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN INSERT INTO _dg_native_restaurant_staff_revisions VALUES(NEW.restaurant_id,NEW.user_id,NEW.version,NEW.role,NEW.enabled,NEW.expires_at,dg_utc_now());RETURN NEW;END;$dg$;
CREATE TRIGGER native_restaurant_staff_revision AFTER INSERT OR UPDATE ON restaurant_staff FOR EACH ROW EXECUTE FUNCTION dg_native_restaurant_staff_revision();
CREATE FUNCTION dg_native_restaurant_epoch_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN IF TG_OP='DELETE' OR NEW.transaction_id<>pg_current_xact_id()::text OR TG_OP='INSERT' AND NEW.epoch<>1 OR TG_OP='UPDATE' AND(NEW.user_id<>OLD.user_id OR NEW.epoch<>OLD.epoch+1) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Restaurant membership epochs are monotonic';END IF;RETURN NEW;END;$dg$;
CREATE TRIGGER native_restaurant_epoch_guard BEFORE INSERT OR UPDATE OR DELETE ON _dg_native_restaurant_member_epochs FOR EACH ROW EXECUTE FUNCTION dg_native_restaurant_epoch_guard();
CREATE FUNCTION dg_native_restaurant_record_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE j jsonb:=to_jsonb(NEW);previous jsonb:=to_jsonb(OLD);
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native restaurant records retain business provenance';END IF;
 IF TG_OP='UPDATE' THEN
  IF TG_TABLE_NAME='restaurants' THEN
   IF j-ARRAY['name','public_guide','profile_id','scene_app_id','hold_seconds','visit_minutes','late_minutes','accepting_guests','opening_windows','version','menu_version','updated_at'] IS DISTINCT FROM previous-ARRAY['name','public_guide','profile_id','scene_app_id','hold_seconds','visit_minutes','late_minutes','accepting_guests','opening_windows','version','menu_version','updated_at'] OR NOT((j->>'version')::bigint=(previous->>'version')::bigint+1 AND j->'menu_version'=previous->'menu_version' OR j->'version'=previous->'version' AND(j->>'menu_version')::bigint=(previous->>'menu_version')::bigint+1 AND j-ARRAY['menu_version','updated_at']=previous-ARRAY['menu_version','updated_at']) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Restaurant scope and separate config/catalog versions are guarded';END IF;
  ELSE
   IF j->>'version' IS NULL OR(j->>'version')::bigint<>(previous->>'version')::bigint+1 OR j->>'id' IS DISTINCT FROM previous->>'id' OR j->>'restaurant_id' IS DISTINCT FROM previous->>'restaurant_id' OR j->>'item_id' IS DISTINCT FROM previous->>'item_id' OR j->>'user_id' IS DISTINCT FROM previous->>'user_id' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Restaurant child scope and versions cannot be retargeted';END IF;
  END IF;
 ELSE
  IF coalesce((j->>'version')::bigint,1)<>1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native restaurant rows start at version one';END IF;
 END IF;
 IF TG_TABLE_NAME='restaurants' THEN
  IF (j->>'environment')<>'mock' OR (j->>'app_env')<>(SELECT app_env FROM _dg_native_runtime_control WHERE id=1) OR (j->>'queue_counter')::bigint<>0 OR (j->>'booking_counter')::bigint<>0 OR (j->>'order_counter')::bigint<>0 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Restaurant catalog does not fabricate service counters';END IF;
 ELSIF TG_TABLE_NAME='restaurant_tables' THEN
  IF (j->>'capacity')::bigint NOT BETWEEN 1 AND 40 OR (j->>'min_party_size')::bigint NOT BETWEEN 1 AND (j->>'capacity')::bigint OR (j->>'enabled')::bigint NOT IN(0,1) OR (j->>'code')!~'^[A-Z0-9_-]{1,20}$' OR (j->>'x')::double precision<0 OR (j->>'y')::double precision<0 OR (j->>'width')::double precision<0.03 OR (j->>'height')::double precision<0.03 OR (j->>'x')::double precision+(j->>'width')::double precision>1.001 OR (j->>'y')::double precision+(j->>'height')::double precision>1.001 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Restaurant table geometry and capacity are bounded';END IF;
  IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM dining_occupancies WHERE table_id=(j->>'id') AND state IN('held','seated')) THEN PERFORM dg_native_restaurant_error('TABLE_BUSY');END IF;
 ELSIF TG_TABLE_NAME='restaurant_menu_skus' THEN
  IF (j->>'price_minor')::bigint NOT BETWEEN 0 AND 10000000 OR (j->>'stock_remaining')::bigint NOT BETWEEN 0 AND 1000000 OR (j->>'stock_tracked')::bigint NOT IN(0,1) OR (j->>'on_sale')::bigint NOT IN(0,1) OR (j->>'archived')::bigint NOT IN(0,1) OR (j->>'portion_people')::bigint NOT BETWEEN 1 AND 40 OR NOT EXISTS(SELECT 1 FROM restaurant_menu_items WHERE id=(j->>'item_id') AND restaurant_id=(j->>'restaurant_id')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SKU price, inventory and parent binding are guarded';END IF;
 ELSIF TG_TABLE_NAME='restaurant_staff' THEN IF (j->>'enabled')::bigint NOT IN(0,1) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Restaurant duties need explicit enabled state';END IF;
 END IF;
 RETURN NEW;
END;$dg$;
CREATE TRIGGER native_restaurant_record_guard BEFORE INSERT OR UPDATE OR DELETE ON restaurants FOR EACH ROW EXECUTE FUNCTION dg_native_restaurant_record_guard();
CREATE TRIGGER native_restaurant_table_record_guard BEFORE INSERT OR UPDATE OR DELETE ON restaurant_tables FOR EACH ROW EXECUTE FUNCTION dg_native_restaurant_record_guard();
CREATE TRIGGER native_restaurant_item_record_guard BEFORE INSERT OR UPDATE OR DELETE ON restaurant_menu_items FOR EACH ROW EXECUTE FUNCTION dg_native_restaurant_record_guard();
CREATE TRIGGER native_restaurant_sku_record_guard BEFORE INSERT OR UPDATE OR DELETE ON restaurant_menu_skus FOR EACH ROW EXECUTE FUNCTION dg_native_restaurant_record_guard();
CREATE TRIGGER native_restaurant_staff_record_guard BEFORE INSERT OR UPDATE OR DELETE ON restaurant_staff FOR EACH ROW EXECUTE FUNCTION dg_native_restaurant_record_guard();
CREATE TRIGGER native_restaurant_adjustment_immutable BEFORE UPDATE OR DELETE ON restaurant_stock_adjustments FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE FUNCTION dg_native_restaurant_final() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE j jsonb:=to_jsonb(NEW);restaurant_value text;r restaurants%ROWTYPE;o _dg_native_restaurant_origins%ROWTYPE;
BEGIN
 restaurant_value:=CASE WHEN TG_TABLE_NAME='restaurants' THEN j->>'id' ELSE j->>'restaurant_id' END;SELECT * INTO r FROM restaurants WHERE id=restaurant_value;SELECT * INTO o FROM _dg_native_restaurant_origins WHERE restaurant_id=restaurant_value;
 IF r.id IS NULL OR o.restaurant_id IS NULL OR o.runtime_id<>(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1) OR o.tenant_id<>r.tenant_id OR o.workspace_id<>r.workspace_id OR NOT EXISTS(SELECT 1 FROM venues WHERE id=r.venue_id AND tenant_id=r.tenant_id AND workspace_id=r.workspace_id AND timezone=r.timezone) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native restaurant origin and venue scope must remain bound';END IF;
 IF TG_TABLE_NAME='restaurant_staff' AND j->>'enabled'='0' AND EXISTS(SELECT 1 FROM _dg_native_restaurant_member_epochs WHERE user_id=j->>'user_id' AND transaction_id=pg_current_xact_id()::text) THEN RETURN NEW;END IF;
 IF NOT EXISTS(SELECT 1 FROM _dg_native_restaurant_operations WHERE restaurant_id=r.id AND transaction_id=pg_current_xact_id()::text) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Restaurant changes require a durable authorized operation';END IF;
 RETURN NEW;
END;$dg$;
CREATE CONSTRAINT TRIGGER native_restaurant_origin_final AFTER INSERT OR UPDATE ON restaurants DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_restaurant_final();
CREATE CONSTRAINT TRIGGER native_restaurant_table_final AFTER INSERT OR UPDATE ON restaurant_tables DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_restaurant_final();
CREATE CONSTRAINT TRIGGER native_restaurant_item_final AFTER INSERT OR UPDATE ON restaurant_menu_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_restaurant_final();
CREATE CONSTRAINT TRIGGER native_restaurant_sku_final AFTER INSERT OR UPDATE ON restaurant_menu_skus DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_restaurant_final();
CREATE CONSTRAINT TRIGGER native_restaurant_staff_final AFTER INSERT OR UPDATE ON restaurant_staff DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_restaurant_final();
CREATE CONSTRAINT TRIGGER native_restaurant_stock_final AFTER INSERT ON restaurant_stock_adjustments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_restaurant_final();
DO $dg$ DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND p.proname LIKE 'dg_native_restaurant_%' LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||f.signature||' FROM PUBLIC';END LOOP;END;$dg$;
