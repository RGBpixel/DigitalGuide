-- R-043/R-044/AC-09: private Office sources, local inbox and explicit mock IO.
-- Native validation only. Applied001-057 remain frozen.
CREATE TABLE _dg_native_office_source_guards(
 source_kind text NOT NULL CHECK(source_kind IN('relay','event')),source_id text NOT NULL,
 tenant_id text NOT NULL,workspace_id text NOT NULL,actor_id text NOT NULL,
 invalidated_at text,created_at text NOT NULL,PRIMARY KEY(source_kind,source_id)
);
CREATE TABLE _dg_native_office_source_revisions(
 source_kind text NOT NULL,source_id text NOT NULL,revision bigint NOT NULL CHECK(revision>0),
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),recipient_ids text NOT NULL,
 created_at text NOT NULL,PRIMARY KEY(source_kind,source_id,revision),
 CHECK(jsonb_typeof(recipient_ids::jsonb)='array' AND jsonb_array_length(recipient_ids::jsonb) BETWEEN 1 AND 20)
);
CREATE TABLE _dg_native_office_notice_guards(
 notification_id text PRIMARY KEY REFERENCES office_notifications(id),
 invalidated_at text,created_at text NOT NULL
);
CREATE TABLE _dg_native_office_attendee_guards(
 event_id text NOT NULL REFERENCES office_calendar_events(id),revision bigint NOT NULL,
 user_id text NOT NULL,invalidated_at text,created_at text NOT NULL,PRIMARY KEY(event_id,revision,user_id)
);
CREATE TABLE _dg_native_office_leases(
 tenant_id text PRIMARY KEY,notification_id text NOT NULL REFERENCES office_notifications(id),
 token text UNIQUE NOT NULL,lease_until text NOT NULL
);
CREATE TABLE _dg_native_office_attempts(
 notification_id text NOT NULL REFERENCES office_notifications(id),attempt bigint NOT NULL CHECK(attempt BETWEEN 1 AND 3),
 token text UNIQUE NOT NULL,request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 recovering bigint NOT NULL CHECK(recovering IN(0,1)),created_at text NOT NULL,PRIMARY KEY(notification_id,attempt)
);
CREATE TRIGGER native_office_source_revision_immutable BEFORE UPDATE OR DELETE ON _dg_native_office_source_revisions FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_office_attempt_immutable BEFORE UPDATE OR DELETE ON _dg_native_office_attempts FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_office_mock_receipt_immutable BEFORE UPDATE OR DELETE ON office_mock_submissions FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
ALTER TABLE office_relays ADD CONSTRAINT native_office_relay_shape CHECK(version>0 AND revision>0 AND status IN('draft','scheduled','sent','cancelled','expired') AND confidentiality IN('private','public') AND channel IN('local','mock') AND scenario IN('normal','failed','unknown') AND environment='mock' AND app_env IN('development','sandbox') AND char_length(subject) BETWEEN 1 AND 100 AND char_length(body)<=1000 AND(status NOT IN('cancelled','expired') OR body=''));
ALTER TABLE office_calendar_events ADD CONSTRAINT native_office_event_shape CHECK(version>0 AND revision>0 AND status IN('scheduled','cancelled','completed','expired') AND channel IN('local','mock') AND reminder_minutes IN(0,5,10,15,30,60) AND environment='mock' AND app_env IN('development','sandbox') AND char_length(title) BETWEEN 1 AND 100 AND char_length(description)<=1000 AND char_length(location)<=120 AND(status<>'expired' OR(description='' AND location='')));
ALTER TABLE office_event_attendees ADD CONSTRAINT native_office_attendee_shape CHECK(response IN('pending','accepted','declined'));
ALTER TABLE office_notifications ADD CONSTRAINT native_office_notice_shape CHECK(version>0 AND source_revision>0 AND attempts BETWEEN 0 AND 3 AND source_kind IN('relay','event') AND kind IN('relay','invite','reminder','update','cancel','removed') AND status IN('pending','unread','read','acknowledged','withdrawn','expired') AND dispatch_status IN('queued','submitting','local','submitted_mock','failed','unknown','withdrawn') AND channel IN('local','mock') AND scenario IN('normal','failed','unknown') AND environment='mock' AND app_env IN('development','sandbox') AND((dispatch_status='submitting' AND status='pending' AND lease_token IS NOT NULL AND lease_until IS NOT NULL) OR(dispatch_status<>'submitting' AND lease_token IS NULL AND lease_until IS NULL)) AND(status NOT IN('withdrawn','expired') OR dispatch_status='withdrawn'));

CREATE FUNCTION dg_native_office_hash(value jsonb) RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT encode(sha256(convert_to(dg_native_live_answer_canonical(value),'UTF8')),'hex')
$dg$;
CREATE FUNCTION dg_native_office_member(actor text,tenant text,workspace text,write_access boolean DEFAULT false) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT EXISTS(SELECT 1 FROM memberships WHERE user_id=actor AND tenant_id=tenant AND role IN('admin','editor','reviewer','viewer') AND(NOT write_access OR role IN('admin','editor')) AND workspace_ids::jsonb ? workspace)
$dg$;
CREATE FUNCTION dg_native_office_payload(kind_value text,target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE r office_relays%ROWTYPE;e office_calendar_events%ROWTYPE;
BEGIN
 IF kind_value='relay' THEN SELECT * INTO r FROM office_relays WHERE id=target;IF r.id IS NULL THEN RETURN NULL;END IF;RETURN jsonb_build_object('id',r.id,'tenant',r.tenant_id,'workspace',r.workspace_id,'sender',r.sender_user_id,'recipient',r.recipient_user_id,'subject',r.subject,'body',r.body,'confidentiality',r.confidentiality,'channel',r.channel,'scenario',r.scenario,'scheduledAt',r.scheduled_at,'expiresAt',r.expires_at,'revision',r.revision,'environment',r.environment,'appEnv',r.app_env);
 ELSIF kind_value='event' THEN SELECT * INTO e FROM office_calendar_events WHERE id=target;IF e.id IS NULL THEN RETURN NULL;END IF;RETURN jsonb_build_object('id',e.id,'tenant',e.tenant_id,'workspace',e.workspace_id,'organizer',e.organizer_user_id,'title',e.title,'description',e.description,'location',e.location,'startsAt',e.starts_at,'endsAt',e.ends_at,'timezone',e.timezone,'reminderMinutes',e.reminder_minutes,'channel',e.channel,'expiresAt',e.expires_at,'revision',e.revision,'environment',e.environment,'appEnv',e.app_env,'recipients',coalesce((SELECT jsonb_agg(user_id ORDER BY user_id) FROM office_event_attendees WHERE event_id=e.id),'[]'::jsonb));END IF;RETURN NULL;
END;$dg$;
CREATE FUNCTION dg_native_office_record_source(kind_value text,target text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE payload jsonb;guard _dg_native_office_source_guards%ROWTYPE;actor text:=current_setting('digitalguide.actor_id',true);current_app text;recipients jsonb;
BEGIN
 SELECT app_env INTO current_app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user=app_role;IF current_app IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only native API records explicitly reviewed Office sources';END IF;
 SELECT * INTO guard FROM _dg_native_office_source_guards WHERE source_kind=kind_value AND source_id=target;payload:=dg_native_office_payload(kind_value,target);
 IF payload IS NULL OR guard.source_id IS NULL OR guard.invalidated_at IS NOT NULL OR guard.actor_id IS DISTINCT FROM actor OR payload->>'appEnv'<>current_app OR NOT dg_native_office_member(actor,guard.tenant_id,guard.workspace_id,true) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Office source actor or fixed scope changed';END IF;
 PERFORM dg_native_office_insert_revision(kind_value,target);
END;$dg$;
CREATE FUNCTION dg_native_office_private_source(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE n office_notifications%ROWTYPE;r office_relays%ROWTYPE;e office_calendar_events%ROWTYPE;guard _dg_native_office_source_guards%ROWTYPE;revision _dg_native_office_source_revisions%ROWTYPE;now_value text:=dg_utc_now();current_app text;
BEGIN
 SELECT app_env INTO current_app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only';SELECT * INTO n FROM office_notifications WHERE id=target AND environment='mock' AND app_env=current_app;
 IF n.id IS NULL OR n.status IN('withdrawn','expired') OR n.due_at>now_value OR n.expires_at<=now_value OR NOT dg_native_office_member(n.recipient_user_id,n.tenant_id,n.workspace_id) OR NOT EXISTS(SELECT 1 FROM _dg_native_office_notice_guards WHERE notification_id=n.id AND invalidated_at IS NULL) THEN RETURN NULL;END IF;
 SELECT * INTO guard FROM _dg_native_office_source_guards WHERE source_kind=n.source_kind AND source_id=n.source_id;SELECT rv.* INTO revision FROM _dg_native_office_source_revisions rv WHERE rv.source_kind=n.source_kind AND rv.source_id=n.source_id AND rv.revision=n.source_revision;
 IF guard.source_id IS NULL OR guard.invalidated_at IS NOT NULL OR guard.tenant_id<>n.tenant_id OR guard.workspace_id<>n.workspace_id OR revision.source_id IS NULL OR NOT dg_native_office_member(guard.actor_id,n.tenant_id,n.workspace_id,true) OR revision.payload_hash<>dg_native_office_hash(dg_native_office_payload(n.source_kind,n.source_id)) THEN RETURN NULL;END IF;
 IF n.source_kind='relay' THEN
  SELECT * INTO r FROM office_relays WHERE id=n.source_id;
  IF r.id IS NULL OR r.revision<>n.source_revision OR r.recipient_user_id<>n.recipient_user_id OR r.status NOT IN('scheduled','sent') OR r.expires_at<=now_value OR r.channel<>n.channel OR r.scenario<>n.scenario OR n.kind<>'relay' THEN RETURN NULL;END IF;RETURN jsonb_build_object('title',r.subject,'body',r.body,'senderId',r.sender_user_id);
 END IF;
 SELECT * INTO e FROM office_calendar_events WHERE id=n.source_id;IF e.id IS NULL OR e.revision<>n.source_revision OR e.expires_at<=now_value OR e.channel<>n.channel OR n.scenario<>'normal' THEN RETURN NULL;END IF;
 IF n.kind='removed' THEN
  IF EXISTS(SELECT 1 FROM office_event_attendees WHERE event_id=e.id AND user_id=n.recipient_user_id) OR NOT EXISTS(SELECT 1 FROM _dg_native_office_source_revisions prior WHERE prior.source_kind='event' AND prior.source_id=e.id AND prior.revision=e.revision-1 AND prior.recipient_ids::jsonb ? n.recipient_user_id) THEN RETURN NULL;END IF;RETURN jsonb_build_object('title','会议安排已变更','body','您不再属于此会议的参与范围，旧提醒已撤销。','senderId',e.organizer_user_id);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM office_event_attendees a JOIN _dg_native_office_attendee_guards g ON g.event_id=a.event_id AND g.user_id=a.user_id AND g.revision=e.revision WHERE a.event_id=e.id AND a.user_id=n.recipient_user_id AND g.invalidated_at IS NULL) THEN RETURN NULL;END IF;
 IF n.kind='cancel' AND e.status='cancelled' THEN RETURN jsonb_build_object('title','会议已取消：'||e.title,'body','组织者已取消会议，请以最新本地日历为准。','senderId',e.organizer_user_id);END IF;
 IF e.status<>'scheduled' OR e.ends_at<=now_value OR n.kind NOT IN('invite','update','reminder') THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('title',(CASE WHEN n.kind='reminder' THEN '会议提醒：' WHEN n.kind='update' THEN '会议已更新：' ELSE '会议邀请：' END)||e.title,'body',e.starts_at||' — '||e.ends_at||'（'||e.timezone||'）'||E'\n'||CASE WHEN e.location<>'' THEN '地点：'||e.location||E'\n' ELSE '' END||e.description,'senderId',e.organizer_user_id);
END;$dg$;
CREATE FUNCTION dg_native_office_source(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE n office_notifications%ROWTYPE;actor text:=current_setting('digitalguide.actor_id',true);allowed boolean:=false;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user=app_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Office API source is private to authenticated inbox or source owner';END IF;
 SELECT * INTO n FROM office_notifications WHERE id=target;IF n.id IS NULL OR n.status NOT IN('unread','read','acknowledged') OR NOT dg_native_office_member(actor,n.tenant_id,n.workspace_id) THEN RETURN NULL;END IF;
 allowed:=n.recipient_user_id=actor OR(n.source_kind='relay' AND EXISTS(SELECT 1 FROM office_relays WHERE id=n.source_id AND sender_user_id=actor));IF NOT allowed THEN RETURN NULL;END IF;RETURN dg_native_office_private_source(target);
END;$dg$;

CREATE FUNCTION dg_native_office_insert_revision(kind_value text,target text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE payload jsonb:=dg_native_office_payload(kind_value,target);recipients jsonb;
BEGIN
 IF payload IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Office source is missing';END IF;recipients:=CASE WHEN kind_value='relay' THEN jsonb_build_array(payload->>'recipient') ELSE payload->'recipients' END;
 IF kind_value='event' THEN
  INSERT INTO _dg_native_office_attendee_guards(event_id,revision,user_id,invalidated_at,created_at)
  SELECT e.id,e.revision,a.user_id,CASE WHEN NOT dg_native_office_member(a.user_id,e.tenant_id,e.workspace_id) THEN dg_utc_now() ELSE prior.invalidated_at END,dg_utc_now() FROM office_calendar_events e JOIN office_event_attendees a ON a.event_id=e.id LEFT JOIN LATERAL(SELECT p.invalidated_at FROM _dg_native_office_attendee_guards p WHERE p.event_id=e.id AND p.user_id=a.user_id AND p.revision<e.revision ORDER BY p.revision DESC LIMIT 1) prior ON true WHERE e.id=target ON CONFLICT(event_id,revision,user_id) DO NOTHING;
 END IF;
 INSERT INTO _dg_native_office_source_revisions VALUES(kind_value,target,(payload->>'revision')::bigint,dg_native_office_hash(payload),recipients::text,dg_utc_now()) ON CONFLICT(source_kind,source_id,revision) DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM _dg_native_office_source_revisions r WHERE r.source_kind=kind_value AND r.source_id=target AND r.revision=(payload->>'revision')::bigint AND r.payload_hash=dg_native_office_hash(payload) AND r.recipient_ids::jsonb=recipients) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Office source revision is immutable';END IF;
END;$dg$;
CREATE FUNCTION dg_native_office_source_row_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE row_value jsonb:=to_jsonb(NEW);old_value jsonb;kind_value text;owner_id text;actor text:=current_setting('digitalguide.actor_id',true);api_name text;worker_name text;current_app text;trusted boolean;mutable text[];invalidated boolean;
BEGIN
 SELECT app_role,worker_role,app_env INTO api_name,worker_name,current_app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only';trusted:=current_user<>api_name;
 kind_value:=CASE WHEN TG_TABLE_NAME='office_relays' THEN 'relay' ELSE 'event' END;owner_id:=CASE WHEN kind_value='relay' THEN to_jsonb(NEW)->>'sender_user_id' ELSE to_jsonb(NEW)->>'organizer_user_id' END;
 IF current_app IS NULL OR NEW.environment<>'mock' OR NEW.app_env<>current_app OR NOT EXISTS(SELECT 1 FROM workspaces WHERE id=NEW.workspace_id AND tenant_id=NEW.tenant_id) OR session_user NOT IN(api_name,worker_name,current_user) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Office runtime or source scope is invalid';END IF;
 IF TG_OP='INSERT' THEN
  IF NOT trusted AND(owner_id IS DISTINCT FROM actor OR NOT dg_native_office_member(actor,NEW.tenant_id,NEW.workspace_id,true) OR NEW.version<>1 OR NEW.revision<>1 OR NEW.status<>CASE WHEN kind_value='relay' THEN 'draft' ELSE 'scheduled' END) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Office source requires its authenticated creator';END IF;
  PERFORM user_id FROM dg_native_locked_membership(owner_id);
 ELSE
  old_value:=to_jsonb(OLD);IF NEW.version<>OLD.version+1 OR row_value-ARRAY['version','revision','updated_at','subject','body','confidentiality','channel','scenario','status','scheduled_at','expires_at','recipient_user_id','title','description','location','starts_at','ends_at','timezone','reminder_minutes'] IS DISTINCT FROM old_value-ARRAY['version','revision','updated_at','subject','body','confidentiality','channel','scenario','status','scheduled_at','expires_at','recipient_user_id','title','description','location','starts_at','ends_at','timezone','reminder_minutes'] THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Office identity is immutable and versions advance once';END IF;
  SELECT invalidated_at IS NOT NULL INTO invalidated FROM _dg_native_office_source_guards WHERE source_kind=kind_value AND source_id=NEW.id;
  IF kind_value='relay' THEN
   mutable:=ARRAY['version','updated_at'];
   IF OLD.status='draft' AND NEW.status='draft' THEN
    IF NEW.revision<>OLD.revision+1 OR owner_id IS DISTINCT FROM actor OR NOT dg_native_office_member(actor,NEW.tenant_id,NEW.workspace_id,true) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Only current sender edits a draft';END IF;mutable:=mutable||ARRAY['revision','recipient_user_id','subject','body','confidentiality','channel','scenario','scheduled_at','expires_at'];
   ELSIF OLD.status='draft' AND NEW.status='scheduled' THEN
    IF NEW.revision<>OLD.revision OR owner_id IS DISTINCT FROM actor OR NOT dg_native_office_member(actor,NEW.tenant_id,NEW.workspace_id,true) OR NEW.expires_at<=dg_utc_now() OR NOT dg_native_office_member(NEW.recipient_user_id,NEW.tenant_id,NEW.workspace_id) OR OLD.scheduled_at IS NOT NULL AND NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Office send requires the reviewed current draft';END IF;mutable:=mutable||ARRAY['status','scheduled_at'];
   ELSIF OLD.status='scheduled' AND NEW.status='sent' AND trusted THEN
    IF NEW.revision<>OLD.revision OR NOT EXISTS(SELECT 1 FROM office_notifications n WHERE n.source_kind='relay' AND n.source_id=NEW.id AND n.source_revision=NEW.revision AND n.status IN('unread','read','acknowledged') AND n.dispatch_status IN('local','submitted_mock','failed','unknown')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Sent relay needs its actual local inbox result';END IF;mutable:=mutable||ARRAY['status'];
   ELSIF NEW.status='cancelled' AND(OLD.status IN('draft','scheduled','sent') OR trusted AND invalidated) THEN
    IF NEW.revision<>OLD.revision+1 OR NEW.body<>'' OR NOT(trusted AND invalidated) AND(owner_id IS DISTINCT FROM actor OR NOT dg_native_office_member(actor,NEW.tenant_id,NEW.workspace_id,true)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Office withdrawal clears the original body';END IF;mutable:=mutable||ARRAY['revision','status','subject','body'];
   ELSIF NEW.status='expired' AND OLD.status<>'expired' AND NEW.expires_at<=dg_utc_now() THEN
    IF NEW.revision<>OLD.revision+1 OR NEW.body<>'' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Expired Office body must be erased';END IF;mutable:=mutable||ARRAY['revision','status','subject','body'];
   ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid relay state transition';END IF;
  ELSE
   mutable:=ARRAY['version','updated_at'];
   IF NEW.status='scheduled' AND OLD.status='scheduled' AND NEW.revision=OLD.revision+1 THEN
    IF owner_id IS DISTINCT FROM actor OR NOT dg_native_office_member(actor,NEW.tenant_id,NEW.workspace_id,true) OR OLD.ends_at<=dg_utc_now() THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Only the organizer updates an active meeting';END IF;mutable:=mutable||ARRAY['revision','title','description','location','starts_at','ends_at','timezone','reminder_minutes','channel','expires_at'];
   ELSIF NEW.status='scheduled' AND OLD.status='scheduled' AND NEW.revision=OLD.revision THEN
    IF NOT trusted OR NOT EXISTS(SELECT 1 FROM office_event_attendees a JOIN _dg_native_office_attendee_guards g ON g.event_id=a.event_id AND g.user_id=a.user_id AND g.revision=OLD.revision WHERE a.event_id=OLD.id AND a.user_id=actor AND g.invalidated_at IS NULL) OR NOT dg_native_office_member(actor,NEW.tenant_id,NEW.workspace_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Meeting responses belong to the current participant';END IF;
   ELSIF NEW.status='cancelled' AND(OLD.status='scheduled' OR trusted AND invalidated) THEN
    IF NEW.revision<>OLD.revision+1 OR NOT(trusted AND invalidated) AND(owner_id IS DISTINCT FROM actor OR NOT dg_native_office_member(actor,NEW.tenant_id,NEW.workspace_id,true)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Only organizer cancels the reviewed meeting';END IF;mutable:=mutable||ARRAY['revision','status'];IF trusted AND invalidated THEN mutable:=mutable||ARRAY['title','description','location'];IF NEW.description<>'' OR NEW.location<>'' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalidated meeting body is erased';END IF;END IF;
   ELSIF trusted AND invalidated AND OLD.status IN('completed','cancelled') AND NEW.status=OLD.status THEN IF NEW.revision<>OLD.revision+1 OR NEW.description<>'' OR NEW.location<>'' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Historical invalidation preserves state and erases private content';END IF;mutable:=mutable||ARRAY['revision','title','description','location'];
   ELSIF NEW.status='completed' AND OLD.status='scheduled' AND NEW.ends_at<=dg_utc_now() THEN IF NEW.revision<>OLD.revision THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Completion does not rewrite meeting content';END IF;mutable:=mutable||ARRAY['status'];
   ELSIF NEW.status='expired' AND OLD.status<>'expired' AND NEW.expires_at<=dg_utc_now() THEN IF NEW.revision<>OLD.revision+1 OR NEW.description<>'' OR NEW.location<>'' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Expired meeting body is erased';END IF;mutable:=mutable||ARRAY['revision','status','title','description','location'];
   ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid meeting state transition';END IF;
  END IF;
  IF row_value-mutable IS DISTINCT FROM old_value-mutable THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Office state transition cannot alter unrelated content';END IF;
 END IF;
 IF NOT trusted AND(TG_OP='INSERT' OR(kind_value='relay' AND NEW.status='draft') OR(kind_value='event' AND NEW.status='scheduled' AND(TG_OP='INSERT' OR NEW.revision<>OLD.revision))) THEN
  IF kind_value='relay' THEN IF NEW.expires_at<=dg_utc_now() OR extract(epoch FROM NEW.expires_at::timestamptz)-extract(epoch FROM clock_timestamp())>90*86400 OR NEW.scheduled_at>=NEW.expires_at OR NOT dg_native_office_member(NEW.recipient_user_id,NEW.tenant_id,NEW.workspace_id) OR char_length(NEW.body) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Relay time, recipient or text is invalid';END IF;
  ELSE IF NEW.starts_at<=dg_utc_now() OR extract(epoch FROM NEW.starts_at::timestamptz)-extract(epoch FROM clock_timestamp())>366*86400 OR NEW.ends_at<=NEW.starts_at OR extract(epoch FROM NEW.ends_at::timestamptz)-extract(epoch FROM NEW.starts_at::timestamptz)>7*86400 OR extract(epoch FROM NEW.expires_at::timestamptz)-extract(epoch FROM NEW.ends_at::timestamptz)<>30*86400 OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=NEW.timezone) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Meeting time, retention or timezone is invalid';END IF;END IF;
 END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_office_relay_guard BEFORE INSERT OR UPDATE ON office_relays FOR EACH ROW EXECUTE FUNCTION dg_native_office_source_row_guard();
CREATE TRIGGER native_office_event_guard BEFORE INSERT OR UPDATE ON office_calendar_events FOR EACH ROW EXECUTE FUNCTION dg_native_office_source_row_guard();

CREATE FUNCTION dg_native_office_register_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE kind_value text;parent office_calendar_events%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME IN('office_relays','office_calendar_events') THEN kind_value:=CASE WHEN TG_TABLE_NAME='office_relays' THEN 'relay' ELSE 'event' END;INSERT INTO _dg_native_office_source_guards VALUES(kind_value,NEW.id,NEW.tenant_id,NEW.workspace_id,CASE WHEN kind_value='relay' THEN to_jsonb(NEW)->>'sender_user_id' ELSE to_jsonb(NEW)->>'organizer_user_id' END,NULL,dg_utc_now());
 ELSIF TG_TABLE_NAME='office_notifications' THEN INSERT INTO _dg_native_office_notice_guards VALUES(NEW.id,NULL,dg_utc_now());
 ELSE SELECT * INTO parent FROM office_calendar_events WHERE id=NEW.event_id;INSERT INTO _dg_native_office_attendee_guards VALUES(parent.id,parent.revision,NEW.user_id,NULL,dg_utc_now()) ON CONFLICT(event_id,revision,user_id) DO NOTHING;END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_office_relay_registration AFTER INSERT ON office_relays FOR EACH ROW EXECUTE FUNCTION dg_native_office_register_guard();
CREATE TRIGGER native_office_event_registration AFTER INSERT ON office_calendar_events FOR EACH ROW EXECUTE FUNCTION dg_native_office_register_guard();
CREATE TRIGGER native_office_notice_registration AFTER INSERT ON office_notifications FOR EACH ROW EXECUTE FUNCTION dg_native_office_register_guard();
CREATE TRIGGER native_office_attendee_registration AFTER INSERT ON office_event_attendees FOR EACH ROW EXECUTE FUNCTION dg_native_office_register_guard();
CREATE FUNCTION dg_native_office_attendee_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE event_value office_calendar_events%ROWTYPE;actor text:=current_setting('digitalguide.actor_id',true);row_value jsonb:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;api_name text;
BEGIN
 SELECT app_role INTO api_name FROM _dg_native_runtime_control WHERE id=1;SELECT * INTO event_value FROM office_calendar_events WHERE id=row_value->>'event_id';
 IF event_value.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Meeting participant requires its parent';END IF;
 IF current_user=api_name THEN IF TG_OP='UPDATE' OR event_value.organizer_user_id IS DISTINCT FROM actor OR NOT dg_native_office_member(actor,event_value.tenant_id,event_value.workspace_id,true) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Only organizer changes the meeting participant scope';END IF;IF TG_OP='INSERT' AND NOT dg_native_office_member(NEW.user_id,event_value.tenant_id,event_value.workspace_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Meeting participant is outside workspace';END IF;
 ELSIF TG_OP='UPDATE' THEN IF NEW.event_id<>OLD.event_id OR NEW.user_id<>OLD.user_id OR NEW.user_id IS DISTINCT FROM actor OR event_value.status<>'scheduled' OR event_value.ends_at<=dg_utc_now() OR NOT dg_native_office_member(actor,event_value.tenant_id,event_value.workspace_id) OR NOT EXISTS(SELECT 1 FROM _dg_native_office_attendee_guards WHERE event_id=event_value.id AND revision=event_value.revision AND user_id=actor AND invalidated_at IS NULL) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Meeting response is private to the current participant';END IF;END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;$dg$;
CREATE TRIGGER native_office_attendee_guard BEFORE INSERT OR UPDATE OR DELETE ON office_event_attendees FOR EACH ROW EXECUTE FUNCTION dg_native_office_attendee_guard();

CREATE FUNCTION dg_native_office_notice_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE api_name text;current_app text;g _dg_native_office_source_guards%ROWTYPE;r office_relays%ROWTYPE;e office_calendar_events%ROWTYPE;actor text:=current_setting('digitalguide.actor_id',true);mutable text[];
BEGIN
 SELECT app_role,app_env INTO api_name,current_app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only';SELECT * INTO g FROM _dg_native_office_source_guards WHERE source_kind=NEW.source_kind AND source_id=NEW.source_id;
 IF g.source_id IS NULL OR NEW.tenant_id<>g.tenant_id OR NEW.workspace_id<>g.workspace_id OR NEW.environment<>'mock' OR NEW.app_env<>current_app THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Office notice must share its source scope';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'pending' OR NEW.dispatch_status<>'queued' OR NEW.version<>1 OR NEW.attempts<>0 OR NEW.remote_id IS NOT NULL OR NEW.error_code IS NOT NULL OR NEW.read_at IS NOT NULL OR NEW.acknowledged_at IS NOT NULL OR g.invalidated_at IS NOT NULL OR NOT dg_native_office_member(NEW.recipient_user_id,g.tenant_id,g.workspace_id) OR(current_user=api_name AND(g.actor_id IS DISTINCT FROM actor OR NOT dg_native_office_member(actor,g.tenant_id,g.workspace_id,true))) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Office notice starts from its confirmed source without forged delivery';END IF;
  IF NEW.source_kind='relay' THEN SELECT * INTO r FROM office_relays WHERE id=NEW.source_id;IF r.status<>'scheduled' OR r.revision<>NEW.source_revision OR r.recipient_user_id<>NEW.recipient_user_id OR r.expires_at<>NEW.expires_at OR r.scheduled_at<>NEW.due_at OR r.channel<>NEW.channel OR r.scenario<>NEW.scenario OR NEW.kind<>'relay' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Relay notice differs from the confirmed source';END IF;
  ELSE SELECT * INTO e FROM office_calendar_events WHERE id=NEW.source_id;IF e.revision<>NEW.source_revision OR e.expires_at<>NEW.expires_at OR e.channel<>NEW.channel OR NEW.scenario<>'normal' OR NEW.kind='relay' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Meeting notice differs from the confirmed revision';END IF;
   IF NEW.kind='removed' THEN IF EXISTS(SELECT 1 FROM office_event_attendees WHERE event_id=e.id AND user_id=NEW.recipient_user_id) OR NOT EXISTS(SELECT 1 FROM _dg_native_office_source_revisions s WHERE s.source_kind='event' AND s.source_id=e.id AND s.revision=e.revision-1 AND s.recipient_ids::jsonb ? NEW.recipient_user_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Removed notice is only for a previous participant';END IF;
   ELSIF NOT EXISTS(SELECT 1 FROM office_event_attendees WHERE event_id=e.id AND user_id=NEW.recipient_user_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Meeting notice needs a current participant';END IF;
   IF NEW.kind='reminder' AND NEW.due_at::timestamptz<>e.starts_at::timestamptz-make_interval(mins=>e.reminder_minutes::integer) OR NEW.kind='cancel' AND e.status<>'cancelled' OR NEW.kind IN('invite','update','reminder') AND e.status<>'scheduled' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Meeting notice timing or phase differs';END IF;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM _dg_native_office_source_revisions s WHERE s.source_kind=NEW.source_kind AND s.source_id=NEW.source_id AND s.revision=NEW.source_revision) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Notice needs its confirmed revision receipt';END IF;
 ELSE
  mutable:=ARRAY['status','dispatch_status','version','attempts','lease_token','lease_until','remote_id','error_code','read_at','acknowledged_at','updated_at'];
  IF current_user=api_name OR to_jsonb(NEW)-mutable IS DISTINCT FROM to_jsonb(OLD)-mutable OR NEW.attempts<OLD.attempts OR NEW.attempts>OLD.attempts+1 OR NEW.version NOT BETWEEN OLD.version AND OLD.version+1 OR OLD.status IN('withdrawn','expired') AND NEW.status NOT IN('withdrawn','expired') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Office notice identity, attempts and terminal state are protected';END IF;
  IF NEW.version=OLD.version AND to_jsonb(NEW)-ARRAY['lease_until','updated_at'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['lease_until','updated_at'] THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Only renewal may retain notice version';END IF;
  IF NEW.dispatch_status='submitted_mock' AND NOT EXISTS(SELECT 1 FROM office_mock_submissions s JOIN _dg_native_office_attempts a ON a.notification_id=s.notification_id AND a.request_hash=s.request_hash WHERE s.notification_id=NEW.id AND s.remote_id=NEW.remote_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Submitted mock status needs its actual durable mock receipt';END IF;
 END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_office_notice_guard BEFORE INSERT OR UPDATE ON office_notifications FOR EACH ROW EXECUTE FUNCTION dg_native_office_notice_guard();

CREATE FUNCTION dg_native_office_withdraw_internal(kind_value text,target text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 UPDATE office_notifications SET status='withdrawn',dispatch_status='withdrawn',lease_token=NULL,lease_until=NULL,version=version+1,updated_at=dg_utc_now() WHERE source_kind=kind_value AND source_id=target AND status NOT IN('withdrawn','expired');
 -- The independent physical lease remains until its adapter actually settles.
END;$dg$;
CREATE FUNCTION dg_native_office_withdraw(kind_value text,target text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE g _dg_native_office_source_guards%ROWTYPE;actor text:=current_setting('digitalguide.actor_id',true);
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user=app_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Office withdrawal is an authenticated source action';END IF;
 SELECT * INTO g FROM _dg_native_office_source_guards WHERE source_kind=kind_value AND source_id=target;
 IF g.source_id IS NULL OR g.actor_id IS DISTINCT FROM actor OR NOT dg_native_office_member(actor,g.tenant_id,g.workspace_id,true) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Office source is not owned by this actor';END IF;PERFORM dg_native_office_withdraw_internal(kind_value,target);
END;$dg$;
CREATE FUNCTION dg_native_office_sweep() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE current_app text;r office_relays%ROWTYPE;e office_calendar_events%ROWTYPE;time_value text:=dg_utc_now();
BEGIN
 SELECT app_env INTO current_app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user IN(app_role,worker_role);IF current_app IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Office retention requires the native runtime';END IF;
 FOR r IN SELECT * FROM office_relays WHERE environment='mock' AND app_env=current_app AND expires_at<=time_value AND status<>'expired' ORDER BY id FOR UPDATE SKIP LOCKED LOOP
  PERFORM dg_native_office_withdraw_internal('relay',r.id);UPDATE office_relays SET status='expired',subject='口信已到期',body='',version=version+1,revision=revision+1,updated_at=time_value WHERE id=r.id;PERFORM dg_native_office_insert_revision('relay',r.id);
 END LOOP;
 FOR e IN SELECT * FROM office_calendar_events WHERE environment='mock' AND app_env=current_app AND(expires_at<=time_value AND status<>'expired' OR ends_at<=time_value AND status='scheduled') ORDER BY id FOR UPDATE SKIP LOCKED LOOP
  PERFORM dg_native_office_withdraw_internal('event',e.id);
  IF e.expires_at<=time_value THEN UPDATE office_calendar_events SET status='expired',title='会议记录已到期',description='',location='',version=version+1,revision=revision+1,updated_at=time_value WHERE id=e.id;PERFORM dg_native_office_insert_revision('event',e.id);
  ELSE UPDATE office_calendar_events SET status='completed',version=version+1,updated_at=time_value WHERE id=e.id;END IF;
 END LOOP;
 UPDATE office_notifications SET status='expired',dispatch_status='withdrawn',lease_token=NULL,lease_until=NULL,version=version+1,updated_at=time_value WHERE environment='mock' AND app_env=current_app AND expires_at<=time_value AND status<>'expired';
END;$dg$;
CREATE FUNCTION dg_native_office_control(target text,expected_version bigint,action_value text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE n office_notifications%ROWTYPE;actor text:=current_setting('digitalguide.actor_id',true);next_status text;time_value text:=dg_utc_now();
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user=app_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Office recipient control requires native API';END IF;
 PERFORM user_id FROM dg_native_locked_membership(actor);SELECT * INTO n FROM office_notifications WHERE id=target AND recipient_user_id=actor;
 IF n.id IS NULL OR NOT dg_native_office_member(actor,n.tenant_id,n.workspace_id) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only recipient controls this notice';END IF;
 IF n.source_kind='relay' THEN PERFORM id FROM office_relays WHERE id=n.source_id FOR SHARE;ELSE PERFORM id FROM office_calendar_events WHERE id=n.source_id FOR SHARE;END IF;
 SELECT * INTO n FROM office_notifications WHERE id=target FOR UPDATE;
 IF n.version<>expected_version OR n.status NOT IN('unread','read','acknowledged') OR action_value NOT IN('read','acknowledge') OR dg_native_office_private_source(n.id) IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Office notice version or current content changed';END IF;
 next_status:=CASE WHEN action_value='acknowledge' OR n.status='acknowledged' THEN 'acknowledged' ELSE 'read' END;
 UPDATE office_notifications SET status=next_status,read_at=coalesce(read_at,time_value),acknowledged_at=CASE WHEN next_status='acknowledged' THEN coalesce(acknowledged_at,time_value) ELSE acknowledged_at END,version=version+1,updated_at=time_value WHERE id=n.id;
END;$dg$;
CREATE FUNCTION dg_native_office_respond(target text,expected_version bigint,response_value text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE e office_calendar_events%ROWTYPE;actor text:=current_setting('digitalguide.actor_id',true);
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user=app_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Meeting response requires native API';END IF;
 PERFORM user_id FROM dg_native_locked_membership(actor);SELECT * INTO e FROM office_calendar_events WHERE id=target FOR UPDATE;
 IF e.id IS NULL OR e.status<>'scheduled' OR e.ends_at<=dg_utc_now() OR e.version<>expected_version OR response_value NOT IN('accepted','declined') OR NOT dg_native_office_member(actor,e.tenant_id,e.workspace_id) OR NOT EXISTS(SELECT 1 FROM office_event_attendees a JOIN _dg_native_office_attendee_guards g ON g.event_id=a.event_id AND g.user_id=a.user_id AND g.revision=e.revision WHERE a.event_id=e.id AND a.user_id=actor AND g.invalidated_at IS NULL) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Only current participant responds to reviewed meeting version';END IF;
 UPDATE office_event_attendees SET response=response_value,response_at=dg_utc_now() WHERE event_id=e.id AND user_id=actor;UPDATE office_calendar_events SET version=version+1,updated_at=dg_utc_now() WHERE id=e.id;
END;$dg$;

CREATE FUNCTION dg_native_office_guard_monotonic() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
 IF OLD.invalidated_at IS NOT NULL OR NEW.invalidated_at IS NULL OR to_jsonb(NEW)-'invalidated_at' IS DISTINCT FROM to_jsonb(OLD)-'invalidated_at' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Office permission withdrawal is permanent';END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_office_source_invalidation_guard BEFORE UPDATE ON _dg_native_office_source_guards FOR EACH ROW EXECUTE FUNCTION dg_native_office_guard_monotonic();
CREATE TRIGGER native_office_notice_invalidation_guard BEFORE UPDATE ON _dg_native_office_notice_guards FOR EACH ROW EXECUTE FUNCTION dg_native_office_guard_monotonic();
CREATE TRIGGER native_office_attendee_invalidation_guard BEFORE UPDATE ON _dg_native_office_attendee_guards FOR EACH ROW EXECUTE FUNCTION dg_native_office_guard_monotonic();
CREATE FUNCTION dg_native_office_member_invalidate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE g _dg_native_office_source_guards%ROWTYPE;who text:=OLD.user_id;time_value text:=dg_utc_now();
BEGIN
 IF TG_OP='UPDATE' AND NEW.tenant_id=OLD.tenant_id AND NEW.role=OLD.role AND NEW.workspace_ids=OLD.workspace_ids THEN RETURN NEW;END IF;
 FOR g IN UPDATE _dg_native_office_source_guards s SET invalidated_at=time_value WHERE s.actor_id=who AND s.invalidated_at IS NULL AND NOT dg_native_office_member(who,s.tenant_id,s.workspace_id,true) RETURNING s.* LOOP
  PERFORM dg_native_office_withdraw_internal(g.source_kind,g.source_id);
  IF g.source_kind='relay' THEN
   UPDATE office_relays SET status='cancelled',subject='口信来源已失效',body='',revision=revision+1,version=version+1,updated_at=time_value WHERE id=g.source_id AND status<>'expired';
  ELSE
   UPDATE office_calendar_events SET status=CASE WHEN status='scheduled' THEN 'cancelled' ELSE status END,title='会议来源已失效',description='',location='',revision=revision+1,version=version+1,updated_at=time_value WHERE id=g.source_id AND status<>'expired';
  END IF;PERFORM dg_native_office_insert_revision(g.source_kind,g.source_id);
 END LOOP;
 UPDATE _dg_native_office_notice_guards ng SET invalidated_at=time_value FROM office_notifications n WHERE n.id=ng.notification_id AND n.recipient_user_id=who AND ng.invalidated_at IS NULL AND NOT dg_native_office_member(who,n.tenant_id,n.workspace_id);
 UPDATE office_notifications n SET status='withdrawn',dispatch_status='withdrawn',lease_token=NULL,lease_until=NULL,version=version+1,updated_at=time_value FROM _dg_native_office_notice_guards ng WHERE ng.notification_id=n.id AND ng.invalidated_at IS NOT NULL AND n.recipient_user_id=who AND n.status NOT IN('withdrawn','expired');
 UPDATE _dg_native_office_attendee_guards a SET invalidated_at=time_value FROM office_calendar_events e WHERE e.id=a.event_id AND a.user_id=who AND a.invalidated_at IS NULL AND NOT dg_native_office_member(who,e.tenant_id,e.workspace_id);
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;$dg$;
CREATE TRIGGER native_office_member_invalidation AFTER UPDATE OR DELETE ON memberships FOR EACH ROW EXECUTE FUNCTION dg_native_office_member_invalidate();

CREATE FUNCTION dg_native_office_final_binding() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE v jsonb:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;kind_value text;target text;payload jsonb;g _dg_native_office_source_guards%ROWTYPE;r office_relays%ROWTYPE;e office_calendar_events%ROWTYPE;expected_kind text;
BEGIN
 IF TG_TABLE_NAME='office_relays' THEN kind_value:='relay';target:=v->>'id';ELSIF TG_TABLE_NAME='office_calendar_events' THEN kind_value:='event';target:=v->>'id';ELSIF TG_TABLE_NAME='office_event_attendees' OR TG_TABLE_NAME='_dg_native_office_attendee_guards' THEN kind_value:='event';target:=v->>'event_id';ELSE kind_value:=v->>'source_kind';target:=v->>'source_id';END IF;
 payload:=dg_native_office_payload(kind_value,target);SELECT * INTO g FROM _dg_native_office_source_guards WHERE source_kind=kind_value AND source_id=target;
 IF payload IS NULL OR g.source_id IS NULL OR g.tenant_id<>payload->>'tenant' OR g.workspace_id<>payload->>'workspace' OR g.actor_id IS DISTINCT FROM (CASE WHEN kind_value='relay' THEN payload->>'sender' ELSE payload->>'organizer' END) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Office source and guard commit in the same fixed scope';END IF;
 IF kind_value='relay' THEN
  SELECT * INTO r FROM office_relays WHERE id=target;
  IF r.status='draft' THEN RETURN NULL;END IF;
  IF r.status IN('scheduled','sent') AND NOT EXISTS(SELECT 1 FROM office_notifications n WHERE n.source_kind='relay' AND n.source_id=r.id AND n.source_revision=r.revision AND n.kind='relay' AND n.recipient_user_id=r.recipient_user_id AND n.due_at=r.scheduled_at AND n.expires_at=r.expires_at) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Confirmed relay and local inbox queue commit together';END IF;
 ELSE
  SELECT * INTO e FROM office_calendar_events WHERE id=target;
  IF(SELECT count(*) FROM office_event_attendees WHERE event_id=e.id) NOT BETWEEN 1 AND 20 OR NOT EXISTS(SELECT 1 FROM office_event_attendees WHERE event_id=e.id AND user_id=e.organizer_user_id) OR EXISTS(SELECT 1 FROM office_event_attendees a WHERE a.event_id=e.id AND NOT EXISTS(SELECT 1 FROM _dg_native_office_attendee_guards ag WHERE ag.event_id=e.id AND ag.user_id=a.user_id AND ag.revision=e.revision)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Meeting and all current participant guards commit together';END IF;
  IF e.status='scheduled' AND g.invalidated_at IS NULL THEN
   expected_kind:=CASE WHEN e.revision=1 THEN 'invite' ELSE 'update' END;
   IF EXISTS(SELECT 1 FROM office_event_attendees a WHERE a.event_id=e.id AND(NOT EXISTS(SELECT 1 FROM office_notifications n WHERE n.source_kind='event' AND n.source_id=e.id AND n.source_revision=e.revision AND n.recipient_user_id=a.user_id AND n.kind='reminder') OR a.user_id<>e.organizer_user_id AND NOT EXISTS(SELECT 1 FROM office_notifications n WHERE n.source_kind='event' AND n.source_id=e.id AND n.source_revision=e.revision AND n.recipient_user_id=a.user_id AND n.kind=expected_kind))) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Meeting revision and complete invitation/reminder queue commit together';END IF;
  END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM _dg_native_office_source_revisions s WHERE s.source_kind=kind_value AND s.source_id=target AND s.revision=(payload->>'revision')::bigint AND s.payload_hash=dg_native_office_hash(payload) AND s.recipient_ids::jsonb=CASE WHEN kind_value='relay' THEN jsonb_build_array(payload->>'recipient') ELSE payload->'recipients' END) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Office source requires its exact private-content digest receipt at commit';END IF;RETURN NULL;
END;$dg$;
CREATE CONSTRAINT TRIGGER native_office_relay_final AFTER INSERT OR UPDATE ON office_relays DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_office_final_binding();
CREATE CONSTRAINT TRIGGER native_office_event_final AFTER INSERT OR UPDATE ON office_calendar_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_office_final_binding();
CREATE CONSTRAINT TRIGGER native_office_attendee_final AFTER INSERT OR UPDATE OR DELETE ON office_event_attendees DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_office_final_binding();
CREATE CONSTRAINT TRIGGER native_office_source_revision_final AFTER INSERT ON _dg_native_office_source_revisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_office_final_binding();
CREATE CONSTRAINT TRIGGER native_office_notice_final AFTER INSERT OR UPDATE ON office_notifications DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_office_final_binding();

CREATE INDEX native_office_due ON office_notifications(app_env,due_at,id) WHERE status='pending';
CREATE INDEX native_office_source_expiry ON office_relays(app_env,expires_at) WHERE status<>'expired';
CREATE INDEX native_office_event_expiry ON office_calendar_events(app_env,expires_at,ends_at) WHERE status<>'expired';
CREATE FUNCTION dg_native_office_request(target text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE n office_notifications%ROWTYPE;source_value jsonb:=dg_native_office_private_source(target);
BEGIN
 IF source_value IS NULL THEN RETURN NULL;END IF;SELECT * INTO n FROM office_notifications WHERE id=target;RETURN jsonb_build_object('notificationId',n.id,'recipientId',n.recipient_user_id,'sourceId',n.source_id,'revision',n.source_revision,'kind',n.kind,'title',source_value->>'title','body',source_value->>'body','scenario',n.scenario);
END;$dg$;
CREATE FUNCTION dg_native_office_context(target text,token_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE n office_notifications%ROWTYPE;g _dg_native_office_source_guards%ROWTYPE;a _dg_native_office_attempts%ROWTYPE;request_value jsonb;current_app text;
BEGIN
 SELECT app_env INTO current_app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user=worker_role;IF current_app IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only native Office worker reads leased context';END IF;
 SELECT * INTO n FROM office_notifications WHERE id=target AND app_env=current_app;IF n.id IS NULL THEN RETURN NULL;END IF;SELECT * INTO g FROM _dg_native_office_source_guards WHERE source_kind=n.source_kind AND source_id=n.source_id;
 PERFORM user_id FROM dg_native_locked_membership(g.actor_id);PERFORM user_id FROM dg_native_locked_membership(n.recipient_user_id);
 PERFORM pg_advisory_xact_lock_shared(hashtextextended(dg_native_live_answer_canonical(jsonb_build_array('native-asset-workspace',n.tenant_id,n.workspace_id)),0));
 IF n.source_kind='relay' THEN PERFORM id FROM office_relays WHERE id=n.source_id FOR SHARE;ELSE PERFORM id FROM office_calendar_events WHERE id=n.source_id FOR SHARE;END IF;
 SELECT * INTO n FROM office_notifications WHERE id=target FOR SHARE;SELECT * INTO a FROM _dg_native_office_attempts WHERE notification_id=target AND token=token_value;
 IF n.status<>'pending' OR n.dispatch_status<>'submitting' OR n.lease_token IS DISTINCT FROM token_value OR n.lease_until<=dg_utc_now() OR a.notification_id IS NULL OR a.attempt<>n.attempts OR NOT EXISTS(SELECT 1 FROM _dg_native_office_leases l WHERE l.tenant_id=n.tenant_id AND l.notification_id=n.id AND l.token=token_value AND l.lease_until>dg_utc_now()) THEN RETURN NULL;END IF;
 request_value:=dg_native_office_request(target);IF request_value IS NULL OR a.request_hash<>dg_native_office_hash(request_value) THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('row',to_jsonb(n)||jsonb_build_object('recovering',a.recovering=1),'request',CASE WHEN n.channel='mock' THEN request_value ELSE 'null'::jsonb END,'requestHash',a.request_hash);
END;$dg$;
CREATE FUNCTION dg_native_office_claim() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE current_app text;candidate office_notifications%ROWTYPE;n office_notifications%ROWTYPE;g _dg_native_office_source_guards%ROWTYPE;request_value jsonb;digest_value text;new_token text;until_at text;recovering_value bigint;receipt office_mock_submissions%ROWTYPE;terminal_dispatch text;
BEGIN
 SELECT app_env INTO current_app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user=worker_role;IF current_app IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only native Office worker claims due notices';END IF;PERFORM dg_native_office_sweep();
 FOR candidate IN SELECT * FROM office_notifications WHERE environment='mock' AND app_env=current_app AND status='pending' AND due_at<=dg_utc_now() AND(dispatch_status='queued' OR dispatch_status='submitting' AND lease_until<=dg_utc_now()) ORDER BY due_at,id LIMIT 64 LOOP
  IF NOT pg_try_advisory_xact_lock(hashtextextended('native-office-tenant:'||candidate.tenant_id,0)) THEN CONTINUE;END IF;
  IF EXISTS(SELECT 1 FROM _dg_native_office_leases WHERE tenant_id=candidate.tenant_id AND lease_until>dg_utc_now()) OR EXISTS(SELECT 1 FROM office_notifications WHERE tenant_id=candidate.tenant_id AND app_env=current_app AND status='pending' AND dispatch_status='submitting' AND lease_until>dg_utc_now()) THEN CONTINUE;END IF;
  SELECT * INTO g FROM _dg_native_office_source_guards WHERE source_kind=candidate.source_kind AND source_id=candidate.source_id;PERFORM user_id FROM dg_native_locked_membership(g.actor_id);PERFORM user_id FROM dg_native_locked_membership(candidate.recipient_user_id);
  IF candidate.source_kind='relay' THEN PERFORM id FROM office_relays WHERE id=candidate.source_id FOR UPDATE;ELSE PERFORM id FROM office_calendar_events WHERE id=candidate.source_id FOR SHARE;END IF;
  SELECT * INTO n FROM office_notifications WHERE id=candidate.id AND status='pending' AND(dispatch_status='queued' OR dispatch_status='submitting' AND lease_until<=dg_utc_now()) FOR UPDATE SKIP LOCKED;IF n.id IS NULL THEN CONTINUE;END IF;
  request_value:=dg_native_office_request(n.id);DELETE FROM _dg_native_office_leases WHERE tenant_id=n.tenant_id AND lease_until<=dg_utc_now();
  IF request_value IS NULL THEN UPDATE office_notifications SET status='withdrawn',dispatch_status='withdrawn',version=version+1,lease_token=NULL,lease_until=NULL,error_code='OFFICE_SOURCE_UNAVAILABLE',updated_at=dg_utc_now() WHERE id=n.id;CONTINUE;END IF;
  digest_value:=dg_native_office_hash(request_value);
  IF n.attempts>=3 THEN
   SELECT * INTO receipt FROM office_mock_submissions WHERE notification_id=n.id AND request_hash=digest_value;
   terminal_dispatch:=CASE WHEN n.channel='local' THEN 'local' WHEN receipt.notification_id IS NOT NULL THEN 'submitted_mock' ELSE 'unknown' END;
   UPDATE office_notifications SET status='unread',dispatch_status=terminal_dispatch,remote_id=receipt.remote_id,error_code=CASE WHEN terminal_dispatch='unknown' THEN 'DELIVERY_RECOVERY_EXHAUSTED' ELSE NULL END,version=version+1,lease_token=NULL,lease_until=NULL,updated_at=dg_utc_now() WHERE id=n.id;
   IF n.source_kind='relay' THEN UPDATE office_relays SET status='sent',version=version+1,updated_at=dg_utc_now() WHERE id=n.source_id AND status='scheduled' AND revision=n.source_revision;END IF;CONTINUE;
  END IF;
  new_token:=gen_random_uuid()::text;until_at:=to_char((clock_timestamp()+interval '15 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');recovering_value:=CASE WHEN n.attempts>0 THEN 1 ELSE 0 END;
  INSERT INTO _dg_native_office_leases VALUES(n.tenant_id,n.id,new_token,until_at);INSERT INTO _dg_native_office_attempts VALUES(n.id,n.attempts+1,new_token,digest_value,recovering_value,dg_utc_now());
  UPDATE office_notifications SET dispatch_status='submitting',attempts=attempts+1,version=version+1,lease_token=new_token,lease_until=until_at,error_code=NULL,updated_at=dg_utc_now() WHERE id=n.id RETURNING * INTO n;RETURN to_jsonb(n)||jsonb_build_object('recovering',recovering_value=1);
 END LOOP;RETURN NULL;
END;$dg$;
CREATE FUNCTION dg_native_office_hold(target text,token_value text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE tenant_value text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND session_user=worker_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only worker holds Office adapter slots';END IF;SELECT tenant_id INTO tenant_value FROM _dg_native_office_leases WHERE notification_id=target AND token=token_value;IF tenant_value IS NULL THEN RETURN false;END IF;PERFORM pg_advisory_xact_lock(hashtextextended('native-office-tenant:'||tenant_value,0));
 UPDATE _dg_native_office_leases SET lease_until=to_char((clock_timestamp()+interval '15 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') WHERE tenant_id=tenant_value AND notification_id=target AND token=token_value AND lease_until>dg_utc_now();RETURN FOUND;
END;$dg$;
CREATE FUNCTION dg_native_office_renew(target text,token_value text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE until_at text;
BEGIN
 IF dg_native_office_context(target,token_value) IS NULL THEN RETURN false;END IF;until_at:=to_char((clock_timestamp()+interval '15 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');UPDATE office_notifications SET lease_until=until_at,updated_at=dg_utc_now() WHERE id=target AND lease_token=token_value AND dispatch_status='submitting';RETURN FOUND;
END;$dg$;
CREATE FUNCTION dg_native_office_release(target text,token_value text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE tenant_value text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND session_user=worker_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only worker releases its settled Office adapter';END IF;SELECT tenant_id INTO tenant_value FROM _dg_native_office_leases WHERE notification_id=target AND token=token_value;IF tenant_value IS NULL THEN RETURN false;END IF;PERFORM pg_advisory_xact_lock(hashtextextended('native-office-tenant:'||tenant_value,0));DELETE FROM _dg_native_office_leases WHERE tenant_id=tenant_value AND notification_id=target AND token=token_value;RETURN FOUND;
END;$dg$;
CREATE FUNCTION dg_native_office_mock_lookup(target text,token_value text,input_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE context_value jsonb;receipt office_mock_submissions%ROWTYPE;
BEGIN
 context_value:=dg_native_office_context(target,token_value);IF context_value IS NULL OR context_value->>'requestHash'<>input_hash OR context_value->'row'->>'channel'<>'mock' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Office mock lookup scope changed';END IF;
 SELECT * INTO receipt FROM office_mock_submissions WHERE notification_id=target;IF receipt.notification_id IS NULL THEN RETURN NULL;END IF;IF receipt.request_hash<>input_hash THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Office mock receipt input differs';END IF;RETURN jsonb_build_object('remoteId',receipt.remote_id,'status','submitted_mock');
END;$dg$;
CREATE FUNCTION dg_native_office_mock_submit(target text,token_value text,input_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE context_value jsonb;receipt office_mock_submissions%ROWTYPE;
BEGIN
 context_value:=dg_native_office_context(target,token_value);IF context_value IS NULL OR context_value->>'requestHash'<>input_hash OR context_value->'row'->>'channel'<>'mock' OR context_value->'row'->>'scenario'<>'normal' OR context_value->'row'->>'recovering'='true' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Only first current explicit mock submission is allowed';END IF;
 INSERT INTO office_mock_submissions VALUES(target,input_hash,'mock-office:'||target,dg_utc_now()) ON CONFLICT(notification_id) DO NOTHING;SELECT * INTO receipt FROM office_mock_submissions WHERE notification_id=target;
 IF receipt.request_hash<>input_hash OR receipt.remote_id<>'mock-office:'||target THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Office mock receipt cannot be overwritten';END IF;RETURN jsonb_build_object('remoteId',receipt.remote_id,'status','submitted_mock');
END;$dg$;
CREATE FUNCTION dg_native_office_finish(target text,token_value text,dispatch_value text,remote_value text,error_value text,input_hash text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE context_value jsonb;n office_notifications%ROWTYPE;
BEGIN
 context_value:=dg_native_office_context(target,token_value);IF context_value IS NULL OR context_value->>'requestHash'<>input_hash THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Office delivery source or lease changed before completion';END IF;IF context_value->'row'->>'source_kind'='relay' THEN PERFORM id FROM office_relays WHERE id=context_value->'row'->>'source_id' FOR UPDATE;END IF;SELECT * INTO n FROM office_notifications WHERE id=target FOR UPDATE;
 IF dispatch_value NOT IN('local','submitted_mock','failed','unknown') OR(n.channel='local' AND(dispatch_value<>'local' OR remote_value IS NOT NULL OR error_value IS NOT NULL)) OR(n.channel='mock' AND dispatch_value='local') OR dispatch_value='submitted_mock' AND NOT EXISTS(SELECT 1 FROM office_mock_submissions WHERE notification_id=n.id AND request_hash=input_hash AND remote_id=remote_value) OR dispatch_value IN('failed','unknown') AND(remote_value IS NOT NULL OR error_value IS NULL) OR char_length(error_value)>100 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Office delivery outcome lacks its matching local or mock evidence';END IF;
 UPDATE office_notifications SET status='unread',dispatch_status=dispatch_value,remote_id=remote_value,error_code=error_value,lease_token=NULL,lease_until=NULL,version=version+1,updated_at=dg_utc_now() WHERE id=n.id;
 IF n.source_kind='relay' THEN UPDATE office_relays SET status='sent',version=version+1,updated_at=dg_utc_now() WHERE id=n.source_id AND revision=n.source_revision AND status='scheduled';END IF;
END;$dg$;
CREATE FUNCTION dg_native_office_fail(target text,token_value text,error_value text,interrupted boolean) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE n office_notifications%ROWTYPE;context_value jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND session_user=worker_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only Office worker records its delivery failure';END IF;
 SELECT * INTO n FROM office_notifications WHERE id=target;IF n.id IS NULL OR n.lease_token IS DISTINCT FROM token_value OR n.dispatch_status<>'submitting' THEN RETURN false;END IF;context_value:=dg_native_office_context(target,token_value);
 IF context_value IS NULL THEN UPDATE office_notifications SET status='withdrawn',dispatch_status='withdrawn',lease_token=NULL,lease_until=NULL,version=version+1,error_code='OFFICE_SOURCE_UNAVAILABLE',updated_at=dg_utc_now() WHERE id=n.id AND lease_token=token_value;RETURN FOUND;END IF;
 -- An interrupted adapter keeps the original logical deadline. Recovery queries
 -- its durable receipt; it never silently repeats the external-style request.
 UPDATE office_notifications SET error_code=CASE WHEN interrupted THEN 'OFFICE_DELIVERY_INTERRUPTED' ELSE left(error_value,100) END,version=version+1,updated_at=dg_utc_now() WHERE id=n.id AND lease_token=token_value;RETURN FOUND;
END;$dg$;

REVOKE ALL ON FUNCTION dg_native_office_insert_revision(text,text),dg_native_office_withdraw_internal(text,text),dg_native_office_withdraw(text,text),dg_native_office_sweep(),dg_native_office_control(text,bigint,text),dg_native_office_respond(text,bigint,text),dg_native_office_request(text),dg_native_office_context(text,text),dg_native_office_claim(),dg_native_office_hold(text,text),dg_native_office_renew(text,text),dg_native_office_release(text,text),dg_native_office_mock_lookup(text,text,text),dg_native_office_mock_submit(text,text,text),dg_native_office_finish(text,text,text,text,text,text),dg_native_office_fail(text,text,text,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION dg_native_office_hash(jsonb),dg_native_office_member(text,text,text,boolean),dg_native_office_payload(text,text),dg_native_office_record_source(text,text),dg_native_office_private_source(text),dg_native_office_source(text) FROM PUBLIC;
