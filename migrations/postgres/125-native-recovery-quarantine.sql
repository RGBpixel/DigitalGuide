-- Recovered copies remain closed even if a filesystem quarantine marker is lost.
-- No activation transition is provided. Existing runtime functions require validation_only.
ALTER TABLE _dg_native_runtime_control DROP CONSTRAINT _dg_native_runtime_control_status_check;
ALTER TABLE _dg_native_runtime_control ADD CONSTRAINT _dg_native_runtime_control_status_check
 CHECK(status IN ('validation_only','recovery_quarantined'));
