CREATE FUNCTION dg_native_food_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j jsonb:=to_jsonb(NEW);previous jsonb:=to_jsonb(OLD);p dining_parties%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' OR NOT dg_native_dining_changed(TG_TABLE_NAME,j->>'id') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Food records require their scoped native operation';END IF;
 SELECT * INTO p FROM dining_parties WHERE id=j->>'party_id';IF p.id IS NULL OR NOT EXISTS(SELECT 1 FROM _dg_native_dining_party_origins WHERE party_id=p.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Food records retain their native party';END IF;
 IF NOT EXISTS(SELECT 1 FROM _dg_native_dining_changes changed JOIN _dg_native_dining_actions action ON action.id=changed.action_id WHERE changed.table_name=TG_TABLE_NAME AND changed.resource_id=j->>'id' AND changed.transaction_id=pg_current_xact_id()::text AND action.transaction_id=changed.transaction_id AND action.resource_id=p.id AND action.restaurant_id=p.restaurant_id AND action.kind IN('food_draft','food_confirm','food_recommend','food_expire')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Food effects cannot borrow unrelated actions';END IF;
 IF TG_TABLE_NAME='dining_preferences' THEN
  IF j->>'status' NOT IN('draft','confirmed','superseded','expired') OR j->>'source' NOT IN('guest_manual','staff_confirmation') OR j->>'source_fact_ids'<>'[]' OR j->>'source_import_id' IS NOT NULL OR j->>'expires_at'<=j->>'created_at' OR(j->>'expires_at')::timestamptz>(j->>'created_at')::timestamptz+interval '24 hours' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Preference source and original deadline are bounded';END IF;
  IF j->>'status'='expired' THEN IF j->>'expires_at'>dg_native_dining_now() OR j->>'payload'<>'{}' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Expired preferences are redacted only at their original deadline';END IF;ELSE PERFORM dg_native_food_fields((j->>'payload')::jsonb);END IF;
  IF TG_OP='INSERT' THEN
   IF j->>'status'<>'draft' OR(j->>'revision')::bigint<>coalesce((SELECT max(revision) FROM dining_preferences WHERE party_id=p.id),0)+1 OR j->>'confirmed_at' IS NOT NULL OR j->>'confirmed_by' IS NOT NULL OR j->>'confirmed_focus_version' IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Native preference creation is an unconfirmed next revision';END IF;
  ELSE
   IF j-ARRAY['status','confirmed_at','confirmed_by','confirmed_focus_version','payload'] IS DISTINCT FROM previous-ARRAY['status','confirmed_at','confirmed_by','confirmed_focus_version','payload'] OR j->>'status'=previous->>'status' OR NOT(previous->>'status'='draft' AND j->>'status' IN('confirmed','superseded','expired') OR previous->>'status'='confirmed' AND j->>'status' IN('superseded','expired') OR previous->>'status'='superseded' AND j->>'status'='expired') OR j->>'status'<>'expired' AND j->>'payload' IS DISTINCT FROM previous->>'payload' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Preference payload, source, revision and original expiry are immutable';END IF;
   IF j->>'status'='confirmed' THEN
    IF j->>'confirmed_at' IS NULL OR j->>'confirmed_by' IS NULL OR j->>'confirmed_at'>=j->>'expires_at' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Confirmation is explicit and before the original deadline';END IF;
   ELSIF j-ARRAY['status','payload'] IS DISTINCT FROM previous-ARRAY['status','payload'] THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Superseding or expiring cannot rewrite a previous confirmation';END IF;
  END IF;
 ELSE
  IF TG_TABLE_NAME<>'dining_recommendations' OR TG_OP<>'INSERT' OR j->>'expires_at'<=j->>'created_at' OR(j->>'expires_at')::timestamptz<>(j->>'created_at')::timestamptz+interval '15 minutes' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Recommendation receipts are immutable with the original fifteen-minute expiry';END IF;
 END IF;RETURN NEW;
END;$dg$;
CREATE TRIGGER native_food_preference_guard BEFORE INSERT OR UPDATE OR DELETE ON dining_preferences FOR EACH ROW EXECUTE FUNCTION dg_native_food_guard();
CREATE TRIGGER native_food_recommendation_guard BEFORE INSERT OR UPDATE OR DELETE ON dining_recommendations FOR EACH ROW EXECUTE FUNCTION dg_native_food_guard();

CREATE FUNCTION dg_native_food_final() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $dg$
DECLARE j jsonb:=to_jsonb(NEW);p dining_parties%ROWTYPE;f dining_preferences%ROWTYPE;rec dining_recommendations%ROWTYPE;o _dg_native_food_preference_origins%ROWTYPE;c _dg_native_food_confirmations%ROWTYPE;ro _dg_native_food_recommendation_origins%ROWTYPE;a _dg_native_dining_actions%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='dining_parties' THEN
  SELECT * INTO p FROM dining_parties WHERE id=j->>'id';IF p.current_preference_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM _dg_native_food_preference_origins origin JOIN dining_preferences pref ON pref.id=origin.preference_id WHERE pref.id=p.current_preference_id AND origin.party_id=p.id AND pref.party_id=p.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Current preference pointer belongs to the same native party';END IF;RETURN NULL;
 ELSIF TG_TABLE_NAME IN('dining_preferences','_dg_native_food_preference_origins','_dg_native_food_confirmations') THEN
  SELECT * INTO f FROM dining_preferences WHERE id=CASE WHEN TG_TABLE_NAME='dining_preferences' THEN j->>'id' ELSE j->>'preference_id' END;SELECT * INTO o FROM _dg_native_food_preference_origins WHERE preference_id=f.id;SELECT * INTO p FROM dining_parties WHERE id=f.party_id;SELECT * INTO a FROM _dg_native_dining_actions WHERE id=o.action_id;
  IF f.id IS NULL OR o.preference_id IS NULL OR o.runtime_id IS DISTINCT FROM(SELECT runtime_id FROM _dg_native_runtime_control WHERE id=1) OR o.party_id<>f.party_id OR a.kind<>'food_draft' OR a.resource_id<>p.id OR a.restaurant_id<>p.restaurant_id OR o.created_at<>f.created_at OR o.expires_at<>f.expires_at OR f.status<>'expired' AND o.payload_hash<>dg_native_office_hash(f.payload::jsonb) OR f.session_id IS DISTINCT FROM a.session_id OR f.focus_version IS DISTINCT FROM a.focus_version OR f.actor_id<>a.actor_id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Preference keeps its actual draft action, scope, source payload and original clock';END IF;
  SELECT * INTO c FROM _dg_native_food_confirmations WHERE preference_id=f.id;
  IF f.status='confirmed' AND c.preference_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Confirmed preference needs its immutable confirmation basis';END IF;
  IF c.preference_id IS NOT NULL THEN
   SELECT * INTO a FROM _dg_native_dining_actions WHERE id=c.action_id;
   IF a.kind<>'food_confirm' OR a.resource_id<>p.id OR a.restaurant_id<>p.restaurant_id OR f.confirmed_by IS DISTINCT FROM a.actor_id OR f.confirmed_focus_version IS DISTINCT FROM a.focus_version OR c.actor_type<>a.actor_type OR f.confirmed_at<>c.created_at OR a.transaction_id=pg_current_xact_id()::text AND(c.party_version<>p.version OR c.party_access_version<>p.access_version OR c.owner_session_id IS DISTINCT FROM p.owner_session_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Confirmation keeps the actual actor, party and owner basis';END IF;
  END IF;
 ELSE
  SELECT * INTO rec FROM dining_recommendations WHERE id=CASE WHEN TG_TABLE_NAME='dining_recommendations' THEN j->>'id' ELSE j->>'recommendation_id' END;SELECT * INTO ro FROM _dg_native_food_recommendation_origins WHERE recommendation_id=rec.id;SELECT * INTO p FROM dining_parties WHERE id=rec.party_id;SELECT * INTO a FROM _dg_native_dining_actions WHERE id=ro.action_id;
  IF rec.id IS NULL OR ro.recommendation_id IS NULL OR ro.party_id<>p.id OR a.kind<>'food_recommend' OR a.resource_id<>p.id OR a.restaurant_id<>p.restaurant_id OR ro.created_at<>rec.created_at OR ro.expires_at<>rec.expires_at OR ro.payload_hash<>dg_native_office_hash(rec.payload::jsonb) OR NOT EXISTS(SELECT 1 FROM _dg_native_food_preference_origins WHERE preference_id=rec.preference_id AND party_id=p.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Recommendation retains its actual party, preference, payload and original deadline';END IF;
 END IF;RETURN NULL;
END;$dg$;
CREATE CONSTRAINT TRIGGER native_food_party_pointer_final AFTER INSERT OR UPDATE ON dining_parties DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_food_final();
CREATE CONSTRAINT TRIGGER native_food_preference_final AFTER INSERT OR UPDATE ON dining_preferences DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_food_final();
CREATE CONSTRAINT TRIGGER native_food_preference_origin_final AFTER INSERT ON _dg_native_food_preference_origins DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_food_final();
CREATE CONSTRAINT TRIGGER native_food_confirmation_final AFTER INSERT ON _dg_native_food_confirmations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_food_final();
CREATE CONSTRAINT TRIGGER native_food_recommendation_final AFTER INSERT ON dining_recommendations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_food_final();
CREATE CONSTRAINT TRIGGER native_food_recommendation_origin_final AFTER INSERT ON _dg_native_food_recommendation_origins DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dg_native_food_final();
