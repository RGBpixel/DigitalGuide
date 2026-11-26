-- Preserve applied013-015. Use the same application normalization for imported asset-library search.
CREATE OR REPLACE FUNCTION dg_native_commit_package(target text,token text,actual_sha text,manifest_text text,new_project text,document_text text,prepared_text text)
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
  IF a IS NULL OR jsonb_typeof(item->'nameKey') IS DISTINCT FROM 'string' OR length(item->>'nameKey')=0 OR a->>'mediaType' NOT IN ('image/png','audio/wav') OR(a->>'size')::bigint NOT BETWEEN 1 AND 8388608 OR(a->>'expiresAt' IS NOT NULL AND a->>'expiresAt'<=dg_utc_now()) OR item->>'key' !~ '^[a-f0-9-]{36}\.bin$' OR item->'specs' IS DISTINCT FROM a->'specs' THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Prepared package source or expiry is invalid';
  END IF;
  asset_id:=item->>'id';upload_id:=item->>'uploadId';ids:=ids||jsonb_build_object(a->>'id',asset_id);
  INSERT INTO uploads VALUES(upload_id,r.tenant_id,r.workspace_id,r.actor_id,item->>'key',a->>'sha256',(a->>'size')::bigint,a->>'mediaType',(item->'specs')::text,at_time);
  INSERT INTO assets(id,tenant_id,workspace_id,upload_id,name,category,expires_at,created_at,synthetic) VALUES(asset_id,r.tenant_id,r.workspace_id,upload_id,a->>'name',a->>'category',a->>'expiresAt',at_time,CASE WHEN a->>'synthetic'='true' THEN 1 ELSE 0 END);
  UPDATE asset_library_families SET name_key=item->>'nameKey' WHERE id=asset_id;
  INSERT INTO _dg_native_asset_origins VALUES(asset_id,upload_id,r.tenant_id,r.workspace_id,a->>'sha256',(a->>'size')::bigint,'package_import','mock',current_app,at_time);
  INSERT INTO _dg_native_package_assets VALUES(asset_id,target,a->>'id',a->>'expiresAt',at_time);
  INSERT INTO asset_versions VALUES(asset_id,1,jsonb_build_object('id',asset_id,'workspaceId',r.workspace_id,'name',a->>'name','category',a->>'category','version',1,'archived',false,'synthetic',COALESCE(a->'synthetic'='true'::jsonb,false),'expiresAt',a->'expiresAt','createdAt',at_time,'mediaType',a->>'mediaType','size',a->'size','sha256',a->>'sha256','specs',item->'specs')::text,at_time);
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
