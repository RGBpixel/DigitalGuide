-- R-058/R-093/R-095/R-096/R-097/R-098. Fresh native validation schemas only.
CREATE TABLE _dg_native_live_inputs(session_id text PRIMARY KEY REFERENCES live_sessions(id),snapshot text NOT NULL,snapshot_hash text NOT NULL CHECK(snapshot_hash=encode(sha256(convert_to(snapshot,'UTF8')),'hex')),created_at text NOT NULL);
CREATE TABLE _dg_native_live_target_receipts(target_id text NOT NULL REFERENCES live_destinations(id),operation_id text NOT NULL,kind text NOT NULL CHECK(kind IN('connect','lookup')),request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),receipt text NOT NULL,receipt_hash text NOT NULL CHECK(receipt_hash=encode(sha256(convert_to(receipt,'UTF8')),'hex')),created_at text NOT NULL,PRIMARY KEY(target_id,operation_id,kind),CHECK(receipt::jsonb->>'operationId'=operation_id AND receipt::jsonb->>'simulated'='true' AND receipt::jsonb->>'remotePlaybackVerified'='false'));
CREATE TRIGGER native_live_input_immutable BEFORE UPDATE OR DELETE ON _dg_native_live_inputs FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_live_receipt_immutable BEFORE UPDATE OR DELETE ON _dg_native_live_target_receipts FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_live_program_version_immutable BEFORE UPDATE OR DELETE ON live_program_versions FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_live_segment_immutable BEFORE UPDATE OR DELETE ON live_segments FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
ALTER TABLE live_programs ADD CONSTRAINT native_live_program_shape CHECK(environment='mock' AND app_env IN('development','sandbox') AND version BETWEEN 1 AND 200 AND definition_hash=encode(sha256(convert_to(definition,'UTF8')),'hex'));
ALTER TABLE live_program_versions ADD CONSTRAINT native_live_version_shape CHECK(version BETWEEN 1 AND 200 AND definition_hash=encode(sha256(convert_to(definition,'UTF8')),'hex'));
ALTER TABLE live_segments ADD CONSTRAINT native_live_segment_shape CHECK(seq BETWEEN 0 AND 599 AND segment_hash=encode(sha256(convert_to(segment,'UTF8')),'hex'));
ALTER TABLE live_sessions ADD COLUMN invalidated_at text;
ALTER TABLE live_sessions ADD COLUMN invalidation_reason text;
ALTER TABLE live_sessions ADD CONSTRAINT native_live_session_shape CHECK(environment='mock' AND app_env IN('development','sandbox') AND version>0 AND program_version>0 AND snapshot_hash=encode(sha256(convert_to(snapshot,'UTF8')),'hex') AND state_hash=encode(sha256(convert_to(state,'UTF8')),'hex') AND snapshot::jsonb->>'pipeline'='native-live-v1' AND (state::jsonb->>'epoch')::bigint>0 AND (state::jsonb->>'elapsedMs')::bigint BETWEEN 0 AND 1800000 AND (state::jsonb->>'offsetMs')::bigint>=0);
ALTER TABLE live_destinations ADD CONSTRAINT native_live_target_shape CHECK(version>0 AND attempts BETWEEN 0 AND 3 AND status IN('idle','connecting','connected','disconnected','failed','unknown','stopped') AND (remote_id IS NULL OR remote_id LIKE 'mock-stream:%') AND (status NOT IN('connecting','connected','failed','unknown','disconnected') OR operation_id IS NOT NULL));
ALTER TABLE live_audience_events ADD CONSTRAINT native_live_audience_shape CHECK(version>0 AND priority BETWEEN 0 AND 2 AND status IN('received','queued','rejected','authorized_simulation','ready','playing','answered','cancelled') AND kind IN('comment','question','join_request') AND media_opt_in IN('none','audio','video') AND (answer_kind IS NULL OR answer_kind IN('manual','product')) AND citations='[]' AND input_hash ~ '^[a-f0-9]{64}$' AND participant_hash ~ '^[a-f0-9]{64}$');
ALTER TABLE live_commands ADD CONSTRAINT native_live_command_shape CHECK(epoch>0 AND session_version>0 AND status IN('pending','applied','superseded') AND (status<>'applied' OR simulator_applied_at IS NOT NULL OR media_applied_at IS NOT NULL));
CREATE FUNCTION dg_native_live_program_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native live program history cannot be deleted';END IF;
 IF TG_OP='INSERT' THEN IF NEW.version<>1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Program starts at version one';END IF;
 ELSE IF to_jsonb(NEW)-ARRAY['name','definition','definition_hash','version','updated_at'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['name','definition','definition_hash','version','updated_at'] OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native live program identity and version are fixed';END IF;END IF;
 RETURN NEW;
END $dg$;
CREATE TRIGGER native_live_program_guard BEFORE INSERT OR UPDATE OR DELETE ON live_programs FOR EACH ROW EXECUTE FUNCTION dg_native_live_program_guard();
CREATE FUNCTION dg_native_live_session_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native live session cannot be deleted';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.version<>1 OR NEW.status NOT IN('ready','scheduled') OR NEW.started_at IS NOT NULL OR NEW.ended_at IS NOT NULL OR NEW.invalidated_at IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native session starts from a fixed ready or scheduled snapshot';END IF;
 ELSE
  IF to_jsonb(NEW)-ARRAY['status','state','state_hash','version','started_at','ended_at','error_message','invalidated_at','invalidation_reason','updated_at'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['status','state','state_hash','version','started_at','ended_at','error_message','invalidated_at','invalidation_reason','updated_at'] OR NEW.version<OLD.version OR NEW.version>OLD.version+1 OR(OLD.invalidated_at IS NOT NULL AND (NEW.invalidated_at,NEW.invalidation_reason) IS DISTINCT FROM (OLD.invalidated_at,OLD.invalidation_reason)) OR(NEW.status<>OLD.status AND NOT((OLD.status IN('ready','scheduled') AND NEW.status IN('preview','live','ended','failed')) OR(OLD.status IN('preview','live') AND NEW.status IN('ended','failed')))) OR(OLD.started_at IS NOT NULL AND NEW.started_at IS DISTINCT FROM OLD.started_at) OR(OLD.ended_at IS NOT NULL AND NEW.ended_at IS DISTINCT FROM OLD.ended_at) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native live fixed input, invalidation and terminal state are immutable';END IF;
 END IF;
 RETURN NEW;
END $dg$;
CREATE TRIGGER native_live_session_guard BEFORE INSERT OR UPDATE OR DELETE ON live_sessions FOR EACH ROW EXECUTE FUNCTION dg_native_live_session_guard();
CREATE FUNCTION dg_native_live_discussion_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native live event cannot be deleted';END IF;
 IF TG_OP='INSERT' THEN IF NEW.status<>'received' OR NEW.version<>1 OR NEW.answer IS NOT NULL OR NEW.answer_kind IS NOT NULL OR NEW.prepared_epoch IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Live event must start from a received input';END IF;
 ELSE
  IF to_jsonb(NEW)-ARRAY['status','priority','version','answer','answer_kind','citations','product_id','prepared_epoch'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['status','priority','version','answer','answer_kind','citations','product_id','prepared_epoch'] OR NEW.version<>OLD.version+1 OR(OLD.answer IS NOT NULL AND (NEW.answer,NEW.answer_kind,NEW.citations,NEW.product_id,NEW.prepared_epoch) IS DISTINCT FROM (OLD.answer,OLD.answer_kind,OLD.citations,OLD.product_id,OLD.prepared_epoch)) OR(NEW.status<>OLD.status AND NOT((OLD.status IN('received','queued') AND NEW.status IN('queued','rejected','authorized_simulation','ready')) OR(OLD.status='ready' AND NEW.status IN('playing','cancelled')) OR(OLD.status='playing' AND NEW.status IN('answered','cancelled')))) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Live event input, confirmed answer and state transition are protected';END IF;
 END IF;
 RETURN NEW;
END $dg$;
CREATE TRIGGER native_live_discussion_guard BEFORE INSERT OR UPDATE OR DELETE ON live_audience_events FOR EACH ROW EXECUTE FUNCTION dg_native_live_discussion_guard();
CREATE FUNCTION dg_native_live_target_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native target cannot be deleted';END IF;
 IF TG_OP='INSERT' THEN IF NEW.status<>'idle' OR NEW.version<>1 OR NEW.attempts<>0 OR NEW.remote_id IS NOT NULL OR NEW.operation_id IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native target starts idle';END IF;
 ELSE IF to_jsonb(NEW)-ARRAY['status','version','attempts','operation_id','remote_id','heartbeat_at','error_message','updated_at'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['status','version','attempts','operation_id','remote_id','heartbeat_at','error_message','updated_at'] OR NEW.version<OLD.version OR NEW.version>OLD.version+1 OR NEW.attempts<OLD.attempts OR NEW.attempts>OLD.attempts+1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native target identity and attempt count are protected';END IF;END IF;
 RETURN NEW;
END $dg$;
CREATE TRIGGER native_live_target_guard BEFORE INSERT OR UPDATE OR DELETE ON live_destinations FOR EACH ROW EXECUTE FUNCTION dg_native_live_target_guard();
CREATE FUNCTION dg_native_live_command_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native command cannot be deleted';END IF;
 IF TG_OP='INSERT' THEN IF NEW.status<>'pending' OR NEW.simulator_applied_at IS NOT NULL OR NEW.media_applied_at IS NOT NULL OR NEW.media_frame IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native command requires an independent pending receipt';END IF;
 ELSE IF to_jsonb(NEW)-ARRAY['status','simulator_applied_at','media_applied_at','media_frame'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['status','simulator_applied_at','media_applied_at','media_frame'] OR OLD.status<>'pending' OR NEW.status NOT IN('applied','superseded') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native command identity and final receipt are immutable';END IF;END IF;
 RETURN NEW;
END $dg$;
CREATE TRIGGER native_live_command_guard BEFORE INSERT OR UPDATE OR DELETE ON live_commands FOR EACH ROW EXECUTE FUNCTION dg_native_live_command_guard();
CREATE FUNCTION dg_native_live_member_invalidate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF TG_OP='DELETE' OR(NEW.tenant_id,NEW.role,NEW.workspace_ids) IS DISTINCT FROM(OLD.tenant_id,OLD.role,OLD.workspace_ids) THEN UPDATE live_sessions SET invalidated_at=dg_utc_now(),invalidation_reason='原开播人的组织、角色或空间权限已变化；重新授权不会恢复旧场次。',version=version+1,updated_at=dg_utc_now() WHERE actor_id=OLD.user_id AND invalidated_at IS NULL;END IF;
 RETURN NULL;
END $dg$;
CREATE TRIGGER native_live_member_invalidate AFTER UPDATE OR DELETE ON memberships FOR EACH ROW EXECUTE FUNCTION dg_native_live_member_invalidate();
REVOKE ALL ON FUNCTION dg_native_live_program_guard(),dg_native_live_session_guard(),dg_native_live_discussion_guard(),dg_native_live_target_guard(),dg_native_live_command_guard(),dg_native_live_member_invalidate() FROM PUBLIC;
