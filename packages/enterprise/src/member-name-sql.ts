// SQL identifiers are code-owned. Request values never become SQL fragments.
export function scopedMemberName(userAlias:string,tenantExpression:string,environment='mock',appEnv='development'){
 if(!/^[a-z][a-z0-9_]*$/.test(userAlias)||!/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(tenantExpression)||!['mock','sandbox','live'].includes(environment)||!['development','sandbox','production'].includes(appEnv))throw new Error('Invalid member display scope');
 return `coalesce((SELECT CASE WHEN directory_name.deleted=1 THEN '已删除目录成员' ELSE substr(directory_name.display_name,1,80) END FROM enterprise_directory_users directory_name WHERE directory_name.id=${userAlias}.id AND directory_name.tenant_id=${tenantExpression} AND directory_name.environment='${environment}' AND directory_name.app_env='${appEnv}'),${userAlias}.name)`;
}
