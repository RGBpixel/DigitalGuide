-- R-127/AC-35: fixed selections, reviewed work copies and leased local editing.
-- Applied001-054 are frozen. The API coordinates; independent workers compute.
CREATE TABLE _dg_native_assistant_sources(
 session_id text PRIMARY KEY REFERENCES studio_assistant_sessions(id),snapshot text NOT NULL,
 invalidated_at text,created_at text NOT NULL
);
CREATE TABLE _dg_native_assistant_interpretation_outputs(
 job_id text PRIMARY KEY REFERENCES studio_assistant_interpretations(id),lease_token text NOT NULL,
 turn_id text UNIQUE NOT NULL,proposal text NOT NULL,proposal_hash text NOT NULL,created_at text NOT NULL
);
ALTER TABLE studio_assistant_sessions ADD CONSTRAINT native_assistant_session_shape CHECK(version>0 AND project_version>0 AND status IN('open','applied','closed') AND environment='mock' AND app_env IN('development','sandbox') AND jsonb_typeof(base_document::jsonb)='object' AND jsonb_typeof(selected_ids::jsonb)='array' AND jsonb_array_length(selected_ids::jsonb) BETWEEN 1 AND 8 AND base_document_hash ~ '^[a-f0-9]{64}$' AND source_hash ~ '^[a-f0-9]{64}$' AND ((status='applied' AND applied_project_version=project_version+1 AND applied_document_hash IS NOT NULL) OR(status<>'applied' AND applied_project_version IS NULL AND applied_document_hash IS NULL)));
ALTER TABLE studio_assistant_turns ADD CONSTRAINT native_assistant_turn_shape CHECK(number BETWEEN 1 AND 30 AND provider IN('local_commands','manual','mock_editor','external_editor','local_llm') AND proposal_hash ~ '^[a-f0-9]{64}$' AND jsonb_typeof(proposal::jsonb)='object');
ALTER TABLE studio_assistant_generations ADD CONSTRAINT native_assistant_generation_shape CHECK(number BETWEEN 1 AND 3 AND version>0 AND status IN('queued','speech','video','ready','failed','cancelled','applied') AND plan_hash ~ '^[a-f0-9]{64}$' AND jsonb_typeof(plan::jsonb)='object' AND jsonb_typeof(exports::jsonb)='array' AND jsonb_array_length(exports::jsonb)<=8);
ALTER TABLE studio_assistant_interpretations ADD CONSTRAINT native_assistant_interpretation_shape CHECK(version>0 AND control_version>0 AND session_version>0 AND attempts BETWEEN 0 AND 3 AND progress>=0 AND progress<=1 AND status IN('queued','processing','succeeded','failed','cancelled','stale') AND environment='mock' AND app_env IN('development','sandbox') AND ((status='processing' AND lease_token IS NOT NULL AND lease_until IS NOT NULL) OR(status<>'processing' AND lease_token IS NULL AND lease_until IS NULL)) AND ((status='succeeded' AND turn_id IS NOT NULL AND evidence IS NOT NULL AND progress=1) OR(status<>'succeeded' AND turn_id IS NULL AND evidence IS NULL)));
ALTER TABLE studio_assistant_sessions ADD CONSTRAINT native_assistant_project_fk FOREIGN KEY(project_id) REFERENCES studio_projects(id);
ALTER TABLE studio_assistant_turns ADD CONSTRAINT native_assistant_turn_session_fk FOREIGN KEY(session_id) REFERENCES studio_assistant_sessions(id);
ALTER TABLE studio_assistant_generations ADD CONSTRAINT native_assistant_generation_session_fk FOREIGN KEY(session_id) REFERENCES studio_assistant_sessions(id);
ALTER TABLE studio_assistant_generations ADD CONSTRAINT native_assistant_generation_turn_fk FOREIGN KEY(turn_id) REFERENCES studio_assistant_turns(id);
ALTER TABLE studio_assistant_interpretations ADD CONSTRAINT native_assistant_interpretation_session_fk FOREIGN KEY(session_id) REFERENCES studio_assistant_sessions(id);
CREATE UNIQUE INDEX native_assistant_active_interpretation ON studio_assistant_interpretations(session_id) WHERE status IN('queued','processing');
CREATE UNIQUE INDEX native_assistant_active_generation ON studio_assistant_generations(session_id) WHERE status IN('queued','speech','video');
CREATE TRIGGER native_assistant_turn_immutable BEFORE UPDATE OR DELETE ON studio_assistant_turns FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_assistant_application_immutable BEFORE UPDATE OR DELETE ON studio_assistant_applications FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_assistant_interpretation_output_immutable BEFORE UPDATE OR DELETE ON _dg_native_assistant_interpretation_outputs FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();

CREATE FUNCTION dg_native_assistant_digest(value jsonb) RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT encode(sha256(convert_to(dg_native_live_answer_canonical(value),'UTF8')),'hex')
$dg$;
CREATE FUNCTION dg_native_assistant_member(actor text,tenant text,workspace text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT EXISTS(SELECT 1 FROM memberships WHERE user_id=actor AND tenant_id=tenant AND role IN('admin','editor') AND workspace_ids::jsonb ? workspace)
$dg$;
CREATE FUNCTION dg_native_assistant_source_valid(target text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s studio_assistant_sessions%ROWTYPE;i _dg_native_assistant_sources%ROWTYPE;ref jsonb;a assets%ROWTYPE;u uploads%ROWTYPE;p profiles%ROWTYPE;c consents%ROWTYPE;k studio_clones%ROWTYPE;source studio_content_sources%ROWTYPE;current_app text;
BEGIN
 SELECT app_env INTO current_app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user IN(app_role,worker_role);IF current_app IS NULL THEN RETURN false;END IF;
 SELECT * INTO s FROM studio_assistant_sessions WHERE id=target AND environment='mock' AND app_env=current_app;SELECT * INTO i FROM _dg_native_assistant_sources WHERE session_id=target;
 IF s.id IS NULL OR i.session_id IS NULL OR i.invalidated_at IS NOT NULL OR NOT dg_native_assistant_member(s.actor_id,s.tenant_id,s.workspace_id) OR i.snapshot::jsonb->>'notAfter'<=dg_utc_now() THEN RETURN false;END IF;
 FOR ref IN SELECT value FROM jsonb_array_elements(i.snapshot::jsonb->'assets') LOOP
  SELECT * INTO a FROM assets WHERE id=ref->>'id';SELECT * INTO u FROM uploads WHERE id=a.upload_id;
  IF a.id IS NULL OR u.id IS NULL OR a.tenant_id<>s.tenant_id OR a.workspace_id<>s.workspace_id OR a.archived<>0 OR a.version<>(ref->>'version')::bigint OR u.sha256<>ref->>'sha256' OR a.expires_at<=dg_utc_now() THEN RETURN false;END IF;
 END LOOP;
 FOR ref IN SELECT value FROM jsonb_array_elements(i.snapshot::jsonb->'profiles') LOOP
  SELECT * INTO p FROM profiles WHERE id=ref->>'id';IF p.id IS NULL OR p.tenant_id<>s.tenant_id OR p.workspace_id<>s.workspace_id OR p.version<>(ref->>'version')::bigint THEN RETURN false;END IF;
  FOR c IN SELECT * FROM consents WHERE id IN(ref->>'avatarConsentId',ref->>'voiceConsentId') LOOP IF c.revoked_at IS NOT NULL OR c.expires_at<=dg_utc_now() THEN RETURN false;END IF;END LOOP;
 END LOOP;
 FOR ref IN SELECT value FROM jsonb_array_elements(i.snapshot::jsonb->'resources'->'clones') LOOP
  SELECT * INTO k FROM studio_clones WHERE id=ref->>'id';IF k.id IS NULL OR k.version<>(ref->>'version')::bigint OR k.status<>'accepted' THEN RETURN false;END IF;
  SELECT * INTO c FROM consents WHERE id=k.consent_id;IF c.id IS NULL OR c.revoked_at IS NOT NULL OR c.expires_at<=dg_utc_now() THEN RETURN false;END IF;
 END LOOP;
 FOR ref IN SELECT value FROM jsonb_array_elements(coalesce(i.snapshot::jsonb->'imports','[]'::jsonb)) LOOP
  IF NOT EXISTS(SELECT 1 FROM studio_imports WHERE id=ref->>'id' AND tenant_id=s.tenant_id AND workspace_id=s.workspace_id AND version=(ref->>'version')::bigint AND status='reviewed') THEN RETURN false;END IF;
 END LOOP;
 FOR ref IN SELECT r FROM jsonb_array_elements(coalesce(i.snapshot::jsonb->'contentOrigins','[]'::jsonb)) o CROSS JOIN LATERAL jsonb_array_elements(o->'refs') r LOOP
  SELECT * INTO source FROM studio_content_sources WHERE id=ref->>'id';IF source.id IS NULL OR source.tenant_id<>s.tenant_id OR source.workspace_id<>s.workspace_id OR source.withdrawn<>0 OR source.expires_at<=dg_utc_now() OR source.version<>(ref->>'version')::bigint OR source.text_sha256<>ref->>'textSHA256' THEN RETURN false;END IF;
 END LOOP;RETURN true;
END;$dg$;

CREATE FUNCTION dg_native_assistant_session_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE mutable text[]:=ARRAY['version','status','current_turn_id','current_generation_id','applied_project_version','applied_document_hash','updated_at'];current_app text;
BEGIN
 SELECT app_env INTO current_app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user IN(app_role,worker_role);
 IF current_app IS NULL OR NEW.app_env<>current_app OR NEW.environment<>'mock' OR NOT EXISTS(SELECT 1 FROM studio_projects p WHERE p.id=NEW.project_id AND p.tenant_id=NEW.tenant_id AND p.workspace_id=NEW.workspace_id AND p.environment=NEW.environment AND p.app_env=NEW.app_env) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assistant session scope changed';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.version<>1 OR NEW.status<>'open' OR NEW.current_turn_id IS NOT NULL OR NEW.current_generation_id IS NOT NULL OR NOT dg_native_assistant_member(NEW.actor_id,NEW.tenant_id,NEW.workspace_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assistant session requires an explicit current actor';END IF;
 ELSIF NEW.version<>OLD.version+1 OR to_jsonb(NEW)-mutable IS DISTINCT FROM to_jsonb(OLD)-mutable OR OLD.status<>'open' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assistant source, selection and closed history are immutable';END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_assistant_session_guard BEFORE INSERT OR UPDATE ON studio_assistant_sessions FOR EACH ROW EXECUTE FUNCTION dg_native_assistant_session_guard();
CREATE FUNCTION dg_native_assistant_source_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.invalidated_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM studio_assistant_sessions s WHERE s.id=NEW.session_id AND s.base_document::jsonb=NEW.snapshot::jsonb->'document' AND s.source_hash=dg_native_assistant_digest(NEW.snapshot::jsonb) AND s.base_document_hash=dg_native_assistant_digest(s.base_document::jsonb)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assistant source requires exact original document and digest';END IF;
 ELSIF OLD.invalidated_at IS NOT NULL OR NEW.invalidated_at IS NULL OR to_jsonb(NEW)-'invalidated_at' IS DISTINCT FROM to_jsonb(OLD)-'invalidated_at' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assistant source withdrawal is permanent';END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_assistant_source_guard BEFORE INSERT OR UPDATE ON _dg_native_assistant_sources FOR EACH ROW EXECUTE FUNCTION dg_native_assistant_source_guard();
CREATE FUNCTION dg_native_assistant_turn_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE s studio_assistant_sessions%ROWTYPE;proposal_value jsonb:=NEW.proposal::jsonb;patch jsonb;
BEGIN
 SELECT * INTO s FROM studio_assistant_sessions WHERE id=NEW.session_id;
 IF s.id IS NULL OR s.status<>'open' OR s.current_turn_id IS DISTINCT FROM NEW.parent_turn_id OR NOT dg_native_assistant_source_valid(s.id) OR NOT dg_native_assistant_member(NEW.actor_id,s.tenant_id,s.workspace_id) OR NEW.number<>(SELECT coalesce(max(number),0)+1 FROM studio_assistant_turns WHERE session_id=s.id) OR NEW.proposal_hash<>dg_native_assistant_digest(jsonb_build_object('parentTurnId',NEW.parent_turn_id,'provider',NEW.provider,'instruction',NEW.instruction,'proposal',proposal_value)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assistant candidate context, actor or digest changed';END IF;
 IF jsonb_array_length(proposal_value->'patches')<>jsonb_array_length(s.selected_ids::jsonb) OR(SELECT count(DISTINCT v->>'segmentId') FROM jsonb_array_elements(proposal_value->'patches') v)<>jsonb_array_length(s.selected_ids::jsonb) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assistant candidate must contain each selected segment exactly once';END IF;
 FOR patch IN SELECT value FROM jsonb_array_elements(proposal_value->'patches') LOOP IF NOT(s.selected_ids::jsonb ? (patch->>'segmentId')) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(s.base_document::jsonb->'segments') seg WHERE seg->>'id'=patch->>'segmentId' AND seg->>'text'=patch->>'beforeText') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assistant candidate cannot alter original text or expand selection';END IF;END LOOP;
 IF NEW.provider='local_llm' THEN IF NOT EXISTS(SELECT 1 FROM _dg_native_assistant_interpretation_outputs o WHERE o.turn_id=NEW.id AND o.proposal=NEW.proposal AND o.proposal_hash=NEW.proposal_hash) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Local model candidates require a worker receipt';END IF;
 ELSIF proposal_value ? 'modelEvidence' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Only a leased local model may record model evidence';END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_assistant_turn_guard BEFORE INSERT ON studio_assistant_turns FOR EACH ROW EXECUTE FUNCTION dg_native_assistant_turn_guard();

CREATE FUNCTION dg_native_assistant_generation_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE s studio_assistant_sessions%ROWTYPE;plan_value jsonb:=NEW.plan::jsonb;mutable text[]:=ARRAY['status','version','branch_project_id','branch_version','branch_document_hash','speech_job_id','exports','error_code','error_message','updated_at'];item jsonb;old_count integer;
BEGIN
 SELECT * INTO s FROM studio_assistant_sessions WHERE id=NEW.session_id;
 IF s.id IS NULL OR plan_value->>'hash'<>NEW.plan_hash OR dg_native_assistant_digest(plan_value-'hash')<>NEW.plan_hash OR plan_value->>'sessionId'<>s.id OR plan_value->>'turnId'<>NEW.turn_id OR NOT EXISTS(SELECT 1 FROM studio_assistant_turns t WHERE t.id=NEW.turn_id AND t.session_id=s.id AND t.proposal_hash=plan_value->>'turnHash') OR plan_value->>'sourceHash'<>s.source_hash THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assistant generation must bind its exact reviewed proposal and source';END IF;
 IF TG_OP='INSERT' THEN IF NEW.status<>'queued' OR NEW.version<>1 OR NEW.branch_project_id IS NOT NULL OR NEW.exports<>'[]' OR NOT dg_native_assistant_member(NEW.actor_id,s.tenant_id,s.workspace_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assistant generation starts without forged outputs';END IF;
 ELSE
  IF NEW.version<>OLD.version+1 OR to_jsonb(NEW)-mutable IS DISTINCT FROM to_jsonb(OLD)-mutable OR OLD.status IN('applied','cancelled','failed') OR(OLD.status='ready' AND NEW.status NOT IN('ready','applied','cancelled','failed')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assistant generation input and terminal history are immutable';END IF;
  IF OLD.branch_project_id IS NOT NULL AND NEW.branch_project_id IS DISTINCT FROM OLD.branch_project_id OR OLD.speech_job_id IS NOT NULL AND NEW.speech_job_id IS DISTINCT FROM OLD.speech_job_id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assistant cannot replace its original branch or speech child';END IF;
  old_count:=jsonb_array_length(OLD.exports::jsonb);IF jsonb_array_length(NEW.exports::jsonb)<old_count OR EXISTS(SELECT 1 FROM generate_series(0,old_count-1) n WHERE NEW.exports::jsonb->n IS DISTINCT FROM OLD.exports::jsonb->n) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assistant preview history is append-only';END IF;
 END IF;
 IF NEW.branch_project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM studio_projects p WHERE p.id=NEW.branch_project_id AND p.id<>s.project_id AND p.tenant_id=s.tenant_id AND p.workspace_id=s.workspace_id AND p.environment=s.environment AND p.app_env=s.app_env AND p.version=NEW.branch_version AND dg_native_assistant_digest(p.document::jsonb)=NEW.branch_document_hash) AND NEW.status NOT IN('failed','cancelled') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assistant branch must match its actual current revision';END IF;
 IF NEW.speech_job_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM studio_speech_jobs j WHERE j.id=NEW.speech_job_id AND j.project_id=NEW.branch_project_id AND j.actor_id=NEW.actor_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assistant speech child must belong to its work copy';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(NEW.exports::jsonb) LOOP IF NOT EXISTS(SELECT 1 FROM studio_exports e WHERE e.id=item->>'exportId' AND e.project_id=NEW.branch_project_id AND e.project_version=NEW.branch_version AND e.start_ms=(item->>'startMs')::bigint AND e.duration_ms=(item->>'durationMs')::bigint) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(plan_value->'ranges') r WHERE r->>'segmentId'=item->>'segmentId' AND r->>'startMs'=item->>'startMs' AND r->>'durationMs'=item->>'durationMs') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assistant preview must retain its selected range and work copy';END IF;END LOOP;
 IF NEW.status IN('ready','applied') THEN
  IF NEW.branch_project_id IS NULL OR(plan_value->'settings'->'speech'<>'null'::jsonb AND NOT EXISTS(SELECT 1 FROM studio_speech_jobs j JOIN _dg_native_speech_outputs o ON o.job_id=j.id JOIN _dg_native_speech_applications a ON a.job_id=j.id WHERE j.id=NEW.speech_job_id AND j.status='succeeded' AND j.applied_project_version=NEW.branch_version)) OR(plan_value->'settings'->>'renderVideo'='true' AND(jsonb_array_length(NEW.exports::jsonb)<>jsonb_array_length(plan_value->'ranges') OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.exports::jsonb) x LEFT JOIN studio_exports e ON e.id=x->>'exportId' WHERE e.id IS NULL OR e.status<>'succeeded' OR NOT EXISTS(SELECT 1 FROM studio_export_artifacts a WHERE a.export_id=e.id AND a.kind='video')))) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assistant ready state requires actual completed speech and selected video receipts';END IF;
 END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_assistant_generation_guard BEFORE INSERT OR UPDATE ON studio_assistant_generations FOR EACH ROW EXECUTE FUNCTION dg_native_assistant_generation_guard();

CREATE FUNCTION dg_native_assistant_cancel_children(target text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE g studio_assistant_generations%ROWTYPE;s studio_assistant_sessions%ROWTYPE;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND session_user=app_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only the native control plane may cancel reviewed children';END IF;
 SELECT * INTO g FROM studio_assistant_generations WHERE id=target;SELECT * INTO s FROM studio_assistant_sessions WHERE id=g.session_id AND app_env=(SELECT app_env FROM _dg_native_runtime_control WHERE id=1);IF s.id IS NULL THEN RETURN;END IF;
 UPDATE studio_speech_jobs SET status='cancelled',version=version+1,lease_token=NULL,lease_until=NULL,updated_at=dg_utc_now() WHERE id=g.speech_job_id AND project_id=g.branch_project_id AND status IN('queued','rendering');
 UPDATE studio_exports SET status='cancelled',lease_token=NULL,lease_until=NULL,updated_at=dg_utc_now() WHERE project_id=g.branch_project_id AND id IN(SELECT x->>'exportId' FROM jsonb_array_elements(g.exports::jsonb) x) AND status IN('queued','rendering');
 -- Physical leases are held by the original engine until it actually exits.
END;$dg$;

CREATE FUNCTION dg_native_assistant_interpretation_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE s studio_assistant_sessions%ROWTYPE;mutable text[]:=ARRAY['status','version','control_version','attempts','progress','lease_token','lease_until','turn_id','evidence','error_code','error_message','updated_at'];
BEGIN
 SELECT * INTO s FROM studio_assistant_sessions WHERE id=NEW.session_id;
 IF s.id IS NULL OR s.tenant_id<>NEW.tenant_id OR s.workspace_id<>NEW.workspace_id OR s.environment<>NEW.environment OR s.app_env<>NEW.app_env OR NEW.input_hash<>dg_native_assistant_digest(jsonb_build_object('sessionVersion',NEW.session_version,'parentTurnId',NEW.parent_turn_id,'request',NEW.request::jsonb,'contextHash',NEW.context_hash,'engine',NEW.engine::jsonb)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assistant interpretation must bind its original context and engine';END IF;
 IF TG_OP='INSERT' THEN IF NEW.status<>'queued' OR NEW.version<>1 OR NEW.control_version<>1 OR NEW.attempts<>0 OR NEW.progress<>0 OR s.version<>NEW.session_version OR s.current_turn_id IS DISTINCT FROM NEW.parent_turn_id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assistant interpretation starts from a reviewed current candidate';END IF;
 ELSE
  IF to_jsonb(NEW)-mutable IS DISTINCT FROM to_jsonb(OLD)-mutable OR NEW.attempts<OLD.attempts OR NEW.attempts>OLD.attempts+1 OR(NEW.version=OLD.version AND(NEW.status<>OLD.status OR NEW.control_version<>OLD.control_version OR NEW.attempts<>OLD.attempts OR NEW.turn_id IS DISTINCT FROM OLD.turn_id)) OR NEW.version NOT BETWEEN OLD.version AND OLD.version+1 OR OLD.status='succeeded' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assistant interpretation input, attempts and success history are immutable';END IF;
  IF session_user=(SELECT app_role FROM _dg_native_runtime_control WHERE id=1) AND(NEW.attempts<>OLD.attempts OR NEW.status NOT IN('queued','cancelled') OR NEW.progress<>0 AND NEW.progress<>OLD.progress OR NEW.turn_id IS NOT NULL OR NEW.evidence IS NOT NULL) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='API cannot forge model execution or success';END IF;
 END IF;
 IF NEW.status='succeeded' AND NOT EXISTS(SELECT 1 FROM _dg_native_assistant_interpretation_outputs o JOIN studio_assistant_turns t ON t.id=o.turn_id WHERE o.job_id=NEW.id AND o.turn_id=NEW.turn_id AND t.proposal::jsonb->'modelEvidence'=NEW.evidence::jsonb) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assistant model success requires its immutable worker output';END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_assistant_interpretation_guard BEFORE INSERT OR UPDATE ON studio_assistant_interpretations FOR EACH ROW EXECUTE FUNCTION dg_native_assistant_interpretation_guard();

ALTER TABLE native_model_leases DROP CONSTRAINT native_live_answer_cpu_shape;
ALTER TABLE native_model_leases ADD CONSTRAINT native_assistant_cpu_shape CHECK(resource='qwen3-4b-cpu' AND job_kind IN('presentation-answer','content-writing','live-answer','assistant-interpretation') AND char_length(token)=36);
CREATE FUNCTION dg_native_assistant_interpretation_context(target text,token text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j studio_assistant_interpretations%ROWTYPE;s studio_assistant_sessions%ROWTYPE;p studio_projects%ROWTYPE;current_app text;
BEGIN
 SELECT app_env INTO current_app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user=worker_role;IF current_app IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only the model worker reads leased selected text';END IF;
 SELECT * INTO j FROM studio_assistant_interpretations WHERE id=target AND app_env=current_app;SELECT * INTO s FROM studio_assistant_sessions WHERE id=j.session_id;SELECT * INTO p FROM studio_projects WHERE id=s.project_id;
 IF j.id IS NULL OR j.status<>'processing' OR j.lease_token IS DISTINCT FROM token OR j.lease_until<=dg_utc_now() OR NOT EXISTS(SELECT 1 FROM native_model_leases l WHERE l.resource='qwen3-4b-cpu' AND l.job_kind='assistant-interpretation' AND l.job_id=j.id AND l.token=dg_native_assistant_interpretation_context.token AND l.lease_until>dg_utc_now()) OR s.status<>'open' OR s.version<>j.session_version OR s.current_turn_id IS DISTINCT FROM j.parent_turn_id OR p.archived<>0 OR p.version<>s.project_version OR p.document::jsonb IS DISTINCT FROM s.base_document::jsonb OR NOT dg_native_assistant_source_valid(s.id) OR NOT dg_native_assistant_member(j.actor_id,j.tenant_id,j.workspace_id) THEN RETURN NULL;END IF;
 PERFORM user_id FROM dg_native_locked_membership(j.actor_id);PERFORM user_id FROM dg_native_locked_membership(s.actor_id);RETURN to_jsonb(j);
END;$dg$;
CREATE FUNCTION dg_native_assistant_interpretation_claim() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE current_app text;r studio_assistant_interpretations%ROWTYPE;token text:=gen_random_uuid()::text;until_at text;
BEGIN
 SELECT app_env INTO current_app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user=worker_role;IF current_app IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only the model worker may claim interpretations';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('native-local-qwen-cpu',0)) THEN RETURN NULL;END IF;
 IF EXISTS(SELECT 1 FROM native_model_leases WHERE resource='qwen3-4b-cpu' AND lease_until>dg_utc_now()) THEN RETURN NULL;END IF;DELETE FROM native_model_leases WHERE resource='qwen3-4b-cpu' AND lease_until<=dg_utc_now();
 UPDATE studio_assistant_interpretations SET status='failed',version=version+1,lease_token=NULL,lease_until=NULL,error_code='ASSISTANT_INTERPRETATION_INTERRUPTED',error_message='原任务恢复次数已用完，请核对当前原稿后新建任务。',updated_at=dg_utc_now() WHERE app_env=current_app AND status='processing' AND lease_until<=dg_utc_now() AND attempts>=3;
 SELECT * INTO r FROM studio_assistant_interpretations WHERE app_env=current_app AND attempts<3 AND(status='queued' OR(status='processing' AND lease_until<=dg_utc_now())) ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED;IF r.id IS NULL THEN RETURN NULL;END IF;
 until_at:=to_char((clock_timestamp()+interval '30 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');UPDATE studio_assistant_interpretations SET status='processing',attempts=attempts+1,version=version+1,progress=0,lease_token=token,lease_until=until_at,error_code=NULL,error_message=NULL,updated_at=dg_utc_now() WHERE id=r.id RETURNING * INTO r;INSERT INTO native_model_leases VALUES('qwen3-4b-cpu','assistant-interpretation',r.id,token,until_at);RETURN to_jsonb(r);
END;$dg$;
CREATE FUNCTION dg_native_assistant_interpretation_hold(target text,token text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND session_user=worker_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only model worker holds physical slots';END IF;PERFORM pg_advisory_xact_lock(hashtextextended('native-local-qwen-cpu',0));UPDATE native_model_leases SET lease_until=to_char((clock_timestamp()+interval '30 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') WHERE resource='qwen3-4b-cpu' AND job_kind='assistant-interpretation' AND job_id=target AND native_model_leases.token=dg_native_assistant_interpretation_hold.token AND lease_until>dg_utc_now();RETURN FOUND;
END;$dg$;
CREATE FUNCTION dg_native_assistant_interpretation_renew(target text,token text,fraction double precision) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE until_at text;
BEGIN
 IF fraction IS NULL OR fraction<0 OR fraction>.96 OR dg_native_assistant_interpretation_context(target,token) IS NULL THEN RETURN false;END IF;until_at:=to_char((clock_timestamp()+interval '30 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');UPDATE studio_assistant_interpretations SET progress=greatest(progress,fraction),lease_until=until_at,updated_at=dg_utc_now() WHERE id=target AND lease_token=token;UPDATE native_model_leases SET lease_until=until_at WHERE resource='qwen3-4b-cpu' AND job_kind='assistant-interpretation' AND job_id=target AND native_model_leases.token=dg_native_assistant_interpretation_renew.token;RETURN FOUND;
END;$dg$;
CREATE FUNCTION dg_native_assistant_interpretation_release(target text,token text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND session_user=worker_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only model worker releases physical slots';END IF;PERFORM pg_advisory_xact_lock(hashtextextended('native-local-qwen-cpu',0));DELETE FROM native_model_leases WHERE resource='qwen3-4b-cpu' AND job_kind='assistant-interpretation' AND job_id=target AND native_model_leases.token=dg_native_assistant_interpretation_release.token;RETURN FOUND;
END;$dg$;
CREATE FUNCTION dg_native_assistant_interpretation_fail(target text,token text,code text,message text,stopped boolean) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE stale_value boolean;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND session_user=worker_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only model worker records execution failure';END IF;
 IF NOT EXISTS(SELECT 1 FROM native_model_leases WHERE resource='qwen3-4b-cpu' AND job_kind='assistant-interpretation' AND job_id=target AND native_model_leases.token=dg_native_assistant_interpretation_fail.token AND lease_until>dg_utc_now()) THEN RETURN false;END IF;stale_value:=dg_native_assistant_interpretation_context(target,token) IS NULL;
 UPDATE studio_assistant_interpretations SET status=CASE WHEN stale_value THEN 'stale' WHEN stopped AND attempts<3 THEN 'queued' ELSE 'failed' END,version=version+1,lease_token=NULL,lease_until=NULL,error_code=CASE WHEN stale_value THEN 'ASSISTANT_INTERPRETATION_STALE' ELSE left(code,100) END,error_message=CASE WHEN stale_value THEN '原稿、候选、来源或权限已变化，旧结果没有保存。' ELSE left(message,1000) END,updated_at=dg_utc_now() WHERE id=target AND lease_token=token AND status='processing';RETURN FOUND;
END;$dg$;
CREATE FUNCTION dg_native_commit_assistant_interpretation(target text,token text,input_digest text,proposal_text text,proposal_digest text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j studio_assistant_interpretations%ROWTYPE;s studio_assistant_sessions%ROWTYPE;candidate jsonb:=proposal_text::jsonb;evidence_value jsonb;new_turn text:=gen_random_uuid()::text;next_number bigint;patch jsonb;
BEGIN
 IF dg_native_assistant_interpretation_context(target,token) IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assistant model lease or fixed source changed';END IF;
 SELECT * INTO j FROM studio_assistant_interpretations WHERE id=target FOR UPDATE;SELECT * INTO s FROM studio_assistant_sessions WHERE id=j.session_id FOR UPDATE;
 IF dg_native_assistant_interpretation_context(target,token) IS NULL OR j.input_hash<>input_digest THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assistant context changed before committing';END IF;
 evidence_value:=candidate->'modelEvidence';IF evidence_value IS NULL OR evidence_value->'engine' IS DISTINCT FROM j.engine::jsonb OR evidence_value->>'inputSHA256'<>dg_native_assistant_digest(j.request::jsonb) OR evidence_value->>'offlineCpu'<>'true' OR candidate->'simulated' IS DISTINCT FROM j.request::jsonb->'inheritedSimulated' OR proposal_digest<>dg_native_assistant_digest(jsonb_build_object('parentTurnId',j.parent_turn_id,'provider','local_llm','instruction',j.request::jsonb->>'instruction','proposal',candidate)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assistant model receipt does not match engine and selected input';END IF;
 SELECT coalesce(max(number),0)+1 INTO next_number FROM studio_assistant_turns WHERE session_id=s.id;IF next_number>30 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assistant turn bound exceeded';END IF;
 INSERT INTO _dg_native_assistant_interpretation_outputs VALUES(j.id,token,new_turn,proposal_text,proposal_digest,dg_utc_now());INSERT INTO studio_assistant_turns VALUES(new_turn,s.id,next_number,j.parent_turn_id,j.actor_id,'local_llm',j.request::jsonb->>'instruction',proposal_text,proposal_digest,dg_utc_now());UPDATE studio_assistant_sessions SET current_turn_id=new_turn,current_generation_id=NULL,version=version+1,updated_at=dg_utc_now() WHERE id=s.id;UPDATE studio_assistant_interpretations SET status='succeeded',version=version+1,progress=1,turn_id=new_turn,evidence=evidence_value::text,lease_token=NULL,lease_until=NULL,error_code=NULL,error_message=NULL,updated_at=dg_utc_now() WHERE id=j.id;RETURN new_turn;
END;$dg$;

CREATE FUNCTION dg_native_assistant_invalidate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE target text:=to_jsonb(OLD)->>'id';actor_value text;new_value jsonb:=to_jsonb(NEW);old_value jsonb:=to_jsonb(OLD);
BEGIN
 IF TG_TABLE_NAME='memberships' THEN
  actor_value:=OLD.user_id;IF TG_OP<>'DELETE' AND NEW.tenant_id=OLD.tenant_id AND NEW.role=OLD.role AND NEW.workspace_ids=OLD.workspace_ids THEN RETURN NEW;END IF;
  UPDATE _dg_native_assistant_sources i SET invalidated_at=dg_utc_now() FROM studio_assistant_sessions s WHERE s.id=i.session_id AND i.invalidated_at IS NULL AND(s.actor_id=actor_value OR EXISTS(SELECT 1 FROM studio_assistant_generations g WHERE g.session_id=s.id AND g.actor_id=actor_value) OR EXISTS(SELECT 1 FROM studio_assistant_interpretations j WHERE j.session_id=s.id AND j.actor_id=actor_value));
 ELSIF TG_OP='DELETE' OR new_value IS DISTINCT FROM old_value THEN
  UPDATE _dg_native_assistant_sources i SET invalidated_at=dg_utc_now() WHERE i.invalidated_at IS NULL AND(
   TG_TABLE_NAME='assets' AND EXISTS(SELECT 1 FROM jsonb_array_elements(i.snapshot::jsonb->'assets') a WHERE a->>'id'=target)
   OR TG_TABLE_NAME='profiles' AND EXISTS(SELECT 1 FROM jsonb_array_elements(i.snapshot::jsonb->'profiles') p WHERE p->>'id'=target)
   OR TG_TABLE_NAME='studio_clones' AND EXISTS(SELECT 1 FROM jsonb_array_elements(i.snapshot::jsonb->'resources'->'clones') c WHERE c->>'id'=target)
   OR TG_TABLE_NAME='consents' AND(old_value->>'revoked_at' IS NULL AND new_value->>'revoked_at' IS NOT NULL OR TG_OP='DELETE') AND(EXISTS(SELECT 1 FROM jsonb_array_elements(i.snapshot::jsonb->'profiles') p WHERE p->>'avatarConsentId'=target OR p->>'voiceConsentId'=target) OR EXISTS(SELECT 1 FROM jsonb_array_elements(i.snapshot::jsonb->'resources'->'clones') v JOIN studio_clones c ON c.id=v->>'id' WHERE c.consent_id=target))
   OR TG_TABLE_NAME='studio_imports' AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(i.snapshot::jsonb->'imports','[]'::jsonb)) r WHERE r->>'id'=target)
   OR TG_TABLE_NAME='studio_content_sources' AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(i.snapshot::jsonb->'contentOrigins','[]'::jsonb)) o CROSS JOIN LATERAL jsonb_array_elements(o->'refs') r WHERE r->>'id'=target)
  );
 END IF;RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;$dg$;
CREATE TRIGGER native_assistant_membership_invalidate AFTER UPDATE OR DELETE ON memberships FOR EACH ROW EXECUTE FUNCTION dg_native_assistant_invalidate();
CREATE TRIGGER native_assistant_asset_invalidate AFTER UPDATE OR DELETE ON assets FOR EACH ROW EXECUTE FUNCTION dg_native_assistant_invalidate();
CREATE TRIGGER native_assistant_profile_invalidate AFTER UPDATE OR DELETE ON profiles FOR EACH ROW EXECUTE FUNCTION dg_native_assistant_invalidate();
CREATE TRIGGER native_assistant_clone_invalidate AFTER UPDATE OR DELETE ON studio_clones FOR EACH ROW EXECUTE FUNCTION dg_native_assistant_invalidate();
CREATE TRIGGER native_assistant_consent_invalidate AFTER UPDATE OR DELETE ON consents FOR EACH ROW EXECUTE FUNCTION dg_native_assistant_invalidate();
CREATE TRIGGER native_assistant_import_invalidate AFTER UPDATE OR DELETE ON studio_imports FOR EACH ROW EXECUTE FUNCTION dg_native_assistant_invalidate();
CREATE TRIGGER native_assistant_content_invalidate AFTER UPDATE OR DELETE ON studio_content_sources FOR EACH ROW EXECUTE FUNCTION dg_native_assistant_invalidate();

CREATE FUNCTION dg_native_assistant_application_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE s studio_assistant_sessions%ROWTYPE;p studio_projects%ROWTYPE;t studio_assistant_turns%ROWTYPE;seg jsonb;
BEGIN
 SELECT * INTO s FROM studio_assistant_sessions WHERE id=NEW.session_id;SELECT * INTO p FROM studio_projects WHERE id=NEW.project_id;SELECT * INTO t FROM studio_assistant_turns WHERE id=NEW.turn_id;
 IF s.status<>'applied' OR s.project_id<>p.id OR s.current_turn_id<>t.id OR t.session_id<>s.id OR NEW.before_version<>s.project_version OR NEW.after_version<>NEW.before_version+1 OR NEW.after_version<>p.version OR s.applied_project_version<>p.version OR NEW.before_hash<>s.base_document_hash OR NEW.after_hash<>s.applied_document_hash OR NEW.after_hash<>dg_native_assistant_digest(p.document::jsonb) OR NOT dg_native_assistant_member(NEW.actor_id,s.tenant_id,s.workspace_id) OR NOT dg_native_assistant_source_valid(s.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assistant application must bind its one actual project revision';END IF;
 FOR seg IN SELECT value FROM jsonb_array_elements(s.base_document::jsonb->'segments') LOOP IF NOT(s.selected_ids::jsonb ? (seg->>'id')) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.document::jsonb->'segments') actual WHERE actual=seg) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assistant cannot change unselected segments';END IF;END LOOP;
 IF NEW.generation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM studio_assistant_generations g WHERE g.id=NEW.generation_id AND g.session_id=s.id AND g.turn_id=t.id AND g.status='applied') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assistant must adopt its current actually ready generation';END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_assistant_application_guard BEFORE INSERT ON studio_assistant_applications FOR EACH ROW EXECUTE FUNCTION dg_native_assistant_application_guard();

REVOKE ALL ON FUNCTION dg_native_assistant_digest(jsonb),dg_native_assistant_member(text,text,text),dg_native_assistant_source_valid(text),dg_native_assistant_cancel_children(text),dg_native_assistant_interpretation_context(text,text),dg_native_assistant_interpretation_claim(),dg_native_assistant_interpretation_hold(text,text),dg_native_assistant_interpretation_renew(text,text,double precision),dg_native_assistant_interpretation_release(text,text),dg_native_assistant_interpretation_fail(text,text,text,text,boolean),dg_native_commit_assistant_interpretation(text,text,text,text,text) FROM PUBLIC;
