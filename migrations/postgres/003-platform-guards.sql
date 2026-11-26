-- DigitalGuide PostgreSQL baseline, SQLite source through 052.
-- Independently versioned native SQL; apply only through the offline staging importer.

CREATE FUNCTION dg_utc_now() RETURNS text LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$ SELECT to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;

CREATE FUNCTION "dg_trigger_08d415f09dc3b39e4e02b24f"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Advertising account identity is immutable';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "ad_account_identity_immutable" BEFORE UPDATE OF tenant_id,workspace_id,platform,mode,currency,timezone,environment,app_env ON "ad_accounts" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_08d415f09dc3b39e4e02b24f"();

CREATE FUNCTION "dg_trigger_f5764918f38985e77e231c85"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Advertising approval scope is immutable';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "ad_approval_scope_immutable" BEFORE UPDATE OF campaign_id,definition_version,requester_id,reviewer_id,snapshot,snapshot_hash ON "ad_campaign_reviews" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_f5764918f38985e77e231c85"();

CREATE FUNCTION "dg_trigger_6ea15b939d92af78c5cafa2a"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Advertising event source is immutable';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "ad_callback_source_immutable" BEFORE UPDATE OF event_id,run_id,payload_hash,first_fetched_at ON "ad_callback_events" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_6ea15b939d92af78c5cafa2a"();

CREATE FUNCTION "dg_trigger_4c8fffb01f7201e5b9eb02c4"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Advertising campaign account and scope are immutable';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "ad_campaign_account_immutable" BEFORE UPDATE OF tenant_id,workspace_id,actor_id,account_id,environment,app_env ON "ad_campaigns" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_4c8fffb01f7201e5b9eb02c4"();

CREATE FUNCTION "dg_trigger_2b24fc9c7fb37e95aacf50e3"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Advertising plan history is immutable';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "ad_campaign_history_immutable" BEFORE UPDATE ON "ad_campaign_versions" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_2b24fc9c7fb37e95aacf50e3"();

CREATE FUNCTION "dg_trigger_3b2e4a99e83898a1e0559f36"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Advertising spend ledger is append-only';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "ad_ledger_immutable" BEFORE UPDATE ON "ad_spend_ledger" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_3b2e4a99e83898a1e0559f36"();

CREATE FUNCTION "dg_trigger_03616a78529ab6a8656dd581"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Advertising metric events are append-only';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "ad_metrics_immutable" BEFORE UPDATE ON "ad_campaign_metrics" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_03616a78529ab6a8656dd581"();

CREATE FUNCTION "dg_trigger_f75dd2220fe5c6f4d3266c10"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Advertising operation input is immutable';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "ad_operation_input_immutable" BEFORE UPDATE OF run_id,action,input,input_hash ON "ad_operations" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_f75dd2220fe5c6f4d3266c10"();

CREATE FUNCTION "dg_trigger_c92358f8cedc23fbd79d2974"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Advertising budget history is immutable';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "ad_policy_history_immutable" BEFORE UPDATE ON "ad_budget_policy_versions" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_c92358f8cedc23fbd79d2974"();

CREATE FUNCTION "dg_trigger_eeb1299095a1c78de72f854a"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Advertising reconciliation records are immutable';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "ad_reconciliation_immutable" BEFORE UPDATE ON "ad_reconciliations" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_eeb1299095a1c78de72f854a"();

CREATE FUNCTION "dg_trigger_40593c3cb4501151414f49fe"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Advertising execution snapshot is immutable';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "ad_run_snapshot_immutable" BEFORE UPDATE OF campaign_id,generation,definition_version,review_id,actor_id,snapshot,snapshot_hash ON "ad_runs" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_40593c3cb4501151414f49fe"();

CREATE FUNCTION "dg_trigger_483814954beb4fb9b9fb3d2c"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='AE batch sources are immutable';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "ae_batch_source_immutable" BEFORE UPDATE OF tenant_id,workspace_id,actor_id,template_id,template_version,catalog_id,catalog_revision,manifest,manifest_sha256,runtime_id,mode,kind,input_format,input_content,plan_hash,environment,app_env ON "ae_batches" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_483814954beb4fb9b9fb3d2c"();

CREATE FUNCTION "dg_trigger_ad99449facabfcd675fd1edf"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='AE adoption input is immutable';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "ae_media_input_immutable" BEFORE UPDATE OF tenant_id,workspace_id,actor_id,artifact_id,batch_id,job_id,name,rights_note,expires_at,snapshot,snapshot_hash,plan_hash,environment,app_env,created_at ON "ae_media_adoptions" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_ad99449facabfcd675fd1edf"();

CREATE FUNCTION "dg_trigger_e9eadaaf437d31a2be391f86"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
IF (OLD.asset_id IS NOT NULL) THEN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='AE adoption result is immutable';
END IF;
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "ae_media_result_immutable" BEFORE UPDATE OF asset_id,project_id,inspection_runtime ON "ae_media_adoptions" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_e9eadaaf437d31a2be391f86"();

CREATE FUNCTION "dg_trigger_527a335dc464fefab43236f8"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
IF (OLD.asset_id IS NOT NULL) THEN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='AE adoption provenance cannot be deleted';
END IF;
RETURN OLD;
END;
$dg$;
CREATE TRIGGER "ae_media_result_not_deleted" BEFORE DELETE ON "ae_media_adoptions" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_527a335dc464fefab43236f8"();

CREATE FUNCTION "dg_trigger_5ded221dd0163392bfdbf411"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
IF (OLD.status='withdrawn') THEN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='AE adoption withdrawal is final';
END IF;
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "ae_media_withdrawal_final" BEFORE UPDATE ON "ae_media_adoptions" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_5ded221dd0163392bfdbf411"();

CREATE FUNCTION "dg_trigger_5e0dc8cb76b65eb37bfc2345"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
IF (OLD.storage_key IS NOT NULL) THEN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='AE source artifacts are immutable';
END IF;
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "ae_source_artifact_immutable" BEFORE UPDATE OF storage_key,size,sha256 ON "ae_source_exports" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_5e0dc8cb76b65eb37bfc2345"();

CREATE FUNCTION "dg_trigger_b4233f2afaa8e234acb038a1"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='AE source inputs are immutable';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "ae_source_input_immutable" BEFORE UPDATE OF tenant_id,workspace_id,actor_id,name,template_id,template_version,catalog_id,catalog_revision,manifest,manifest_file,manifest_sha256,manifest_size,mode,plan_hash,environment,app_env,created_at ON "ae_source_exports" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_b4233f2afaa8e234acb038a1"();

CREATE FUNCTION "dg_trigger_d7ccdf3b7c55a56de0f66669"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
IF (OLD.status='withdrawn') THEN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='AE source withdrawal is final';
END IF;
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "ae_source_withdrawal_final" BEFORE UPDATE ON "ae_source_exports" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_d7ccdf3b7c55a56de0f66669"();

CREATE FUNCTION "dg_trigger_a1efaaf1ad6e13852efd89fb"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='AE template revisions are immutable';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "ae_template_version_immutable" BEFORE UPDATE ON "ae_template_versions" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_a1efaaf1ad6e13852efd89fb"();

CREATE FUNCTION "dg_trigger_5506c2be5919be99b873884f"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='AE template revisions are retained';
RETURN OLD;
END;
$dg$;
CREATE TRIGGER "ae_template_version_no_delete" BEFORE DELETE ON "ae_template_versions" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_5506c2be5919be99b873884f"();

CREATE FUNCTION "dg_trigger_5c50d6bec3bf68840894ab49"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
UPDATE asset_collection_links SET revoked_at=coalesce(revoked_at,dg_utc_now()),version=version+1
 WHERE actor_id=OLD.user_id AND revoked_at IS NULL AND
 (tenant_id<>NEW.tenant_id OR NEW.role NOT IN ('admin','editor') OR NOT EXISTS(SELECT 1 FROM json_array_elements_text((NEW.workspace_ids)::json) AS dg_workspace(value) WHERE value=asset_collection_links.workspace_id));
 UPDATE asset_collections SET closed_at=coalesce(closed_at,dg_utc_now()),close_reason='issuer_permission_changed',version=version+1
 WHERE actor_id=OLD.user_id AND closed_at IS NULL AND
 (tenant_id<>NEW.tenant_id OR NEW.role NOT IN ('admin','editor') OR NOT EXISTS(SELECT 1 FROM json_array_elements_text((NEW.workspace_ids)::json) AS dg_workspace(value) WHERE value=asset_collections.workspace_id));
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "asset_collection_membership_change" AFTER UPDATE ON "memberships" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_5c50d6bec3bf68840894ab49"();

CREATE FUNCTION "dg_trigger_14fd62e267b51a999ec22e82"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
UPDATE asset_collection_links SET revoked_at=coalesce(revoked_at,dg_utc_now()),version=version+1 WHERE actor_id=OLD.user_id AND revoked_at IS NULL;
 UPDATE asset_collections SET closed_at=coalesce(closed_at,dg_utc_now()),close_reason='issuer_permission_changed',version=version+1 WHERE actor_id=OLD.user_id AND closed_at IS NULL;
RETURN OLD;
END;
$dg$;
CREATE TRIGGER "asset_collection_membership_delete" AFTER DELETE ON "memberships" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_14fd62e267b51a999ec22e82"();

CREATE FUNCTION "dg_trigger_20f7e482a11e1ab57af60bc7"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
UPDATE asset_library_families SET version=version+1,updated_at=dg_utc_now()
 WHERE id=(SELECT family_id FROM asset_library_revisions WHERE asset_id=NEW.id);
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "asset_library_asset_change" AFTER UPDATE ON "assets" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_20f7e482a11e1ab57af60bc7"();

CREATE FUNCTION "dg_trigger_e2ee7e1c96bf84078f9e68e7"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
INSERT INTO asset_library_families(id,tenant_id,workspace_id,name,name_key,created_at,updated_at)
 VALUES(NEW.id,NEW.tenant_id,NEW.workspace_id,NEW.name,lower(NEW.name),NEW.created_at,NEW.created_at);
 INSERT INTO asset_library_revisions(asset_id,family_id,ordinal,upload_id,sha256,size,media_type,created_at)
 SELECT NEW.id,NEW.id,1,NEW.upload_id,sha256,size,media_type,NEW.created_at FROM uploads WHERE id=NEW.upload_id;
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "asset_library_insert" AFTER INSERT ON "assets" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_e2ee7e1c96bf84078f9e68e7"();

CREATE FUNCTION "dg_trigger_6377ce8b4adba26c166c2594"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
IF (OLD.archived<>NEW.archived) THEN
INSERT INTO asset_library_consent_revocations(consent_id,asset_id,asset_version,reason,revoked_at)
 SELECT id,NEW.id,NEW.version,'asset_recycle_or_restore',dg_utc_now() FROM consents WHERE asset_id=NEW.id AND revoked_at IS NULL ON CONFLICT DO NOTHING;
 UPDATE consents SET revoked_at=dg_utc_now() WHERE asset_id=NEW.id AND revoked_at IS NULL;
END IF;
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "asset_library_recycle_consents" AFTER UPDATE OF archived ON "assets" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_6377ce8b4adba26c166c2594"();

CREATE FUNCTION "dg_trigger_4b82864b40040cb51d70c3b4"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Fixed governance intake';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "content_governance_delivery_source_immutable" BEFORE UPDATE OF tenant_id,workspace_id,actor_id,variant_id,variant_version,platform,policy_id,policy_version,policy_hash,source_hash,source_snapshot,input,plan,plan_hash,public_id,environment,app_env,created_at ON "content_governance_deliveries" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_4b82864b40040cb51d70c3b4"();

CREATE FUNCTION "dg_trigger_4efd9d1aa525e29fcf481bcc"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
UPDATE content_governance_reviews SET invalidated_at=COALESCE(invalidated_at,dg_utc_now()),invalidation_reason='审核或提交成员已离开，请重新指定。',version=version+1 WHERE (reviewer_id=OLD.user_id OR requester_id=OLD.user_id) AND invalidated_at IS NULL AND status IN ('pending','approved');
RETURN OLD;
END;
$dg$;
CREATE TRIGGER "content_governance_membership_deleted" AFTER DELETE ON "memberships" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_4efd9d1aa525e29fcf481bcc"();

CREATE FUNCTION "dg_trigger_1cbd8ba2aa5376804f90d6fa"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
IF (OLD.tenant_id<>NEW.tenant_id OR OLD.role<>NEW.role OR OLD.workspace_ids<>NEW.workspace_ids) THEN
UPDATE content_governance_reviews SET invalidated_at=COALESCE(invalidated_at,dg_utc_now()),invalidation_reason='审核或提交成员的角色/空间已变化，请重新核对并提交。',version=version+1 WHERE (reviewer_id=OLD.user_id OR requester_id=OLD.user_id) AND invalidated_at IS NULL AND status IN ('pending','approved');
END IF;
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "content_governance_membership_updated" AFTER UPDATE ON "memberships" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_1cbd8ba2aa5376804f90d6fa"();

CREATE FUNCTION "dg_trigger_32945e279b471414c0c63f87"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Fixed policy history';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "content_governance_policy_history_immutable" BEFORE UPDATE ON "content_governance_policy_versions" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_32945e279b471414c0c63f87"();

CREATE FUNCTION "dg_trigger_28813d757c0efda6937cc43d"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Content writing adoption is immutable';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "content_writing_adoption_immutable" BEFORE UPDATE ON "studio_content_writing_adoptions" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_28813d757c0efda6937cc43d"();

CREATE FUNCTION "dg_trigger_79cf7fbcfe6fa8e6d46477c9"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Content writing input is immutable';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "content_writing_input_immutable" BEFORE UPDATE OF tenant_id,workspace_id,actor_id,environment,app_env,request,engine,input_hash ON "studio_content_writing_jobs" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_79cf7fbcfe6fa8e6d46477c9"();

CREATE FUNCTION "dg_trigger_91ed89e15003671d85e8359e"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
IF (OLD.result_hash IS NOT NULL) THEN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Content writing result is immutable';
END IF;
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "content_writing_result_immutable" BEFORE UPDATE OF result,evidence,result_hash ON "studio_content_writing_jobs" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_91ed89e15003671d85e8359e"();

CREATE FUNCTION "dg_trigger_36cc0e0a83568a8c7eb7dd0e"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
IF (OLD.revoked_at IS NOT NULL) THEN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='course enrolment revocation is permanent';
END IF;
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "course_enrollment_revoked" BEFORE UPDATE OF revoked_at ON "course_enrollments" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_36cc0e0a83568a8c7eb7dd0e"();

CREATE FUNCTION "dg_trigger_9cff6746345295e529f01921"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
UPDATE course_enrollments SET revoked_at=dg_utc_now(),revocation_reason='membership_removed' WHERE actor_id=OLD.user_id AND revoked_at IS NULL;
RETURN OLD;
END;
$dg$;
CREATE TRIGGER "course_learner_membership_delete" AFTER DELETE ON "memberships" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_9cff6746345295e529f01921"();

CREATE FUNCTION "dg_trigger_b8356b7d0a702146cf63eea5"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
UPDATE course_enrollments SET revoked_at=dg_utc_now(),revocation_reason='membership_scope_changed'
 WHERE actor_id=OLD.user_id AND revoked_at IS NULL AND
 (tenant_id<>NEW.tenant_id OR NOT EXISTS(SELECT 1 FROM json_array_elements_text((NEW.workspace_ids)::json) AS dg_workspace(value) WHERE value=course_enrollments.workspace_id));
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "course_learner_membership_update" AFTER UPDATE ON "memberships" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_b8356b7d0a702146cf63eea5"();

CREATE FUNCTION "dg_trigger_b935012bcd6c80509d2a849d"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
UPDATE distribution_reviews SET invalidated_at=dg_utc_now(),invalidation_reason='审核人员权限已撤回，请重新提交。',version=version+1
 WHERE reviewer_id=OLD.user_id AND status IN ('pending','approved') AND invalidated_at IS NULL;
RETURN OLD;
END;
$dg$;
CREATE TRIGGER "distribution_review_authority_delete" AFTER DELETE ON "memberships" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_b935012bcd6c80509d2a849d"();

CREATE FUNCTION "dg_trigger_16d865cbaaf886cf9310e95f"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
IF (OLD.role<>NEW.role OR OLD.workspace_ids<>NEW.workspace_ids) THEN
UPDATE distribution_reviews SET invalidated_at=dg_utc_now(),invalidation_reason='审核人员权限或空间范围已变更，请重新提交。',version=version+1
 WHERE reviewer_id=OLD.user_id AND status IN ('pending','approved') AND invalidated_at IS NULL;
END IF;
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "distribution_review_authority_update" AFTER UPDATE OF role,workspace_ids ON "memberships" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_16d865cbaaf886cf9310e95f"();

CREATE FUNCTION "dg_trigger_0ec3eb7f71d29a1e71b166ea"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
IF (OLD.answer IS NOT NULL) THEN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Prepared live answer is immutable';
END IF;
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "live_answer_immutable" BEFORE UPDATE OF answer,answer_kind,citations,product_id,prepared_epoch ON "live_audience_events" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_0ec3eb7f71d29a1e71b166ea"();

CREATE FUNCTION "dg_trigger_80914611626276a3ae4464ea"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Live model answer input is immutable';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "live_answer_input_immutable" BEFORE UPDATE OF session_id,question_id,tenant_id,workspace_id,actor_id,environment,app_env,session_hash,request,configuration,controller_version,question_version,configuration_generation,input_hash ON "live_answer_jobs" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_80914611626276a3ae4464ea"();

CREATE FUNCTION "dg_trigger_273591164e14dac20dc17768"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Live model answer origin is immutable';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "live_answer_origin_immutable" BEFORE UPDATE ON "live_answer_origins" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_273591164e14dac20dc17768"();

CREATE FUNCTION "dg_trigger_7bd24e4ab7b4da1d7dadb3a9"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Live model answer origin cannot be deleted';
RETURN OLD;
END;
$dg$;
CREATE TRIGGER "live_answer_origin_preserve" BEFORE DELETE ON "live_answer_origins" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_7bd24e4ab7b4da1d7dadb3a9"();

CREATE FUNCTION "dg_trigger_d71ffb072c4881ec50c904b3"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
IF (OLD.result_hash IS NOT NULL) THEN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Live model answer result is immutable';
END IF;
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "live_answer_result_immutable" BEFORE UPDATE OF result,evidence,result_hash ON "live_answer_jobs" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_d71ffb072c4881ec50c904b3"();

CREATE FUNCTION "dg_trigger_00c0435dbecbfc42bca9abd5"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Live audience input is immutable';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "live_audience_input_immutable" BEFORE UPDATE OF session_id,destination_id,event_id,input_hash,participant_hash,nickname,kind,text,media_opt_in ON "live_audience_events" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_00c0435dbecbfc42bca9abd5"();

CREATE FUNCTION "dg_trigger_c419a3a81035607fb4f33219"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
IF (OLD.status IN ('ended','failed','expired') AND (NEW.status!=OLD.status OR NEW.mix_state!='off_air' OR NEW.server_offer IS NOT NULL OR NEW.guest_answer IS NOT NULL)) THEN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Programme connection cannot restart';
END IF;
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "live_guest_programme_connection_final" BEFORE UPDATE ON "live_guest_programme_connections" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_c419a3a81035607fb4f33219"();

CREATE FUNCTION "dg_trigger_58783f13369b404171e45417"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Programme connection identity is immutable';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "live_guest_programme_connection_identity" BEFORE UPDATE OF id,grant_id,peer_attempt_id,output_id,created_at ON "live_guest_programme_connections" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_58783f13369b404171e45417"();

CREATE FUNCTION "dg_trigger_7514fb4faf62bf66e70143db"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
IF (OLD.status!='requested') THEN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Programme consent is immutable';
END IF;
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "live_guest_programme_consent" BEFORE UPDATE OF camera,microphone,public_name,client_id,statement_version,consent_hash,consented_at,recording_allowed ON "live_guest_programme_grants" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_7514fb4faf62bf66e70143db"();

CREATE FUNCTION "dg_trigger_9f1a5414c6393e232540f5ee"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Programme control input is immutable';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "live_guest_programme_control_identity" BEFORE UPDATE OF id,connection_id,output_id,version,session_version,action,actor_id,requested_at ON "live_guest_programme_controls" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_9f1a5414c6393e232540f5ee"();

CREATE FUNCTION "dg_trigger_d23cef9652f2b85fe2a3bd98"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
IF (OLD.status IN ('rejected','withdrawn','expired') AND (NEW.status!=OLD.status OR NEW.cookie_hash IS NOT NULL)) THEN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Programme withdrawal is final';
END IF;
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "live_guest_programme_final" BEFORE UPDATE ON "live_guest_programme_grants" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_d23cef9652f2b85fe2a3bd98"();

CREATE FUNCTION "dg_trigger_8c643cae7e064e22569539f7"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
IF (OLD.generation_id IS NOT NULL AND NEW.generation_id!=OLD.generation_id) THEN
UPDATE live_guest_programme_connections SET status='ended',mix_state='off_air',version=version+1,server_offer=NULL,server_offer_hash=NULL,guest_answer=NULL,guest_answer_hash=NULL,video_ready=0,audio_ready=0,reason='节目编码代次已变化，需要新的主动授权',updated_at=dg_utc_now() WHERE output_id=NEW.id AND status IN ('queued','connecting','connected');
END IF;
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "live_guest_programme_generation_change" AFTER UPDATE OF generation_id ON "live_outputs" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_8c643cae7e064e22569539f7"();

CREATE FUNCTION "dg_trigger_8b411b7994755f5193ad4be8"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
IF (NEW.status IN ('rejected','withdrawn','expired') AND OLD.status NOT IN ('rejected','withdrawn','expired')) THEN
UPDATE live_guest_programme_grants SET cookie_hash=NULL,withdrawn_at=COALESCE(withdrawn_at,dg_utc_now()) WHERE id=NEW.id;
 UPDATE live_guest_programme_connections SET status='ended',mix_state='off_air',version=version+1,server_offer=NULL,server_offer_hash=NULL,guest_answer=NULL,guest_answer_hash=NULL,video_ready=0,audio_ready=0,reason='节目及录制用途已撤回或到期',updated_at=dg_utc_now() WHERE grant_id=NEW.id AND status IN ('queued','connecting','connected');
END IF;
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "live_guest_programme_grant_cleanup" AFTER UPDATE OF status ON "live_guest_programme_grants" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_8b411b7994755f5193ad4be8"();

CREATE FUNCTION "dg_trigger_9b007de42e99dcdb714cc1b4"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Programme invitation identity is immutable';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "live_guest_programme_identity" BEFORE UPDATE OF id,invite_id,peer_attempt_id,guest_id,session_id,output_id,tenant_id,workspace_id,actor_id,available_camera,available_microphone,recording_required,expires_at,cookie_nonce,environment,app_env,created_at ON "live_guest_programme_grants" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_9b007de42e99dcdb714cc1b4"();

CREATE FUNCTION "dg_trigger_acc9cd36afd80095ae427cce"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
IF (NEW.status IN ('revoked','expired','closed') AND NOT (NEW.status='closed' AND EXISTS(SELECT 1 FROM live_sessions s WHERE s.id=NEW.session_id AND s.status='ended'))) THEN
UPDATE live_guest_programme_grants SET status=CASE WHEN NEW.status='expired' THEN 'expired' ELSE 'withdrawn' END,version=version+1,updated_at=dg_utc_now() WHERE invite_id=NEW.id AND status IN ('requested','consented');
END IF;
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "live_guest_programme_invite_close" AFTER UPDATE OF status ON "live_peer_invites" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_acc9cd36afd80095ae427cce"();

CREATE FUNCTION "dg_trigger_936998f224973b55bebdf9fb"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
IF (NEW.mix_state!=OLD.mix_state OR NEW.audio_muted!=OLD.audio_muted OR NEW.video_hidden!=OLD.video_hidden) THEN
UPDATE live_sessions SET version=version+1,updated_at=dg_utc_now() WHERE id=(SELECT session_id FROM live_outputs WHERE id=NEW.output_id) AND status IN ('live','preview');
END IF;
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "live_guest_programme_mix_change" AFTER UPDATE OF mix_state,audio_muted,video_hidden ON "live_guest_programme_connections" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_936998f224973b55bebdf9fb"();

CREATE FUNCTION "dg_trigger_a23bee0fff5428c61de10394"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
IF (NEW.status!='active') THEN
UPDATE live_guest_programme_connections SET status='ended',mix_state='off_air',version=version+1,server_offer=NULL,server_offer_hash=NULL,guest_answer=NULL,guest_answer_hash=NULL,video_ready=0,audio_ready=0,reason='后台设备连接已结束，节目设备也已停止',updated_at=dg_utc_now() WHERE peer_attempt_id=NEW.id AND status IN ('queued','connecting','connected');
END IF;
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "live_guest_programme_peer_end" AFTER UPDATE OF status ON "live_peer_attempts" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_a23bee0fff5428c61de10394"();

CREATE FUNCTION "dg_trigger_a4c399e0f6645bd47d8cc225"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
IF (OLD.generation_id IS NOT NULL AND (NEW.generation_id IS DISTINCT FROM OLD.generation_id OR NEW.runtime_token IS DISTINCT FROM OLD.runtime_token)) THEN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Programme runtime cannot be rebound';
END IF;
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "live_guest_programme_runtime_identity" BEFORE UPDATE OF generation_id,runtime_token ON "live_guest_programme_connections" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_a4c399e0f6645bd47d8cc225"();

CREATE FUNCTION "dg_trigger_54cdb0940d982fa2fbfe4cda"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Published continuous fragments are immutable';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "live_output_parts_immutable" BEFORE UPDATE ON "live_output_parts" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_54cdb0940d982fa2fbfe4cda"();

CREATE FUNCTION "dg_trigger_0779bce1a760ee5b71e0e073"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Presentation source is immutable';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "live_output_presentation_immutable" BEFORE UPDATE OF output_id,version,presentation,presentation_hash,actor_id ON "live_output_presentations" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_0779bce1a760ee5b71e0e073"();

CREATE FUNCTION "dg_trigger_4916857b263dfe2504c9deae"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Continuous output source is immutable';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "live_output_source_immutable" BEFORE UPDATE OF session_id,tenant_id,workspace_id,actor_id,snapshot,snapshot_hash ON "live_outputs" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_4916857b263dfe2504c9deae"();

CREATE FUNCTION "dg_trigger_dc9ebf7cdfabfeaac0f798c0"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
IF (OLD.status!='active' AND NEW.status='active') THEN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Live peer attempt cannot restart';
END IF;
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "live_peer_attempt_final" BEFORE UPDATE ON "live_peer_attempts" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_dc9ebf7cdfabfeaac0f798c0"();

CREATE FUNCTION "dg_trigger_9bb3465b375c5efedc30aa6a"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Live peer attempt identity is immutable';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "live_peer_attempt_identity" BEFORE UPDATE OF id,invite_id,guest_id,consent_version,host_id,host_client_id,guest_client_id,created_at ON "live_peer_attempts" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_9bb3465b375c5efedc30aa6a"();

CREATE FUNCTION "dg_trigger_d2e9e307765540fe9bf23062"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Live peer consent is immutable';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "live_peer_consent_immutable" BEFORE UPDATE OF guest_id,version,camera,microphone,statement_version,purpose,client_id,expires_at,created_at ON "live_peer_consents" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_d2e9e307765540fe9bf23062"();

CREATE FUNCTION "dg_trigger_6b3cc34eddf43aa7667954a8"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
IF (OLD.status='withdrawn' AND (NEW.status!='withdrawn' OR NEW.cookie_hash IS NOT NULL OR NEW.camera!=0 OR NEW.microphone!=0)) THEN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Live peer withdrawal is final';
END IF;
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "live_peer_guest_final" BEFORE UPDATE ON "live_peer_guests" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_6b3cc34eddf43aa7667954a8"();

CREATE FUNCTION "dg_trigger_f1b7cf5da9f72aca3cdb851a"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
IF (NEW.status IN ('revoked','expired','closed') AND OLD.status NOT IN ('revoked','expired','closed')) THEN
UPDATE live_peer_guests SET nickname='已结束来宾',status='withdrawn',cookie_hash=NULL,camera=0,microphone=0,client_id=NULL,version=version+1,updated_at=dg_utc_now() WHERE invite_id=NEW.id AND status!='withdrawn';
 UPDATE live_peer_consents SET withdrawn_at=COALESCE(withdrawn_at,dg_utc_now()) WHERE guest_id IN (SELECT id FROM live_peer_guests WHERE invite_id=NEW.id);
 UPDATE live_peer_attempts SET status='ended',version=version+1,reason=NEW.reason,updated_at=dg_utc_now() WHERE invite_id=NEW.id AND status='active';
 DELETE FROM live_peer_signals WHERE attempt_id IN (SELECT id FROM live_peer_attempts WHERE invite_id=NEW.id);
END IF;
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "live_peer_invite_cleanup" AFTER UPDATE OF status ON "live_peer_invites" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_f1b7cf5da9f72aca3cdb851a"();

CREATE FUNCTION "dg_trigger_9023e81b29275b3c57455686"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
IF (OLD.status IN ('revoked','expired','closed') AND (NEW.status!=OLD.status OR NEW.access_hash IS NOT NULL OR NEW.consumed_access_hash IS NOT NULL)) THEN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Live peer invitation closure is final';
END IF;
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "live_peer_invite_final" BEFORE UPDATE ON "live_peer_invites" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_9023e81b29275b3c57455686"();

CREATE FUNCTION "dg_trigger_d0e0f2bddaecaa56e493cf3a"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Live peer invitation input is immutable';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "live_peer_invite_identity" BEFORE UPDATE OF id,session_id,tenant_id,workspace_id,actor_id,public_title,expires_at,environment,app_env,created_at ON "live_peer_invites" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_d0e0f2bddaecaa56e493cf3a"();

CREATE FUNCTION "dg_trigger_f17fcb35bfcc65e2a85e69bc"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
IF (NEW.role!=OLD.role OR NEW.workspace_ids!=OLD.workspace_ids OR NEW.tenant_id!=OLD.tenant_id) THEN
UPDATE live_peer_invites SET status='revoked',access_hash=NULL,consumed_access_hash=NULL,reason='邀请人的组织或权限已经变化',version=version+1,updated_at=dg_utc_now() WHERE actor_id=OLD.user_id AND status IN ('issued','used');
 UPDATE live_peer_attempts SET status='ended',version=version+1,reason='主持人的组织或权限已经变化',updated_at=dg_utc_now() WHERE host_id=OLD.user_id AND status='active';
 DELETE FROM live_peer_signals WHERE attempt_id IN (SELECT id FROM live_peer_attempts WHERE host_id=OLD.user_id AND status!='active');
END IF;
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "live_peer_member_change" AFTER UPDATE OF role,workspace_ids,tenant_id ON "memberships" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_f17fcb35bfcc65e2a85e69bc"();

CREATE FUNCTION "dg_trigger_e0af060b3354496615b8f04f"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
UPDATE live_peer_invites SET status='revoked',access_hash=NULL,consumed_access_hash=NULL,reason='邀请人已经离开组织',version=version+1,updated_at=dg_utc_now() WHERE actor_id=OLD.user_id AND status IN ('issued','used');
 UPDATE live_peer_attempts SET status='ended',version=version+1,reason='主持人已经离开组织',updated_at=dg_utc_now() WHERE host_id=OLD.user_id AND status='active';
 DELETE FROM live_peer_signals WHERE attempt_id IN (SELECT id FROM live_peer_attempts WHERE host_id=OLD.user_id AND status!='active');
RETURN OLD;
END;
$dg$;
CREATE TRIGGER "live_peer_member_delete" AFTER DELETE ON "memberships" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_e0af060b3354496615b8f04f"();

CREATE FUNCTION "dg_trigger_7149c9c0c009ad90f81f034a"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
IF (NEW.status IN ('withdrawn','cancelled')) THEN
UPDATE live_peer_invites SET status='closed',access_hash=NULL,consumed_access_hash=NULL,reason='连续节目媒体已撤回或取消',version=version+1,updated_at=dg_utc_now() WHERE session_id=NEW.session_id AND status IN ('issued','used');
END IF;
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "live_peer_output_withdraw" AFTER UPDATE OF status ON "live_outputs" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_7149c9c0c009ad90f81f034a"();

CREATE FUNCTION "dg_trigger_46ee32b28b8abe91b1a7006c"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
IF (NEW.status IN ('ended','failed')) THEN
UPDATE live_peer_invites SET status='closed',access_hash=NULL,consumed_access_hash=NULL,reason='节目已经结束',version=version+1,updated_at=dg_utc_now() WHERE session_id=NEW.id AND status IN ('issued','used');
END IF;
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "live_peer_session_stop" AFTER UPDATE OF status ON "live_sessions" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_46ee32b28b8abe91b1a7006c"();

CREATE FUNCTION "dg_trigger_328b2bd70e0a33877cf4b1cb"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Live peer signals are immutable';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "live_peer_signal_immutable" BEFORE UPDATE ON "live_peer_signals" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_328b2bd70e0a33877cf4b1cb"();

CREATE FUNCTION "dg_trigger_dac5a2cac43b2332fe8d3a24"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Live program history is immutable';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "live_program_history_immutable" BEFORE UPDATE ON "live_program_versions" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_dac5a2cac43b2332fe8d3a24"();

CREATE FUNCTION "dg_trigger_73bf05580532e9bb449bb07e"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Live recording source is immutable';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "live_recording_source_immutable" BEFORE UPDATE OF session_id,tenant_id,workspace_id,actor_id,snapshot,snapshot_hash,source_guard,source_guard_hash ON "live_recordings" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_73bf05580532e9bb449bb07e"();

CREATE FUNCTION "dg_trigger_304f8a3c5307a1e486d39059"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Live playout segments are immutable';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "live_segments_immutable" BEFORE UPDATE ON "live_segments" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_304f8a3c5307a1e486d39059"();

CREATE FUNCTION "dg_trigger_f1e6bc54c5268c58ea2669a4"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Live session source is immutable';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "live_session_source_immutable" BEFORE UPDATE OF tenant_id,workspace_id,actor_id,program_id,program_version,kind,snapshot,snapshot_hash ON "live_sessions" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_f1e6bc54c5268c58ea2669a4"();

CREATE FUNCTION "dg_trigger_7d7178cde77338a013c67b94"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Live speech job input is immutable';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "live_speech_job_input_immutable" BEFORE UPDATE OF plan_id,session_id,tenant_id,workspace_id,actor_id,environment,app_env,source,input_hash ON "live_speech_jobs" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_7d7178cde77338a013c67b94"();

CREATE FUNCTION "dg_trigger_e3156504d85a4e2c36087802"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
IF (OLD.status='succeeded') THEN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Live speech audio result is immutable';
END IF;
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "live_speech_job_result_immutable" BEFORE UPDATE OF wav_key,wav_format,pcm_key,pcm_format ON "live_speech_jobs" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_e3156504d85a4e2c36087802"();

CREATE FUNCTION "dg_trigger_7a764ee252cd562731b54cfa"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Live speech plan input is immutable';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "live_speech_plan_input_immutable" BEFORE UPDATE OF session_id,tenant_id,workspace_id,actor_id,environment,app_env,session_hash,voice,cues,input_hash ON "live_speech_plans" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_7a764ee252cd562731b54cfa"();

CREATE FUNCTION "dg_trigger_81399ea3837872349bb1484c"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
IF (OLD.result_hash IS NOT NULL) THEN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Live speech plan result is immutable';
END IF;
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "live_speech_plan_result_immutable" BEFORE UPDATE OF result_hash ON "live_speech_plans" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_81399ea3837872349bb1484c"();

CREATE FUNCTION "dg_trigger_d71427f87dbf4a47390270f6"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Simulated delivered advertising is immutable';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "mock_ad_delivery_immutable" BEFORE UPDATE ON "mock_ad_deliveries" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_d71427f87dbf4a47390270f6"();

CREATE FUNCTION "dg_trigger_f8c9f7323af1abada15b2f7b"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Simulated advertising receipts are immutable';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "mock_ad_operation_result_immutable" BEFORE UPDATE ON "mock_ad_operation_results" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_f8c9f7323af1abada15b2f7b"();

CREATE FUNCTION "dg_trigger_34e0641d3650aa2f70622f56"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Simulated provider reports are immutable';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "mock_ad_report_immutable" BEFORE UPDATE ON "mock_ad_reports" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_34e0641d3650aa2f70622f56"();

CREATE FUNCTION "dg_trigger_9482eeccb9ba5165c6cfaead"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
IF (NEW.id IS DISTINCT FROM OLD.id OR NEW.scenario_id IS DISTINCT FROM OLD.scenario_id OR NEW.scenario_version IS DISTINCT FROM OLD.scenario_version OR
 NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.actor_id IS DISTINCT FROM OLD.actor_id OR NEW.name IS DISTINCT FROM OLD.name OR
 NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.release_hash IS DISTINCT FROM OLD.release_hash OR NEW.environment IS DISTINCT FROM OLD.environment OR NEW.app_env IS DISTINCT FROM OLD.app_env OR NEW.created_at IS DISTINCT FROM OLD.created_at OR
 (OLD.withdrawn_at IS NOT NULL AND NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at)) THEN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='practice release is fixed and withdrawal permanent';
END IF;
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "practice_release_fixed" BEFORE UPDATE ON "practice_releases" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_9482eeccb9ba5165c6cfaead"();

CREATE FUNCTION "dg_trigger_4f94438f5b782bd4468480cd"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
IF (NEW.id IS DISTINCT FROM OLD.id OR NEW.release_id IS DISTINCT FROM OLD.release_id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.actor_id IS DISTINCT FROM OLD.actor_id OR
 NEW.release_hash IS DISTINCT FROM OLD.release_hash OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.environment IS DISTINCT FROM OLD.environment OR NEW.app_env IS DISTINCT FROM OLD.app_env OR NEW.created_at IS DISTINCT FROM OLD.created_at OR
 (OLD.phase='deleted' AND (NEW.phase<>'deleted' OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at OR NEW.deletion_reason IS DISTINCT FROM OLD.deletion_reason))) THEN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='practice run source and deletion are fixed';
END IF;
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "practice_run_fixed" BEFORE UPDATE ON "practice_runs" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_4f94438f5b782bd4468480cd"();

CREATE FUNCTION "dg_trigger_a9adb966ad50d40dbdcbe651"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
IF (NEW.id IS DISTINCT FROM OLD.id OR NEW.run_id IS DISTINCT FROM OLD.run_id OR NEW.ordinal IS DISTINCT FROM OLD.ordinal OR NEW.question_id IS DISTINCT FROM OLD.question_id OR
 NEW.next_question_id IS DISTINCT FROM OLD.next_question_id OR NEW.created_at IS DISTINCT FROM OLD.created_at OR
 NOT(NEW.prompt IS NULL AND NEW.body IS NULL AND NEW.feedback IS NULL AND (SELECT phase FROM practice_runs WHERE id=OLD.run_id)='deleted')) THEN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='practice answer is immutable except full erasure';
END IF;
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "practice_turn_fixed" BEFORE UPDATE ON "practice_turns" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_a9adb966ad50d40dbdcbe651"();

CREATE FUNCTION "dg_trigger_420645389213de334dcfc0e2"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='practice answer uses explicit erasure';
RETURN OLD;
END;
$dg$;
CREATE TRIGGER "practice_turn_no_delete" BEFORE DELETE ON "practice_turns" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_420645389213de334dcfc0e2"();

CREATE FUNCTION "dg_trigger_690f29c86d5f1bdafb84fb12"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='practice revision is immutable';
RETURN OLD;
END;
$dg$;
CREATE TRIGGER "practice_version_no_delete" BEFORE DELETE ON "practice_scenario_versions" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_690f29c86d5f1bdafb84fb12"();

CREATE FUNCTION "dg_trigger_76b3fb225995f7b46847f821"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='practice revision is immutable';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "practice_version_no_update" BEFORE UPDATE ON "practice_scenario_versions" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_76b3fb225995f7b46847f821"();

CREATE FUNCTION "dg_trigger_18e817b3443d406f41ad6c90"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Assistant application history is immutable';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "studio_assistant_application_immutable" BEFORE UPDATE ON "studio_assistant_applications" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_18e817b3443d406f41ad6c90"();

CREATE FUNCTION "dg_trigger_4f1f57ba0835c97351543a77"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Assistant generation plans are immutable';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "studio_assistant_generation_input_immutable" BEFORE UPDATE OF session_id,turn_id,number,actor_id,plan,plan_hash ON "studio_assistant_generations" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_4f1f57ba0835c97351543a77"();

CREATE FUNCTION "dg_trigger_a019e9bcc3f14562615f2d6c"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Assistant interpretation input is immutable';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "studio_assistant_interpretation_input_immutable" BEFORE UPDATE OF session_id,tenant_id,workspace_id,actor_id,environment,app_env,session_version,parent_turn_id,request,context_hash,engine,input_hash ON "studio_assistant_interpretations" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_a019e9bcc3f14562615f2d6c"();

CREATE FUNCTION "dg_trigger_5b347269cf887869f8959ca8"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
IF (OLD.status='succeeded') THEN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Completed assistant interpretation is immutable';
END IF;
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "studio_assistant_interpretation_success_immutable" BEFORE UPDATE ON "studio_assistant_interpretations" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_5b347269cf887869f8959ca8"();

CREATE FUNCTION "dg_trigger_8443b63ca2f39b25d81f4967"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Assistant source and selection are immutable';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "studio_assistant_source_immutable" BEFORE UPDATE OF tenant_id,workspace_id,actor_id,project_id,project_version,base_document,base_document_hash,source_hash,selected_ids,environment,app_env ON "studio_assistant_sessions" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_8443b63ca2f39b25d81f4967"();

CREATE FUNCTION "dg_trigger_ec836c05b9c91c85400b566d"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Assistant turns are append-only';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "studio_assistant_turn_immutable" BEFORE UPDATE ON "studio_assistant_turns" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_ec836c05b9c91c85400b566d"();

CREATE FUNCTION "dg_trigger_9273fa62be302da605ae32cb"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='course release is immutable';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "studio_course_release_immutable" BEFORE UPDATE OF snapshot,release_hash,course_id,course_version,tenant_id,workspace_id,name,environment,app_env ON "studio_course_releases" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_9273fa62be302da605ae32cb"();

CREATE FUNCTION "dg_trigger_d541ca30831f8a9bbff463a8"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
IF (OLD.withdrawn_at IS NOT NULL) THEN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='course withdrawal is permanent';
END IF;
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "studio_course_release_withdrawn" BEFORE UPDATE OF withdrawn_at ON "studio_course_releases" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_d541ca30831f8a9bbff463a8"();

CREATE FUNCTION "dg_trigger_947becf03b522abb62673995"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
IF (OLD.role<>NEW.role OR OLD.workspace_ids<>NEW.workspace_ids) THEN
UPDATE studio_frame_review_links SET revoked_at=dg_utc_now(),version=version+1 WHERE actor_id=OLD.user_id AND revoked_at IS NULL;
 UPDATE studio_frame_reviews SET invalidated_at=COALESCE(invalidated_at,dg_utc_now()),
 status=CASE WHEN status IN ('queued','preparing') THEN 'stale' ELSE status END,lease_token=NULL,lease_until=NULL,
 version=version+1,updated_at=dg_utc_now() WHERE actor_id=OLD.user_id;
END IF;
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "studio_frame_review_owner_changed" AFTER UPDATE OF role,workspace_ids ON "memberships" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_947becf03b522abb62673995"();

CREATE FUNCTION "dg_trigger_f310fb540636f4c1a7e54035"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
UPDATE studio_frame_review_links SET revoked_at=dg_utc_now(),version=version+1 WHERE actor_id=OLD.user_id AND revoked_at IS NULL;
 UPDATE studio_frame_reviews SET invalidated_at=COALESCE(invalidated_at,dg_utc_now()),
 status=CASE WHEN status IN ('queued','preparing') THEN 'stale' ELSE status END,lease_token=NULL,lease_until=NULL,
 version=version+1,updated_at=dg_utc_now() WHERE actor_id=OLD.user_id;
RETURN OLD;
END;
$dg$;
CREATE TRIGGER "studio_frame_review_owner_removed" AFTER DELETE ON "memberships" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_f310fb540636f4c1a7e54035"();

CREATE FUNCTION "dg_trigger_4033f3a1e4074dfea8a74a26"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
IF (OLD.version<>NEW.version OR OLD.archived<>NEW.archived) THEN
UPDATE studio_frame_review_links SET revoked_at=dg_utc_now(),version=version+1
 WHERE review_id IN (SELECT id FROM studio_frame_reviews WHERE project_id=OLD.id) AND revoked_at IS NULL;
 UPDATE studio_frame_reviews SET invalidated_at=COALESCE(invalidated_at,dg_utc_now()),
 status=CASE WHEN status IN ('queued','preparing') THEN 'stale' ELSE status END,lease_token=NULL,lease_until=NULL,
 version=version+1,updated_at=dg_utc_now() WHERE project_id=OLD.id;
END IF;
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "studio_frame_review_project_changed" AFTER UPDATE OF version,archived ON "studio_projects" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_4033f3a1e4074dfea8a74a26"();

CREATE FUNCTION "dg_trigger_b20f5bb57f30761a3f7af7c4"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Presentation answer input is immutable';
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "studio_presentation_answer_input_immutable" BEFORE UPDATE OF session_id,question_id,tenant_id,workspace_id,actor_id,environment,app_env,source_hash,request,configuration,input_hash ON "studio_presentation_answer_jobs" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_b20f5bb57f30761a3f7af7c4"();

CREATE FUNCTION "dg_trigger_461402042b3636eb7d533e75"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
IF (OLD.status='succeeded') THEN
RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Completed presentation answer is immutable';
END IF;
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "studio_presentation_answer_result_immutable" BEFORE UPDATE OF result,evidence,audio_key,audio_format ON "studio_presentation_answer_jobs" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_461402042b3636eb7d533e75"();

CREATE FUNCTION "dg_trigger_34171267bda3628408bb1a23"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
UPDATE studio_presentation_sessions SET invalidated_at=dg_utc_now(),invalidation_reason='host_permission_changed',version=version+1
 WHERE actor_id=OLD.user_id AND invalidated_at IS NULL AND
 (tenant_id<>NEW.tenant_id OR NEW.role NOT IN ('admin','editor') OR NOT EXISTS(SELECT 1 FROM json_array_elements_text((NEW.workspace_ids)::json) AS dg_workspace(value) WHERE value=studio_presentation_sessions.workspace_id));
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "studio_presentation_host_change" AFTER UPDATE ON "memberships" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_34171267bda3628408bb1a23"();

CREATE FUNCTION "dg_trigger_9820c2a86f0930cff553ad6b"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
UPDATE studio_presentation_sessions SET invalidated_at=dg_utc_now(),invalidation_reason='host_permission_changed',version=version+1
 WHERE actor_id=OLD.user_id AND invalidated_at IS NULL;
RETURN OLD;
END;
$dg$;
CREATE TRIGGER "studio_presentation_host_delete" AFTER DELETE ON "memberships" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_9820c2a86f0930cff553ad6b"();

CREATE FUNCTION "dg_trigger_6d493d8694c95164f52f50d5"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
IF (NEW.version<>OLD.version OR NEW.archived<>OLD.archived) THEN
UPDATE studio_presentation_sessions SET invalidated_at=dg_utc_now(),invalidation_reason='project_changed',version=version+1
 WHERE project_id=OLD.id AND invalidated_at IS NULL;
END IF;
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "studio_presentation_project_change" AFTER UPDATE OF version,archived ON "studio_projects" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_6d493d8694c95164f52f50d5"();

CREATE FUNCTION "dg_trigger_c07c7b9fe1d1f012bb8ba3a5"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
IF (OLD.role<>NEW.role OR OLD.workspace_ids<>NEW.workspace_ids) THEN
UPDATE studio_reviews SET invalidated_at=dg_utc_now(),invalidation_reason='审核人员权限或工作空间已变化，请重新提交。',version=version+1,updated_at=dg_utc_now()
 WHERE reviewer_id=OLD.user_id AND invalidated_at IS NULL AND status IN ('pending','approved');
END IF;
RETURN NEW;
END;
$dg$;
CREATE TRIGGER "studio_reviews_membership_changed" AFTER UPDATE OF role,workspace_ids ON "memberships" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_c07c7b9fe1d1f012bb8ba3a5"();

CREATE FUNCTION "dg_trigger_1e4cf5123100341c179e12cc"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $dg$
BEGIN
UPDATE studio_reviews SET invalidated_at=dg_utc_now(),invalidation_reason='审核人员已离开当前组织，请重新提交。',version=version+1,updated_at=dg_utc_now()
 WHERE reviewer_id=OLD.user_id AND invalidated_at IS NULL AND status IN ('pending','approved');
RETURN OLD;
END;
$dg$;
CREATE TRIGGER "studio_reviews_membership_removed" AFTER DELETE ON "memberships" FOR EACH ROW EXECUTE FUNCTION "dg_trigger_1e4cf5123100341c179e12cc"();
