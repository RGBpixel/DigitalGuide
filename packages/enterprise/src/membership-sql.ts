// Identifiers and values are fixed here; request data must never enter this SQL fragment.
export function effectiveMemberships(environment='mock',appEnv='development'):string {
 if(!['mock','sandbox','live'].includes(environment)||!['development','sandbox','production'].includes(appEnv))throw new Error('Invalid membership environment');
 return `(SELECT b.user_id,b.tenant_id,coalesce(d.role,b.role) AS role,coalesce(d.workspace_ids,b.workspace_ids) AS workspace_ids FROM memberships b LEFT JOIN enterprise_member_directory d ON d.user_id=b.user_id AND d.tenant_id=b.tenant_id AND d.environment='${environment}' AND d.app_env='${appEnv}' WHERE d.user_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM enterprise_member_directory origin WHERE origin.user_id=b.user_id AND origin.origin='provisioned'))`;
}
