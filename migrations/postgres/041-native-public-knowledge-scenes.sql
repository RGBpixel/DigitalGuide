-- R-058/R-090/R-098/R-111. Append-only native knowledge and public live scene scope.
CREATE TABLE _dg_native_knowledge_collection_versions(collection_id text NOT NULL REFERENCES knowledge_collections(id),version bigint NOT NULL,snapshot text NOT NULL,snapshot_hash text NOT NULL CHECK(snapshot_hash=encode(sha256(convert_to(snapshot,'UTF8')),'hex')),created_at text NOT NULL,PRIMARY KEY(collection_id,version));
CREATE TABLE _dg_native_live_knowledge_answers(question_id text PRIMARY KEY REFERENCES live_audience_events(id),session_id text NOT NULL REFERENCES live_sessions(id),answer_hash text NOT NULL CHECK(answer_hash ~ '^[a-f0-9]{64}$'),citations text NOT NULL,citations_hash text NOT NULL CHECK(citations_hash=encode(sha256(convert_to(citations,'UTF8')),'hex')),source_guard text NOT NULL,source_guard_hash text NOT NULL CHECK(source_guard_hash=encode(sha256(convert_to(source_guard,'UTF8')),'hex')),created_at text NOT NULL,CHECK(jsonb_typeof(citations::jsonb)='array' AND jsonb_array_length(citations::jsonb)<=5 AND source_guard::jsonb->>'pipeline'='native-live-knowledge-answer-v1'));
CREATE TRIGGER native_knowledge_collection_history_immutable BEFORE UPDATE OR DELETE ON _dg_native_knowledge_collection_versions FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
CREATE TRIGGER native_live_knowledge_answer_immutable BEFORE UPDATE OR DELETE ON _dg_native_live_knowledge_answers FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
ALTER TABLE scene_app_versions ADD COLUMN snapshot_hash text;
UPDATE scene_app_versions SET snapshot_hash=encode(sha256(convert_to(snapshot,'UTF8')),'hex');
ALTER TABLE scene_app_versions ALTER COLUMN snapshot_hash SET NOT NULL;
ALTER TABLE scene_app_versions ADD CONSTRAINT native_scene_version_hash CHECK(snapshot_hash=encode(sha256(convert_to(snapshot,'UTF8')),'hex'));
CREATE TRIGGER native_scene_version_immutable BEFORE UPDATE OR DELETE ON scene_app_versions FOR EACH ROW EXECUTE FUNCTION dg_native_append_only();
ALTER TABLE knowledge_collections ADD CONSTRAINT native_knowledge_collection_shape CHECK(environment='mock' AND app_env IN('development','sandbox') AND version BETWEEN 1 AND 200 AND audience IN('public','staff') AND char_length(name) BETWEEN 1 AND 80 AND jsonb_typeof(reader_roles::jsonb)='array' AND jsonb_array_length(reader_roles::jsonb) BETWEEN 1 AND 4 AND jsonb_typeof(scenes::jsonb)='array' AND jsonb_array_length(scenes::jsonb) BETWEEN 1 AND 7);
ALTER TABLE knowledge_versions ADD CONSTRAINT native_knowledge_version_shape CHECK(ordinal BETWEEN 1 AND 100 AND status IN('draft','published','superseded','withdrawn') AND char_length(title) BETWEEN 1 AND 100 AND char_length(content) BETWEEN 1 AND 30000 AND content_hash=encode(sha256(convert_to(content,'UTF8')),'hex') AND(source_url IS NULL OR(source_url ~* '^https?://' AND source_url !~* '^https?://[^/]*@')));
CREATE UNIQUE INDEX native_knowledge_published_one ON knowledge_versions(document_id) WHERE status='published';
CREATE INDEX native_knowledge_tokens ON knowledge_chunks USING gin((tokens::jsonb));
CREATE INDEX native_knowledge_document_scope ON knowledge_documents(collection_id,id);
ALTER TABLE scene_apps ADD CONSTRAINT native_scene_shape CHECK(environment='mock' AND app_env IN('development','sandbox') AND version BETWEEN 1 AND 200 AND enabled IN(0,1) AND channel_key ~ '^[a-z0-9][a-z0-9_-]{0,59}$' AND config::jsonb->>'workspaceId'=workspace_id AND config::jsonb->>'profileId'=profile_id AND config::jsonb->>'scene'=scene AND config::jsonb->>'name'=name AND config::jsonb->>'channelKey'=channel_key AND(config::jsonb->>'enabled')::boolean=(enabled=1));
ALTER TABLE live_audience_events DROP CONSTRAINT native_live_audience_shape;
ALTER TABLE live_audience_events ADD CONSTRAINT native_live_audience_shape CHECK(version>0 AND priority BETWEEN 0 AND 2 AND status IN('received','queued','rejected','authorized_simulation','ready','playing','answered','cancelled') AND kind IN('comment','question','join_request') AND media_opt_in IN('none','audio','video') AND(answer_kind IS NULL OR answer_kind IN('manual','product','knowledge')) AND((answer_kind='knowledge' AND jsonb_typeof(citations::jsonb)='array' AND jsonb_array_length(citations::jsonb)<=5) OR(answer_kind IS DISTINCT FROM 'knowledge' AND citations='[]')) AND input_hash ~ '^[a-f0-9]{64}$' AND participant_hash ~ '^[a-f0-9]{64}$');

CREATE FUNCTION dg_native_knowledge_collection_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Knowledge collection history cannot be deleted';END IF;
 IF TG_OP='INSERT' THEN IF NEW.version<>1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Knowledge collection starts at version one';END IF;
 ELSE IF to_jsonb(NEW)-ARRAY['name','audience','reader_roles','scenes','version','updated_at'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['name','audience','reader_roles','scenes','version','updated_at'] OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Knowledge collection identity and monotonic scope are fixed';END IF;END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW.reader_roles::jsonb) r WHERE r NOT IN('admin','editor','viewer','reviewer')) OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW.scenes::jsonb) s WHERE s NOT IN('video','presentation','live','exhibition','reception','restaurant','learning')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Knowledge audience roles and scenes must be recognized';END IF;
 RETURN NEW;
END $dg$;
CREATE TRIGGER native_knowledge_collection_guard BEFORE INSERT OR UPDATE OR DELETE ON knowledge_collections FOR EACH ROW EXECUTE FUNCTION dg_native_knowledge_collection_guard();
CREATE FUNCTION dg_native_knowledge_document_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Knowledge document history cannot be deleted';END IF;
 IF TG_OP='INSERT' THEN IF NEW.version<>1 OR NEW.published_version_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM knowledge_collections c WHERE c.id=NEW.collection_id AND c.tenant_id=NEW.tenant_id AND c.workspace_id=NEW.workspace_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Knowledge document requires its exact collection scope';END IF;
 ELSE IF to_jsonb(NEW)-ARRAY['version','published_version_id'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['version','published_version_id'] OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Knowledge document identity and version are fixed';END IF;END IF;
 RETURN NEW;
END $dg$;
CREATE TRIGGER native_knowledge_document_guard BEFORE INSERT OR UPDATE OR DELETE ON knowledge_documents FOR EACH ROW EXECUTE FUNCTION dg_native_knowledge_document_guard();
CREATE FUNCTION dg_native_knowledge_version_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Knowledge source versions cannot be deleted';END IF;
 IF TG_OP='INSERT' THEN IF NEW.status<>'draft' OR NEW.published_at IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Knowledge source starts as an unpublished draft';END IF;
 ELSE IF to_jsonb(NEW)-ARRAY['status','published_at'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['status','published_at'] OR NOT((OLD.status='draft' AND NEW.status='published' AND NEW.published_at IS NOT NULL) OR(OLD.status='published' AND NEW.status IN('superseded','withdrawn') AND NEW.published_at IS NOT DISTINCT FROM OLD.published_at)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Knowledge source body is immutable and status cannot be restored';END IF;END IF;
 RETURN NEW;
END $dg$;
CREATE TRIGGER native_knowledge_version_guard BEFORE INSERT OR UPDATE OR DELETE ON knowledge_versions FOR EACH ROW EXECUTE FUNCTION dg_native_knowledge_version_guard();
CREATE FUNCTION dg_native_knowledge_pointer_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE target text;published text;
BEGIN
 IF TG_TABLE_NAME='knowledge_documents' THEN target:=NEW.id;ELSE target:=NEW.document_id;END IF;
 SELECT published_version_id INTO published FROM knowledge_documents WHERE id=target;
 IF published IS NOT NULL AND NOT EXISTS(SELECT 1 FROM knowledge_versions WHERE id=published AND document_id=target AND status='published') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Published knowledge pointer must refer to the actual published source';END IF;RETURN NULL;
END $dg$;
CREATE CONSTRAINT TRIGGER native_knowledge_document_pointer AFTER INSERT OR UPDATE ON knowledge_documents DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_knowledge_pointer_guard();
CREATE CONSTRAINT TRIGGER native_knowledge_source_pointer AFTER UPDATE ON knowledge_versions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_knowledge_pointer_guard();
CREATE FUNCTION dg_native_knowledge_chunk_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Knowledge chunks are rebuilt from immutable source versions';END IF;
 IF NEW.sequence NOT BETWEEN 0 AND 99 OR jsonb_typeof(NEW.tokens::jsonb)<>'array' OR NOT EXISTS(SELECT 1 FROM knowledge_versions v WHERE v.id=NEW.version_id AND v.document_id=NEW.document_id AND NEW.text=substring(v.content FROM(NEW.sequence*450+1)::integer FOR 500) AND NEW.text<>'') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Knowledge chunk must match the exact original Unicode source interval';END IF;RETURN NEW;
END $dg$;
CREATE TRIGGER native_knowledge_chunk_guard BEFORE INSERT OR UPDATE ON knowledge_chunks FOR EACH ROW EXECUTE FUNCTION dg_native_knowledge_chunk_guard();
CREATE FUNCTION dg_native_scene_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Scene history cannot be deleted';END IF;
 IF TG_OP='INSERT' THEN IF NEW.version<>1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Scene starts at version one';END IF;
 ELSE IF to_jsonb(NEW)-ARRAY['profile_id','name','scene','channel_key','config','version','enabled','updated_at'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['profile_id','name','scene','channel_key','config','version','enabled','updated_at'] OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Scene scope and versions cannot be overwritten';END IF;END IF;
 IF NOT EXISTS(SELECT 1 FROM profiles p WHERE p.id=NEW.profile_id AND p.tenant_id=NEW.tenant_id AND p.workspace_id=NEW.workspace_id) OR NEW.config::jsonb->'profile'->>'id' IS DISTINCT FROM NEW.profile_id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Scene must use its own scoped profile';END IF;
 IF NEW.enabled=1 AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW.config::jsonb->'collectionIds') AS selected(collection_id) LEFT JOIN knowledge_collections c ON c.id=selected.collection_id WHERE c.id IS NULL OR c.tenant_id<>NEW.tenant_id OR c.workspace_id<>NEW.workspace_id OR NOT(c.scenes::jsonb ? NEW.scene) OR(NEW.config::jsonb->>'audience'='public' AND c.audience<>'public')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Scene knowledge must match the exact audience, workspace and scene';END IF;RETURN NEW;
END $dg$;
CREATE TRIGGER native_scene_guard BEFORE INSERT OR UPDATE OR DELETE ON scene_apps FOR EACH ROW EXECUTE FUNCTION dg_native_scene_guard();
CREATE FUNCTION dg_native_knowledge_history_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
DECLARE expected jsonb;
BEGIN
 IF TG_TABLE_NAME='scene_app_versions' THEN
  SELECT a.config::jsonb||jsonb_build_object('id',a.id,'workspaceId',a.workspace_id,'version',a.version,'enabled',a.enabled=1,'createdAt',a.created_at) INTO expected FROM scene_apps a WHERE a.id=NEW.app_id AND a.version=NEW.version;
 ELSE
  SELECT jsonb_build_object('id',c.id,'workspaceId',c.workspace_id,'name',c.name,'audience',c.audience,'readerRoles',c.reader_roles::jsonb,'scenes',c.scenes::jsonb,'version',c.version,'createdAt',c.created_at) INTO expected FROM knowledge_collections c WHERE c.id=NEW.collection_id AND c.version=NEW.version;
 END IF;
 IF expected IS NULL OR expected IS DISTINCT FROM NEW.snapshot::jsonb THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Knowledge and scene history must match the actual scoped current version';END IF;RETURN NEW;
END $dg$;
CREATE TRIGGER native_scene_history_guard BEFORE INSERT ON scene_app_versions FOR EACH ROW EXECUTE FUNCTION dg_native_knowledge_history_guard();
CREATE TRIGGER native_knowledge_collection_history_guard BEFORE INSERT ON _dg_native_knowledge_collection_versions FOR EACH ROW EXECUTE FUNCTION dg_native_knowledge_history_guard();

-- Worker receives booleans for already bound public sources, never raw staff knowledge or scene bodies.
CREATE FUNCTION dg_native_live_scene_valid(target text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE r live_sessions%ROWTYPE;s jsonb;a scene_apps%ROWTYPE;p profiles%ROWTYPE;
BEGIN
 SELECT * INTO r FROM live_sessions WHERE id=target;IF NOT FOUND OR r.invalidated_at IS NOT NULL OR r.environment<>'mock' OR r.app_env<>(SELECT app_env FROM _dg_native_runtime_control WHERE id=1) THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=r.actor_id AND m.tenant_id=r.tenant_id AND m.role='admin' AND m.workspace_ids::jsonb ? r.workspace_id) THEN RETURN false;END IF;
 SELECT snapshot::jsonb->'scene'->'app' INTO s FROM _dg_native_live_inputs WHERE session_id=r.id AND snapshot_hash=r.snapshot_hash;IF s IS NULL OR s='null'::jsonb THEN RETURN false;END IF;
 SELECT * INTO a FROM scene_apps WHERE id=s->>'id' AND tenant_id=r.tenant_id AND workspace_id=r.workspace_id AND environment=r.environment AND app_env=r.app_env;
 IF NOT FOUND OR a.enabled<>1 OR a.scene<>'live' OR a.config::jsonb->>'audience'<>'public' OR(a.config::jsonb||jsonb_build_object('id',a.id,'workspaceId',a.workspace_id,'version',a.version,'enabled',a.enabled=1,'createdAt',a.created_at)) IS DISTINCT FROM s THEN RETURN false;END IF;
 SELECT * INTO p FROM profiles WHERE id=a.profile_id AND tenant_id=a.tenant_id AND workspace_id=a.workspace_id;
 IF NOT FOUND OR p.version<>(s->'profile'->>'version')::bigint OR p.avatar_asset_id IS DISTINCT FROM s->'profile'->>'avatarAssetId' OR p.voice_asset_id IS DISTINCT FROM s->'profile'->>'voiceAssetId' OR p.name IS DISTINCT FROM s->'profile'->>'name' OR p.scenes::jsonb IS DISTINCT FROM s->'profile'->'scenes' THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(s->'collectionIds') AS selected(collection_id) LEFT JOIN knowledge_collections c ON c.id=selected.collection_id WHERE c.id IS NULL OR c.tenant_id<>r.tenant_id OR c.workspace_id<>r.workspace_id OR c.audience<>'public' OR NOT(c.scenes::jsonb ? 'live') OR c.environment<>r.environment OR c.app_env<>r.app_env) THEN RETURN false;END IF;
 RETURN true;
EXCEPTION WHEN data_exception THEN RETURN false;
END $dg$;
CREATE FUNCTION dg_native_live_knowledge_sources_valid(target text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE l _dg_native_live_knowledge_answers%ROWTYPE;q live_audience_events%ROWTYPE;r live_sessions%ROWTYPE;g jsonb;
BEGIN
 SELECT * INTO l FROM _dg_native_live_knowledge_answers WHERE question_id=target;IF NOT FOUND THEN RETURN false;END IF;
 SELECT * INTO q FROM live_audience_events WHERE id=target AND session_id=l.session_id;IF NOT FOUND OR NOT dg_native_live_scene_valid(l.session_id) THEN RETURN false;END IF;
 SELECT * INTO r FROM live_sessions WHERE id=l.session_id;
 IF jsonb_typeof(l.source_guard::jsonb->'sources') IS DISTINCT FROM 'array' OR jsonb_array_length(l.source_guard::jsonb->'sources') IS DISTINCT FROM jsonb_array_length(l.citations::jsonb) THEN RETURN false;END IF;
 FOR g IN SELECT value FROM jsonb_array_elements(l.source_guard::jsonb->'sources') LOOP
  IF NOT EXISTS(SELECT 1 FROM knowledge_collections c JOIN knowledge_documents d ON d.collection_id=c.id JOIN knowledge_versions v ON v.id=d.published_version_id AND v.document_id=d.id JOIN knowledge_chunks k ON k.version_id=v.id AND k.document_id=d.id WHERE c.id=g->>'collectionId' AND c.version=(g->>'collectionVersion')::bigint AND c.audience='public' AND c.scenes::jsonb ? 'live' AND c.tenant_id=r.tenant_id AND c.workspace_id=r.workspace_id AND c.environment=r.environment AND c.app_env=r.app_env AND d.id=g->>'documentId' AND d.version=(g->>'documentVersion')::bigint AND v.id=g->>'versionId' AND v.ordinal=(g->>'version')::bigint AND v.status='published' AND v.content_hash=g->>'contentHash' AND k.id=g->>'chunkId' AND encode(sha256(convert_to(left(k.text,400),'UTF8')),'hex')=g->>'snippetHash' AND(r.snapshot::jsonb->'scene'->'app'->'collectionIds') ? c.id) THEN RETURN false;END IF;
 END LOOP;RETURN true;
EXCEPTION WHEN data_exception THEN RETURN false;
END $dg$;
CREATE FUNCTION dg_native_live_knowledge_answer_valid(target text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
 SELECT coalesce((SELECT q.answer_kind='knowledge' AND l.session_id=q.session_id AND l.answer_hash=encode(sha256(convert_to(q.answer,'UTF8')),'hex') AND l.citations=q.citations AND(q.prepared_epoch::text)=l.source_guard::jsonb->>'preparedEpoch' AND dg_native_live_knowledge_sources_valid(q.id) FROM live_audience_events q JOIN _dg_native_live_knowledge_answers l ON l.question_id=q.id WHERE q.id=target),false)
$dg$;
CREATE FUNCTION dg_native_live_knowledge_answer_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
 IF NEW.answer_kind='knowledge' AND(TG_OP='INSERT' OR OLD.answer IS NULL OR NEW.status='playing' AND OLD.status<>'playing') AND NOT EXISTS(SELECT 1 FROM _dg_native_live_knowledge_answers l WHERE l.question_id=NEW.id AND l.session_id=NEW.session_id AND l.answer_hash=encode(sha256(convert_to(NEW.answer,'UTF8')),'hex') AND l.citations=NEW.citations AND(NEW.prepared_epoch::text)=l.source_guard::jsonb->>'preparedEpoch' AND dg_native_live_knowledge_sources_valid(NEW.id)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Knowledge reply requires its immutable exact public source receipt';END IF;RETURN NEW;
END $dg$;
CREATE TRIGGER native_live_knowledge_answer_guard BEFORE INSERT OR UPDATE ON live_audience_events FOR EACH ROW EXECUTE FUNCTION dg_native_live_knowledge_answer_guard();
CREATE FUNCTION dg_native_knowledge_invalidate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE field text;target text;reason text;
BEGIN
 IF TG_TABLE_NAME='knowledge_documents' THEN field:='documentId';target:=NEW.id;reason:='原知识文档已修订、发布或撤回，旧引用不再采用。';
 ELSE field:='collectionId';target:=NEW.id;reason:='原知识库范围已修订，旧引用不再采用。';END IF;
 UPDATE live_sessions s SET invalidated_at=dg_utc_now(),invalidation_reason=reason,version=version+1,updated_at=dg_utc_now() WHERE s.invalidated_at IS NULL AND EXISTS(SELECT 1 FROM _dg_native_live_knowledge_answers a WHERE a.session_id=s.id AND EXISTS(SELECT 1 FROM jsonb_array_elements(a.source_guard::jsonb->'sources') g WHERE g->>field=target) AND(s.state::jsonb->>'answerId'=a.question_id OR EXISTS(SELECT 1 FROM live_segments p WHERE p.session_id=s.id AND p.segment::jsonb->>'answerId'=a.question_id)));
 UPDATE live_audience_events q SET status='cancelled',version=version+1 WHERE q.status='ready' AND q.answer_kind='knowledge' AND EXISTS(SELECT 1 FROM _dg_native_live_knowledge_answers a WHERE a.question_id=q.id AND EXISTS(SELECT 1 FROM jsonb_array_elements(a.source_guard::jsonb->'sources') g WHERE g->>field=target));
 RETURN NULL;
END $dg$;
CREATE TRIGGER native_knowledge_document_invalidate AFTER UPDATE ON knowledge_documents FOR EACH ROW EXECUTE FUNCTION dg_native_knowledge_invalidate();
CREATE TRIGGER native_knowledge_collection_invalidate AFTER UPDATE ON knowledge_collections FOR EACH ROW EXECUTE FUNCTION dg_native_knowledge_invalidate();
CREATE FUNCTION dg_native_scene_invalidate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
BEGIN
 UPDATE live_sessions SET invalidated_at=dg_utc_now(),invalidation_reason='原公开场景配置已变化或停用，请采用当前配置新建场次。',version=version+1,updated_at=dg_utc_now() WHERE invalidated_at IS NULL AND snapshot::jsonb->'scene'->'app'->>'id'=NEW.id;
 RETURN NULL;
END $dg$;
CREATE TRIGGER native_scene_invalidate AFTER UPDATE ON scene_apps FOR EACH ROW EXECUTE FUNCTION dg_native_scene_invalidate();
REVOKE ALL ON FUNCTION dg_native_knowledge_collection_guard(),dg_native_knowledge_document_guard(),dg_native_knowledge_version_guard(),dg_native_knowledge_pointer_guard(),dg_native_knowledge_chunk_guard(),dg_native_scene_guard(),dg_native_knowledge_history_guard(),dg_native_live_scene_valid(text),dg_native_live_knowledge_sources_valid(text),dg_native_live_knowledge_answer_valid(text),dg_native_live_knowledge_answer_guard(),dg_native_knowledge_invalidate(),dg_native_scene_invalidate() FROM PUBLIC;

-- Scene asset deadlines participate in the same fixed recording minimum.
CREATE OR REPLACE FUNCTION dg_native_queue_live_timeline(target text,rid text,snapshot_text text,snapshot_digest text,guard_text text,guard_digest text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE s live_sessions;v jsonb:=snapshot_text::jsonb;g jsonb:=guard_text::jsonb;segments jsonb;deadline text;at_time text:=dg_utc_now();initial_status text:='queued';reason text;prior text;
BEGIN
 SELECT * INTO STRICT s FROM live_sessions WHERE id=target FOR UPDATE;
 SELECT id INTO prior FROM live_recordings WHERE session_id=target;IF prior IS NOT NULL THEN RETURN prior;END IF;
 SELECT coalesce(jsonb_agg(segment::jsonb ORDER BY seq),'[]'::jsonb) INTO segments FROM live_segments WHERE session_id=target;
 SELECT min(value) INTO deadline FROM(SELECT j->>'expiresAt' AS value FROM jsonb_array_elements(s.snapshot::jsonb->'sources') j UNION ALL SELECT j->>'expiresAt' FROM jsonb_array_elements(s.snapshot::jsonb->'definition'->'products') j UNION ALL SELECT j->>'expiresAt' FROM jsonb_array_elements(coalesce(s.snapshot::jsonb->'scene'->'assets','[]'::jsonb)) j UNION ALL SELECT to_char((s.ended_at::timestamptz AT TIME ZONE 'UTC')+interval '30 days','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) d;
 IF NOT COALESCE(s.status='ended' AND s.started_at IS NOT NULL AND s.kind<>'preview' AND s.snapshot::jsonb->'definition'->>'recordingEnabled'='true' AND s.environment='mock' AND s.app_env IN('development','sandbox') AND NOT EXISTS(SELECT 1 FROM live_outputs WHERE session_id=target) AND rid ~ '^[a-f0-9-]{36}$' AND snapshot_digest=encode(sha256(convert_to(snapshot_text,'UTF8')),'hex') AND guard_digest=encode(sha256(convert_to(guard_text,'UTF8')),'hex') AND v->>'schemaVersion'='1' AND v->>'pipeline'='native-live-timeline-v1' AND v->>'sessionId'=s.id AND v->>'sessionHash'=s.snapshot_hash AND v->>'stateHash'=s.state_hash AND(v->>'durationMs')::bigint=(s.state::jsonb->>'elapsedMs')::bigint AND(v->>'durationMs')::bigint BETWEEN 0 AND 1800000 AND v->'segments'=segments AND jsonb_array_length(segments)<=600 AND jsonb_typeof(v->'usedCueIds')='array' AND g->>'schemaVersion'='1' AND g->>'pipeline'='native-live-timeline-v1' AND g->>'sessionId'=s.id AND g->>'sessionHash'=s.snapshot_hash AND g->>'stateHash'=s.state_hash AND g->>'segmentsHash' ~ '^[a-f0-9]{64}$' AND g->>'expiresAt'=deadline,false) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Timeline queue must match the actual stopped session and immutable segments';END IF;
 IF(v->>'durationMs')::bigint<1000 THEN initial_status:='failed';reason:='本场播出时间轴不足一秒，不能制作归档；请新建场次完整播出。';
 ELSIF(SELECT count(*) FROM live_recordings WHERE tenant_id=s.tenant_id AND capture_kind='local_timeline_reconstruction' AND status IN('queued','rendering'))>=3 THEN initial_status:='failed';reason:='组织已有三条等待或执行的时间轴归档，完成或取消后可明确重试。';END IF;
 INSERT INTO live_recordings(id,session_id,tenant_id,workspace_id,actor_id,snapshot,snapshot_hash,source_guard,source_guard_hash,status,error_message,environment,app_env,created_at,updated_at,capture_kind) VALUES(rid,s.id,s.tenant_id,s.workspace_id,s.actor_id,snapshot_text,snapshot_digest,guard_text,guard_digest,initial_status,reason,'mock',s.app_env,at_time,at_time,'local_timeline_reconstruction');
 INSERT INTO _dg_native_live_timeline_inputs VALUES(rid,snapshot_text,snapshot_digest,guard_text,guard_digest,at_time);RETURN rid;
END $dg$;
