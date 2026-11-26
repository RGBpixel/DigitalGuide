CREATE FUNCTION dg_native_food_memory_import_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j jsonb:=to_jsonb(NEW);previous jsonb:=to_jsonb(OLD);
BEGIN
 IF TG_OP='DELETE' OR NOT dg_native_dining_changed('dining_memory_imports',NEW.id) OR NOT EXISTS(
  SELECT 1 FROM _dg_native_dining_changes change JOIN _dg_native_dining_actions action ON action.id=change.action_id
  WHERE change.table_name='dining_memory_imports' AND change.resource_id=NEW.id AND change.transaction_id=pg_current_xact_id()::text
   AND action.transaction_id=change.transaction_id AND action.resource_id=NEW.party_id AND action.kind=CASE WHEN TG_OP='INSERT' THEN 'food_memory' ELSE 'food_memory_redact' END
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Memory snapshots require their actual scoped import or erasure action';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.expires_at<=NEW.created_at OR NEW.expires_at::timestamptz>NEW.created_at::timestamptz+interval '24 hours' OR jsonb_typeof(NEW.facts::jsonb)<>'array' OR jsonb_array_length(NEW.facts::jsonb)>20 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Memory suggestions keep their bounded original snapshot and deadline';END IF;
 ELSE
  IF j-'facts' IS DISTINCT FROM previous-'facts' OR NEW.facts<>'[]' OR NOT EXISTS(SELECT 1 FROM _dg_native_food_memory_import_revocations WHERE import_id=NEW.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Memory snapshot cleanup cannot replace identity, consent or original clocks';END IF;
 END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_food_memory_import_guard BEFORE INSERT OR UPDATE OR DELETE ON dining_memory_imports FOR EACH ROW EXECUTE FUNCTION dg_native_food_memory_import_guard();

CREATE FUNCTION dg_native_food_memory_import_final() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j jsonb:=to_jsonb(NEW);import_value text;o _dg_native_food_memory_import_origins%ROWTYPE;i dining_memory_imports%ROWTYPE;a _dg_native_dining_actions%ROWTYPE;revocation _dg_native_food_memory_import_revocations%ROWTYPE;descriptors jsonb;
BEGIN
 import_value:=CASE WHEN TG_TABLE_NAME='dining_memory_imports' THEN j->>'id' ELSE j->>'import_id' END;
 SELECT * INTO o FROM _dg_native_food_memory_import_origins WHERE import_id=import_value;SELECT * INTO i FROM dining_memory_imports WHERE id=import_value;SELECT * INTO a FROM _dg_native_dining_actions WHERE id=o.action_id;SELECT * INTO revocation FROM _dg_native_food_memory_import_revocations WHERE import_id=import_value;
 IF o.import_id IS NULL OR i.id IS NULL OR o.runtime_id IS DISTINCT FROM(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1)
  OR o.party_id<>i.party_id OR o.person_id<>i.person_id OR o.session_id<>i.session_id OR o.focus_version<>i.focus_version
  OR o.created_at<>i.created_at OR o.expires_at<>i.expires_at OR a.kind<>'food_memory' OR a.actor_type<>'guest' OR a.resource_id<>i.party_id
  OR a.session_id IS DISTINCT FROM i.session_id OR a.access_id IS DISTINCT FROM o.access_id OR a.focus_version IS DISTINCT FROM i.focus_version OR a.selection_version IS DISTINCT FROM o.selection_version
  OR NOT dg_native_food_memory_scope_matches(i.person_id,i.session_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Imported suggestions keep their actual person, scope, source action and original deadline';END IF;
 IF revocation.import_id IS NULL THEN
  SELECT coalesce(jsonb_agg((value-'value')||jsonb_build_object('valueHash',dg_native_office_hash(value->'value'))),'[]') INTO descriptors FROM jsonb_array_elements(i.facts::jsonb);
  IF o.facts_hash<>dg_native_office_hash(i.facts::jsonb) OR o.fact_descriptors<>descriptors OR NOT dg_native_food_memory_import_valid(import_value) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Imported fact values and versions must remain authorized at commit';END IF;
 ELSE
  SELECT * INTO a FROM _dg_native_dining_actions WHERE id=revocation.action_id;
  IF i.facts<>'[]' OR a.kind<>'food_memory_redact' OR a.resource_id<>i.party_id OR revocation.transaction_id<>a.transaction_id OR revocation.created_at<>a.created_at OR EXISTS(SELECT 1 FROM dining_preferences WHERE source_import_id=import_value AND payload<>'{}') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Revocation atomically removes imported and derived private payloads';END IF;
 END IF;RETURN NULL;
END;$dg$;
CREATE CONSTRAINT TRIGGER native_food_memory_snapshot_final AFTER INSERT OR UPDATE ON dining_memory_imports DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_food_memory_import_final();
CREATE CONSTRAINT TRIGGER native_food_memory_import_origin_final AFTER INSERT ON _dg_native_food_memory_import_origins DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_food_memory_import_final();
CREATE CONSTRAINT TRIGGER native_food_memory_import_revocation_final AFTER INSERT ON _dg_native_food_memory_import_revocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_food_memory_import_final();

CREATE FUNCTION dg_native_food_memory_preference_final() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE f dining_preferences%ROWTYPE;o _dg_native_food_memory_import_origins%ROWTYPE;source_value text;
BEGIN
 SELECT * INTO f FROM dining_preferences WHERE id=NEW.id;IF f.source<>'memory_suggestion' THEN RETURN NULL;END IF;SELECT * INTO o FROM _dg_native_food_memory_import_origins WHERE import_id=f.source_import_id;
 IF o.import_id IS NULL OR o.party_id<>f.party_id OR o.session_id IS DISTINCT FROM f.session_id OR o.focus_version IS DISTINCT FROM f.focus_version OR f.expires_at>o.expires_at THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Derived preferences retain their original purpose and source deadline';END IF;
 FOR source_value IN SELECT jsonb_array_elements_text(f.source_fact_ids::jsonb) LOOP
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(o.fact_descriptors) descriptor WHERE descriptor->>'id'=source_value) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Derived preferences only cite selected source facts';END IF;
 END LOOP;RETURN NULL;
END;$dg$;
CREATE CONSTRAINT TRIGGER native_food_memory_preference_final AFTER INSERT OR UPDATE ON dining_preferences DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_food_memory_preference_final();
