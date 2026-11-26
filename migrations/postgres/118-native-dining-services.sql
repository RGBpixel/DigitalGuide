-- Scoped store service hand-off. No order, stock, payment, or external delivery is performed.
CREATE TABLE _dg_native_hospitality_origins(
 resource_kind text NOT NULL CHECK(resource_kind IN('service','event','farewell','feedback','followup')),resource_id text NOT NULL,
 restaurant_id text NOT NULL REFERENCES restaurants(id),party_id text NOT NULL REFERENCES dining_parties(id),runtime_id text NOT NULL,
 action_id text NOT NULL REFERENCES _dg_native_dining_actions(id),table_id text REFERENCES restaurant_tables(id),table_name text,
 created_at text NOT NULL,transaction_id text NOT NULL,PRIMARY KEY(resource_kind,resource_id)
);
CREATE TABLE _dg_native_hospitality_revisions(
 resource_kind text NOT NULL,resource_id text NOT NULL,version bigint NOT NULL CHECK(version>0),action_id text NOT NULL REFERENCES _dg_native_dining_actions(id),
 row_hash text NOT NULL CHECK(row_hash~'^[a-f0-9]{64}$'),created_at text NOT NULL,transaction_id text NOT NULL,
 PRIMARY KEY(resource_kind,resource_id,version),FOREIGN KEY(resource_kind,resource_id) REFERENCES _dg_native_hospitality_origins(resource_kind,resource_id)
);
CREATE TABLE _dg_native_hospitality_results(
 action_id text PRIMARY KEY REFERENCES _dg_native_dining_actions(id),resource_kind text NOT NULL,resource_id text NOT NULL,party_id text NOT NULL REFERENCES dining_parties(id),party_access_version bigint NOT NULL,
 FOREIGN KEY(resource_kind,resource_id) REFERENCES _dg_native_hospitality_origins(resource_kind,resource_id)
);
CREATE TRIGGER native_hospitality_origin_immutable BEFORE UPDATE OR DELETE ON _dg_native_hospitality_origins FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_hospitality_revision_immutable BEFORE UPDATE OR DELETE ON _dg_native_hospitality_revisions FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_hospitality_result_immutable BEFORE UPDATE OR DELETE ON _dg_native_hospitality_results FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
ALTER TABLE dining_service_requests ADD CONSTRAINT native_service_shape CHECK(kind IN('water','napkins','staff_help','dish_progress','billing_help') AND status IN('requested','acknowledged','resolved','cancelled') AND version>0 AND char_length(note)<=200 AND source_request_id IS NULL) NOT VALID;

CREATE FUNCTION dg_native_hospitality_error(code_value text) RETURNS void LANGUAGE plpgsql AS $dg$ BEGIN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='DGHOSP:'||code_value;END;$dg$;

CREATE FUNCTION dg_native_hospitality_context(kind_value text,target text,session_value text DEFAULT NULL,token_value text DEFAULT NULL,csrf_value text DEFAULT NULL,focus_value bigint DEFAULT NULL,write_value boolean DEFAULT false,selection_value bigint DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;party_value text;s reception_sessions%ROWTYPE;p dining_parties%ROWTYPE;
BEGIN
 IF kind_value='service' THEN SELECT party_id INTO party_value FROM _dg_native_hospitality_origins WHERE resource_kind='service' AND resource_id=target AND runtime_id=(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1);IF party_value IS NULL THEN PERFORM dg_native_hospitality_error('NOT_FOUND');END IF;
 ELSIF kind_value='party' THEN party_value:=target;
 ELSIF kind_value<>'restaurant' THEN PERFORM dg_native_hospitality_error('VALIDATION_FAILED');END IF;
 IF kind_value='restaurant' AND session_value IS NOT NULL THEN PERFORM dg_native_hospitality_error('FORBIDDEN');END IF;
 meta:=dg_native_dining_context(CASE WHEN kind_value='restaurant' THEN 'restaurant' ELSE 'party' END,coalesce(party_value,target),session_value,token_value,csrf_value,focus_value,write_value);
 IF party_value IS NOT NULL THEN
  IF write_value THEN SELECT * INTO p FROM dining_parties WHERE id=party_value FOR UPDATE;ELSE SELECT * INTO p FROM dining_parties WHERE id=party_value;END IF;
  IF session_value IS NOT NULL THEN SELECT * INTO s FROM reception_sessions WHERE id=session_value;IF write_value AND(selection_value IS NULL OR selection_value IS DISTINCT FROM(meta->>'selectionVersion')::bigint OR s.dining_party_id IS DISTINCT FROM p.id) THEN PERFORM dg_native_hospitality_error('VERSION_CONFLICT');END IF;END IF;
  meta:=meta||jsonb_build_object('partyVersion',p.version,'partyAccessVersion',p.access_version,'partyStatus',p.status,'selected',session_value IS NULL OR coalesce(s.dining_party_id=p.id,false),'automatic',session_value IS NULL OR s.status='active');
 END IF;
 RETURN meta;
END;$dg$;

CREATE FUNCTION dg_native_hospitality_record(kind_value text,target text,version_value bigint,action_value text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE a _dg_native_dining_actions%ROWTYPE;payload jsonb;
BEGIN
 SELECT * INTO a FROM _dg_native_dining_actions WHERE id=action_value AND transaction_id=pg_current_xact_id()::text;IF a.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Hospitality revisions require the current original action';END IF;
 CASE kind_value WHEN 'service' THEN SELECT to_jsonb(r) INTO payload FROM dining_service_requests r WHERE id=target;WHEN 'event' THEN SELECT to_jsonb(r) INTO payload FROM dining_service_events r WHERE id=target;WHEN 'farewell' THEN SELECT to_jsonb(r) INTO payload FROM dining_farewells r WHERE party_id=target;ELSE PERFORM dg_native_hospitality_error('VALIDATION_FAILED');END CASE;
 IF payload IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='A hospitality revision must bind its actual persistent row';END IF;
 INSERT INTO _dg_native_hospitality_revisions VALUES(kind_value,target,version_value,a.id,dg_native_office_hash(payload),a.created_at,pg_current_xact_id()::text);
END;$dg$;

CREATE FUNCTION dg_native_hospitality_event(request_value text,kind_value text,action_value text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE a _dg_native_dining_actions%ROWTYPE;r dining_service_requests%ROWTYPE;event_value text:=gen_random_uuid()::text;
BEGIN
 SELECT * INTO a FROM _dg_native_dining_actions WHERE id=action_value AND transaction_id=pg_current_xact_id()::text;SELECT * INTO r FROM dining_service_requests WHERE id=request_value;
 IF a.id IS NULL OR r.id IS NULL OR a.restaurant_id<>r.restaurant_id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Service events bind an existing service and its current store action';END IF;
 INSERT INTO dining_service_events VALUES(event_value,r.id,a.actor_id,kind_value,a.created_at);
 INSERT INTO _dg_native_hospitality_origins VALUES('event',event_value,r.restaurant_id,r.party_id,(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1),a.id,NULL,NULL,a.created_at,pg_current_xact_id()::text);
 PERFORM dg_native_hospitality_record('event',event_value,1,a.id);
END;$dg$;

CREATE FUNCTION dg_native_hospitality_service_project(target text,meta jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE r dining_service_requests%ROWTYPE;p dining_parties%ROWTYPE;o _dg_native_hospitality_origins%ROWTYPE;table_value text;active_value boolean;staff_value boolean;automatic_value boolean;
BEGIN
 SELECT * INTO o FROM _dg_native_hospitality_origins WHERE resource_kind='service' AND resource_id=target AND runtime_id=(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1);SELECT * INTO r FROM dining_service_requests WHERE id=target;
 IF o.resource_id IS NULL OR r.id IS NULL OR r.party_id IS DISTINCT FROM meta->>'partyId' OR r.restaurant_id IS DISTINCT FROM meta->>'restaurantId' THEN PERFORM dg_native_hospitality_error('NOT_FOUND');END IF;
 SELECT * INTO p FROM dining_parties WHERE id=r.party_id;SELECT t.name INTO table_value FROM dining_occupancies occupied JOIN restaurant_tables t ON t.id=occupied.table_id WHERE occupied.party_id=p.id AND occupied.state IN('held','seated');
 active_value:=r.status IN('requested','acknowledged') AND p.status IN('waiting','reserved','held','seated');staff_value:=meta->>'actorType'='staff';automatic_value:=staff_value OR(meta->>'automatic')::boolean AND(meta->>'selected')::boolean;
 RETURN jsonb_build_object('id',r.id,'restaurantId',r.restaurant_id,'partyId',p.id,'partyName',p.name,'partyVersion',p.version,'partyAccessVersion',p.access_version,'tableName',coalesce(table_value,o.table_name),'kind',r.kind,'note',r.note,'status',r.status,'version',r.version,'source',CASE WHEN r.source_request_id IS NULL THEN 'manual' ELSE 'conversation' END,'canAcknowledge',staff_value AND active_value AND r.status='requested','canResolve',staff_value AND active_value AND r.status='acknowledged','canCancel',active_value AND automatic_value,'acknowledgedAt',r.acknowledged_at,'resolvedAt',r.resolved_at,'createdAt',r.created_at,'updatedAt',r.updated_at);
END;$dg$;

CREATE FUNCTION dg_native_hospitality_read(kind_value text,target text,session_value text DEFAULT NULL,token_value text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;result_value jsonb;request_value record;
BEGIN
 meta:=dg_native_hospitality_context(kind_value,target,session_value,token_value);IF kind_value='service' THEN RETURN dg_native_hospitality_service_project(target,meta);END IF;
 result_value:='[]';FOR request_value IN SELECT r.id,r.party_id FROM dining_service_requests r JOIN _dg_native_hospitality_origins origin ON origin.resource_kind='service' AND origin.resource_id=r.id AND origin.runtime_id=(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1) WHERE r.restaurant_id=meta->>'restaurantId' AND(kind_value='restaurant' OR r.party_id=meta->>'partyId') ORDER BY CASE WHEN kind_value='restaurant' THEN CASE r.status WHEN 'requested' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END ELSE 0 END,r.created_at DESC,r.id DESC LIMIT CASE WHEN kind_value='restaurant' THEN 200 ELSE 100 END LOOP
  result_value:=result_value||jsonb_build_array(dg_native_hospitality_service_project(request_value.id,CASE WHEN kind_value='restaurant' THEN dg_native_hospitality_context('party',request_value.party_id) ELSE meta END));
 END LOOP;RETURN result_value;
END;$dg$;

CREATE FUNCTION dg_native_hospitality_apply(kind_value text,target text,action_value text,input jsonb,session_value text DEFAULT NULL,token_value text DEFAULT NULL,csrf_value text DEFAULT NULL,focus_value bigint DEFAULT NULL) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;p dining_parties%ROWTYPE;r dining_service_requests%ROWTYPE;a _dg_native_dining_actions%ROWTYPE;operation_value text;table_value restaurant_tables%ROWTYPE;
BEGIN
 IF action_value NOT IN('create','acknowledge','resolve','cancel') OR action_value IS NULL OR(action_value='create') IS DISTINCT FROM(kind_value='party') THEN PERFORM dg_native_hospitality_error('VALIDATION_FAILED');END IF;
 meta:=dg_native_hospitality_context(kind_value,target,session_value,token_value,csrf_value,focus_value,true,CASE WHEN session_value IS NOT NULL THEN dg_native_restaurant_integer(input->'selectionVersion',0,9007199254740991) END);
 SELECT * INTO p FROM dining_parties WHERE id=meta->>'partyId';IF p.status NOT IN('waiting','reserved','held','seated') THEN PERFORM dg_native_hospitality_error('PARTY_ENDED');END IF;
 IF input->'confirmed' IS DISTINCT FROM 'true'::jsonb OR dg_native_restaurant_integer(input->'partyVersion',1,9007199254740991) IS DISTINCT FROM p.version THEN PERFORM dg_native_hospitality_error('VERSION_CONFLICT');END IF;
 IF action_value='create' THEN
  PERFORM dg_native_restaurant_fields(input,ARRAY['kind','note','confirmed','partyVersion','focusVersion','selectionVersion']);IF input->>'kind' IS NULL OR input->>'kind' NOT IN('water','napkins','staff_help','dish_progress','billing_help') OR jsonb_typeof(input->'note') IS DISTINCT FROM 'string' OR char_length(input->>'note')>200 THEN PERFORM dg_native_hospitality_error('VALIDATION_FAILED');END IF;
  IF(SELECT count(*) FROM dining_service_requests request JOIN _dg_native_hospitality_origins origin ON origin.resource_kind='service' AND origin.resource_id=request.id WHERE request.party_id=p.id AND request.status IN('requested','acknowledged'))>=10 THEN PERFORM dg_native_hospitality_error('SERVICE_REQUEST_LIMIT');END IF;
 ELSE
  PERFORM dg_native_restaurant_fields(input,ARRAY['version','action','confirmed','partyVersion','focusVersion','selectionVersion']);IF input->>'action' IS DISTINCT FROM action_value THEN PERFORM dg_native_hospitality_error('VALIDATION_FAILED');END IF;
  SELECT * INTO r FROM dining_service_requests WHERE id=target FOR UPDATE;IF r.id IS NULL OR r.party_id<>p.id THEN PERFORM dg_native_hospitality_error('NOT_FOUND');END IF;
  IF session_value IS NOT NULL AND action_value<>'cancel' THEN PERFORM dg_native_hospitality_error('FORBIDDEN');END IF;
  IF dg_native_restaurant_integer(input->'version',1,9007199254740991) IS DISTINCT FROM r.version THEN PERFORM dg_native_hospitality_error('VERSION_CONFLICT');END IF;
  IF action_value='acknowledge' AND r.status<>'requested' OR action_value='resolve' AND r.status<>'acknowledged' OR action_value='cancel' AND r.status NOT IN('requested','acknowledged') THEN PERFORM dg_native_hospitality_error('SERVICE_STATE_CHANGED');END IF;
 END IF;
 operation_value:=dg_native_dining_action(meta,'hospitality_'||action_value,'party',p.id,input);SELECT * INTO a FROM _dg_native_dining_actions WHERE id=operation_value;
 IF action_value='create' THEN
  r.id:=gen_random_uuid()::text;
  INSERT INTO dining_service_requests(id,restaurant_id,party_id,kind,note,status,version,actor_id,session_id,focus_version,source_request_id,created_at,updated_at) VALUES(r.id,p.restaurant_id,p.id,input->>'kind',btrim(input->>'note'),'requested',1,a.actor_id,a.session_id,a.focus_version,NULL,a.created_at,a.created_at);
  SELECT t.* INTO table_value FROM dining_occupancies occupied JOIN restaurant_tables t ON t.id=occupied.table_id WHERE occupied.party_id=p.id AND occupied.state IN('held','seated');
  INSERT INTO _dg_native_hospitality_origins VALUES('service',r.id,p.restaurant_id,p.id,(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1),a.id,table_value.id,table_value.name,a.created_at,pg_current_xact_id()::text);
 ELSE
  UPDATE dining_service_requests SET status=CASE action_value WHEN 'acknowledge' THEN 'acknowledged' WHEN 'resolve' THEN 'resolved' ELSE 'cancelled' END,acknowledged_by=CASE WHEN action_value='acknowledge' THEN a.actor_id ELSE acknowledged_by END,acknowledged_at=CASE WHEN action_value='acknowledge' THEN a.created_at ELSE acknowledged_at END,resolved_by=CASE WHEN action_value<>'acknowledge' THEN a.actor_id ELSE resolved_by END,resolved_at=CASE WHEN action_value<>'acknowledge' THEN a.created_at ELSE resolved_at END,version=version+1,updated_at=a.created_at WHERE id=r.id;
 END IF;
 SELECT * INTO r FROM dining_service_requests WHERE id=r.id;PERFORM dg_native_hospitality_record('service',r.id,r.version,a.id);PERFORM dg_native_hospitality_event(r.id,r.status,a.id);
 INSERT INTO _dg_native_hospitality_results VALUES(a.id,'service',r.id,p.id,p.access_version);PERFORM dg_native_dining_touch(meta,a.id,p.id,false);
 PERFORM dg_native_hospitality_context(kind_value,target,session_value,token_value,csrf_value,focus_value,true,(meta->>'selectionVersion')::bigint);
 INSERT INTO outbox_events VALUES(gen_random_uuid()::text,meta->>'tenantId',meta->>'workspaceId',p.id,'dining.service_'||action_value,'mock','{}',a.created_at,NULL);RETURN a.id;
END;$dg$;

CREATE FUNCTION dg_native_hospitality_result(target text,session_value text DEFAULT NULL,token_value text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE result_value _dg_native_hospitality_results%ROWTYPE;a _dg_native_dining_actions%ROWTYPE;meta jsonb;
BEGIN
 SELECT * INTO result_value FROM _dg_native_hospitality_results WHERE action_id=target;SELECT * INTO a FROM _dg_native_dining_actions WHERE id=target;IF a.id IS NULL OR result_value.action_id IS NULL THEN PERFORM dg_native_hospitality_error('NOT_FOUND');END IF;
 meta:=dg_native_hospitality_context('party',result_value.party_id,session_value,token_value);
 IF a.actor_id IS DISTINCT FROM meta->>'actorId' OR a.actor_type IS DISTINCT FROM meta->>'actorType' OR a.actor_epoch IS DISTINCT FROM(meta->>'actorEpoch')::bigint OR a.grant_version IS DISTINCT FROM(meta->>'grantVersion')::bigint OR a.session_id IS DISTINCT FROM meta->>'sessionId' OR a.access_id IS DISTINCT FROM meta->>'accessId' OR a.focus_version IS DISTINCT FROM(meta->>'focusVersion')::bigint OR a.selection_version IS DISTINCT FROM(meta->>'selectionVersion')::bigint OR result_value.party_access_version IS DISTINCT FROM(meta->>'partyAccessVersion')::bigint OR session_value IS NOT NULL AND NOT(meta->>'selected')::boolean THEN PERFORM dg_native_hospitality_error('AUTHORIZATION_CHANGED');END IF;
 RETURN dg_native_hospitality_service_project(result_value.resource_id,meta);
END;$dg$;

CREATE FUNCTION dg_native_hospitality_mutation_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Service requests retain confirmed history';END IF;
 IF TG_OP='UPDATE' THEN
  IF to_jsonb(NEW)-ARRAY['status','version','acknowledged_by','acknowledged_at','resolved_by','resolved_at','updated_at'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['status','version','acknowledged_by','acknowledged_at','resolved_by','resolved_at','updated_at'] OR NEW.version<>OLD.version+1 OR NEW.updated_at<OLD.updated_at OR NOT(OLD.status='requested' AND NEW.status IN('acknowledged','cancelled') OR OLD.status='acknowledged' AND NEW.status IN('resolved','cancelled')) OR OLD.acknowledged_at IS NOT NULL AND(NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at OR NEW.acknowledged_by IS DISTINCT FROM OLD.acknowledged_by) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Service transitions preserve original request and earlier acknowledgement';END IF;
 END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_hospitality_service_mutations BEFORE UPDATE OR DELETE ON dining_service_requests FOR EACH ROW EXECUTE FUNCTION dg_native_hospitality_mutation_guard();
CREATE TRIGGER native_hospitality_event_immutable BEFORE UPDATE OR DELETE ON dining_service_events FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_hospitality_farewell_immutable BEFORE UPDATE OR DELETE ON dining_farewells FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();

CREATE FUNCTION dg_native_hospitality_row_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE kind_value text;id_value text;version_value bigint;payload jsonb;o _dg_native_hospitality_origins%ROWTYPE;revision_value _dg_native_hospitality_revisions%ROWTYPE;a _dg_native_dining_actions%ROWTYPE;p dining_parties%ROWTYPE;
BEGIN
 kind_value:=CASE TG_TABLE_NAME WHEN 'dining_service_requests' THEN 'service' WHEN 'dining_service_events' THEN 'event' ELSE 'farewell' END;payload:=to_jsonb(NEW);id_value:=CASE WHEN kind_value='farewell' THEN payload->>'party_id' ELSE payload->>'id' END;
 CASE kind_value WHEN 'service' THEN SELECT to_jsonb(r),r.version INTO payload,version_value FROM dining_service_requests r WHERE id=id_value;WHEN 'event' THEN SELECT to_jsonb(r),1 INTO payload,version_value FROM dining_service_events r WHERE id=id_value;ELSE SELECT to_jsonb(r),1 INTO payload,version_value FROM dining_farewells r WHERE party_id=id_value;END CASE;
 SELECT * INTO o FROM _dg_native_hospitality_origins WHERE resource_kind=kind_value AND resource_id=id_value;SELECT * INTO revision_value FROM _dg_native_hospitality_revisions WHERE resource_kind=kind_value AND resource_id=id_value AND version=version_value;SELECT * INTO a FROM _dg_native_dining_actions WHERE id=revision_value.action_id;SELECT * INTO p FROM dining_parties WHERE id=o.party_id;
 IF o.resource_id IS NULL OR revision_value.resource_id IS NULL OR a.id IS NULL OR o.runtime_id<>(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1) OR revision_value.row_hash<>dg_native_office_hash(payload) OR revision_value.transaction_id<>pg_current_xact_id()::text OR revision_value.transaction_id<>a.transaction_id OR o.restaurant_id<>a.restaurant_id OR p.restaurant_id<>o.restaurant_id OR a.resource_id<>p.id AND NOT EXISTS(SELECT 1 FROM _dg_native_dining_changes effect WHERE effect.action_id=a.id AND effect.table_name='dining_parties' AND effect.resource_id=p.id) OR payload->>'created_at'<>o.created_at THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Service rows require their scoped original origin and current exact revision';END IF;
 IF kind_value='service' THEN
  IF payload->>'party_id'<>p.id OR payload->>'restaurant_id'<>p.restaurant_id OR payload->>'updated_at'<>a.created_at OR(version_value=1 AND(a.kind<>'hospitality_create' OR payload->>'status'<>'requested' OR payload->>'actor_id'<>a.actor_id OR payload->>'session_id' IS DISTINCT FROM a.session_id OR payload->>'focus_version' IS DISTINCT FROM a.focus_version::text)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Service creation and changes bind original actor and current action';END IF;
  IF version_value>1 AND NOT(a.kind='hospitality_acknowledge' AND payload->>'status'='acknowledged' AND payload->>'acknowledged_by'=a.actor_id AND payload->>'acknowledged_at'=a.created_at OR a.kind IN('hospitality_resolve','hospitality_cancel') AND payload->>'status'=CASE a.kind WHEN 'hospitality_resolve' THEN 'resolved' ELSE 'cancelled' END AND payload->>'resolved_by'=a.actor_id AND payload->>'resolved_at'=a.created_at OR payload->>'status'='cancelled' AND p.status IN('completed','cancelled','no_show') AND EXISTS(SELECT 1 FROM _dg_native_dining_changes effect WHERE effect.action_id=a.id AND effect.table_name='dining_parties' AND effect.resource_id=p.id)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Only explicit service actions or the original party ending may advance a request';END IF;
 ELSIF kind_value='event' THEN
  IF NOT EXISTS(SELECT 1 FROM dining_service_requests r JOIN _dg_native_hospitality_origins original ON original.resource_kind='service' AND original.resource_id=r.id WHERE r.id=payload->>'request_id' AND r.party_id=p.id AND r.restaurant_id=o.restaurant_id) OR payload->>'actor_id'<>a.actor_id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Service events bind the same party and actor';END IF;
 ELSE
  IF payload->>'party_id'<>p.id OR p.status<>'completed' OR payload->>'ended_by'<>a.actor_id OR NOT EXISTS(SELECT 1 FROM _dg_native_dining_changes effect WHERE effect.action_id=a.id AND effect.table_name='dining_parties' AND effect.resource_id=p.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Farewells require the original confirmed completion';END IF;
 END IF;RETURN NULL;
END;$dg$;
CREATE CONSTRAINT TRIGGER native_hospitality_service_rows AFTER INSERT OR UPDATE ON dining_service_requests DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_hospitality_row_guard();
CREATE CONSTRAINT TRIGGER native_hospitality_event_rows AFTER INSERT ON dining_service_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_hospitality_row_guard();
CREATE CONSTRAINT TRIGGER native_hospitality_farewell_rows AFTER INSERT ON dining_farewells DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_hospitality_row_guard();

CREATE FUNCTION dg_native_hospitality_party_end() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE a _dg_native_dining_actions%ROWTYPE;r dining_service_requests%ROWTYPE;
BEGIN
 IF NEW.status=OLD.status OR NEW.status NOT IN('completed','cancelled','no_show') OR NOT EXISTS(SELECT 1 FROM _dg_native_dining_party_origins WHERE party_id=NEW.id) THEN RETURN NEW;END IF;
 SELECT action.* INTO a FROM _dg_native_dining_actions action JOIN _dg_native_dining_changes effect ON effect.action_id=action.id AND effect.table_name='dining_parties' AND effect.resource_id=NEW.id WHERE action.transaction_id=pg_current_xact_id()::text AND action.restaurant_id=NEW.restaurant_id ORDER BY action.created_at DESC,action.id DESC LIMIT 1;
 IF a.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Closing dining service needs the actual original party ending action';END IF;
 FOR r IN SELECT request.* FROM dining_service_requests request JOIN _dg_native_hospitality_origins origin ON origin.resource_kind='service' AND origin.resource_id=request.id WHERE request.party_id=NEW.id AND request.status IN('requested','acknowledged') FOR UPDATE OF request LOOP
  UPDATE dining_service_requests SET status='cancelled',resolved_by=a.actor_id,resolved_at=a.created_at,version=version+1,updated_at=a.created_at WHERE id=r.id;
  PERFORM dg_native_hospitality_record('service',r.id,r.version+1,a.id);PERFORM dg_native_hospitality_event(r.id,'closed_with_dining',a.id);
 END LOOP;
 IF NEW.status='completed' AND NOT EXISTS(SELECT 1 FROM dining_farewells WHERE party_id=NEW.id) THEN
  INSERT INTO dining_farewells VALUES(NEW.id,'感谢光临，本次就餐已由店员核对结束。祝您一路顺利；如愿意，可留下评价或单独授权本次回访。',a.actor_id,a.created_at);
  INSERT INTO _dg_native_hospitality_origins VALUES('farewell',NEW.id,NEW.restaurant_id,NEW.id,(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1),a.id,NULL,NULL,a.created_at,pg_current_xact_id()::text);PERFORM dg_native_hospitality_record('farewell',NEW.id,1,a.id);
 END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_hospitality_party_end AFTER UPDATE OF status ON dining_parties FOR EACH ROW EXECUTE FUNCTION dg_native_hospitality_party_end();

REVOKE ALL ON FUNCTION dg_native_hospitality_error(text),dg_native_hospitality_context(text,text,text,text,text,bigint,boolean,bigint),dg_native_hospitality_record(text,text,bigint,text),dg_native_hospitality_event(text,text,text),dg_native_hospitality_service_project(text,jsonb),dg_native_hospitality_read(text,text,text,text),dg_native_hospitality_apply(text,text,text,jsonb,text,text,text,bigint),dg_native_hospitality_result(text,text,text),dg_native_hospitality_mutation_guard(),dg_native_hospitality_row_guard(),dg_native_hospitality_party_end() FROM PUBLIC;
