-- Native authored presentation plans and member sessions. Applied001-018 stay frozen.
ALTER TABLE studio_presentation_plans ADD CONSTRAINT native_presentation_plan_shape CHECK(version BETWEEN 1 AND 100 AND source_project_version>0 AND source_hash ~ '^[a-f0-9]{64}$' AND definition_hash ~ '^[a-f0-9]{64}$' AND definition::jsonb ? 'pages' AND jsonb_typeof(definition::jsonb->'pages')='array' AND jsonb_array_length(definition::jsonb->'pages') BETWEEN 1 AND 40);
ALTER TABLE studio_presentation_plan_versions ADD CONSTRAINT native_presentation_revision_shape CHECK(version BETWEEN 1 AND 100 AND definition_hash ~ '^[a-f0-9]{64}$');
CREATE TRIGGER native_presentation_revision_immutable BEFORE UPDATE OR DELETE ON studio_presentation_plan_versions FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_presentation_application_immutable BEFORE UPDATE OR DELETE ON studio_presentation_applications FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
ALTER TABLE studio_presentation_applications ADD CONSTRAINT native_presentation_application_revision FOREIGN KEY(plan_id,plan_version) REFERENCES studio_presentation_plan_versions(plan_id,version);
CREATE FUNCTION dg_native_presentation_plan_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
 IF to_jsonb(NEW)-ARRAY['name','definition','definition_hash','version','updated_at'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['name','definition','definition_hash','version','updated_at'] OR NEW.version<>OLD.version+1 THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Presentation source is immutable and revisions advance once';
 END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_presentation_plan_guard BEFORE UPDATE ON studio_presentation_plans FOR EACH ROW EXECUTE FUNCTION dg_native_presentation_plan_guard();
CREATE FUNCTION dg_native_presentation_revision_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM studio_presentation_plan_versions v WHERE v.plan_id=NEW.id AND v.version=NEW.version AND v.name=NEW.name AND v.definition=NEW.definition AND v.definition_hash=NEW.definition_hash) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Presentation current revision needs the exact immutable history in the same transaction';
 END IF;RETURN NULL;
END;$dg$;
CREATE CONSTRAINT TRIGGER native_presentation_revision_guard AFTER INSERT OR UPDATE ON studio_presentation_plans DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_presentation_revision_guard();

ALTER TABLE studio_presentation_sessions ADD CONSTRAINT native_presentation_session_shape CHECK(project_version>0 AND version>0 AND answer_generation>0 AND source_hash ~ '^[a-f0-9]{64}$' AND artifact_hash ~ '^[a-f0-9]{64}$' AND duration_ms BETWEEN 1000 AND 10800000 AND position_ms BETWEEN 0 AND duration_ms AND state IN ('ready','playing','paused','question','ended') AND jsonb_typeof(chapters::jsonb)='array' AND jsonb_array_length(chapters::jsonb) BETWEEN 1 AND 40 AND jsonb_typeof(captions::jsonb)='array');
ALTER TABLE studio_presentation_sessions ADD CONSTRAINT native_presentation_session_clock CHECK((state='playing')=(anchor_at IS NOT NULL));
ALTER TABLE studio_presentation_sessions ADD CONSTRAINT native_presentation_session_question CHECK((state='question' AND active_question_id IS NOT NULL AND resume_state IS NOT NULL AND resume_state IN ('ready','playing','paused') AND resume_position_ms IS NOT NULL AND resume_position_ms BETWEEN 0 AND duration_ms) OR(state<>'question' AND active_question_id IS NULL AND resume_state IS NULL AND resume_position_ms IS NULL));
ALTER TABLE studio_presentation_sessions ADD CONSTRAINT native_presentation_session_invalidation CHECK((invalidated_at IS NULL AND invalidation_reason IS NULL) OR(invalidated_at IS NOT NULL AND invalidation_reason IS NOT NULL AND invalidation_reason IN ('host_permission_changed','project_changed')));
-- Automatic model/voice jobs remain an explicit later native migration; never relabel a human answer as model output.
ALTER TABLE studio_presentation_sessions ADD CONSTRAINT native_presentation_manual_mode CHECK(answer_mode='human_text' AND answer_configuration IS NULL);
ALTER TABLE studio_presentation_questions ADD CONSTRAINT native_presentation_question_shape CHECK(version>0 AND position_ms BETWEEN 0 AND 10800000 AND status IN ('pending','answered','dismissed') AND char_length(body) BETWEEN 1 AND 2000 AND answer_job_id IS NULL AND((status='answered' AND answer IS NOT NULL AND char_length(answer) BETWEEN 1 AND 4000 AND answer_by IS NOT NULL AND answer_at IS NOT NULL) OR(status<>'answered' AND answer IS NULL AND answer_by IS NULL AND answer_at IS NULL)));
ALTER TABLE studio_presentation_questions ADD CONSTRAINT native_presentation_question_identity UNIQUE(id,session_id);
ALTER TABLE studio_presentation_sessions ADD CONSTRAINT native_presentation_active_question FOREIGN KEY(active_question_id,id) REFERENCES studio_presentation_questions(id,session_id) DEFERRABLE INITIALLY DEFERRED;
CREATE FUNCTION dg_native_presentation_session_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE mutable text[]:=ARRAY['state','position_ms','anchor_at','version','active_question_id','resume_state','resume_position_ms','answer_generation','updated_at','invalidated_at','invalidation_reason'];
BEGIN
 IF NEW.version<>OLD.version+1 OR to_jsonb(NEW)-mutable IS DISTINCT FROM to_jsonb(OLD)-mutable THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Presentation media, source and authored boundaries are immutable';
 END IF;
 IF OLD.invalidated_at IS NULL AND NEW.invalidated_at IS NOT NULL AND to_jsonb(NEW)-ARRAY['version','invalidated_at','invalidation_reason'] IS NOT DISTINCT FROM to_jsonb(OLD)-ARRAY['version','invalidated_at','invalidation_reason'] THEN RETURN NEW;END IF;
 IF OLD.invalidated_at IS NOT NULL OR NEW.invalidated_at IS NOT NULL OR OLD.state='ended' OR NEW.answer_generation NOT BETWEEN OLD.answer_generation AND OLD.answer_generation+1 THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Ended or invalidated sessions cannot revive';
 END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_presentation_session_guard BEFORE UPDATE ON studio_presentation_sessions FOR EACH ROW EXECUTE FUNCTION dg_native_presentation_session_guard();
CREATE FUNCTION dg_native_presentation_question_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
 IF OLD.status<>'pending' OR NEW.status NOT IN ('answered','dismissed') OR NEW.version<>OLD.version+1 OR to_jsonb(NEW)-ARRAY['status','answer','answer_by','answer_at','version'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['status','answer','answer_by','answer_at','version'] THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Original questions, breakpoints and confirmed answers cannot be overwritten';
 END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_presentation_question_guard BEFORE UPDATE ON studio_presentation_questions FOR EACH ROW EXECUTE FUNCTION dg_native_presentation_question_guard();
-- Keep the existing exact permanent-invalidation bodies and fixed schema paths.
ALTER FUNCTION dg_trigger_34171267bda3628408bb1a23() SECURITY DEFINER;
ALTER FUNCTION dg_trigger_9820c2a86f0930cff553ad6b() SECURITY DEFINER;
REVOKE ALL ON FUNCTION dg_trigger_34171267bda3628408bb1a23() FROM PUBLIC;
REVOKE ALL ON FUNCTION dg_trigger_9820c2a86f0930cff553ad6b() FROM PUBLIC;
