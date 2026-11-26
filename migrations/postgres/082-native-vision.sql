-- R-092/R-128: explicitly authorized single frames. Pixels never enter SQL.
CREATE TABLE _dg_native_visual_grant_origins(
 grant_id text PRIMARY KEY REFERENCES visual_grants(id),access_id text NOT NULL REFERENCES _dg_native_reception_access(id),
 descriptor jsonb NOT NULL,created_at text NOT NULL,transaction_id text NOT NULL
);
CREATE TABLE _dg_native_visual_request_origins(
 request_id text PRIMARY KEY REFERENCES visual_requests(id),question_id text NOT NULL UNIQUE REFERENCES reception_messages(id),
 access_id text NOT NULL REFERENCES _dg_native_reception_access(id),descriptor jsonb NOT NULL,created_at text NOT NULL,transaction_id text NOT NULL
);
CREATE TABLE _dg_native_visual_attempts(
 id text PRIMARY KEY,request_id text NOT NULL REFERENCES visual_requests(id),attempt bigint NOT NULL CHECK(attempt BETWEEN 1 AND 2),
 lease_until text NOT NULL,created_at text NOT NULL,UNIQUE(request_id,attempt)
);
CREATE TABLE _dg_native_visual_results(
 request_id text PRIMARY KEY REFERENCES visual_requests(id),attempt_id text NOT NULL REFERENCES _dg_native_visual_attempts(id),
 reply_id text NOT NULL UNIQUE REFERENCES reception_messages(id) DEFERRABLE INITIALLY DEFERRED,
 text_hash text NOT NULL CHECK(text_hash ~ '^[a-f0-9]{64}$'),created_at text NOT NULL,transaction_id text NOT NULL
);
CREATE INDEX native_visual_attempt_deadline ON _dg_native_visual_attempts(lease_until);
ALTER TABLE visual_grants ADD CONSTRAINT native_visual_grant_shape CHECK(environment='mock' AND app_env IN('development','sandbox') AND source IN('camera','screen') AND provider_id='mock-vision' AND focus_version>=0 AND version>0 AND status IN('active','revoked','expired'));
ALTER TABLE visual_requests ADD CONSTRAINT native_visual_request_shape CHECK(status IN('pending','completed','cancelled','failed') AND focus_version>=0 AND reply_epoch>0 AND grant_version>0 AND width BETWEEN 1 AND 1024 AND height BETWEEN 1 AND 1024 AND width*height<=786432 AND image_hash ~ '^[a-f0-9]{64}$' AND key_hash ~ '^[a-f0-9]{64}$' AND request_hash ~ '^[a-f0-9]{64}$');
CREATE TRIGGER native_visual_grant_origin_immutable BEFORE UPDATE OR DELETE ON _dg_native_visual_grant_origins FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_visual_request_origin_immutable BEFORE UPDATE OR DELETE ON _dg_native_visual_request_origins FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_visual_attempt_immutable BEFORE UPDATE OR DELETE ON _dg_native_visual_attempts FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_visual_result_immutable BEFORE UPDATE OR DELETE ON _dg_native_visual_results FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();

CREATE FUNCTION dg_native_visual_error(code_value text) RETURNS void LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='DGVISION:'||code_value;END;$dg$;
CREATE FUNCTION dg_native_visual_policy(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE snapshot jsonb;current_value jsonb;provider_value text;
BEGIN
 SELECT o.scene::jsonb,a.config::jsonb INTO snapshot,current_value FROM _dg_native_reception_origins o LEFT JOIN scene_apps a ON a.id=o.scene::jsonb->>'id' WHERE o.session_id=target;
 provider_value:=coalesce(snapshot->>'visionProvider','disabled');
 RETURN jsonb_build_object('camera',coalesce(snapshot->'allowCamera'='true'::jsonb AND current_value->'allowCamera'='true'::jsonb AND current_value->>'visionProvider'=provider_value,false),'screen',coalesce(snapshot->'allowScreen'='true'::jsonb AND current_value->'allowScreen'='true'::jsonb AND current_value->>'visionProvider'=provider_value,false),'provider',provider_value,'configured',provider_value='mock-vision' AND dg_native_reception_source_valid(target));
END;$dg$;
CREATE FUNCTION dg_native_visual_grant_current(target text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT EXISTS(SELECT 1 FROM visual_grants g JOIN _dg_native_visual_grant_origins o ON o.grant_id=g.id JOIN reception_sessions s ON s.id=g.session_id JOIN _dg_native_reception_access a ON a.id=o.access_id
 WHERE g.id=target AND g.status='active' AND g.expires_at>dg_utc_now() AND s.status='active' AND s.focus_version=g.focus_version AND s.expires_at>dg_utc_now() AND s.activity_at>dg_native_people_iso(clock_timestamp()-interval '120 seconds') AND a.session_id=s.id AND a.access_version=s.access_version AND a.expires_at>dg_utc_now() AND dg_native_reception_source_valid(s.id) AND(dg_native_visual_policy(s.id)->>g.source)::boolean AND dg_native_visual_policy(s.id)->>'provider'=g.provider_id)
$dg$;
CREATE FUNCTION dg_native_visual_grant_projection(target text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT jsonb_build_object('id',g.id,'source',g.source,'provider',g.provider_id,'focusVersion',g.focus_version,'version',g.version,'status',g.status,'expiresAt',g.expires_at,'createdAt',g.created_at) FROM visual_grants g WHERE g.id=target
$dg$;
CREATE FUNCTION dg_native_visual_state(target text,token_hash_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE grant_value text;
BEGIN PERFORM dg_native_reception_authorize(target,token_hash_value,NULL,false);SELECT id INTO grant_value FROM visual_grants WHERE session_id=target AND dg_native_visual_grant_current(id);RETURN jsonb_build_object('grant',dg_native_visual_grant_projection(grant_value),'policy',dg_native_visual_policy(target),'storage','transient_frame_metadata_only','maxFrameBytes',1048576);END;$dg$;
CREATE FUNCTION dg_native_visual_revoke_internal(target text,reason_value text,expired_value boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 UPDATE visual_grants SET status=CASE WHEN expired_value THEN 'expired' ELSE 'revoked' END,version=version+1,revoked_at=dg_utc_now(),ended_reason=reason_value WHERE id=target AND status='active';
 UPDATE visual_requests SET status='cancelled',error_code='VISUAL_CONTEXT_REVOKED',completed_at=coalesce(completed_at,dg_utc_now()) WHERE grant_id=target AND status IN('pending','completed');
 UPDATE reception_messages m SET text='',status='cancelled' FROM _dg_native_visual_results v JOIN visual_requests r ON r.id=v.request_id WHERE r.grant_id=target AND m.id=v.reply_id AND(m.text<>'' OR m.status<>'cancelled');
END;$dg$;
CREATE FUNCTION dg_native_visual_context_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE candidate record;
BEGIN
 IF NEW.status<>'active' OR NEW.focus_version<>OLD.focus_version OR NEW.access_version<>OLD.access_version THEN FOR candidate IN SELECT id FROM visual_grants WHERE session_id=NEW.id AND status='active' LOOP PERFORM dg_native_visual_revoke_internal(candidate.id,'session_context_changed');END LOOP;
 ELSIF NEW.reply_epoch<>OLD.reply_epoch THEN UPDATE visual_requests SET status='cancelled',error_code='REQUEST_CANCELLED',completed_at=dg_utc_now() WHERE session_id=NEW.id AND status='pending' AND reply_epoch<>NEW.reply_epoch;END IF;RETURN NULL;
END;$dg$;
CREATE TRIGGER native_visual_context_changed AFTER UPDATE OF status,focus_version,access_version,reply_epoch ON reception_sessions FOR EACH ROW EXECUTE FUNCTION dg_native_visual_context_changed();
CREATE FUNCTION dg_native_visual_grant(target text,token_hash_value text,csrf_hash_value text,input jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s reception_sessions%ROWTYPE;a _dg_native_reception_access%ROWTYPE;policy jsonb;candidate record;id_value text:=gen_random_uuid()::text;now_value text:=dg_utc_now();expires_value text;had_old boolean;
BEGIN
 PERFORM dg_native_reception_authorize(target,token_hash_value,csrf_hash_value,true);SELECT * INTO s FROM reception_sessions WHERE id=target;
 PERFORM dg_native_reception_fields(input,ARRAY['version','focusVersion','source','consent','noticeVersion']);
 IF input->>'version' IS DISTINCT FROM s.version::text OR input->>'focusVersion' IS DISTINCT FROM s.focus_version::text THEN PERFORM dg_native_visual_error('VERSION_CONFLICT');END IF;
 IF s.status<>'active' OR coalesce(input->>'source','') NOT IN('camera','screen') OR input->'consent' IS DISTINCT FROM 'true'::jsonb OR input->>'noticeVersion' IS DISTINCT FROM 'vision-v1' THEN PERFORM dg_native_visual_error('VALIDATION_FAILED');END IF;
 policy:=dg_native_visual_policy(target);IF NOT coalesce((policy->>(input->>'source'))::boolean,false) THEN PERFORM dg_native_visual_error('CAPABILITY_UNAVAILABLE');END IF;IF policy->>'provider'<>'mock-vision' THEN PERFORM dg_native_visual_error('PROVIDER_NOT_CONFIGURED');END IF;
 IF(SELECT count(*) FROM visual_grants WHERE session_id=target AND created_at>dg_native_people_iso(clock_timestamp()-interval '60 seconds'))>=10 THEN PERFORM dg_native_visual_error('RATE_LIMITED');END IF;
 had_old:=EXISTS(SELECT 1 FROM visual_grants WHERE session_id=target AND status='active');FOR candidate IN SELECT id FROM visual_grants WHERE session_id=target AND status='active' LOOP PERFORM dg_native_visual_revoke_internal(candidate.id,'source_replaced');END LOOP;
 IF had_old THEN PERFORM dg_native_reception_cancel(target);END IF;
 SELECT * INTO a FROM _dg_native_reception_access WHERE session_id=target AND token_hash=token_hash_value AND access_version=s.access_version;
 expires_value:=least(s.expires_at,dg_native_people_iso(now_value::timestamptz+interval '300 seconds'));
 INSERT INTO visual_grants(id,session_id,tenant_id,workspace_id,environment,app_env,focus_version,source,provider_id,expires_at,created_at) VALUES(id_value,target,s.tenant_id,s.workspace_id,'mock',s.app_env,s.focus_version,input->>'source','mock-vision',expires_value,now_value);
 INSERT INTO _dg_native_visual_grant_origins VALUES(id_value,a.id,jsonb_build_object('sessionId',target,'focusVersion',s.focus_version,'source',input->>'source','provider','mock-vision','expiresAt',expires_value,'noticeVersion','vision-v1','consent',true),now_value,pg_current_xact_id()::text);
 UPDATE reception_sessions SET version=version+1,reply_epoch=reply_epoch+CASE WHEN had_old THEN 1 ELSE 0 END WHERE id=target;
 INSERT INTO audit_events VALUES(gen_random_uuid()::text,s.tenant_id,s.workspace_id,'guest:'||s.id,'visual.granted.'||(input->>'source'),id_value,id_value,now_value);RETURN id_value;
END;$dg$;
CREATE FUNCTION dg_native_visual_grant_view(target text,token_hash_value text,item text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN PERFORM dg_native_reception_authorize(target,token_hash_value,NULL,false);IF NOT EXISTS(SELECT 1 FROM visual_grants WHERE id=item AND session_id=target AND dg_native_visual_grant_current(id)) THEN PERFORM dg_native_visual_error('VISUAL_CONTEXT_REVOKED');END IF;RETURN dg_native_visual_grant_projection(item);END;$dg$;
CREATE FUNCTION dg_native_visual_revoke(target text,token_hash_value text,csrf_hash_value text,input jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s reception_sessions%ROWTYPE;g visual_grants%ROWTYPE;
BEGIN
 PERFORM dg_native_reception_authorize(target,token_hash_value,csrf_hash_value,true);SELECT * INTO s FROM reception_sessions WHERE id=target;PERFORM dg_native_reception_fields(input,ARRAY['focusVersion','grantId','grantVersion']);IF input->>'focusVersion' IS DISTINCT FROM s.focus_version::text THEN PERFORM dg_native_visual_error('VERSION_CONFLICT');END IF;
 SELECT * INTO g FROM visual_grants WHERE id=input->>'grantId' AND session_id=target AND focus_version=s.focus_version;IF g.id IS NULL THEN PERFORM dg_native_visual_error('NOT_FOUND');END IF;
 IF g.status='active' THEN IF input->>'grantVersion' IS DISTINCT FROM g.version::text THEN PERFORM dg_native_visual_error('VERSION_CONFLICT');END IF;PERFORM dg_native_visual_revoke_internal(g.id,'participant_revoked');PERFORM dg_native_reception_cancel(target);UPDATE reception_sessions SET version=version+1,reply_epoch=reply_epoch+1 WHERE id=target;INSERT INTO audit_events VALUES(gen_random_uuid()::text,s.tenant_id,s.workspace_id,'guest:'||s.id,'visual.revoked',g.id,g.id,dg_utc_now());END IF;RETURN g.id;
END;$dg$;

CREATE FUNCTION dg_native_visual_mock_reply(source_value text,width_value bigint,height_value bigint) RETURNS text LANGUAGE sql IMMUTABLE AS $dg$
 SELECT '【模拟画面检查】已接收您本次主动分享的'||CASE WHEN source_value='camera' THEN '相机' ELSE '屏幕' END||'画面（'||width_value::text||' × '||height_value::text||'）。当前未连接视觉理解服务，无法判断画面中的人物、文字或物品。您的问题可继续通过文字或人工接待处理。'
$dg$;
CREATE FUNCTION dg_native_visual_begin(target text,token_hash_value text,csrf_hash_value text,key_hash_value text,input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s reception_sessions%ROWTYPE;g visual_grants%ROWTYPE;r visual_requests%ROWTYPE;o _dg_native_visual_request_origins%ROWTYPE;a _dg_native_reception_access%ROWTYPE;attempt_value _dg_native_visual_attempts%ROWTYPE;hash_value text;question_value text;question_id text;request_value text:=gen_random_uuid()::text;now_value text:=dg_utc_now();lease_value text;
BEGIN
 PERFORM dg_native_reception_authorize(target,token_hash_value,csrf_hash_value,true);SELECT * INTO s FROM reception_sessions WHERE id=target;
 PERFORM dg_native_reception_fields(input,ARRAY['version','focusVersion','grantId','grantVersion','question','capturedAt','imageHash','width','height']);
 IF s.status<>'active' OR input->>'focusVersion' IS DISTINCT FROM s.focus_version::text THEN PERFORM dg_native_visual_error('VERSION_CONFLICT');END IF;
 SELECT * INTO g FROM visual_grants WHERE id=input->>'grantId' AND session_id=target;IF NOT dg_native_visual_grant_current(g.id) OR input->>'grantVersion' IS DISTINCT FROM g.version::text THEN PERFORM dg_native_visual_error('VISUAL_CONTEXT_REVOKED');END IF;
 question_value:=input->>'question';IF key_hash_value IS NULL OR key_hash_value !~ '^[a-f0-9]{64}$' OR jsonb_typeof(input->'question') IS DISTINCT FROM 'string' OR char_length(question_value) NOT BETWEEN 1 AND 500 OR question_value<>btrim(question_value) OR coalesce(input->>'imageHash','') !~ '^[a-f0-9]{64}$' OR jsonb_typeof(input->'width') IS DISTINCT FROM 'number' OR jsonb_typeof(input->'height') IS DISTINCT FROM 'number' OR(input->>'width')::bigint NOT BETWEEN 1 AND 1024 OR(input->>'height')::bigint NOT BETWEEN 1 AND 1024 OR(input->>'width')::bigint*(input->>'height')::bigint>786432 THEN PERFORM dg_native_visual_error('VALIDATION_FAILED');END IF;
 hash_value:=dg_native_office_hash((input-'question')||jsonb_build_object('questionHash',encode(sha256(convert_to(question_value,'UTF8')),'hex')));
 SELECT * INTO r FROM visual_requests WHERE session_id=target AND key_hash=key_hash_value;
 IF r.id IS NOT NULL THEN
  IF r.request_hash<>hash_value THEN PERFORM dg_native_visual_error('IDEMPOTENCY_CONFLICT');END IF;
  SELECT * INTO o FROM _dg_native_visual_request_origins WHERE request_id=r.id;
  IF o.access_id IS DISTINCT FROM(SELECT id FROM _dg_native_reception_access WHERE session_id=target AND token_hash=token_hash_value AND access_version=s.access_version) THEN PERFORM dg_native_visual_error('VISUAL_CONTEXT_REVOKED');END IF;
  IF r.status='completed' THEN RETURN jsonb_build_object('requestId',r.id,'replay',true);END IF;
  IF r.status<>'pending' THEN PERFORM dg_native_visual_error('REQUEST_CANCELLED');END IF;
  SELECT * INTO attempt_value FROM _dg_native_visual_attempts WHERE request_id=r.id ORDER BY attempt DESC LIMIT 1;
  IF r.expires_at<=now_value OR r.reply_epoch<>s.reply_epoch OR r.focus_version<>s.focus_version THEN PERFORM dg_native_visual_error('VISION_TIMEOUT');END IF;
  IF attempt_value.lease_until>now_value THEN PERFORM dg_native_visual_error('REQUEST_IN_PROGRESS');END IF;
  IF attempt_value.attempt>=2 THEN PERFORM dg_native_visual_error('VISION_TIMEOUT');END IF;request_value:=r.id;
 ELSE
  IF input->>'version' IS DISTINCT FROM s.version::text THEN PERFORM dg_native_visual_error('VERSION_CONFLICT');END IF;
  IF(input->>'capturedAt')::timestamptz<clock_timestamp()-interval '10 seconds' OR(input->>'capturedAt')::timestamptz>clock_timestamp()+interval '2 seconds' THEN PERFORM dg_native_visual_error('FRAME_EXPIRED');END IF;
  IF EXISTS(SELECT 1 FROM visual_requests WHERE session_id=target AND status='pending') THEN PERFORM dg_native_visual_error('REQUEST_IN_PROGRESS');END IF;
  IF(SELECT count(*) FROM visual_requests WHERE session_id=target AND created_at>dg_native_people_iso(clock_timestamp()-interval '60 seconds'))>=12 OR(SELECT count(*) FROM reception_messages WHERE session_id=target AND role='visitor' AND created_at>dg_native_people_iso(clock_timestamp()-interval '60 seconds'))>=20 THEN PERFORM dg_native_visual_error('RATE_LIMITED');END IF;
  IF(SELECT count(*) FROM reception_messages WHERE session_id=target)+2>200 THEN PERFORM dg_native_visual_error('QUOTA_EXCEEDED');END IF;
  PERFORM dg_native_reception_cancel(target);question_id:=dg_native_reception_add_message(target,'visitor',question_value,'received',s.reply_epoch+1,s.focus_version);
  INSERT INTO visual_requests(id,session_id,grant_id,key_hash,request_hash,focus_version,reply_epoch,grant_version,image_hash,width,height,created_at,expires_at) VALUES(request_value,target,g.id,key_hash_value,hash_value,s.focus_version,s.reply_epoch+1,g.version,input->>'imageHash',(input->>'width')::bigint,(input->>'height')::bigint,now_value,dg_native_people_iso(now_value::timestamptz+interval '15 seconds')) RETURNING * INTO r;
  SELECT * INTO a FROM _dg_native_reception_access WHERE session_id=target AND token_hash=token_hash_value AND access_version=s.access_version;
  INSERT INTO _dg_native_visual_request_origins VALUES(request_value,question_id,a.id,jsonb_build_object('requestHash',hash_value,'questionHash',encode(sha256(convert_to(question_value,'UTF8')),'hex'),'capturedAt',input->>'capturedAt','sessionId',target,'grantId',g.id,'focusVersion',s.focus_version,'replyEpoch',r.reply_epoch,'imageHash',r.image_hash,'width',r.width,'height',r.height,'expiresAt',r.expires_at),now_value,pg_current_xact_id()::text);
  UPDATE reception_sessions SET version=version+1,reply_epoch=r.reply_epoch,activity_at=now_value WHERE id=target;
  INSERT INTO audit_events VALUES(gen_random_uuid()::text,s.tenant_id,s.workspace_id,'guest:'||s.id,'visual.question_received',request_value,request_value,now_value);
 END IF;
 lease_value:=least(r.expires_at,dg_native_people_iso(now_value::timestamptz+interval '8 seconds'));
 INSERT INTO _dg_native_visual_attempts VALUES(gen_random_uuid()::text,request_value,coalesce(attempt_value.attempt,0)+1,lease_value,now_value) RETURNING * INTO attempt_value;
 RETURN jsonb_build_object('requestId',request_value,'attemptId',attempt_value.id,'leaseUntil',lease_value,'expiresAt',r.expires_at,'replay',false,'source',g.source,'provider',g.provider_id,'width',r.width,'height',r.height);
END;$dg$;
CREATE FUNCTION dg_native_visual_execution_valid(target text,attempt_value text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT EXISTS(SELECT 1 FROM visual_requests r JOIN _dg_native_visual_attempts a ON a.request_id=r.id JOIN reception_sessions s ON s.id=r.session_id WHERE r.id=target AND a.id=attempt_value AND a.attempt=(SELECT max(attempt) FROM _dg_native_visual_attempts WHERE request_id=target) AND a.lease_until>dg_utc_now() AND r.status='pending' AND r.expires_at>dg_utc_now() AND s.focus_version=r.focus_version AND s.reply_epoch=r.reply_epoch AND dg_native_visual_grant_current(r.grant_id))
$dg$;
CREATE FUNCTION dg_native_visual_reference(target text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT jsonb_build_object('requestId',r.id,'grantId',g.id,'source',g.source,'provider',g.provider_id,'simulated',true,'width',r.width,'height',r.height,'expiresAt',g.expires_at) FROM visual_requests r JOIN visual_grants g ON g.id=r.grant_id WHERE r.id=target
$dg$;
CREATE FUNCTION dg_native_visual_message_valid(m reception_messages) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT EXISTS(SELECT 1 FROM _dg_native_visual_results v JOIN visual_requests r ON r.id=v.request_id JOIN _dg_native_visual_request_origins o ON o.request_id=r.id WHERE v.reply_id=m.id AND m.session_id=r.session_id AND m.focus_version=r.focus_version AND m.reply_epoch=r.reply_epoch AND m.role='assistant' AND m.input_source='system' AND m.speaker_decision_id IS NULL AND m.memory_person_id IS NULL AND m.visual_context::jsonb=dg_native_visual_reference(r.id) AND(m.text='' AND m.status='cancelled' OR encode(sha256(convert_to(m.text,'UTF8')),'hex')=v.text_hash))
$dg$;
CREATE FUNCTION dg_native_visual_complete(target text,token_hash_value text,csrf_hash_value text,item text,attempt_value text,result_value jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s reception_sessions%ROWTYPE;r visual_requests%ROWTYPE;g visual_grants%ROWTYPE;reply_value text:=gen_random_uuid()::text;text_value text;
BEGIN
 PERFORM dg_native_reception_authorize(target,token_hash_value,csrf_hash_value,true);SELECT * INTO s FROM reception_sessions WHERE id=target;SELECT * INTO r FROM visual_requests WHERE id=item AND session_id=target;
 IF r.id IS NULL OR NOT dg_native_visual_execution_valid(item,attempt_value) THEN PERFORM dg_native_visual_error('VISUAL_CONTEXT_REVOKED');END IF;
 SELECT * INTO g FROM visual_grants WHERE id=r.grant_id;PERFORM dg_native_reception_fields(result_value,ARRAY['text','simulated']);text_value:=result_value->>'text';
 IF result_value->'simulated' IS DISTINCT FROM 'true'::jsonb OR text_value IS DISTINCT FROM dg_native_visual_mock_reply(g.source,r.width,r.height) THEN PERFORM dg_native_visual_error('PROVIDER_CONTRACT_INVALID');END IF;
 INSERT INTO _dg_native_visual_results VALUES(item,attempt_value,reply_value,encode(sha256(convert_to(text_value,'UTF8')),'hex'),dg_utc_now(),pg_current_xact_id()::text);
 INSERT INTO reception_messages(id,session_id,tenant_id,workspace_id,role,text,status,reply_epoch,focus_version,created_at,knowledge_citations,input_source,visual_context) VALUES(reply_value,target,s.tenant_id,s.workspace_id,'assistant',text_value,'ready',r.reply_epoch,r.focus_version,dg_utc_now(),'[]','system',dg_native_visual_reference(item)::text);
 INSERT INTO _dg_native_reception_message_digests VALUES(reply_value,dg_native_office_hash(dg_native_reception_message_payload(reply_value)));
 UPDATE visual_requests SET status='completed',reply_id=reply_value,completed_at=dg_utc_now() WHERE id=item;
 UPDATE reception_sessions SET version=version+1 WHERE id=target;
 INSERT INTO outbox_events VALUES(gen_random_uuid()::text,s.tenant_id,s.workspace_id,item,'visual.answer_ready','mock','{}',dg_utc_now(),NULL);
END;$dg$;
CREATE FUNCTION dg_native_visual_fail(target text,attempt_value text,code_value text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN PERFORM dg_native_reception_runtime();IF coalesce(code_value,'') NOT IN('VISION_TIMEOUT','REQUEST_CANCELLED','VISUAL_CONTEXT_REVOKED','PROVIDER_CONTRACT_INVALID','VISION_PROVIDER_FAILED') THEN code_value:='VISION_PROVIDER_FAILED';END IF;UPDATE visual_requests SET status='failed',error_code=code_value,completed_at=dg_utc_now() WHERE id=target AND status='pending' AND attempt_value=(SELECT id FROM _dg_native_visual_attempts WHERE request_id=target ORDER BY attempt DESC LIMIT 1);END;$dg$;

CREATE FUNCTION dg_native_visual_record_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Visual metadata retains its immutable origin';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'active' AND TG_TABLE_NAME='visual_grants' OR NEW.status<>'pending' AND TG_TABLE_NAME='visual_requests' OR TG_TABLE_NAME='visual_grants' AND((to_jsonb(NEW)->>'version')::bigint<>1 OR to_jsonb(NEW)->>'revoked_at' IS NOT NULL OR to_jsonb(NEW)->>'ended_reason' IS NOT NULL) OR TG_TABLE_NAME='visual_requests' AND(to_jsonb(NEW)->>'reply_id' IS NOT NULL OR to_jsonb(NEW)->>'completed_at' IS NOT NULL OR to_jsonb(NEW)->>'error_code' IS NOT NULL) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Visual records start only from the bound initial state';END IF;
 ELSE
  IF TG_TABLE_NAME='visual_grants' THEN IF OLD.status<>'active' OR NEW.status NOT IN('revoked','expired') OR NEW.version<>OLD.version+1 OR NEW.revoked_at IS NULL OR NEW.ended_reason IS NULL OR to_jsonb(NEW)-ARRAY['status','version','revoked_at','ended_reason'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['status','version','revoked_at','ended_reason'] THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Visual grant scope and original expiry cannot change';END IF;
  ELSE IF OLD.status NOT IN('pending','completed') OR OLD.status='completed' AND NEW.status<>'cancelled' OR NEW.status NOT IN('completed','cancelled','failed') OR NEW.completed_at IS NULL OR NEW.status='completed' AND NEW.reply_id IS NULL OR NEW.status<>'completed' AND NEW.error_code IS NULL OR to_jsonb(NEW)-ARRAY['status','reply_id','error_code','completed_at'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['status','reply_id','error_code','completed_at'] OR OLD.reply_id IS NOT NULL AND NEW.reply_id IS DISTINCT FROM OLD.reply_id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Visual request cannot restart, retarget or extend its original clocks';END IF;END IF;
 END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_visual_grant_guard BEFORE INSERT OR UPDATE OR DELETE ON visual_grants FOR EACH ROW EXECUTE FUNCTION dg_native_visual_record_guard();
CREATE TRIGGER native_visual_request_guard BEFORE INSERT OR UPDATE OR DELETE ON visual_requests FOR EACH ROW EXECUTE FUNCTION dg_native_visual_record_guard();
CREATE FUNCTION dg_native_visual_final() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE item text;g visual_grants%ROWTYPE;r visual_requests%ROWTYPE;o _dg_native_visual_request_origins%ROWTYPE;v _dg_native_visual_results%ROWTYPE;m reception_messages%ROWTYPE;origin _dg_native_visual_grant_origins%ROWTYPE;a _dg_native_visual_attempts%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME IN('visual_grants','_dg_native_visual_grant_origins') THEN
  item:=coalesce(to_jsonb(NEW)->>'grant_id',to_jsonb(NEW)->>'id');SELECT * INTO g FROM visual_grants WHERE id=item;SELECT * INTO origin FROM _dg_native_visual_grant_origins WHERE grant_id=item;
  IF origin.grant_id IS NULL OR NOT EXISTS(SELECT 1 FROM reception_sessions s JOIN _dg_native_reception_access x ON x.id=origin.access_id WHERE s.id=g.session_id AND x.session_id=s.id AND g.tenant_id=s.tenant_id AND g.workspace_id=s.workspace_id AND g.app_env=s.app_env) OR origin.descriptor->>'sessionId' IS DISTINCT FROM g.session_id OR origin.descriptor->>'focusVersion' IS DISTINCT FROM g.focus_version::text OR origin.descriptor->>'source' IS DISTINCT FROM g.source OR origin.descriptor->>'provider' IS DISTINCT FROM g.provider_id OR origin.descriptor->>'expiresAt' IS DISTINCT FROM g.expires_at OR origin.descriptor->'consent' IS DISTINCT FROM 'true'::jsonb OR origin.descriptor->>'noticeVersion' IS DISTINCT FROM 'vision-v1' OR g.expires_at>dg_native_people_iso(g.created_at::timestamptz+interval '300 seconds') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Visual grant and explicit consent scope must commit together';END IF;RETURN NULL;
 END IF;
 item:=coalesce(to_jsonb(NEW)->>'request_id',to_jsonb(NEW)->>'id');SELECT * INTO r FROM visual_requests WHERE id=item;SELECT * INTO o FROM _dg_native_visual_request_origins WHERE request_id=item;SELECT * INTO v FROM _dg_native_visual_results WHERE request_id=item;SELECT * INTO m FROM reception_messages WHERE id=o.question_id;
 IF r.id IS NULL OR o.request_id IS NULL OR m.id IS NULL OR m.role<>'visitor' OR m.input_source<>'typed' OR m.session_id<>r.session_id OR m.focus_version<>r.focus_version OR m.reply_epoch<>r.reply_epoch OR m.text<>'' AND encode(sha256(convert_to(m.text,'UTF8')),'hex') IS DISTINCT FROM o.descriptor->>'questionHash' OR o.descriptor->>'requestHash' IS DISTINCT FROM r.request_hash OR o.descriptor->>'imageHash' IS DISTINCT FROM r.image_hash OR o.descriptor->>'grantId' IS DISTINCT FROM r.grant_id OR o.descriptor->>'width' IS DISTINCT FROM r.width::text OR o.descriptor->>'height' IS DISTINCT FROM r.height::text OR o.descriptor->>'expiresAt' IS DISTINCT FROM r.expires_at OR extract(epoch FROM r.expires_at::timestamptz-r.created_at::timestamptz)<>15 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Visual request, original frame metadata and typed question must commit together';END IF;
 IF NOT EXISTS(SELECT 1 FROM _dg_native_visual_attempts WHERE request_id=item) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Visual request needs its bounded original execution';END IF;
 IF r.status='completed' OR r.reply_id IS NOT NULL THEN IF v.request_id IS NULL OR v.reply_id IS DISTINCT FROM r.reply_id OR NOT EXISTS(SELECT 1 FROM reception_messages x WHERE x.id=v.reply_id AND dg_native_visual_message_valid(x)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Completed visual reply must retain its original result proof';END IF;END IF;
 FOR a IN SELECT * FROM _dg_native_visual_attempts WHERE request_id=item LOOP IF a.lease_until>r.expires_at OR a.lease_until>dg_native_people_iso(a.created_at::timestamptz+interval '8 seconds') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Visual attempt cannot renew the original request deadline';END IF;END LOOP;RETURN NULL;
END;$dg$;
CREATE CONSTRAINT TRIGGER native_visual_grant_final AFTER INSERT OR UPDATE ON visual_grants DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_visual_final();
CREATE CONSTRAINT TRIGGER native_visual_grant_origin_final AFTER INSERT ON _dg_native_visual_grant_origins DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_visual_final();
CREATE CONSTRAINT TRIGGER native_visual_request_final AFTER INSERT OR UPDATE ON visual_requests DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_visual_final();
CREATE CONSTRAINT TRIGGER native_visual_request_origin_final AFTER INSERT ON _dg_native_visual_request_origins DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_visual_final();
CREATE CONSTRAINT TRIGGER native_visual_attempt_final AFTER INSERT ON _dg_native_visual_attempts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_visual_final();
CREATE CONSTRAINT TRIGGER native_visual_result_final AFTER INSERT ON _dg_native_visual_results DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_visual_final();

ALTER FUNCTION dg_native_reception_project(text) RENAME TO dg_native_reception_project_before_visual;
CREATE FUNCTION dg_native_reception_project(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE value jsonb;messages_value jsonb;
BEGIN
 value:=dg_native_reception_project_before_visual(target);
 SELECT coalesce(jsonb_agg(CASE WHEN m.visual_context IS NULL THEN e.item WHEN e.item->>'text'<>'' AND r.status='completed' AND dg_native_visual_grant_current(r.grant_id) THEN e.item||jsonb_build_object('visualContext',m.visual_context::jsonb) ELSE e.item||jsonb_build_object('text','','status','cancelled','visualContext',NULL) END ORDER BY e.ordinal),'[]') INTO messages_value FROM jsonb_array_elements(value->'messages') WITH ORDINALITY e(item,ordinal) JOIN reception_messages m ON m.id=e.item->>'id' LEFT JOIN _dg_native_visual_results v ON v.reply_id=m.id LEFT JOIN visual_requests r ON r.id=v.request_id;
 RETURN value||jsonb_build_object('messages',messages_value);
END;$dg$;
ALTER FUNCTION dg_native_guest_memory_message_valid(text) RENAME TO dg_native_guest_memory_message_valid_before_visual;
CREATE FUNCTION dg_native_guest_memory_message_valid(target text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT dg_native_guest_memory_message_valid_before_visual(target) AND NOT EXISTS(SELECT 1 FROM reception_messages m WHERE m.id=target AND m.visual_context IS NOT NULL AND NOT EXISTS(SELECT 1 FROM _dg_native_visual_results v JOIN visual_requests r ON r.id=v.request_id WHERE v.reply_id=m.id AND r.status='completed' AND dg_native_visual_grant_current(r.grant_id)))
$dg$;
CREATE FUNCTION dg_native_visual_sweep() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE candidate record;terminal_value text;count_value bigint:=0;changed bigint;
BEGIN
 PERFORM dg_native_reception_runtime(true);
 FOR candidate IN SELECT DISTINCT s.id,s.tenant_id,s.workspace_id,s.terminal_id FROM reception_sessions s JOIN visual_grants g ON g.session_id=s.id WHERE g.status='active' OR EXISTS(SELECT 1 FROM visual_requests r WHERE r.session_id=s.id AND r.status='pending') ORDER BY s.tenant_id,s.workspace_id,s.terminal_id,s.id LOOP
  IF NOT pg_try_advisory_xact_lock_shared(hashtextextended('native-reception-workspace:'||candidate.tenant_id||':'||candidate.workspace_id,0)) THEN CONTINUE;END IF;
  terminal_value:=NULL;SELECT id INTO terminal_value FROM reception_terminals WHERE id=candidate.terminal_id FOR UPDATE SKIP LOCKED;IF terminal_value IS NULL THEN CONTINUE;END IF;PERFORM id FROM reception_sessions WHERE id=candidate.id FOR UPDATE;
  FOR terminal_value IN SELECT id FROM visual_grants WHERE session_id=candidate.id AND status='active' AND NOT dg_native_visual_grant_current(id) LOOP PERFORM dg_native_visual_revoke_internal(terminal_value,'expired_or_context_changed',true);count_value:=count_value+1;END LOOP;
  UPDATE visual_requests SET status='failed',error_code='VISION_TIMEOUT',completed_at=dg_utc_now() WHERE session_id=candidate.id AND status='pending' AND expires_at<=dg_utc_now();GET DIAGNOSTICS changed=ROW_COUNT;count_value:=count_value+changed;
 END LOOP;RETURN count_value;
END;$dg$;
ALTER FUNCTION dg_native_reception_sweep() RENAME TO dg_native_reception_sweep_before_visual;
CREATE FUNCTION dg_native_reception_sweep() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN RETURN dg_native_reception_sweep_before_visual()+dg_native_visual_sweep();END;$dg$;
ALTER FUNCTION dg_native_people_erase_internal(text,text) RENAME TO dg_native_people_erase_before_visual;
CREATE FUNCTION dg_native_people_erase_internal(target text,reason_value text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE linked record;item text;
BEGIN
 FOR linked IN SELECT DISTINCT s.id,s.tenant_id,s.workspace_id,s.terminal_id FROM reception_sessions s JOIN memory_session_links l ON l.session_id=s.id WHERE l.person_id=target ORDER BY s.tenant_id,s.workspace_id,s.terminal_id,s.id LOOP
  PERFORM dg_native_reception_workspace(linked.tenant_id,linked.workspace_id,true);PERFORM id FROM reception_terminals WHERE id=linked.terminal_id FOR UPDATE;PERFORM id FROM reception_sessions WHERE id=linked.id FOR UPDATE;FOR item IN SELECT id FROM visual_grants WHERE session_id=linked.id AND status='active' LOOP PERFORM dg_native_visual_revoke_internal(item,'privacy_erased');END LOOP;
 END LOOP;RETURN dg_native_people_erase_before_visual(target,reason_value);
END;$dg$;
DO $dg$ DECLARE r record;BEGIN FOR r IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND p.proname LIKE 'dg_native_visual_%' LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||r.signature||' FROM PUBLIC';END LOOP;END;$dg$;
REVOKE ALL ON FUNCTION dg_native_reception_project(text),dg_native_reception_project_before_visual(text),dg_native_guest_memory_message_valid(text),dg_native_guest_memory_message_valid_before_visual(text),dg_native_reception_sweep(),dg_native_reception_sweep_before_visual(),dg_native_people_erase_internal(text,text),dg_native_people_erase_before_visual(text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION dg_native_reception_message_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE v_session reception_sessions%ROWTYPE;
BEGIN
 SELECT * INTO v_session FROM reception_sessions WHERE id=NEW.session_id;
 IF v_session.id IS NULL OR NEW.tenant_id<>v_session.tenant_id OR NEW.workspace_id<>v_session.workspace_id OR (NEW.memory_person_id IS NULL AND(NEW.memory_fact_ids<>'[]' OR NEW.native_memory_version IS NOT NULL)) OR(NEW.memory_person_id IS NOT NULL AND(NEW.role<>'assistant' OR NEW.native_memory_version IS NULL OR NEW.native_memory_version<1 OR jsonb_typeof(NEW.memory_fact_ids::jsonb)<>'array')) OR(NEW.visual_context IS NOT NULL AND NOT dg_native_visual_message_valid(NEW)) OR NEW.restaurant_context IS NOT NULL OR(NEW.speaker_decision_id IS NULL AND NEW.input_source IS DISTINCT FROM(CASE WHEN NEW.role='visitor' THEN 'typed' ELSE 'system' END)) OR(NEW.speaker_decision_id IS NOT NULL AND NOT dg_native_speaker_message_valid(NEW)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Reception message needs its bound session and supported input proof';END IF;
 IF TG_OP='INSERT' THEN IF NEW.speaker_decision_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM _dg_native_speaker_event_origins WHERE decision_id=NEW.speaker_decision_id AND transaction_id=pg_current_xact_id()::text) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Audio messages must be inserted in their originating event transaction';END IF;IF NEW.memory_person_id IS NOT NULL AND NOT dg_native_guest_memory_proof(NEW.session_id,NEW.focus_version,jsonb_build_object('personId',NEW.memory_person_id,'version',NEW.native_memory_version,'factIds',NEW.memory_fact_ids::jsonb)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Personalized reply requires the current explicitly confirmed subject and facts';END IF;IF NEW.focus_version<>v_session.focus_version OR NEW.reply_epoch NOT BETWEEN v_session.reply_epoch AND v_session.reply_epoch+1 OR NEW.status IS DISTINCT FROM(CASE WHEN NEW.role='assistant' THEN 'ready' ELSE 'received' END) OR char_length(NEW.text)=0 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Reception message starts from the current typed turn or fixed greeting';END IF;
 ELSE
  IF to_jsonb(NEW)-ARRAY['text','status','knowledge_citations'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['text','status','knowledge_citations'] OR OLD.status='cancelled' AND NEW.status<>'cancelled' OR NEW.text IS DISTINCT FROM OLD.text AND NEW.text<>'' OR NEW.knowledge_citations IS DISTINCT FROM OLD.knowledge_citations AND NEW.knowledge_citations<>'[]' OR NEW.text='' AND NEW.status<>'cancelled' OR NEW.text<>'' AND NEW.knowledge_citations IS DISTINCT FROM OLD.knowledge_citations THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Messages cannot be retargeted, rewritten or replayed after cancellation';END IF;
  IF NEW.text<>'' AND NOT(NEW.status=OLD.status OR NEW.role='assistant' AND((OLD.status='ready' AND NEW.status IN('playing','cancelled')) OR(OLD.status='playing' AND NEW.status IN('completed','cancelled')) OR(OLD.status='completed' AND NEW.status='cancelled'))) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Unsupported reply playback transition';END IF;
 END IF;RETURN NEW;
END;$dg$;
