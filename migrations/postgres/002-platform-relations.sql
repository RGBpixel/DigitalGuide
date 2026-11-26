-- DigitalGuide PostgreSQL baseline, SQLite source through 052.
-- Independently versioned native SQL; apply only through the offline staging importer.

ALTER TABLE "ad_alerts" ADD CONSTRAINT "dg_fk_e2b34bc601b806e2cd75c7cc" FOREIGN KEY ("campaign_id") REFERENCES "ad_campaigns" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "ad_alerts" ADD CONSTRAINT "dg_fk_d99ee4caf86c7a8f6881e0de" FOREIGN KEY ("account_id") REFERENCES "ad_accounts" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "ad_budget_policies" ADD CONSTRAINT "dg_fk_128b90d37af688bf919148ed" FOREIGN KEY ("account_id") REFERENCES "ad_accounts" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "ad_budget_policy_versions" ADD CONSTRAINT "dg_fk_e7f1e28ef92835d043900c60" FOREIGN KEY ("account_id") REFERENCES "ad_accounts" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "ad_budget_reservations" ADD CONSTRAINT "dg_fk_8107f9bf155c27497fda7c91" FOREIGN KEY ("campaign_id") REFERENCES "ad_campaigns" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "ad_budget_reservations" ADD CONSTRAINT "dg_fk_6de2378e8e24170062b98e04" FOREIGN KEY ("account_id") REFERENCES "ad_accounts" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "ad_budget_reservations" ADD CONSTRAINT "dg_fk_5796e407a75e67b21e56db05" FOREIGN KEY ("run_id") REFERENCES "ad_runs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "ad_callback_events" ADD CONSTRAINT "dg_fk_fef1f445b9cf0f8a39cefd1b" FOREIGN KEY ("run_id") REFERENCES "ad_runs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "ad_callback_events" ADD CONSTRAINT "dg_fk_ce66743218f2e5b04f3da16f" FOREIGN KEY ("event_id") REFERENCES "mock_ad_reports" ("event_id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "ad_campaign_metrics" ADD CONSTRAINT "dg_fk_0d1939b954e0d29f5d7f352e" FOREIGN KEY ("run_id") REFERENCES "ad_runs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "ad_campaign_metrics" ADD CONSTRAINT "dg_fk_447d6bf418f517acf1d1c855" FOREIGN KEY ("campaign_id") REFERENCES "ad_campaigns" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "ad_campaign_metrics" ADD CONSTRAINT "dg_fk_67d40dd725de7439568b352d" FOREIGN KEY ("event_id") REFERENCES "mock_ad_reports" ("event_id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "ad_campaign_reviews" ADD CONSTRAINT "dg_fk_ae993cf50ce0ad93aad65a6a" FOREIGN KEY ("campaign_id") REFERENCES "ad_campaigns" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "ad_campaign_versions" ADD CONSTRAINT "dg_fk_7c41e4d21ac32b8d576d986a" FOREIGN KEY ("campaign_id") REFERENCES "ad_campaigns" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "ad_campaigns" ADD CONSTRAINT "dg_fk_5722c372bb965069bbd5a81b" FOREIGN KEY ("account_id") REFERENCES "ad_accounts" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "ad_credit_requests" ADD CONSTRAINT "dg_fk_8f826f31b8652fbfe70f0219" FOREIGN KEY ("event_id") REFERENCES "mock_ad_reports" ("event_id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "ad_operations" ADD CONSTRAINT "dg_fk_9c2f5bfdfacc900eab3035e1" FOREIGN KEY ("run_id") REFERENCES "ad_runs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "ad_reconciliations" ADD CONSTRAINT "dg_fk_99d1f3ff56906b777d720ce0" FOREIGN KEY ("account_id") REFERENCES "ad_accounts" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "ad_runs" ADD CONSTRAINT "dg_fk_cb76a7c932d29aa23cc54102" FOREIGN KEY ("review_id") REFERENCES "ad_campaign_reviews" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "ad_runs" ADD CONSTRAINT "dg_fk_0dd58f176eae042baccf8974" FOREIGN KEY ("campaign_id") REFERENCES "ad_campaigns" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "ad_spend_ledger" ADD CONSTRAINT "dg_fk_63f261a6765e90177e747e76" FOREIGN KEY ("original_entry_id") REFERENCES "ad_spend_ledger" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "ad_spend_ledger" ADD CONSTRAINT "dg_fk_9b6f421f74e9708b8bd72139" FOREIGN KEY ("run_id") REFERENCES "ad_runs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "ad_spend_ledger" ADD CONSTRAINT "dg_fk_32834ea2fc95d1979e343e38" FOREIGN KEY ("campaign_id") REFERENCES "ad_campaigns" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "ad_spend_ledger" ADD CONSTRAINT "dg_fk_b11acb83abe5fc91c75870a4" FOREIGN KEY ("account_id") REFERENCES "ad_accounts" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "ad_spend_ledger" ADD CONSTRAINT "dg_fk_47797311d2513fa7478f8eb2" FOREIGN KEY ("event_id") REFERENCES "mock_ad_reports" ("event_id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "ae_batches" ADD CONSTRAINT "dg_fk_80ebcf186aad76da0f4d00be" FOREIGN KEY ("template_id") REFERENCES "ae_templates" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "ae_media_adoptions" ADD CONSTRAINT "dg_fk_e4c8275529cb21839f72d877" FOREIGN KEY ("project_id") REFERENCES "studio_projects" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "ae_media_adoptions" ADD CONSTRAINT "dg_fk_156541e7dc58ec4e22542aa3" FOREIGN KEY ("asset_id") REFERENCES "assets" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "ae_media_adoptions" ADD CONSTRAINT "dg_fk_be4f08945d27322893075c61" FOREIGN KEY ("job_id") REFERENCES "ae_render_jobs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "ae_media_adoptions" ADD CONSTRAINT "dg_fk_f1fcc3caebb5170f548e2bd6" FOREIGN KEY ("batch_id") REFERENCES "ae_batches" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "ae_media_adoptions" ADD CONSTRAINT "dg_fk_4d34590a99e2f381061db4b9" FOREIGN KEY ("artifact_id") REFERENCES "ae_render_artifacts" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "ae_media_attempts" ADD CONSTRAINT "dg_fk_f98f976eb1f9e0efd16647d9" FOREIGN KEY ("adoption_id") REFERENCES "ae_media_adoptions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "ae_render_artifacts" ADD CONSTRAINT "dg_fk_941083732939711bc6ce4bc5" FOREIGN KEY ("job_id") REFERENCES "ae_render_jobs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "ae_render_attempts" ADD CONSTRAINT "dg_fk_62e76a35567eb016c6c5c986" FOREIGN KEY ("job_id") REFERENCES "ae_render_jobs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "ae_render_jobs" ADD CONSTRAINT "dg_fk_c969251d7245ad89f024063e" FOREIGN KEY ("batch_id") REFERENCES "ae_batches" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "ae_source_attempts" ADD CONSTRAINT "dg_fk_0d380b6f062b33224ac52088" FOREIGN KEY ("job_id") REFERENCES "ae_source_exports" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "ae_source_exports" ADD CONSTRAINT "dg_fk_d507157d3b6d5ca44b019936" FOREIGN KEY ("template_id") REFERENCES "ae_templates" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "ae_template_versions" ADD CONSTRAINT "dg_fk_18eba925a3984a3889f2569f" FOREIGN KEY ("template_id") REFERENCES "ae_templates" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "alpha_video_frames" ADD CONSTRAINT "dg_fk_7daebc453205a00184a7c935" FOREIGN KEY ("asset_id") REFERENCES "assets" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "alpha_video_previews" ADD CONSTRAINT "dg_fk_991ccc3dc98e859ab3adeb30" FOREIGN KEY ("asset_id") REFERENCES "assets" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "asset_collection_links" ADD CONSTRAINT "dg_fk_2cdb69b18826fca230bc2dc5" FOREIGN KEY ("collection_id") REFERENCES "asset_collections" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "asset_collection_origins" ADD CONSTRAINT "dg_fk_4feb90caa739249427dda20b" FOREIGN KEY ("collection_id") REFERENCES "asset_collections" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "asset_collection_origins" ADD CONSTRAINT "dg_fk_1e18d978022202ef7d4e9105" FOREIGN KEY ("receipt_id") REFERENCES "asset_collection_receipts" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "asset_collection_origins" ADD CONSTRAINT "dg_fk_8f11fbc03b9c5d470d2b9b94" FOREIGN KEY ("asset_id") REFERENCES "assets" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "asset_collection_parts" ADD CONSTRAINT "dg_fk_a2544d1a35a298caea595bbb" FOREIGN KEY ("receipt_id") REFERENCES "asset_collection_receipts" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "asset_collection_receipts" ADD CONSTRAINT "dg_fk_751bd363b34172b3c4d08c37" FOREIGN KEY ("asset_id") REFERENCES "assets" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "asset_collection_receipts" ADD CONSTRAINT "dg_fk_d036eeaace2bd5617f7d65b7" FOREIGN KEY ("session_id") REFERENCES "asset_collection_sessions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "asset_collection_receipts" ADD CONSTRAINT "dg_fk_a1cc143f36c7423f0057f020" FOREIGN KEY ("collection_id") REFERENCES "asset_collections" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "asset_collection_sessions" ADD CONSTRAINT "dg_fk_867355cfb5f47defe2290408" FOREIGN KEY ("link_id") REFERENCES "asset_collection_links" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "asset_collections" ADD CONSTRAINT "dg_fk_51ded9e3062ac7b8eb966078" FOREIGN KEY ("folder_id") REFERENCES "asset_library_folders" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "asset_library_consent_revocations" ADD CONSTRAINT "dg_fk_7b612759b46ab85be3ce56d4" FOREIGN KEY ("asset_id") REFERENCES "assets" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "asset_library_consent_revocations" ADD CONSTRAINT "dg_fk_a4e622608547474690880634" FOREIGN KEY ("consent_id") REFERENCES "consents" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;

ALTER TABLE "asset_library_events" ADD CONSTRAINT "dg_fk_fc9f0c905dbaa9bcb74ae991" FOREIGN KEY ("family_id") REFERENCES "asset_library_families" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "asset_library_families" ADD CONSTRAINT "dg_fk_d64317fbd49d11b5138b3388" FOREIGN KEY ("merged_into") REFERENCES "asset_library_families" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "asset_library_families" ADD CONSTRAINT "dg_fk_69ceb2e7af083e653cca761c" FOREIGN KEY ("folder_id") REFERENCES "asset_library_folders" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "asset_library_folders" ADD CONSTRAINT "dg_fk_7634fa8ae33b909c58fb2d8b" FOREIGN KEY ("parent_id") REFERENCES "asset_library_folders" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "asset_library_revisions" ADD CONSTRAINT "dg_fk_f010a93966ac59cec9d113bd" FOREIGN KEY ("family_id") REFERENCES "asset_library_families" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "asset_library_revisions" ADD CONSTRAINT "dg_fk_b580be614af0c9afc3f2ac4a" FOREIGN KEY ("asset_id") REFERENCES "assets" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "asset_versions" ADD CONSTRAINT "dg_fk_2c01479ec02f500f6bdd3d52" FOREIGN KEY ("asset_id") REFERENCES "assets" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "assets" ADD CONSTRAINT "dg_fk_b8fc1dc2be8f8ad4ceec82d2" FOREIGN KEY ("upload_id") REFERENCES "uploads" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "auth_sessions" ADD CONSTRAINT "dg_fk_0c147568540c18756828e5a0" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "character_derivations" ADD CONSTRAINT "dg_fk_59b5685b4141d0a7577582e9" FOREIGN KEY ("character_id") REFERENCES "studio_characters" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "character_derivations" ADD CONSTRAINT "dg_fk_1e13822a3d567bd4efea2f91" FOREIGN KEY ("asset_id") REFERENCES "assets" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "character_jobs" ADD CONSTRAINT "dg_fk_1e1aa9b90d61f0a4a6966c39" FOREIGN KEY ("character_id") REFERENCES "studio_characters" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "character_motion_plans" ADD CONSTRAINT "dg_fk_2baa45601833ec181bc63544" FOREIGN KEY ("project_id") REFERENCES "studio_projects" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "character_motion_plans" ADD CONSTRAINT "dg_fk_18f628b2c99031dbc4ffbdaa" FOREIGN KEY ("character_id") REFERENCES "studio_characters" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "character_motion_versions" ADD CONSTRAINT "dg_fk_7ca0476530fa150108be8071" FOREIGN KEY ("plan_id") REFERENCES "character_motion_plans" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "consents" ADD CONSTRAINT "dg_fk_46004c06104344bac528391a" FOREIGN KEY ("asset_id") REFERENCES "assets" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "content_governance_artifacts" ADD CONSTRAINT "dg_fk_15d7cb0979b5cd7d1b600633" FOREIGN KEY ("delivery_id") REFERENCES "content_governance_deliveries" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "content_governance_deliveries" ADD CONSTRAINT "dg_fk_3fd7d97e576fea72766ab25c" FOREIGN KEY ("policy_id") REFERENCES "content_governance_policies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "content_governance_policy_versions" ADD CONSTRAINT "dg_fk_632895ca6c4f9a46f93806db" FOREIGN KEY ("policy_id") REFERENCES "content_governance_policies" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "content_governance_receipts" ADD CONSTRAINT "dg_fk_50227bbb14a5d7c1aa8d8cfc" FOREIGN KEY ("review_id") REFERENCES "content_governance_reviews" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "content_governance_receipts" ADD CONSTRAINT "dg_fk_0803b884ca00bee10810b305" FOREIGN KEY ("delivery_id") REFERENCES "content_governance_deliveries" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "content_governance_reviews" ADD CONSTRAINT "dg_fk_5c1de40793feee3799f3a472" FOREIGN KEY ("delivery_id") REFERENCES "content_governance_deliveries" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "conversation_tool_requests" ADD CONSTRAINT "dg_fk_dbf42c370de2e11b29920e69" FOREIGN KEY ("app_id") REFERENCES "scene_apps" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "conversation_tool_requests" ADD CONSTRAINT "dg_fk_51c57d8170c94fab91dad089" FOREIGN KEY ("reply_id") REFERENCES "reception_messages" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "conversation_tool_requests" ADD CONSTRAINT "dg_fk_4ab3bd46d73674a610e2297f" FOREIGN KEY ("session_id") REFERENCES "reception_sessions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "course_enrollments" ADD CONSTRAINT "dg_fk_4c86433a01c929d32f94aefd" FOREIGN KEY ("release_id") REFERENCES "studio_course_releases" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "dining_claim_limits" ADD CONSTRAINT "dg_fk_6bb5d18310f61d47eae75b3f" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "dining_farewells" ADD CONSTRAINT "dg_fk_8dc7ea32469e3af8858bd176" FOREIGN KEY ("party_id") REFERENCES "dining_parties" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "dining_feedback" ADD CONSTRAINT "dg_fk_1c9e2d83d06b90c18374fc72" FOREIGN KEY ("party_id") REFERENCES "dining_parties" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "dining_followup_consents" ADD CONSTRAINT "dg_fk_966368d6af7229968c1e2857" FOREIGN KEY ("party_id") REFERENCES "dining_parties" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "dining_hold_plans" ADD CONSTRAINT "dg_fk_49486092186168bc70a3c939" FOREIGN KEY ("table_id") REFERENCES "restaurant_tables" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "dining_hold_plans" ADD CONSTRAINT "dg_fk_5c90893ff55d87d742203650" FOREIGN KEY ("party_id") REFERENCES "dining_parties" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "dining_hold_plans" ADD CONSTRAINT "dg_fk_406db9a3365c7d6a1955a10f" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "dining_memory_imports" ADD CONSTRAINT "dg_fk_1496ac5287910d738cce6a21" FOREIGN KEY ("session_id") REFERENCES "reception_sessions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "dining_memory_imports" ADD CONSTRAINT "dg_fk_0f153884c9e9263efee7519b" FOREIGN KEY ("party_id") REFERENCES "dining_parties" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "dining_obligations" ADD CONSTRAINT "dg_fk_54148a33868a0887607a4ceb" FOREIGN KEY ("party_id") REFERENCES "dining_parties" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "dining_occupancies" ADD CONSTRAINT "dg_fk_c9d730f1ce2388bb9136073e" FOREIGN KEY ("party_id") REFERENCES "dining_parties" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "dining_occupancies" ADD CONSTRAINT "dg_fk_3ad614a3cf8d4a7f460f5bbc" FOREIGN KEY ("table_id") REFERENCES "restaurant_tables" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "dining_occupancies" ADD CONSTRAINT "dg_fk_4e27ef3d07d7bb8f5a684ddd" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "dining_parties" ADD CONSTRAINT "dg_fk_aa86fe3a9f2b97c80d942063" FOREIGN KEY ("owner_session_id") REFERENCES "reception_sessions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "dining_parties" ADD CONSTRAINT "dg_fk_b2a59886f98bdd210be4f1f9" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "dining_preferences" ADD CONSTRAINT "dg_fk_96be77c3666d2119d91323fc" FOREIGN KEY ("party_id") REFERENCES "dining_parties" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "dining_recommendations" ADD CONSTRAINT "dg_fk_15b9d000b63edf7bdc4a8abc" FOREIGN KEY ("preference_id") REFERENCES "dining_preferences" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "dining_recommendations" ADD CONSTRAINT "dg_fk_335d61f407afb34e4b9c337f" FOREIGN KEY ("party_id") REFERENCES "dining_parties" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "dining_reservations" ADD CONSTRAINT "dg_fk_606e08ca3041ae4c742602cb" FOREIGN KEY ("table_id") REFERENCES "restaurant_tables" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "dining_reservations" ADD CONSTRAINT "dg_fk_2abfc71a209e457258368d5a" FOREIGN KEY ("party_id") REFERENCES "dining_parties" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "dining_reservations" ADD CONSTRAINT "dg_fk_97a5e4d39dfc962d53860980" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "dining_service_events" ADD CONSTRAINT "dg_fk_71213b31eff122390387c694" FOREIGN KEY ("request_id") REFERENCES "dining_service_requests" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "dining_service_requests" ADD CONSTRAINT "dg_fk_3f909da1ef48139774b4df56" FOREIGN KEY ("party_id") REFERENCES "dining_parties" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "dining_service_requests" ADD CONSTRAINT "dg_fk_f58bd838ecffd627939e649a" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "distribution_reviews" ADD CONSTRAINT "dg_fk_2d4e241c9db28325763ee832" FOREIGN KEY ("variant_id") REFERENCES "distribution_variants" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "distribution_variant_versions" ADD CONSTRAINT "dg_fk_a0ee1b43ac2972d3e2a01216" FOREIGN KEY ("variant_id") REFERENCES "distribution_variants" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "distribution_variants" ADD CONSTRAINT "dg_fk_6651a6fe9e682adcb2c61feb" FOREIGN KEY ("cover_asset_id") REFERENCES "assets" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "distribution_variants" ADD CONSTRAINT "dg_fk_425c0d36e4e7c555032341b6" FOREIGN KEY ("export_id") REFERENCES "studio_exports" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "distribution_variants" ADD CONSTRAINT "dg_fk_c8035b16054d5998cbff98c6" FOREIGN KEY ("project_id") REFERENCES "studio_projects" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "event_deliveries" ADD CONSTRAINT "dg_fk_24ee571783285dcff8e2d6d3" FOREIGN KEY ("event_id") REFERENCES "outbox_events" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "exhibit_device_commands" ADD CONSTRAINT "dg_fk_5a4a807d694507cac1cb1f25" FOREIGN KEY ("session_id") REFERENCES "tour_sessions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "exhibit_device_commands" ADD CONSTRAINT "dg_fk_6236314aa38c0f1fae28d3ce" FOREIGN KEY ("device_id") REFERENCES "exhibit_devices" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "exhibit_device_receipts" ADD CONSTRAINT "dg_fk_c9eac4531b7239fa616d652b" FOREIGN KEY ("command_id") REFERENCES "exhibit_device_commands" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "exhibit_devices" ADD CONSTRAINT "dg_fk_fe6d12f7fbb24db40ecf510c" FOREIGN KEY ("hall_id") REFERENCES "exhibition_halls" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "exhibit_versions" ADD CONSTRAINT "dg_fk_45e2705812445934ad8b5516" FOREIGN KEY ("exhibit_id") REFERENCES "exhibits" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "exhibits" ADD CONSTRAINT "dg_fk_beed0bc14c907c0b93ce36d2" FOREIGN KEY ("hall_id") REFERENCES "exhibition_halls" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "dg_fk_6d60abae494e17a496e99cf4" FOREIGN KEY ("document_id") REFERENCES "knowledge_documents" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "dg_fk_badbeece9d2a872dec3520e0" FOREIGN KEY ("version_id") REFERENCES "knowledge_versions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "knowledge_documents" ADD CONSTRAINT "dg_fk_3a781dddfed66c31c32644ca" FOREIGN KEY ("collection_id") REFERENCES "knowledge_collections" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "knowledge_versions" ADD CONSTRAINT "dg_fk_a9b6a8568bfbc000192f033c" FOREIGN KEY ("document_id") REFERENCES "knowledge_documents" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "learning_attempts" ADD CONSTRAINT "dg_fk_875feaf5a636fc8c9b45440b" FOREIGN KEY ("release_id") REFERENCES "studio_course_releases" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "learning_attempts" ADD CONSTRAINT "dg_fk_b2811c9d3d7f7ddf941f1527" FOREIGN KEY ("enrollment_id") REFERENCES "course_enrollments" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "learning_events" ADD CONSTRAINT "dg_fk_e7d8c049d23f0071d24ce8a2" FOREIGN KEY ("attempt_id") REFERENCES "learning_attempts" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_answer_configurations" ADD CONSTRAINT "dg_fk_22367eae54b7912b6ef0c7d8" FOREIGN KEY ("session_id") REFERENCES "live_sessions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_answer_jobs" ADD CONSTRAINT "dg_fk_bd058d8a673e9bb84bbad9ff" FOREIGN KEY ("question_id") REFERENCES "live_audience_events" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_answer_jobs" ADD CONSTRAINT "dg_fk_afc7a91dd58ee2340878893e" FOREIGN KEY ("session_id") REFERENCES "live_sessions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_answer_origins" ADD CONSTRAINT "dg_fk_6e883f7f51dac63a1bad8b0d" FOREIGN KEY ("job_id") REFERENCES "live_answer_jobs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_answer_origins" ADD CONSTRAINT "dg_fk_810bd75703f40defbaef0b92" FOREIGN KEY ("question_id") REFERENCES "live_audience_events" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_audience_events" ADD CONSTRAINT "dg_fk_e95f453b4187d5f1ad38abf6" FOREIGN KEY ("destination_id") REFERENCES "live_destinations" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_audience_events" ADD CONSTRAINT "dg_fk_f4489da75526c3a8a368dce8" FOREIGN KEY ("session_id") REFERENCES "live_sessions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_commands" ADD CONSTRAINT "dg_fk_9bc9ccc6f985aa17c2c891d8" FOREIGN KEY ("session_id") REFERENCES "live_sessions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_destinations" ADD CONSTRAINT "dg_fk_4ec55160d387e2336035f083" FOREIGN KEY ("session_id") REFERENCES "live_sessions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_guest_programme_connections" ADD CONSTRAINT "dg_fk_c25d8d82fc8fccd9f4dac154" FOREIGN KEY ("generation_id") REFERENCES "live_output_generations" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_guest_programme_connections" ADD CONSTRAINT "dg_fk_fe04a447c2ec1203ad5e1eee" FOREIGN KEY ("output_id") REFERENCES "live_outputs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_guest_programme_connections" ADD CONSTRAINT "dg_fk_b657cbba8284a1071882aa55" FOREIGN KEY ("peer_attempt_id") REFERENCES "live_peer_attempts" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_guest_programme_connections" ADD CONSTRAINT "dg_fk_fb54e3bf69e93aadf31f6242" FOREIGN KEY ("grant_id") REFERENCES "live_guest_programme_grants" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_guest_programme_controls" ADD CONSTRAINT "dg_fk_0e7146c1bb8b4b6120e518f4" FOREIGN KEY ("output_id") REFERENCES "live_outputs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_guest_programme_controls" ADD CONSTRAINT "dg_fk_cdfc70b2aec9ca2be12518d3" FOREIGN KEY ("connection_id") REFERENCES "live_guest_programme_connections" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_guest_programme_grants" ADD CONSTRAINT "dg_fk_73185a5ae90123c4de380b52" FOREIGN KEY ("output_id") REFERENCES "live_outputs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_guest_programme_grants" ADD CONSTRAINT "dg_fk_209532a4ff7881e3bf81317a" FOREIGN KEY ("session_id") REFERENCES "live_sessions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_guest_programme_grants" ADD CONSTRAINT "dg_fk_798e919647ded1d93eaa1a62" FOREIGN KEY ("guest_id") REFERENCES "live_peer_guests" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_guest_programme_grants" ADD CONSTRAINT "dg_fk_600b988b31ea9887e31f5b3a" FOREIGN KEY ("peer_attempt_id") REFERENCES "live_peer_attempts" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_guest_programme_grants" ADD CONSTRAINT "dg_fk_425972e42653381da70a3e0e" FOREIGN KEY ("invite_id") REFERENCES "live_peer_invites" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_observations" ADD CONSTRAINT "dg_fk_d81beb1b2b1b8f3eea5eaf49" FOREIGN KEY ("session_id") REFERENCES "live_sessions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_output_generations" ADD CONSTRAINT "dg_fk_ec0a05a862261b709feb3719" FOREIGN KEY ("output_id") REFERENCES "live_outputs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_output_observations" ADD CONSTRAINT "dg_fk_2cd4d2cc9b49063b435edfd3" FOREIGN KEY ("output_id") REFERENCES "live_outputs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_output_parts" ADD CONSTRAINT "dg_fk_ac033ff85cd1bb7d827e840b" FOREIGN KEY ("generation_id") REFERENCES "live_output_generations" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_output_parts" ADD CONSTRAINT "dg_fk_f643ce0afbb266fdc98a2375" FOREIGN KEY ("output_id") REFERENCES "live_outputs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_output_presentations" ADD CONSTRAINT "dg_fk_886a9c29eb37364912bf97f7" FOREIGN KEY ("output_id") REFERENCES "live_outputs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_output_recordings" ADD CONSTRAINT "dg_fk_640f50dc9750aec248e3f896" FOREIGN KEY ("output_id") REFERENCES "live_outputs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_output_recordings" ADD CONSTRAINT "dg_fk_159e0371382c553a5d3b4a1b" FOREIGN KEY ("recording_id") REFERENCES "live_recordings" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_output_spans" ADD CONSTRAINT "dg_fk_2e306b83bfe3a4dd3a28639e" FOREIGN KEY ("generation_id") REFERENCES "live_output_generations" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_output_spans" ADD CONSTRAINT "dg_fk_fb003528530c1cb8cd097181" FOREIGN KEY ("output_id") REFERENCES "live_outputs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_outputs" ADD CONSTRAINT "dg_fk_7037d9ff1e9cb9b06730be7f" FOREIGN KEY ("session_id") REFERENCES "live_sessions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_peer_attempts" ADD CONSTRAINT "dg_fk_f7753a3a93e917163f8e2c44" FOREIGN KEY ("guest_id","consent_version") REFERENCES "live_peer_consents" ("guest_id","version") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_peer_attempts" ADD CONSTRAINT "dg_fk_ed2ed474f9f7babe0dfbfeb2" FOREIGN KEY ("guest_id") REFERENCES "live_peer_guests" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_peer_attempts" ADD CONSTRAINT "dg_fk_a0c27626de93cc162385c4a4" FOREIGN KEY ("invite_id") REFERENCES "live_peer_invites" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_peer_consents" ADD CONSTRAINT "dg_fk_322f9e2fd5ff437b8ac72e71" FOREIGN KEY ("guest_id") REFERENCES "live_peer_guests" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_peer_guests" ADD CONSTRAINT "dg_fk_6a61e80978587bf09c7a3c31" FOREIGN KEY ("invite_id") REFERENCES "live_peer_invites" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_peer_invites" ADD CONSTRAINT "dg_fk_1a69ef287e5c81d23c24704a" FOREIGN KEY ("session_id") REFERENCES "live_sessions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_peer_signals" ADD CONSTRAINT "dg_fk_1aa507e3ebca84106cfc5cb0" FOREIGN KEY ("attempt_id") REFERENCES "live_peer_attempts" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_program_versions" ADD CONSTRAINT "dg_fk_35146efcd2fe047d02b2a737" FOREIGN KEY ("program_id") REFERENCES "live_programs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_recording_clips" ADD CONSTRAINT "dg_fk_5d92990dd7ca5ed90c7d4b76" FOREIGN KEY ("project_id") REFERENCES "studio_projects" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_recording_clips" ADD CONSTRAINT "dg_fk_7719c6dcffdd1a6cf64f39da" FOREIGN KEY ("recording_id") REFERENCES "live_recordings" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_recording_origins" ADD CONSTRAINT "dg_fk_42cec7651d9f21d83f4915f7" FOREIGN KEY ("recording_id") REFERENCES "live_recordings" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_recording_origins" ADD CONSTRAINT "dg_fk_ee06b3ccd9bac128e83ae321" FOREIGN KEY ("asset_id") REFERENCES "assets" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_recordings" ADD CONSTRAINT "dg_fk_e7180026b394efb061b3b599" FOREIGN KEY ("session_id") REFERENCES "live_sessions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_segments" ADD CONSTRAINT "dg_fk_0968b5073397c04d7a408774" FOREIGN KEY ("session_id") REFERENCES "live_sessions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_sessions" ADD CONSTRAINT "dg_fk_b9d133a20cea43b25afce3bb" FOREIGN KEY ("program_id") REFERENCES "live_programs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_speech_jobs" ADD CONSTRAINT "dg_fk_0513c8963caa5e73ab2cf60d" FOREIGN KEY ("session_id") REFERENCES "live_sessions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_speech_jobs" ADD CONSTRAINT "dg_fk_3fdc19a6c6c0587384658ea7" FOREIGN KEY ("plan_id") REFERENCES "live_speech_plans" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_speech_plans" ADD CONSTRAINT "dg_fk_dff8363323a872fca74cf20e" FOREIGN KEY ("session_id") REFERENCES "live_sessions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_speech_playbacks" ADD CONSTRAINT "dg_fk_0ecb2eac1d71901d97f1d5fd" FOREIGN KEY ("job_id") REFERENCES "live_speech_jobs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "live_speech_playbacks" ADD CONSTRAINT "dg_fk_950a790cfa10c918b8b08c18" FOREIGN KEY ("session_id") REFERENCES "live_sessions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "media_transfer_parts" ADD CONSTRAINT "dg_fk_ba0bdef8216b8cf9c2cfcd00" FOREIGN KEY ("transfer_id") REFERENCES "media_transfers" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "media_transfers" ADD CONSTRAINT "dg_fk_4d626f2a99ed35e12a73e776" FOREIGN KEY ("project_id") REFERENCES "studio_projects" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "media_transfers" ADD CONSTRAINT "dg_fk_72ece6c6ae056b90cc24fc2b" FOREIGN KEY ("asset_id") REFERENCES "assets" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "memberships" ADD CONSTRAINT "dg_fk_6708d36726c668e55a61e047" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "memberships" ADD CONSTRAINT "dg_fk_731c8ea155857dec711fa385" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "memory_facts" ADD CONSTRAINT "dg_fk_babb13607215606c789b7874" FOREIGN KEY ("person_id") REFERENCES "people" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "memory_lookup" ADD CONSTRAINT "dg_fk_71d877ffeabb78c11b56862c" FOREIGN KEY ("fact_id") REFERENCES "memory_facts" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;

ALTER TABLE "memory_notes" ADD CONSTRAINT "dg_fk_eb200323d0c037647e92604d" FOREIGN KEY ("person_id") REFERENCES "people" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "memory_recovery_credentials" ADD CONSTRAINT "dg_fk_68e8922347b90842da86a5af" FOREIGN KEY ("person_id") REFERENCES "people" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "memory_session_greetings" ADD CONSTRAINT "dg_fk_90f9c20b277210e38c96ecc8" FOREIGN KEY ("person_id") REFERENCES "people" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "memory_session_greetings" ADD CONSTRAINT "dg_fk_6991859405ab5cb4aaa6bb40" FOREIGN KEY ("session_id") REFERENCES "reception_sessions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "memory_session_links" ADD CONSTRAINT "dg_fk_1ed782eeb23b2fe5eaa28404" FOREIGN KEY ("person_id") REFERENCES "people" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "memory_session_links" ADD CONSTRAINT "dg_fk_20cc1e38aa4e00a03eb8025e" FOREIGN KEY ("session_id") REFERENCES "reception_sessions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "mock_ad_deliveries" ADD CONSTRAINT "dg_fk_69cb5334135536cfac499d32" FOREIGN KEY ("run_id") REFERENCES "ad_runs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "mock_ad_operation_results" ADD CONSTRAINT "dg_fk_7f05469380b2192481b0364a" FOREIGN KEY ("operation_id") REFERENCES "ad_operations" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "mock_ad_remote_runs" ADD CONSTRAINT "dg_fk_a70a0e357f968c07853aca65" FOREIGN KEY ("run_id") REFERENCES "ad_runs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "mock_ad_reports" ADD CONSTRAINT "dg_fk_c0d782b21fb4cc87c84bd243" FOREIGN KEY ("delivery_id") REFERENCES "mock_ad_deliveries" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "mock_ad_reports" ADD CONSTRAINT "dg_fk_39bb1dd1989e0b22b5d50e57" FOREIGN KEY ("run_id") REFERENCES "ad_runs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "mock_ad_reports" ADD CONSTRAINT "dg_fk_2637cc5ed03392dde3d2359e" FOREIGN KEY ("account_id") REFERENCES "ad_accounts" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "mock_financial_operations" ADD CONSTRAINT "dg_fk_077ce2ec3114971871a4247a" FOREIGN KEY ("operation_id") REFERENCES "restaurant_financial_operations" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "mock_notification_submissions" ADD CONSTRAINT "dg_fk_4617a649c72e366c9f3473f6" FOREIGN KEY ("delivery_id") REFERENCES "visit_deliveries" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "mock_pos_operations" ADD CONSTRAINT "dg_fk_8eb8c8a370110c0705e5715e" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "mock_pos_operations" ADD CONSTRAINT "dg_fk_5ec64b7b1a8da56e77cc765a" FOREIGN KEY ("change_id") REFERENCES "restaurant_order_changes" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "notification_callback_events" ADD CONSTRAINT "dg_fk_8e8c96be088b36559ed4fd04" FOREIGN KEY ("delivery_id") REFERENCES "visit_deliveries" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "office_event_attendees" ADD CONSTRAINT "dg_fk_8d2a89d1bf5ef7eaaadc96b5" FOREIGN KEY ("event_id") REFERENCES "office_calendar_events" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "office_mock_submissions" ADD CONSTRAINT "dg_fk_d0ee3612c46dadea67543456" FOREIGN KEY ("notification_id") REFERENCES "office_notifications" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "people" ADD CONSTRAINT "dg_fk_7067b2eb298f90e9c9726199" FOREIGN KEY ("guest_session_id") REFERENCES "reception_sessions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "practice_releases" ADD CONSTRAINT "dg_fk_eb2ad4fc5e214e4741b0d787" FOREIGN KEY ("scenario_id") REFERENCES "practice_scenarios" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "practice_runs" ADD CONSTRAINT "dg_fk_d7c8b94ec1ec83f0515fb45d" FOREIGN KEY ("release_id") REFERENCES "practice_releases" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "practice_scenario_versions" ADD CONSTRAINT "dg_fk_ffd5ac60897617c24abad794" FOREIGN KEY ("scenario_id") REFERENCES "practice_scenarios" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "practice_turns" ADD CONSTRAINT "dg_fk_fe857cfd31a908dd667f1f37" FOREIGN KEY ("run_id") REFERENCES "practice_runs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "profile_versions" ADD CONSTRAINT "dg_fk_8dac4493e2491e0797e74acd" FOREIGN KEY ("profile_id") REFERENCES "profiles" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "profiles" ADD CONSTRAINT "dg_fk_3afb5bced21e91b257c008af" FOREIGN KEY ("voice_asset_id") REFERENCES "assets" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "profiles" ADD CONSTRAINT "dg_fk_2d0ef52da9e25776f534157a" FOREIGN KEY ("avatar_asset_id") REFERENCES "assets" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "pronunciation_book_versions" ADD CONSTRAINT "dg_fk_de6bf54b2f564b33730afbdd" FOREIGN KEY ("book_id") REFERENCES "pronunciation_books" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "provider_usage" ADD CONSTRAINT "dg_fk_a262bb28badc13199fadf8a8" FOREIGN KEY ("job_id") REFERENCES "jobs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "publishing_callback_events" ADD CONSTRAINT "dg_fk_4aff271cf2202df7dc5dac88" FOREIGN KEY ("job_id") REFERENCES "publishing_jobs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "publishing_jobs" ADD CONSTRAINT "dg_fk_1fcf100fac17ed6641db85ee" FOREIGN KEY ("account_id") REFERENCES "publishing_accounts" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "publishing_jobs" ADD CONSTRAINT "dg_fk_cd5a8b209666bbe44c99f48f" FOREIGN KEY ("variant_id") REFERENCES "distribution_variants" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "publishing_metrics" ADD CONSTRAINT "dg_fk_fc7b7e95babbfd8775097210" FOREIGN KEY ("job_id") REFERENCES "publishing_jobs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "publishing_packages" ADD CONSTRAINT "dg_fk_7f0dfd6abece8bbe2b9350e5" FOREIGN KEY ("variant_id") REFERENCES "distribution_variants" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "publishing_remote_posts" ADD CONSTRAINT "dg_fk_68c03806dce0d46c88d1411b" FOREIGN KEY ("job_id") REFERENCES "publishing_jobs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "reception_hosts" ADD CONSTRAINT "dg_fk_d4e95a4b3c1771a9c5c3d088" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "reception_messages" ADD CONSTRAINT "dg_fk_453502b76a228d0f958e5105" FOREIGN KEY ("session_id") REFERENCES "reception_sessions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "reception_presence" ADD CONSTRAINT "dg_fk_7d42e9698cac5fd65fe7a44b" FOREIGN KEY ("terminal_id") REFERENCES "reception_terminals" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "reception_sessions" ADD CONSTRAINT "dg_fk_39826dce6918efc96101f9f5" FOREIGN KEY ("terminal_id") REFERENCES "reception_terminals" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "reception_terminals" ADD CONSTRAINT "dg_fk_6cf0ccb4810e810aba0b75b3" FOREIGN KEY ("venue_id") REFERENCES "venues" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "restaurant_bills" ADD CONSTRAINT "dg_fk_864405c5c67df23c40fb2c14" FOREIGN KEY ("order_id") REFERENCES "restaurant_orders" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "restaurant_bills" ADD CONSTRAINT "dg_fk_76ed882dc19b3184043ff07b" FOREIGN KEY ("party_id") REFERENCES "dining_parties" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "restaurant_bills" ADD CONSTRAINT "dg_fk_07e2cf22ed07ae256f66bbfb" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "restaurant_financial_events" ADD CONSTRAINT "dg_fk_a8528a76ddf9bb2c24dd5483" FOREIGN KEY ("bill_id") REFERENCES "restaurant_bills" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "restaurant_financial_operations" ADD CONSTRAINT "dg_fk_8ee664bfe292504515f5a05b" FOREIGN KEY ("quote_id") REFERENCES "restaurant_financial_quotes" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "restaurant_financial_operations" ADD CONSTRAINT "dg_fk_72b3b1a8dcad7768811b17be" FOREIGN KEY ("parent_payment_id") REFERENCES "restaurant_financial_operations" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "restaurant_financial_operations" ADD CONSTRAINT "dg_fk_f516f438e3ff6ff7e155c0e2" FOREIGN KEY ("bill_id") REFERENCES "restaurant_bills" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "restaurant_financial_postings" ADD CONSTRAINT "dg_fk_f112c4fffe26cab4cf5b2d62" FOREIGN KEY ("operation_id") REFERENCES "restaurant_financial_operations" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "restaurant_financial_postings" ADD CONSTRAINT "dg_fk_c6de0c48f7533d49e4bc0d59" FOREIGN KEY ("bill_id") REFERENCES "restaurant_bills" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "restaurant_financial_quotes" ADD CONSTRAINT "dg_fk_cf52e4fc6a359d5459170513" FOREIGN KEY ("bill_id") REFERENCES "restaurant_bills" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "restaurant_financial_receipts" ADD CONSTRAINT "dg_fk_ec4553e499d2057d93ac14bd" FOREIGN KEY ("operation_id") REFERENCES "restaurant_financial_operations" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "restaurant_inventory_reservations" ADD CONSTRAINT "dg_fk_81bb41d3828d73101472aa76" FOREIGN KEY ("sku_id") REFERENCES "restaurant_menu_skus" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "restaurant_inventory_reservations" ADD CONSTRAINT "dg_fk_7f8e30a62c273556ca4dd312" FOREIGN KEY ("change_id") REFERENCES "restaurant_order_changes" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "restaurant_kitchen_tickets" ADD CONSTRAINT "dg_fk_6ee8b12df3db1d911ee98b05" FOREIGN KEY ("table_id") REFERENCES "restaurant_tables" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "restaurant_kitchen_tickets" ADD CONSTRAINT "dg_fk_401a6a3374f9103120a9071f" FOREIGN KEY ("line_id") REFERENCES "restaurant_order_lines" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "restaurant_kitchen_tickets" ADD CONSTRAINT "dg_fk_e3f18cb6bbdfd9999b580f04" FOREIGN KEY ("order_id") REFERENCES "restaurant_orders" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "restaurant_kitchen_tickets" ADD CONSTRAINT "dg_fk_a91ad9873860d905191dc5ae" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "restaurant_menu_items" ADD CONSTRAINT "dg_fk_2018c3aeea24f7e3a1e6ba82" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "restaurant_menu_skus" ADD CONSTRAINT "dg_fk_1d3f8056526ddbb020055ef9" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "restaurant_menu_skus" ADD CONSTRAINT "dg_fk_b73f0c4705ab9449060d0fd4" FOREIGN KEY ("item_id") REFERENCES "restaurant_menu_items" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "restaurant_order_changes" ADD CONSTRAINT "dg_fk_48215f828887fbb205e64717" FOREIGN KEY ("order_id") REFERENCES "restaurant_orders" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "restaurant_order_dispatches" ADD CONSTRAINT "dg_fk_3387691ff6d48f8ba8004f99" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "restaurant_order_dispatches" ADD CONSTRAINT "dg_fk_8f668d717b2872090866ea42" FOREIGN KEY ("change_id") REFERENCES "restaurant_order_changes" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "restaurant_order_events" ADD CONSTRAINT "dg_fk_784064b9bb62090c6ad4a2ed" FOREIGN KEY ("order_id") REFERENCES "restaurant_orders" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "restaurant_order_lines" ADD CONSTRAINT "dg_fk_37c90889cc987ed93c0ccf74" FOREIGN KEY ("sku_id") REFERENCES "restaurant_menu_skus" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "restaurant_order_lines" ADD CONSTRAINT "dg_fk_bd2b85f0dd726e50b80a34c5" FOREIGN KEY ("change_id") REFERENCES "restaurant_order_changes" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "restaurant_order_lines" ADD CONSTRAINT "dg_fk_3bdd961218a0ff55461e12a4" FOREIGN KEY ("order_id") REFERENCES "restaurant_orders" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "restaurant_order_quotes" ADD CONSTRAINT "dg_fk_17e01d37a6ba20cd045f33cd" FOREIGN KEY ("change_id") REFERENCES "restaurant_order_changes" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "restaurant_orders" ADD CONSTRAINT "dg_fk_a7bcc393796578813d1c474c" FOREIGN KEY ("party_id") REFERENCES "dining_parties" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "restaurant_orders" ADD CONSTRAINT "dg_fk_04f89f193493f609040361bd" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "restaurant_payment_configs" ADD CONSTRAINT "dg_fk_759179a9b4b5122a44444d66" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "restaurant_pos_callbacks" ADD CONSTRAINT "dg_fk_579bcaeeae242f5a654c1bdb" FOREIGN KEY ("change_id") REFERENCES "restaurant_order_changes" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "restaurant_pos_configs" ADD CONSTRAINT "dg_fk_65c50ea773d4d1706563e791" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "restaurant_staff" ADD CONSTRAINT "dg_fk_8c0295cc07b7996af9bedd7f" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "restaurant_stock_adjustments" ADD CONSTRAINT "dg_fk_2f41d018d156e7146aa94edc" FOREIGN KEY ("sku_id") REFERENCES "restaurant_menu_skus" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "restaurant_stock_adjustments" ADD CONSTRAINT "dg_fk_e48164407abfe855bacce9ba" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "restaurant_stock_movements" ADD CONSTRAINT "dg_fk_7357f3568bf532d6210864a1" FOREIGN KEY ("change_id") REFERENCES "restaurant_order_changes" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "restaurant_stock_movements" ADD CONSTRAINT "dg_fk_344be1692b3efc83026baa1f" FOREIGN KEY ("sku_id") REFERENCES "restaurant_menu_skus" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "restaurant_stock_movements" ADD CONSTRAINT "dg_fk_745a8c159932d4452627bd63" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "restaurant_tables" ADD CONSTRAINT "dg_fk_4173d0edfa29cfe79150248b" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "restaurant_terminals" ADD CONSTRAINT "dg_fk_2d53053ae9a5865ce277e172" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "restaurant_terminals" ADD CONSTRAINT "dg_fk_a52f68d903e3cc9622110a05" FOREIGN KEY ("terminal_id") REFERENCES "reception_terminals" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "restaurants" ADD CONSTRAINT "dg_fk_cf6a09fbf1b17cdb763051c9" FOREIGN KEY ("venue_id") REFERENCES "venues" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "scene_app_versions" ADD CONSTRAINT "dg_fk_16ba5e08700fa4f45bab39eb" FOREIGN KEY ("app_id") REFERENCES "scene_apps" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "scene_apps" ADD CONSTRAINT "dg_fk_fb2919b8cadd3a7aa8057fae" FOREIGN KEY ("profile_id") REFERENCES "profiles" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "speaker_focus_sessions" ADD CONSTRAINT "dg_fk_ea6ed6acfda5fdc940957255" FOREIGN KEY ("reference_id") REFERENCES "speaker_references" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "speaker_focus_sessions" ADD CONSTRAINT "dg_fk_b9ae0fa06fe320a5763de3f8" FOREIGN KEY ("session_id") REFERENCES "reception_sessions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "speaker_ptt_permits" ADD CONSTRAINT "dg_fk_515a4fe818c5220e02edfca1" FOREIGN KEY ("session_id") REFERENCES "reception_sessions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "speaker_references" ADD CONSTRAINT "dg_fk_ddfc33982a8246190604685e" FOREIGN KEY ("session_id") REFERENCES "reception_sessions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "speaker_segment_decisions" ADD CONSTRAINT "dg_fk_c3cf26913e7e198f38d38534" FOREIGN KEY ("session_id") REFERENCES "reception_sessions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "speaker_use_tickets" ADD CONSTRAINT "dg_fk_202433ff895e2bc575cdef2d" FOREIGN KEY ("session_id") REFERENCES "reception_sessions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "speaker_use_tickets" ADD CONSTRAINT "dg_fk_ba10746b6b8675ba51d9d349" FOREIGN KEY ("reference_id") REFERENCES "speaker_references" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_assistant_applications" ADD CONSTRAINT "dg_fk_a534b3fa4bfa72be72c1ce51" FOREIGN KEY ("project_id") REFERENCES "studio_projects" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_assistant_applications" ADD CONSTRAINT "dg_fk_161d9e2ee445d648296c3850" FOREIGN KEY ("generation_id") REFERENCES "studio_assistant_generations" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_assistant_applications" ADD CONSTRAINT "dg_fk_f9d55dd1c634f33b70219d2d" FOREIGN KEY ("turn_id") REFERENCES "studio_assistant_turns" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_assistant_applications" ADD CONSTRAINT "dg_fk_4aa2fff648833325ed54b666" FOREIGN KEY ("session_id") REFERENCES "studio_assistant_sessions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_assistant_generations" ADD CONSTRAINT "dg_fk_633f212d831bdfd193bba3cf" FOREIGN KEY ("speech_job_id") REFERENCES "studio_speech_jobs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_assistant_generations" ADD CONSTRAINT "dg_fk_d9f029ac24316e22083d0c6d" FOREIGN KEY ("branch_project_id") REFERENCES "studio_projects" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_assistant_generations" ADD CONSTRAINT "dg_fk_41d5df5575d59dbfe871a1f9" FOREIGN KEY ("turn_id") REFERENCES "studio_assistant_turns" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_assistant_generations" ADD CONSTRAINT "dg_fk_fdac8a0f252a427bf28b71d5" FOREIGN KEY ("session_id") REFERENCES "studio_assistant_sessions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_assistant_interpretations" ADD CONSTRAINT "dg_fk_fa1ba28fbb8cec6424fd1bce" FOREIGN KEY ("turn_id") REFERENCES "studio_assistant_turns" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_assistant_interpretations" ADD CONSTRAINT "dg_fk_47a1d7458341348c8924c286" FOREIGN KEY ("parent_turn_id") REFERENCES "studio_assistant_turns" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_assistant_interpretations" ADD CONSTRAINT "dg_fk_faa23340fb4dc0fe16ee1fca" FOREIGN KEY ("session_id") REFERENCES "studio_assistant_sessions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_assistant_sessions" ADD CONSTRAINT "dg_fk_1402743ce311dc8c865bab6f" FOREIGN KEY ("project_id") REFERENCES "studio_projects" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_assistant_turns" ADD CONSTRAINT "dg_fk_5587502a248e5eca9fd2fa23" FOREIGN KEY ("parent_turn_id") REFERENCES "studio_assistant_turns" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_assistant_turns" ADD CONSTRAINT "dg_fk_2fa82b9efa475ae6c794ebc5" FOREIGN KEY ("session_id") REFERENCES "studio_assistant_sessions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_batch_attempts" ADD CONSTRAINT "dg_fk_91febbd88e28010f0269e9f2" FOREIGN KEY ("export_id") REFERENCES "studio_exports" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_batch_attempts" ADD CONSTRAINT "dg_fk_dc806590dc2226b91779b536" FOREIGN KEY ("project_id") REFERENCES "studio_projects" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_batch_attempts" ADD CONSTRAINT "dg_fk_e8c9d8e0173ced82c8193593" FOREIGN KEY ("item_id") REFERENCES "studio_batch_items" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_batch_items" ADD CONSTRAINT "dg_fk_25e057e954cb1a01a32dcceb" FOREIGN KEY ("export_id") REFERENCES "studio_exports" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_batch_items" ADD CONSTRAINT "dg_fk_6933717d9bd984b5e49c0f20" FOREIGN KEY ("project_id") REFERENCES "studio_projects" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_batch_items" ADD CONSTRAINT "dg_fk_a0cd890ae1f716ef11c2850f" FOREIGN KEY ("batch_id") REFERENCES "studio_batches" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_character_versions" ADD CONSTRAINT "dg_fk_8fb3f08ac7dd2646c71db211" FOREIGN KEY ("character_id") REFERENCES "studio_characters" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_clones" ADD CONSTRAINT "dg_fk_5f6700c8341813e5239b5f1e" FOREIGN KEY ("job_id") REFERENCES "jobs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_clones" ADD CONSTRAINT "dg_fk_13e449e9c4c232cfa381fda8" FOREIGN KEY ("consent_id") REFERENCES "consents" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_clones" ADD CONSTRAINT "dg_fk_bf8a8f63dd53c6ecb82abffa" FOREIGN KEY ("asset_id") REFERENCES "assets" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_comments" ADD CONSTRAINT "dg_fk_dd2dae6cac005ad8fde649ab" FOREIGN KEY ("parent_id") REFERENCES "studio_comments" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_comments" ADD CONSTRAINT "dg_fk_578627b426c361983d987087" FOREIGN KEY ("project_id") REFERENCES "studio_projects" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_content_asset_origins" ADD CONSTRAINT "dg_fk_2cb9fdaafa2eb9f14719fe50" FOREIGN KEY ("origin_id") REFERENCES "studio_content_origins" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_content_asset_origins" ADD CONSTRAINT "dg_fk_32f88ce03b48f87ffe93f31f" FOREIGN KEY ("asset_id") REFERENCES "assets" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_content_brief_versions" ADD CONSTRAINT "dg_fk_39ddecfb95fe32867db3e3a0" FOREIGN KEY ("brief_id") REFERENCES "studio_content_briefs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_content_draft_versions" ADD CONSTRAINT "dg_fk_42a828d3cbe176a15aefc8d0" FOREIGN KEY ("draft_id") REFERENCES "studio_content_drafts" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_content_origins" ADD CONSTRAINT "dg_fk_1ffc80661ff96ee3823df53e" FOREIGN KEY ("draft_id") REFERENCES "studio_content_drafts" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_content_plan_versions" ADD CONSTRAINT "dg_fk_553d7b201ddb4b39f7f9e13e" FOREIGN KEY ("plan_id") REFERENCES "studio_content_plans" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_content_plans" ADD CONSTRAINT "dg_fk_6d4117fd537dc52625fd7254" FOREIGN KEY ("draft_id") REFERENCES "studio_content_drafts" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_content_source_versions" ADD CONSTRAINT "dg_fk_a7d61bb8984fb14c9ecd859e" FOREIGN KEY ("source_id") REFERENCES "studio_content_sources" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_content_writing_adoptions" ADD CONSTRAINT "dg_fk_0bb98a65631eeb5e2c139d1b" FOREIGN KEY ("actor_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_content_writing_adoptions" ADD CONSTRAINT "dg_fk_c8c516874792a7d15ce3be6f" FOREIGN KEY ("draft_id") REFERENCES "studio_content_drafts" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_content_writing_adoptions" ADD CONSTRAINT "dg_fk_ad5ded59a573b948e70631be" FOREIGN KEY ("job_id") REFERENCES "studio_content_writing_jobs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_content_writing_jobs" ADD CONSTRAINT "dg_fk_8f851d149712429a8ac3b19a" FOREIGN KEY ("actor_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_content_writing_jobs" ADD CONSTRAINT "dg_fk_c881f804eeae69fca7bc2774" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_course_exports" ADD CONSTRAINT "dg_fk_e220ab04efaa7057e62e54c7" FOREIGN KEY ("release_id") REFERENCES "studio_course_releases" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_course_releases" ADD CONSTRAINT "dg_fk_951bc40cdefe90229382e978" FOREIGN KEY ("course_id") REFERENCES "studio_courses" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_course_versions" ADD CONSTRAINT "dg_fk_f5bf3321944ad6b0577c3bad" FOREIGN KEY ("course_id") REFERENCES "studio_courses" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_export_artifacts" ADD CONSTRAINT "dg_fk_a5c87cd8c693d6f7104d850b" FOREIGN KEY ("export_id") REFERENCES "studio_exports" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_exports" ADD CONSTRAINT "dg_fk_6477336027ab242eda194445" FOREIGN KEY ("project_id") REFERENCES "studio_projects" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_frame_comments" ADD CONSTRAINT "dg_fk_cb870efac7eea5111144e346" FOREIGN KEY ("parent_id") REFERENCES "studio_frame_comments" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_frame_comments" ADD CONSTRAINT "dg_fk_1008e045c90d1f5a4b252188" FOREIGN KEY ("review_id") REFERENCES "studio_frame_reviews" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_frame_feedback" ADD CONSTRAINT "dg_fk_1620c1a6477e632725ab1520" FOREIGN KEY ("session_id") REFERENCES "studio_frame_review_sessions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_frame_feedback" ADD CONSTRAINT "dg_fk_3fe3327d9ea3caab58fc3bb1" FOREIGN KEY ("review_id") REFERENCES "studio_frame_reviews" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_frame_review_links" ADD CONSTRAINT "dg_fk_c9549daa64d3548ebc2aab5b" FOREIGN KEY ("review_id") REFERENCES "studio_frame_reviews" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_frame_review_sessions" ADD CONSTRAINT "dg_fk_05a0a3dbf163daaf7935c083" FOREIGN KEY ("link_id") REFERENCES "studio_frame_review_links" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_frame_reviews" ADD CONSTRAINT "dg_fk_0354b19d0c5bf565ae54237a" FOREIGN KEY ("artifact_id") REFERENCES "studio_export_artifacts" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_frame_reviews" ADD CONSTRAINT "dg_fk_feb3598aa24dbcba36e22e73" FOREIGN KEY ("export_id") REFERENCES "studio_exports" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_frame_reviews" ADD CONSTRAINT "dg_fk_b9eddca27de42beaca0abd7e" FOREIGN KEY ("project_id") REFERENCES "studio_projects" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_import_media" ADD CONSTRAINT "dg_fk_deea3c3888015a4fe43e812a" FOREIGN KEY ("import_id") REFERENCES "studio_imports" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_language_links" ADD CONSTRAINT "dg_fk_1e225be427f7161310bdc0c1" FOREIGN KEY ("target_project_id") REFERENCES "studio_projects" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_language_links" ADD CONSTRAINT "dg_fk_6e70ab5d0c99935496a11bda" FOREIGN KEY ("source_project_id") REFERENCES "studio_projects" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_media_applications" ADD CONSTRAINT "dg_fk_00695ed39a0f28e8db77db9a" FOREIGN KEY ("project_id") REFERENCES "studio_projects" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_media_applications" ADD CONSTRAINT "dg_fk_76f0a4663b7942464a65c5d7" FOREIGN KEY ("job_id") REFERENCES "studio_media_jobs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_media_jobs" ADD CONSTRAINT "dg_fk_f1ff1f29a694d821b87d20b9" FOREIGN KEY ("plan_id") REFERENCES "studio_media_plans" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_media_outputs" ADD CONSTRAINT "dg_fk_5fe7cc5981ce1f1ce029cfc2" FOREIGN KEY ("asset_id") REFERENCES "assets" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_media_outputs" ADD CONSTRAINT "dg_fk_96d794ab51b8e5f6cb539ea4" FOREIGN KEY ("job_id") REFERENCES "studio_media_jobs" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_media_plan_versions" ADD CONSTRAINT "dg_fk_77eed80bc079376584eae857" FOREIGN KEY ("plan_id") REFERENCES "studio_media_plans" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_package_imports" ADD CONSTRAINT "dg_fk_f9da70328cd414311f6839fa" FOREIGN KEY ("project_id") REFERENCES "studio_projects" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_package_imports" ADD CONSTRAINT "dg_fk_a55242996e9740edbbeb77bf" FOREIGN KEY ("transfer_id") REFERENCES "media_transfers" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_presentation_answer_jobs" ADD CONSTRAINT "dg_fk_a39d479e7a7f798f6c018fe8" FOREIGN KEY ("question_id") REFERENCES "studio_presentation_questions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_presentation_answer_jobs" ADD CONSTRAINT "dg_fk_0205aab55b250714cbea2428" FOREIGN KEY ("session_id") REFERENCES "studio_presentation_sessions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_presentation_applications" ADD CONSTRAINT "dg_fk_2fff5c530417db58387987fb" FOREIGN KEY ("project_id") REFERENCES "studio_projects" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_presentation_applications" ADD CONSTRAINT "dg_fk_05969f60b27bd067673f6b1d" FOREIGN KEY ("plan_id") REFERENCES "studio_presentation_plans" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_presentation_plan_versions" ADD CONSTRAINT "dg_fk_64423e79907bc4c2fb34cf0f" FOREIGN KEY ("plan_id") REFERENCES "studio_presentation_plans" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_presentation_plans" ADD CONSTRAINT "dg_fk_3f324c1017ef5a6fb8b3426b" FOREIGN KEY ("source_project_id") REFERENCES "studio_projects" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_presentation_questions" ADD CONSTRAINT "dg_fk_f5a97f3e3564b298161de9ee" FOREIGN KEY ("session_id") REFERENCES "studio_presentation_sessions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_presentation_sessions" ADD CONSTRAINT "dg_fk_fc3718429b9d1825c94d66b7" FOREIGN KEY ("artifact_id") REFERENCES "studio_export_artifacts" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_presentation_sessions" ADD CONSTRAINT "dg_fk_b47a8c62ea03a9d61bc85df9" FOREIGN KEY ("export_id") REFERENCES "studio_exports" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_presentation_sessions" ADD CONSTRAINT "dg_fk_d0c9d88cb90d4bd15f468cbf" FOREIGN KEY ("project_id") REFERENCES "studio_projects" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_preview_frames" ADD CONSTRAINT "dg_fk_e1945c44bbe8d44c3efe23c8" FOREIGN KEY ("project_id") REFERENCES "studio_projects" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_preview_jobs" ADD CONSTRAINT "dg_fk_e1a7dee79d0430bb905339c9" FOREIGN KEY ("project_id") REFERENCES "studio_projects" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_project_versions" ADD CONSTRAINT "dg_fk_c8bc60d53bf44c248bf73c7c" FOREIGN KEY ("project_id") REFERENCES "studio_projects" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_recording_applications" ADD CONSTRAINT "dg_fk_bf3d0089a8a51e7ed516b6ca" FOREIGN KEY ("project_id") REFERENCES "studio_projects" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_recording_applications" ADD CONSTRAINT "dg_fk_dce7664ea7a48301422877ac" FOREIGN KEY ("recording_id") REFERENCES "studio_recordings" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_recording_outputs" ADD CONSTRAINT "dg_fk_74a78954759dd76431c6ee22" FOREIGN KEY ("asset_id") REFERENCES "assets" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_recording_outputs" ADD CONSTRAINT "dg_fk_6fd7cdec4c2892d71bccd853" FOREIGN KEY ("transfer_id") REFERENCES "media_transfers" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_recording_outputs" ADD CONSTRAINT "dg_fk_ff03a049419ab7ee21bdbe8b" FOREIGN KEY ("recording_id") REFERENCES "studio_recordings" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_recording_versions" ADD CONSTRAINT "dg_fk_4fb984dfcd8e946dc24e1fad" FOREIGN KEY ("recording_id") REFERENCES "studio_recordings" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_recordings" ADD CONSTRAINT "dg_fk_d55a724fa9d2a29a31f5d735" FOREIGN KEY ("transfer_id") REFERENCES "media_transfers" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_review_plans" ADD CONSTRAINT "dg_fk_690e716033611312d1a01476" FOREIGN KEY ("project_id") REFERENCES "studio_projects" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_reviews" ADD CONSTRAINT "dg_fk_87c345ce7a6cb9dff20b6ca4" FOREIGN KEY ("export_id") REFERENCES "studio_exports" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_reviews" ADD CONSTRAINT "dg_fk_7fc0e05083093d6e455868cf" FOREIGN KEY ("project_id") REFERENCES "studio_projects" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_share_event_requests" ADD CONSTRAINT "dg_fk_5e3937266b138e2e3a36ee97" FOREIGN KEY ("event_id") REFERENCES "studio_share_events" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;

ALTER TABLE "studio_share_event_requests" ADD CONSTRAINT "dg_fk_daf6a0772685fa0befc2e1df" FOREIGN KEY ("session_id") REFERENCES "studio_share_sessions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_share_events" ADD CONSTRAINT "dg_fk_e699d8b7f297c30ecc41d3ec" FOREIGN KEY ("session_id") REFERENCES "studio_share_sessions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_share_join_requests" ADD CONSTRAINT "dg_fk_7192aea456adcc0d280aacf8" FOREIGN KEY ("session_id") REFERENCES "studio_share_sessions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_share_join_requests" ADD CONSTRAINT "dg_fk_ae59f2397614290551f20857" FOREIGN KEY ("link_id") REFERENCES "studio_share_links" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_share_links" ADD CONSTRAINT "dg_fk_a8fed5e398d2ba8b33c55852" FOREIGN KEY ("release_id") REFERENCES "studio_share_releases" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_share_releases" ADD CONSTRAINT "dg_fk_00c7e39cfde25a38328c4888" FOREIGN KEY ("share_id") REFERENCES "studio_shares" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_share_sessions" ADD CONSTRAINT "dg_fk_1d72a58efd414d85fa79b73c" FOREIGN KEY ("link_id") REFERENCES "studio_share_links" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_share_versions" ADD CONSTRAINT "dg_fk_d0265574c6494027d93741cb" FOREIGN KEY ("share_id") REFERENCES "studio_shares" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_speech_jobs" ADD CONSTRAINT "dg_fk_4f072da1ceac5e749dd985d2" FOREIGN KEY ("project_id") REFERENCES "studio_projects" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_subtitle_editions" ADD CONSTRAINT "dg_fk_dade369a6c818a53cac44a58" FOREIGN KEY ("project_id") REFERENCES "studio_projects" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_subtitle_revisions" ADD CONSTRAINT "dg_fk_16d82036ca194c1572feeddd" FOREIGN KEY ("edition_id") REFERENCES "studio_subtitle_editions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_template_instantiations" ADD CONSTRAINT "dg_fk_388feb8d5a153fad2a4c89f9" FOREIGN KEY ("project_id") REFERENCES "studio_projects" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_template_versions" ADD CONSTRAINT "dg_fk_f93d259e08e983bd982d618d" FOREIGN KEY ("template_id") REFERENCES "studio_templates" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_timeline_previews" ADD CONSTRAINT "dg_fk_fc19d558548424cc9740eb35" FOREIGN KEY ("project_id") REFERENCES "studio_projects" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_transcription_revisions" ADD CONSTRAINT "dg_fk_6889efd08f939344cd833ca4" FOREIGN KEY ("transcription_id") REFERENCES "studio_transcriptions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_transcription_sources" ADD CONSTRAINT "dg_fk_77b7e309c51bc8104a1ca32f" FOREIGN KEY ("transcription_id") REFERENCES "studio_transcriptions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_transcription_sources" ADD CONSTRAINT "dg_fk_4eae332765eb3837e7e3ed08" FOREIGN KEY ("source_id") REFERENCES "studio_content_sources" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "studio_transcriptions" ADD CONSTRAINT "dg_fk_f7accb9d14f22ad99dabde49" FOREIGN KEY ("source_id") REFERENCES "studio_content_sources" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "tour_bookings" ADD CONSTRAINT "dg_fk_81baba3c8c6c5806cc873c36" FOREIGN KEY ("slot_id") REFERENCES "tour_slots" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "tour_questions" ADD CONSTRAINT "dg_fk_d8d952333825ea6ed3871f29" FOREIGN KEY ("session_id") REFERENCES "tour_sessions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "tour_routes" ADD CONSTRAINT "dg_fk_0ad674f7aef044432266f899" FOREIGN KEY ("hall_id") REFERENCES "exhibition_halls" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "tour_sessions" ADD CONSTRAINT "dg_fk_90673b4e61dcd24934065711" FOREIGN KEY ("device_id") REFERENCES "exhibit_devices" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "tour_sessions" ADD CONSTRAINT "dg_fk_118917fe5518928c8dc72977" FOREIGN KEY ("booking_id") REFERENCES "tour_bookings" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "tour_sessions" ADD CONSTRAINT "dg_fk_7f6e2d3fc51a8010367cfbcf" FOREIGN KEY ("route_id") REFERENCES "tour_routes" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "tour_sessions" ADD CONSTRAINT "dg_fk_19c84ebf25aecd49911fbd06" FOREIGN KEY ("hall_id") REFERENCES "exhibition_halls" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "tour_slots" ADD CONSTRAINT "dg_fk_f0d0d24326b2a9c1c80ce1f5" FOREIGN KEY ("hall_id") REFERENCES "exhibition_halls" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "venues" ADD CONSTRAINT "dg_fk_977e5ee358cbc3025f493b6a" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "venues" ADD CONSTRAINT "dg_fk_425f3f954c712b3cfafa7606" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "video_sources" ADD CONSTRAINT "dg_fk_17f7a5c7d81719dec07374ef" FOREIGN KEY ("asset_id") REFERENCES "assets" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "visit_confirmation_targets" ADD CONSTRAINT "dg_fk_826b22ce28e99fd1a6766714" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "visit_confirmation_targets" ADD CONSTRAINT "dg_fk_24af39455c9964aa042802ad" FOREIGN KEY ("visit_id") REFERENCES "visits" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "visit_deliveries" ADD CONSTRAINT "dg_fk_427043b10e67221569b7063a" FOREIGN KEY ("visit_id") REFERENCES "visits" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "visits" ADD CONSTRAINT "dg_fk_d04d1f3fb39ba6186e31a611" FOREIGN KEY ("host_id") REFERENCES "reception_hosts" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "visits" ADD CONSTRAINT "dg_fk_ecfd282e907f1ce32c28d0f2" FOREIGN KEY ("session_id") REFERENCES "reception_sessions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "visits" ADD CONSTRAINT "dg_fk_45f0fcb8b274f9751c9dbacb" FOREIGN KEY ("venue_id") REFERENCES "venues" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "visual_grants" ADD CONSTRAINT "dg_fk_5bb212c25e7d0a8977382186" FOREIGN KEY ("session_id") REFERENCES "reception_sessions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "visual_requests" ADD CONSTRAINT "dg_fk_57e8ea41223fb42f5743c79d" FOREIGN KEY ("grant_id") REFERENCES "visual_grants" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "visual_requests" ADD CONSTRAINT "dg_fk_f2f0a55705b04c464441102c" FOREIGN KEY ("session_id") REFERENCES "reception_sessions" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "voice_style_versions" ADD CONSTRAINT "dg_fk_b6c83f3d075c3cebffcece34" FOREIGN KEY ("style_id") REFERENCES "voice_styles" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "workspaces" ADD CONSTRAINT "dg_fk_8c93d86b3847ac7c3bc863e8" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION;
