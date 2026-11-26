-- Permit only native suggestion references; the 122 deferred source/action guard remains required.
ALTER TABLE dining_service_requests DROP CONSTRAINT native_service_shape;
ALTER TABLE dining_service_requests ADD CONSTRAINT native_service_shape CHECK(kind IN('water','napkins','staff_help','dish_progress','billing_help') AND status IN('requested','acknowledged','resolved','cancelled') AND version>0 AND char_length(note)<=200 AND (source_request_id IS NULL OR source_request_id ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')) NOT VALID;
ALTER TABLE dining_service_requests ADD CONSTRAINT native_service_suggestion_reference FOREIGN KEY(source_request_id) REFERENCES _dg_native_service_suggestions(id) NOT VALID;
