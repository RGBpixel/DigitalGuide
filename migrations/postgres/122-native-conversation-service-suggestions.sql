-- R-051 trusted current-turn service suggestions; no business action before explicit confirmation.
CREATE TABLE _dg_native_service_suggestions(
 id text PRIMARY KEY,runtime_id text NOT NULL,tenant_id text NOT NULL,workspace_id text NOT NULL,restaurant_id text NOT NULL REFERENCES restaurants(id),
 party_id text NOT NULL REFERENCES dining_parties(id),party_version bigint NOT NULL,party_access_version bigint NOT NULL,
 session_id text NOT NULL REFERENCES reception_sessions(id),access_id text REFERENCES _dg_native_reception_access(id),access_version bigint NOT NULL,
 focus_version bigint NOT NULL,selection_version bigint NOT NULL,reply_epoch bigint NOT NULL,
 question_id text NOT NULL UNIQUE REFERENCES reception_messages(id),reply_id text NOT NULL UNIQUE REFERENCES reception_messages(id),
 source_kind text NOT NULL CHECK(source_kind IN('typed','audio')),source_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN('water','napkins','staff_help','dish_progress','billing_help')),
 created_at text NOT NULL,expires_at text NOT NULL,transaction_id text NOT NULL
);
CREATE TABLE _dg_native_service_confirmations(
 suggestion_id text PRIMARY KEY REFERENCES _dg_native_service_suggestions(id),
 action_id text NOT NULL UNIQUE REFERENCES _dg_native_dining_actions(id),
 service_id text NOT NULL UNIQUE REFERENCES dining_service_requests(id),created_at text NOT NULL,transaction_id text NOT NULL
);
CREATE TRIGGER native_service_suggestions_immutable BEFORE UPDATE OR DELETE ON _dg_native_service_suggestions FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_service_confirmations_immutable BEFORE UPDATE OR DELETE ON _dg_native_service_confirmations FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();

CREATE FUNCTION dg_native_service_kind(text_value text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path FROM CURRENT AS $dg$
 SELECT CASE regexp_replace(regexp_replace(btrim(text_value),'[。！!？?]$',''),'^(请|麻烦)?(帮我|我要|我想|给我)?','')
 WHEN '加水' THEN 'water' WHEN '添水' THEN 'water' WHEN '要水' THEN 'water'
 WHEN '拿餐巾纸' THEN 'napkins' WHEN '要餐巾纸' THEN 'napkins' WHEN '送餐巾纸' THEN 'napkins'
 WHEN '找店员' THEN 'staff_help' WHEN '找服务员' THEN 'staff_help' WHEN '需要店员帮助' THEN 'staff_help'
 WHEN '催菜' THEN 'dish_progress' WHEN '核对菜品进度' THEN 'dish_progress' WHEN '查菜品进度' THEN 'dish_progress'
 WHEN '结账协助' THEN 'billing_help' WHEN '找店员结账' THEN 'billing_help' END
$dg$;
CREATE FUNCTION dg_native_service_name(kind_value text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path FROM CURRENT AS $dg$
 SELECT CASE kind_value WHEN 'water' THEN '加水' WHEN 'napkins' THEN '餐巾纸' WHEN 'staff_help' THEN '店员帮助' WHEN 'dish_progress' THEN '核对菜品进度' WHEN 'billing_help' THEN '结账协助' END
$dg$;
CREATE FUNCTION dg_native_service_allowed(target text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT coalesce(s.service_scene='restaurant' AND s.status='active' AND dg_native_reception_source_valid(s.id) AND
 s.scene_app_snapshot IS NOT NULL AND s.scene_app_snapshot::jsonb->>'scene'='restaurant' AND s.scene_app_snapshot::jsonb->>'audience'='public' AND s.scene_app_snapshot::jsonb->'tools' ? 'restaurant.service_request',false)
 FROM reception_sessions s WHERE s.id=target
$dg$;
CREATE FUNCTION dg_native_service_copy(target text,text_value text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s reception_sessions%ROWTYPE;p dining_parties%ROWTYPE;kind_value text:=dg_native_service_kind(text_value);
BEGIN
 PERFORM dg_native_reception_runtime();IF kind_value IS NULL THEN RETURN NULL;END IF;SELECT * INTO s FROM reception_sessions WHERE id=target;IF s.service_scene<>'restaurant' OR s.status<>'active' THEN RETURN NULL;END IF;
 SELECT * INTO p FROM dining_parties WHERE id=s.dining_party_id AND owner_session_id=s.id;
 IF p.id IS NULL THEN RETURN '【模拟餐厅回复】请先在下方核对并选择本人的就餐组，再明确提出服务请求；也可请求店员人工协助。';END IF;
 IF p.status NOT IN('waiting','reserved','held','seated') THEN RETURN '【模拟餐厅回复】本次就餐已结束。您可自愿评价或单独管理回访授权；需要其他帮助请联系店员。';END IF;
 IF NOT dg_native_service_allowed(s.id) THEN RETURN '【模拟餐厅回复】本频道未启用对话服务请求，请在下方“本次服务”选择'||dg_native_service_name(kind_value)||'，明确确认后交店员处理。';END IF;
 RETURN '【模拟餐厅回复】可以为本组提出“'||dg_native_service_name(kind_value)||'”请求，请在下方明确确认。店员接收和处理后会更新状态；当前尚未提交，也不会改变订单或付款。';
END;$dg$;

CREATE FUNCTION dg_native_service_source_valid(suggestion _dg_native_service_suggestions) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE q reception_messages%ROWTYPE;r reception_messages%ROWTYPE;receipt _dg_native_reception_receipts%ROWTYPE;origin _dg_native_speaker_event_origins%ROWTYPE;source _dg_native_speaker_message_sources%ROWTYPE;
BEGIN
 SELECT * INTO q FROM reception_messages WHERE id=suggestion.question_id;SELECT * INTO r FROM reception_messages WHERE id=suggestion.reply_id;
 IF q.id IS NULL OR r.id IS NULL OR q.session_id<>suggestion.session_id OR r.session_id<>q.session_id OR q.role<>'visitor' OR r.role<>'assistant' OR q.focus_version<>suggestion.focus_version OR r.focus_version<>q.focus_version OR q.reply_epoch<>suggestion.reply_epoch OR r.reply_epoch<>q.reply_epoch OR q.status<>'received' OR r.status='cancelled' OR dg_native_service_kind(q.text) IS DISTINCT FROM suggestion.kind OR NOT EXISTS(SELECT 1 FROM _dg_native_reception_message_digests WHERE message_id=q.id AND payload_hash=dg_native_office_hash(dg_native_reception_message_payload(q.id))) THEN RETURN false;END IF;
 IF suggestion.source_kind='typed' THEN
  SELECT * INTO receipt FROM _dg_native_reception_receipts WHERE id=suggestion.source_id;
  RETURN q.input_source='typed' AND q.speaker_decision_id IS NULL AND receipt.kind='message' AND receipt.session_id=q.session_id AND receipt.access_id=suggestion.access_id AND receipt.focus_version=q.focus_version AND receipt.transaction_id=suggestion.transaction_id;
 END IF;
 SELECT * INTO origin FROM _dg_native_speaker_event_origins WHERE decision_id=suggestion.source_id;SELECT * INTO source FROM _dg_native_speaker_message_sources WHERE decision_id=origin.decision_id;
 RETURN q.input_source='verified_mock_audio' AND q.speaker_decision_id=origin.decision_id AND source.question_id=q.id AND source.reply_id=r.id AND origin.transaction_id=suggestion.transaction_id AND (origin.descriptor->>'accepted')::boolean AND (origin.descriptor->>'final')::boolean AND origin.descriptor->>'attribution'='target' AND dg_native_speaker_message_valid(q);
END;$dg$;

CREATE FUNCTION dg_native_service_suggest(kind_value text,target text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE receipt _dg_native_reception_receipts%ROWTYPE;origin _dg_native_speaker_event_origins%ROWTYPE;audio _dg_native_speaker_message_sources%ROWTYPE;s reception_sessions%ROWTYPE;p dining_parties%ROWTYPE;q reception_messages%ROWTYPE;r reception_messages%ROWTYPE;proposal _dg_native_service_suggestions%ROWTYPE;selection_value bigint;now_value text:=dg_native_dining_now();
BEGIN
 PERFORM dg_native_reception_runtime();
 IF kind_value='typed' THEN
  SELECT * INTO receipt FROM _dg_native_reception_receipts WHERE id=target AND kind='message' AND transaction_id=pg_current_xact_id()::text;
  IF receipt.id IS NULL THEN PERFORM dg_native_reception_error('VALIDATION_FAILED');END IF;SELECT * INTO s FROM reception_sessions WHERE id=receipt.session_id;
 ELSIF kind_value='audio' THEN
  SELECT * INTO origin FROM _dg_native_speaker_event_origins WHERE decision_id=target AND transaction_id=pg_current_xact_id()::text;
  SELECT * INTO audio FROM _dg_native_speaker_message_sources WHERE decision_id=target;IF origin.decision_id IS NULL OR audio.decision_id IS NULL THEN PERFORM dg_native_reception_error('VALIDATION_FAILED');END IF;SELECT * INTO s FROM reception_sessions WHERE id=origin.session_id;
 ELSE PERFORM dg_native_reception_error('VALIDATION_FAILED');END IF;
 IF NOT coalesce(dg_native_service_allowed(s.id),false) THEN RETURN NULL;END IF;
 SELECT * INTO p FROM dining_parties WHERE id=s.dining_party_id AND owner_session_id=s.id AND restaurant_id=(SELECT restaurant_id FROM _dg_native_dining_terminal_origins WHERE terminal_id=s.terminal_id);
 IF p.id IS NULL OR p.status NOT IN('waiting','reserved','held','seated') THEN RETURN NULL;END IF;
 SELECT * INTO q FROM reception_messages WHERE session_id=s.id AND role='visitor' AND focus_version=s.focus_version AND reply_epoch=s.reply_epoch ORDER BY native_ordinal DESC LIMIT 1;
 SELECT * INTO r FROM reception_messages WHERE session_id=s.id AND role='assistant' AND focus_version=s.focus_version AND reply_epoch=s.reply_epoch ORDER BY native_ordinal DESC LIMIT 1;
 IF q.id IS NULL OR r.id IS NULL OR dg_native_service_kind(q.text) IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO proposal FROM _dg_native_service_suggestions WHERE question_id=q.id;IF proposal.id IS NOT NULL THEN RETURN proposal.id;END IF;
 selection_value:=coalesce((SELECT max(version) FROM _dg_native_dining_selection_revisions WHERE session_id=s.id),0);
 proposal.id:=gen_random_uuid()::text;proposal.runtime_id:=(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1);proposal.tenant_id:=s.tenant_id;proposal.workspace_id:=s.workspace_id;proposal.restaurant_id:=p.restaurant_id;proposal.party_id:=p.id;proposal.party_version:=p.version;proposal.party_access_version:=p.access_version;proposal.session_id:=s.id;proposal.access_id:=receipt.access_id;proposal.access_version:=s.access_version;proposal.focus_version:=s.focus_version;proposal.selection_version:=selection_value;proposal.reply_epoch:=s.reply_epoch;proposal.question_id:=q.id;proposal.reply_id:=r.id;proposal.source_kind:=kind_value;proposal.source_id:=target;proposal.kind:=dg_native_service_kind(q.text);proposal.created_at:=now_value;proposal.expires_at:=dg_native_people_iso(least(now_value::timestamptz+interval '60 seconds',s.expires_at::timestamptz));proposal.transaction_id:=pg_current_xact_id()::text;
 IF NOT coalesce(dg_native_service_source_valid(proposal),false) THEN PERFORM dg_native_reception_error('VALIDATION_FAILED');END IF;INSERT INTO _dg_native_service_suggestions SELECT(proposal).*;RETURN proposal.id;
END;$dg$;

CREATE FUNCTION dg_native_service_live(proposal _dg_native_service_suggestions) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT coalesce(proposal.runtime_id=(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1) AND proposal.expires_at>dg_native_dining_now() AND dg_native_service_allowed(s.id) AND
 s.access_version=proposal.access_version AND s.focus_version=proposal.focus_version AND s.reply_epoch=proposal.reply_epoch AND s.dining_party_id=p.id AND s.expires_at>dg_native_dining_now() AND s.activity_at>dg_native_people_iso(clock_timestamp()-interval '120 seconds') AND
 p.owner_session_id=s.id AND p.restaurant_id=proposal.restaurant_id AND p.version=proposal.party_version AND p.access_version=proposal.party_access_version AND p.status IN('waiting','reserved','held','seated') AND
 coalesce((SELECT max(version) FROM _dg_native_dining_selection_revisions WHERE session_id=s.id),0)=proposal.selection_version AND dg_native_service_source_valid(proposal),false)
 FROM reception_sessions s JOIN dining_parties p ON p.id=proposal.party_id WHERE s.id=proposal.session_id
$dg$;

CREATE FUNCTION dg_native_hospitality_apply_sourced(kind_value text,target text,action_value text,input jsonb,session_value text DEFAULT NULL,token_value text DEFAULT NULL,csrf_value text DEFAULT NULL,focus_value bigint DEFAULT NULL,suggestion_value text DEFAULT NULL) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
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
  INSERT INTO dining_service_requests(id,restaurant_id,party_id,kind,note,status,version,actor_id,session_id,focus_version,source_request_id,created_at,updated_at) VALUES(r.id,p.restaurant_id,p.id,input->>'kind',btrim(input->>'note'),'requested',1,a.actor_id,a.session_id,a.focus_version,suggestion_value,a.created_at,a.created_at);
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



CREATE FUNCTION dg_native_service_confirm(target text,session_value text,token_value text,csrf_value text,input jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s reception_sessions%ROWTYPE;proposal _dg_native_service_suggestions%ROWTYPE;previous _dg_native_service_confirmations%ROWTYPE;access_value _dg_native_reception_access%ROWTYPE;operation_value text;result_value _dg_native_hospitality_results%ROWTYPE;
BEGIN
 PERFORM dg_native_reception_authorize(session_value,token_value,csrf_value,true);SELECT * INTO s FROM reception_sessions WHERE id=session_value;SELECT * INTO access_value FROM _dg_native_reception_access WHERE session_id=s.id AND token_hash=token_value AND access_version=s.access_version;
 PERFORM dg_native_restaurant_fields(input,ARRAY['requestId','version','focusVersion','confirmed']);
 IF s.status<>'active' OR input->>'requestId' IS DISTINCT FROM target OR input->'confirmed' IS DISTINCT FROM 'true'::jsonb OR input->>'version' IS DISTINCT FROM s.version::text OR input->>'focusVersion' IS DISTINCT FROM s.focus_version::text THEN PERFORM dg_native_hospitality_error('VERSION_CONFLICT');END IF;
 SELECT * INTO proposal FROM _dg_native_service_suggestions WHERE id=target AND session_id=s.id FOR UPDATE;
 IF proposal.id IS NULL OR proposal.access_id IS NOT NULL AND proposal.access_id<>access_value.id THEN PERFORM dg_native_hospitality_error('NOT_FOUND');END IF;
 SELECT * INTO previous FROM _dg_native_service_confirmations WHERE suggestion_id=proposal.id;
 IF previous.suggestion_id IS NOT NULL THEN
  IF proposal.focus_version<>s.focus_version OR proposal.selection_version<>coalesce((SELECT max(version) FROM _dg_native_dining_selection_revisions WHERE session_id=s.id),0) OR s.dining_party_id IS DISTINCT FROM proposal.party_id THEN PERFORM dg_native_hospitality_error('AUTHORIZATION_CHANGED');END IF;RETURN previous.action_id;
 END IF;
 IF NOT coalesce(dg_native_service_live(proposal),false) THEN PERFORM dg_native_hospitality_error('AUTHORIZATION_CHANGED');END IF;
 operation_value:=dg_native_hospitality_apply_sourced('party',proposal.party_id,'create',jsonb_build_object('kind',proposal.kind,'note','','partyVersion',proposal.party_version,'focusVersion',s.focus_version,'selectionVersion',proposal.selection_version,'confirmed',true),s.id,token_value,csrf_value,s.focus_version,proposal.id);
 IF proposal.expires_at<=dg_native_dining_now() THEN PERFORM dg_native_hospitality_error('AUTHORIZATION_CHANGED');END IF;
 SELECT * INTO result_value FROM _dg_native_hospitality_results WHERE action_id=operation_value;IF result_value.resource_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Suggestion confirmation has one actual service result';END IF;
 INSERT INTO _dg_native_service_confirmations VALUES(proposal.id,operation_value,result_value.resource_id,dg_native_dining_now(),pg_current_xact_id()::text);RETURN operation_value;
END;$dg$;

ALTER FUNCTION dg_native_reception_project(text) RENAME TO dg_native_reception_project_before_service_suggestions;
CREATE FUNCTION dg_native_reception_project(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE value jsonb:=dg_native_reception_project_before_service_suggestions(target);messages_value jsonb;
BEGIN
 SELECT coalesce(jsonb_agg(e.item||jsonb_build_object('toolRequests',coalesce((SELECT jsonb_agg(jsonb_build_object('id',proposal.id,'name','restaurant.service_request','label','提交本次店员服务请求','preview','本组 · '||dg_native_service_name(proposal.kind)||'；仅保存店员服务请求，不执行下单、收款或退款。','status','proposed','expiresAt',proposal.expires_at) ORDER BY proposal.id) FROM _dg_native_service_suggestions proposal WHERE proposal.session_id=target AND proposal.reply_id=e.item->>'id' AND e.item->>'status'<>'cancelled' AND NOT EXISTS(SELECT 1 FROM _dg_native_service_confirmations confirmation WHERE confirmation.suggestion_id=proposal.id) AND dg_native_service_live(proposal)),'[]'::jsonb)) ORDER BY e.ordinal),'[]') INTO messages_value FROM jsonb_array_elements(value->'messages') WITH ORDINALITY e(item,ordinal);
 RETURN value||jsonb_build_object('messages',messages_value);
END;$dg$;

CREATE FUNCTION dg_native_service_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE proposal _dg_native_service_suggestions%ROWTYPE;s reception_sessions%ROWTYPE;p dining_parties%ROWTYPE;confirmation _dg_native_service_confirmations%ROWTYPE;r dining_service_requests%ROWTYPE;a _dg_native_dining_actions%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='_dg_native_service_suggestions' THEN
  proposal:=NEW;SELECT * INTO s FROM reception_sessions WHERE id=proposal.session_id;SELECT * INTO p FROM dining_parties WHERE id=proposal.party_id;
  IF proposal.runtime_id<>(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1) OR proposal.tenant_id<>s.tenant_id OR proposal.workspace_id<>s.workspace_id OR p.owner_session_id<>s.id OR p.restaurant_id<>proposal.restaurant_id OR proposal.transaction_id<>pg_current_xact_id()::text OR NOT coalesce(dg_native_service_source_valid(proposal),false) OR proposal.expires_at<>dg_native_people_iso(least(proposal.created_at::timestamptz+interval '60 seconds',s.expires_at::timestamptz)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Service suggestion binds its actual scoped typed or accepted-target source and original deadline';END IF;
 ELSE
  IF TG_TABLE_NAME='_dg_native_service_confirmations' THEN confirmation:=NEW;SELECT * INTO r FROM dining_service_requests WHERE id=confirmation.service_id;
  ELSE SELECT * INTO r FROM dining_service_requests WHERE id=NEW.id;IF r.source_request_id IS NULL THEN RETURN NULL;END IF;SELECT * INTO confirmation FROM _dg_native_service_confirmations WHERE suggestion_id=r.source_request_id;END IF;
  SELECT * INTO proposal FROM _dg_native_service_suggestions WHERE id=confirmation.suggestion_id;SELECT * INTO a FROM _dg_native_dining_actions WHERE id=confirmation.action_id;
  IF proposal.id IS NULL OR a.id IS NULL OR r.id IS NULL OR r.source_request_id IS DISTINCT FROM proposal.id OR r.id<>confirmation.service_id OR a.id<> (SELECT action_id FROM _dg_native_hospitality_origins WHERE resource_kind='service' AND resource_id=r.id) OR a.kind<>'hospitality_create' OR a.actor_type<>'guest' OR a.actor_id<>'guest:'||proposal.session_id OR a.session_id<>proposal.session_id OR a.focus_version<>proposal.focus_version OR a.selection_version<>proposal.selection_version OR r.party_id<>proposal.party_id OR r.restaurant_id<>proposal.restaurant_id OR r.kind<>proposal.kind OR r.note<>'' OR confirmation.transaction_id<>a.transaction_id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='A conversation service requires exactly its original confirmed suggestion and one scoped service action';END IF;
 END IF;RETURN NULL;
END;$dg$;
CREATE CONSTRAINT TRIGGER native_service_suggestion_guard AFTER INSERT ON _dg_native_service_suggestions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_service_guard();
CREATE CONSTRAINT TRIGGER native_service_confirmation_guard AFTER INSERT ON _dg_native_service_confirmations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_service_guard();
CREATE CONSTRAINT TRIGGER native_service_source_guard AFTER INSERT ON dining_service_requests DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_service_guard();
DO $dg$ DECLARE item record;BEGIN FOR item IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND p.proname LIKE 'dg_native_service_%' LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||item.signature||' FROM PUBLIC';END LOOP;END;$dg$;
REVOKE ALL ON FUNCTION dg_native_hospitality_apply_sourced(text,text,text,jsonb,text,text,text,bigint,text),dg_native_reception_project(text),dg_native_reception_project_before_service_suggestions(text) FROM PUBLIC;
