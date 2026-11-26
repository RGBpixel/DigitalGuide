import {AppError} from '../../domain/src/index.js';
export const identitySessionQuery=`SELECT o.*,p.enabled AS provider_enabled,p.version AS current_provider_version,p.config_hash AS current_provider_hash,b.enabled AS binding_enabled,b.version AS current_binding_version,coalesce(c.version,0) AS current_member_version,coalesce(c.status,'active') AS member_status
 FROM enterprise_identity_session_origins o
 LEFT JOIN enterprise_identity_providers p ON p.provider_id=o.provider_id AND p.tenant_id=o.tenant_id AND p.environment=o.environment AND p.app_env=o.app_env
 LEFT JOIN enterprise_identity_bindings b ON b.id=o.binding_id AND b.user_id=o.user_id AND b.provider_id=o.provider_id AND b.tenant_id=o.tenant_id AND b.environment=o.environment AND b.app_env=o.app_env
 LEFT JOIN enterprise_member_controls c ON c.user_id=o.user_id AND c.tenant_id=o.tenant_id AND c.environment=o.environment AND c.app_env=o.app_env WHERE o.token_hash=?`;
export function assertIdentitySession(row:Record<string,unknown>|undefined,scope:{userId:string;tenantId:string;environment:string;appEnv:string},fingerprints:ReadonlyMap<string,string>){
 if(!row)return;const valid=row.user_id===scope.userId&&row.tenant_id===scope.tenantId&&row.environment===scope.environment&&row.app_env===scope.appEnv&&Number(row.provider_enabled)===1&&Number(row.binding_enabled)===1&&row.member_status==='active'&&Number(row.provider_version)===Number(row.current_provider_version)&&Number(row.binding_version)===Number(row.current_binding_version)&&Number(row.member_version)===Number(row.current_member_version)&&row.config_hash===row.current_provider_hash&&fingerprints.get(String(row.provider_id))===row.config_hash;
 if(!valid)throw new AppError('AUTH_REQUIRED','企业登录权限或配置已变化，请重新登录或联系管理员。',401);
}
