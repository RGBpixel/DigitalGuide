-- R-037 / T05 / T20: admin-only publication of reception aliases.
-- This dependency does not enable visitor registration or send notifications.
-- Applied 001--063 stay immutable. No existing workstation data is rewritten.
CREATE TABLE _dg_native_visit_hosts(
 id text PRIMARY KEY,tenant_id text NOT NULL REFERENCES tenants(id),
 workspace_id text NOT NULL REFERENCES workspaces(id),alias text NOT NULL,alias_key text NOT NULL,
 recipient_id text NOT NULL,enabled boolean NOT NULL,version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 disabled_reason text CHECK(disabled_reason IN('manual','member_scope_withdrawn')),
 environment text NOT NULL CHECK(environment='mock'),app_env text NOT NULL CHECK(app_env IN('development','sandbox')),
 created_at text NOT NULL,updated_at text NOT NULL,
 CHECK(char_length(alias) BETWEEN 1 AND 40 AND char_length(alias_key) BETWEEN 1 AND 40),
 CHECK((enabled AND disabled_reason IS NULL) OR (NOT enabled AND disabled_reason IS NOT NULL))
);
CREATE UNIQUE INDEX native_visit_host_live_alias ON _dg_native_visit_hosts(tenant_id,workspace_id,alias_key) WHERE enabled;
CREATE INDEX native_visit_host_recipient ON _dg_native_visit_hosts(recipient_id,workspace_id);
CREATE TABLE _dg_native_visit_host_revisions(
 host_id text NOT NULL REFERENCES _dg_native_visit_hosts(id),version bigint NOT NULL CHECK(version>0),
 recipient_id text NOT NULL,enabled boolean NOT NULL,alias_hash text NOT NULL CHECK(alias_hash ~ '^[a-f0-9]{64}$'),
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),created_at text NOT NULL,
 PRIMARY KEY(host_id,version)
);
CREATE TABLE _dg_native_visit_host_revocations(
 host_id text NOT NULL,version bigint NOT NULL,reason text NOT NULL CHECK(reason IN('configuration_changed','member_scope_withdrawn')),
 created_at text NOT NULL,PRIMARY KEY(host_id,version),
 FOREIGN KEY(host_id,version) REFERENCES _dg_native_visit_host_revisions(host_id,version)
);
CREATE TRIGGER native_visit_host_revision_immutable BEFORE UPDATE OR DELETE ON _dg_native_visit_host_revisions FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_visit_host_revocation_immutable BEFORE UPDATE OR DELETE ON _dg_native_visit_host_revocations FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();

CREATE FUNCTION dg_native_visit_host_error(code_value text) RETURNS void LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='DGVISITHOST:'||code_value;END;$dg$;

CREATE FUNCTION dg_native_visit_host_scope(workspace_value text,write_value boolean DEFAULT false) RETURNS memberships LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE m memberships%ROWTYPE;
BEGIN
 m:=dg_native_reception_admin(workspace_value);
 IF NOT EXISTS(SELECT 1 FROM workspaces WHERE id=workspace_value AND tenant_id=m.tenant_id) THEN PERFORM dg_native_visit_host_error('NOT_FOUND');END IF;
 IF write_value THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('["native-asset-workspace",'||to_jsonb(m.tenant_id)::text||','||to_jsonb(workspace_value)::text||']',0));
 ELSE
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('["native-asset-workspace",'||to_jsonb(m.tenant_id)::text||','||to_jsonb(workspace_value)::text||']',0));
 END IF;
 PERFORM dg_native_reception_workspace(m.tenant_id,workspace_value,write_value);
 RETURN m;
END;$dg$;

-- Acquire recipient memberships before workspace/parent locks, including on a
-- cached replay. A missing proposed member is rejected only for a new mutation.
CREATE FUNCTION dg_native_visit_host_prepare(workspace_value text,target text,recipient_value text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE m memberships%ROWTYPE;h _dg_native_visit_hosts%ROWTYPE;w text;
BEGIN
 PERFORM dg_native_reception_runtime();PERFORM dg_native_reception_admin(NULL);
 IF target IS NOT NULL THEN
  SELECT * INTO h FROM _dg_native_visit_hosts WHERE id=target;
  IF h.id IS NULL THEN PERFORM dg_native_visit_host_error('NOT_FOUND');END IF;
  w:=h.workspace_id;
 ELSE w:=workspace_value;END IF;
 m:=dg_native_reception_admin(w);
 IF h.id IS NOT NULL AND (h.tenant_id<>m.tenant_id OR h.app_env<>(SELECT app_env FROM _dg_native_runtime_control WHERE id=1)) THEN PERFORM dg_native_visit_host_error('NOT_FOUND');END IF;
 PERFORM user_id FROM memberships WHERE user_id=ANY(ARRAY[h.recipient_id,recipient_value]) ORDER BY user_id FOR SHARE;
 PERFORM dg_native_visit_host_scope(w,true);
 IF target IS NOT NULL THEN
  PERFORM id FROM _dg_native_visit_hosts WHERE id=target FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM _dg_native_visit_hosts WHERE id=target AND recipient_id=ANY(ARRAY[h.recipient_id,recipient_value])) THEN PERFORM dg_native_visit_host_error('VERSION_CONFLICT');END IF;
 END IF;
 RETURN w;
END;$dg$;

CREATE FUNCTION dg_native_visit_host_revision(target text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE h _dg_native_visit_hosts%ROWTYPE;
BEGIN
 SELECT * INTO STRICT h FROM _dg_native_visit_hosts WHERE id=target;
 INSERT INTO _dg_native_visit_host_revisions VALUES(h.id,h.version,h.recipient_id,h.enabled,
  encode(sha256(convert_to(h.alias_key,'UTF8')),'hex'),
  dg_native_office_hash(jsonb_build_object('id',h.id,'tenantId',h.tenant_id,'workspaceId',h.workspace_id,'alias',h.alias,'aliasKey',h.alias_key,'recipientId',h.recipient_id,'enabled',h.enabled,'version',h.version,'environment',h.environment,'appEnv',h.app_env)),h.updated_at);
END;$dg$;

-- Private integration point for later visit snapshots. Re-enabling a publication
-- can authorize a new revision only; a revoked old target never becomes valid.
CREATE FUNCTION dg_native_visit_host_reference_valid(target text,version_value bigint,recipient_value text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT EXISTS(SELECT 1 FROM _dg_native_visit_hosts h JOIN _dg_native_visit_host_revisions r ON r.host_id=h.id AND r.version=h.version
  WHERE h.id=target AND h.version=version_value AND h.recipient_id=recipient_value AND r.recipient_id=h.recipient_id AND h.enabled AND r.enabled
  AND h.environment='mock' AND h.app_env=(SELECT app_env FROM _dg_native_runtime_control WHERE id=1)
  AND NOT EXISTS(SELECT 1 FROM _dg_native_visit_host_revocations v WHERE v.host_id=r.host_id AND v.version=r.version)
  AND dg_native_office_member(h.recipient_id,h.tenant_id,h.workspace_id,true))
$dg$;

CREATE FUNCTION dg_native_visit_host_view(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE h _dg_native_visit_hosts%ROWTYPE;m memberships%ROWTYPE;active_value boolean;
BEGIN
 PERFORM dg_native_reception_admin(NULL);
 SELECT * INTO h FROM _dg_native_visit_hosts WHERE id=target;
 IF h.id IS NULL THEN PERFORM dg_native_visit_host_error('NOT_FOUND');END IF;
 m:=dg_native_visit_host_scope(h.workspace_id);
 SELECT * INTO h FROM _dg_native_visit_hosts WHERE id=target AND tenant_id=m.tenant_id AND environment='mock' AND app_env=(SELECT app_env FROM _dg_native_runtime_control WHERE id=1);
 IF h.id IS NULL THEN PERFORM dg_native_visit_host_error('NOT_FOUND');END IF;
 active_value:=dg_native_office_member(h.recipient_id,h.tenant_id,h.workspace_id,true);
 RETURN jsonb_build_object('id',h.id,'workspaceId',h.workspace_id,'alias',h.alias,'recipientId',h.recipient_id,
  'recipientName',CASE WHEN active_value THEN coalesce((SELECT name FROM users WHERE id=h.recipient_id),'接待成员') ELSE '原接待账号已不可用' END,
  'recipientActive',active_value,'enabled',h.enabled,'version',h.version,'disabledReason',h.disabled_reason,'createdAt',h.created_at,'updatedAt',h.updated_at);
END;$dg$;

CREATE FUNCTION dg_native_visit_hosts_list(workspace_value text,cursor_value text,limit_value integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE m memberships%ROWTYPE;h record;items jsonb:='[]'::jsonb;
BEGIN
 IF limit_value IS NULL OR limit_value NOT BETWEEN 1 AND 101 THEN PERFORM dg_native_visit_host_error('VALIDATION_FAILED');END IF;
 m:=dg_native_visit_host_scope(workspace_value);
 FOR h IN SELECT id FROM _dg_native_visit_hosts WHERE tenant_id=m.tenant_id AND workspace_id=workspace_value AND environment='mock' AND app_env=(SELECT app_env FROM _dg_native_runtime_control WHERE id=1) AND id>cursor_value ORDER BY id LIMIT limit_value LOOP items:=items||jsonb_build_array(dg_native_visit_host_view(h.id));END LOOP;
 RETURN items;
END;$dg$;

CREATE FUNCTION dg_native_visit_host_candidates(workspace_value text,cursor_value text,limit_value integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE m memberships%ROWTYPE;items jsonb;
BEGIN
 IF limit_value IS NULL OR limit_value NOT BETWEEN 1 AND 101 THEN PERFORM dg_native_visit_host_error('VALIDATION_FAILED');END IF;
 m:=dg_native_visit_host_scope(workspace_value);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'role',a.role) ORDER BY a.id),'[]'::jsonb) INTO items FROM
  (SELECT u.id,u.name,c.role FROM memberships c JOIN users u ON u.id=c.user_id
   WHERE c.tenant_id=m.tenant_id AND c.workspace_ids::jsonb ? workspace_value AND c.role IN('admin','editor') AND c.user_id>cursor_value ORDER BY c.user_id LIMIT limit_value) a;
 RETURN items;
END;$dg$;

CREATE FUNCTION dg_native_visit_host_apply(target text,input jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE h _dg_native_visit_hosts%ROWTYPE;m memberships%ROWTYPE;w text;alias_value text;key_value text;recipient_value text:=input->>'recipientId';enabled_value boolean;id_value text;now_value text:=dg_utc_now();
BEGIN
 IF input IS NULL OR jsonb_typeof(input)<>'object' THEN PERFORM dg_native_visit_host_error('VALIDATION_FAILED');END IF;
 PERFORM dg_native_reception_fields(input,CASE WHEN target IS NULL THEN ARRAY['workspaceId','alias','recipientId','enabled'] ELSE ARRAY['alias','recipientId','enabled','version'] END);
 IF jsonb_typeof(input->'alias') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'recipientId') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'enabled') IS DISTINCT FROM 'boolean' OR recipient_value !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN PERFORM dg_native_visit_host_error('VALIDATION_FAILED');END IF;
 alias_value:=regexp_replace(normalize(btrim(input->>'alias'),NFC),'[[:space:]]+',' ','g');key_value:=lower(alias_value);
 IF char_length(alias_value) NOT BETWEEN 1 AND 40 OR (input->>'alias') ~ '[[:cntrl:]]' THEN PERFORM dg_native_visit_host_error('VALIDATION_FAILED');END IF;
 enabled_value:=(input->>'enabled')::boolean;
 w:=dg_native_visit_host_prepare(input->>'workspaceId',target,recipient_value);m:=dg_native_reception_admin(w);
 IF NOT dg_native_office_member(recipient_value,m.tenant_id,w,true) THEN PERFORM dg_native_visit_host_error('RECIPIENT_UNAVAILABLE');END IF;
 IF target IS NULL THEN
  IF (SELECT count(*) FROM _dg_native_visit_hosts WHERE tenant_id=m.tenant_id AND workspace_id=w)>=200 THEN PERFORM dg_native_visit_host_error('QUOTA_EXCEEDED');END IF;
  id_value:=gen_random_uuid()::text;
 ELSE
  SELECT * INTO STRICT h FROM _dg_native_visit_hosts WHERE id=target FOR UPDATE;
  IF jsonb_typeof(input->'version') IS DISTINCT FROM 'number' OR input->>'version'<>h.version::text THEN PERFORM dg_native_visit_host_error('VERSION_CONFLICT');END IF;
  id_value:=h.id;
 END IF;
 IF enabled_value AND EXISTS(SELECT 1 FROM _dg_native_visit_hosts WHERE tenant_id=m.tenant_id AND workspace_id=w AND alias_key=key_value AND enabled AND id<>id_value) THEN PERFORM dg_native_visit_host_error('ALIAS_CONFLICT');END IF;
 IF target IS NULL THEN
  INSERT INTO _dg_native_visit_hosts VALUES(id_value,m.tenant_id,w,alias_value,key_value,recipient_value,enabled_value,1,CASE WHEN enabled_value THEN NULL ELSE 'manual' END,'mock',(SELECT app_env FROM _dg_native_runtime_control WHERE id=1),now_value,now_value);
 ELSE
  INSERT INTO _dg_native_visit_host_revocations VALUES(h.id,h.version,'configuration_changed',now_value) ON CONFLICT DO NOTHING;
  UPDATE _dg_native_visit_hosts SET alias=alias_value,alias_key=key_value,recipient_id=recipient_value,enabled=enabled_value,version=version+1,disabled_reason=CASE WHEN enabled_value THEN NULL ELSE 'manual' END,updated_at=now_value WHERE id=h.id;
 END IF;
 PERFORM dg_native_visit_host_revision(id_value);RETURN id_value;
END;$dg$;

CREATE FUNCTION dg_native_visit_host_member_withdrawn() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE h _dg_native_visit_hosts%ROWTYPE;now_value text:=dg_utc_now();
BEGIN
 IF TG_OP='UPDATE' AND NEW.tenant_id=OLD.tenant_id AND NEW.role=OLD.role AND NEW.workspace_ids=OLD.workspace_ids THEN RETURN NULL;END IF;
 FOR h IN SELECT * FROM _dg_native_visit_hosts WHERE recipient_id=OLD.user_id AND enabled ORDER BY tenant_id,workspace_id,id LOOP
  IF NOT dg_native_office_member(h.recipient_id,h.tenant_id,h.workspace_id,true) THEN
   PERFORM pg_advisory_xact_lock(hashtextextended('["native-asset-workspace",'||to_jsonb(h.tenant_id)::text||','||to_jsonb(h.workspace_id)::text||']',0));
   PERFORM dg_native_reception_workspace(h.tenant_id,h.workspace_id,true);
   SELECT * INTO h FROM _dg_native_visit_hosts WHERE id=h.id FOR UPDATE;
   IF NOT h.enabled THEN CONTINUE;END IF;
   INSERT INTO _dg_native_visit_host_revocations VALUES(h.id,h.version,'member_scope_withdrawn',now_value) ON CONFLICT DO NOTHING;
   UPDATE _dg_native_visit_hosts SET enabled=false,version=version+1,disabled_reason='member_scope_withdrawn',updated_at=now_value WHERE id=h.id;
   PERFORM dg_native_visit_host_revision(h.id);
  END IF;
 END LOOP;RETURN NULL;
END;$dg$;
CREATE TRIGGER aa_native_visit_host_member_withdrawn AFTER UPDATE OR DELETE ON memberships FOR EACH ROW EXECUTE FUNCTION dg_native_visit_host_member_withdrawn();

DO $dg$ DECLARE r record;BEGIN FOR r IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND p.proname LIKE 'dg_native_visit_host%' LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||r.signature||' FROM PUBLIC';END LOOP;END;$dg$;
