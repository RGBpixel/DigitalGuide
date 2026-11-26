-- R-058/R-083. Fresh native validation schemas only; applied001-034 stay frozen.
CREATE TABLE _dg_native_frame_inputs(review_id text PRIMARY KEY REFERENCES studio_frame_reviews(id),input text NOT NULL,input_hash text NOT NULL CHECK(input_hash=encode(sha256(convert_to(input,'UTF8')),'hex')),created_at text NOT NULL);
CREATE TABLE _dg_native_frame_outputs(review_id text PRIMARY KEY REFERENCES studio_frame_reviews(id),lease_token text NOT NULL,input_hash text NOT NULL,receipt text NOT NULL,receipt_hash text NOT NULL CHECK(receipt_hash=encode(sha256(convert_to(receipt,'UTF8')),'hex')),created_at text NOT NULL);
CREATE TABLE _dg_native_frame_leases(review_id text PRIMARY KEY REFERENCES studio_frame_reviews(id),token text NOT NULL,lease_until text NOT NULL);
CREATE TRIGGER native_frame_input_immutable BEFORE UPDATE OR DELETE ON _dg_native_frame_inputs FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_frame_output_immutable BEFORE UPDATE OR DELETE ON _dg_native_frame_outputs FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_frame_request_immutable BEFORE UPDATE OR DELETE ON studio_frame_requests FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
ALTER TABLE studio_frame_reviews ADD CONSTRAINT native_frame_review_shape CHECK(environment='mock' AND app_env IN('development','sandbox') AND version>0 AND project_version>0 AND attempts BETWEEN 0 AND 3 AND progress BETWEEN 0 AND 1 AND status IN('queued','preparing','ready','failed','cancelled','stale') AND snapshot_hash=encode(sha256(convert_to(snapshot,'UTF8')),'hex') AND ((status='preparing' AND lease_token IS NOT NULL AND lease_until IS NOT NULL) OR(status<>'preparing' AND lease_token IS NULL AND lease_until IS NULL)) AND ((media IS NULL AND media_hash IS NULL AND storage_key IS NULL AND status<>'ready') OR(media IS NOT NULL AND media_hash=encode(sha256(convert_to(media,'UTF8')),'hex') AND storage_key ~ '^[a-f0-9-]{36}\.bin$' AND status='ready')));
CREATE FUNCTION dg_native_frame_review_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'queued' OR NEW.version<>1 OR NEW.attempts<>0 OR NEW.media IS NOT NULL OR NEW.invalidated_at IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native frame review must start as a fixed queued request';END IF;
 ELSE
  IF to_jsonb(NEW)-ARRAY['status','version','progress','attempts','lease_token','lease_until','media','media_hash','storage_key','invalidated_at','error_code','error_message','updated_at'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['status','version','progress','attempts','lease_token','lease_until','media','media_hash','storage_key','invalidated_at','error_code','error_message','updated_at']
   OR NEW.version<OLD.version OR NEW.version>OLD.version+1 OR NEW.attempts<OLD.attempts OR NEW.attempts>OLD.attempts+1
   OR (OLD.invalidated_at IS NOT NULL AND NEW.invalidated_at IS DISTINCT FROM OLD.invalidated_at)
   OR (OLD.media IS NOT NULL AND (NEW.media,NEW.media_hash,NEW.storage_key) IS DISTINCT FROM (OLD.media,OLD.media_hash,OLD.storage_key))
   OR(NEW.status<>OLD.status AND NOT((OLD.status='queued' AND NEW.status IN('preparing','cancelled','stale')) OR(OLD.status='preparing' AND NEW.status IN('ready','queued','failed','cancelled','stale')) OR(OLD.status IN('failed','cancelled') AND NEW.status IN('queued','stale')))) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native frame input, media and invalidation are immutable';
  END IF;
  IF NEW.status<>OLD.status AND NEW.status IN('preparing','ready') AND EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND session_user=app_role) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Only native worker may begin or complete a frame proxy';END IF;
 END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_frame_review_guard BEFORE INSERT OR UPDATE ON studio_frame_reviews FOR EACH ROW EXECUTE FUNCTION dg_native_frame_review_guard();
CREATE FUNCTION dg_native_frame_receipt_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE job studio_frame_reviews%ROWTYPE;fixed _dg_native_frame_inputs%ROWTYPE;done _dg_native_frame_outputs%ROWTYPE;
BEGIN
 SELECT r.* INTO job FROM studio_frame_reviews r WHERE r.id=NEW.id;SELECT i.* INTO fixed FROM _dg_native_frame_inputs i WHERE i.review_id=job.id;
 IF fixed.review_id IS NULL OR fixed.input::jsonb->>'reviewId' IS DISTINCT FROM job.id OR fixed.input::jsonb->>'tenantId' IS DISTINCT FROM job.tenant_id OR fixed.input::jsonb->>'workspaceId' IS DISTINCT FROM job.workspace_id OR fixed.input::jsonb->>'snapshotHash' IS DISTINCT FROM job.snapshot_hash THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Frame review requires its immutable fixed input';END IF;
 IF job.status='ready' THEN
  SELECT o.* INTO done FROM _dg_native_frame_outputs o WHERE o.review_id=job.id;
  IF done.review_id IS NULL OR done.input_hash<>fixed.input_hash OR done.receipt::jsonb->'media' IS DISTINCT FROM job.media::jsonb OR done.receipt::jsonb->'object'->>'storage_key' IS DISTINCT FROM job.storage_key THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Ready frame proxy requires its exact worker receipt';END IF;
 END IF;RETURN NULL;
END;$dg$;
CREATE CONSTRAINT TRIGGER native_frame_receipt AFTER INSERT OR UPDATE ON studio_frame_reviews DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_frame_receipt_guard();

ALTER TABLE studio_frame_review_links ADD CONSTRAINT native_frame_link_shape CHECK(environment='mock' AND app_env IN('development','sandbox') AND version>0 AND can_comment IN(0,1) AND token_hash ~ '^[a-f0-9]{64}$' AND nonce ~ '^[a-f0-9]{64}$');
ALTER TABLE studio_frame_review_sessions ADD CONSTRAINT native_frame_session_shape CHECK(environment='mock' AND app_env IN('development','sandbox') AND token_hash ~ '^[a-f0-9]{64}$' AND nonce ~ '^[a-f0-9]{64}$' AND csrf_token ~ '^[a-f0-9]{64}$' AND char_length(name) BETWEEN 1 AND 60);
ALTER TABLE studio_frame_comments ADD CONSTRAINT native_frame_comment_shape CHECK(environment='mock' AND app_env IN('development','sandbox') AND version>0 AND sequence BETWEEN 1 AND 2000 AND char_length(body) BETWEEN 1 AND 2000 AND jsonb_typeof(anchor::jsonb)='object');
ALTER TABLE studio_frame_feedback ADD CONSTRAINT native_frame_feedback_shape CHECK(environment='mock' AND app_env IN('development','sandbox') AND version>0 AND decision IN('looks_good','changes_requested') AND char_length(note)<=2000 AND(decision<>'changes_requested' OR char_length(trim(note))>0));
CREATE FUNCTION dg_native_frame_discussion_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE mutable text[];
BEGIN
 mutable:=CASE TG_TABLE_NAME WHEN 'studio_frame_review_links' THEN ARRAY['version','revoked_at'] WHEN 'studio_frame_review_sessions' THEN ARRAY['revoked_at'] WHEN 'studio_frame_comments' THEN ARRAY['version','resolved_at','resolved_by'] ELSE ARRAY['version','decision','note','updated_at'] END;
 IF to_jsonb(NEW)-mutable IS DISTINCT FROM to_jsonb(OLD)-mutable OR(TG_TABLE_NAME<>'studio_frame_review_sessions' AND (to_jsonb(NEW)->>'version')::bigint<>(to_jsonb(OLD)->>'version')::bigint+1)
  OR(TG_TABLE_NAME IN('studio_frame_review_links','studio_frame_review_sessions') AND to_jsonb(OLD)->>'revoked_at' IS NOT NULL AND to_jsonb(NEW)->>'revoked_at' IS DISTINCT FROM to_jsonb(OLD)->>'revoked_at') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Frame invitation, session and discussion provenance are immutable';END IF;RETURN NEW;
END;$dg$;
DO $dg$ DECLARE table_name text;BEGIN FOREACH table_name IN ARRAY ARRAY['studio_frame_review_links','studio_frame_review_sessions','studio_frame_comments','studio_frame_feedback'] LOOP EXECUTE format('CREATE TRIGGER native_frame_discussion_guard BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION dg_native_frame_discussion_guard()',table_name);END LOOP;END;$dg$;
-- Baseline invalidation also applies to tenant-only membership moves, permanently.
CREATE FUNCTION dg_native_frame_tenant_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NEW.tenant_id<>OLD.tenant_id THEN
  UPDATE studio_frame_review_links SET revoked_at=coalesce(revoked_at,dg_utc_now()),version=version+1 WHERE actor_id=OLD.user_id AND revoked_at IS NULL;
  UPDATE studio_frame_reviews SET invalidated_at=coalesce(invalidated_at,dg_utc_now()),status=CASE WHEN status IN('queued','preparing') THEN 'stale' ELSE status END,lease_token=NULL,lease_until=NULL,version=version+1,updated_at=dg_utc_now() WHERE actor_id=OLD.user_id;
 END IF;RETURN NEW;
END;$dg$;
REVOKE ALL ON FUNCTION dg_native_frame_tenant_changed() FROM PUBLIC;
CREATE TRIGGER native_frame_tenant_changed AFTER UPDATE OF tenant_id ON memberships FOR EACH ROW EXECUTE FUNCTION dg_native_frame_tenant_changed();

CREATE FUNCTION dg_native_frame_valid(target text,expected_token text,completed boolean DEFAULT false) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE app text;job studio_frame_reviews%ROWTYPE;
BEGIN
 SELECT app_env INTO app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user=worker_role;
 IF app IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Native frame worker required';END IF;
 SELECT r.* INTO job FROM studio_frame_reviews r WHERE r.id=target;
 IF job.id IS NULL OR job.environment<>'mock' OR job.app_env<>app OR job.invalidated_at IS NOT NULL OR coalesce(job.snapshot::jsonb->>'expiresAt','9999')<=dg_utc_now()
  OR NOT EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=job.actor_id AND m.tenant_id=job.tenant_id AND m.role IN('admin','editor') AND m.workspace_ids::jsonb ? job.workspace_id)
  OR NOT EXISTS(SELECT 1 FROM studio_projects p WHERE p.id=job.project_id AND p.tenant_id=job.tenant_id AND p.workspace_id=job.workspace_id AND p.version=job.project_version AND p.archived=0)
  OR NOT EXISTS(SELECT 1 FROM _dg_native_frame_leases l WHERE l.review_id=job.id AND l.token=expected_token AND l.lease_until>dg_utc_now()) THEN RETURN false;END IF;
 RETURN(NOT completed AND job.status='preparing' AND job.lease_token=expected_token AND job.lease_until>dg_utc_now()) OR(completed AND job.status='ready' AND EXISTS(SELECT 1 FROM _dg_native_frame_outputs o WHERE o.review_id=job.id AND o.lease_token=expected_token));
END;$dg$;
CREATE FUNCTION dg_native_frame_claim() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE app text;job studio_frame_reviews%ROWTYPE;token text:=gen_random_uuid()::text;until_at text;
BEGIN
 SELECT app_env INTO app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user=worker_role;IF app IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Native frame worker required';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('native-frame-proxy-capacity',0)) THEN RETURN NULL;END IF;
 DELETE FROM _dg_native_frame_leases WHERE lease_until<=dg_utc_now();
 UPDATE studio_frame_reviews SET status='failed',version=version+1,lease_token=NULL,lease_until=NULL,error_code='REVIEW_INTERRUPTED',error_message='副本处理已达三次上限，请核对后新建审阅。',updated_at=dg_utc_now() WHERE environment='mock' AND app_env=app AND status='preparing' AND lease_until<=dg_utc_now() AND attempts>=3;
 IF(SELECT count(*) FROM _dg_native_frame_leases WHERE lease_until>dg_utc_now())>=2 THEN RETURN NULL;END IF;
 SELECT r.* INTO job FROM studio_frame_reviews r WHERE r.environment='mock' AND r.app_env=app AND r.invalidated_at IS NULL AND r.attempts<3 AND(r.status='queued' OR r.status='preparing' AND r.lease_until<=dg_utc_now()) AND NOT EXISTS(SELECT 1 FROM _dg_native_frame_leases l WHERE l.review_id=r.id) ORDER BY r.created_at,r.id LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF job.id IS NULL THEN RETURN NULL;END IF;
 until_at:=to_char((clock_timestamp()+interval '45 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 UPDATE studio_frame_reviews SET status='preparing',attempts=attempts+1,version=version+1,progress=0,lease_token=token,lease_until=until_at,error_code=NULL,error_message=NULL,updated_at=dg_utc_now() WHERE id=job.id RETURNING * INTO job;
 INSERT INTO _dg_native_frame_leases VALUES(job.id,token,until_at);RETURN to_jsonb(job);
END;$dg$;
CREATE FUNCTION dg_native_frame_hold(target text,expected_token text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND session_user=worker_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Native frame worker required';END IF;
 UPDATE _dg_native_frame_leases SET lease_until=to_char((clock_timestamp()+interval '45 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') WHERE review_id=target AND token=expected_token AND lease_until>dg_utc_now();RETURN FOUND;
END;$dg$;
CREATE FUNCTION dg_native_frame_renew(target text,expected_token text,fraction double precision) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NOT dg_native_frame_valid(target,expected_token) OR fraction<0 OR fraction>1 THEN RETURN false;END IF;
 UPDATE studio_frame_reviews SET lease_until=to_char((clock_timestamp()+interval '45 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),progress=greatest(progress,fraction),updated_at=dg_utc_now() WHERE id=target AND status='preparing' AND lease_token=expected_token AND lease_until>dg_utc_now();RETURN FOUND;
END;$dg$;
CREATE FUNCTION dg_native_frame_release(target text,expected_token text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND session_user=worker_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Native frame worker required';END IF;
 DELETE FROM _dg_native_frame_leases WHERE review_id=target AND token=expected_token;RETURN FOUND;
END;$dg$;
CREATE FUNCTION dg_native_frame_fail(target text,expected_token text,code text,message text,stopped boolean,source_stale boolean) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND session_user=worker_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Native frame worker required';END IF;
 UPDATE studio_frame_reviews SET status=CASE WHEN source_stale THEN 'stale' WHEN stopped AND attempts<3 THEN 'queued' ELSE 'failed' END,version=version+1,lease_token=NULL,lease_until=NULL,error_code=left(code,80),error_message=left(message,500),updated_at=dg_utc_now() WHERE id=target AND status='preparing' AND lease_token=expected_token AND lease_until>dg_utc_now();RETURN FOUND;
END;$dg$;
CREATE FUNCTION dg_native_commit_frame(target text,expected_token text,actual_input text,receipt_text text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE job studio_frame_reviews%ROWTYPE;fixed _dg_native_frame_inputs%ROWTYPE;receipt jsonb:=receipt_text::jsonb;media_doc jsonb:=receipt->'media';object_doc jsonb:=receipt->'object';
BEGIN
 IF NOT dg_native_frame_valid(target,expected_token) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Frame lease or authority changed';END IF;
 SELECT r.* INTO job FROM studio_frame_reviews r WHERE r.id=target FOR UPDATE;SELECT i.* INTO fixed FROM _dg_native_frame_inputs i WHERE i.review_id=target;
 IF fixed.input_hash IS DISTINCT FROM actual_input OR receipt->>'inputHash' IS DISTINCT FROM actual_input OR receipt->>'sourceSHA256' IS DISTINCT FROM job.snapshot::jsonb->>'artifactSHA256' OR receipt->'execution' IS DISTINCT FROM fixed.input::jsonb->'execution'
  OR media_doc->>'sha256' IS DISTINCT FROM object_doc->>'sha256' OR(media_doc->>'size')::bigint IS DISTINCT FROM (object_doc->>'size')::bigint OR(object_doc->>'size')::bigint NOT BETWEEN 1 AND 536870912
  OR(media_doc->>'frames')::bigint IS DISTINCT FROM (job.snapshot::jsonb->>'frames')::bigint OR(media_doc->>'fps')::bigint IS DISTINCT FROM (job.snapshot::jsonb->>'fps')::bigint
  OR(media_doc->>'timelineStartMs')::bigint IS DISTINCT FROM (job.snapshot::jsonb->>'timelineStartMs')::bigint OR(media_doc->>'originalWidth')::bigint IS DISTINCT FROM (job.snapshot::jsonb->>'width')::bigint OR(media_doc->>'originalHeight')::bigint IS DISTINCT FROM (job.snapshot::jsonb->>'height')::bigint THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Frame output differs from its fixed input';
 END IF;
 INSERT INTO _dg_native_frame_outputs VALUES(target,expected_token,actual_input,receipt_text,encode(sha256(convert_to(receipt_text,'UTF8')),'hex'),dg_utc_now());
 UPDATE studio_frame_reviews SET status='ready',version=version+1,progress=1,lease_token=NULL,lease_until=NULL,media=media_doc::text,media_hash=encode(sha256(convert_to(media_doc::text,'UTF8')),'hex'),storage_key=object_doc->>'storage_key',error_code=NULL,error_message=NULL,updated_at=dg_utc_now() WHERE id=target;
 INSERT INTO audit_events VALUES(gen_random_uuid()::text,job.tenant_id,job.workspace_id,job.actor_id,'frame_review.proxy_completed',job.id,'confirmed',expected_token,dg_utc_now());
 INSERT INTO outbox_events VALUES(gen_random_uuid()::text,job.tenant_id,job.workspace_id,job.id,'frame_review.ready','mock','{}',dg_utc_now(),NULL);RETURN target;
END;$dg$;
DO $dg$ DECLARE signature text;BEGIN FOREACH signature IN ARRAY ARRAY['dg_native_frame_valid(text,text,boolean)','dg_native_frame_claim()','dg_native_frame_hold(text,text)','dg_native_frame_renew(text,text,double precision)','dg_native_frame_release(text,text)','dg_native_frame_fail(text,text,text,text,boolean,boolean)','dg_native_commit_frame(text,text,text,text)'] LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||signature||' FROM PUBLIC';END LOOP;END;$dg$;
