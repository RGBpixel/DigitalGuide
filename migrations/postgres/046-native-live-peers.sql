-- Native backstage invitations. Programme/recording authorization remains independent.
ALTER TABLE live_peer_invites ADD CONSTRAINT native_peer_invite_shape CHECK(environment='mock' AND app_env IN('development','sandbox') AND version>0 AND length(public_title) BETWEEN 1 AND 80 AND (access_hash IS NULL OR access_hash ~ '^[a-f0-9]{64}$') AND (consumed_access_hash IS NULL OR consumed_access_hash ~ '^[a-f0-9]{64}$'));
ALTER TABLE live_peer_guests ADD CONSTRAINT native_peer_guest_shape CHECK(version>0 AND consent_version BETWEEN 0 AND 5 AND camera IN(0,1) AND microphone IN(0,1) AND length(nickname)<=40 AND join_key_hash ~ '^[a-f0-9]{64}$' AND (cookie_hash IS NULL OR cookie_hash ~ '^[a-f0-9]{64}$'));
ALTER TABLE live_peer_consents ADD CONSTRAINT native_peer_consent_shape CHECK(version BETWEEN 1 AND 5 AND camera IN(0,1) AND microphone IN(0,1) AND camera+microphone>0 AND purpose='backstage_call' AND statement_version='backstage-call-v1');
ALTER TABLE live_peer_attempts ADD CONSTRAINT native_peer_attempt_shape CHECK(version>0 AND consent_version BETWEEN 1 AND 5 AND host_sequence>=0 AND guest_sequence>=0 AND host_received_bytes BETWEEN 0 AND 1000000000000 AND guest_received_bytes BETWEEN 0 AND 1000000000000 AND host_decoded_frames BETWEEN 0 AND 1000000000 AND guest_decoded_frames BETWEEN 0 AND 1000000000 AND host_program_version>=0 AND host_program_ready IN(0,1) AND host_connection IN('new','connecting','connected','disconnected','failed','closed') AND guest_connection IN('new','connecting','connected','disconnected','failed','closed'));
ALTER TABLE live_peer_signals ADD CONSTRAINT native_peer_signal_shape CHECK(sequence BETWEEN 1 AND 96 AND octet_length(payload)<=70000 AND payload_hash=encode(sha256(convert_to(payload,'UTF8')),'hex') AND payload::jsonb->>'kind' IN('description','candidate'));
ALTER TABLE live_peer_limits ADD CONSTRAINT native_peer_limit_shape CHECK(count BETWEEN 1 AND 1000000 AND length(key)=64);

CREATE FUNCTION dg_native_peer_actor_valid(p_actor text,p_tenant text,p_workspace text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT EXISTS(SELECT 1 FROM memberships m JOIN workspaces w ON w.id=p_workspace AND w.tenant_id=m.tenant_id WHERE m.user_id=p_actor AND m.tenant_id=p_tenant AND m.role IN('admin','editor') AND m.workspace_ids::jsonb ? p_workspace)
$dg$;
CREATE FUNCTION dg_native_peer_invite_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s live_sessions%ROWTYPE;
BEGIN
 IF TG_OP='INSERT' THEN
  SELECT * INTO STRICT s FROM live_sessions WHERE id=NEW.session_id;
  PERFORM pg_advisory_xact_lock(hashtextextended('native-peer-tenant:'||NEW.tenant_id,0));
  IF (SELECT count(*) FROM live_peer_invites WHERE session_id=NEW.session_id)>=30 OR (SELECT count(*) FROM live_peer_invites WHERE tenant_id=NEW.tenant_id AND environment=NEW.environment AND app_env=NEW.app_env AND status IN('issued','used') AND expires_at>dg_utc_now())>=50 THEN RAISE EXCEPTION 'Native peer invitation capacity reached';END IF;
  IF (NEW.tenant_id,NEW.workspace_id,NEW.environment,NEW.app_env) IS DISTINCT FROM (s.tenant_id,s.workspace_id,s.environment,s.app_env) OR s.invalidated_at IS NOT NULL OR s.status IN('ended','failed') OR NOT dg_native_peer_actor_valid(NEW.actor_id,NEW.tenant_id,NEW.workspace_id) OR NEW.status<>'issued' OR NEW.version<>1 OR NEW.access_hash IS NULL OR NEW.consumed_access_hash IS NOT NULL OR NEW.expires_at<=dg_utc_now() OR NEW.expires_at::timestamptz>clock_timestamp()+interval '24 hours 1 second' THEN
   RAISE EXCEPTION 'Native peer invitation does not match active actor and session';
  END IF;
 ELSE
  IF (NEW.id,NEW.session_id,NEW.tenant_id,NEW.workspace_id,NEW.actor_id,NEW.public_title,NEW.expires_at,NEW.access_nonce,NEW.environment,NEW.app_env,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.session_id,OLD.tenant_id,OLD.workspace_id,OLD.actor_id,OLD.public_title,OLD.expires_at,OLD.access_nonce,OLD.environment,OLD.app_env,OLD.created_at) OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Native peer invitation identity is immutable'; END IF;
  IF OLD.status NOT IN('issued','used') THEN RAISE EXCEPTION 'Native peer invitation closure is final'; END IF;
  IF NEW.status='used' AND (OLD.status<>'issued' OR NEW.access_hash IS NOT NULL OR NEW.consumed_access_hash IS DISTINCT FROM OLD.access_hash) THEN RAISE EXCEPTION 'Native peer invitation claim is fixed'; END IF;
  IF NEW.status IN('revoked','expired','closed') AND (NEW.access_hash IS NOT NULL OR NEW.consumed_access_hash IS NOT NULL) THEN RAISE EXCEPTION 'Native peer invitation credentials must close'; END IF;
  IF NEW.status NOT IN('used','revoked','expired','closed') THEN RAISE EXCEPTION 'Native peer invitation transition is invalid'; END IF;
 END IF;
 RETURN NEW;
END $dg$;
CREATE TRIGGER native_peer_invite_guard BEFORE INSERT OR UPDATE ON live_peer_invites FOR EACH ROW EXECUTE FUNCTION dg_native_peer_invite_guard();

CREATE FUNCTION dg_native_peer_guest_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE i live_peer_invites%ROWTYPE;c live_peer_consents%ROWTYPE;
BEGIN
 SELECT * INTO STRICT i FROM live_peer_invites WHERE id=NEW.invite_id;
 IF TG_OP='INSERT' THEN
  IF i.status<>'issued' OR i.expires_at<=dg_utc_now() OR NEW.status<>'joined' OR NEW.version<>1 OR NEW.consent_version<>0 OR NEW.camera+NEW.microphone<>0 OR NEW.cookie_hash IS NULL OR NEW.client_id IS NOT NULL THEN RAISE EXCEPTION 'Native peer claim requires an unused invitation'; END IF;
 ELSE
  IF (NEW.id,NEW.invite_id,NEW.join_key_hash,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.invite_id,OLD.join_key_hash,OLD.created_at) OR NEW.version<>OLD.version+1 OR NEW.consent_version NOT BETWEEN OLD.consent_version AND OLD.consent_version+1 OR (NEW.cookie_hash IS DISTINCT FROM OLD.cookie_hash AND NEW.cookie_hash IS NOT NULL) THEN RAISE EXCEPTION 'Native peer guest identity is immutable'; END IF;
  IF OLD.status='withdrawn' THEN RAISE EXCEPTION 'Native peer guest withdrawal is final'; END IF;
  IF NEW.status='withdrawn' THEN
   IF NEW.cookie_hash IS NOT NULL OR NEW.camera+NEW.microphone<>0 OR NEW.client_id IS NOT NULL THEN RAISE EXCEPTION 'Native peer withdrawal must clear devices and credential'; END IF;
  ELSIF NEW.status IN('requested','approved','rejected') THEN
   SELECT * INTO STRICT c FROM live_peer_consents WHERE guest_id=NEW.id AND version=NEW.consent_version;
   IF i.status<>'used' OR i.expires_at<=dg_utc_now() OR c.withdrawn_at IS NOT NULL OR c.expires_at<=dg_utc_now() OR (NEW.camera,NEW.microphone,NEW.client_id,NEW.consent_expires_at) IS DISTINCT FROM (c.camera,c.microphone,c.client_id,c.expires_at) THEN RAISE EXCEPTION 'Native peer device consent does not match'; END IF;
   IF NEW.status='requested' AND NEW.consent_version<>OLD.consent_version+1 OR NEW.status IN('approved','rejected') AND (OLD.status<>'requested' OR NEW.consent_version<>OLD.consent_version) THEN RAISE EXCEPTION 'Native peer approval needs the current request'; END IF;
  ELSIF NEW.status='joined' AND (NEW.camera+NEW.microphone<>0 OR NEW.client_id IS NOT NULL OR NEW.consent_expires_at IS NOT NULL) THEN RAISE EXCEPTION 'Native peer ended call must release devices'; END IF;
 END IF;
 RETURN NEW;
END $dg$;
CREATE TRIGGER native_peer_guest_guard BEFORE INSERT OR UPDATE ON live_peer_guests FOR EACH ROW EXECUTE FUNCTION dg_native_peer_guest_guard();

CREATE FUNCTION dg_native_peer_consent_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE g live_peer_guests%ROWTYPE;i live_peer_invites%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-'withdrawn_at') IS DISTINCT FROM (to_jsonb(OLD)-'withdrawn_at') OR OLD.withdrawn_at IS NOT NULL OR NEW.withdrawn_at IS NULL THEN RAISE EXCEPTION 'Native peer consent is immutable and withdrawal final'; END IF;
 ELSE
  SELECT * INTO STRICT g FROM live_peer_guests WHERE id=NEW.guest_id;SELECT * INTO STRICT i FROM live_peer_invites WHERE id=g.invite_id;
  IF i.status<>'used' OR g.status='withdrawn' OR NEW.version<>g.consent_version+1 OR NEW.expires_at<=dg_utc_now() OR NEW.expires_at>i.expires_at OR NEW.expires_at::timestamptz>clock_timestamp()+interval '1 hour 1 second' OR NEW.withdrawn_at IS NOT NULL THEN RAISE EXCEPTION 'Native peer consent requires a current invitation'; END IF;
 END IF;
 RETURN NEW;
END $dg$;
CREATE TRIGGER native_peer_consent_guard BEFORE INSERT OR UPDATE ON live_peer_consents FOR EACH ROW EXECUTE FUNCTION dg_native_peer_consent_guard();

CREATE FUNCTION dg_native_peer_pair_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE i live_peer_invites%ROWTYPE;g live_peer_guests%ROWTYPE;invitation_ref text;
BEGIN
 IF TG_TABLE_NAME='live_peer_consents' THEN
  SELECT * INTO STRICT g FROM live_peer_guests WHERE id=NEW.guest_id;
  IF NEW.version>g.consent_version THEN RAISE EXCEPTION 'Native peer consent must be paired with the guest request';END IF;RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='live_peer_invites' THEN invitation_ref:=NEW.id;ELSE invitation_ref:=NEW.invite_id;END IF;
 SELECT * INTO STRICT i FROM live_peer_invites WHERE id=invitation_ref;SELECT * INTO g FROM live_peer_guests WHERE invite_id=i.id;
 IF i.status='issued' AND g.id IS NOT NULL OR i.status='used' AND (g.id IS NULL OR g.status='withdrawn' OR g.cookie_hash IS NULL OR i.consumed_access_hash IS NULL) OR i.status IN('closed','revoked','expired') AND g.id IS NOT NULL AND (g.status<>'withdrawn' OR g.cookie_hash IS NOT NULL) THEN RAISE EXCEPTION 'Native peer invitation and browser claim must commit together';END IF;
 RETURN NEW;
END $dg$;
CREATE CONSTRAINT TRIGGER native_peer_invite_pair AFTER INSERT OR UPDATE ON live_peer_invites DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_peer_pair_guard();
CREATE CONSTRAINT TRIGGER native_peer_guest_pair AFTER INSERT OR UPDATE ON live_peer_guests DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_peer_pair_guard();
CREATE CONSTRAINT TRIGGER native_peer_consent_pair AFTER INSERT ON live_peer_consents DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_peer_pair_guard();

CREATE FUNCTION dg_native_peer_attempt_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE i live_peer_invites%ROWTYPE;g live_peer_guests%ROWTYPE;c live_peer_consents%ROWTYPE;n integer;
BEGIN
 IF TG_OP='INSERT' THEN
  SELECT * INTO STRICT i FROM live_peer_invites WHERE id=NEW.invite_id;PERFORM pg_advisory_xact_lock(hashtextextended('native-peer-capacity:'||i.session_id,0));
  SELECT * INTO STRICT g FROM live_peer_guests WHERE id=NEW.guest_id;SELECT * INTO STRICT c FROM live_peer_consents WHERE guest_id=NEW.guest_id AND version=NEW.consent_version;
  SELECT count(*) INTO n FROM live_peer_attempts a JOIN live_peer_invites p ON p.id=a.invite_id WHERE p.session_id=i.session_id AND a.status='active';
  IF (SELECT count(*) FROM live_peer_attempts WHERE guest_id=NEW.guest_id)>=20 THEN RAISE EXCEPTION 'Native peer attempt capacity reached';END IF;
  IF n>=3 OR i.status<>'used' OR i.expires_at<=dg_utc_now() OR g.invite_id<>i.id OR g.status<>'approved' OR g.consent_version<>c.version OR c.withdrawn_at IS NOT NULL OR c.expires_at<=dg_utc_now() OR NEW.guest_client_id<>c.client_id OR NOT dg_native_peer_actor_valid(NEW.host_id,i.tenant_id,i.workspace_id) OR NEW.status<>'active' OR NEW.version<>1 OR NEW.host_sequence<>0 OR NEW.guest_sequence<>0 OR NOT EXISTS(SELECT 1 FROM live_sessions s JOIN live_outputs o ON o.session_id=s.id WHERE s.id=i.session_id AND s.status IN('live','preview') AND s.invalidated_at IS NULL AND o.status='running' AND o.invalidated_at IS NULL AND o.published_frames>0) THEN RAISE EXCEPTION 'Native peer connection requires current approved devices and actual programme'; END IF;
 ELSE
  IF (NEW.id,NEW.invite_id,NEW.guest_id,NEW.consent_version,NEW.host_id,NEW.host_client_id,NEW.guest_client_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.invite_id,OLD.guest_id,OLD.consent_version,OLD.host_id,OLD.host_client_id,OLD.guest_client_id,OLD.created_at) OR OLD.status<>'active' THEN RAISE EXCEPTION 'Native peer attempt identity and closure are immutable'; END IF;
  IF NEW.status='active' AND (NEW.version<>OLD.version OR NEW.host_sequence<OLD.host_sequence OR NEW.guest_sequence<OLD.guest_sequence OR NEW.host_lease_until<OLD.host_lease_until OR NEW.guest_lease_until<OLD.guest_lease_until) OR NEW.status<>'active' AND NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Native peer attempt state cannot move backwards'; END IF;
  IF NEW.host_lease_until IS DISTINCT FROM OLD.host_lease_until AND (NEW.host_sequence<=OLD.host_sequence OR OLD.host_lease_until<=dg_utc_now() OR OLD.guest_lease_until<=dg_utc_now()) OR NEW.guest_lease_until IS DISTINCT FROM OLD.guest_lease_until AND (NEW.guest_sequence<=OLD.guest_sequence OR OLD.host_lease_until<=dg_utc_now() OR OLD.guest_lease_until<=dg_utc_now()) THEN RAISE EXCEPTION 'Native peer expired lease cannot renew'; END IF;
 END IF;
 IF NEW.host_lease_until::timestamptz>clock_timestamp()+interval '16 seconds' OR NEW.guest_lease_until::timestamptz>clock_timestamp()+interval '16 seconds' THEN RAISE EXCEPTION 'Native peer leases are bounded'; END IF;
 RETURN NEW;
END $dg$;
CREATE TRIGGER native_peer_attempt_guard BEFORE INSERT OR UPDATE ON live_peer_attempts FOR EACH ROW EXECUTE FUNCTION dg_native_peer_attempt_guard();

CREATE FUNCTION dg_native_peer_signal_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE a live_peer_attempts%ROWTYPE;n bigint;own_description boolean;host_description boolean;v jsonb;
BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Native peer signals are immutable'; END IF;
 SELECT * INTO STRICT a FROM live_peer_attempts WHERE id=NEW.attempt_id FOR UPDATE;v:=NEW.payload::jsonb;
 SELECT coalesce(max(sequence),0),coalesce(bool_or(payload::jsonb->>'kind'='description'),false) INTO n,own_description FROM live_peer_signals WHERE attempt_id=a.id AND direction=NEW.direction;
 SELECT EXISTS(SELECT 1 FROM live_peer_signals WHERE attempt_id=a.id AND direction='host' AND payload::jsonb->>'kind'='description') INTO host_description;
 IF a.status<>'active' OR a.host_lease_until<=dg_utc_now() OR a.guest_lease_until<=dg_utc_now() OR NEW.sequence<>n+1 OR v->>'kind'='description' AND (own_description OR v->>'type'<>CASE WHEN NEW.direction='host' THEN 'offer' ELSE 'answer' END OR NEW.direction='guest' AND NOT host_description OR length(v->>'sdp') NOT BETWEEN 1 AND 65536) OR v->>'kind'='candidate' AND NOT own_description THEN RAISE EXCEPTION 'Native peer signaling sequence or media generation is invalid'; END IF;
 RETURN NEW;
END $dg$;
CREATE TRIGGER native_peer_signal_guard BEFORE INSERT OR UPDATE ON live_peer_signals FOR EACH ROW EXECUTE FUNCTION dg_native_peer_signal_guard();

CREATE FUNCTION dg_native_peer_invite_cleanup() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NEW.status IN('revoked','expired','closed') AND OLD.status IN('issued','used') THEN
  UPDATE live_peer_guests SET nickname='已结束来宾',status='withdrawn',cookie_hash=NULL,camera=0,microphone=0,client_id=NULL,consent_expires_at=NULL,version=version+1,updated_at=dg_utc_now() WHERE invite_id=NEW.id AND status<>'withdrawn';
  UPDATE live_peer_consents SET withdrawn_at=dg_utc_now() WHERE withdrawn_at IS NULL AND guest_id IN(SELECT id FROM live_peer_guests WHERE invite_id=NEW.id);
  UPDATE live_peer_attempts SET status='ended',version=version+1,reason=NEW.reason,updated_at=dg_utc_now() WHERE invite_id=NEW.id AND status='active';
  DELETE FROM live_peer_signals WHERE attempt_id IN(SELECT id FROM live_peer_attempts WHERE invite_id=NEW.id);
 END IF;RETURN NEW;
END $dg$;
CREATE TRIGGER native_peer_invite_cleanup AFTER UPDATE ON live_peer_invites FOR EACH ROW EXECUTE FUNCTION dg_native_peer_invite_cleanup();
CREATE FUNCTION dg_native_peer_lifecycle() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF TG_TABLE_NAME='live_sessions' THEN
  IF NEW.status IN('ended','failed') OR NEW.invalidated_at IS NOT NULL THEN UPDATE live_peer_invites SET status='closed',access_hash=NULL,consumed_access_hash=NULL,reason='节目已经结束或来源失效',version=version+1,updated_at=dg_utc_now() WHERE session_id=NEW.id AND status IN('issued','used');END IF;
 ELSIF TG_TABLE_NAME='live_outputs' THEN
  IF NEW.status IN('completed','failed','withdrawn','cancelled') OR NEW.invalidated_at IS NOT NULL THEN UPDATE live_peer_invites SET status='closed',access_hash=NULL,consumed_access_hash=NULL,reason='连续节目媒体已经结束或失效',version=version+1,updated_at=dg_utc_now() WHERE session_id=NEW.session_id AND status IN('issued','used');END IF;
 ELSE
  IF TG_OP='DELETE' OR (NEW.tenant_id,NEW.role,NEW.workspace_ids) IS DISTINCT FROM (OLD.tenant_id,OLD.role,OLD.workspace_ids) THEN
   UPDATE live_peer_invites SET status='revoked',access_hash=NULL,consumed_access_hash=NULL,reason='邀请人的组织或权限已经变化',version=version+1,updated_at=dg_utc_now() WHERE actor_id=OLD.user_id AND status IN('issued','used');
   UPDATE live_peer_attempts SET status='ended',version=version+1,reason='主持人的组织或权限已经变化',updated_at=dg_utc_now() WHERE host_id=OLD.user_id AND status='active';
   DELETE FROM live_peer_signals WHERE attempt_id IN(SELECT id FROM live_peer_attempts WHERE host_id=OLD.user_id AND status<>'active');
  END IF;
 END IF;IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $dg$;
CREATE TRIGGER native_peer_session_lifecycle AFTER UPDATE OF status,invalidated_at ON live_sessions FOR EACH ROW EXECUTE FUNCTION dg_native_peer_lifecycle();
CREATE TRIGGER native_peer_output_lifecycle AFTER UPDATE OF status,invalidated_at ON live_outputs FOR EACH ROW EXECUTE FUNCTION dg_native_peer_lifecycle();
CREATE TRIGGER native_peer_member_lifecycle AFTER UPDATE OR DELETE ON memberships FOR EACH ROW EXECUTE FUNCTION dg_native_peer_lifecycle();

CREATE FUNCTION dg_native_peer_sweep() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE i live_peer_invites%ROWTYPE;a live_peer_attempts%ROWTYPE;g live_peer_guests%ROWTYPE;n integer:=0;
BEGIN
 FOR i IN SELECT * FROM live_peer_invites WHERE status IN('issued','used') ORDER BY id LIMIT 500 FOR UPDATE SKIP LOCKED LOOP
  IF i.expires_at<=dg_utc_now() OR NOT dg_native_peer_actor_valid(i.actor_id,i.tenant_id,i.workspace_id) THEN
   UPDATE live_peer_invites SET status=CASE WHEN expires_at<=dg_utc_now() THEN 'expired' ELSE 'revoked' END,access_hash=NULL,consumed_access_hash=NULL,reason='邀请到期或主持权限失效',version=version+1,updated_at=dg_utc_now() WHERE id=i.id AND status IN('issued','used');n:=n+1;
  END IF;
 END LOOP;
 FOR a IN SELECT p.* FROM live_peer_attempts p JOIN live_peer_guests x ON x.id=p.guest_id JOIN live_peer_invites y ON y.id=p.invite_id WHERE p.status='active' AND (p.host_lease_until<=dg_utc_now() OR p.guest_lease_until<=dg_utc_now() OR x.consent_expires_at<=dg_utc_now() OR x.status<>'approved' OR x.consent_version<>p.consent_version OR NOT dg_native_peer_actor_valid(p.host_id,y.tenant_id,y.workspace_id)) ORDER BY p.id LIMIT 500 FOR UPDATE OF p SKIP LOCKED LOOP
  UPDATE live_peer_attempts SET status='expired',version=version+1,reason='心跳或设备授权到期，请重新确认连接',updated_at=dg_utc_now() WHERE id=a.id AND status='active';
  UPDATE live_peer_consents SET withdrawn_at=dg_utc_now() WHERE guest_id=a.guest_id AND version=a.consent_version AND withdrawn_at IS NULL;
  UPDATE live_peer_guests SET status='joined',camera=0,microphone=0,client_id=NULL,consent_expires_at=NULL,version=version+1,updated_at=dg_utc_now() WHERE id=a.guest_id AND consent_version=a.consent_version AND status='approved';
  DELETE FROM live_peer_signals WHERE attempt_id=a.id;n:=n+1;
 END LOOP;
 FOR g IN SELECT * FROM live_peer_guests WHERE status IN('requested','approved','rejected') AND consent_expires_at<=dg_utc_now() ORDER BY id LIMIT 500 FOR UPDATE SKIP LOCKED LOOP
  UPDATE live_peer_consents SET withdrawn_at=dg_utc_now() WHERE guest_id=g.id AND withdrawn_at IS NULL;
  UPDATE live_peer_guests SET status='joined',camera=0,microphone=0,client_id=NULL,consent_expires_at=NULL,version=version+1,updated_at=dg_utc_now() WHERE id=g.id;n:=n+1;
 END LOOP;
 DELETE FROM live_peer_limits WHERE window_at::timestamptz<=clock_timestamp()-interval '1 hour';RETURN n;
END $dg$;
REVOKE ALL ON FUNCTION dg_native_peer_actor_valid(text,text,text),dg_native_peer_invite_guard(),dg_native_peer_guest_guard(),dg_native_peer_consent_guard(),dg_native_peer_pair_guard(),dg_native_peer_attempt_guard(),dg_native_peer_signal_guard(),dg_native_peer_invite_cleanup(),dg_native_peer_lifecycle(),dg_native_peer_sweep() FROM PUBLIC;
