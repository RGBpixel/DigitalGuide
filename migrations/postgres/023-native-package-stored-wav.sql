-- Keep applied 017 unchanged. Package PCM WAV shares the generated-audio 64MB bound.
-- Ordinary private uploads remain bounded by the existing 8MB inspector and API.
CREATE OR REPLACE FUNCTION dg_native_commit_transfer_asset(target text,token text,a jsonb,item jsonb,source_kind text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE r media_transfers%ROWTYPE;at_time text:=dg_utc_now();current_app text;maximum bigint;asset_id text:=item->>'id';upload_id text:=item->>'uploadId';poster jsonb:=item->'poster';preview jsonb:=item->'preview';
BEGIN
 SELECT app_env INTO current_app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND environment='mock' AND session_user=worker_role;
 SELECT * INTO r FROM media_transfers WHERE id=target AND status='processing' AND lease_token=token AND lease_until>dg_utc_now() AND environment='mock' AND app_env=current_app FOR UPDATE;
 IF r.id IS NULL OR source_kind NOT IN ('video_upload','package_import') OR(source_kind='video_upload' AND r.kind<>'video') OR(source_kind='package_import' AND r.kind<>'package') THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only the current native transfer may create a prepared asset';
 END IF;
 maximum:=CASE a->>'mediaType' WHEN 'image/png' THEN 67174400 WHEN 'audio/wav' THEN 67108864 WHEN 'video/mp4' THEN 134217728 WHEN 'video/quicktime' THEN 1073741824 ELSE 0 END;
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
