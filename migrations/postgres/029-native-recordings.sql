-- R-058/R-074: native personal recording plans, resumable originals and normalized video.
-- Applied001-028 are unchanged. Recording inputs and actual completion receipts are immutable.
ALTER TABLE _dg_native_asset_origins DROP CONSTRAINT native_asset_source_kind;
ALTER TABLE _dg_native_asset_origins ADD CONSTRAINT native_asset_source_kind CHECK(source_kind IN('private_upload','package_import','video_upload','system_speech','media_processing','recording'));
ALTER TABLE media_transfers DROP CONSTRAINT native_transfer_kind;
ALTER TABLE media_transfers ADD CONSTRAINT native_transfer_kind CHECK(kind IN('package','video','recording'));
ALTER TABLE media_transfers DROP CONSTRAINT native_transfer_receipt;
ALTER TABLE media_transfers ADD CONSTRAINT native_transfer_receipt CHECK(
 (kind='package' AND asset_id IS NULL AND nonportable_confirmed_at IS NOT NULL AND(status<>'ready' OR(project_id IS NOT NULL AND sha256 IS NOT NULL AND progress=1)))
 OR(kind IN('video','recording') AND project_id IS NULL AND nonportable_confirmed_at IS NULL AND(status<>'ready' OR(asset_id IS NOT NULL AND sha256 IS NOT NULL AND progress=1))));
ALTER TABLE media_transfers ADD CONSTRAINT native_recording_transfer_shape CHECK(kind<>'recording' OR(size<=134217728 AND chunk_count<=32 AND expected_sha256 IS NOT NULL AND part_hashes IS NOT NULL AND category='reference' AND file_name ~* '\.(webm|mp4)$'));
CREATE TABLE _dg_native_recording_inputs(transfer_id text PRIMARY KEY REFERENCES media_transfers(id),recording_id text NOT NULL UNIQUE REFERENCES studio_recordings(id),input_snapshot text NOT NULL,input_hash text NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),created_at text NOT NULL);
CREATE TABLE _dg_native_recording_receipts(transfer_id text PRIMARY KEY REFERENCES media_transfers(id),recording_id text NOT NULL UNIQUE REFERENCES studio_recordings(id),lease_token text NOT NULL,input_hash text NOT NULL,receipt text NOT NULL,receipt_hash text NOT NULL CHECK(receipt_hash ~ '^[a-f0-9]{64}$'),created_at text NOT NULL);
CREATE TABLE _dg_native_recording_leases(transfer_id text PRIMARY KEY REFERENCES media_transfers(id),token text NOT NULL,lease_until text NOT NULL);
DO $dg$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['_dg_native_recording_inputs','_dg_native_recording_receipts','studio_recording_outputs','studio_recording_versions','studio_recording_applications'] LOOP EXECUTE format('CREATE TRIGGER native_recording_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION dg_native_append_only()',t);END LOOP;END;$dg$;
ALTER TABLE studio_recordings ADD CONSTRAINT native_recording_shape CHECK(version>0 AND environment='mock' AND app_env IN('development','sandbox') AND(duration_hint_ms IS NULL OR duration_hint_ms BETWEEN 100 AND 600000) AND jsonb_typeof(snapshot::jsonb)='object');
CREATE FUNCTION dg_native_recording_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE app text;
BEGIN
 SELECT app_env INTO app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user=app_role;
 IF app IS NULL OR NEW.app_env<>app OR NEW.environment<>'mock' OR NOT EXISTS(SELECT 1 FROM memberships WHERE user_id=NEW.actor_id AND tenant_id=NEW.tenant_id AND role IN('admin','editor') AND workspace_ids::jsonb ? NEW.workspace_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native recording requires a current scoped editor';END IF;
 IF TG_OP='INSERT' THEN IF NEW.version<>1 OR NEW.transfer_id IS NOT NULL OR NEW.withdrawn_at IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Recording starts as an unbound plan';END IF;
 ELSE
  IF OLD.withdrawn_at IS NOT NULL OR NEW.version<>OLD.version+1 OR to_jsonb(NEW)-ARRAY['name','version','snapshot','subject','proof','expires_at','withdrawn_at','transfer_id','duration_hint_ms','updated_at'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['name','version','snapshot','subject','proof','expires_at','withdrawn_at','transfer_id','duration_hint_ms','updated_at'] OR OLD.transfer_id IS NOT NULL AND to_jsonb(NEW)-ARRAY['version','withdrawn_at','updated_at'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['version','withdrawn_at','updated_at'] THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Recording identity, bound input and withdrawal are permanent';END IF;
 END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_recording_guard BEFORE INSERT OR UPDATE ON studio_recordings FOR EACH ROW EXECUTE FUNCTION dg_native_recording_guard();
CREATE FUNCTION dg_native_recording_revision_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN IF NEW.action NOT IN('created','saved','upload_started','withdrawn') OR NOT EXISTS(SELECT 1 FROM studio_recordings WHERE id=NEW.recording_id AND version=NEW.version AND snapshot=NEW.snapshot AND actor_id=NEW.actor_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Recording history must match its exact current version';END IF;RETURN NEW;END;$dg$;
CREATE TRIGGER native_recording_revision_guard BEFORE INSERT ON studio_recording_versions FOR EACH ROW EXECUTE FUNCTION dg_native_recording_revision_guard();
CREATE FUNCTION dg_native_recording_application_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN IF NOT EXISTS(SELECT 1 FROM studio_recordings r JOIN studio_projects p ON p.id=NEW.project_id JOIN studio_recording_outputs o ON o.recording_id=r.id WHERE r.id=NEW.recording_id AND r.actor_id=NEW.actor_id AND r.tenant_id=p.tenant_id AND r.workspace_id=p.workspace_id AND r.withdrawn_at IS NULL AND r.snapshot::jsonb->>'expiresAt'>dg_utc_now() AND p.version=NEW.project_version) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Recording adoption requires a current same-workspace project and actual output';END IF;RETURN NEW;END;$dg$;
CREATE TRIGGER native_recording_application_guard BEFORE INSERT ON studio_recording_applications FOR EACH ROW EXECUTE FUNCTION dg_native_recording_application_guard();
CREATE FUNCTION dg_native_recording_binding_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE r studio_recordings%ROWTYPE;t media_transfers%ROWTYPE;i _dg_native_recording_inputs%ROWTYPE;j jsonb;
BEGIN
 IF TG_TABLE_NAME='media_transfers' THEN IF NEW.kind<>'recording' THEN RETURN NULL;END IF;SELECT * INTO t FROM media_transfers WHERE id=NEW.id;SELECT * INTO r FROM studio_recordings WHERE transfer_id=t.id;
 ELSE IF NEW.transfer_id IS NULL THEN RETURN NULL;END IF;SELECT * INTO r FROM studio_recordings WHERE id=NEW.id;SELECT * INTO t FROM media_transfers WHERE id=r.transfer_id;END IF;
 SELECT * INTO i FROM _dg_native_recording_inputs WHERE transfer_id=t.id;j:=i.input_snapshot::jsonb;
 IF r.id IS NULL OR t.id IS NULL OR i.recording_id IS DISTINCT FROM r.id OR t.kind<>'recording' OR t.tenant_id<>r.tenant_id OR t.workspace_id<>r.workspace_id OR t.actor_id<>r.actor_id OR t.app_env<>r.app_env OR j->>'recordingId' IS DISTINCT FROM r.id OR(j->>'recordingVersion')::bigint>r.version OR j->>'transferId' IS DISTINCT FROM t.id OR j->>'name' IS DISTINCT FROM r.name OR j->'snapshot' IS DISTINCT FROM r.snapshot::jsonb OR j->'rights'->>'subject' IS DISTINCT FROM r.subject OR j->'rights'->>'proof' IS DISTINCT FROM r.proof OR j->'rights'->>'expiresAt' IS DISTINCT FROM r.expires_at OR(j->>'durationHintMs')::bigint IS DISTINCT FROM r.duration_hint_ms THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Recording and transfer need their exact immutable input binding';END IF;RETURN NULL;
END;$dg$;
CREATE CONSTRAINT TRIGGER native_recording_transfer_binding AFTER INSERT ON media_transfers DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_recording_binding_guard();
CREATE CONSTRAINT TRIGGER native_recording_plan_binding AFTER INSERT OR UPDATE ON studio_recordings DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_recording_binding_guard();
CREATE FUNCTION dg_native_recording_transfer_ready_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN IF NEW.kind='recording' AND NEW.status='ready' AND(NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user=worker_role) OR NOT EXISTS(SELECT 1 FROM _dg_native_recording_receipts r JOIN studio_recording_outputs o ON o.recording_id=r.recording_id WHERE r.transfer_id=NEW.id AND r.lease_token=OLD.lease_token AND o.asset_id=NEW.asset_id AND o.raw_sha256=NEW.sha256 AND o.raw_size=NEW.size)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Only worker can complete a recording with exact original and normalized receipts';END IF;RETURN NEW;END;$dg$;
CREATE TRIGGER native_recording_transfer_ready_guard BEFORE UPDATE ON media_transfers FOR EACH ROW EXECUTE FUNCTION dg_native_recording_transfer_ready_guard();
CREATE FUNCTION dg_native_recording_valid(target text,token text,completed boolean) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE r studio_recordings%ROWTYPE;t media_transfers%ROWTYPE;i _dg_native_recording_inputs%ROWTYPE;app text;
BEGIN
 SELECT app_env INTO app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user=worker_role;IF app IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only native worker validates recording leases';END IF;
 SELECT * INTO t FROM media_transfers WHERE id=target;SELECT * INTO r FROM studio_recordings WHERE transfer_id=t.id;SELECT * INTO i FROM _dg_native_recording_inputs WHERE transfer_id=t.id;
 IF t.id IS NULL OR t.kind<>'recording' OR t.app_env<>app OR t.environment<>'mock' OR r.id IS NULL OR i.recording_id IS DISTINCT FROM r.id OR r.withdrawn_at IS NOT NULL OR r.expires_at<=dg_utc_now() OR r.snapshot::jsonb->>'expiresAt'<=dg_utc_now() OR NOT EXISTS(SELECT 1 FROM memberships WHERE user_id=r.actor_id AND tenant_id=r.tenant_id AND role IN('admin','editor') AND workspace_ids::jsonb ? r.workspace_id) OR EXISTS(SELECT 1 FROM jsonb_array_elements(r.snapshot::jsonb->'sourceRefs') f LEFT JOIN studio_content_sources s ON s.id=f->>'id' WHERE s.id IS NULL OR s.tenant_id<>r.tenant_id OR s.workspace_id<>r.workspace_id OR s.version::text<>f->>'version' OR s.text_sha256<>f->>'textSHA256' OR s.withdrawn<>0 OR s.expires_at<=dg_utc_now()) OR NOT EXISTS(SELECT 1 FROM _dg_native_recording_leases WHERE transfer_id=t.id AND _dg_native_recording_leases.token=dg_native_recording_valid.token AND lease_until>dg_utc_now()) THEN RETURN false;END IF;
 RETURN(NOT completed AND t.status='processing' AND t.lease_token=token AND t.lease_until>dg_utc_now()) OR(completed AND t.status='ready' AND EXISTS(SELECT 1 FROM _dg_native_recording_receipts WHERE transfer_id=t.id AND lease_token=token));
END;$dg$;
CREATE FUNCTION dg_native_recording_claim() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE app text;t media_transfers%ROWTYPE;token text:=gen_random_uuid()::text;until_at text;
BEGIN
 SELECT app_env INTO app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user=worker_role;IF app IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only worker claims recording transfers';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('native-package-transfer-capacity',0)) THEN RETURN NULL;END IF;
 DELETE FROM _dg_native_recording_leases WHERE lease_until<=dg_utc_now();
 UPDATE media_transfers SET status='failed',error_message='录制检查恢复次数已用完，请新建上传。',lease_token=NULL,lease_until=NULL,version=version+1,updated_at=dg_utc_now() WHERE kind='recording' AND app_env=app AND status='processing' AND lease_until<=dg_utc_now() AND attempts>=2;
 IF(SELECT count(*) FROM media_transfers WHERE app_env=app AND status='processing' AND lease_until>dg_utc_now())+(SELECT count(*) FROM _dg_native_recording_leases l JOIN media_transfers mt ON mt.id=l.transfer_id WHERE l.lease_until>dg_utc_now() AND mt.status<>'processing')>=2 THEN RETURN NULL;END IF;
 SELECT * INTO t FROM media_transfers m WHERE m.kind='recording' AND m.app_env=app AND m.attempts<2 AND(m.status='queued' OR m.status='processing' AND m.lease_until<=dg_utc_now()) AND NOT EXISTS(SELECT 1 FROM _dg_native_recording_leases WHERE transfer_id=m.id) ORDER BY m.created_at,m.id LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF t.id IS NULL THEN RETURN NULL;END IF;until_at:=to_char((clock_timestamp()+interval '90 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 UPDATE media_transfers SET status='processing',attempts=attempts+1,lease_token=token,lease_until=until_at,progress=0,version=version+1,updated_at=dg_utc_now() WHERE id=t.id RETURNING * INTO t;
 INSERT INTO _dg_native_recording_leases VALUES(t.id,token,until_at);RETURN to_jsonb(t);
END;$dg$;
CREATE FUNCTION dg_native_recording_hold(target text,token text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND session_user=worker_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only worker holds physical recording execution';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('native-package-transfer-capacity',0));UPDATE _dg_native_recording_leases SET lease_until=to_char((clock_timestamp()+interval '90 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') WHERE transfer_id=target AND _dg_native_recording_leases.token=dg_native_recording_hold.token AND lease_until>dg_utc_now();RETURN FOUND;
END;$dg$;
CREATE FUNCTION dg_native_recording_release(target text,token text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND session_user=worker_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only worker releases physical recording execution';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('native-package-transfer-capacity',0));DELETE FROM _dg_native_recording_leases WHERE transfer_id=target AND _dg_native_recording_leases.token=dg_native_recording_release.token;RETURN FOUND;
END;$dg$;
CREATE FUNCTION dg_native_commit_recording(target text,token text,actual_input text,receipt_text text,receipt_digest text,warnings_text text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE t media_transfers%ROWTYPE;r studio_recordings%ROWTYPE;i _dg_native_recording_inputs%ROWTYPE;v jsonb:=receipt_text::jsonb;raw jsonb:=v->'raw';o jsonb:=v->'object';poster jsonb:=v->'poster';at_time text:=dg_utc_now();asset_id text:=v->>'assetId';upload_id text:=v->>'uploadId';
BEGIN
 PERFORM user_id FROM dg_native_locked_membership((SELECT actor_id FROM media_transfers WHERE id=target));SELECT * INTO t FROM media_transfers WHERE id=target FOR UPDATE;SELECT * INTO r FROM studio_recordings WHERE transfer_id=target;SELECT * INTO i FROM _dg_native_recording_inputs WHERE transfer_id=target;
 IF NOT dg_native_recording_valid(target,token,false) OR i.input_hash IS DISTINCT FROM actual_input OR receipt_digest !~ '^[a-f0-9]{64}$' OR raw->>'sha256' IS DISTINCT FROM t.expected_sha256 OR(raw->>'size')::bigint<>t.size OR v->>'inputContainer' NOT IN('webm','mp4') OR v->>'expiresAt' IS DISTINCT FROM r.snapshot::jsonb->>'expiresAt' OR(v->>'expiresAt')<=at_time THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Recording completion lost its original, fixed source or lease';END IF;
 IF raw->>'storage_key' !~ '^[a-f0-9-]{36}\.bin$' OR o->>'storage_key' !~ '^[a-f0-9-]{36}\.bin$' OR o->>'sha256' !~ '^[a-f0-9]{64}$' OR COALESCE((o->>'size')::bigint,0) NOT BETWEEN 32 AND 134217728 OR poster->>'storage_key' !~ '^[a-f0-9-]{36}\.bin$' OR poster->>'sha256' !~ '^[a-f0-9]{64}$' OR COALESCE((poster->>'size')::bigint,0) NOT BETWEEN 1 AND 8388608 OR jsonb_typeof(v->'specs')<>'object' OR jsonb_typeof(v->'sourceSpecs')<>'object' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Recording files need exact bounded private receipts';END IF;
 INSERT INTO _dg_native_recording_receipts VALUES(t.id,r.id,token,i.input_hash,receipt_text,receipt_digest,at_time);
 INSERT INTO uploads VALUES(upload_id,t.tenant_id,t.workspace_id,t.actor_id,o->>'storage_key',o->>'sha256',(o->>'size')::bigint,'video/mp4',(v->'specs')::text,at_time);
 INSERT INTO assets(id,tenant_id,workspace_id,upload_id,name,category,expires_at,created_at) VALUES(asset_id,t.tenant_id,t.workspace_id,upload_id,r.name,'reference',v->>'expiresAt',at_time);
 INSERT INTO _dg_native_asset_origins VALUES(asset_id,upload_id,t.tenant_id,t.workspace_id,o->>'sha256',(o->>'size')::bigint,'recording','mock',t.app_env,at_time);
 INSERT INTO video_sources VALUES(asset_id,poster->>'storage_key',poster->>'sha256',(poster->>'size')::bigint,at_time);
 INSERT INTO studio_recording_outputs VALUES(r.id,t.id,raw->>'storage_key',raw->>'sha256',(raw->>'size')::bigint,v->>'inputContainer',asset_id,o->>'sha256',(o->>'size')::bigint,(v->'sourceSpecs')::text,(v->'specs')::text,at_time);
 INSERT INTO asset_versions VALUES(asset_id,1,jsonb_build_object('id',asset_id,'workspaceId',r.workspace_id,'name',r.name,'category','reference','version',1,'archived',false,'synthetic',false,'expiresAt',v->>'expiresAt','createdAt',at_time,'mediaType','video/mp4','size',(o->>'size')::bigint,'sha256',o->>'sha256','specs',v->'specs')::text,at_time);
 UPDATE media_transfers SET status='ready',asset_id=dg_native_commit_recording.asset_id,sha256=raw->>'sha256',progress=1,warnings=warnings_text,error_message=NULL,lease_token=NULL,lease_until=NULL,version=version+1,updated_at=at_time WHERE id=target;
 INSERT INTO audit_events VALUES(gen_random_uuid()::text,t.tenant_id,t.workspace_id,t.actor_id,'recording.complete',r.id,'confirmed',token,at_time);RETURN r.id;
END;$dg$;
CREATE FUNCTION dg_native_recording_asset_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN IF NEW.source_kind='recording' AND NOT EXISTS(SELECT 1 FROM studio_recording_outputs o JOIN _dg_native_recording_receipts r ON r.recording_id=o.recording_id WHERE o.asset_id=NEW.asset_id AND o.output_sha256=NEW.sha256 AND o.output_size=NEW.size AND r.receipt::jsonb->>'uploadId'=NEW.upload_id AND r.receipt::jsonb->>'assetId'=NEW.asset_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Recording assets require exact immutable output receipts';END IF;RETURN NULL;END;$dg$;
CREATE CONSTRAINT TRIGGER native_recording_asset_guard AFTER INSERT ON _dg_native_asset_origins DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_recording_asset_guard();
CREATE FUNCTION dg_native_recording_expiry_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE cutoff text;BEGIN SELECT receipt::jsonb->>'expiresAt' INTO cutoff FROM _dg_native_recording_receipts WHERE receipt::jsonb->>'assetId'=OLD.id;IF FOUND AND(NEW.expires_at IS NULL OR NEW.expires_at>cutoff OR NEW.synthetic<>OLD.synthetic) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Recording derived expiry and synthetic mark cannot be relaxed';END IF;RETURN NEW;END;$dg$;
CREATE TRIGGER native_recording_expiry_guard BEFORE UPDATE ON assets FOR EACH ROW EXECUTE FUNCTION dg_native_recording_expiry_guard();
DO $dg$ DECLARE f record;BEGIN FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace=current_schema()::regnamespace AND proname LIKE 'dg_native_%recording%' LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||f.signature||' FROM PUBLIC';END LOOP;END;$dg$;
