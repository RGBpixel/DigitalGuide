import { createHmac, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, canonical, requirePermission, requireWorkspace, type Principal } from '../../domain/src/index.js';
import { developerStudioContext, developerStudioViewSchema, type DeveloperStudioAction, type DeveloperStudioGrantInput, type DeveloperStudioView } from '../../contracts/src/developer-studio.js';
import { developerCredentialHash, developerHashMatches } from './developer-credentials.js';
import type { DeveloperWorkflows } from './developer-workflows.js';
import type { IdentityRow, IdentityWorkflow } from './identity-workflows.js';
import { effectiveMemberships } from './membership-sql.js';
import { scopedMemberName } from './member-name-sql.js';
function* q(sql:string,args:unknown[]=[],postgresSql?:string):IdentityWorkflow<IdentityRow[]>{return(yield{kind:'query',sql,args,...(postgresSql?{postgresSql}:{})}) as IdentityRow[];}
function* now():IdentityWorkflow<string>{return(yield{kind:'now'}) as string;}
const n=(value:unknown)=>Number(value);
export type DeveloperStudioAuthority={appId:string;credentialId:string;tenantId:string;workspaceId:string;environment:string;appEnv:string;grantVersion:number;responsible:Principal;actions:DeveloperStudioAction[];expiresAt:string};
type StudioPrincipal=Principal&{studioControlVersion:number;studioDirectoryVersion:number};
const requiredReads=(actions:DeveloperStudioAction[])=>[...(actions.includes('projects.write')||actions.includes('exports.submit')?['projects.read']:[]),...(actions.some(action=>action.startsWith('exports.'))?['exports.read']:[])];
export class DeveloperStudioWorkflows {
  constructor(readonly developer:DeveloperWorkflows){}
  get host(){return this.developer.host;}
  scope(tenantId:string,workspaceId:string){return this.developer.scope(tenantId,workspaceId);}
  reviewToken(tenantId:string,workspaceId:string,userId:string,role:string,controlVersion:number,directoryVersion:number){return createHmac('sha256',this.developer.identity.runtime.host.sessionSecret).update(canonical(['developer-studio-responsible-v1',tenantId,workspaceId,this.host.providerMode,this.host.appEnv,userId,role,controlVersion,directoryVersion])).digest('hex');}
  *member(tenantId:string,workspaceId:string,userId:string):IdentityWorkflow<StudioPrincipal>{
    yield{kind:'memberLock',userId};
    const row=(yield* q('SELECT tenant_id,role,workspace_ids FROM '+effectiveMemberships(this.host.providerMode,this.host.appEnv)+' WHERE user_id=?',[userId],'SELECT tenant_id,role,workspace_ids FROM dg_native_locked_membership(?)'))[0];
    const control=yield* this.developer.identity.control(tenantId,userId);
    if(!row||row.tenant_id!==tenantId||control?.status==='suspended')throw new AppError('DEVELOPER_STUDIO_ACTOR_UNAVAILABLE','制作责任人当前不可用，请管理员核对成员和授权。',403);
    const principal:Principal={userId,tenantId,role:z.enum(['admin','editor','reviewer','viewer']).parse(row.role),workspaceIds:z.array(z.uuid()).max(1000).parse(JSON.parse(String(row.workspace_ids))),environment:this.host.providerMode,appEnv:this.host.appEnv};
    try{requirePermission(principal,'studio.write');requireWorkspace(principal,workspaceId);}catch{throw new AppError('DEVELOPER_STUDIO_ACTOR_UNAVAILABLE','制作责任人已无当前空间的制作权限，请管理员重新核对。',403);}
    const directory=(yield* q('SELECT version FROM enterprise_member_directory WHERE tenant_id=? AND environment=? AND app_env=? AND user_id=?',[tenantId,this.host.providerMode,this.host.appEnv,userId]))[0];
    return{...principal,workspaceIds:[workspaceId],studioControlVersion:n(control?.version??0),studioDirectoryVersion:n(directory?.version??0)};
  }
  *view(p:Principal,workspaceId:string):IdentityWorkflow<DeveloperStudioView>{
    const access=yield* this.developer.access(p,workspaceId),at=yield* now(),name=scopedMemberName('u','m.tenant_id',this.host.providerMode,this.host.appEnv);
    const members=yield* q('SELECT m.user_id,m.role,m.workspace_ids,'+name+' name FROM '+effectiveMemberships(this.host.providerMode,this.host.appEnv)+' m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=? AND m.role IN(\'admin\',\'editor\') ORDER BY m.user_id LIMIT 1001',[p.tenantId]);
    if(members.length>1000)throw new AppError('DEVELOPER_STUDIO_MEMBER_LIMIT','制作责任人列表超过管理范围，请联系管理员。',409);
    const eligible: {id:string;name:string;role:'admin'|'editor';configurationToken:string}[]=[],controls=yield* q('SELECT user_id,status,version FROM enterprise_member_controls WHERE tenant_id=? AND environment=? AND app_env=?',[p.tenantId,this.host.providerMode,this.host.appEnv]),directories=yield* q('SELECT user_id,version FROM enterprise_member_directory WHERE tenant_id=? AND environment=? AND app_env=?',[p.tenantId,this.host.providerMode,this.host.appEnv]),authorities=new Map<string,{role:string;controlVersion:number;directoryVersion:number}>();
    for(const member of members){const userId=String(member.user_id),control=controls.find(row=>row.user_id===userId),directory=directories.find(row=>row.user_id===userId),stamp={role:String(member.role),controlVersion:n(control?.version??0),directoryVersion:n(directory?.version??0)};if(control?.status!=='suspended'&&(JSON.parse(String(member.workspace_ids)) as string[]).includes(workspaceId)){authorities.set(userId,stamp);eligible.push({id:userId,name:String(member.name).slice(0,100),role:member.role as 'admin'|'editor',configurationToken:this.reviewToken(p.tenantId,workspaceId,userId,stamp.role,stamp.controlVersion,stamp.directoryVersion)});}}
    const apps=yield* q('SELECT a.*,g.responsible_user_id,g.responsible_role,g.responsible_control_version,g.responsible_directory_version,g.actions,g.enabled grant_enabled,g.version grant_version,g.expires_at,g.updated_at grant_updated_at FROM developer_apps a LEFT JOIN developer_studio_grants g ON g.app_id=a.id WHERE a.tenant_id=? AND a.workspace_id=? AND a.environment=? AND a.app_env=? ORDER BY a.id LIMIT 51',this.scope(p.tenantId,workspaceId));
    if(apps.length>50)throw new AppError('DEVELOPER_APP_LIMIT','当前空间应用超过管理范围，请联系管理员。',409);
    const changes=yield* q('SELECT id,app_id,action,version,created_at FROM developer_studio_events WHERE tenant_id=? AND workspace_id=? AND environment=? AND app_env=? ORDER BY created_at DESC,id DESC LIMIT 20',this.scope(p.tenantId,workspaceId));
    const operations=yield* q('SELECT id,app_id,responsible_user_id,kind,resource_id,project_id,created_at FROM developer_studio_operations WHERE tenant_id=? AND workspace_id=? AND environment=? AND app_env=? ORDER BY created_at DESC,id DESC LIMIT 20',this.scope(p.tenantId,workspaceId));
    return developerStudioViewSchema.parse({tenantId:p.tenantId,workspaceId,environment:this.host.providerMode,appEnv:this.host.appEnv,canManageOrganization:access.canManage,scope:'current_workspace',credentialRenewalRequiredAfterGrantChange:true,members:eligible,
      apps:apps.map(app=>{const responsible=eligible.find(member=>member.id===app.responsible_user_id),authority=authorities.get(String(app.responsible_user_id)),current=!!authority&&authority.role===app.responsible_role&&authority.controlVersion===n(app.responsible_control_version)&&authority.directoryVersion===n(app.responsible_directory_version),actions=app.actions?JSON.parse(String(app.actions)):[];return{id:app.id,name:app.name,version:n(app.version),enabled:n(app.enabled)===1,readScopes:JSON.parse(String(app.scopes)),grant:app.grant_version?{version:n(app.grant_version),enabled:n(app.grant_enabled)===1,responsibleUserId:app.responsible_user_id,responsibleName:responsible?.name??'责任人当前不可用',responsibleAvailable:!!responsible,responsibleAuthorityCurrent:current,actions,expiresAt:app.expires_at,updatedAt:app.grant_updated_at,usable:n(app.enabled)===1&&n(app.grant_enabled)===1&&String(app.expires_at)>at&&current&&requiredReads(actions).every(scope=>(JSON.parse(String(app.scopes)) as string[]).includes(scope))}:null};}),
      recentChanges:changes.map(change=>({id:change.id,appId:change.app_id,action:change.action,version:n(change.version),createdAt:change.created_at})),recentOperations:operations.map(operation=>({id:operation.id,appId:operation.app_id,responsibleUserId:operation.responsible_user_id,responsibleName:eligible.find(member=>member.id===operation.responsible_user_id)?.name??'原制作责任人',kind:operation.kind,resourceId:operation.resource_id,projectId:operation.project_id,createdAt:operation.created_at}))});
  }
  *configure(p:Principal,input:DeveloperStudioGrantInput,key:string):IdentityWorkflow<{receiptId:string;credentialsRevoked:true;view:DeveloperStudioView}>{
    const access=yield* this.developer.access(p,input.workspaceId,true),action='POST /api/v1/enterprise/developer-studio/configure',requestHash=developerCredentialHash('studio-grant',canonical(input));
    const oldReceipt=(yield* q('SELECT request_hash,response,redacted FROM idempotency WHERE tenant_id=? AND actor_id=? AND action=? AND key=?',[p.tenantId,p.userId,action,key]))[0];
    let receiptId:string;
    if(oldReceipt){if(oldReceipt.request_hash!==requestHash)throw new AppError('IDEMPOTENCY_CONFLICT','同一制作授权操作编号的内容已变化，请重新核对。',409);if(n(oldReceipt.redacted))throw new AppError('DATA_REMOVED','旧制作授权操作已清理，请刷新。',409);receiptId=(JSON.parse(String(oldReceipt.response)) as {receiptId:string}).receiptId;}
    else{
      const app=yield* this.developer.app(access.principal,input.workspaceId,input.appId),sql='SELECT * FROM developer_studio_grants WHERE app_id=?',grant=(yield* q(sql,[input.appId],sql+' FOR UPDATE'))[0],at=yield* now(),version=n(grant?.version??0);
      if(n(app.version)!==input.expectedAppVersion||version!==input.expectedVersion)throw new AppError('DEVELOPER_STUDIO_VERSION_CHANGED','应用或制作授权已被更新，请刷新后重新确认。',409);
      if(version>=1_000_000_000||n(app.version)>=1_000_000_000)throw new AppError('DEVELOPER_STUDIO_VERSION_LIMIT','应用或制作授权修订已达上限，请创建新应用。',409);
      if(input.enabled){if(n(app.enabled)!==1||!requiredReads(input.actions).every(scope=>(JSON.parse(String(app.scopes)) as string[]).includes(scope)))throw new AppError('DEVELOPER_STUDIO_READ_SCOPE_REQUIRED','请先启用应用并授权所选制作动作需要的工程/导出读取范围。',403);}
      let responsible:StudioPrincipal|undefined;
      if(input.enabled||!grant||input.responsibleUserId!==grant.responsible_user_id){responsible=yield* this.member(p.tenantId,input.workspaceId,input.responsibleUserId);if(input.responsibleConfigurationToken!==this.reviewToken(p.tenantId,input.workspaceId,responsible.userId,responsible.role,responsible.studioControlVersion,responsible.studioDirectoryVersion))throw new AppError('DEVELOPER_STUDIO_RESPONSIBLE_CHANGED','制作责任人的权限已变化，请刷新后重新选择并确认。',409);}
      const responsibleRole=responsible?.role??String(grant!.responsible_role),controlVersion=responsible?.studioControlVersion??n(grant!.responsible_control_version),directoryVersion=responsible?.studioDirectoryVersion??n(grant!.responsible_directory_version);
      const next=version+1,expiresAt=new Date(Date.parse(at)+input.termDays*86400000).toISOString();
      if(grant)yield* q('UPDATE developer_studio_grants SET responsible_user_id=?,responsible_role=?,responsible_control_version=?,responsible_directory_version=?,actions=?,enabled=?,expires_at=?,version=?,updated_at=? WHERE app_id=?',[input.responsibleUserId,responsibleRole,controlVersion,directoryVersion,canonical([...input.actions].sort()),+input.enabled,expiresAt,next,at,input.appId]);
      else yield* q('INSERT INTO developer_studio_grants(app_id,tenant_id,workspace_id,environment,app_env,responsible_user_id,responsible_role,responsible_control_version,responsible_directory_version,actions,enabled,expires_at,version,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[input.appId,...this.scope(p.tenantId,input.workspaceId),input.responsibleUserId,responsibleRole,controlVersion,directoryVersion,canonical([...input.actions].sort()),+input.enabled,expiresAt,next,p.userId,at,at]);
      yield* q('UPDATE developer_credentials SET revoked_at=? WHERE app_id=? AND revoked_at IS NULL',[at,input.appId]);yield* q('UPDATE developer_apps SET version=version+1,updated_at=? WHERE id=?',[at,input.appId]);
      receiptId=randomUUID();yield* q('INSERT INTO developer_studio_events(id,tenant_id,workspace_id,environment,app_env,actor_id,origin,app_id,action,version,responsible_user_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',[receiptId,...this.scope(p.tenantId,input.workspaceId),p.userId,'administrator',input.appId,grant?'configured':'created',next,input.responsibleUserId,at]);
      yield* q('INSERT INTO idempotency(tenant_id,actor_id,action,key,request_hash,response,status_code,created_at) VALUES(?,?,?,?,?,?,?,?)',[p.tenantId,p.userId,action,key,requestHash,JSON.stringify({receiptId}),200,at]);
    }
    return{receiptId,credentialsRevoked:true,view:yield* this.view(access.principal,input.workspaceId)};
  }
  *authorize(auth:{id:string;hash:string},required:DeveloperStudioAction|null):IdentityWorkflow<DeveloperStudioAuthority>{
    const preliminary=(yield* q('SELECT tenant_id FROM developer_credentials WHERE id=?',[auth.id]))[0];if(!preliminary)throw new AppError('DEVELOPER_AUTH_REQUIRED','应用凭证无效、已到期或已撤销。',401);
    yield* this.developer.identity.organization(String(preliminary.tenant_id));
    const found=(yield* q('SELECT app_id FROM developer_credentials WHERE id=?',[auth.id]))[0],appSql='SELECT * FROM developer_apps WHERE id=? AND environment=? AND app_env=?',app=(yield* q(appSql,[found?.app_id,this.host.providerMode,this.host.appEnv],appSql+' FOR SHARE'))[0],keySql='SELECT * FROM developer_credentials WHERE id=?',key=(yield* q(keySql,[auth.id],keySql+' FOR SHARE'))[0],at=yield* now();
    if(!app||!key||!developerHashMatches(key.secret_hash,auth.hash)||key.app_id!==app.id||key.tenant_id!==app.tenant_id||key.workspace_id!==app.workspace_id||key.environment!==this.host.providerMode||key.app_env!==this.host.appEnv||key.revoked_at||String(key.expires_at)<=at||n(app.enabled)!==1)throw new AppError('DEVELOPER_AUTH_REQUIRED','应用凭证无效、已到期或已撤销。',401);
    const sql='SELECT * FROM developer_studio_grants WHERE app_id=?',grant=(yield* q(sql,[app.id],sql+' FOR SHARE'))[0];
    if(!grant||n(grant.enabled)!==1||String(grant.expires_at)<=at)throw new AppError('DEVELOPER_STUDIO_GRANT_REQUIRED','应用未获得当前有效的制作授权，请管理员核对责任人、动作和期限。',403);
    const actions=JSON.parse(String(grant.actions)) as DeveloperStudioAction[];
    if((required&&!actions.includes(required))||!requiredReads(actions).every(scope=>(JSON.parse(String(app.scopes)) as string[]).includes(scope)))throw new AppError('DEVELOPER_STUDIO_ACTION_REQUIRED','应用未获得此制作动作，请管理员核对具体授权。',403);
    const responsible=yield* this.member(String(app.tenant_id),String(app.workspace_id),String(grant.responsible_user_id));
    if(responsible.role!==grant.responsible_role||responsible.studioControlVersion!==n(grant.responsible_control_version)||responsible.studioDirectoryVersion!==n(grant.responsible_directory_version))throw new AppError('DEVELOPER_STUDIO_RESPONSIBLE_CHANGED','制作责任人的权限版本已变化，请管理员重新确认制作委托并签发新凭证。',403);
    return{appId:String(app.id),credentialId:auth.id,tenantId:String(app.tenant_id),workspaceId:String(app.workspace_id),environment:this.host.providerMode,appEnv:this.host.appEnv,grantVersion:n(grant.version),responsible,actions,expiresAt:String(grant.expires_at)};
  }
  context(authority:DeveloperStudioAuthority){return developerStudioContext.parse({identity:'organization_application',appId:authority.appId,tenantId:authority.tenantId,workspaceId:authority.workspaceId,environment:authority.environment,appEnv:authority.appEnv,grantVersion:authority.grantVersion,actions:authority.actions,expiresAt:authority.expiresAt,scope:'current_workspace',rateLimit:{requests:60,windowSeconds:60}});}
}
