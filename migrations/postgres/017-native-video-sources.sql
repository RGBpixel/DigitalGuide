-- Applied001-016 remain frozen. Native video originals and bounded large PNG package sources.
ALTER TABLE _dg_native_asset_origins DROP CONSTRAINT native_asset_source_kind;
ALTER TABLE _dg_native_asset_origins ADD CONSTRAINT native_asset_source_kind CHECK(source_kind IN ('private_upload','package_import','video_upload'));
ALTER TABLE media_transfers DROP CONSTRAINT native_transfer_kind;
ALTER TABLE media_transfers ADD CONSTRAINT native_transfer_kind CHECK(kind IN ('package','video'));
ALTER TABLE media_transfers DROP CONSTRAINT native_transfer_receipt;
ALTER TABLE media_transfers ADD CONSTRAINT native_transfer_receipt CHECK(
 (kind='package' AND asset_id IS NULL AND nonportable_confirmed_at IS NOT NULL AND(status<>'ready' OR(project_id IS NOT NULL AND sha256 IS NOT NULL AND progress=1)))
 OR(kind='video' AND project_id IS NULL AND nonportable_confirmed_at IS NULL AND(status<>'ready' OR(asset_id IS NOT NULL AND sha256 IS NOT NULL AND progress=1)))
);
ALTER TABLE media_transfers ADD CONSTRAINT native_video_transfer_bound CHECK(kind<>'video' OR(category IN ('background','reference') AND(file_name ~* '\.mov$' OR(file_name ~* '\.mp4$' AND size<=134217728))));
CREATE TABLE _dg_native_video_origins (
 asset_id text PRIMARY KEY REFERENCES assets(id),transfer_id text NOT NULL REFERENCES media_transfers(id),
 source_kind text NOT NULL CHECK(source_kind IN ('package_import','video_upload')),upload_id text NOT NULL REFERENCES uploads(id),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),size bigint NOT NULL CHECK(size BETWEEN 1 AND 1073741824),created_at text NOT NULL
);
CREATE TRIGGER native_video_origin_immutable BEFORE UPDATE OR DELETE ON _dg_native_video_origins FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_video_poster_immutable BEFORE UPDATE OR DELETE ON video_sources FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_video_proxy_immutable BEFORE UPDATE OR DELETE ON alpha_video_previews FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE OR REPLACE FUNCTION dg_native_transfer_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE mutable text[]:=ARRAY['sha256','status','version','progress','attempts','lease_token','lease_until','project_id','asset_id','warnings','error_message','updated_at'];
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
 IF NEW.status='queued' AND OLD.status='processing' AND(NEW.attempts<>OLD.attempts-1 OR NEW.progress<>0 OR NEW.project_id IS NOT NULL OR NEW.asset_id IS NOT NULL) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Transfer release preserves a clean queued task';
 END IF;
 IF NEW.status='ready' AND(OLD.status<>'processing' OR OLD.lease_until<=dg_utc_now()) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Transfer completion needs an unexpired lease';
 END IF;
 RETURN NEW;
END;
$dg$;

-- Internal helper has no application/worker/PUBLIC grant. Only restricted completion functions call it.
CREATE FUNCTION dg_native_commit_transfer_asset(target text,token text,a jsonb,item jsonb,source_kind text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE r media_transfers%ROWTYPE;at_time text:=dg_utc_now();current_app text;maximum bigint;asset_id text:=item->>'id';upload_id text:=item->>'uploadId';poster jsonb:=item->'poster';preview jsonb:=item->'preview';
BEGIN
 SELECT app_env INTO current_app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND environment='mock' AND session_user=worker_role;
 SELECT * INTO r FROM media_transfers WHERE id=target AND status='processing' AND lease_token=token AND lease_until>dg_utc_now() AND environment='mock' AND app_env=current_app FOR UPDATE;
 IF r.id IS NULL OR source_kind NOT IN ('video_upload','package_import') OR(source_kind='video_upload' AND r.kind<>'video') OR(source_kind='package_import' AND r.kind<>'package') THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only the current native transfer may create a prepared asset';
 END IF;
 maximum:=CASE a->>'mediaType' WHEN 'image/png' THEN 67174400 WHEN 'audio/wav' THEN 8388608 WHEN 'video/mp4' THEN 134217728 WHEN 'video/quicktime' THEN 1073741824 ELSE 0 END;
 IF a IS NULL OR maximum=0 OR jsonb_typeof(item->'nameKey') IS DISTINCT FROM 'string' OR length(item->>'nameKey')=0
  OR COALESCE((a->>'size')::bigint,0) NOT BETWEEN 1 AND maximum OR a->>'sha256' IS NULL OR a->>'sha256' !~ '^[a-f0-9]{64}$'
  OR(a->>'expiresAt' IS NOT NULL AND a->>'expiresAt'<=dg_utc_now()) OR item->>'key' IS NULL OR item->>'key' !~ '^[a-f0-9-]{36}\.bin$'
  OR item->'specs' IS DISTINCT FROM a->'specs' OR a->>'category' NOT IN ('avatar','voice','background','reference')
  OR(a->>'category'='avatar' AND a->>'mediaType'<>'image/png') OR(a->>'category'='voice' AND a->>'mediaType'<>'audio/wav')
  OR(a->>'category'='background' AND a->>'mediaType' NOT IN ('image/png','video/mp4','video/quicktime')) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Prepared transfer source, format, category or expiry is invalid';
 END IF;
 IF a->>'mediaType' IN ('video/mp4','video/quicktime') THEN
  IF poster->>'storage_key' IS NULL OR poster->>'storage_key' !~ '^[a-f0-9-]{36}\.bin$' OR poster->>'sha256' IS NULL OR poster->>'sha256' !~ '^[a-f0-9]{64}$' OR COALESCE((poster->>'size')::bigint,0) NOT BETWEEN 1 AND 8388608
   OR(a->>'mediaType'='video/quicktime' AND(preview->>'storage_key' IS NULL OR preview->>'storage_key' !~ '^[a-f0-9-]{36}\.bin$' OR preview->>'sha256' IS NULL OR preview->>'sha256' !~ '^[a-f0-9]{64}$' OR COALESCE((preview->>'size')::bigint,0) NOT BETWEEN 1 AND 134217728))
   OR(a->>'mediaType'='video/mp4' AND preview IS DISTINCT FROM 'null'::jsonb)
   OR(source_kind='video_upload' AND((a->>'size')::bigint<>r.size OR(r.expected_sha256 IS NOT NULL AND a->>'sha256'<>r.expected_sha256) OR a->>'name'<>r.name OR a->>'category'<>r.category)) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Actual video inspection receipt and transfer source disagree';
  END IF;
 ELSIF source_kind='video_upload' THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Video transfer requires an actual video original';
 END IF;
 INSERT INTO uploads VALUES(upload_id,r.tenant_id,r.workspace_id,r.actor_id,item->>'key',a->>'sha256',(a->>'size')::bigint,a->>'mediaType',(item->'specs')::text,at_time);
 INSERT INTO assets(id,tenant_id,workspace_id,upload_id,name,category,expires_at,created_at,synthetic) VALUES(asset_id,r.tenant_id,r.workspace_id,upload_id,a->>'name',a->>'category',a->>'expiresAt',at_time,CASE WHEN a->>'synthetic'='true' THEN 1 ELSE 0 END);
 UPDATE asset_library_families SET name_key=item->>'nameKey' WHERE id=asset_id;
 INSERT INTO _dg_native_asset_origins VALUES(asset_id,upload_id,r.tenant_id,r.workspace_id,a->>'sha256',(a->>'size')::bigint,source_kind,'mock',current_app,at_time);
 IF a->>'mediaType' IN ('video/mp4','video/quicktime') THEN
  INSERT INTO video_sources VALUES(asset_id,poster->>'storage_key',poster->>'sha256',(poster->>'size')::bigint,at_time);
  IF a->>'mediaType'='video/quicktime' THEN INSERT INTO alpha_video_previews VALUES(asset_id,preview->>'storage_key',preview->>'sha256',(preview->>'size')::bigint,at_time);END IF;
  INSERT INTO _dg_native_video_origins VALUES(asset_id,target,source_kind,upload_id,a->>'sha256',(a->>'size')::bigint,at_time);
 END IF;
 INSERT INTO asset_versions VALUES(asset_id,1,jsonb_build_object('id',asset_id,'workspaceId',r.workspace_id,'name',a->>'name','category',a->>'category','version',1,'archived',false,'synthetic',COALESCE(a->'synthetic'='true'::jsonb,false),'expiresAt',a->'expiresAt','createdAt',at_time,'mediaType',a->>'mediaType','size',a->'size','sha256',a->>'sha256','specs',item->'specs')::text,at_time);
 RETURN asset_id;
END;
$dg$;
REVOKE ALL ON FUNCTION dg_native_commit_transfer_asset(text,text,jsonb,jsonb,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION dg_native_commit_package(target text,token text,actual_sha text,manifest_text text,new_project text,document_text text,prepared_text text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE r media_transfers%ROWTYPE;m memberships%ROWTYPE;portable jsonb:=manifest_text::jsonb;prepared jsonb:=prepared_text::jsonb;
 item jsonb;a jsonb;asset_id text;ids jsonb:='{}'::jsonb;at_time text:=dg_utc_now();current_app text;
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
 IF r.status IS DISTINCT FROM 'processing' OR r.lease_token IS DISTINCT FROM token OR r.lease_until<=dg_utc_now() OR actual_sha IS NULL OR actual_sha !~ '^[a-f0-9]{64}$' OR(r.expected_sha256 IS NOT NULL AND r.expected_sha256<>actual_sha) OR r.nonportable_confirmed_at IS NULL THEN
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
  asset_id:=dg_native_commit_transfer_asset(target,token,a,item,'package_import');ids:=ids||jsonb_build_object(a->>'id',asset_id);
  INSERT INTO _dg_native_package_assets VALUES(asset_id,target,a->>'id',a->>'expiresAt',at_time);
 END LOOP;
 INSERT INTO studio_projects(id,tenant_id,workspace_id,name,purpose,document,environment,app_env,created_at,updated_at) VALUES(new_project,r.tenant_id,r.workspace_id,r.name,portable->>'purpose',document_text,'mock',current_app,at_time,at_time);
 INSERT INTO studio_project_versions VALUES(new_project,1,r.name,document_text,r.actor_id,at_time);
 INSERT INTO studio_package_imports VALUES(target,new_project,actual_sha,ids::text,(portable->'nonPortable')::text,at_time);
 UPDATE media_transfers SET status='ready',project_id=new_project,sha256=actual_sha,progress=1,warnings=(SELECT jsonb_agg(reason)::text FROM(SELECT '已导入可编辑工程和固定源素材；模型、账号与专项授权没有迁移。' AS reason UNION ALL SELECT value->>'reason' FROM jsonb_array_elements(portable->'nonPortable')) n),error_message=NULL,lease_token=NULL,lease_until=NULL,version=version+1,updated_at=dg_utc_now() WHERE id=target AND lease_token=token AND lease_until>dg_utc_now();
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Package lease expired before completion';END IF;
 INSERT INTO audit_events VALUES(gen_random_uuid()::text,r.tenant_id,r.workspace_id,r.actor_id,'studio.package_import',new_project,'confirmed','native-package:'||target,dg_utc_now());
 RETURN new_project;
END;
$dg$;
REVOKE ALL ON FUNCTION dg_native_commit_package(text,text,text,text,text,text,text) FROM PUBLIC;

CREATE FUNCTION dg_native_commit_video(target text,token text,actual_sha text,asset_text text,prepared_text text,warnings_text text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE r media_transfers%ROWTYPE;m memberships%ROWTYPE;current_app text;new_asset text;a jsonb:=asset_text::jsonb;
BEGIN
 SELECT app_env INTO current_app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND environment='mock' AND session_user=worker_role;
 IF current_app IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only the native worker can commit a video';END IF;
 SELECT * INTO r FROM media_transfers WHERE id=target AND kind='video' AND environment='mock' AND app_env=current_app;
 SELECT * INTO m FROM dg_native_locked_membership(r.actor_id);
 IF m.tenant_id IS DISTINCT FROM r.tenant_id OR m.role NOT IN ('admin','editor') OR NOT(m.workspace_ids::jsonb ? r.workspace_id) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current video actor cannot create assets';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('["native-asset-workspace",'||to_jsonb(r.tenant_id)::text||','||to_jsonb(r.workspace_id)::text||']',0));
 SELECT * INTO r FROM media_transfers WHERE id=target FOR UPDATE;
 IF r.status IS DISTINCT FROM 'processing' OR r.lease_token IS DISTINCT FROM token OR r.lease_until<=dg_utc_now() OR actual_sha IS NULL OR actual_sha !~ '^[a-f0-9]{64}$' OR actual_sha IS DISTINCT FROM a->>'sha256' OR(r.expected_sha256 IS NOT NULL AND r.expected_sha256<>actual_sha) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Video lease or fixed source changed';
 END IF;
 new_asset:=dg_native_commit_transfer_asset(target,token,a,prepared_text::jsonb,'video_upload');
 UPDATE media_transfers SET status='ready',asset_id=new_asset,sha256=actual_sha,progress=1,warnings=warnings_text,error_message=NULL,lease_token=NULL,lease_until=NULL,version=version+1,updated_at=dg_utc_now() WHERE id=target AND lease_token=token AND lease_until>dg_utc_now();
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Video lease expired before completion';END IF;
 INSERT INTO audit_events VALUES(gen_random_uuid()::text,r.tenant_id,r.workspace_id,r.actor_id,'asset.video_import',new_asset,'confirmed','native-video:'||target,dg_utc_now());
 RETURN new_asset;
END;
$dg$;
REVOKE ALL ON FUNCTION dg_native_commit_video(text,text,text,text,text,text) FROM PUBLIC;
