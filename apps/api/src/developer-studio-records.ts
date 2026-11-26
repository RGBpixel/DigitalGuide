import { randomUUID } from 'node:crypto';
import { AppError, canonical } from '@digitalguide/domain';
import { developerCredentialHash } from '../../../packages/enterprise/src/developer-credentials.js';
import type { DeveloperStudioAuthority } from '../../../packages/enterprise/src/developer-studio-workflows.js';
import type { IdentityRow, IdentityWorkflow } from '../../../packages/enterprise/src/identity-workflows.js';
import type { developerStudioOperation } from '../../../packages/contracts/src/developer-studio.js';
import type { z } from 'zod';
export const studioRequestHash=(authority:DeveloperStudioAuthority,kind:string,id:string|undefined,input:unknown)=>developerCredentialHash('studio-request',canonical({appId:authority.appId,tenantId:authority.tenantId,workspaceId:authority.workspaceId,environment:authority.environment,appEnv:authority.appEnv,kind,id:id??null,input}));
export const studioIdempotencyHash=(key:string)=>developerCredentialHash('studio-idempotency',key);
function* q(sql:string,args:unknown[]):IdentityWorkflow<IdentityRow[]>{return(yield{kind:'query',sql,args}) as IdentityRow[];}
export function* studioPrior(authority:DeveloperStudioAuthority,kind:z.infer<typeof developerStudioOperation>,key:string,requestHash:string):IdentityWorkflow<IdentityRow|undefined>{
  const prior=(yield* q('SELECT * FROM developer_studio_operations WHERE app_id=? AND kind=? AND idempotency_hash=?',[authority.appId,kind,studioIdempotencyHash(key)]))[0];
  if(prior&&prior.request_hash!==requestHash)throw new AppError('IDEMPOTENCY_CONFLICT','同一应用制作操作编号的内容已变化，请使用新编号。',409);
  return prior;
}
export function* recordStudioOperation(authority:DeveloperStudioAuthority,kind:z.infer<typeof developerStudioOperation>,requestHash:string,key:string|null,resourceId:string,projectId:string,version:number,requestId:string):IdentityWorkflow<string>{
  const id=randomUUID(),at=(yield{kind:'now'}) as string;
  yield* q('INSERT INTO developer_studio_operations(id,app_id,tenant_id,workspace_id,environment,app_env,credential_id,grant_version,responsible_user_id,kind,request_hash,idempotency_hash,resource_id,project_id,resource_version,request_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[id,authority.appId,authority.tenantId,authority.workspaceId,authority.environment,authority.appEnv,authority.credentialId,authority.grantVersion,authority.responsible.userId,kind,requestHash,key?studioIdempotencyHash(key):null,resourceId,projectId,version,requestId,at]);
  return id;
}
export function* recordStudioJobOrigin(authority:DeveloperStudioAuthority,exportId:string,operationId:string):IdentityWorkflow<void>{
  yield* q('INSERT INTO developer_studio_job_origins(export_id,app_id,tenant_id,workspace_id,environment,app_env,grant_version,responsible_user_id,credential_id,operation_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',[exportId,authority.appId,authority.tenantId,authority.workspaceId,authority.environment,authority.appEnv,authority.grantVersion,authority.responsible.userId,authority.credentialId,operationId,yield{kind:'now'}]);
}
