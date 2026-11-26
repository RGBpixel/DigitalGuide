-- R-058/R-081/R-027: AE registration revisions and independently licensed source ZIPs.
-- Applied001-030 are frozen. Native render batches/media adoption follow separately.
CREATE TABLE _dg_native_ae_source_inputs(job_id text PRIMARY KEY REFERENCES ae_source_exports(id),input_snapshot text NOT NULL,input_hash text NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),created_at text NOT NULL);
CREATE TABLE _dg_native_ae_source_receipts(job_id text PRIMARY KEY REFERENCES ae_source_exports(id),lease_token text NOT NULL,input_hash text NOT NULL,receipt text NOT NULL,receipt_hash text NOT NULL CHECK(receipt_hash ~ '^[a-f0-9]{64}$'),created_at text NOT NULL);
CREATE TABLE _dg_native_ae_source_leases(job_id text PRIMARY KEY REFERENCES ae_source_exports(id),token text NOT NULL,lease_until text NOT NULL);
ALTER TABLE ae_templates ADD CONSTRAINT native_ae_template_shape CHECK(version>0 AND catalog_revision>0 AND environment='mock' AND app_env IN('development','sandbox') AND manifest_sha256 ~ '^[a-f0-9]{64}$' AND jsonb_typeof(manifest::jsonb)='object');
ALTER TABLE ae_source_exports ADD CONSTRAINT native_ae_source_shape CHECK(version>0 AND control_version>0 AND template_version>0 AND catalog_revision>0 AND environment='mock' AND app_env IN('development','sandbox') AND manifest_size BETWEEN 1 AND 1048576 AND manifest_sha256 ~ '^[a-f0-9]{64}$' AND plan_hash ~ '^[a-f0-9]{64}$' AND(status<>'processing' OR(lease_token IS NOT NULL AND lease_until IS NOT NULL)));
CREATE FUNCTION dg_native_ae_template_guard() RETURNS trigger LANGUAGE plpgsql AS $dg$
BEGIN
 IF TG_OP='UPDATE' AND(NEW.version<>OLD.version+1 OR to_jsonb(NEW)-ARRAY['actor_id','catalog_revision','manifest_sha256','manifest','version','updated_at'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['actor_id','catalog_revision','manifest_sha256','manifest','version','updated_at']) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native AE registration identity and revision are fixed';END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_ae_template_guard BEFORE UPDATE ON ae_templates FOR EACH ROW EXECUTE FUNCTION dg_native_ae_template_guard();
CREATE FUNCTION dg_native_ae_version_binding() RETURNS trigger LANGUAGE plpgsql AS $dg$
BEGIN IF NOT EXISTS(SELECT 1 FROM ae_templates t WHERE t.id=NEW.template_id AND t.version=NEW.version AND t.catalog_revision=NEW.catalog_revision AND t.manifest_sha256=NEW.manifest_sha256 AND t.manifest::jsonb=NEW.manifest::jsonb) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native AE history requires current exact registration';END IF;RETURN NEW;END;$dg$;
CREATE TRIGGER native_ae_version_binding BEFORE INSERT ON ae_template_versions FOR EACH ROW EXECUTE FUNCTION dg_native_ae_version_binding();
CREATE FUNCTION dg_native_ae_source_binding() RETURNS trigger LANGUAGE plpgsql AS $dg$
DECLARE r ae_source_exports%ROWTYPE;i _dg_native_ae_source_inputs%ROWTYPE;target text;expected jsonb;
BEGIN
 target:=COALESCE(to_jsonb(NEW)->>'job_id',to_jsonb(NEW)->>'id');SELECT * INTO r FROM ae_source_exports WHERE id=target;SELECT * INTO i FROM _dg_native_ae_source_inputs WHERE job_id=target;
 expected:=jsonb_build_object('jobId',r.id,'tenantId',r.tenant_id,'workspaceId',r.workspace_id,'actorId',r.actor_id,'name',r.name,'templateId',r.template_id,'templateVersion',r.template_version,'catalogId',r.catalog_id,'catalogRevision',r.catalog_revision,'manifest',r.manifest::jsonb,'manifestSHA256',r.manifest_sha256,'manifestFile',r.manifest_file,'manifestSize',r.manifest_size,'mode',r.mode,'planHash',r.plan_hash);
 IF r.id IS NULL OR i.job_id IS NULL OR i.input_snapshot::jsonb IS DISTINCT FROM expected OR NOT EXISTS(SELECT 1 FROM ae_templates t JOIN ae_template_versions v ON v.template_id=t.id AND v.version=r.template_version WHERE t.id=r.template_id AND t.tenant_id=r.tenant_id AND t.workspace_id=r.workspace_id AND t.app_env=r.app_env AND v.catalog_revision=r.catalog_revision AND v.manifest_sha256=r.manifest_sha256 AND v.manifest::jsonb=r.manifest::jsonb) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='AE source export requires its exact immutable historical input';END IF;RETURN NULL;
END;$dg$;
CREATE CONSTRAINT TRIGGER native_ae_source_binding AFTER INSERT OR UPDATE ON ae_source_exports DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_ae_source_binding();
CREATE CONSTRAINT TRIGGER native_ae_source_input_binding AFTER INSERT ON _dg_native_ae_source_inputs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_ae_source_binding();
CREATE FUNCTION dg_native_ae_source_immutable() RETURNS trigger LANGUAGE plpgsql AS $dg$ BEGIN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native AE source ledger is immutable';END;$dg$;
CREATE TRIGGER native_ae_source_inputs_immutable BEFORE UPDATE OR DELETE ON _dg_native_ae_source_inputs FOR EACH ROW EXECUTE FUNCTION dg_native_ae_source_immutable();
CREATE TRIGGER native_ae_source_receipts_immutable BEFORE UPDATE OR DELETE ON _dg_native_ae_source_receipts FOR EACH ROW EXECUTE FUNCTION dg_native_ae_source_immutable();
CREATE FUNCTION dg_native_ae_source_guard() RETURNS trigger LANGUAGE plpgsql AS $dg$
BEGIN
 IF TG_OP='INSERT' THEN IF NEW.status<>'queued' OR NEW.version<>1 OR NEW.control_version<>1 OR NEW.attempts<>0 OR NEW.storage_key IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='New native AE source starts queued without output';END IF;
 ELSE
  IF OLD.status='withdrawn' OR NEW.version<>OLD.version+1 OR NEW.control_version<OLD.control_version OR NEW.control_version>OLD.control_version+1 OR(OLD.status='succeeded' AND NEW.status<>'withdrawn') OR(OLD.status='cancelled' AND NEW.status<>'withdrawn') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='AE source terminal states and version transitions are fenced';END IF;
  IF NEW.status='succeeded' AND(NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user=worker_role) OR NOT EXISTS(SELECT 1 FROM _dg_native_ae_source_receipts c WHERE c.job_id=NEW.id AND c.lease_token=OLD.lease_token AND c.receipt::jsonb->>'storage_key'=NEW.storage_key AND c.receipt::jsonb->>'sha256'=NEW.sha256 AND(c.receipt::jsonb->>'size')::bigint=NEW.size)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Only worker commits exact AE source ZIP receipt';END IF;
 END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_ae_source_guard BEFORE INSERT OR UPDATE ON ae_source_exports FOR EACH ROW EXECUTE FUNCTION dg_native_ae_source_guard();
CREATE FUNCTION dg_native_ae_source_valid(target text,token text,completed boolean DEFAULT false) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE app text;r ae_source_exports%ROWTYPE;
BEGIN
 SELECT app_env INTO app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user=worker_role;IF app IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only native worker validates AE source';END IF;
 SELECT * INTO r FROM ae_source_exports WHERE id=target;
 IF r.id IS NULL OR r.app_env<>app OR r.environment<>'mock' OR NOT EXISTS(SELECT 1 FROM memberships WHERE user_id=r.actor_id AND tenant_id=r.tenant_id AND role='admin' AND workspace_ids::jsonb ? r.workspace_id) OR NOT EXISTS(SELECT 1 FROM _dg_native_ae_source_inputs WHERE job_id=r.id) OR(r.manifest::jsonb->'license'->>'expiresAt' IS NOT NULL AND r.manifest::jsonb->'license'->>'expiresAt'<=dg_utc_now()) OR NOT COALESCE((r.manifest::jsonb->'license'->>'sourceExportAllowed')::boolean,false) OR NOT EXISTS(SELECT 1 FROM _dg_native_ae_source_leases l WHERE l.job_id=r.id AND l.token=dg_native_ae_source_valid.token AND l.lease_until>dg_utc_now()) THEN RETURN false;END IF;
 RETURN(NOT completed AND r.status='processing' AND r.lease_token=token AND r.lease_until>dg_utc_now()) OR(completed AND r.status='succeeded' AND EXISTS(SELECT 1 FROM _dg_native_ae_source_receipts c WHERE c.job_id=r.id AND c.lease_token=dg_native_ae_source_valid.token));
END;$dg$;
CREATE FUNCTION dg_native_ae_source_claim() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE app text;r ae_source_exports%ROWTYPE;new_token text:=gen_random_uuid()::text;until_at text;
BEGIN
 SELECT app_env INTO app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user=worker_role;IF app IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only worker claims AE source exports';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('native-ae-source-capacity',0)) THEN RETURN NULL;END IF;
 DELETE FROM _dg_native_ae_source_leases WHERE lease_until<=dg_utc_now();
 UPDATE ae_source_attempts a SET status='interrupted',error_code='AE_SOURCE_RECOVERY_LIMIT',error_message='原租约中断且恢复次数已用完。',finished_at=dg_utc_now() FROM ae_source_exports j WHERE a.job_id=j.id AND a.status='processing' AND j.status='processing' AND j.lease_until<=dg_utc_now() AND j.attempts>=3 AND j.app_env=app;
 UPDATE ae_source_exports SET status='failed',stage='finished',version=version+1,control_version=control_version+1,lease_token=NULL,lease_until=NULL,error_code='AE_SOURCE_RECOVERY_LIMIT',error_message='恢复次数已用完，请检查环境后新建导出。',updated_at=dg_utc_now() WHERE status='processing' AND lease_until<=dg_utc_now() AND attempts>=3 AND app_env=app;
 IF EXISTS(SELECT 1 FROM _dg_native_ae_source_leases WHERE lease_until>dg_utc_now()) THEN RETURN NULL;END IF;
 SELECT * INTO r FROM ae_source_exports j WHERE j.app_env=app AND j.environment='mock' AND j.attempts<3 AND(j.status='queued' OR j.status='processing' AND j.lease_until<=dg_utc_now()) ORDER BY j.created_at,j.id LIMIT 1 FOR UPDATE SKIP LOCKED;IF r.id IS NULL THEN RETURN NULL;END IF;
 UPDATE ae_source_attempts SET status='interrupted',error_code='AE_SOURCE_INTERRUPTED',error_message='原租约中断，使用独立目录恢复固定源包。',finished_at=dg_utc_now() WHERE job_id=r.id AND status='processing';
 until_at:=to_char((clock_timestamp()+interval '30 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 UPDATE ae_source_exports SET status='processing',stage='preparing',progress=0,attempts=attempts+1,version=version+1,lease_token=new_token,lease_until=until_at,error_code=NULL,error_message=NULL,updated_at=dg_utc_now() WHERE id=r.id RETURNING * INTO r;
 INSERT INTO ae_source_attempts VALUES(r.id,r.attempts,'processing',NULL,NULL,dg_utc_now(),NULL);INSERT INTO _dg_native_ae_source_leases VALUES(r.id,new_token,until_at);RETURN to_jsonb(r);
END;$dg$;
CREATE FUNCTION dg_native_ae_source_hold(target text,token text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND session_user=worker_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only worker holds AE source execution';END IF;PERFORM pg_advisory_xact_lock(hashtextextended('native-ae-source-capacity',0));UPDATE _dg_native_ae_source_leases SET lease_until=to_char((clock_timestamp()+interval '30 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') WHERE job_id=target AND _dg_native_ae_source_leases.token=dg_native_ae_source_hold.token AND lease_until>dg_utc_now();RETURN FOUND;END;$dg$;
CREATE FUNCTION dg_native_ae_source_release(target text,token text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND session_user=worker_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only worker releases AE source execution';END IF;PERFORM pg_advisory_xact_lock(hashtextextended('native-ae-source-capacity',0));DELETE FROM _dg_native_ae_source_leases WHERE job_id=target AND _dg_native_ae_source_leases.token=dg_native_ae_source_release.token;RETURN FOUND;END;$dg$;
CREATE FUNCTION dg_native_ae_source_renew(target text,token text,stage_value text,progress_value bigint) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN IF NOT dg_native_ae_source_valid(target,token,false) OR stage_value NOT IN('preparing','packing','verifying') OR progress_value NOT BETWEEN 0 AND 99 THEN RETURN false;END IF;UPDATE ae_source_exports SET stage=stage_value,progress=GREATEST(progress,progress_value),version=version+1,lease_until=to_char((clock_timestamp()+interval '30 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),updated_at=dg_utc_now() WHERE id=target;RETURN FOUND;END;$dg$;
CREATE FUNCTION dg_native_ae_source_fail(target text,token text,error_code_value text,error_message_value text,stopped boolean DEFAULT false) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user=worker_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only worker settles failed AE source';END IF;
 UPDATE ae_source_exports SET status=CASE WHEN stopped THEN 'queued' ELSE 'failed' END,stage=CASE WHEN stopped THEN 'queued' ELSE 'finished' END,progress=CASE WHEN stopped THEN 0 ELSE progress END,attempts=attempts-CASE WHEN stopped THEN 1 ELSE 0 END,version=version+1,control_version=control_version+CASE WHEN stopped THEN 0 ELSE 1 END,lease_token=NULL,lease_until=NULL,error_code=CASE WHEN stopped THEN NULL ELSE error_code_value END,error_message=CASE WHEN stopped THEN NULL ELSE error_message_value END,updated_at=dg_utc_now() WHERE id=target AND status='processing' AND lease_token=token AND lease_until>dg_utc_now();IF NOT FOUND THEN RETURN false;END IF;
 IF stopped THEN DELETE FROM ae_source_attempts WHERE job_id=target AND status='processing';ELSE UPDATE ae_source_attempts SET status='failed',error_code=error_code_value,error_message=error_message_value,finished_at=dg_utc_now() WHERE job_id=target AND status='processing';END IF;RETURN true;
END;$dg$;
CREATE FUNCTION dg_native_commit_ae_source(target text,token text,actual_input text,receipt_text text,receipt_digest text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE r ae_source_exports%ROWTYPE;i _dg_native_ae_source_inputs%ROWTYPE;o jsonb:=receipt_text::jsonb;
BEGIN
 SELECT * INTO r FROM ae_source_exports WHERE id=target FOR UPDATE;SELECT * INTO i FROM _dg_native_ae_source_inputs WHERE job_id=target;
 IF NOT dg_native_ae_source_valid(target,token,false) OR i.input_hash IS DISTINCT FROM actual_input OR NOT COALESCE(receipt_digest ~ '^[a-f0-9]{64}$',false) OR NOT COALESCE(o->>'storage_key' ~ '^[a-f0-9-]{36}\.bin$',false) OR NOT COALESCE(o->>'sha256' ~ '^[a-f0-9]{64}$',false) OR NOT COALESCE((o->>'size')::bigint BETWEEN 1 AND 541065216,false) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='AE source completion needs current lease, immutable input and exact file receipt';END IF;
 INSERT INTO _dg_native_ae_source_receipts VALUES(r.id,token,actual_input,receipt_text,receipt_digest,dg_utc_now());
 UPDATE ae_source_exports SET status='succeeded',stage='finished',progress=100,version=version+1,control_version=control_version+1,lease_token=NULL,lease_until=NULL,storage_key=o->>'storage_key',sha256=o->>'sha256',size=(o->>'size')::bigint,updated_at=dg_utc_now() WHERE id=r.id;
 UPDATE ae_source_attempts SET status='succeeded',finished_at=dg_utc_now() WHERE job_id=r.id AND attempt=r.attempts AND status='processing';
 INSERT INTO audit_events VALUES(gen_random_uuid()::text,r.tenant_id,r.workspace_id,r.actor_id,'studio.ae.source.completed',r.id,'confirmed',token,dg_utc_now());RETURN r.id;
END;$dg$;
REVOKE ALL ON FUNCTION dg_native_ae_source_valid(text,text,boolean),dg_native_ae_source_claim(),dg_native_ae_source_hold(text,text),dg_native_ae_source_release(text,text),dg_native_ae_source_renew(text,text,text,bigint),dg_native_ae_source_fail(text,text,text,text,boolean),dg_native_commit_ae_source(text,text,text,text,text) FROM PUBLIC;
