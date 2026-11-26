-- Voluntary completed-visit feedback and independently encrypted followup consent.
-- No contact delivery, order, payment, identity grant, memory, or LLM action is performed.
CREATE TABLE _dg_native_aftercare_actions(
 id text PRIMARY KEY,runtime_id text NOT NULL,restaurant_id text NOT NULL REFERENCES restaurants(id),party_id text NOT NULL REFERENCES dining_parties(id),tenant_id text NOT NULL,workspace_id text NOT NULL,
 actor_type text NOT NULL CHECK(actor_type IN('guest','privacy','worker')),actor_id text NOT NULL,session_id text REFERENCES reception_sessions(id),access_id text REFERENCES _dg_native_reception_access(id),focus_version bigint,selection_version bigint,
 party_version bigint NOT NULL,party_access_version bigint NOT NULL,resource_kind text NOT NULL CHECK(resource_kind IN('feedback','followup')),resource_id text NOT NULL,resource_version bigint NOT NULL CHECK(resource_version>0),
 operation text NOT NULL CHECK(operation IN('save','revoke','expire')),credential_nonce text NOT NULL,expires_at text NOT NULL,body_hash text NOT NULL CHECK(body_hash~'^[a-f0-9]{64}$'),created_at text NOT NULL,transaction_id text NOT NULL,
 UNIQUE(resource_kind,resource_id,resource_version)
);
CREATE TABLE _dg_native_aftercare_origins(
 resource_kind text NOT NULL,resource_id text NOT NULL,party_id text NOT NULL REFERENCES dining_parties(id),restaurant_id text NOT NULL REFERENCES restaurants(id),runtime_id text NOT NULL,first_action_id text NOT NULL REFERENCES _dg_native_aftercare_actions(id),created_at text NOT NULL,
 PRIMARY KEY(resource_kind,resource_id),UNIQUE(resource_kind,party_id)
);
CREATE TABLE _dg_native_aftercare_credentials(
 resource_kind text NOT NULL,resource_id text NOT NULL,resource_version bigint NOT NULL CHECK(resource_version>0),nonce text NOT NULL,token_hash text NOT NULL CHECK(token_hash~'^[a-f0-9]{64}$'),expires_at text NOT NULL,status text NOT NULL CHECK(status IN('active','withdrawn','expired')),
 action_id text NOT NULL REFERENCES _dg_native_aftercare_actions(id),created_at text NOT NULL,updated_at text NOT NULL,PRIMARY KEY(resource_kind,resource_id),FOREIGN KEY(resource_kind,resource_id) REFERENCES _dg_native_aftercare_origins(resource_kind,resource_id)
);
CREATE TABLE _dg_native_aftercare_revisions(
 resource_kind text NOT NULL,resource_id text NOT NULL,version bigint NOT NULL CHECK(version>0),action_id text NOT NULL UNIQUE REFERENCES _dg_native_aftercare_actions(id),row_hash text NOT NULL CHECK(row_hash~'^[a-f0-9]{64}$'),created_at text NOT NULL,transaction_id text NOT NULL,
 PRIMARY KEY(resource_kind,resource_id,version),FOREIGN KEY(resource_kind,resource_id) REFERENCES _dg_native_aftercare_origins(resource_kind,resource_id)
);
CREATE TABLE _dg_native_aftercare_limits(scope_hash text PRIMARY KEY CHECK(scope_hash~'^[a-f0-9]{64}$'),window_start text NOT NULL,attempts bigint NOT NULL CHECK(attempts BETWEEN 1 AND 30),updated_at text NOT NULL);
CREATE TRIGGER native_aftercare_action_immutable BEFORE UPDATE OR DELETE ON _dg_native_aftercare_actions FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_aftercare_origin_immutable BEFORE UPDATE OR DELETE ON _dg_native_aftercare_origins FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_aftercare_revision_immutable BEFORE UPDATE OR DELETE ON _dg_native_aftercare_revisions FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
ALTER TABLE dining_feedback ADD CONSTRAINT native_aftercare_feedback_shape CHECK(status IN('active','withdrawn','expired') AND version>0 AND char_length(comment)<=800 AND(rating IS NULL OR rating BETWEEN 1 AND 5) AND(status='active' OR rating IS NULL AND comment='')) NOT VALID;
ALTER TABLE dining_followup_consents ADD CONSTRAINT native_aftercare_followup_shape CHECK(status IN('active','withdrawn','expired') AND version>0 AND char_length(contact_mask)<=160 AND(status='active' AND contact_cipher IS NOT NULL AND contact_cipher~'^NAC1[.][A-Za-z0-9_-]{40,1500}$' AND char_length(contact_mask)>0 OR status='withdrawn' AND contact_cipher IS NULL AND contact_mask='已撤回' OR status='expired' AND contact_cipher IS NULL AND contact_mask='已到期')) NOT VALID;

CREATE FUNCTION dg_native_aftercare_error(code_value text) RETURNS void LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$ BEGIN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='DGAFTERCARE:'||code_value;END;$dg$;
-- Pure boundary predicate; write paths always provide their actual server wall clock.
CREATE FUNCTION dg_native_aftercare_due(expires_value text,now_value text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path FROM CURRENT AS $dg$ SELECT expires_value::timestamptz<=now_value::timestamptz $dg$;
CREATE FUNCTION dg_native_aftercare_attempt(scope_value text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE previous _dg_native_aftercare_limits%ROWTYPE;now_value text;
BEGIN
 PERFORM dg_native_reception_runtime(true);IF scope_value IS NULL OR scope_value!~'^[a-f0-9]{64}$' THEN PERFORM dg_native_aftercare_error('VALIDATION_FAILED');END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('native-aftercare-rate:'||scope_value,0));SELECT * INTO previous FROM _dg_native_aftercare_limits WHERE scope_hash=scope_value FOR UPDATE;now_value:=dg_native_dining_now();
 IF previous.scope_hash IS NOT NULL AND previous.window_start::timestamptz+interval '60 seconds'>now_value::timestamptz THEN IF previous.attempts>=30 THEN RETURN false;END IF;UPDATE _dg_native_aftercare_limits SET attempts=attempts+1,updated_at=now_value WHERE scope_hash=scope_value;
 ELSE INSERT INTO _dg_native_aftercare_limits VALUES(scope_value,now_value,1,now_value) ON CONFLICT(scope_hash) DO UPDATE SET window_start=EXCLUDED.window_start,attempts=1,updated_at=EXCLUDED.updated_at;END IF;
 DELETE FROM _dg_native_aftercare_limits WHERE scope_hash IN(SELECT scope_hash FROM _dg_native_aftercare_limits WHERE updated_at<dg_native_people_iso(clock_timestamp()-interval '10 minutes') ORDER BY updated_at LIMIT 100 FOR UPDATE SKIP LOCKED);RETURN true;
END;$dg$;
CREATE FUNCTION dg_native_aftercare_context(party_value text,session_value text DEFAULT NULL,token_value text DEFAULT NULL,csrf_value text DEFAULT NULL,focus_value bigint DEFAULT NULL,write_value boolean DEFAULT false,selection_value bigint DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;
BEGIN
 IF write_value AND session_value IS NULL THEN PERFORM dg_native_aftercare_error('FORBIDDEN');END IF;
 meta:=dg_native_hospitality_context('party',party_value,session_value,token_value,csrf_value,focus_value,write_value,selection_value);
 IF write_value AND meta->>'partyStatus'<>'completed' THEN PERFORM dg_native_aftercare_error('DINING_NOT_ENDED');END IF;
 RETURN meta;
END;$dg$;

CREATE FUNCTION dg_native_aftercare_descriptor(a _dg_native_aftercare_actions) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT jsonb_build_object('actionId',a.id,'runtimeId',a.runtime_id,'tenantId',a.tenant_id,'workspaceId',a.workspace_id,'restaurantId',a.restaurant_id,'partyId',a.party_id,'kind',a.resource_kind,'id',a.resource_id,'version',a.resource_version,'nonce',a.credential_nonce,'expiresAt',a.expires_at)
$dg$;

CREATE FUNCTION dg_native_aftercare_input(kind_value text,operation_value text,input jsonb) RETURNS void LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
 IF kind_value NOT IN('feedback','followup') OR operation_value NOT IN('save','revoke') THEN PERFORM dg_native_aftercare_error('VALIDATION_FAILED');END IF;
 IF operation_value='revoke' THEN PERFORM dg_native_restaurant_fields(input,ARRAY['version','partyVersion','confirmed','focusVersion','selectionVersion']);
 ELSIF kind_value='feedback' THEN
  PERFORM dg_native_restaurant_fields(input,ARRAY['version','partyVersion','confirmed','focusVersion','selectionVersion','rating','comment']);PERFORM dg_native_restaurant_text(input->'comment',0,800);
  IF input->'rating' IS DISTINCT FROM 'null'::jsonb THEN PERFORM dg_native_restaurant_integer(input->'rating',1,5);END IF;
  IF input->'rating'='null'::jsonb AND input->>'comment'='' THEN PERFORM dg_native_aftercare_error('FEEDBACK_EMPTY');END IF;
 ELSE
  PERFORM dg_native_restaurant_fields(input,ARRAY['version','partyVersion','confirmed','focusVersion','selectionVersion','contactKind','contactDigest','purpose','validDays','consent']);
  IF input->>'contactKind' IS NULL OR input->>'contactKind' NOT IN('phone','email') OR input->>'purpose' IS DISTINCT FROM 'visit_followup' OR input->'consent' IS DISTINCT FROM 'true'::jsonb OR input->>'contactDigest' IS NULL OR input->>'contactDigest'!~'^[a-f0-9]{64}$' THEN PERFORM dg_native_aftercare_error('VALIDATION_FAILED');END IF;
  PERFORM dg_native_restaurant_integer(input->'validDays',1,30);
 END IF;
 IF input->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN PERFORM dg_native_aftercare_error('VALIDATION_FAILED');END IF;
 PERFORM dg_native_restaurant_integer(input->'version',CASE WHEN operation_value='save' THEN 0 ELSE 1 END,9007199254740991);PERFORM dg_native_restaurant_integer(input->'partyVersion',1,9007199254740991);PERFORM dg_native_restaurant_integer(input->'focusVersion',0,9007199254740991);PERFORM dg_native_restaurant_integer(input->'selectionVersion',0,9007199254740991);
END;$dg$;

CREATE FUNCTION dg_native_aftercare_begin(party_value text,kind_value text,operation_value text,input jsonb,session_value text,token_value text,csrf_value text,focus_value bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;p dining_parties%ROWTYPE;old_value jsonb;c _dg_native_aftercare_credentials%ROWTYPE;a _dg_native_aftercare_actions%ROWTYPE;now_value text;id_value text;next_value bigint;expiry_value text;nonce_value text;
BEGIN
 PERFORM dg_native_aftercare_input(kind_value,operation_value,input);
 meta:=dg_native_aftercare_context(party_value,session_value,token_value,csrf_value,focus_value,true,(input->>'selectionVersion')::bigint);
 SELECT * INTO p FROM dining_parties WHERE id=party_value FOR UPDATE;
 -- Recheck after acquiring every original write lock; waiting is not a new lease.
 meta:=dg_native_aftercare_context(party_value,session_value,token_value,csrf_value,focus_value,true,(input->>'selectionVersion')::bigint);now_value:=dg_native_dining_now();
 IF (input->>'partyVersion')::bigint<>p.version OR (input->>'focusVersion')::bigint IS DISTINCT FROM focus_value THEN PERFORM dg_native_aftercare_error('VERSION_CONFLICT');END IF;
 IF kind_value='feedback' THEN SELECT to_jsonb(f) INTO old_value FROM dining_feedback f WHERE f.party_id=p.id FOR UPDATE;ELSE SELECT to_jsonb(f) INTO old_value FROM dining_followup_consents f WHERE f.party_id=p.id FOR UPDATE;END IF;
 IF old_value IS NOT NULL AND NOT EXISTS(SELECT 1 FROM _dg_native_aftercare_origins o WHERE o.resource_kind=kind_value AND o.resource_id=old_value->>'id' AND o.runtime_id=(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1)) THEN PERFORM dg_native_aftercare_error('NOT_FOUND');END IF;
 IF (input->>'version')::bigint<>coalesce((old_value->>'version')::bigint,0) THEN PERFORM dg_native_aftercare_error('VERSION_CONFLICT');END IF;
 IF operation_value='revoke' AND old_value IS NULL THEN PERFORM dg_native_aftercare_error('NOT_FOUND');END IF;
 IF operation_value='revoke' AND old_value->>'status'<>'active' THEN PERFORM dg_native_aftercare_error('AFTERCARE_REMOVED');END IF;
 IF old_value->>'status'='active' AND dg_native_aftercare_due(old_value->>'expires_at',now_value) THEN PERFORM dg_native_aftercare_error('AFTERCARE_EXPIRED');END IF;
 id_value:=coalesce(old_value->>'id',gen_random_uuid()::text);next_value:=coalesce((old_value->>'version')::bigint,0)+1;
 IF operation_value='save' THEN expiry_value:=dg_native_people_iso(now_value::timestamptz+CASE WHEN kind_value='feedback' THEN interval '720 hours' ELSE (input->>'validDays')::integer*interval '24 hours' END);nonce_value:=gen_random_uuid()::text;
 ELSE SELECT * INTO c FROM _dg_native_aftercare_credentials WHERE resource_kind=kind_value AND resource_id=id_value FOR UPDATE;IF c.resource_id IS NULL THEN PERFORM dg_native_aftercare_error('NOT_FOUND');END IF;expiry_value:=old_value->>'expires_at';nonce_value:=c.nonce;END IF;
 INSERT INTO _dg_native_aftercare_actions VALUES(gen_random_uuid()::text,(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1),meta->>'restaurantId',p.id,meta->>'tenantId',meta->>'workspaceId','guest',meta->>'actorId',meta->>'sessionId',meta->>'accessId',(meta->>'focusVersion')::bigint,(meta->>'selectionVersion')::bigint,p.version,p.access_version,kind_value,id_value,next_value,operation_value,nonce_value,expiry_value,dg_native_office_hash(input),now_value,pg_current_xact_id()::text) RETURNING * INTO a;
 RETURN dg_native_aftercare_descriptor(a);
END;$dg$;

CREATE FUNCTION dg_native_aftercare_snapshot(kind_value text,id_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE row_value jsonb;credential_value jsonb;
BEGIN
 IF kind_value='feedback' THEN SELECT to_jsonb(f) INTO row_value FROM dining_feedback f WHERE f.id=id_value;ELSIF kind_value='followup' THEN SELECT to_jsonb(f) INTO row_value FROM dining_followup_consents f WHERE f.id=id_value;ELSE PERFORM dg_native_aftercare_error('VALIDATION_FAILED');END IF;
 SELECT to_jsonb(c) INTO credential_value FROM _dg_native_aftercare_credentials c WHERE c.resource_kind=kind_value AND c.resource_id=id_value;
 RETURN jsonb_build_object('record',row_value,'credential',credential_value);
END;$dg$;

CREATE FUNCTION dg_native_aftercare_record(action_value text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE a _dg_native_aftercare_actions%ROWTYPE;
BEGIN
 SELECT * INTO a FROM _dg_native_aftercare_actions WHERE id=action_value AND transaction_id=pg_current_xact_id()::text;IF a.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Aftercare changes require their current original action';END IF;
 INSERT INTO _dg_native_aftercare_revisions VALUES(a.resource_kind,a.resource_id,a.resource_version,a.id,dg_native_office_hash(dg_native_aftercare_snapshot(a.resource_kind,a.resource_id)),a.created_at,pg_current_xact_id()::text);
 INSERT INTO audit_events VALUES(gen_random_uuid()::text,a.tenant_id,a.workspace_id,a.actor_id,'dining.aftercare.'||a.resource_kind||'.'||a.operation,a.resource_id,'native-aftercare-operation',a.created_at,'confirmed');
END;$dg$;

CREATE FUNCTION dg_native_aftercare_commit(action_value text,input jsonb,cipher_value text,mask_value text,recovery_hash_value text,session_value text,token_value text,csrf_value text,focus_value bigint) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE a _dg_native_aftercare_actions%ROWTYPE;meta jsonb;old_value jsonb;c _dg_native_aftercare_credentials%ROWTYPE;created_value text;
BEGIN
 SELECT * INTO a FROM _dg_native_aftercare_actions WHERE id=action_value AND transaction_id=pg_current_xact_id()::text;
 IF a.id IS NULL OR a.actor_type<>'guest' OR a.session_id IS DISTINCT FROM session_value THEN PERFORM dg_native_aftercare_error('NOT_FOUND');END IF;
 PERFORM dg_native_aftercare_input(a.resource_kind,a.operation,input);IF a.body_hash<>dg_native_office_hash(input) THEN PERFORM dg_native_aftercare_error('AUTHORIZATION_CHANGED');END IF;
 meta:=dg_native_aftercare_context(a.party_id,session_value,token_value,csrf_value,focus_value,true,(input->>'selectionVersion')::bigint);
 IF a.actor_id IS DISTINCT FROM meta->>'actorId' OR a.access_id IS DISTINCT FROM meta->>'accessId' OR a.focus_version IS DISTINCT FROM(meta->>'focusVersion')::bigint OR a.selection_version IS DISTINCT FROM(meta->>'selectionVersion')::bigint OR a.party_version IS DISTINCT FROM(meta->>'partyVersion')::bigint OR a.party_access_version IS DISTINCT FROM(meta->>'partyAccessVersion')::bigint THEN PERFORM dg_native_aftercare_error('AUTHORIZATION_CHANGED');END IF;
 IF a.resource_kind='feedback' THEN SELECT to_jsonb(f) INTO old_value FROM dining_feedback f WHERE f.id=a.resource_id FOR UPDATE;ELSE SELECT to_jsonb(f) INTO old_value FROM dining_followup_consents f WHERE f.id=a.resource_id FOR UPDATE;END IF;
 IF coalesce((old_value->>'version')::bigint,0)<>a.resource_version-1 OR old_value IS NOT NULL AND old_value->>'party_id'<>a.party_id THEN PERFORM dg_native_aftercare_error('VERSION_CONFLICT');END IF;
 IF a.operation='save' THEN
  IF recovery_hash_value IS NULL OR recovery_hash_value!~'^[a-f0-9]{64}$' THEN PERFORM dg_native_aftercare_error('VALIDATION_FAILED');END IF;
  IF a.resource_kind='followup' AND(cipher_value IS NULL OR cipher_value!~'^NAC1[.][A-Za-z0-9_-]{40,1500}$' OR mask_value IS NULL OR char_length(mask_value) NOT BETWEEN 1 AND 160) OR a.resource_kind='feedback' AND(cipher_value IS NOT NULL OR mask_value IS NOT NULL) THEN PERFORM dg_native_aftercare_error('VALIDATION_FAILED');END IF;
 ELSE
  IF cipher_value IS NOT NULL OR mask_value IS NOT NULL OR recovery_hash_value IS NOT NULL OR old_value->>'status'<>'active' THEN PERFORM dg_native_aftercare_error('AFTERCARE_REMOVED');END IF;
  SELECT * INTO c FROM _dg_native_aftercare_credentials WHERE resource_kind=a.resource_kind AND resource_id=a.resource_id FOR UPDATE;
 END IF;
 created_value:=coalesce(old_value->>'created_at',a.created_at);
 IF a.operation='save' AND a.resource_kind='feedback' THEN
  INSERT INTO dining_feedback(id,party_id,status,version,rating,comment,actor_id,session_id,focus_version,expires_at,created_at,updated_at) VALUES(a.resource_id,a.party_id,'active',a.resource_version,CASE WHEN input->'rating'='null'::jsonb THEN NULL ELSE(input->>'rating')::bigint END,input->>'comment',a.actor_id,a.session_id,a.focus_version,a.expires_at,created_value,a.created_at)
   ON CONFLICT(id) DO UPDATE SET status='active',version=EXCLUDED.version,rating=EXCLUDED.rating,comment=EXCLUDED.comment,actor_id=EXCLUDED.actor_id,session_id=EXCLUDED.session_id,focus_version=EXCLUDED.focus_version,expires_at=EXCLUDED.expires_at,updated_at=EXCLUDED.updated_at;
 ELSIF a.operation='save' THEN
  INSERT INTO dining_followup_consents(id,party_id,status,version,purpose,contact_kind,contact_cipher,contact_mask,actor_id,session_id,focus_version,expires_at,created_at,updated_at) VALUES(a.resource_id,a.party_id,'active',a.resource_version,'visit_followup',input->>'contactKind',cipher_value,mask_value,a.actor_id,a.session_id,a.focus_version,a.expires_at,created_value,a.created_at)
   ON CONFLICT(id) DO UPDATE SET status='active',version=EXCLUDED.version,contact_kind=EXCLUDED.contact_kind,contact_cipher=EXCLUDED.contact_cipher,contact_mask=EXCLUDED.contact_mask,actor_id=EXCLUDED.actor_id,session_id=EXCLUDED.session_id,focus_version=EXCLUDED.focus_version,expires_at=EXCLUDED.expires_at,updated_at=EXCLUDED.updated_at;
 ELSIF a.resource_kind='feedback' THEN UPDATE dining_feedback SET status='withdrawn',version=a.resource_version,rating=NULL,comment='',updated_at=a.created_at WHERE id=a.resource_id;
 ELSE UPDATE dining_followup_consents SET status='withdrawn',version=a.resource_version,contact_cipher=NULL,contact_mask='已撤回',updated_at=a.created_at WHERE id=a.resource_id;END IF;
 INSERT INTO _dg_native_aftercare_origins VALUES(a.resource_kind,a.resource_id,a.party_id,a.restaurant_id,a.runtime_id,a.id,created_value) ON CONFLICT(resource_kind,resource_id) DO NOTHING;
 IF a.operation='save' THEN
  INSERT INTO _dg_native_aftercare_credentials VALUES(a.resource_kind,a.resource_id,a.resource_version,a.credential_nonce,recovery_hash_value,a.expires_at,'active',a.id,created_value,a.created_at)
   ON CONFLICT(resource_kind,resource_id) DO UPDATE SET resource_version=EXCLUDED.resource_version,nonce=EXCLUDED.nonce,token_hash=EXCLUDED.token_hash,expires_at=EXCLUDED.expires_at,status='active',action_id=EXCLUDED.action_id,updated_at=EXCLUDED.updated_at;
 ELSE UPDATE _dg_native_aftercare_credentials SET resource_version=a.resource_version,status='withdrawn',action_id=a.id,updated_at=a.created_at WHERE resource_kind=a.resource_kind AND resource_id=a.resource_id;END IF;
 PERFORM dg_native_aftercare_record(a.id);RETURN a.id;
END;$dg$;

CREATE FUNCTION dg_native_aftercare_project(party_value text,meta jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE p dining_parties%ROWTYPE;f dining_feedback%ROWTYPE;c dining_followup_consents%ROWTYPE;k _dg_native_aftercare_credentials%ROWTYPE;a _dg_native_aftercare_actions%ROWTYPE;feedback_value jsonb:=NULL;followup_value jsonb:=NULL;management_value jsonb:='{}';status_value text;now_value text:=dg_native_dining_now();guest_value boolean;can_value boolean;result_value jsonb;
BEGIN
 SELECT * INTO p FROM dining_parties WHERE id=party_value;
 IF p.id IS NULL OR p.restaurant_id IS DISTINCT FROM meta->>'restaurantId' THEN PERFORM dg_native_aftercare_error('NOT_FOUND');END IF;
 guest_value:=meta->>'actorType'='guest';can_value:=guest_value AND p.status='completed' AND(meta->>'automatic')::boolean AND(meta->>'selected')::boolean;
 SELECT f0.* INTO f FROM dining_feedback f0 JOIN _dg_native_aftercare_origins origin ON origin.resource_kind='feedback' AND origin.resource_id=f0.id WHERE f0.party_id=p.id AND origin.runtime_id=(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1);
 IF f.id IS NOT NULL THEN status_value:=CASE WHEN f.status='active' AND dg_native_aftercare_due(f.expires_at,now_value) THEN 'expired' ELSE f.status END;
  feedback_value:=jsonb_build_object('id',f.id,'version',f.version,'status',status_value,'rating',CASE WHEN status_value='active' THEN f.rating END,'comment',CASE WHEN status_value='active' THEN f.comment ELSE '' END,'expiresAt',f.expires_at,'createdAt',f.created_at,'updatedAt',f.updated_at);
  IF guest_value AND status_value='active' THEN SELECT * INTO k FROM _dg_native_aftercare_credentials WHERE resource_kind='feedback' AND resource_id=f.id;SELECT * INTO a FROM _dg_native_aftercare_actions WHERE id=k.action_id;management_value:=management_value||jsonb_build_object('feedback',dg_native_aftercare_descriptor(a)||jsonb_build_object('tokenHash',k.token_hash));END IF;
 END IF;
 SELECT c0.* INTO c FROM dining_followup_consents c0 JOIN _dg_native_aftercare_origins origin ON origin.resource_kind='followup' AND origin.resource_id=c0.id WHERE c0.party_id=p.id AND origin.runtime_id=(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1);
 IF c.id IS NOT NULL THEN status_value:=CASE WHEN c.status='active' AND dg_native_aftercare_due(c.expires_at,now_value) THEN 'expired' ELSE c.status END;
  followup_value:=jsonb_build_object('id',c.id,'version',c.version,'status',status_value,'purpose','visit_followup','contactKind',c.contact_kind,'contactMask',CASE WHEN status_value='active' THEN c.contact_mask WHEN status_value='expired' THEN '已到期' ELSE '已撤回' END,'expiresAt',c.expires_at,'notice','仅限本次自愿回访；当前不向外联系。撤回或到期后清除可用联系方式。','createdAt',c.created_at,'updatedAt',c.updated_at);
  IF guest_value AND status_value='active' THEN SELECT * INTO k FROM _dg_native_aftercare_credentials WHERE resource_kind='followup' AND resource_id=c.id;SELECT * INTO a FROM _dg_native_aftercare_actions WHERE id=k.action_id;management_value:=management_value||jsonb_build_object('followup',dg_native_aftercare_descriptor(a)||jsonb_build_object('tokenHash',k.token_hash));END IF;
 END IF;
 result_value:=jsonb_build_object('partyId',p.id,'partyVersion',p.version,'partyAccessVersion',p.access_version,'ended',p.status='completed','farewell',(SELECT message FROM dining_farewells farewell JOIN _dg_native_hospitality_origins origin ON origin.resource_kind='farewell' AND origin.resource_id=farewell.party_id WHERE farewell.party_id=p.id),'canGiveFeedback',coalesce(can_value,false),'feedback',feedback_value,'followup',followup_value,'canGiveFollowup',coalesce(can_value,false),'notice','评价与回访分别自愿确认，不影响已完成的服务；联系方式不进入数字人记忆、聊天或厨房。');
 RETURN result_value||CASE WHEN guest_value THEN jsonb_build_object('_management',management_value) ELSE '{}'::jsonb END;
END;$dg$;

CREATE FUNCTION dg_native_aftercare_view(party_value text,session_value text DEFAULT NULL,token_value text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;
BEGIN meta:=dg_native_aftercare_context(party_value,session_value,token_value);RETURN dg_native_aftercare_project(party_value,meta);END;$dg$;

CREATE FUNCTION dg_native_aftercare_board(restaurant_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE meta jsonb;p dining_parties%ROWTYPE;result_value jsonb:='[]';
BEGIN
 meta:=dg_native_hospitality_context('restaurant',restaurant_value);
 FOR p IN SELECT party.* FROM dining_parties party JOIN _dg_native_dining_party_origins origin ON origin.party_id=party.id WHERE party.restaurant_id=restaurant_value AND party.status='completed' AND origin.runtime_id=(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1) ORDER BY party.ended_at DESC,party.id DESC LIMIT 100 LOOP result_value:=result_value||jsonb_build_array(dg_native_aftercare_project(p.id,meta)||jsonb_build_object('partyName',p.name));END LOOP;RETURN result_value;
END;$dg$;

CREATE FUNCTION dg_native_aftercare_result(action_value text,session_value text,token_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE a _dg_native_aftercare_actions%ROWTYPE;meta jsonb;current_version bigint;
BEGIN
 SELECT * INTO a FROM _dg_native_aftercare_actions WHERE id=action_value;
 IF a.id IS NULL OR a.actor_type<>'guest' OR a.session_id IS DISTINCT FROM session_value THEN PERFORM dg_native_aftercare_error('NOT_FOUND');END IF;
 meta:=dg_native_aftercare_context(a.party_id,session_value,token_value);
 IF a.actor_id IS DISTINCT FROM meta->>'actorId' OR a.access_id IS DISTINCT FROM meta->>'accessId' OR a.focus_version IS DISTINCT FROM(meta->>'focusVersion')::bigint OR a.selection_version IS DISTINCT FROM(meta->>'selectionVersion')::bigint OR a.party_version IS DISTINCT FROM(meta->>'partyVersion')::bigint OR a.party_access_version IS DISTINCT FROM(meta->>'partyAccessVersion')::bigint OR NOT(meta->>'selected')::boolean THEN PERFORM dg_native_aftercare_error('AUTHORIZATION_CHANGED');END IF;
 IF a.resource_kind='feedback' THEN SELECT version INTO current_version FROM dining_feedback WHERE id=a.resource_id;ELSE SELECT version INTO current_version FROM dining_followup_consents WHERE id=a.resource_id;END IF;
 IF current_version IS DISTINCT FROM a.resource_version THEN PERFORM dg_native_aftercare_error('AUTHORIZATION_CHANGED');END IF;
 RETURN dg_native_aftercare_project(a.party_id,meta);
END;$dg$;

CREATE FUNCTION dg_native_aftercare_erase(kind_value text,id_value text,actor_value text,token_hash_value text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE o _dg_native_aftercare_origins%ROWTYPE;r restaurants%ROWTYPE;p dining_parties%ROWTYPE;c _dg_native_aftercare_credentials%ROWTYPE;a _dg_native_aftercare_actions%ROWTYPE;row_value jsonb;now_value text;status_value text;next_value bigint;
BEGIN
 PERFORM dg_native_reception_runtime(true);
 IF kind_value NOT IN('feedback','followup') OR actor_value NOT IN('privacy','worker') OR actor_value='worker' AND token_hash_value IS NOT NULL THEN PERFORM dg_native_aftercare_error('VALIDATION_FAILED');END IF;
 SELECT * INTO o FROM _dg_native_aftercare_origins WHERE resource_kind=kind_value AND resource_id=id_value AND runtime_id=(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1);SELECT * INTO r FROM restaurants WHERE id=o.restaurant_id;
 IF o.resource_id IS NULL OR r.id IS NULL OR r.environment<>'mock' OR r.app_env IS DISTINCT FROM(SELECT app_env FROM _dg_native_runtime_control WHERE id=1) THEN PERFORM dg_native_aftercare_error('NOT_FOUND');END IF;
 PERFORM dg_native_reception_workspace(r.tenant_id,r.workspace_id,true);SELECT current_store.* INTO r FROM restaurants current_store WHERE current_store.id=r.id FOR UPDATE;SELECT * INTO p FROM dining_parties WHERE id=o.party_id FOR UPDATE;
 IF kind_value='feedback' THEN SELECT to_jsonb(f) INTO row_value FROM dining_feedback f WHERE f.id=id_value FOR UPDATE;ELSE SELECT to_jsonb(f) INTO row_value FROM dining_followup_consents f WHERE f.id=id_value FOR UPDATE;END IF;
 SELECT * INTO c FROM _dg_native_aftercare_credentials WHERE resource_kind=kind_value AND resource_id=id_value FOR UPDATE;
 IF row_value IS NULL OR c.resource_id IS NULL OR actor_value='privacy' AND(token_hash_value IS NULL OR token_hash_value!~'^[a-f0-9]{64}$' OR token_hash_value IS DISTINCT FROM c.token_hash) THEN PERFORM dg_native_aftercare_error('NOT_FOUND');END IF;
 now_value:=dg_native_dining_now();status_value:=row_value->>'status';next_value:=(row_value->>'version')::bigint;
 IF status_value<>'active' OR actor_value='worker' AND NOT dg_native_aftercare_due(row_value->>'expires_at',now_value) THEN RETURN jsonb_build_object('kind',kind_value,'id',id_value,'version',next_value,'status',status_value,'expiresAt',row_value->>'expires_at','changed',false,'message','本项状态已核对；已清除的内容不会恢复。');END IF;
 status_value:=CASE WHEN dg_native_aftercare_due(row_value->>'expires_at',now_value) THEN 'expired' ELSE 'withdrawn' END;next_value:=next_value+1;
 INSERT INTO _dg_native_aftercare_actions VALUES(gen_random_uuid()::text,o.runtime_id,r.id,p.id,r.tenant_id,r.workspace_id,actor_value,CASE WHEN actor_value='worker' THEN 'system:aftercare-expiry' ELSE 'privacy:aftercare:'||kind_value||':'||id_value END,NULL,NULL,NULL,NULL,p.version,p.access_version,kind_value,id_value,next_value,CASE WHEN status_value='expired' THEN 'expire' ELSE 'revoke' END,c.nonce,row_value->>'expires_at',dg_native_office_hash(jsonb_build_object('purpose','aftercare-revoke-only','credentialHash',CASE WHEN actor_value='privacy' THEN c.token_hash END,'expiresAt',row_value->>'expires_at')),now_value,pg_current_xact_id()::text) RETURNING * INTO a;
 IF kind_value='feedback' THEN UPDATE dining_feedback SET status=status_value,version=next_value,rating=NULL,comment='',updated_at=now_value WHERE id=id_value;
 ELSE UPDATE dining_followup_consents SET status=status_value,version=next_value,contact_cipher=NULL,contact_mask=CASE status_value WHEN 'expired' THEN '已到期' ELSE '已撤回' END,updated_at=now_value WHERE id=id_value;END IF;
 UPDATE _dg_native_aftercare_credentials SET status=status_value,resource_version=next_value,action_id=a.id,updated_at=now_value WHERE resource_kind=kind_value AND resource_id=id_value;
 PERFORM dg_native_aftercare_record(a.id);
 RETURN jsonb_build_object('kind',kind_value,'id',id_value,'version',next_value,'status',status_value,'expiresAt',row_value->>'expires_at','changed',true,'message',CASE kind_value WHEN 'feedback' THEN '本次评价已清除。' ELSE '本次回访授权已结束，可用联系方式已清除。' END);
END;$dg$;

CREATE FUNCTION dg_native_aftercare_manage(kind_value text,id_value text,token_hash_value text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT dg_native_aftercare_erase(kind_value,id_value,'privacy',token_hash_value)-'changed'
$dg$;

CREATE FUNCTION dg_native_aftercare_sweep(restaurant_value text DEFAULT NULL) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE item record;result_value jsonb;changed bigint:=0;now_value text:=dg_native_dining_now();
BEGIN
 PERFORM dg_native_reception_runtime(true);
 FOR item IN SELECT candidate.kind,candidate.id FROM(
  SELECT 'feedback'::text kind,f.id FROM dining_feedback f JOIN _dg_native_aftercare_origins origin ON origin.resource_kind='feedback' AND origin.resource_id=f.id JOIN restaurants r ON r.id=origin.restaurant_id WHERE f.status='active' AND dg_native_aftercare_due(f.expires_at,now_value) AND origin.runtime_id=(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1) AND r.environment='mock' AND r.app_env=(SELECT app_env FROM _dg_native_runtime_control WHERE id=1) AND(restaurant_value IS NULL OR r.id=restaurant_value)
  UNION ALL SELECT 'followup',f.id FROM dining_followup_consents f JOIN _dg_native_aftercare_origins origin ON origin.resource_kind='followup' AND origin.resource_id=f.id JOIN restaurants r ON r.id=origin.restaurant_id WHERE f.status='active' AND dg_native_aftercare_due(f.expires_at,now_value) AND origin.runtime_id=(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1) AND r.environment='mock' AND r.app_env=(SELECT app_env FROM _dg_native_runtime_control WHERE id=1) AND(restaurant_value IS NULL OR r.id=restaurant_value)
 ) candidate ORDER BY candidate.kind,candidate.id LIMIT 100 LOOP result_value:=dg_native_aftercare_erase(item.kind,item.id,'worker');IF(result_value->>'changed')::boolean THEN changed:=changed+1;END IF;END LOOP;
 RETURN changed;
END;$dg$;

CREATE FUNCTION dg_native_aftercare_mutation_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j jsonb:=to_jsonb(NEW);previous jsonb:=to_jsonb(OLD);kind_value text;id_value text;version_value bigint;a _dg_native_aftercare_actions%ROWTYPE;allowed text[];
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Aftercare erasure clears content and retains its minimal version history';END IF;
 IF TG_TABLE_NAME='_dg_native_aftercare_credentials' THEN
  IF j-ARRAY['resource_version','nonce','token_hash','expires_at','status','action_id','updated_at'] IS DISTINCT FROM previous-ARRAY['resource_version','nonce','token_hash','expires_at','status','action_id','updated_at'] OR (j->>'resource_version')::bigint<>(previous->>'resource_version')::bigint+1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Erase-only credentials keep resource identity and monotonic versions';END IF;RETURN NEW;
 END IF;
 kind_value:=CASE TG_TABLE_NAME WHEN 'dining_feedback' THEN 'feedback' ELSE 'followup' END;id_value:=j->>'id';version_value:=(j->>'version')::bigint;
 SELECT * INTO a FROM _dg_native_aftercare_actions WHERE resource_kind=kind_value AND resource_id=id_value AND resource_version=version_value AND transaction_id=pg_current_xact_id()::text;
 IF a.id IS NULL OR j->>'id' IS DISTINCT FROM previous->>'id' OR j->>'party_id' IS DISTINCT FROM previous->>'party_id' OR j->>'created_at' IS DISTINCT FROM previous->>'created_at' OR version_value<>(previous->>'version')::bigint+1 OR j->>'updated_at'<previous->>'updated_at' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Aftercare identity and original creation require a current monotonic action';END IF;
 IF a.operation<>'save' THEN
  allowed:=CASE kind_value WHEN 'feedback' THEN ARRAY['status','version','rating','comment','updated_at'] ELSE ARRAY['status','version','contact_cipher','contact_mask','updated_at'] END;
  IF j-allowed IS DISTINCT FROM previous-allowed THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Withdrawing or expiring aftercare cannot change original source or deadline';END IF;
 END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_aftercare_feedback_mutations BEFORE UPDATE OR DELETE ON dining_feedback FOR EACH ROW EXECUTE FUNCTION dg_native_aftercare_mutation_guard();
CREATE TRIGGER native_aftercare_followup_mutations BEFORE UPDATE OR DELETE ON dining_followup_consents FOR EACH ROW EXECUTE FUNCTION dg_native_aftercare_mutation_guard();
CREATE TRIGGER native_aftercare_credential_mutations BEFORE UPDATE OR DELETE ON _dg_native_aftercare_credentials FOR EACH ROW EXECUTE FUNCTION dg_native_aftercare_mutation_guard();

CREATE FUNCTION dg_native_aftercare_rows_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j jsonb:=to_jsonb(NEW);kind_value text;id_value text;snapshot_value jsonb;row_value jsonb;credential_value jsonb;o _dg_native_aftercare_origins%ROWTYPE;a _dg_native_aftercare_actions%ROWTYPE;revision_value _dg_native_aftercare_revisions%ROWTYPE;p dining_parties%ROWTYPE;r restaurants%ROWTYPE;s reception_sessions%ROWTYPE;now_value text:=dg_native_dining_now();
BEGIN
 kind_value:=CASE TG_TABLE_NAME WHEN 'dining_feedback' THEN 'feedback' WHEN 'dining_followup_consents' THEN 'followup' ELSE j->>'resource_kind' END;id_value:=CASE WHEN TG_TABLE_NAME='_dg_native_aftercare_credentials' THEN j->>'resource_id' ELSE j->>'id' END;
 snapshot_value:=dg_native_aftercare_snapshot(kind_value,id_value);row_value:=snapshot_value->'record';credential_value:=snapshot_value->'credential';
 SELECT * INTO o FROM _dg_native_aftercare_origins WHERE resource_kind=kind_value AND resource_id=id_value;SELECT * INTO a FROM _dg_native_aftercare_actions WHERE id=credential_value->>'action_id';SELECT * INTO revision_value FROM _dg_native_aftercare_revisions WHERE resource_kind=kind_value AND resource_id=id_value AND version=(row_value->>'version')::bigint;SELECT * INTO p FROM dining_parties WHERE id=o.party_id;SELECT * INTO r FROM restaurants WHERE id=o.restaurant_id;
 IF row_value IS NULL OR row_value='null'::jsonb OR credential_value IS NULL OR credential_value='null'::jsonb OR o.resource_id IS NULL OR a.id IS NULL OR revision_value.resource_id IS NULL OR p.id IS NULL OR p.status<>'completed' OR r.id IS NULL OR p.restaurant_id<>r.id OR o.runtime_id<>(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1) OR a.runtime_id<>o.runtime_id OR a.party_id<>p.id OR a.restaurant_id<>r.id OR a.tenant_id<>r.tenant_id OR a.workspace_id<>r.workspace_id OR a.transaction_id<>pg_current_xact_id()::text OR revision_value.transaction_id<>a.transaction_id OR revision_value.action_id<>a.id OR revision_value.row_hash<>dg_native_office_hash(snapshot_value) OR a.resource_kind<>kind_value OR a.resource_id<>id_value OR a.resource_version<>(row_value->>'version')::bigint OR a.resource_version<>(credential_value->>'resource_version')::bigint OR row_value->>'party_id'<>p.id OR row_value->>'created_at'<>o.created_at OR credential_value->>'created_at'<>o.created_at OR row_value->>'updated_at'<>a.created_at OR credential_value->>'updated_at'<>a.created_at OR row_value->>'expires_at'<>a.expires_at OR credential_value->>'expires_at'<>a.expires_at OR credential_value->>'nonce'<>a.credential_nonce OR credential_value->>'status'<>row_value->>'status' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Aftercare content and erase-only credential require their exact original scope and current revision';END IF;
 IF a.operation='save' THEN
  IF a.actor_type<>'guest' OR row_value->>'status'<>'active' OR row_value->>'actor_id'<>a.actor_id OR row_value->>'session_id' IS DISTINCT FROM a.session_id OR(row_value->>'focus_version')::bigint IS DISTINCT FROM a.focus_version OR kind_value='feedback' AND a.expires_at<>dg_native_people_iso(a.created_at::timestamptz+interval '720 hours') OR kind_value='followup' AND(a.expires_at::timestamptz<a.created_at::timestamptz+interval '24 hours' OR a.expires_at::timestamptz>a.created_at::timestamptz+interval '720 hours') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='New voluntary aftercare keeps its actual source, purpose and fixed bounded deadline';END IF;
 ELSE
  IF row_value->>'status'<>(CASE a.operation WHEN 'expire' THEN 'expired' ELSE 'withdrawn' END) OR kind_value='feedback' AND(row_value->'rating' IS DISTINCT FROM 'null'::jsonb OR row_value->>'comment'<>'') OR kind_value='followup' AND(row_value->'contact_cipher' IS DISTINCT FROM 'null'::jsonb OR row_value->>'contact_mask'<>CASE a.operation WHEN 'expire' THEN '已到期' ELSE '已撤回' END) OR a.operation='expire' AND NOT dg_native_aftercare_due(a.expires_at,a.created_at) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Revocation and actual deadline expiry must clear all usable aftercare content';END IF;
 END IF;
 IF a.actor_type='guest' THEN
  SELECT * INTO s FROM reception_sessions WHERE id=a.session_id;
  IF s.id IS NULL OR s.status<>'active' OR s.expires_at<=now_value OR s.activity_at<=dg_native_people_iso(clock_timestamp()-interval '120 seconds') OR s.focus_version<>a.focus_version OR s.dining_party_id IS DISTINCT FROM p.id OR p.owner_session_id IS DISTINCT FROM s.id OR p.version<>a.party_version OR p.access_version<>a.party_access_version OR a.selection_version IS DISTINCT FROM coalesce((SELECT max(version) FROM _dg_native_dining_selection_revisions WHERE session_id=s.id),0) OR NOT dg_native_reception_source_valid(s.id) OR NOT EXISTS(SELECT 1 FROM _dg_native_reception_access access WHERE access.id=a.access_id AND access.session_id=s.id AND access.access_version=s.access_version AND access.expires_at>now_value) OR NOT EXISTS(SELECT 1 FROM _dg_native_dining_session_origins origin WHERE origin.session_id=s.id AND dg_native_dining_clock_authority(origin.actor_id,origin.restaurant_id,origin.actor_epoch,origin.grant_version)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Voluntary guest aftercare requires the still-current original person, selection, access and wall clock';END IF;
 ELSE
  IF a.session_id IS NOT NULL OR a.access_id IS NOT NULL OR a.focus_version IS NOT NULL OR a.selection_version IS NOT NULL OR a.actor_type='worker' AND(a.operation<>'expire' OR a.actor_id<>'system:aftercare-expiry') OR a.actor_type='privacy' AND a.actor_id<>'privacy:aftercare:'||kind_value||':'||id_value OR a.body_hash<>dg_native_office_hash(jsonb_build_object('purpose','aftercare-revoke-only','credentialHash',CASE WHEN a.actor_type='privacy' THEN credential_value->>'token_hash' END,'expiresAt',a.expires_at)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Privacy capabilities and expiry cannot become a guest or employee identity';END IF;
 END IF;RETURN NULL;
END;$dg$;
CREATE CONSTRAINT TRIGGER native_aftercare_feedback_rows AFTER INSERT OR UPDATE ON dining_feedback DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_aftercare_rows_guard();
CREATE CONSTRAINT TRIGGER native_aftercare_followup_rows AFTER INSERT OR UPDATE ON dining_followup_consents DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_aftercare_rows_guard();
CREATE CONSTRAINT TRIGGER native_aftercare_credential_rows AFTER INSERT OR UPDATE ON _dg_native_aftercare_credentials DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_aftercare_rows_guard();

CREATE FUNCTION dg_native_aftercare_action_final() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE revision_value _dg_native_aftercare_revisions%ROWTYPE;payload jsonb;
BEGIN
 SELECT * INTO revision_value FROM _dg_native_aftercare_revisions WHERE action_id=NEW.id;payload:=dg_native_aftercare_snapshot(NEW.resource_kind,NEW.resource_id);
 IF revision_value.action_id IS NULL OR revision_value.transaction_id<>NEW.transaction_id OR revision_value.resource_kind<>NEW.resource_kind OR revision_value.resource_id<>NEW.resource_id OR revision_value.version<>NEW.resource_version OR(payload->'record'->>'version') IS NULL OR(payload->'record'->>'version')::bigint<NEW.resource_version THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Preparing an aftercare action cannot commit without its complete durable result';END IF;RETURN NULL;
END;$dg$;
CREATE CONSTRAINT TRIGGER native_aftercare_action_complete AFTER INSERT ON _dg_native_aftercare_actions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_aftercare_action_final();

REVOKE ALL ON FUNCTION dg_native_aftercare_attempt(text),dg_native_aftercare_error(text),dg_native_aftercare_due(text,text),dg_native_aftercare_context(text,text,text,text,bigint,boolean,bigint),dg_native_aftercare_descriptor(_dg_native_aftercare_actions),dg_native_aftercare_input(text,text,jsonb),dg_native_aftercare_begin(text,text,text,jsonb,text,text,text,bigint),dg_native_aftercare_snapshot(text,text),dg_native_aftercare_record(text),dg_native_aftercare_commit(text,jsonb,text,text,text,text,text,text,bigint),dg_native_aftercare_project(text,jsonb),dg_native_aftercare_view(text,text,text),dg_native_aftercare_board(text),dg_native_aftercare_result(text,text,text),dg_native_aftercare_erase(text,text,text,text),dg_native_aftercare_manage(text,text,text),dg_native_aftercare_sweep(text),dg_native_aftercare_mutation_guard(),dg_native_aftercare_rows_guard(),dg_native_aftercare_action_final() FROM PUBLIC;
