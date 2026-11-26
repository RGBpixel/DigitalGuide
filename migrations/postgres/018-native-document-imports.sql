-- Independent native document migration. Applied001-017 are unchanged.
CREATE TABLE _dg_native_import_sources (
 import_id text PRIMARY KEY REFERENCES studio_imports(id),sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 size bigint NOT NULL CHECK(size BETWEEN 8 AND 8388608),rights_confirmed_at text NOT NULL
);
CREATE TABLE _dg_native_import_outputs (
 import_id text PRIMARY KEY REFERENCES studio_imports(id),source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 result_sha256 text NOT NULL CHECK(result_sha256 ~ '^[a-f0-9]{64}$'),created_at text NOT NULL
);
CREATE TABLE _dg_native_import_media (
 media_id text PRIMARY KEY REFERENCES studio_import_media(id),import_id text NOT NULL REFERENCES studio_imports(id),
 original_sha256 text NOT NULL CHECK(original_sha256 ~ '^[a-f0-9]{64}$'),sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 size bigint NOT NULL CHECK(size BETWEEN 1 AND 8388608),created_at text NOT NULL
);
CREATE TRIGGER native_import_source_immutable BEFORE UPDATE OR DELETE ON _dg_native_import_sources FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_import_output_immutable BEFORE UPDATE OR DELETE ON _dg_native_import_outputs FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_import_media_receipt_immutable BEFORE UPDATE OR DELETE ON _dg_native_import_media FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_import_media_immutable BEFORE UPDATE OR DELETE ON studio_import_media FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
ALTER TABLE studio_imports ADD CONSTRAINT native_import_input CHECK(format IN ('pdf','pptx') AND size BETWEEN 8 AND 8388608 AND sha256 ~ '^[a-f0-9]{64}$' AND storage_key ~ '^[a-f0-9-]{36}\.bin$');
ALTER TABLE studio_imports ADD CONSTRAINT native_import_state CHECK(status IN ('queued','processing','review','failed','cancelled') AND version>0 AND attempts BETWEEN 0 AND 2);
ALTER TABLE studio_imports ADD CONSTRAINT native_import_lease CHECK((status='processing' AND lease_token IS NOT NULL AND lease_until IS NOT NULL) OR(status<>'processing' AND lease_token IS NULL AND lease_until IS NULL));
ALTER TABLE studio_imports ADD CONSTRAINT native_import_result CHECK((status='review' AND result IS NOT NULL AND attempts>0) OR(status<>'review' AND result IS NULL));
ALTER TABLE studio_import_media ADD CONSTRAINT native_import_media_shape CHECK(sha256 ~ '^[a-f0-9]{64}$' AND storage_key ~ '^[a-f0-9-]{36}\.bin$' AND kind IN ('image','reference') AND width BETWEEN 1 AND 16777216 AND height BETWEEN 1 AND 16777216 AND width*height<=16777216);
CREATE FUNCTION dg_native_import_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE mutable text[]:=ARRAY['status','version','attempts','lease_token','lease_until','result','error_code','error_message','updated_at'];
BEGIN
 IF to_jsonb(NEW)-mutable IS DISTINCT FROM to_jsonb(OLD)-mutable OR OLD.status IN ('failed','cancelled') OR(OLD.status='review' AND NEW.status<>'cancelled')
  OR(NEW.version<>OLD.version+1 AND NOT(NEW.version=OLD.version AND OLD.status='processing' AND NEW.status='processing' AND NEW.lease_token IS NOT DISTINCT FROM OLD.lease_token AND NEW.attempts=OLD.attempts)) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Document inputs and completed receipts are immutable';
 END IF;
 IF NEW.status<>OLD.status AND NOT((OLD.status='queued' AND NEW.status IN ('processing','cancelled')) OR(OLD.status='processing' AND NEW.status IN ('queued','review','failed','cancelled')) OR(OLD.status='review' AND NEW.status='cancelled')) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native document transition is invalid';
 END IF;
 IF NEW.status='processing' AND NEW.lease_token IS DISTINCT FROM OLD.lease_token AND(NEW.attempts<>OLD.attempts+1 OR(OLD.status='processing' AND OLD.lease_until>dg_utc_now())) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Document claim needs an available lease and increments attempts once';
 END IF;
 IF NEW.status='processing' AND NEW.lease_token IS NOT DISTINCT FROM OLD.lease_token AND(OLD.status<>'processing' OR NEW.attempts<>OLD.attempts OR OLD.lease_until<=dg_utc_now()) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Expired document lease cannot renew';
 END IF;
 IF NEW.status='queued' AND OLD.status='processing' AND NEW.attempts<>OLD.attempts-1 THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Normal document stop returns its attempt';
 END IF;
 IF NEW.status='review' AND(OLD.status<>'processing' OR OLD.lease_until<=dg_utc_now()) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Document completion needs an unexpired lease';
 END IF;
 RETURN NEW;
END;
$dg$;
CREATE TRIGGER native_import_guard BEFORE UPDATE ON studio_imports FOR EACH ROW EXECUTE FUNCTION dg_native_import_guard();

CREATE FUNCTION dg_native_commit_import(target text,token text,actual_sha text,result_text text,media_text text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE r studio_imports%ROWTYPE;m memberships%ROWTYPE;current_app text;output jsonb:=result_text::jsonb;prepared jsonb:=media_text::jsonb;item jsonb;
 at_time text:=dg_utc_now();ids jsonb;
BEGIN
 SELECT app_env INTO current_app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND environment='mock' AND session_user=worker_role;
 IF current_app IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only the native document worker can commit';END IF;
 SELECT * INTO r FROM studio_imports WHERE id=target AND environment='mock' AND app_env=current_app;
 SELECT * INTO m FROM dg_native_locked_membership(r.actor_id);
 IF m.tenant_id IS DISTINCT FROM r.tenant_id OR m.role NOT IN ('admin','editor') OR NOT(m.workspace_ids::jsonb ? r.workspace_id) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current document actor cannot complete this workspace import';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('["native-asset-workspace",'||to_jsonb(r.tenant_id)::text||','||to_jsonb(r.workspace_id)::text||']',0));
 SELECT * INTO r FROM studio_imports WHERE id=target FOR UPDATE;
 IF r.status IS DISTINCT FROM 'processing' OR r.lease_token IS DISTINCT FROM token OR r.lease_until<=dg_utc_now() OR actual_sha IS DISTINCT FROM r.sha256 OR NOT EXISTS(SELECT 1 FROM _dg_native_import_sources WHERE import_id=r.id AND sha256=r.sha256 AND size=r.size) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Document lease or fixed input changed';
 END IF;
 IF jsonb_typeof(output->'pages') IS DISTINCT FROM 'array' OR jsonb_array_length(output->'pages') NOT BETWEEN 1 AND 40 OR jsonb_typeof(output->'warnings') IS DISTINCT FROM 'array'
  OR jsonb_typeof(prepared) IS DISTINCT FROM 'array' OR jsonb_array_length(prepared)>2400 OR(SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(prepared))<>jsonb_array_length(prepared)
  OR(SELECT COALESCE(sum((value->>'size')::bigint),0) FROM jsonb_array_elements(prepared))>25165824
  OR(SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(output->'pages'))<>jsonb_array_length(output->'pages') THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Actual document result or media limits are invalid';
 END IF;
 SELECT COALESCE(jsonb_object_agg(value->>'id',value),'{}'::jsonb) INTO ids FROM jsonb_array_elements(prepared);
 FOR item IN SELECT value FROM jsonb_array_elements(output->'pages') LOOP
  IF(item->>'referenceMediaId' IS NOT NULL AND(NOT(ids ? (item->>'referenceMediaId')) OR ids->(item->>'referenceMediaId')->>'kind'<>'reference'))
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(item->'elements') e WHERE e->>'type'='image' AND(e->>'assetId' IS NOT NULL OR e->>'importMediaId' IS NULL OR NOT(ids ? (e->>'importMediaId')))) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Document page references disagree with actual prepared media';
  END IF;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(prepared) LOOP
  IF item->>'key' IS NULL OR item->>'key' !~ '^[a-f0-9-]{36}\.bin$' OR item->>'sha256' IS NULL OR item->>'sha256' !~ '^[a-f0-9]{64}$' OR COALESCE((item->>'size')::bigint,0) NOT BETWEEN 1 AND 8388608 THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Prepared document image key or digest is invalid';
  END IF;
  INSERT INTO studio_import_media VALUES(item->>'id',r.id,r.tenant_id,r.workspace_id,item->>'key',item->>'sha256',(item->>'width')::bigint,(item->>'height')::bigint,item->>'kind',at_time);
  INSERT INTO _dg_native_import_media VALUES(item->>'id',r.id,r.sha256,item->>'sha256',(item->>'size')::bigint,at_time);
 END LOOP;
 INSERT INTO _dg_native_import_outputs VALUES(r.id,r.sha256,encode(sha256(convert_to(result_text,'UTF8')),'hex'),at_time);
 UPDATE studio_imports SET status='review',result=result_text,error_code=NULL,error_message=NULL,lease_token=NULL,lease_until=NULL,version=version+1,updated_at=dg_utc_now() WHERE id=target AND lease_token=token AND lease_until>dg_utc_now();
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Document lease expired before commit';END IF;
 INSERT INTO audit_events VALUES(gen_random_uuid()::text,r.tenant_id,r.workspace_id,r.actor_id,'studio.import_review',r.id,'confirmed','native-import:'||target,dg_utc_now());
 RETURN r.id;
END;
$dg$;
REVOKE ALL ON FUNCTION dg_native_commit_import(text,text,text,text,text) FROM PUBLIC;
