-- Fresh native validation only. Applied001-020 remain immutable.
ALTER TABLE _dg_native_asset_origins DROP CONSTRAINT native_asset_source_kind;
ALTER TABLE _dg_native_asset_origins ADD CONSTRAINT native_asset_source_kind CHECK(source_kind IN ('private_upload','package_import','video_upload','system_speech'));
ALTER TABLE voice_styles ADD CONSTRAINT native_voice_style_shape CHECK(version>0 AND environment='mock' AND app_env IN ('development','sandbox') AND preset IN ('neutral','warm','professional','lively','custom') AND jsonb_typeof(controls::jsonb)='object' AND (reference_asset_id IS NULL)=(reference_consent_id IS NULL));
ALTER TABLE pronunciation_books ADD CONSTRAINT native_pronunciation_shape CHECK(version>0 AND environment='mock' AND app_env IN ('development','sandbox') AND jsonb_typeof(entries::jsonb)='array' AND jsonb_array_length(entries::jsonb)<=100);
ALTER TABLE studio_language_links ADD CONSTRAINT native_language_shape CHECK(source_version>0 AND source_project_id<>target_project_id AND source_locale<>target_locale AND method='manual' AND (dictionary_id IS NULL)=(dictionary_version IS NULL));
ALTER TABLE studio_subtitle_editions ADD CONSTRAINT native_subtitle_shape CHECK(version>0 AND base_project_version>0 AND status IN ('draft','applied') AND timing_source IN ('estimated','mixed','manual') AND jsonb_typeof(cues::jsonb)='array' AND jsonb_array_length(cues::jsonb) BETWEEN 1 AND 300 AND ((status='draft' AND applied_project_version IS NULL AND applied_track_id IS NULL) OR(status='applied' AND applied_project_version IS NOT NULL AND applied_track_id IS NOT NULL)));
CREATE TRIGGER native_voice_style_history_immutable BEFORE UPDATE OR DELETE ON voice_style_versions FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_pronunciation_history_immutable BEFORE UPDATE OR DELETE ON pronunciation_book_versions FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_language_link_immutable BEFORE UPDATE OR DELETE ON studio_language_links FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_subtitle_history_immutable BEFORE UPDATE OR DELETE ON studio_subtitle_revisions FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE FUNCTION dg_native_voice_configuration_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE mutable text[];current_app text;
BEGIN
 SELECT app_env INTO current_app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user=app_role;
 IF current_app IS NULL OR NEW.environment<>'mock' OR NEW.app_env<>current_app OR NOT EXISTS(SELECT 1 FROM workspaces w WHERE w.id=NEW.workspace_id AND w.tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native voice configuration scope is invalid';END IF;
 IF TG_TABLE_NAME='voice_styles' THEN
  mutable:=ARRAY['name','preset','controls','reference_asset_id','reference_consent_id','note','version','updated_at'];
  IF NEW.reference_asset_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM assets a JOIN consents c ON c.asset_id=a.id JOIN uploads u ON u.id=a.upload_id WHERE a.id=NEW.reference_asset_id AND a.tenant_id=NEW.tenant_id AND a.workspace_id=NEW.workspace_id AND a.archived=0 AND u.media_type='audio/wav' AND c.id=NEW.reference_consent_id AND c.purpose='voice_style' AND c.tenant_id=a.tenant_id AND c.workspace_id=a.workspace_id AND c.revoked_at IS NULL AND c.expires_at>dg_utc_now() AND(a.expires_at IS NULL OR a.expires_at>dg_utc_now())) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Style requires its current independent reference authorization';END IF;
 ELSE
  mutable:=ARRAY['name','brand_id','entries','version','updated_at'];
  IF NEW.brand_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM studio_brand_kits b WHERE b.id=NEW.brand_id AND b.tenant_id=NEW.tenant_id AND b.workspace_id=NEW.workspace_id AND b.environment='mock' AND b.app_env=current_app) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Dictionary brand scope is invalid';END IF;
 END IF;
 IF TG_OP='INSERT' THEN IF NEW.version<>1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Voice configuration starts at version one';END IF;
 ELSIF NEW.version<>OLD.version+1 OR to_jsonb(NEW)-mutable IS DISTINCT FROM to_jsonb(OLD)-mutable THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Voice configuration identity is immutable and versions advance once';END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_voice_style_guard BEFORE INSERT OR UPDATE ON voice_styles FOR EACH ROW EXECUTE FUNCTION dg_native_voice_configuration_guard();
CREATE TRIGGER native_pronunciation_guard BEFORE INSERT OR UPDATE ON pronunciation_books FOR EACH ROW EXECUTE FUNCTION dg_native_voice_configuration_guard();
CREATE FUNCTION dg_native_voice_revision_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE payload jsonb;
BEGIN
 IF TG_TABLE_NAME='voice_styles' THEN
  SELECT v.payload::jsonb INTO payload FROM voice_style_versions v WHERE v.style_id=NEW.id AND v.version=NEW.version;
  IF payload IS NULL OR payload->>'workspaceId' IS DISTINCT FROM NEW.workspace_id OR payload->>'name' IS DISTINCT FROM NEW.name OR payload->>'preset' IS DISTINCT FROM NEW.preset OR payload->'controls' IS DISTINCT FROM NEW.controls::jsonb OR payload->>'note' IS DISTINCT FROM NEW.note OR payload->'reference' IS DISTINCT FROM (CASE WHEN NEW.reference_asset_id IS NULL THEN 'null'::jsonb ELSE jsonb_build_object('assetId',NEW.reference_asset_id,'consentId',NEW.reference_consent_id) END) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Voice style revision must match its current write';END IF;
 ELSE
  SELECT v.payload::jsonb INTO payload FROM pronunciation_book_versions v WHERE v.book_id=NEW.id AND v.version=NEW.version;
  IF payload IS NULL OR payload->>'workspaceId' IS DISTINCT FROM NEW.workspace_id OR payload->>'name' IS DISTINCT FROM NEW.name OR payload->>'brandId' IS DISTINCT FROM NEW.brand_id OR payload->'entries' IS DISTINCT FROM NEW.entries::jsonb THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Dictionary revision must match its current write';END IF;
 END IF;RETURN NEW;
END;$dg$;
CREATE CONSTRAINT TRIGGER native_voice_style_revision AFTER INSERT OR UPDATE ON voice_styles DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_voice_revision_guard();
CREATE CONSTRAINT TRIGGER native_pronunciation_revision AFTER INSERT OR UPDATE ON pronunciation_books DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_voice_revision_guard();
CREATE FUNCTION dg_native_language_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM studio_projects a JOIN studio_projects b ON b.id=NEW.target_project_id WHERE a.id=NEW.source_project_id AND a.tenant_id=b.tenant_id AND a.workspace_id=b.workspace_id AND a.environment='mock' AND b.environment='mock' AND a.app_env=b.app_env AND a.archived=0 AND b.archived=0 AND a.version=NEW.source_version AND a.document=NEW.source_snapshot AND EXISTS(SELECT 1 FROM _dg_native_runtime_control c WHERE c.id=1 AND c.status='validation_only' AND session_user=c.app_role AND c.app_env=a.app_env)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Manual language link must pin the current source and independent target';END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_language_guard BEFORE INSERT ON studio_language_links FOR EACH ROW EXECUTE FUNCTION dg_native_language_guard();
CREATE FUNCTION dg_native_subtitle_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE mutable text[]:=ARRAY['base_project_version','cues','timing_source','status','version','applied_project_version','applied_track_id','updated_at'];p studio_projects%ROWTYPE;
BEGIN
 SELECT * INTO p FROM studio_projects WHERE id=NEW.project_id;
 IF p.id IS NULL OR p.environment<>'mock' OR p.archived<>0 OR NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control c WHERE c.id=1 AND c.status='validation_only' AND session_user=c.app_role AND c.app_env=p.app_env) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Subtitle project scope is invalid';END IF;
 IF TG_OP='INSERT' THEN IF NEW.version<>1 OR NEW.base_project_version<>p.version OR NEW.status<>'draft' OR NEW.timing_source<>'estimated' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Subtitle starts as an estimated draft on the current project';END IF;
 ELSIF NEW.version<>OLD.version+1 OR to_jsonb(NEW)-mutable IS DISTINCT FROM to_jsonb(OLD)-mutable THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Subtitle identity is immutable and versions advance once';END IF;
 IF NEW.status='draft' AND NEW.base_project_version<>p.version OR NEW.status='applied' AND(NEW.applied_project_version<>p.version OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.document::jsonb->'timeline'->'tracks') t WHERE t->>'id'=NEW.applied_track_id AND t->>'type'='subtitle')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Subtitle application must name its current editable track';END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_subtitle_guard BEFORE INSERT OR UPDATE ON studio_subtitle_editions FOR EACH ROW EXECUTE FUNCTION dg_native_subtitle_guard();
CREATE FUNCTION dg_native_subtitle_revision_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE payload jsonb;
BEGIN
 SELECT r.payload::jsonb INTO payload FROM studio_subtitle_revisions r WHERE r.edition_id=NEW.id AND r.version=NEW.version;
 IF payload IS NULL OR payload->>'id' IS DISTINCT FROM NEW.id OR payload->>'projectId' IS DISTINCT FROM NEW.project_id OR(payload->>'projectVersion')::bigint IS DISTINCT FROM COALESCE(NEW.applied_project_version,NEW.base_project_version) OR payload->'cues' IS DISTINCT FROM NEW.cues::jsonb OR payload->>'timingSource' IS DISTINCT FROM NEW.timing_source OR payload->>'status' IS DISTINCT FROM NEW.status OR payload->>'appliedTrackId' IS DISTINCT FROM NEW.applied_track_id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Subtitle revision must match its current write';END IF;RETURN NEW;
END;$dg$;
CREATE CONSTRAINT TRIGGER native_subtitle_revision AFTER INSERT OR UPDATE ON studio_subtitle_editions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_subtitle_revision_guard();

CREATE TABLE _dg_native_speech_inputs(job_id text PRIMARY KEY REFERENCES studio_speech_jobs(id),tenant_id text NOT NULL,workspace_id text NOT NULL,purpose text NOT NULL CHECK(purpose IN ('video','presentation')),source_snapshot text NOT NULL CHECK(jsonb_typeof(source_snapshot::jsonb)='object'),source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),voice_receipt text NOT NULL CHECK(jsonb_typeof(voice_receipt::jsonb)='object'),created_at text NOT NULL);
CREATE TABLE _dg_native_speech_outputs(job_id text PRIMARY KEY REFERENCES studio_speech_jobs(id),lease_token text NOT NULL,outputs text NOT NULL CHECK(jsonb_typeof(outputs::jsonb)='array'),created_at text NOT NULL);
CREATE TABLE _dg_native_speech_applications(job_id text PRIMARY KEY REFERENCES studio_speech_jobs(id),project_id text NOT NULL REFERENCES studio_projects(id),project_version bigint NOT NULL CHECK(project_version>0),document_hash text NOT NULL CHECK(document_hash ~ '^[a-f0-9]{64}$'),outputs text NOT NULL,created_at text NOT NULL);
CREATE TABLE _dg_native_speech_assets(asset_id text PRIMARY KEY REFERENCES assets(id),job_id text NOT NULL REFERENCES _dg_native_speech_outputs(job_id),segment_id text NOT NULL,not_after text,created_at text NOT NULL,UNIQUE(job_id,segment_id));
CREATE TABLE _dg_native_speech_leases(job_id text PRIMARY KEY REFERENCES studio_speech_jobs(id),token text NOT NULL CHECK(char_length(token)=36),lease_until text NOT NULL);
CREATE TRIGGER native_speech_input_immutable BEFORE UPDATE OR DELETE ON _dg_native_speech_inputs FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_speech_output_immutable BEFORE UPDATE OR DELETE ON _dg_native_speech_outputs FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_speech_application_immutable BEFORE UPDATE OR DELETE ON _dg_native_speech_applications FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_speech_asset_immutable BEFORE UPDATE OR DELETE ON _dg_native_speech_assets FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
ALTER TABLE studio_speech_jobs ADD CONSTRAINT native_speech_state CHECK(provider_id='windows-sapi' AND project_version>0 AND version>0 AND attempts BETWEEN 0 AND 2 AND(status<>'queued' OR attempts<2) AND status IN ('queued','rendering','succeeded','failed','cancelled','stale') AND jsonb_typeof(input_snapshot::jsonb)='object' AND input_hash ~ '^[a-f0-9]{64}$' AND jsonb_typeof(outputs::jsonb)='array' AND jsonb_array_length(outputs::jsonb)<=10 AND(style_id IS NULL)=(style_version IS NULL) AND(style_version IS NULL OR style_version>0) AND(dictionary_id IS NULL)=(dictionary_version IS NULL) AND(dictionary_version IS NULL OR dictionary_version>0));
ALTER TABLE studio_speech_jobs ADD CONSTRAINT native_speech_lease CHECK((status='rendering' AND lease_token IS NOT NULL AND lease_until IS NOT NULL) OR(status<>'rendering' AND lease_token IS NULL AND lease_until IS NULL));
ALTER TABLE studio_speech_jobs ADD CONSTRAINT native_speech_receipt CHECK((status='succeeded' AND jsonb_array_length(outputs::jsonb) BETWEEN 1 AND 10) OR(status<>'succeeded' AND outputs='[]' AND applied_project_version IS NULL));
CREATE FUNCTION dg_native_speech_job_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE mutable text[]:=ARRAY['status','version','attempts','lease_token','lease_until','outputs','error_code','error_message','applied_project_version','updated_at'];heartbeat boolean;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'queued' OR NEW.version<>1 OR NEW.attempts<>0 OR NEW.outputs<>'[]' OR NOT EXISTS(SELECT 1 FROM studio_projects p JOIN _dg_native_runtime_control c ON c.id=1 WHERE p.id=NEW.project_id AND p.version=NEW.project_version AND p.archived=0 AND p.environment='mock' AND p.app_env=c.app_env AND c.status='validation_only' AND session_user=c.app_role) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Speech starts as a queued fixed-source native task';END IF;RETURN NEW;
 END IF;
 heartbeat:=OLD.status='rendering' AND NEW.status='rendering' AND NEW.version=OLD.version AND NEW.attempts=OLD.attempts AND NEW.lease_token=OLD.lease_token AND to_jsonb(NEW)-ARRAY['lease_until','updated_at'] IS NOT DISTINCT FROM to_jsonb(OLD)-ARRAY['lease_until','updated_at'];
 IF to_jsonb(NEW)-mutable IS DISTINCT FROM to_jsonb(OLD)-mutable OR(NOT heartbeat AND NEW.version<>OLD.version+1) OR OLD.status IN ('cancelled','stale') OR OLD.applied_project_version IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Speech inputs and applied receipts are immutable';END IF;
 IF OLD.status<>NEW.status AND NOT((OLD.status='queued' AND NEW.status IN ('rendering','cancelled')) OR(OLD.status='rendering' AND NEW.status IN ('queued','succeeded','failed','cancelled','stale')) OR(OLD.status='failed' AND NEW.status='queued' AND NEW.attempts<2)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Speech state transition is invalid';END IF;
 IF NEW.status='rendering' AND NEW.lease_token IS DISTINCT FROM OLD.lease_token THEN IF NEW.attempts<>OLD.attempts+1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Speech claim increments attempts once';END IF;
 ELSIF NEW.attempts<>OLD.attempts THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Speech attempts cannot be reset';END IF;
 IF OLD.status='succeeded' AND(NEW.status<>'succeeded' OR OLD.applied_project_version IS NOT NULL OR NEW.applied_project_version IS NULL) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Completed speech permits exactly one explicit application';END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_speech_job_guard BEFORE INSERT OR UPDATE ON studio_speech_jobs FOR EACH ROW EXECUTE FUNCTION dg_native_speech_job_guard();
CREATE FUNCTION dg_native_speech_ledger_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE i _dg_native_speech_inputs%ROWTYPE;o _dg_native_speech_outputs%ROWTYPE;a _dg_native_speech_applications%ROWTYPE;p studio_projects%ROWTYPE;item jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user IN (app_role,worker_role)) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Native speech ledger role is invalid';END IF;
 SELECT * INTO i FROM _dg_native_speech_inputs WHERE job_id=NEW.id;SELECT * INTO p FROM studio_projects WHERE id=NEW.project_id;
 IF i.job_id IS NULL OR i.tenant_id<>p.tenant_id OR i.workspace_id<>p.workspace_id OR i.purpose<>p.purpose OR NEW.input_snapshot::jsonb->>'projectId' IS DISTINCT FROM NEW.project_id OR(NEW.input_snapshot::jsonb->>'projectVersion')::bigint IS DISTINCT FROM NEW.project_version OR NEW.input_snapshot::jsonb->>'workspaceId' IS DISTINCT FROM p.workspace_id OR i.voice_receipt::jsonb->>'id' IS DISTINCT FROM NEW.voice_id OR i.voice_receipt::jsonb->>'locale' IS DISTINCT FROM NEW.locale OR i.voice_receipt::jsonb->>'provider' IS DISTINCT FROM 'windows-sapi' OR i.voice_receipt::jsonb->>'local' IS DISTINCT FROM 'true' OR i.voice_receipt::jsonb->>'cloned' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Speech input ledger must match its native project and voice';END IF;
 IF NEW.status='succeeded' THEN
  IF i.source_snapshot::jsonb->>'notAfter' IS NOT NULL AND i.source_snapshot::jsonb->>'notAfter'<=dg_utc_now() THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Speech source expired before transaction completion';END IF;
  SELECT * INTO o FROM _dg_native_speech_outputs WHERE job_id=NEW.id;
  IF o.job_id IS NULL OR jsonb_array_length(o.outputs::jsonb)<>jsonb_array_length(NEW.outputs::jsonb) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Completed speech requires immutable outputs';END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(NEW.outputs::jsonb) LOOP IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(o.outputs::jsonb) original WHERE original-'assetId' IS NOT DISTINCT FROM item-'assetId' AND original->>'assetId' IS NULL) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Actual speech file receipts cannot change';END IF;END LOOP;
  IF NEW.applied_project_version IS NULL THEN IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.outputs::jsonb) entry WHERE entry->>'assetId' IS NOT NULL) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Unapplied speech cannot acquire assets';END IF;
  ELSE
   SELECT * INTO a FROM _dg_native_speech_applications WHERE job_id=NEW.id;
   IF a.job_id IS NULL OR a.project_id<>NEW.project_id OR a.project_version<>NEW.applied_project_version OR a.outputs::jsonb IS DISTINCT FROM NEW.outputs::jsonb OR NOT EXISTS(SELECT 1 FROM studio_project_versions v WHERE v.project_id=a.project_id AND v.version=a.project_version) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Speech application must pin its actual project revision';END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(NEW.outputs::jsonb) LOOP IF NOT EXISTS(SELECT 1 FROM _dg_native_speech_assets s WHERE s.asset_id=item->>'assetId' AND s.job_id=NEW.id AND s.segment_id=item->>'segmentId') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Applied speech assets must match the actual output set';END IF;END LOOP;
  END IF;
 END IF;RETURN NEW;
END;$dg$;
CREATE CONSTRAINT TRIGGER native_speech_ledger AFTER INSERT OR UPDATE ON studio_speech_jobs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_speech_ledger_guard();

CREATE FUNCTION dg_native_speech_valid(target text,expected_token text,completed boolean DEFAULT false) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j studio_speech_jobs%ROWTYPE;i _dg_native_speech_inputs%ROWTYPE;p studio_projects%ROWTYPE;current_app text;
BEGIN
 SELECT app_env INTO current_app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND environment='mock' AND session_user=worker_role;
 IF current_app IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only the native speech worker can validate an execution';END IF;
 SELECT * INTO j FROM studio_speech_jobs WHERE id=target;SELECT * INTO i FROM _dg_native_speech_inputs WHERE job_id=target;SELECT * INTO p FROM studio_projects WHERE id=j.project_id;
 IF j.id IS NULL OR i.job_id IS NULL OR p.id IS NULL OR p.environment<>'mock' OR p.app_env<>current_app OR p.archived<>0 OR p.tenant_id<>i.tenant_id OR p.workspace_id<>i.workspace_id OR p.purpose<>i.purpose OR p.version<>j.project_version OR p.document::jsonb IS DISTINCT FROM i.source_snapshot::jsonb->'document' OR(i.source_snapshot::jsonb->>'notAfter' IS NOT NULL AND i.source_snapshot::jsonb->>'notAfter'<=dg_utc_now()) THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=j.actor_id AND m.tenant_id=p.tenant_id AND m.role IN ('admin','editor') AND m.workspace_ids::jsonb ? p.workspace_id) OR NOT EXISTS(SELECT 1 FROM _dg_native_speech_leases l WHERE l.job_id=target AND l.token=expected_token AND l.lease_until>dg_utc_now()) THEN RETURN false;END IF;
 IF NOT((NOT completed AND j.status='rendering' AND j.lease_token=expected_token AND j.lease_until>dg_utc_now()) OR(completed AND j.status='succeeded' AND EXISTS(SELECT 1 FROM _dg_native_speech_outputs o WHERE o.job_id=target AND o.lease_token=expected_token))) THEN RETURN false;END IF;
 IF j.style_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM voice_styles s WHERE s.id=j.style_id AND s.tenant_id=p.tenant_id AND s.workspace_id=p.workspace_id AND s.environment='mock' AND s.app_env=current_app AND s.version=j.style_version AND s.reference_asset_id IS NULL AND s.controls::jsonb=j.input_snapshot::jsonb->'segments'->0->'speech'->'controls') THEN RETURN false;END IF;
 IF j.dictionary_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pronunciation_books b WHERE b.id=j.dictionary_id AND b.tenant_id=p.tenant_id AND b.workspace_id=p.workspace_id AND b.environment='mock' AND b.app_env=current_app AND b.version=j.dictionary_version) THEN RETURN false;END IF;RETURN true;
END;$dg$;
CREATE FUNCTION dg_native_speech_claim() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE current_app text;r studio_speech_jobs%ROWTYPE;new_token text:=gen_random_uuid()::text;until_at text;
BEGIN
 SELECT app_env INTO current_app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND environment='mock' AND session_user=worker_role;
 IF current_app IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only the native speech worker can claim';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('native-system-speech-capacity',0)) THEN RETURN NULL;END IF;
 DELETE FROM _dg_native_speech_leases WHERE lease_until<=dg_utc_now();
 UPDATE studio_speech_jobs j SET status='failed',error_code='SPEECH_INTERRUPTED',error_message='上次系统配音中断，已达到两次执行上限，请重新建立任务。',lease_token=NULL,lease_until=NULL,version=version+1,updated_at=dg_utc_now() FROM _dg_native_speech_inputs i JOIN studio_projects p ON p.tenant_id=i.tenant_id AND p.workspace_id=i.workspace_id WHERE i.job_id=j.id AND p.id=j.project_id AND p.environment='mock' AND p.app_env=current_app AND j.status='rendering' AND j.lease_until<=dg_utc_now() AND j.attempts>=2;
 IF(SELECT count(*) FROM _dg_native_speech_leases WHERE lease_until>dg_utc_now())>=2 THEN RETURN NULL;END IF;
 SELECT j.* INTO r FROM studio_speech_jobs j JOIN _dg_native_speech_inputs i ON i.job_id=j.id JOIN studio_projects p ON p.id=j.project_id AND p.tenant_id=i.tenant_id AND p.workspace_id=i.workspace_id WHERE p.environment='mock' AND p.app_env=current_app AND j.attempts<2 AND(j.status='queued' OR(j.status='rendering' AND j.lease_until<=dg_utc_now())) AND NOT EXISTS(SELECT 1 FROM _dg_native_speech_leases l WHERE l.job_id=j.id) ORDER BY j.created_at,j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED;
 IF r.id IS NULL THEN RETURN NULL;END IF;until_at:=to_char((clock_timestamp()+interval '30 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 UPDATE studio_speech_jobs SET status='rendering',attempts=attempts+1,lease_token=new_token,lease_until=until_at,error_code=NULL,error_message=NULL,version=version+1,updated_at=dg_utc_now() WHERE id=r.id RETURNING * INTO r;INSERT INTO _dg_native_speech_leases VALUES(r.id,new_token,until_at);RETURN to_jsonb(r);
END;$dg$;
CREATE FUNCTION dg_native_speech_hold(target text,expected_token text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user=worker_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only the native speech worker holds an execution';END IF;
 UPDATE _dg_native_speech_leases SET lease_until=to_char((clock_timestamp()+interval '30 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') WHERE job_id=target AND token=expected_token AND lease_until>dg_utc_now();RETURN FOUND;
END;$dg$;
CREATE FUNCTION dg_native_speech_renew(target text,expected_token text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NOT dg_native_speech_valid(target,expected_token,false) THEN RETURN false;END IF;
 UPDATE studio_speech_jobs SET lease_until=to_char((clock_timestamp()+interval '30 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),updated_at=dg_utc_now() WHERE id=target AND status='rendering' AND lease_token=expected_token AND lease_until>dg_utc_now();RETURN FOUND;
END;$dg$;
CREATE FUNCTION dg_native_speech_release(target text,expected_token text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user=worker_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only the native speech worker releases an execution';END IF;
 DELETE FROM _dg_native_speech_leases WHERE job_id=target AND token=expected_token;RETURN FOUND;
END;$dg$;
CREATE FUNCTION dg_native_speech_fail(target text,expected_token text,code text,message text,stopped boolean,source_stale boolean) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user=worker_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only the native speech worker records execution failure';END IF;
 IF char_length(code)>100 OR char_length(message)>1000 OR NOT EXISTS(SELECT 1 FROM _dg_native_speech_leases l WHERE l.job_id=target AND l.token=expected_token AND l.lease_until>dg_utc_now()) THEN RETURN false;END IF;
 UPDATE studio_speech_jobs SET status=CASE WHEN source_stale THEN 'stale' WHEN stopped AND attempts<2 THEN 'queued' ELSE 'failed' END,error_code=code,error_message=message,lease_token=NULL,lease_until=NULL,version=version+1,updated_at=dg_utc_now() WHERE id=target AND status='rendering' AND lease_token=expected_token;RETURN FOUND;
END;$dg$;
CREATE FUNCTION dg_native_commit_speech(target text,expected_token text,actual_input text,outputs_text text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j studio_speech_jobs%ROWTYPE;i _dg_native_speech_inputs%ROWTYPE;items jsonb:=outputs_text::jsonb;entry jsonb;current_app text;total_bytes bigint:=0;
BEGIN
 SELECT app_env INTO current_app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND environment='mock' AND session_user=worker_role;
 IF current_app IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only the native speech worker commits actual speech';END IF;
 SELECT * INTO j FROM studio_speech_jobs WHERE id=target;SELECT * INTO i FROM _dg_native_speech_inputs WHERE job_id=target;PERFORM dg_native_locked_membership(j.actor_id);
 PERFORM pg_advisory_xact_lock(hashtextextended('["native-asset-workspace",'||to_jsonb(i.tenant_id)::text||','||to_jsonb(i.workspace_id)::text||']',0));SELECT * INTO j FROM studio_speech_jobs WHERE id=target FOR UPDATE;
 IF NOT dg_native_speech_valid(target,expected_token,false) OR j.input_hash IS DISTINCT FROM actual_input OR jsonb_typeof(items) IS DISTINCT FROM 'array' OR jsonb_array_length(items) NOT BETWEEN 1 AND 10 OR jsonb_array_length(items)<>jsonb_array_length(j.input_snapshot::jsonb->'segments') OR(SELECT count(DISTINCT v->>'segmentId') FROM jsonb_array_elements(items) v)<>jsonb_array_length(items) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Speech output set, current source or lease changed';END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(items) LOOP
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(j.input_snapshot::jsonb->'segments') s WHERE s->>'segmentId'=entry->>'segmentId') OR entry->>'storageKey' IS NULL OR entry->>'storageKey' !~ '^[a-f0-9-]{36}\.bin$' OR entry->>'sha256' IS NULL OR entry->>'sha256' !~ '^[a-f0-9]{64}$' OR entry->>'pcmSHA256' IS NULL OR entry->>'pcmSHA256' !~ '^[a-f0-9]{64}$' OR entry->>'assetId' IS NOT NULL OR(entry->>'size')::bigint IS NULL OR(entry->>'size')::bigint NOT BETWEEN 46 AND 67108864 OR(entry->>'durationMs')::numeric IS NULL OR(entry->>'durationMs')::numeric NOT BETWEEN 0.001 AND 1800000 OR(entry->>'sampleRate')::integer IS DISTINCT FROM 22050 OR(entry->>'channels')::integer IS DISTINCT FROM 1 OR(entry->>'bitsPerSample')::integer IS DISTINCT FROM 16 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Actual PCM WAV receipt is invalid';END IF;total_bytes:=total_bytes+(entry->>'size')::bigint;
 END LOOP;
 IF total_bytes>134217728 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Speech output set exceeds128MB';END IF;
 INSERT INTO _dg_native_speech_outputs VALUES(j.id,expected_token,outputs_text,dg_utc_now());UPDATE studio_speech_jobs SET status='succeeded',outputs=outputs_text,lease_token=NULL,lease_until=NULL,error_code=NULL,error_message=NULL,version=version+1,updated_at=dg_utc_now() WHERE id=j.id;
 INSERT INTO audit_events VALUES(gen_random_uuid()::text,i.tenant_id,i.workspace_id,j.actor_id,'studio.system_speech_completed',j.id,'confirmed','native-speech:'||j.id||':'||j.attempts,dg_utc_now());RETURN j.id;
END;$dg$;
CREATE FUNCTION dg_native_register_speech_asset(target text,segment text,asset_id text,upload_id text,specs_text text,asset_name text,expires text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j studio_speech_jobs%ROWTYPE;i _dg_native_speech_inputs%ROWTYPE;o jsonb;current_app text;actor text:=current_setting('digitalguide.actor_id',true);at_time text:=dg_utc_now();
BEGIN
 SELECT app_env INTO current_app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND environment='mock' AND session_user=app_role;
 IF current_app IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only the native application registers explicitly adopted speech';END IF;
 SELECT * INTO j FROM studio_speech_jobs WHERE id=target;SELECT * INTO i FROM _dg_native_speech_inputs WHERE job_id=target;
 IF j.id IS NULL OR i.job_id IS NULL OR j.status<>'succeeded' OR j.applied_project_version IS NOT NULL OR NOT EXISTS(SELECT 1 FROM studio_projects p WHERE p.id=j.project_id AND p.tenant_id=i.tenant_id AND p.workspace_id=i.workspace_id AND p.environment='mock' AND p.app_env=current_app AND p.version=j.project_version AND p.archived=0) OR NOT EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=actor AND m.tenant_id=i.tenant_id AND m.role IN ('admin','editor') AND m.workspace_ids::jsonb ? i.workspace_id) OR NOT EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=j.actor_id AND m.tenant_id=i.tenant_id AND m.role IN ('admin','editor') AND m.workspace_ids::jsonb ? i.workspace_id) OR expires IS DISTINCT FROM i.source_snapshot::jsonb->>'notAfter' OR(expires IS NOT NULL AND expires<=at_time) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Speech asset adoption scope, current source or minimum expiry changed';END IF;
 SELECT entry INTO o FROM _dg_native_speech_outputs r CROSS JOIN LATERAL jsonb_array_elements(r.outputs::jsonb) entry WHERE r.job_id=target AND entry->>'segmentId'=segment;
 IF o IS NULL OR specs_text::jsonb IS DISTINCT FROM jsonb_build_object('channels',1,'sampleRate',22050,'durationMs',round((o->>'durationMs')::numeric)) OR char_length(asset_name) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Speech asset must use its actual immutable WAV receipt';END IF;
 INSERT INTO uploads VALUES(upload_id,i.tenant_id,i.workspace_id,actor,o->>'storageKey',o->>'sha256',(o->>'size')::bigint,'audio/wav',specs_text,at_time);
 INSERT INTO assets(id,tenant_id,workspace_id,upload_id,name,category,synthetic,expires_at,created_at) VALUES(asset_id,i.tenant_id,i.workspace_id,upload_id,asset_name,'voice',1,expires,at_time);
 INSERT INTO _dg_native_asset_origins VALUES(asset_id,upload_id,i.tenant_id,i.workspace_id,o->>'sha256',(o->>'size')::bigint,'system_speech','mock',current_app,at_time);
 INSERT INTO _dg_native_speech_assets VALUES(asset_id,target,segment,expires,at_time);RETURN asset_id;
END;$dg$;
CREATE FUNCTION dg_native_speech_asset_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE r record;
BEGIN
 SELECT s.*,j.applied_project_version,j.outputs,a.upload_id,a.synthetic,a.expires_at,u.sha256,u.size,u.storage_key,u.media_type INTO r FROM _dg_native_speech_assets s JOIN studio_speech_jobs j ON j.id=s.job_id JOIN assets a ON a.id=s.asset_id JOIN uploads u ON u.id=a.upload_id WHERE s.asset_id=NEW.asset_id;
 IF r.asset_id IS NULL OR r.applied_project_version IS NULL OR r.synthetic<>1 OR r.media_type<>'audio/wav' OR r.not_after IS NOT NULL AND(r.expires_at IS NULL OR r.expires_at>r.not_after) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.outputs::jsonb) o WHERE o->>'segmentId'=r.segment_id AND o->>'assetId'=r.asset_id AND o->>'storageKey'=r.storage_key AND o->>'sha256'=r.sha256 AND(o->>'size')::bigint=r.size) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Synthetic speech asset must be part of its atomic application';END IF;RETURN NEW;
END;$dg$;
CREATE CONSTRAINT TRIGGER native_speech_asset_receipt AFTER INSERT ON _dg_native_speech_assets DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_speech_asset_guard();
CREATE FUNCTION dg_native_speech_asset_expiry_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE cutoff text;
BEGIN
 SELECT s.not_after INTO cutoff FROM _dg_native_speech_assets s WHERE s.asset_id=OLD.id;
 IF FOUND AND(NEW.synthetic<>1 OR(cutoff IS NOT NULL AND(NEW.expires_at IS NULL OR NEW.expires_at>cutoff))) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Synthetic speech identity and inherited expiry cannot be relaxed';END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_speech_asset_expiry BEFORE UPDATE ON assets FOR EACH ROW EXECUTE FUNCTION dg_native_speech_asset_expiry_guard();
REVOKE ALL ON FUNCTION dg_native_speech_valid(text,text,boolean),dg_native_speech_claim(),dg_native_speech_hold(text,text),dg_native_speech_renew(text,text),dg_native_speech_release(text,text),dg_native_speech_fail(text,text,text,text,boolean,boolean),dg_native_commit_speech(text,text,text,text),dg_native_register_speech_asset(text,text,text,text,text,text,text) FROM PUBLIC;

-- Additional count-only impact information; no configuration or script body is returned.
CREATE FUNCTION dg_native_voice_references(target_tenant text,target_workspace text,asset_ids text[]) RETURNS TABLE(styles bigint,speech bigint) LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND environment='mock' AND session_user=app_role) OR NOT EXISTS(SELECT 1 FROM workspaces w WHERE w.id=target_workspace AND w.tenant_id=target_tenant) OR asset_ids IS NULL OR cardinality(asset_ids) NOT BETWEEN 1 AND 100 OR array_position(asset_ids,NULL) IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Native voice reference count scope is invalid';END IF;
 RETURN QUERY SELECT(SELECT count(*) FROM voice_styles s WHERE s.tenant_id=target_tenant AND s.workspace_id=target_workspace AND s.reference_asset_id=ANY(asset_ids)),(SELECT count(*) FROM _dg_native_speech_inputs i WHERE i.tenant_id=target_tenant AND i.workspace_id=target_workspace AND EXISTS(SELECT 1 FROM jsonb_array_elements(i.source_snapshot::jsonb->'assets') source WHERE source->>'id'=ANY(asset_ids)));
END;$dg$;
REVOKE ALL ON FUNCTION dg_native_voice_references(text,text,text[]) FROM PUBLIC;
