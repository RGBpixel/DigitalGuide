-- Keep119 frozen. PostgreSQL ARE repetition bounds are at most255; retain the same encoded-byte limit explicitly.
ALTER TABLE dining_followup_consents DROP CONSTRAINT native_aftercare_followup_shape;
ALTER TABLE dining_followup_consents ADD CONSTRAINT native_aftercare_followup_shape CHECK(status IN('active','withdrawn','expired') AND version>0 AND char_length(contact_mask)<=160 AND(status='active' AND contact_cipher IS NOT NULL AND char_length(contact_cipher)<=1505 AND contact_cipher~'^NAC1[.][A-Za-z0-9_-]{40,}$' AND char_length(contact_mask)>0 OR status='withdrawn' AND contact_cipher IS NULL AND contact_mask='已撤回' OR status='expired' AND contact_cipher IS NULL AND contact_mask='已到期')) NOT VALID;

CREATE OR REPLACE FUNCTION dg_native_aftercare_commit(action_value text,input jsonb,cipher_value text,mask_value text,recovery_hash_value text,session_value text,token_value text,csrf_value text,focus_value bigint) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
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
  IF a.resource_kind='followup' AND(cipher_value IS NULL OR char_length(cipher_value)>1505 OR cipher_value!~'^NAC1[.][A-Za-z0-9_-]{40,}$' OR mask_value IS NULL OR char_length(mask_value) NOT BETWEEN 1 AND 160) OR a.resource_kind='feedback' AND(cipher_value IS NOT NULL OR mask_value IS NOT NULL) THEN PERFORM dg_native_aftercare_error('VALIDATION_FAILED');END IF;
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

