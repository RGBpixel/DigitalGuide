-- Recovery evidence is committed with the original mutation. Payloads contain
-- only salted key digests and bounded metadata, never row bodies or credentials.
CREATE TABLE _dg_native_recovery_journal_control(
 id integer PRIMARY KEY CHECK(id=1),runtime_id text NOT NULL UNIQUE REFERENCES _dg_native_runtime_control(runtime_id),
 stream_id text NOT NULL UNIQUE CHECK(stream_id~'^[a-f0-9-]{36}$'),public_key text NOT NULL CHECK(char_length(public_key) BETWEEN 80 AND 2000 AND public_key LIKE '-----BEGIN PUBLIC KEY-----%'),
 coverage jsonb NOT NULL CHECK(jsonb_typeof(coverage)='array'),coverage_sha256 text NOT NULL CHECK(coverage_sha256=encode(sha256(convert_to(coverage::text,'UTF8')),'hex')),created_at text NOT NULL,
 UNIQUE(runtime_id,stream_id)
);
CREATE TABLE _dg_native_recovery_journal_events(
 id text COLLATE "C" PRIMARY KEY CHECK(id~'^[a-f0-9-]{36}$'),runtime_id text NOT NULL,stream_id text NOT NULL,payload jsonb NOT NULL,event_hash text NOT NULL,created_at text NOT NULL,
 FOREIGN KEY(runtime_id,stream_id) REFERENCES _dg_native_recovery_journal_control(runtime_id,stream_id),
 CHECK(jsonb_typeof(payload)='object' AND payload->>'id'=id AND payload->>'runtimeId'=runtime_id AND payload->>'streamId'=stream_id AND payload->>'occurredAt'=created_at AND event_hash=encode(sha256(convert_to(payload::text,'UTF8')),'hex')),
 CHECK(payload-ARRAY['schemaVersion','id','runtimeId','streamId','tableName','operation','recordHash','nextRecordHash','tenantId','workspaceId','sourceVersion','transactionId','occurredAt','category']='{}'::jsonb)
);
CREATE TABLE _dg_native_recovery_journal_plans(
 id text PRIMARY KEY,backup_id text NOT NULL,runtime_id text NOT NULL REFERENCES _dg_native_runtime_control(runtime_id),stream_id text NOT NULL REFERENCES _dg_native_recovery_journal_control(stream_id),
 generation bigint NOT NULL CHECK(generation>0),head_sha256 text NOT NULL CHECK(head_sha256~'^[a-f0-9]{64}$'),packet_sha256 text NOT NULL CHECK(packet_sha256~'^[a-f0-9]{64}$'),
 base_events bigint NOT NULL CHECK(base_events>=0),source_events bigint NOT NULL CHECK(source_events>=base_events),delta_events bigint NOT NULL CHECK(delta_events=source_events-base_events),
 summary jsonb NOT NULL CHECK(jsonb_typeof(summary)='array'),status text NOT NULL CHECK(status='pending'),created_at text NOT NULL,
 UNIQUE(backup_id,stream_id,generation),UNIQUE(backup_id,stream_id,packet_sha256)
);
CREATE FUNCTION dg_native_recovery_journal_key(stream_value text,table_value text,row_value jsonb,keys_value text[]) RETURNS text LANGUAGE sql IMMUTABLE SET search_path FROM CURRENT AS $dg$
 SELECT encode(sha256(convert_to(jsonb_build_array(stream_value,table_value,(SELECT jsonb_object_agg(k,to_jsonb(row_value->>k) ORDER BY k COLLATE "C") FROM unnest(keys_value) k))::text,'UTF8')),'hex')
$dg$;
CREATE FUNCTION dg_native_recovery_journal_capture() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE c _dg_native_recovery_journal_control%ROWTYPE;status_value text;row_value jsonb;next_value jsonb;keys_value text[];key_value text;next_key text;event_value jsonb;event_id text:=gen_random_uuid()::text;time_value text:=dg_utc_now();version_value text;category_value text;
BEGIN
 SELECT status INTO status_value FROM _dg_native_runtime_control WHERE id=1;
 IF status_value IS DISTINCT FROM 'validation_only' THEN IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;END IF;
 SELECT * INTO c FROM _dg_native_recovery_journal_control WHERE id=1;
 IF c.id IS NULL THEN IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;END IF;
 IF TG_TABLE_SCHEMA<>current_schema() THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Recovery journal schema mismatch';END IF;
 SELECT array_agg(a.attname ORDER BY a.attname COLLATE "C") INTO keys_value FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey) WHERE i.indrelid=TG_RELID AND i.indisprimary;
 IF coalesce(array_length(keys_value,1),0)=0 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Recovery journal requires a primary key';END IF;
 IF TG_OP='INSERT' THEN row_value:=to_jsonb(NEW);ELSE row_value:=to_jsonb(OLD);END IF;
 key_value:=dg_native_recovery_journal_key(c.stream_id,TG_TABLE_NAME,row_value,keys_value);
 IF TG_OP='UPDATE' THEN next_value:=to_jsonb(NEW);next_key:=dg_native_recovery_journal_key(c.stream_id,TG_TABLE_NAME,next_value,keys_value);IF next_key=key_value THEN next_key:=NULL;END IF;ELSE next_value:=row_value;END IF;
 version_value:=next_value->>'version';IF coalesce(version_value,'')!~'^[0-9]{1,20}$' THEN version_value:=NULL;END IF;
 category_value:=CASE WHEN TG_TABLE_NAME IN('people','memory_facts','memory_notes','memory_lookup','memory_session_links','memory_session_greetings','privacy_requests','visits','reception_messages','dining_feedback','dining_followup_consents') THEN 'privacy' WHEN TG_TABLE_NAME IN('users','memberships','auth_sessions','consents') OR TG_TABLE_NAME~'_(grants|access|credentials|permissions|guards)$' THEN 'authority' ELSE 'business' END;
 event_value:=jsonb_build_object('schemaVersion',1,'id',event_id,'runtimeId',c.runtime_id,'streamId',c.stream_id,'tableName',TG_TABLE_NAME,'operation',substr(TG_OP,1,1),'recordHash',key_value,'nextRecordHash',next_key,'tenantId',CASE WHEN coalesce(row_value->>'tenant_id','')~'^[a-f0-9-]{36}$' THEN row_value->>'tenant_id' END,'workspaceId',CASE WHEN coalesce(row_value->>'workspace_id','')~'^[a-f0-9-]{36}$' THEN row_value->>'workspace_id' END,'sourceVersion',version_value,'transactionId',pg_current_xact_id()::text,'occurredAt',time_value,'category',category_value);
 INSERT INTO _dg_native_recovery_journal_events VALUES(event_id,c.runtime_id,c.stream_id,event_value,encode(sha256(convert_to(event_value::text,'UTF8')),'hex'),time_value);
 IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
END;$dg$;
CREATE FUNCTION dg_native_recovery_journal_truncate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE c _dg_native_recovery_journal_control%ROWTYPE;event_value jsonb;event_id text:=gen_random_uuid()::text;time_value text:=dg_utc_now();
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only') THEN RETURN NULL;END IF;
 SELECT * INTO c FROM _dg_native_recovery_journal_control WHERE id=1;IF c.id IS NULL THEN RETURN NULL;END IF;
 IF TG_TABLE_SCHEMA<>current_schema() THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Recovery journal schema mismatch';END IF;
 event_value:=jsonb_build_object('schemaVersion',1,'id',event_id,'runtimeId',c.runtime_id,'streamId',c.stream_id,'tableName',TG_TABLE_NAME,'operation','T','recordHash',encode(sha256(convert_to(jsonb_build_array(c.stream_id,TG_TABLE_NAME,'table_truncate')::text,'UTF8')),'hex'),'nextRecordHash',NULL,'tenantId',NULL,'workspaceId',NULL,'sourceVersion',NULL,'transactionId',pg_current_xact_id()::text,'occurredAt',time_value,'category',CASE WHEN TG_TABLE_NAME IN('people','memory_facts','memory_notes','memory_lookup','memory_session_links','memory_session_greetings','privacy_requests','visits','reception_messages','dining_feedback','dining_followup_consents') THEN 'privacy' WHEN TG_TABLE_NAME IN('users','memberships','auth_sessions','consents') OR TG_TABLE_NAME~'_(grants|access|credentials|permissions|guards)$' THEN 'authority' ELSE 'business' END);
 INSERT INTO _dg_native_recovery_journal_events VALUES(event_id,c.runtime_id,c.stream_id,event_value,encode(sha256(convert_to(event_value::text,'UTF8')),'hex'),time_value);RETURN NULL;
END;$dg$;
CREATE FUNCTION dg_native_recovery_journal_install() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE t record;
BEGIN
 FOR t IN SELECT c.oid,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relkind='r' AND c.relname NOT IN('_dg_native_runtime_control','_dg_postgres_migrations','schema_migrations','_dg_native_recovery_journal_control','_dg_native_recovery_journal_events','_dg_native_recovery_journal_plans') ORDER BY c.relname LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid=t.oid AND i.indisprimary) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native recovery coverage requires primary keys';END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=t.oid AND tgname='native_recovery_change') THEN EXECUTE format('CREATE TRIGGER native_recovery_change AFTER INSERT OR UPDATE OR DELETE ON %I.%I FOR EACH ROW EXECUTE FUNCTION %I.dg_native_recovery_journal_capture()',current_schema(),t.relname,current_schema());END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=t.oid AND tgname='native_recovery_truncate') THEN EXECUTE format('CREATE TRIGGER native_recovery_truncate BEFORE TRUNCATE ON %I.%I FOR EACH STATEMENT EXECUTE FUNCTION %I.dg_native_recovery_journal_truncate()',current_schema(),t.relname,current_schema());END IF;
 END LOOP;
END;$dg$;
CREATE FUNCTION dg_native_recovery_journal_coverage() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT coalesce(jsonb_agg(jsonb_build_object('tableName',c.relname,'keys',(SELECT jsonb_agg(a.attname ORDER BY a.attname COLLATE "C") FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey) WHERE i.indrelid=c.oid AND i.indisprimary),'tracked',coalesce(t.tgenabled='O' AND t.tgtype=29 AND t.tgnargs=0 AND t.tgqual IS NULL AND t.tgfoid='dg_native_recovery_journal_capture()'::regprocedure AND tr.tgenabled='O' AND tr.tgtype=34 AND tr.tgnargs=0 AND tr.tgqual IS NULL AND tr.tgfoid='dg_native_recovery_journal_truncate()'::regprocedure,false)) ORDER BY c.relname COLLATE "C"),'[]') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_trigger t ON t.tgrelid=c.oid AND t.tgname='native_recovery_change' LEFT JOIN pg_trigger tr ON tr.tgrelid=c.oid AND tr.tgname='native_recovery_truncate' WHERE n.nspname=current_schema() AND c.relkind='r' AND c.relname NOT IN('_dg_native_runtime_control','_dg_postgres_migrations','schema_migrations','_dg_native_recovery_journal_control','_dg_native_recovery_journal_events','_dg_native_recovery_journal_plans')
$dg$;
SELECT dg_native_recovery_journal_install();
REVOKE ALL ON FUNCTION dg_native_recovery_journal_key(text,text,jsonb,text[]),dg_native_recovery_journal_capture(),dg_native_recovery_journal_truncate(),dg_native_recovery_journal_install(),dg_native_recovery_journal_coverage() FROM PUBLIC;
CREATE TRIGGER native_recovery_control_immutable BEFORE UPDATE OR DELETE ON _dg_native_recovery_journal_control FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_recovery_control_truncate BEFORE TRUNCATE ON _dg_native_recovery_journal_control FOR EACH STATEMENT EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_recovery_events_immutable BEFORE UPDATE OR DELETE ON _dg_native_recovery_journal_events FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_recovery_events_truncate BEFORE TRUNCATE ON _dg_native_recovery_journal_events FOR EACH STATEMENT EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_recovery_plans_immutable BEFORE UPDATE OR DELETE ON _dg_native_recovery_journal_plans FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_recovery_plans_truncate BEFORE TRUNCATE ON _dg_native_recovery_journal_plans FOR EACH STATEMENT EXECUTE FUNCTION dg_native_append_only();
