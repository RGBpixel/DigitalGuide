-- Append-only correction: include the established audit outcome column.
CREATE OR REPLACE FUNCTION dg_native_visual_grant(target text,token_hash_value text,csrf_hash_value text,input jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
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
 INSERT INTO audit_events(id,tenant_id,workspace_id,actor_id,action,resource_id,outcome,request_id,created_at) VALUES(gen_random_uuid()::text,s.tenant_id,s.workspace_id,'guest:'||s.id,'visual.granted.'||(input->>'source'),id_value,'confirmed',id_value,now_value);RETURN id_value;
END;$dg$;
CREATE OR REPLACE FUNCTION dg_native_visual_revoke(target text,token_hash_value text,csrf_hash_value text,input jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s reception_sessions%ROWTYPE;g visual_grants%ROWTYPE;
BEGIN
 PERFORM dg_native_reception_authorize(target,token_hash_value,csrf_hash_value,true);SELECT * INTO s FROM reception_sessions WHERE id=target;PERFORM dg_native_reception_fields(input,ARRAY['focusVersion','grantId','grantVersion']);IF input->>'focusVersion' IS DISTINCT FROM s.focus_version::text THEN PERFORM dg_native_visual_error('VERSION_CONFLICT');END IF;
 SELECT * INTO g FROM visual_grants WHERE id=input->>'grantId' AND session_id=target AND focus_version=s.focus_version;IF g.id IS NULL THEN PERFORM dg_native_visual_error('NOT_FOUND');END IF;
 IF g.status='active' THEN IF input->>'grantVersion' IS DISTINCT FROM g.version::text THEN PERFORM dg_native_visual_error('VERSION_CONFLICT');END IF;PERFORM dg_native_visual_revoke_internal(g.id,'participant_revoked');PERFORM dg_native_reception_cancel(target);UPDATE reception_sessions SET version=version+1,reply_epoch=reply_epoch+1 WHERE id=target;INSERT INTO audit_events(id,tenant_id,workspace_id,actor_id,action,resource_id,outcome,request_id,created_at) VALUES(gen_random_uuid()::text,s.tenant_id,s.workspace_id,'guest:'||s.id,'visual.revoked',g.id,'confirmed',g.id,dg_utc_now());END IF;RETURN g.id;
END;$dg$;
CREATE OR REPLACE FUNCTION dg_native_visual_begin(target text,token_hash_value text,csrf_hash_value text,key_hash_value text,input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
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
  INSERT INTO audit_events(id,tenant_id,workspace_id,actor_id,action,resource_id,outcome,request_id,created_at) VALUES(gen_random_uuid()::text,s.tenant_id,s.workspace_id,'guest:'||s.id,'visual.question_received',request_value,'confirmed',request_value,now_value);
 END IF;
 lease_value:=least(r.expires_at,dg_native_people_iso(now_value::timestamptz+interval '8 seconds'));
 INSERT INTO _dg_native_visual_attempts VALUES(gen_random_uuid()::text,request_value,coalesce(attempt_value.attempt,0)+1,lease_value,now_value) RETURNING * INTO attempt_value;
 RETURN jsonb_build_object('requestId',request_value,'attemptId',attempt_value.id,'leaseUntil',lease_value,'expiresAt',r.expires_at,'replay',false,'source',g.source,'provider',g.provider_id,'width',r.width,'height',r.height);
END;$dg$;
