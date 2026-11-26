-- Keep090 frozen. A statement can wait on a lock; business deadlines use the actual wall clock.
CREATE FUNCTION dg_native_dining_now() RETURNS text LANGUAGE sql SET search_path FROM CURRENT AS $dg$ SELECT dg_native_people_iso(clock_timestamp()) $dg$;
CREATE FUNCTION dg_native_dining_clock_authority(actor_value text,restaurant_value text,epoch_value bigint,grant_value bigint) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT dg_native_dining_authority(actor_value,restaurant_value,epoch_value,grant_value) AND(grant_value=0 OR EXISTS(SELECT 1 FROM restaurant_staff WHERE restaurant_id=restaurant_value AND user_id=actor_value AND version=grant_value AND(expires_at IS NULL OR expires_at>dg_native_dining_now())))
$dg$;

CREATE OR REPLACE FUNCTION dg_native_dining_error(code_value text) RETURNS void LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='DGDINING:'||code_value;END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_dining_iso(value text) RETURNS text LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE result text;
BEGIN IF value IS NULL OR char_length(value)>40 THEN PERFORM dg_native_dining_error('VALIDATION_FAILED');END IF;BEGIN result:=dg_native_people_iso(value::timestamptz);EXCEPTION WHEN data_exception THEN PERFORM dg_native_dining_error('VALIDATION_FAILED');END;RETURN result;END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_dining_open_interval(r restaurants,start_value text,end_value text) RETURNS boolean LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
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


CREATE OR REPLACE FUNCTION dg_native_dining_fields(input jsonb) RETURNS void LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
 PERFORM dg_native_restaurant_fields(input,ARRAY['name','size','visitMinutes','guestNote']);PERFORM dg_native_restaurant_text(input->'name',1,60);PERFORM dg_native_restaurant_text(input->'guestNote',0,300);PERFORM dg_native_restaurant_integer(input->'size',1,40);PERFORM dg_native_restaurant_integer(input->'visitMinutes',15,240);
END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_dining_context(kind_value text,target text,session_value text DEFAULT NULL,token_hash_value text DEFAULT NULL,csrf_hash_value text DEFAULT NULL,focus_value bigint DEFAULT NULL,write_value boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
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
  m:=dg_native_restaurant_actor();PERFORM dg_native_restaurant_prepare('restaurant',restaurant_value,false,write_value,NULL);stamp_value:=dg_native_restaurant_role(restaurant_value,false);IF NOT dg_native_dining_clock_authority(m.user_id,restaurant_value,(SELECT epoch FROM _dg_native_restaurant_member_epochs WHERE user_id=m.user_id),stamp_value) THEN PERFORM dg_native_dining_error('NOT_FOUND');END IF;
  meta:=jsonb_build_object('actorType','staff','actorId',m.user_id,'actorEpoch',(SELECT epoch FROM _dg_native_restaurant_member_epochs WHERE user_id=m.user_id),'grantVersion',stamp_value,'sessionId',NULL,'accessId',NULL,'focusVersion',NULL);
 ELSE
  PERFORM dg_native_reception_authorize(session_value,token_hash_value,csrf_hash_value,write_value);SELECT * INTO s FROM reception_sessions WHERE id=session_value;IF s.expires_at<=dg_native_dining_now() OR s.activity_at<=dg_native_people_iso(clock_timestamp()-interval '120 seconds') OR NOT EXISTS(SELECT 1 FROM _dg_native_dining_session_origins origin WHERE origin.session_id=s.id AND dg_native_dining_clock_authority(origin.actor_id,origin.restaurant_id,origin.actor_epoch,origin.grant_version)) OR EXISTS(SELECT 1 FROM _dg_native_reception_origins origin CROSS JOIN LATERAL jsonb_array_elements(origin.assets::jsonb) fixed JOIN assets asset ON asset.id=fixed->>'id' WHERE origin.session_id=s.id AND asset.expires_at IS NOT NULL AND asset.expires_at<=dg_native_dining_now()) THEN PERFORM dg_native_dining_error('AUTH_REQUIRED');END IF;
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


CREATE OR REPLACE FUNCTION dg_native_dining_action(meta jsonb,kind_value text,type_value text,resource_value text,input jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE id_value text:=gen_random_uuid()::text;
BEGIN
 INSERT INTO _dg_native_dining_actions VALUES(id_value,meta->>'restaurantId',meta->>'actorType',meta->>'actorId',(meta->>'actorEpoch')::bigint,(meta->>'grantVersion')::bigint,meta->>'sessionId',meta->>'accessId',(meta->>'focusVersion')::bigint,CASE WHEN meta->>'actorType'='guest' THEN(meta->>'selectionVersion')::bigint+CASE WHEN kind_value IN('create','reserve','select','claim') THEN 1 ELSE 0 END END,kind_value,type_value,resource_value,dg_native_office_hash(input),dg_native_dining_now(),pg_current_xact_id()::text);
 INSERT INTO audit_events VALUES(gen_random_uuid()::text,meta->>'tenantId',meta->>'workspaceId',meta->>'actorId','dining.'||kind_value,resource_value,'native-dining-operation',dg_native_dining_now(),'confirmed');RETURN id_value;
END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_dining_effect(action_value text,table_value text,target text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_dining_actions WHERE id=action_value AND transaction_id=pg_current_xact_id()::text) THEN PERFORM dg_native_dining_error('FORBIDDEN');END IF;
 INSERT INTO _dg_native_dining_changes VALUES(action_value,table_value,target,pg_current_xact_id()::text) ON CONFLICT DO NOTHING;
END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_dining_changed(table_value text,target text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT EXISTS(SELECT 1 FROM _dg_native_dining_changes c JOIN _dg_native_dining_actions a ON a.id=c.action_id WHERE c.table_name=table_value AND c.resource_id=target AND c.transaction_id=pg_current_xact_id()::text AND a.transaction_id=c.transaction_id)
$dg$;


CREATE OR REPLACE FUNCTION dg_native_dining_owned(meta jsonb,target text) RETURNS dining_parties LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE p dining_parties%ROWTYPE;
BEGIN SELECT * INTO p FROM dining_parties WHERE id=target FOR UPDATE;IF p.id IS NULL OR p.restaurant_id IS DISTINCT FROM meta->>'restaurantId' OR NOT EXISTS(SELECT 1 FROM _dg_native_dining_party_origins WHERE party_id=p.id) OR meta->>'actorType'='guest' AND p.owner_session_id IS DISTINCT FROM meta->>'sessionId' THEN PERFORM dg_native_dining_error('NOT_FOUND');END IF;RETURN p;END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_dining_fits(t restaurant_tables,size_value bigint) RETURNS boolean LANGUAGE sql SET search_path FROM CURRENT AS $dg$
 SELECT t.enabled=1 AND size_value BETWEEN t.min_party_size AND t.capacity
$dg$;


CREATE OR REPLACE FUNCTION dg_native_dining_booking_clock(target text) RETURNS _dg_native_dining_booking_clocks LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT * FROM _dg_native_dining_booking_clocks WHERE reservation_id=target ORDER BY revision DESC LIMIT 1
$dg$;


CREATE OR REPLACE FUNCTION dg_native_dining_conflict(restaurant_value text,table_value text,start_value text,end_value text,party_value text DEFAULT NULL) RETURNS boolean LANGUAGE sql SET search_path FROM CURRENT AS $dg$
 SELECT EXISTS(SELECT 1 FROM dining_reservations b WHERE b.restaurant_id=restaurant_value AND b.table_id=table_value AND b.status IN('confirmed','checked_in') AND b.party_id IS DISTINCT FROM party_value AND b.starts_at<end_value AND b.ends_at>start_value)
$dg$;


CREATE OR REPLACE FUNCTION dg_native_dining_available(r restaurants,p dining_parties,t restaurant_tables,end_value text) RETURNS boolean LANGUAGE sql SET search_path FROM CURRENT AS $dg$
 SELECT dg_native_dining_fits(t,p.size) AND t.operation='open' AND t.restaurant_id=r.id AND NOT EXISTS(SELECT 1 FROM dining_occupancies o WHERE o.table_id=t.id AND o.state IN('held','seated')) AND NOT dg_native_dining_conflict(r.id,t.id,dg_native_dining_now(),end_value,p.id)
$dg$;


CREATE OR REPLACE FUNCTION dg_native_dining_touch(meta jsonb,action_value text,party_value text DEFAULT NULL,select_value boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s reception_sessions%ROWTYPE;
BEGIN
 IF meta->>'actorType'<>'guest' THEN RETURN;END IF;SELECT * INTO s FROM reception_sessions WHERE id=meta->>'sessionId' FOR UPDATE;
 PERFORM dg_native_dining_effect(action_value,'reception_sessions',s.id);PERFORM dg_native_reception_cancel(s.id);
 IF select_value THEN INSERT INTO _dg_native_dining_selection_revisions SELECT s.id,coalesce(max(version),0)+1,party_value,action_value,dg_native_dining_now() FROM _dg_native_dining_selection_revisions WHERE session_id=s.id;END IF;
 UPDATE reception_sessions SET dining_party_id=CASE WHEN select_value THEN party_value ELSE dining_party_id END,version=version+1,reply_epoch=reply_epoch+1,activity_at=dg_native_dining_now() WHERE id=s.id;
END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_dining_queue(r restaurants,action_value text) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE value bigint;
BEGIN PERFORM dg_native_dining_effect(action_value,'restaurants',r.id);UPDATE restaurants SET queue_counter=queue_counter+1,updated_at=dg_native_dining_now() WHERE id=r.id RETURNING queue_counter INTO value;RETURN value;END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_dining_menu_projection(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE r restaurants%ROWTYPE;i restaurant_menu_items%ROWTYPE;s restaurant_menu_skus%ROWTYPE;items jsonb:='[]';skus jsonb;reserved_value bigint;
BEGIN
 SELECT * INTO r FROM restaurants WHERE id=target;
 FOR i IN SELECT * FROM restaurant_menu_items WHERE restaurant_id=target AND listed=1 ORDER BY category,name,id LOOP
  skus:='[]';FOR s IN SELECT * FROM restaurant_menu_skus WHERE restaurant_id=target AND item_id=i.id AND archived=0 ORDER BY price_minor,id LOOP
   SELECT coalesce(sum(quantity),0) INTO reserved_value FROM restaurant_inventory_reservations WHERE sku_id=s.id AND status='reserved' AND tracked=1;
   skus:=skus||jsonb_build_array(jsonb_build_object('id',s.id,'name',s.name,'priceMinor',s.price_minor,'currency','CNY','portionPeople',s.portion_people,'version',s.version,'available',i.listed=1 AND s.on_sale=1 AND(s.stock_tracked=0 OR s.stock_remaining>0),'unavailableReason',CASE WHEN i.listed<>1 THEN '未上架' WHEN s.on_sale<>1 THEN '规格停售' WHEN s.stock_tracked=1 AND s.stock_remaining=0 THEN '已售罄' END));
  END LOOP;
  items:=items||jsonb_build_array(jsonb_build_object('id',i.id,'name',i.name,'category',i.category,'description',i.description,'ingredientTags',i.ingredient_tags::jsonb,'allergenTags',i.allergen_tags::jsonb,'mayContainTags',i.may_contain_tags::jsonb,'allergenInfoComplete',i.allergen_info_complete=1,'flavorTags',i.flavor_tags::jsonb,'spiceLevel',i.spice_level,'isNew',i.is_new=1,'listed',i.listed=1,'version',i.version,'skus',skus));
 END LOOP;RETURN jsonb_build_object('restaurantId',r.id,'version',r.menu_version,'items',items,'source','local','notice','菜单与库存来自当前本地服务器；真实POS未接入。价格和可供状态变动后需要重新核对。');
END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_dining_party_projection(target text,credential_value boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE p dining_parties%ROWTYPE;b dining_reservations%ROWTYPE;o dining_occupancies%ROWTYPE;t restaurant_tables%ROWTYPE;booking_value jsonb;occupancy_value jsonb;ahead_value bigint;
BEGIN
 SELECT * INTO p FROM dining_parties WHERE id=target;IF p.id IS NULL THEN PERFORM dg_native_dining_error('NOT_FOUND');END IF;
 SELECT * INTO b FROM dining_reservations WHERE party_id=p.id;IF b.id IS NOT NULL THEN SELECT * INTO t FROM restaurant_tables WHERE id=b.table_id;booking_value:=jsonb_build_object('id',b.id,'reference',b.reference,'tableId',b.table_id,'tableName',t.name,'startsAt',b.starts_at,'endsAt',b.ends_at,'status',b.status,'version',b.version);END IF;
 SELECT * INTO o FROM dining_occupancies WHERE party_id=p.id AND state IN('held','seated');IF o.id IS NOT NULL THEN SELECT * INTO t FROM restaurant_tables WHERE id=o.table_id;occupancy_value:=jsonb_build_object('id',o.id,'tableId',t.id,'tableName',t.name,'state',o.state,'version',o.version,'expiresAt',o.expires_at,'expectedEndAt',o.expected_end_at,'guide','请前往'||t.zone||'的'||t.name||'（'||t.code||'号），需要帮助时请联系店员。','x',t.x,'y',t.y,'width',t.width,'height',t.height);END IF;
 SELECT count(*) INTO ahead_value FROM dining_parties other WHERE other.restaurant_id=p.restaurant_id AND other.status IN('waiting','held') AND other.queue_number<p.queue_number;
 RETURN jsonb_build_object('id',p.id,'restaurantId',p.restaurant_id,'name',p.name,'size',p.size,'visitMinutes',p.visit_minutes,'guestNote',p.guest_note,'status',p.status,'version',p.version,'accessVersion',p.access_version,'queueNumber',p.queue_number,'ahead',ahead_value,'reservation',booking_value,'occupancy',occupancy_value,'preference',NULL,'claimCode',NULL,'createdAt',p.created_at,'endedAt',p.ended_at,'_claim',CASE WHEN credential_value AND p.status IN('waiting','reserved','held','seated') AND p.claim_expires_at>dg_native_dining_now() THEN jsonb_build_object('nonce',p.claim_nonce,'sha256',p.claim_hash,'expiresAt',p.claim_expires_at) END);
END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_dining_party_view(target text,session_value text DEFAULT NULL,token_hash_value text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;p dining_parties%ROWTYPE;
BEGIN meta:=dg_native_dining_context('party',target,session_value,token_hash_value);SELECT * INTO p FROM dining_parties WHERE id=target;RETURN dg_native_dining_party_projection(target,session_value IS NOT NULL OR p.owner_session_id IS NULL);END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_dining_parties(target text,kind_value text,cursor_value text,limit_value integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;result jsonb:='[]';row_value record;cursor_sort text;
BEGIN
 meta:=dg_native_dining_context('restaurant',target);IF kind_value NOT IN('queue','reservations','history') OR limit_value NOT BETWEEN 1 AND 101 THEN PERFORM dg_native_dining_error('VALIDATION_FAILED');END IF;
 IF cursor_value<>'' THEN
  SELECT CASE WHEN kind_value='queue' THEN lpad(p.queue_number::text,20,'0') WHEN kind_value='reservations' THEN b.starts_at ELSE p.ended_at END INTO cursor_sort FROM dining_parties p LEFT JOIN dining_reservations b ON b.party_id=p.id WHERE p.id=cursor_value AND p.restaurant_id=target AND(CASE kind_value WHEN 'queue' THEN p.status IN('waiting','held','seated') WHEN 'reservations' THEN b.status IN('confirmed','checked_in','seated') AND p.status IN('reserved','waiting','held','seated') ELSE p.status IN('cancelled','completed','no_show') END);
  IF cursor_sort IS NULL THEN PERFORM dg_native_dining_error('CURSOR_CHANGED');END IF;
 END IF;
 FOR row_value IN SELECT * FROM(SELECT p.id,CASE WHEN kind_value='queue' THEN lpad(p.queue_number::text,20,'0') WHEN kind_value='reservations' THEN b.starts_at ELSE p.ended_at END sort FROM dining_parties p JOIN _dg_native_dining_party_origins origin ON origin.party_id=p.id LEFT JOIN dining_reservations b ON b.party_id=p.id WHERE p.restaurant_id=target AND(CASE kind_value WHEN 'queue' THEN p.status IN('waiting','held','seated') WHEN 'reservations' THEN b.status IN('confirmed','checked_in','seated') AND p.status IN('reserved','waiting','held','seated') ELSE p.status IN('cancelled','completed','no_show') END)) selected WHERE cursor_value='' OR selected.sort>cursor_sort OR selected.sort=cursor_sort AND selected.id>cursor_value ORDER BY selected.sort,selected.id LIMIT limit_value LOOP result:=result||jsonb_build_array(dg_native_dining_party_projection(row_value.id,false));END LOOP;RETURN result;
END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_dining_table_projection(target text,guest_value boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE t restaurant_tables%ROWTYPE;o dining_occupancies%ROWTYPE;
BEGIN
 SELECT * INTO t FROM restaurant_tables WHERE id=target;SELECT * INTO o FROM dining_occupancies WHERE table_id=target AND state IN('held','seated');
 RETURN jsonb_build_object('id',t.id,'restaurantId',t.restaurant_id,'code',t.code,'name',t.name,'capacity',t.capacity,'minPartySize',t.min_party_size,'zone',t.zone,'x',t.x,'y',t.y,'width',t.width,'height',t.height,'enabled',t.enabled=1,'operation',t.operation,'state',CASE WHEN t.enabled<>1 THEN 'disabled' WHEN t.operation='cleaning' THEN 'cleaning' WHEN t.operation='blocked' THEN 'blocked' WHEN o.id IS NOT NULL THEN o.state ELSE 'available' END,'version',t.version,'partyId',CASE WHEN NOT guest_value THEN o.party_id END,'holdExpiresAt',CASE WHEN o.state='held' THEN o.expires_at END,'expectedEndAt',o.expected_end_at);
END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_dining_plan_projection(target text,meta jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE plan dining_hold_plans%ROWTYPE;p dining_parties%ROWTYPE;r restaurants%ROWTYPE;t restaurant_tables%ROWTYPE;a _dg_native_dining_actions%ROWTYPE;reason text;alternatives jsonb;
BEGIN
 SELECT * INTO plan FROM dining_hold_plans WHERE id=target;SELECT action.* INTO a FROM _dg_native_dining_plan_origins origin JOIN _dg_native_dining_actions action ON action.id=origin.action_id WHERE origin.plan_id=target;
 IF plan.id IS NULL OR a.actor_id IS DISTINCT FROM meta->>'actorId' OR a.session_id IS DISTINCT FROM meta->>'sessionId' OR a.access_id IS DISTINCT FROM meta->>'accessId' OR a.actor_epoch IS DISTINCT FROM(meta->>'actorEpoch')::bigint OR a.grant_version IS DISTINCT FROM(meta->>'grantVersion')::bigint THEN PERFORM dg_native_dining_error('AUTHORIZATION_CHANGED');END IF;
 p:=dg_native_dining_owned(meta,plan.party_id);SELECT * INTO r FROM restaurants WHERE id=p.restaurant_id;SELECT * INTO t FROM restaurant_tables WHERE id=plan.table_id;
 reason:=CASE WHEN plan.expires_at<=dg_native_dining_now() THEN '方案已超过原30秒期限，请重新查看。' WHEN plan.focus_version IS DISTINCT FROM(meta->>'focusVersion')::bigint THEN '本次发问人已变化，请重新核对。' WHEN (SELECT selection_version FROM _dg_native_dining_plan_origins WHERE plan_id=plan.id) IS DISTINCT FROM(meta->>'selectionVersion')::bigint THEN '当前就餐问答对象已变化，请重新核对。' WHEN p.version<>plan.party_version OR p.status<>'waiting' THEN '本组人数或安排已变化，请重新查看。' WHEN r.version<>plan.restaurant_version OR t.version<>plan.table_version OR NOT dg_native_dining_available(r,p,t,plan.expected_end_at) THEN '门店、桌位或预约条件已变化。' WHEN EXISTS(SELECT 1 FROM _dg_native_dining_occupancy_origins WHERE plan_id=plan.id) THEN '此方案已经使用，请核对当前安排。' END;
 SELECT coalesce(jsonb_agg(dg_native_dining_table_projection(candidate.id,meta->>'actorType'='guest') ORDER BY candidate.capacity,candidate.code,candidate.id),'[]') INTO alternatives FROM(SELECT * FROM restaurant_tables candidate WHERE candidate.restaurant_id=r.id AND candidate.id<>t.id AND dg_native_dining_available(r,p,candidate,plan.expected_end_at) ORDER BY candidate.capacity,candidate.code,candidate.id LIMIT 20) candidate;
 RETURN jsonb_build_object('id',plan.id,'hash',plan.hash,'valid',reason IS NULL,'invalidReason',reason,'partyId',p.id,'partyVersion',plan.party_version,'table',dg_native_dining_table_projection(t.id,meta->>'actorType'='guest'),'expectedEndAt',plan.expected_end_at,'expiresAt',plan.expires_at,'alternatives',alternatives,'notice','方案原30秒内有效；预留后仍需确认实际入座。预计结束时间不会自动释放正在就餐的桌位。');
END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_dining_action_result(target text,session_value text DEFAULT NULL,token_hash_value text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE a _dg_native_dining_actions%ROWTYPE;meta jsonb;p dining_parties%ROWTYPE;
BEGIN
 SELECT * INTO a FROM _dg_native_dining_actions WHERE id=target;IF a.id IS NULL OR a.actor_type='worker' THEN PERFORM dg_native_dining_error('NOT_FOUND');END IF;
 meta:=dg_native_dining_context(CASE WHEN a.resource_type='plan' THEN 'plan' ELSE 'party' END,a.resource_id,session_value,token_hash_value);
 IF a.actor_id IS DISTINCT FROM meta->>'actorId' OR a.actor_type IS DISTINCT FROM meta->>'actorType' OR a.session_id IS DISTINCT FROM meta->>'sessionId' OR a.access_id IS DISTINCT FROM meta->>'accessId' OR a.actor_epoch IS DISTINCT FROM(meta->>'actorEpoch')::bigint OR a.grant_version IS DISTINCT FROM(meta->>'grantVersion')::bigint OR a.focus_version IS DISTINCT FROM(meta->>'focusVersion')::bigint OR a.selection_version IS DISTINCT FROM(meta->>'selectionVersion')::bigint THEN PERFORM dg_native_dining_error('AUTHORIZATION_CHANGED');END IF;
 IF a.resource_type='plan' THEN RETURN dg_native_dining_plan_projection(a.resource_id,meta);END IF;
 SELECT * INTO p FROM dining_parties WHERE id=a.resource_id;RETURN dg_native_dining_party_projection(p.id,session_value IS NOT NULL OR p.owner_session_id IS NULL);
END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_dining_guest_view(target text,token_hash_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;s reception_sessions%ROWTYPE;r restaurants%ROWTYPE;parties_value jsonb;restaurant_value jsonb;
BEGIN
 meta:=dg_native_dining_context('restaurant',(SELECT restaurant_id FROM _dg_native_dining_session_origins WHERE session_id=target),target,token_hash_value);SELECT * INTO s FROM reception_sessions WHERE id=target;SELECT * INTO r FROM restaurants WHERE id=meta->>'restaurantId';
 SELECT coalesce(jsonb_agg(dg_native_dining_party_projection(p.id,true) ORDER BY p.created_at,p.id),'[]') INTO parties_value FROM dining_parties p JOIN _dg_native_dining_party_origins origin ON origin.party_id=p.id WHERE p.owner_session_id=target AND p.restaurant_id=r.id;
 restaurant_value:=jsonb_build_object('id',r.id,'name',r.name,'timezone',r.timezone,'publicGuide',r.public_guide,'holdSeconds',r.hold_seconds,'visitMinutes',r.visit_minutes,'lateMinutes',r.late_minutes,'acceptingGuests',r.accepting_guests=1,'openingWindows',r.opening_windows::jsonb,'version',r.version,'menuVersion',r.menu_version,'dataSource','local','businessConnected',false,'capabilities',jsonb_build_object('seating',true,'ordering',false,'payments',false,'hospitality',false,'terminals',true,'sourceDirectory',true,'preferences',false));
 RETURN jsonb_build_object('restaurant',restaurant_value,'parties',parties_value,'menu',dg_native_dining_menu_projection(r.id),'selectedPartyId',CASE WHEN EXISTS(SELECT 1 FROM dining_parties p WHERE p.id=s.dining_party_id AND p.owner_session_id=s.id) THEN s.dining_party_id END,'focusVersion',s.focus_version,'selectionVersion',(meta->>'selectionVersion')::bigint,'automatic',s.status='active');
END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_dining_assert_open(r restaurants,start_value text,end_value text) RETURNS void LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN IF NOT dg_native_dining_open_interval(r,start_value,end_value) THEN PERFORM dg_native_dining_error('RESTAURANT_CLOSED');END IF;END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_dining_ticket_fields(input jsonb,party_value text) RETURNS void LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
 PERFORM dg_native_restaurant_fields(input,ARRAY['partyId','nonce','sha256']);
 IF input->>'partyId' IS DISTINCT FROM party_value OR party_value!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' OR coalesce(input->>'nonce','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' OR coalesce(input->>'sha256','')!~'^[a-f0-9]{64}$' THEN PERFORM dg_native_dining_error('VALIDATION_FAILED');END IF;
END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_dining_new_party(meta jsonb,action_value text,body jsonb,ticket jsonb,reserved_value boolean DEFAULT false,deadline_value text DEFAULT NULL) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE r restaurants%ROWTYPE;party_value text:=ticket->>'partyId';created text:=dg_native_dining_now();queue_value bigint;
BEGIN
 SELECT * INTO r FROM restaurants WHERE id=meta->>'restaurantId';PERFORM dg_native_dining_fields(body);PERFORM dg_native_dining_ticket_fields(ticket,party_value);
 IF r.accepting_guests<>1 THEN PERFORM dg_native_dining_error('NOT_ACCEPTING_GUESTS');END IF;
 IF(SELECT count(*) FROM dining_parties WHERE restaurant_id=r.id AND status IN('waiting','reserved','held','seated'))>=1000 THEN PERFORM dg_native_dining_error('PARTY_LIMIT');END IF;
 IF meta->>'actorType'='guest' AND(SELECT count(*) FROM dining_parties WHERE restaurant_id=r.id AND owner_session_id=meta->>'sessionId' AND status IN('waiting','reserved','held','seated'))>=5 THEN PERFORM dg_native_dining_error('PARTY_LIMIT');END IF;
 IF NOT reserved_value THEN PERFORM dg_native_dining_assert_open(r,created,dg_native_people_iso(created::timestamptz+interval '1 minute'));queue_value:=dg_native_dining_queue(r,action_value);END IF;
 PERFORM dg_native_dining_effect(action_value,'dining_parties',party_value);
 INSERT INTO dining_parties(id,restaurant_id,owner_session_id,created_focus_version,actor_id,name,size,visit_minutes,guest_note,status,queue_number,queued_at,claim_nonce,claim_hash,claim_expires_at,created_at,updated_at) VALUES(party_value,r.id,meta->>'sessionId',(meta->>'focusVersion')::bigint,meta->>'actorId',btrim(body->>'name'),(body->>'size')::bigint,(body->>'visitMinutes')::bigint,body->>'guestNote',CASE WHEN reserved_value THEN 'reserved' ELSE 'waiting' END,queue_value,CASE WHEN NOT reserved_value THEN created END,ticket->>'nonce',ticket->>'sha256',coalesce(deadline_value,dg_native_people_iso(created::timestamptz+interval '24 hours')),created,created);
 INSERT INTO _dg_native_dining_party_origins VALUES(party_value,r.id,(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1),r.tenant_id,r.workspace_id,created,pg_current_xact_id()::text);RETURN party_value;
END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_dining_booking_table(r restaurants,input jsonb,party_value text DEFAULT NULL) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE start_value text:=dg_native_dining_iso(input->>'startsAt');end_value text:=dg_native_dining_iso(input->>'endsAt');t restaurant_tables%ROWTYPE;o dining_occupancies%ROWTYPE;now_value text:=dg_native_dining_now();
BEGIN
 PERFORM dg_native_dining_fields(input->'party');
 IF start_value<dg_native_people_iso(clock_timestamp()-interval '1 minute') OR start_value>dg_native_people_iso(clock_timestamp()+interval '366 days') OR end_value<=dg_native_people_iso(clock_timestamp()+interval '1 minute') THEN PERFORM dg_native_dining_error('INVALID_BOOKING_TIME');END IF;
 PERFORM dg_native_dining_assert_open(r,start_value,end_value);
 IF input->>'tableId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM restaurant_tables WHERE id=input->>'tableId' AND restaurant_id=r.id) THEN PERFORM dg_native_dining_error('NOT_FOUND');END IF;
 FOR t IN SELECT * FROM restaurant_tables WHERE restaurant_id=r.id AND(input->>'tableId' IS NULL OR id=input->>'tableId') ORDER BY capacity,code,id LOOP
  IF NOT dg_native_dining_fits(t,(input->'party'->>'size')::bigint) OR t.operation='blocked' OR dg_native_dining_conflict(r.id,t.id,start_value,end_value,party_value) THEN CONTINUE;END IF;
  SELECT * INTO o FROM dining_occupancies WHERE table_id=t.id AND state IN('held','seated');
  IF o.id IS NOT NULL AND o.party_id IS DISTINCT FROM party_value AND start_value<greatest(dg_native_people_iso(clock_timestamp()+interval '1 minute'),o.expected_end_at) AND end_value>least(now_value,o.expected_end_at) THEN CONTINUE;END IF;RETURN t.id;
 END LOOP;PERFORM dg_native_dining_error('NO_RESERVATION_TABLE');RETURN NULL;
END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_dining_table_touch(action_value text,target text,cleaning_value boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN PERFORM dg_native_dining_effect(action_value,'restaurant_tables',target);UPDATE restaurant_tables SET version=version+1,operation=CASE WHEN cleaning_value THEN 'cleaning' ELSE operation END WHERE id=target;END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_dining_plan(meta jsonb,p dining_parties,table_value text,action_value text,plan_value text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE r restaurants%ROWTYPE;b dining_reservations%ROWTYPE;t restaurant_tables%ROWTYPE;end_value text;expires_value text:=dg_native_people_iso(clock_timestamp()+interval '30 seconds');body jsonb;hash_value text;
BEGIN
 IF p.status<>'waiting' THEN PERFORM dg_native_dining_error('PARTY_NOT_WAITING');END IF;SELECT * INTO r FROM restaurants WHERE id=p.restaurant_id;SELECT * INTO b FROM dining_reservations WHERE party_id=p.id;
 end_value:=dg_native_people_iso(clock_timestamp()+make_interval(mins=>p.visit_minutes::integer));IF b.status='checked_in' THEN end_value:=least(end_value,b.ends_at);END IF;
 IF end_value<=dg_native_people_iso(clock_timestamp()+interval '1 minute') THEN PERFORM dg_native_dining_error('DINING_SLOT_ENDING');END IF;PERFORM dg_native_dining_assert_open(r,dg_native_dining_now(),end_value);
 IF(SELECT count(*) FROM dining_hold_plans WHERE party_id=p.id AND created_at>=dg_native_people_iso(clock_timestamp()-interval '5 minutes'))>=20 THEN PERFORM dg_native_dining_error('RATE_LIMITED');END IF;
 SELECT candidate.* INTO t FROM restaurant_tables candidate WHERE candidate.restaurant_id=r.id AND(table_value IS NULL OR candidate.id=table_value) AND dg_native_dining_available(r,p,candidate,end_value) ORDER BY candidate.capacity,candidate.code,candidate.id LIMIT 1;
 IF t.id IS NULL THEN PERFORM dg_native_dining_error('NO_TABLE_AVAILABLE');END IF;
 body:=jsonb_build_object('id',plan_value,'restaurantId',r.id,'partyId',p.id,'partyVersion',p.version,'tableId',t.id,'tableVersion',t.version,'restaurantVersion',r.version,'actorId',meta->>'actorId','sessionId',meta->>'sessionId','accessId',meta->>'accessId','focusVersion',meta->'focusVersion','expectedEndAt',end_value,'expiresAt',expires_value);hash_value:=dg_native_office_hash(body);
 PERFORM dg_native_dining_effect(action_value,'dining_hold_plans',plan_value);INSERT INTO dining_hold_plans VALUES(plan_value,r.id,p.id,p.version,t.id,t.version,r.version,meta->>'actorId',(meta->>'focusVersion')::bigint,end_value,expires_value,hash_value,dg_native_dining_now());INSERT INTO _dg_native_dining_plan_origins VALUES(plan_value,action_value,(meta->>'selectionVersion')::bigint);
END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_dining_apply(kind_value text,target text,action_value text,input jsonb,session_value text DEFAULT NULL,token_hash_value text DEFAULT NULL,csrf_hash_value text DEFAULT NULL,focus_value bigint DEFAULT NULL) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;body jsonb:=input-ARRAY['confirmed','focusVersion','selectionVersion'];r restaurants%ROWTYPE;p dining_parties%ROWTYPE;b dining_reservations%ROWTYPE;o dining_occupancies%ROWTYPE;t restaurant_tables%ROWTYPE;plan dining_hold_plans%ROWTYPE;booking_clock _dg_native_dining_booking_clocks%ROWTYPE;action_id text;resource_value text;party_value text;table_value text;previous_table text;now_value text:=dg_native_dining_now();start_value text;end_value text;counter_value bigint;version_value bigint;party_version bigint;projection jsonb;old_owner reception_sessions%ROWTYPE;
BEGIN
 IF action_value NOT IN('create','reserve','update','reschedule','check_in','plan','hold','seat','release','cancel','finish','select','claim') THEN PERFORM dg_native_dining_error('VALIDATION_FAILED');END IF;
 IF jsonb_typeof(input)<>'object' OR action_value<>'plan' AND input->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN PERFORM dg_native_dining_error('VALIDATION_FAILED');END IF;
 meta:=dg_native_dining_context(kind_value,target,session_value,token_hash_value,csrf_hash_value,focus_value,true);SELECT * INTO r FROM restaurants WHERE id=meta->>'restaurantId';now_value:=dg_native_dining_now();
 IF session_value IS NOT NULL AND dg_native_restaurant_integer(input->'selectionVersion',0,9007199254740991)<>(meta->>'selectionVersion')::bigint THEN PERFORM dg_native_dining_error('VERSION_CONFLICT');END IF;
 IF meta->>'partyId' IS NOT NULL THEN p:=dg_native_dining_owned(meta,meta->>'partyId');END IF;
 IF session_value IS NOT NULL AND p.id IS NOT NULL AND action_value<>'select' AND NOT EXISTS(SELECT 1 FROM reception_sessions WHERE id=session_value AND dining_party_id=p.id) THEN PERFORM dg_native_dining_error('VERSION_CONFLICT');END IF;
 IF action_value IN('create','reserve') THEN party_value:=body->'_ticket'->>'partyId';resource_value:=party_value;
 ELSIF action_value='plan' THEN resource_value:=gen_random_uuid()::text;party_value:=p.id;
 ELSIF action_value='claim' THEN party_value:=body->>'partyId';resource_value:=party_value;
 ELSE party_value:=p.id;resource_value:=party_value;END IF;
 IF resource_value IS NULL THEN PERFORM dg_native_dining_error('VALIDATION_FAILED');END IF;
 action_id:=dg_native_dining_action(meta,action_value,CASE WHEN action_value='plan' THEN 'plan' ELSE 'party' END,resource_value,body);
 IF action_value IN('update','cancel','finish','select','plan','reschedule','check_in','seat','release') THEN version_value:=dg_native_restaurant_integer(body->'version',1,9007199254740991);END IF;
 CASE action_value
 WHEN 'create' THEN
  IF kind_value<>'restaurant' THEN PERFORM dg_native_dining_error('VALIDATION_FAILED');END IF;PERFORM dg_native_restaurant_fields(body,ARRAY['name','size','visitMinutes','guestNote','_ticket']);PERFORM dg_native_dining_new_party(meta,action_id,body-'_ticket',body->'_ticket');PERFORM dg_native_dining_touch(meta,action_id,party_value,true);
 WHEN 'reserve' THEN
  IF kind_value<>'restaurant' THEN PERFORM dg_native_dining_error('VALIDATION_FAILED');END IF;PERFORM dg_native_restaurant_fields(body,ARRAY['party','tableId','startsAt','endsAt','_ticket']);table_value:=dg_native_dining_booking_table(r,body);start_value:=dg_native_dining_iso(body->>'startsAt');end_value:=dg_native_dining_iso(body->>'endsAt');PERFORM dg_native_dining_new_party(meta,action_id,body->'party',body->'_ticket',true,dg_native_people_iso(end_value::timestamptz+interval '24 hours'));
  PERFORM dg_native_dining_effect(action_id,'restaurants',r.id);UPDATE restaurants SET booking_counter=booking_counter+1,updated_at=now_value WHERE id=r.id RETURNING booking_counter INTO counter_value;
  b.id:=gen_random_uuid()::text;PERFORM dg_native_dining_effect(action_id,'dining_reservations',b.id);INSERT INTO dining_reservations(id,restaurant_id,party_id,table_id,reference,starts_at,ends_at,created_at) VALUES(b.id,r.id,party_value,table_value,'R-'||CASE WHEN length(counter_value::text)<6 THEN lpad(counter_value::text,6,'0') ELSE counter_value::text END,start_value,end_value,now_value);INSERT INTO _dg_native_dining_booking_clocks VALUES(b.id,1,start_value,end_value,dg_native_people_iso(start_value::timestamptz-interval '30 minutes'),dg_native_people_iso(start_value::timestamptz+make_interval(mins=>r.late_minutes::integer)),action_id,now_value);PERFORM dg_native_dining_table_touch(action_id,table_value);PERFORM dg_native_dining_touch(meta,action_id,party_value,true);
 WHEN 'update' THEN
  PERFORM dg_native_restaurant_fields(body,ARRAY['name','size','visitMinutes','guestNote','version']);PERFORM dg_native_dining_fields(body-'version');IF p.version<>version_value THEN PERFORM dg_native_dining_error('VERSION_CONFLICT');END IF;IF p.status NOT IN('waiting','reserved') THEN PERFORM dg_native_dining_error('PARTY_ALREADY_ASSIGNED');END IF;
  SELECT * INTO b FROM dining_reservations WHERE party_id=p.id AND status IN('confirmed','checked_in');IF b.id IS NOT NULL THEN SELECT * INTO t FROM restaurant_tables WHERE id=b.table_id;IF NOT dg_native_dining_fits(t,(body->>'size')::bigint) THEN PERFORM dg_native_dining_error('BOOKING_CAPACITY');END IF;END IF;
  PERFORM dg_native_dining_effect(action_id,'dining_parties',p.id);UPDATE dining_parties SET name=btrim(body->>'name'),size=(body->>'size')::bigint,visit_minutes=(body->>'visitMinutes')::bigint,guest_note=body->>'guestNote',version=version+1,updated_at=now_value WHERE id=p.id;PERFORM dg_native_dining_touch(meta,action_id);
 WHEN 'reschedule' THEN
  PERFORM dg_native_restaurant_fields(body,ARRAY['party','tableId','startsAt','endsAt','version','partyVersion','_ticket']);SELECT * INTO b FROM dining_reservations WHERE id=target;party_version:=dg_native_restaurant_integer(body->'partyVersion',1,9007199254740991);
  IF b.version<>version_value OR p.version<>party_version THEN PERFORM dg_native_dining_error('VERSION_CONFLICT');END IF;IF b.status<>'confirmed' OR p.status<>'reserved' THEN PERFORM dg_native_dining_error('BOOKING_LOCKED');END IF;previous_table:=b.table_id;table_value:=dg_native_dining_booking_table(r,body,p.id);start_value:=dg_native_dining_iso(body->>'startsAt');end_value:=dg_native_dining_iso(body->>'endsAt');
  PERFORM dg_native_dining_ticket_fields(body->'_ticket',p.id);PERFORM dg_native_dining_effect(action_id,'dining_reservations',b.id);UPDATE dining_reservations SET table_id=table_value,starts_at=start_value,ends_at=end_value,version=version+1 WHERE id=b.id;PERFORM dg_native_dining_effect(action_id,'dining_parties',p.id);UPDATE dining_parties SET name=btrim(body->'party'->>'name'),size=(body->'party'->>'size')::bigint,visit_minutes=(body->'party'->>'visitMinutes')::bigint,guest_note=body->'party'->>'guestNote',claim_nonce=body->'_ticket'->>'nonce',claim_hash=body->'_ticket'->>'sha256',claim_expires_at=dg_native_people_iso(end_value::timestamptz+interval '24 hours'),access_version=access_version+1,version=version+1,updated_at=now_value WHERE id=p.id;
  INSERT INTO _dg_native_dining_booking_clocks VALUES(b.id,b.version+1,start_value,end_value,dg_native_people_iso(start_value::timestamptz-interval '30 minutes'),dg_native_people_iso(start_value::timestamptz+make_interval(mins=>r.late_minutes::integer)),action_id,now_value);PERFORM dg_native_dining_table_touch(action_id,previous_table);IF previous_table<>table_value THEN PERFORM dg_native_dining_table_touch(action_id,table_value);END IF;PERFORM dg_native_dining_touch(meta,action_id);
 WHEN 'check_in' THEN
  PERFORM dg_native_restaurant_fields(body,ARRAY['version']);SELECT * INTO b FROM dining_reservations WHERE id=target;IF b.version<>version_value THEN PERFORM dg_native_dining_error('VERSION_CONFLICT');END IF;
  booking_clock:=dg_native_dining_booking_clock(b.id);IF b.status<>'confirmed' OR p.status<>'reserved' OR booking_clock.reservation_id IS NULL OR now_value<booking_clock.checkin_opens_at OR now_value>booking_clock.late_deadline THEN PERFORM dg_native_dining_error('CHECK_IN_WINDOW');END IF;
  PERFORM dg_native_dining_effect(action_id,'dining_reservations',b.id);UPDATE dining_reservations SET status='checked_in',version=version+1 WHERE id=b.id;counter_value:=dg_native_dining_queue(r,action_id);PERFORM dg_native_dining_effect(action_id,'dining_parties',p.id);UPDATE dining_parties SET status='waiting',queue_number=counter_value,queued_at=now_value,version=version+1,updated_at=now_value WHERE id=p.id;PERFORM dg_native_dining_table_touch(action_id,b.table_id);PERFORM dg_native_dining_touch(meta,action_id);
 WHEN 'plan' THEN
  PERFORM dg_native_restaurant_fields(body,ARRAY['partyId','version','tableId']);IF body->>'partyId' IS DISTINCT FROM p.id OR p.version<>version_value THEN PERFORM dg_native_dining_error('VERSION_CONFLICT');END IF;PERFORM dg_native_dining_plan(meta,p,body->>'tableId',action_id,resource_value);PERFORM dg_native_dining_touch(meta,action_id);
 WHEN 'hold' THEN
  PERFORM dg_native_restaurant_fields(body,ARRAY['planId','planHash']);SELECT * INTO plan FROM dining_hold_plans WHERE id=target;IF body->>'planId' IS DISTINCT FROM plan.id OR body->>'planHash' IS DISTINCT FROM plan.hash THEN PERFORM dg_native_dining_error('TABLE_PLAN_CHANGED');END IF;projection:=dg_native_dining_plan_projection(plan.id,meta);IF projection->'valid' IS DISTINCT FROM 'true'::jsonb THEN PERFORM dg_native_dining_error('TABLE_PLAN_CHANGED');END IF;PERFORM dg_native_dining_assert_open(r,now_value,plan.expected_end_at);
  o.id:=gen_random_uuid()::text;PERFORM dg_native_dining_effect(action_id,'dining_occupancies',o.id);INSERT INTO dining_occupancies(id,restaurant_id,table_id,party_id,state,expires_at,expected_end_at,actor_id,created_at,updated_at) VALUES(o.id,r.id,plan.table_id,p.id,'held',least(dg_native_people_iso(now_value::timestamptz+make_interval(secs=>r.hold_seconds::double precision)),plan.expected_end_at),plan.expected_end_at,meta->>'actorId',now_value,now_value);INSERT INTO _dg_native_dining_occupancy_origins VALUES(o.id,plan.id,action_id);PERFORM dg_native_dining_effect(action_id,'dining_parties',p.id);UPDATE dining_parties SET status='held',version=version+1,updated_at=now_value WHERE id=p.id;PERFORM dg_native_dining_table_touch(action_id,plan.table_id);PERFORM dg_native_dining_touch(meta,action_id);
 WHEN 'seat','release' THEN
  PERFORM dg_native_restaurant_fields(body,ARRAY['version','partyVersion','_ticket']);SELECT * INTO o FROM dining_occupancies WHERE id=target;party_version:=dg_native_restaurant_integer(body->'partyVersion',1,9007199254740991);IF o.version<>version_value OR p.version<>party_version THEN PERFORM dg_native_dining_error('VERSION_CONFLICT');END IF;
  IF o.state<>'held' OR o.expires_at IS NULL OR o.expires_at<=now_value OR p.status<>'held' THEN PERFORM dg_native_dining_error('HOLD_EXPIRED');END IF;SELECT * INTO t FROM restaurant_tables WHERE id=o.table_id;
  PERFORM dg_native_dining_effect(action_id,'dining_occupancies',o.id);PERFORM dg_native_dining_effect(action_id,'dining_parties',p.id);
  IF action_value='release' THEN UPDATE dining_occupancies SET state='released',version=version+1,updated_at=now_value WHERE id=o.id;UPDATE dining_parties SET status='waiting',version=version+1,updated_at=now_value WHERE id=p.id;
  ELSE
   IF t.operation<>'open' OR NOT dg_native_dining_fits(t,p.size) OR dg_native_dining_conflict(r.id,t.id,now_value,o.expected_end_at,p.id) THEN PERFORM dg_native_dining_error('TABLE_CHANGED');END IF;PERFORM dg_native_dining_assert_open(r,now_value,o.expected_end_at);PERFORM dg_native_dining_ticket_fields(body->'_ticket',p.id);
   UPDATE dining_occupancies SET state='seated',expires_at=NULL,version=version+1,updated_at=now_value WHERE id=o.id;UPDATE dining_parties SET status='seated',seated_at=now_value,version=version+1,access_version=access_version+1,claim_nonce=body->'_ticket'->>'nonce',claim_hash=body->'_ticket'->>'sha256',updated_at=now_value WHERE id=p.id;
   SELECT * INTO b FROM dining_reservations WHERE party_id=p.id AND status='checked_in';IF b.id IS NOT NULL THEN PERFORM dg_native_dining_effect(action_id,'dining_reservations',b.id);UPDATE dining_reservations SET status='seated',version=version+1 WHERE id=b.id;END IF;
  END IF;PERFORM dg_native_dining_table_touch(action_id,t.id);PERFORM dg_native_dining_touch(meta,action_id);
 WHEN 'cancel','finish' THEN
  PERFORM dg_native_restaurant_fields(body,ARRAY['version']);IF p.version<>version_value THEN PERFORM dg_native_dining_error('VERSION_CONFLICT');END IF;
  IF p.status NOT IN('waiting','reserved','held','seated') THEN PERFORM dg_native_dining_error('PARTY_ENDED');END IF;
  IF action_value='cancel' AND p.status='seated' THEN PERFORM dg_native_dining_error('PARTY_SEATED');END IF;
  IF action_value='finish' AND(meta->>'actorType'<>'staff' OR p.status<>'seated') THEN PERFORM dg_native_dining_error('FORBIDDEN');END IF;
  IF EXISTS(SELECT 1 FROM restaurant_orders WHERE party_id=p.id) THEN PERFORM dg_native_dining_error('FINANCIAL_PENDING');END IF;
  SELECT * INTO o FROM dining_occupancies WHERE party_id=p.id AND state IN('held','seated');IF o.id IS NOT NULL THEN PERFORM dg_native_dining_effect(action_id,'dining_occupancies',o.id);UPDATE dining_occupancies SET state='released',version=version+1,updated_at=now_value WHERE id=o.id;PERFORM dg_native_dining_table_touch(action_id,o.table_id,action_value='finish');END IF;
  SELECT * INTO b FROM dining_reservations WHERE party_id=p.id AND status IN('confirmed','checked_in','seated');IF b.id IS NOT NULL THEN PERFORM dg_native_dining_effect(action_id,'dining_reservations',b.id);UPDATE dining_reservations SET status=CASE WHEN action_value='finish' THEN 'completed' ELSE 'cancelled' END,version=version+1 WHERE id=b.id;IF o.id IS NULL OR o.table_id<>b.table_id THEN PERFORM dg_native_dining_table_touch(action_id,b.table_id);END IF;END IF;
  PERFORM dg_native_dining_effect(action_id,'dining_parties',p.id);UPDATE dining_parties SET status=CASE WHEN action_value='finish' THEN 'completed' ELSE 'cancelled' END,version=version+1,access_version=access_version+1,ended_at=now_value,updated_at=now_value WHERE id=p.id;PERFORM dg_native_dining_touch(meta,action_id);
 WHEN 'select' THEN
  PERFORM dg_native_restaurant_fields(body,ARRAY['version']);IF meta->>'actorType'<>'guest' THEN PERFORM dg_native_dining_error('FORBIDDEN');END IF;IF p.version<>version_value THEN PERFORM dg_native_dining_error('VERSION_CONFLICT');END IF;IF p.status NOT IN('waiting','reserved','held','seated') THEN PERFORM dg_native_dining_error('PARTY_ENDED');END IF;PERFORM dg_native_dining_touch(meta,action_id,p.id,true);
 WHEN 'claim' THEN
  PERFORM dg_native_restaurant_fields(body,ARRAY['partyId','version','codeHash','_ticket']);IF meta->>'actorType'<>'guest' THEN PERFORM dg_native_dining_error('FORBIDDEN');END IF;SELECT * INTO p FROM dining_parties WHERE id=body->>'partyId' FOR UPDATE;
  IF p.id IS NULL OR p.restaurant_id<>r.id OR NOT EXISTS(SELECT 1 FROM _dg_native_dining_party_origins WHERE party_id=p.id) OR p.status NOT IN('waiting','reserved','held','seated') OR p.claim_expires_at<=now_value OR p.claim_hash IS DISTINCT FROM body->>'codeHash' OR p.version::text IS DISTINCT FROM body->>'version' THEN PERFORM dg_native_dining_error('INVALID_DINING_CLAIM');END IF;
  IF p.owner_session_id IS DISTINCT FROM session_value AND(SELECT count(*) FROM dining_parties WHERE owner_session_id=session_value AND restaurant_id=r.id AND status IN('waiting','reserved','held','seated'))>=5 THEN PERFORM dg_native_dining_error('PARTY_LIMIT');END IF;PERFORM dg_native_dining_ticket_fields(body->'_ticket',p.id);
  SELECT * INTO old_owner FROM reception_sessions WHERE id=p.owner_session_id;IF old_owner.id IS NOT NULL AND old_owner.id<>session_value AND old_owner.status IN('active','human') AND old_owner.dining_party_id=p.id THEN PERFORM dg_native_dining_effect(action_id,'reception_sessions',old_owner.id);PERFORM dg_native_reception_cancel(old_owner.id);INSERT INTO _dg_native_dining_selection_revisions SELECT old_owner.id,coalesce(max(version),0)+1,NULL,action_id,now_value FROM _dg_native_dining_selection_revisions WHERE session_id=old_owner.id;UPDATE reception_sessions SET dining_party_id=NULL,version=version+1,reply_epoch=reply_epoch+1 WHERE id=old_owner.id;END IF;
  PERFORM dg_native_dining_effect(action_id,'dining_parties',p.id);UPDATE dining_parties SET owner_session_id=session_value,created_focus_version=focus_value,version=version+1,access_version=access_version+1,claim_nonce=body->'_ticket'->>'nonce',claim_hash=body->'_ticket'->>'sha256',updated_at=now_value WHERE id=p.id;PERFORM dg_native_dining_touch(meta,action_id,p.id,true);
 END CASE;
 INSERT INTO outbox_events VALUES(gen_random_uuid()::text,r.tenant_id,r.workspace_id,party_value,'dining.'||action_value,'mock','{}',now_value,NULL);RETURN action_id;
END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_dining_claim_attempt(target text,token_hash_value text,csrf_hash_value text,focus_value bigint,key_hash_value text,body_hash_value text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;old _dg_native_dining_claim_attempts%ROWTYPE;
BEGIN
 meta:=dg_native_dining_context('restaurant',(SELECT restaurant_id FROM _dg_native_dining_session_origins WHERE session_id=target),target,token_hash_value,csrf_hash_value,focus_value,true);
 IF key_hash_value IS NULL OR key_hash_value!~'^[a-f0-9]{64}$' OR body_hash_value IS NULL OR body_hash_value!~'^[a-f0-9]{64}$' THEN PERFORM dg_native_dining_error('VALIDATION_FAILED');END IF;
 SELECT * INTO old FROM _dg_native_dining_claim_attempts WHERE session_id=target AND key_hash=key_hash_value;
 IF old.id IS NOT NULL THEN IF old.body_hash<>body_hash_value THEN PERFORM dg_native_dining_error('IDEMPOTENCY_CONFLICT');END IF;RETURN;END IF;
 IF(SELECT count(*) FROM _dg_native_dining_claim_attempts WHERE session_id=target AND created_at>dg_native_people_iso(clock_timestamp()-interval '15 minutes'))>=5 THEN PERFORM dg_native_dining_error('CLAIM_RATE_LIMITED');END IF;
 INSERT INTO _dg_native_dining_claim_attempts VALUES(gen_random_uuid()::text,target,meta->>'restaurantId',meta->>'accessId',focus_value,key_hash_value,body_hash_value,dg_native_dining_now());
END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_dining_claim_descriptor(target text,token_hash_value text,csrf_hash_value text,focus_value bigint,party_value text,code_hash_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;p dining_parties%ROWTYPE;
BEGIN
 meta:=dg_native_dining_context('restaurant',(SELECT restaurant_id FROM _dg_native_dining_session_origins WHERE session_id=target),target,token_hash_value,csrf_hash_value,focus_value,true);
 SELECT p0.* INTO p FROM dining_parties p0 JOIN _dg_native_dining_party_origins origin ON origin.party_id=p0.id WHERE p0.id=party_value AND p0.restaurant_id=meta->>'restaurantId' AND p0.status IN('waiting','reserved','held','seated') AND p0.claim_expires_at>dg_native_dining_now() AND p0.claim_hash=code_hash_value FOR UPDATE OF p0;
 IF p.id IS NULL THEN PERFORM dg_native_dining_error('INVALID_DINING_CLAIM');END IF;RETURN jsonb_build_object('partyId',p.id,'restaurantId',p.restaurant_id,'version',p.version,'accessVersion',p.access_version,'nonce',p.claim_nonce,'sha256',p.claim_hash,'expiresAt',p.claim_expires_at);
END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_dining_sweep(restaurant_value text DEFAULT NULL) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE r restaurants%ROWTYPE;o dining_occupancies%ROWTYPE;p dining_parties%ROWTYPE;b dining_reservations%ROWTYPE;meta jsonb;action_value text;now_value text:=dg_native_dining_now();changed bigint:=0;state_value text;
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


CREATE OR REPLACE FUNCTION dg_native_dining_row_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j jsonb:=to_jsonb(NEW);previous jsonb:=to_jsonb(OLD);r restaurants%ROWTYPE;party_current dining_parties%ROWTYPE;party_previous dining_parties%ROWTYPE;booking_current dining_reservations%ROWTYPE;booking_previous dining_reservations%ROWTYPE;occupancy_current dining_occupancies%ROWTYPE;occupancy_previous dining_occupancies%ROWTYPE;plan_current dining_hold_plans%ROWTYPE;plan_previous dining_hold_plans%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' OR NOT dg_native_dining_changed(TG_TABLE_NAME,j->>'id') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Dining facts require a scoped durable operation in their original transaction';END IF;
 SELECT * INTO r FROM restaurants WHERE id=j->>'restaurant_id';IF r.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Dining facts require their restaurant';END IF;
 IF TG_OP='UPDATE' THEN
  IF j->>'id' IS DISTINCT FROM previous->>'id' OR j->>'restaurant_id' IS DISTINCT FROM previous->>'restaurant_id' OR(j->>'version')::bigint<>(previous->>'version')::bigint+1 OR j->>'created_at' IS DISTINCT FROM previous->>'created_at' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Dining identity, original creation and monotonic versions are immutable';END IF;
 ELSE IF coalesce((j->>'version')::bigint,1)<>1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Dining records start at version one';END IF;END IF;
 IF TG_TABLE_NAME='dining_parties' THEN
party_current:=jsonb_populate_record(NULL::dining_parties,j);party_previous:=jsonb_populate_record(NULL::dining_parties,previous);
  IF party_current.status NOT IN('waiting','reserved','held','seated','cancelled','completed','no_show') OR party_current.size NOT BETWEEN 1 AND 40 OR party_current.visit_minutes NOT BETWEEN 15 AND 240 OR char_length(btrim(party_current.name)) NOT BETWEEN 1 AND 60 OR char_length(party_current.guest_note)>300 OR party_current.current_preference_id IS NOT NULL OR party_current.claim_hash!~'^[a-f0-9]{64}$' OR party_current.claim_nonce!~'^[a-f0-9-]{36}$' OR party_current.access_version<1 OR party_current.version<1 OR party_current.claim_expires_at<=party_current.created_at OR(party_current.status IN('cancelled','completed','no_show'))<>(party_current.ended_at IS NOT NULL) OR(party_current.status='reserved')<>(party_current.queue_number IS NULL) AND party_current.status NOT IN('cancelled','completed','no_show') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Dining party fields, consent credential and state are bounded';END IF;
  IF TG_OP='INSERT' THEN IF party_current.status NOT IN('waiting','reserved') OR party_current.access_version<>1 OR party_current.seated_at IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='New dining parties are unseated';END IF;
  ELSE
   IF party_previous.status IN('cancelled','completed','no_show') OR party_current.actor_id<>party_previous.actor_id OR party_current.access_version NOT BETWEEN party_previous.access_version AND party_previous.access_version+1 OR(party_current.claim_nonce<>party_previous.claim_nonce OR party_current.claim_hash<>party_previous.claim_hash OR party_current.owner_session_id IS DISTINCT FROM party_previous.owner_session_id) AND party_current.access_version<>party_previous.access_version+1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Dining ownership and credentials cannot be rewritten without revocation';END IF;
   IF party_current.status<>party_previous.status AND NOT(party_previous.status='reserved' AND party_current.status IN('waiting','cancelled','no_show') OR party_previous.status='waiting' AND party_current.status IN('held','cancelled') OR party_previous.status='held' AND party_current.status IN('waiting','seated','cancelled') OR party_previous.status='seated' AND party_current.status='completed') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Unsupported dining party state transition';END IF;
  END IF;
 ELSIF TG_TABLE_NAME='dining_reservations' THEN
booking_current:=jsonb_populate_record(NULL::dining_reservations,j);booking_previous:=jsonb_populate_record(NULL::dining_reservations,previous);
  IF booking_current.status NOT IN('confirmed','checked_in','seated','cancelled','no_show','completed','expired') OR booking_current.ends_at<=booking_current.starts_at OR booking_current.ends_at::timestamptz-booking_current.starts_at::timestamptz>interval '4 hours' OR NOT EXISTS(SELECT 1 FROM restaurant_tables WHERE id=booking_current.table_id AND restaurant_id=booking_current.restaurant_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Dining reservation table and bounded interval are guarded';END IF;
  IF TG_OP='INSERT' THEN IF booking_current.status<>'confirmed' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='New reservations start confirmed';END IF;
  ELSE
   IF booking_current.party_id<>booking_previous.party_id OR booking_current.reference<>booking_previous.reference OR booking_previous.status IN('cancelled','no_show','completed','expired') OR booking_current.status<>booking_previous.status AND NOT(booking_previous.status='confirmed' AND booking_current.status IN('checked_in','cancelled','no_show') OR booking_previous.status='checked_in' AND booking_current.status IN('seated','cancelled','expired') OR booking_previous.status='seated' AND booking_current.status='completed') OR booking_previous.status<>'confirmed' AND(booking_current.table_id<>booking_previous.table_id OR booking_current.starts_at<>booking_previous.starts_at OR booking_current.ends_at<>booking_previous.ends_at) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Reservation identity, finalized times and state are guarded';END IF;
  END IF;
 ELSIF TG_TABLE_NAME='dining_occupancies' THEN
occupancy_current:=jsonb_populate_record(NULL::dining_occupancies,j);occupancy_previous:=jsonb_populate_record(NULL::dining_occupancies,previous);
  IF occupancy_current.state NOT IN('held','seated','released','expired') OR occupancy_current.state='held' AND(occupancy_current.expires_at IS NULL OR occupancy_current.expires_at>occupancy_current.expected_end_at OR occupancy_current.expires_at>dg_native_people_iso(occupancy_current.created_at::timestamptz+make_interval(secs=>r.hold_seconds::double precision))) OR occupancy_current.state='seated' AND occupancy_current.expires_at IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Occupancies keep a bounded original hold and explicit actual seating';END IF;
  IF TG_OP='INSERT' THEN IF occupancy_current.state<>'held' OR occupancy_current.expires_at<=occupancy_current.created_at THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Occupancies start with a future bounded hold';END IF;
  ELSE
   IF occupancy_current.party_id<>occupancy_previous.party_id OR occupancy_current.table_id<>occupancy_previous.table_id OR occupancy_current.actor_id<>occupancy_previous.actor_id OR occupancy_current.expected_end_at<>occupancy_previous.expected_end_at OR occupancy_previous.state IN('released','expired') OR occupancy_current.state=occupancy_previous.state OR NOT(occupancy_previous.state='held' AND occupancy_current.state IN('seated','released','expired') OR occupancy_previous.state='seated' AND occupancy_current.state='released') OR occupancy_current.expires_at IS DISTINCT FROM occupancy_previous.expires_at AND NOT(occupancy_previous.state='held' AND occupancy_current.state='seated' AND occupancy_current.expires_at IS NULL) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Occupancy identity, original clocks and finite transitions are guarded';END IF;
  END IF;
 ELSIF TG_TABLE_NAME='dining_hold_plans' THEN
plan_current:=jsonb_populate_record(NULL::dining_hold_plans,j);plan_previous:=jsonb_populate_record(NULL::dining_hold_plans,previous);
  IF TG_OP<>'INSERT' OR plan_current.hash!~'^[a-f0-9]{64}$' OR plan_current.expires_at<=plan_current.created_at OR plan_current.expires_at>dg_native_people_iso(plan_current.created_at::timestamptz+interval '30 seconds') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Table plans retain the original bounded thirty-second deadline';END IF;
 END IF;RETURN NEW;
END;$dg$;


CREATE OR REPLACE FUNCTION dg_native_dining_business_final() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j jsonb:=to_jsonb(NEW);party_value text;p dining_parties%ROWTYPE;r restaurants%ROWTYPE;origin _dg_native_dining_party_origins%ROWTYPE;b dining_reservations%ROWTYPE;o dining_occupancies%ROWTYPE;t restaurant_tables%ROWTYPE;plan dining_hold_plans%ROWTYPE;a _dg_native_dining_actions%ROWTYPE;s reception_sessions%ROWTYPE;booking_clock _dg_native_dining_booking_clocks%ROWTYPE;latest record;
BEGIN
 IF TG_TABLE_NAME='_dg_native_dining_actions' THEN
  SELECT * INTO a FROM _dg_native_dining_actions WHERE id=j->>'id';SELECT * INTO r FROM restaurants WHERE id=a.restaurant_id;
  IF a.actor_type='staff' AND NOT dg_native_dining_clock_authority(a.actor_id,a.restaurant_id,a.actor_epoch,a.grant_version) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Dining staff operation must commit with its original current authority';END IF;
  IF a.actor_type='guest' THEN SELECT * INTO s FROM reception_sessions WHERE id=a.session_id;IF s.status<>'active' OR s.expires_at<=dg_native_dining_now() OR NOT dg_native_reception_source_valid(s.id) OR s.focus_version<>a.focus_version OR NOT EXISTS(SELECT 1 FROM _dg_native_reception_access WHERE id=a.access_id AND session_id=s.id AND access_version=s.access_version) OR coalesce((SELECT max(version) FROM _dg_native_dining_selection_revisions WHERE session_id=s.id),0)<>a.selection_version THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Dining guest operation keeps its actual session, access, person and selection';END IF;END IF;
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


REVOKE ALL ON FUNCTION dg_native_dining_now(),dg_native_dining_clock_authority(text,text,bigint,bigint) FROM PUBLIC;
