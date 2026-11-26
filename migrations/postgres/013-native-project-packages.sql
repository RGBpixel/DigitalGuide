-- Fresh validation instances only. Applied 001-012 remain unchanged.
ALTER TABLE _dg_native_asset_origins DROP CONSTRAINT _dg_native_asset_origins_source_kind_check;
ALTER TABLE _dg_native_asset_origins ADD CONSTRAINT native_asset_source_kind CHECK(source_kind IN ('private_upload','package_import'));
CREATE TABLE _dg_native_package_manifests (
 transfer_id text PRIMARY KEY REFERENCES media_transfers(id),manifest text NOT NULL,
 manifest_sha256 text NOT NULL CHECK(manifest_sha256 ~ '^[a-f0-9]{64}$'),created_at text NOT NULL
);
CREATE TABLE _dg_native_package_assets (
 asset_id text PRIMARY KEY REFERENCES assets(id),transfer_id text NOT NULL REFERENCES _dg_native_package_manifests(transfer_id),
 source_asset_id text NOT NULL,expires_at text,created_at text NOT NULL,UNIQUE(transfer_id,source_asset_id)
);
CREATE TRIGGER native_package_manifest_immutable BEFORE UPDATE OR DELETE ON _dg_native_package_manifests FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_package_asset_immutable BEFORE UPDATE OR DELETE ON _dg_native_package_assets FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_package_import_immutable BEFORE UPDATE OR DELETE ON studio_package_imports FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_transfer_part_immutable BEFORE UPDATE OR DELETE ON media_transfer_parts FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
ALTER TABLE media_transfers ADD CONSTRAINT native_transfer_kind CHECK(kind='package');
ALTER TABLE media_transfers ADD CONSTRAINT native_transfer_state CHECK(status IN ('uploading','queued','processing','ready','failed','cancelled'));
ALTER TABLE media_transfers ADD CONSTRAINT native_transfer_bounds CHECK(size BETWEEN 1 AND 1073741824 AND chunk_size=4194304 AND chunk_count BETWEEN 1 AND 256 AND attempts BETWEEN 0 AND 2 AND progress BETWEEN 0 AND 1 AND version>0);
ALTER TABLE media_transfers ADD CONSTRAINT native_transfer_lease CHECK((status='processing' AND lease_token IS NOT NULL AND lease_until IS NOT NULL) OR(status<>'processing' AND lease_token IS NULL AND lease_until IS NULL));
ALTER TABLE media_transfers ADD CONSTRAINT native_transfer_receipt CHECK(asset_id IS NULL AND nonportable_confirmed_at IS NOT NULL AND (status<>'ready' OR(project_id IS NOT NULL AND sha256 IS NOT NULL AND progress=1)));
CREATE FUNCTION dg_native_transfer_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE mutable text[]:=ARRAY['sha256','status','version','progress','attempts','lease_token','lease_until','project_id','warnings','error_message','updated_at'];
BEGIN
 IF to_jsonb(NEW)-mutable IS DISTINCT FROM to_jsonb(OLD)-mutable OR OLD.status IN ('ready','failed','cancelled') OR(NEW.version<>OLD.version+1 AND NOT(NEW.version=OLD.version AND OLD.status='processing' AND NEW.status='processing' AND NEW.lease_token IS NOT DISTINCT FROM OLD.lease_token AND NEW.attempts=OLD.attempts)) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native transfer inputs and terminal receipts are immutable';
 END IF;
 IF NEW.status<>OLD.status AND NOT((OLD.status='uploading' AND NEW.status IN ('queued','failed','cancelled')) OR(OLD.status='queued' AND NEW.status IN ('processing','cancelled')) OR(OLD.status='processing' AND NEW.status IN ('queued','ready','failed','cancelled'))) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native transfer transition is invalid';
 END IF;
 IF NEW.status='processing' AND NEW.lease_token IS DISTINCT FROM OLD.lease_token AND NEW.attempts<>OLD.attempts+1 THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native transfer claim increments attempts exactly once';
 END IF;
 IF NEW.status='processing' AND NEW.lease_token IS NOT DISTINCT FROM OLD.lease_token AND(NEW.attempts<>OLD.attempts OR OLD.lease_until<=dg_utc_now()) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Expired transfer lease cannot renew';
 END IF;
 IF NEW.status='queued' AND OLD.status='processing' AND(NEW.attempts<>OLD.attempts-1 OR NEW.progress<>0 OR NEW.project_id IS NOT NULL) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Transfer release preserves a clean queued task';
 END IF;
 IF NEW.status='ready' AND(OLD.status<>'processing' OR OLD.lease_until<=dg_utc_now()) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Transfer completion needs an unexpired lease';
 END IF;
 RETURN NEW;
END;
$dg$;
CREATE TRIGGER native_transfer_guard BEFORE UPDATE ON media_transfers FOR EACH ROW EXECUTE FUNCTION dg_native_transfer_guard();
CREATE FUNCTION dg_native_transfer_part_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE r media_transfers%ROWTYPE;
BEGIN
 SELECT * INTO r FROM media_transfers WHERE id=NEW.transfer_id FOR UPDATE;
 IF r.status IS DISTINCT FROM 'uploading' OR NEW.part_index<0 OR NEW.part_index>=r.chunk_count OR NEW.size<>LEAST(r.chunk_size,r.size-NEW.part_index*r.chunk_size) OR NEW.sha256 !~ '^[a-f0-9]{64}$' OR NEW.storage_key !~ '^[a-f0-9-]{36}\.bin$' OR(r.part_hashes IS NOT NULL AND r.part_hashes::jsonb->>NEW.part_index IS DISTINCT FROM NEW.sha256) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native transfer part does not match fixed input';
 END IF;
 RETURN NEW;
END;
$dg$;
CREATE TRIGGER native_transfer_part_guard BEFORE INSERT ON media_transfer_parts FOR EACH ROW EXECUTE FUNCTION dg_native_transfer_part_guard();

-- A worker may create only the package receipt belonging to its current committed transfer lease.
-- It receives no direct INSERT/UPDATE privileges on projects, assets, uploads or provenance.
CREATE FUNCTION dg_native_commit_package(target text,token text,actual_sha text,manifest_text text,new_project text,document_text text,prepared_text text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE r media_transfers%ROWTYPE;m memberships%ROWTYPE;portable jsonb:=manifest_text::jsonb;prepared jsonb:=prepared_text::jsonb;
 item jsonb;a jsonb;asset_id text;upload_id text;ids jsonb:='{}'::jsonb;at_time text:=dg_utc_now();current_app text;
BEGIN
 SELECT app_env INTO current_app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND environment='mock' AND session_user=worker_role;
 IF current_app IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only the native worker can commit a package';END IF;
 SELECT * INTO r FROM media_transfers WHERE id=target AND kind='package' AND environment='mock' AND app_env=current_app;
 SELECT * INTO m FROM dg_native_locked_membership(r.actor_id);
 IF m.tenant_id IS DISTINCT FROM r.tenant_id OR m.role NOT IN ('admin','editor') OR NOT(m.workspace_ids::jsonb ? r.workspace_id) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current package actor cannot create assets and projects';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('["native-asset-workspace",'||to_jsonb(r.tenant_id)::text||','||to_jsonb(r.workspace_id)::text||']',0));
 SELECT * INTO r FROM media_transfers WHERE id=target FOR UPDATE;
 IF r.status IS DISTINCT FROM 'processing' OR r.lease_token IS DISTINCT FROM token OR r.lease_until<=dg_utc_now() OR actual_sha !~ '^[a-f0-9]{64}$' OR(r.expected_sha256 IS NOT NULL AND r.expected_sha256<>actual_sha) OR r.nonportable_confirmed_at IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Package lease or independently confirmed source changed';
 END IF;
 IF portable->>'format' IS DISTINCT FROM 'digitalguide-project' OR portable->>'version' IS DISTINCT FROM '1' OR portable->>'purpose' NOT IN ('video','presentation') OR jsonb_typeof(prepared) IS DISTINCT FROM 'array' OR jsonb_array_length(prepared)<>jsonb_array_length(portable->'assets') OR jsonb_array_length(prepared)>1000 OR(SELECT count(DISTINCT value->>'sourceId') FROM jsonb_array_elements(prepared))<>jsonb_array_length(prepared) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Package manifest and prepared mapping disagree';
 END IF;
 IF(SELECT count(*) FROM studio_projects WHERE tenant_id=r.tenant_id AND workspace_id=r.workspace_id AND archived=0)>=200 THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native workspace active project quota exceeded';
 END IF;
 INSERT INTO _dg_native_package_manifests VALUES(target,manifest_text,encode(sha256(convert_to(manifest_text,'UTF8')),'hex'),at_time);
 FOR item IN SELECT value FROM jsonb_array_elements(prepared) LOOP
  SELECT value INTO a FROM jsonb_array_elements(portable->'assets') WHERE value->>'id'=item->>'sourceId';
  IF a IS NULL OR a->>'mediaType' NOT IN ('image/png','audio/wav') OR(a->>'size')::bigint NOT BETWEEN 1 AND 8388608 OR(a->>'expiresAt' IS NOT NULL AND a->>'expiresAt'<=dg_utc_now()) OR item->>'key' !~ '^[a-f0-9-]{36}\.bin$' OR item->'specs' IS DISTINCT FROM a->'specs' THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Prepared package source or expiry is invalid';
  END IF;
  asset_id:=item->>'id';upload_id:=item->>'uploadId';ids:=ids||jsonb_build_object(a->>'id',asset_id);
  INSERT INTO uploads VALUES(upload_id,r.tenant_id,r.workspace_id,r.actor_id,item->>'key',a->>'sha256',(a->>'size')::bigint,a->>'mediaType',(item->'specs')::text,at_time);
  INSERT INTO assets(id,tenant_id,workspace_id,upload_id,name,category,expires_at,created_at,synthetic) VALUES(asset_id,r.tenant_id,r.workspace_id,upload_id,a->>'name',a->>'category',a->>'expiresAt',at_time,CASE WHEN a->>'synthetic'='true' THEN 1 ELSE 0 END);
  UPDATE asset_library_families SET name_key=lower(a->>'name') WHERE id=asset_id;
  INSERT INTO _dg_native_asset_origins VALUES(asset_id,upload_id,r.tenant_id,r.workspace_id,a->>'sha256',(a->>'size')::bigint,'package_import','mock',current_app,at_time);
  INSERT INTO _dg_native_package_assets VALUES(asset_id,target,a->>'id',a->>'expiresAt',at_time);
  INSERT INTO asset_versions VALUES(asset_id,1,jsonb_build_object('id',asset_id,'workspaceId',r.workspace_id,'name',a->>'name','category',a->>'category','version',1,'archived',false,'synthetic',COALESCE(a->'synthetic'='true'::jsonb,false),'expiresAt',a->'expiresAt','createdAt',at_time,'mediaType',a->>'mediaType','size',a->'size','sha256',a->>'sha256','specs',item->'specs')::text,at_time);
 END LOOP;
 INSERT INTO studio_projects(id,tenant_id,workspace_id,name,purpose,document,environment,app_env,created_at,updated_at) VALUES(new_project,r.tenant_id,r.workspace_id,r.name,portable->>'purpose',document_text,'mock',current_app,at_time,at_time);
 INSERT INTO studio_project_versions VALUES(new_project,1,r.name,document_text,r.actor_id,at_time);
 INSERT INTO studio_package_imports VALUES(target,new_project,actual_sha,ids::text,(portable->'nonPortable')::text,at_time);
 UPDATE media_transfers SET status='ready',project_id=new_project,sha256=actual_sha,progress=1,warnings=(SELECT jsonb_agg(reason)::text FROM(SELECT '已导入可编辑工程和固定源素材；模型、账号与专项授权没有迁移。' AS reason UNION ALL SELECT value->>'reason' FROM jsonb_array_elements(portable->'nonPortable')) n),error_message=NULL,lease_token=NULL,lease_until=NULL,version=version+1,updated_at=dg_utc_now() WHERE id=target AND lease_token=token AND lease_until>dg_utc_now();
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Package lease expired before completion';END IF;
 RETURN new_project;
END;
$dg$;
REVOKE ALL ON FUNCTION dg_native_commit_package(text,text,text,text,text,text,text) FROM PUBLIC;
