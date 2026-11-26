-- Freeze055. Validate transitive native media rights without giving the model
-- worker an unselected original script or direct access to session bodies.
CREATE FUNCTION dg_native_assistant_interpretation_context_v55(target text,token text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j studio_assistant_interpretations%ROWTYPE;s studio_assistant_sessions%ROWTYPE;p studio_projects%ROWTYPE;current_app text;
BEGIN
 SELECT app_env INTO current_app FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user=worker_role;IF current_app IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only the model worker reads leased selected text';END IF;
 SELECT * INTO j FROM studio_assistant_interpretations WHERE id=target AND app_env=current_app;SELECT * INTO s FROM studio_assistant_sessions WHERE id=j.session_id;SELECT * INTO p FROM studio_projects WHERE id=s.project_id;
 IF j.id IS NULL OR j.status<>'processing' OR j.lease_token IS DISTINCT FROM token OR j.lease_until<=dg_utc_now() OR NOT EXISTS(SELECT 1 FROM native_model_leases l WHERE l.resource='qwen3-4b-cpu' AND l.job_kind='assistant-interpretation' AND l.job_id=j.id AND l.token=dg_native_assistant_interpretation_context_v55.token AND l.lease_until>dg_utc_now()) OR s.status<>'open' OR s.version<>j.session_version OR s.current_turn_id IS DISTINCT FROM j.parent_turn_id OR p.archived<>0 OR p.version<>s.project_version OR p.document::jsonb IS DISTINCT FROM s.base_document::jsonb OR NOT dg_native_assistant_source_valid(s.id) OR NOT dg_native_assistant_member(j.actor_id,j.tenant_id,j.workspace_id) THEN RETURN NULL;END IF;
 PERFORM user_id FROM dg_native_locked_membership(j.actor_id);PERFORM user_id FROM dg_native_locked_membership(s.actor_id);RETURN to_jsonb(j);
END;$dg$;

CREATE OR REPLACE FUNCTION dg_native_assistant_interpretation_context(target text,token text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j studio_assistant_interpretations%ROWTYPE;s studio_assistant_sessions%ROWTYPE;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM _dg_native_runtime_control WHERE id=1 AND status='validation_only' AND session_user=worker_role) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only the model worker reads leased context';END IF;
 SELECT * INTO j FROM studio_assistant_interpretations WHERE id=target;SELECT * INTO s FROM studio_assistant_sessions WHERE id=j.session_id;
 IF j.id IS NULL OR s.id IS NULL THEN RETURN NULL;END IF;
 PERFORM user_id FROM dg_native_locked_membership(j.actor_id);PERFORM user_id FROM dg_native_locked_membership(s.actor_id);
 PERFORM pg_advisory_xact_lock(hashtextextended(dg_native_live_answer_canonical(jsonb_build_array('native-asset-workspace',j.tenant_id,j.workspace_id)),0));
 PERFORM id FROM studio_projects WHERE id=s.project_id FOR SHARE;
 PERFORM session_id FROM _dg_native_assistant_sources WHERE session_id=s.id FOR SHARE;
 RETURN dg_native_assistant_interpretation_context_v55(target,token);
END;$dg$;
CREATE FUNCTION dg_native_assistant_source_projection(target text,token text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j studio_assistant_interpretations%ROWTYPE;s studio_assistant_sessions%ROWTYPE;i _dg_native_assistant_sources%ROWTYPE;doc jsonb;segments jsonb;item jsonb;elements jsonb;e jsonb;
BEGIN
 IF dg_native_assistant_interpretation_context(target,token) IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO j FROM studio_assistant_interpretations WHERE id=target;SELECT * INTO s FROM studio_assistant_sessions WHERE id=j.session_id;SELECT * INTO i FROM _dg_native_assistant_sources WHERE session_id=s.id;doc:=s.base_document::jsonb;segments:='[]'::jsonb;
 FOR item IN SELECT value FROM jsonb_array_elements(doc->'segments') LOOP
  elements:='[]'::jsonb;FOR e IN SELECT value FROM jsonb_array_elements(item->'elements') LOOP IF e->>'type'='text' THEN e:=jsonb_set(e,'{text}','"受控来源校验"'::jsonb);END IF;elements:=elements||jsonb_build_array(e);END LOOP;
  item:=jsonb_set(jsonb_set(jsonb_set(item,'{text}','""'::jsonb),'{title}','"受控来源校验"'::jsonb),'{elements}',elements);segments:=segments||jsonb_build_array(item);
 END LOOP;doc:=jsonb_set(doc,'{segments}',segments);
 -- Text sources on the professional timeline may also contain an unselected script.
 IF doc ? 'timeline' THEN
  doc:=jsonb_set(doc,'{timeline,tracks}',coalesce((SELECT jsonb_agg(jsonb_set(t,'{clips}',coalesce((SELECT jsonb_agg(CASE WHEN c->'source'->>'type'='text' THEN jsonb_set(c,'{source,text}','"受控来源校验"'::jsonb) ELSE c END ORDER BY ci) FROM jsonb_array_elements(t->'clips') WITH ORDINALITY clips(c,ci)),'[]'::jsonb)) ORDER BY ti) FROM jsonb_array_elements(doc->'timeline'->'tracks') WITH ORDINALITY tracks(t,ti)),'[]'::jsonb));
 END IF;
 RETURN jsonb_build_object('document',doc,'purpose',(SELECT purpose FROM studio_projects WHERE id=s.project_id),'resourcesHash',dg_native_assistant_digest(i.snapshot::jsonb-'document'));
END;$dg$;
REVOKE ALL ON FUNCTION dg_native_assistant_interpretation_context(text,text),dg_native_assistant_interpretation_context_v55(text,text),dg_native_assistant_source_projection(text,text) FROM PUBLIC;
