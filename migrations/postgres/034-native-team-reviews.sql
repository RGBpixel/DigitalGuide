-- Fresh native validation only. Applied001-033 stay frozen.
CREATE TABLE _dg_native_review_snapshots (
 review_id text PRIMARY KEY REFERENCES studio_reviews(id),payload text NOT NULL,
 snapshot_hash text NOT NULL CHECK(snapshot_hash ~ '^[a-f0-9]{64}$'),created_at text NOT NULL,
 CHECK(snapshot_hash=encode(sha256(convert_to(payload,'UTF8')),'hex'))
);
CREATE TABLE _dg_native_review_decisions (
 review_id text PRIMARY KEY REFERENCES studio_reviews(id),actor_id text NOT NULL,
 status text NOT NULL CHECK(status IN('approved','changes_requested','withdrawn')),
 snapshot_hash text NOT NULL CHECK(snapshot_hash ~ '^[a-f0-9]{64}$'),note text NOT NULL,
 request_id text NOT NULL,decided_at text NOT NULL
);
CREATE TRIGGER native_review_snapshot_immutable BEFORE UPDATE OR DELETE ON _dg_native_review_snapshots FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_review_decision_immutable BEFORE UPDATE OR DELETE ON _dg_native_review_decisions FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
ALTER TABLE studio_reviews ADD CONSTRAINT native_review_shape CHECK(
 project_version>0 AND version>0 AND stage IN('project','delivery')
 AND ((stage='project' AND export_id IS NULL) OR(stage='delivery' AND export_id IS NOT NULL))
 AND status IN('pending','approved','changes_requested','withdrawn')
 AND requester_id<>reviewer_id AND last_editor_id<>reviewer_id
 AND snapshot_hash ~ '^[a-f0-9]{64}$'
 AND ((invalidated_at IS NULL AND invalidation_reason IS NULL) OR(invalidated_at IS NOT NULL AND invalidation_reason IS NOT NULL))
 AND ((status IN('pending','withdrawn') AND decision_at IS NULL) OR(status IN('approved','changes_requested') AND decision_at IS NOT NULL))
);
CREATE FUNCTION dg_native_review_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'pending' OR NEW.version<>1 OR NEW.invalidated_at IS NOT NULL OR NEW.note<>'' OR NEW.decision_at IS NOT NULL THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native review must start pending';
  END IF;
 ELSE
  IF (NEW.id,NEW.project_id,NEW.project_version,NEW.stage,NEW.export_id,NEW.requester_id,NEW.reviewer_id,NEW.last_editor_id,NEW.snapshot_hash,NEW.created_at)
    IS DISTINCT FROM (OLD.id,OLD.project_id,OLD.project_version,OLD.stage,OLD.export_id,OLD.requester_id,OLD.reviewer_id,OLD.last_editor_id,OLD.snapshot_hash,OLD.created_at)
    OR NEW.version<>OLD.version+1 OR (OLD.invalidated_at IS NOT NULL AND (NEW.invalidated_at,NEW.invalidation_reason) IS DISTINCT FROM (OLD.invalidated_at,OLD.invalidation_reason))
    OR (NEW.status<>OLD.status AND (OLD.status<>'pending' OR NEW.status NOT IN('approved','changes_requested','withdrawn')))
    OR (OLD.status<>'pending' AND (NEW.note,NEW.decision_at) IS DISTINCT FROM (OLD.note,OLD.decision_at)) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native review input or state is immutable';
  END IF;
 END IF;
 RETURN NEW;
END;$dg$;
CREATE TRIGGER native_review_guard BEFORE INSERT OR UPDATE ON studio_reviews FOR EACH ROW EXECUTE FUNCTION dg_native_review_guard();

CREATE FUNCTION dg_native_review_project_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF (NEW.version,NEW.archived) IS DISTINCT FROM (OLD.version,OLD.archived) THEN
  UPDATE studio_reviews SET invalidated_at=dg_utc_now(),invalidation_reason='工程版本或归档状态已变化，请重新提交当前版本。',version=version+1,updated_at=dg_utc_now()
   WHERE project_id=OLD.id AND invalidated_at IS NULL AND status IN('pending','approved');
 END IF;
 RETURN NEW;
END;$dg$;
REVOKE ALL ON FUNCTION dg_native_review_project_changed() FROM PUBLIC;
CREATE TRIGGER native_review_project_changed AFTER UPDATE OF version,archived ON studio_projects FOR EACH ROW EXECUTE FUNCTION dg_native_review_project_changed();

CREATE FUNCTION dg_native_review_requester_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF TG_OP='DELETE' OR (NEW.tenant_id,NEW.role,NEW.workspace_ids) IS DISTINCT FROM (OLD.tenant_id,OLD.role,OLD.workspace_ids) THEN
  UPDATE studio_reviews SET invalidated_at=dg_utc_now(),invalidation_reason='提交人的组织、权限或工作空间已变化，请重新提交。',version=version+1,updated_at=dg_utc_now()
   WHERE (requester_id=OLD.user_id OR reviewer_id=OLD.user_id) AND invalidated_at IS NULL AND status IN('pending','approved');
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END;$dg$;
REVOKE ALL ON FUNCTION dg_native_review_requester_changed() FROM PUBLIC;
CREATE TRIGGER native_review_requester_changed AFTER UPDATE OR DELETE ON memberships FOR EACH ROW EXECUTE FUNCTION dg_native_review_requester_changed();

ALTER TABLE studio_comments ADD CONSTRAINT native_studio_comment_shape CHECK(project_version>0 AND version>0 AND char_length(body) BETWEEN 1 AND 2000 AND jsonb_typeof(anchor::jsonb)='object' AND ((resolved_at IS NULL AND resolved_by IS NULL) OR(resolved_at IS NOT NULL AND resolved_by IS NOT NULL)));
CREATE FUNCTION dg_native_studio_comment_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
 IF (NEW.id,NEW.project_id,NEW.project_version,NEW.author_id,NEW.parent_id,NEW.anchor,NEW.body,NEW.created_at)
   IS DISTINCT FROM (OLD.id,OLD.project_id,OLD.project_version,OLD.author_id,OLD.parent_id,OLD.anchor,OLD.body,OLD.created_at) OR NEW.version<>OLD.version+1 THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native comment source and body are immutable';
 END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_studio_comment_guard BEFORE UPDATE ON studio_comments FOR EACH ROW EXECUTE FUNCTION dg_native_studio_comment_guard();

-- Only this function may change a review's final status. API has no direct status/note write privilege.
CREATE FUNCTION dg_native_review_control(target text,expected bigint,action text,decision_note text,verified_hash text,request text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE r studio_reviews%ROWTYPE;p studio_projects%ROWTYPE;actor text;member memberships%ROWTYPE;editor text;new_status text;
BEGIN
 actor:=current_setting('digitalguide.actor_id',true);
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control c WHERE c.id=1 AND c.status='validation_only' AND session_user=c.app_role) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Native review application role required';
 END IF;
 -- The application locks current memberships before workspace/resources; recheck without reversing that order.
 SELECT * INTO member FROM memberships WHERE user_id=actor;
 SELECT s.* INTO r FROM studio_reviews s WHERE s.id=target;
 SELECT v.* INTO p FROM studio_projects v WHERE v.id=r.project_id;
 IF member.user_id IS NULL OR p.id IS NULL OR member.tenant_id<>p.tenant_id OR NOT (member.workspace_ids::jsonb ? p.workspace_id)
   OR p.environment<>'mock' OR p.app_env<>(SELECT app_env FROM _dg_native_runtime_control WHERE id=1) THEN RETURN false;END IF;
 SELECT s.* INTO r FROM studio_reviews s WHERE s.id=target FOR UPDATE;
 IF r.version<>expected OR r.status<>'pending' THEN RETURN false;END IF;
 IF action='withdraw' THEN
  IF member.role NOT IN('admin','editor') OR (actor<>r.requester_id AND member.role<>'admin') THEN RETURN false;END IF;
  new_status:='withdrawn';decision_note:='';
 ELSIF action IN('approve','request_changes') THEN
  SELECT actor_id INTO editor FROM studio_project_versions WHERE project_id=p.id AND version=p.version;
  IF actor<>r.reviewer_id OR member.role NOT IN('admin','reviewer') OR actor IN(r.requester_id,r.last_editor_id) OR editor IS DISTINCT FROM r.last_editor_id
    OR r.invalidated_at IS NOT NULL OR p.archived<>0 OR p.version<>r.project_version OR verified_hash IS DISTINCT FROM r.snapshot_hash
    OR char_length(decision_note)>2000 OR (action='request_changes' AND char_length(trim(decision_note))=0)
    OR NOT EXISTS(SELECT 1 FROM _dg_native_review_snapshots s WHERE s.review_id=r.id AND s.snapshot_hash=r.snapshot_hash) THEN RETURN false;END IF;
  IF r.stage='delivery' AND NOT EXISTS(SELECT 1 FROM studio_exports e WHERE e.id=r.export_id AND e.project_id=p.id AND e.project_version=p.version AND e.status='succeeded' AND e.kind IN('video','audio')) THEN RETURN false;END IF;
  new_status:=CASE WHEN action='approve' THEN 'approved' ELSE 'changes_requested' END;
 ELSE RETURN false;END IF;
 UPDATE studio_reviews SET status=new_status,note=decision_note,decision_at=CASE WHEN new_status='withdrawn' THEN NULL ELSE dg_utc_now() END,version=version+1,updated_at=dg_utc_now() WHERE id=r.id;
 INSERT INTO _dg_native_review_decisions VALUES(r.id,actor,new_status,r.snapshot_hash,decision_note,request,dg_utc_now());
 INSERT INTO audit_events VALUES(gen_random_uuid()::text,p.tenant_id,p.workspace_id,actor,'studio.review_'||CASE WHEN action='withdraw' THEN 'withdraw' ELSE 'decision' END,r.id,'confirmed',request,dg_utc_now());
 INSERT INTO outbox_events VALUES(gen_random_uuid()::text,p.tenant_id,p.workspace_id,r.id,'studio.review_'||new_status,'mock','{}',dg_utc_now(),NULL);
 RETURN true;
END;$dg$;
REVOKE ALL ON FUNCTION dg_native_review_control(text,bigint,text,text,text,text) FROM PUBLIC;
