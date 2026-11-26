-- Native, fresh validation instances only. Existing imported archives stay isolated.
CREATE TABLE _dg_native_asset_origins (
 asset_id text PRIMARY KEY REFERENCES assets(id),
 upload_id text NOT NULL REFERENCES uploads(id),
 tenant_id text NOT NULL,workspace_id text NOT NULL,
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 size bigint NOT NULL CHECK(size>0),
 source_kind text NOT NULL CHECK(source_kind='private_upload'),
 environment text NOT NULL CHECK(environment='mock'),
 app_env text NOT NULL CHECK(app_env IN ('development','sandbox')),
 created_at text NOT NULL
);
CREATE TABLE _dg_native_job_sources (
 job_id text PRIMARY KEY REFERENCES jobs(id),
 asset_id text NOT NULL REFERENCES assets(id),asset_version bigint NOT NULL CHECK(asset_version>0),
 upload_id text NOT NULL REFERENCES uploads(id),sha256 text NOT NULL,
 consent_id text NOT NULL REFERENCES consents(id),consent_expires_at text NOT NULL,
 created_at text NOT NULL
);

-- Workers may lock current authorization without obtaining asset or consent write privileges.
CREATE FUNCTION dg_native_locked_asset(target text,tenant text,for_write boolean)
RETURNS SETOF assets LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control c WHERE c.id=1 AND c.status='validation_only'
  AND c.environment='mock' AND (session_user=c.app_role OR (session_user=c.worker_role AND NOT for_write))) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Native asset lock role is not allowed';
 END IF;
 IF for_write THEN RETURN QUERY SELECT * FROM assets WHERE id=target AND tenant_id=tenant FOR UPDATE;
 ELSE RETURN QUERY SELECT * FROM assets WHERE id=target AND tenant_id=tenant FOR SHARE; END IF;
END;
$dg$;
REVOKE ALL ON FUNCTION dg_native_locked_asset(text,text,boolean) FROM PUBLIC;

CREATE FUNCTION dg_native_locked_consent(target text,tenant text,for_write boolean)
RETURNS SETOF consents LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control c WHERE c.id=1 AND c.status='validation_only'
  AND c.environment='mock' AND (session_user=c.app_role OR (session_user=c.worker_role AND NOT for_write))) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Native consent lock role is not allowed';
 END IF;
 IF for_write THEN RETURN QUERY SELECT * FROM consents WHERE id=target AND tenant_id=tenant FOR UPDATE;
 ELSE RETURN QUERY SELECT * FROM consents WHERE id=target AND tenant_id=tenant FOR SHARE; END IF;
END;
$dg$;
REVOKE ALL ON FUNCTION dg_native_locked_consent(text,text,boolean) FROM PUBLIC;

CREATE FUNCTION dg_native_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native provenance and history are append only';
END;
$dg$;
CREATE TRIGGER native_upload_immutable BEFORE UPDATE OR DELETE ON uploads FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_asset_origin_immutable BEFORE UPDATE OR DELETE ON _dg_native_asset_origins FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_job_source_immutable BEFORE UPDATE OR DELETE ON _dg_native_job_sources FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_asset_version_immutable BEFORE UPDATE OR DELETE ON asset_versions FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_profile_version_immutable BEFORE UPDATE OR DELETE ON profile_versions FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();

CREATE FUNCTION dg_native_asset_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
 IF (NEW.id,NEW.tenant_id,NEW.workspace_id,NEW.upload_id,NEW.category,NEW.synthetic,NEW.expires_at,NEW.created_at)
  IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.workspace_id,OLD.upload_id,OLD.category,OLD.synthetic,OLD.expires_at,OLD.created_at)
  OR NEW.version<>OLD.version+1 THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native asset source is immutable and changes require a new version';
 END IF;
 RETURN NEW;
END;
$dg$;
CREATE TRIGGER native_asset_guard BEFORE UPDATE ON assets FOR EACH ROW EXECUTE FUNCTION dg_native_asset_guard();

CREATE FUNCTION dg_native_consent_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
 IF (NEW.id,NEW.tenant_id,NEW.workspace_id,NEW.asset_id,NEW.purpose,NEW.subject,NEW.proof,NEW.notice_version,NEW.expires_at,NEW.created_at)
  IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.workspace_id,OLD.asset_id,OLD.purpose,OLD.subject,OLD.proof,OLD.notice_version,OLD.expires_at,OLD.created_at)
  OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native consent terms and revocation are immutable';
 END IF;
 RETURN NEW;
END;
$dg$;
CREATE TRIGGER native_consent_guard BEFORE UPDATE ON consents FOR EACH ROW EXECUTE FUNCTION dg_native_consent_guard();
