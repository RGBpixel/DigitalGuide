import {scopedMemberName} from './member-name-sql.js';
import {randomUUID} from 'node:crypto';
import {AppError,canonical,type Principal} from '../../domain/src/index.js';
import {memberDirectoryView,type MemberDirectoryScope,type MemberDirectoryView,type MemberCreate,type MemberAccess} from '../../contracts/src/member-directory.js';
import {identityHash} from './identity-runtime.js';
import {IdentityWorkflows,type IdentityWorkflow,type IdentityRow} from './identity-workflows.js';
import {effectiveMemberships} from './membership-sql.js';
function* query(sql:string,args:unknown[]=[],postgresSql?:string):IdentityWorkflow<IdentityRow[]>{return(yield{kind:'query',sql,args,...(postgresSql?{postgresSql}:{})}) as IdentityRow[];}
export type MemberMutation={action:'create';input:MemberCreate}|{action:'access';input:MemberAccess};
export class MemberWorkflows {
 constructor(readonly identity:IdentityWorkflows){}
 get host(){return this.identity.runtime.host;}
 get memberships(){return effectiveMemberships(this.host.providerMode,this.host.appEnv);}
 *view(p:Principal,input:MemberDirectoryScope):IdentityWorkflow<MemberDirectoryView>{
  const access=yield* this.identity.actor(p,input.workspaceId),spaces=yield* query('SELECT id,name FROM workspaces WHERE tenant_id=? ORDER BY id',[p.tenantId]),known=spaces.filter(row=>access.principal.workspaceIds.includes(String(row.id)));
  const sql=`SELECT m.user_id,${scopedMemberName('u','m.tenant_id',this.host.providerMode,this.host.appEnv)} AS name,m.role,m.workspace_ids,coalesce(d.version,0) AS version,coalesce(c.status,'active') AS status,coalesce(d.origin,'existing') AS origin FROM ${this.memberships} m JOIN users u ON u.id=m.user_id LEFT JOIN enterprise_member_directory d ON d.user_id=m.user_id AND d.tenant_id=m.tenant_id AND d.environment=? AND d.app_env=? LEFT JOIN enterprise_member_controls c ON c.user_id=m.user_id AND c.tenant_id=m.tenant_id AND c.environment=d.environment AND c.app_env=d.app_env WHERE m.tenant_id=? AND (?=1 OR EXISTS(SELECT 1 FROM json_each(m.workspace_ids) WHERE value=?)) AND m.user_id>? ORDER BY m.user_id LIMIT ?`;
  const rows=yield* query(sql,[this.host.providerMode,this.host.appEnv,p.tenantId,Number(access.canManage),input.workspaceId,input.cursor??'',input.limit+1],sql.replace('EXISTS(SELECT 1 FROM json_each(m.workspace_ids) WHERE value=?)','jsonb_exists(m.workspace_ids::jsonb,?)'));
  // Controls also apply to legacy members with no directory override.
  const controls=yield* query('SELECT user_id,status FROM enterprise_member_controls WHERE tenant_id=? AND environment=? AND app_env=?',this.identity.scope(p.tenantId));
  const page=rows.slice(0,input.limit),events=yield* query('SELECT id,user_id,action,revision,created_at FROM enterprise_member_events WHERE tenant_id=? AND environment=? AND app_env=? AND (?=1 OR workspace_id=?) ORDER BY created_at DESC,id DESC LIMIT 20',[...this.identity.scope(p.tenantId),Number(access.canManage),input.workspaceId]);
  return memberDirectoryView.parse({workspaceId:input.workspaceId,canManageOrganization:access.canManage,environment:this.host.providerMode,appEnv:this.host.appEnv,workspaces:known,members:page.map(row=>({id:row.user_id,name:row.name,role:row.role,workspaceIds:JSON.parse(String(row.workspace_ids)).filter((id:string)=>access.principal.workspaceIds.includes(id)),version:Number(row.version),status:controls.find(control=>control.user_id===row.user_id)?.status??'active',provisioned:row.origin==='provisioned'})),nextCursor:rows.length>input.limit?String(page.at(-1)!.user_id):null,events:events.map(row=>({id:row.id,userId:row.user_id,action:row.action,revision:Number(row.revision),createdAt:row.created_at}))});
 }
 *mutation(p:Principal,mutation:MemberMutation,key:string):IdentityWorkflow<{receiptId:string;userId:string;view:MemberDirectoryView}>{
  yield* this.identity.organization(p.tenantId,true);const access=yield* this.identity.actor(p,mutation.input.workspaceId,true),actor=access.principal,action='POST /api/v1/enterprise/members/'+mutation.action+'|'+this.host.providerMode+'/'+this.host.appEnv,bodyHash=identityHash(canonical(mutation.input));
  const prior=(yield* query('SELECT request_hash,response,redacted FROM idempotency WHERE tenant_id=? AND actor_id=? AND action=? AND key=?',[p.tenantId,p.userId,action,key]))[0];let receiptId:string;
  if(prior){if(prior.request_hash!==bodyHash)throw new AppError('IDEMPOTENCY_CONFLICT','同一操作编号的内容发生变化，请使用新编号。',409);if(Number(prior.redacted))throw new AppError('DATA_REMOVED','旧操作内容已清除，请刷新。',409);receiptId=String(JSON.parse(String(prior.response)).receiptId);}else{
   if(mutation.action==='access'&&(yield* this.identity.managedMember(p.tenantId,mutation.input.userId)))throw new AppError('MEMBER_DIRECTORY_MANAGED','该成员由企业目录管理，请在目录复核流程中处理权限。',409);
   receiptId=yield* this.change(actor,mutation);yield* query('INSERT INTO idempotency(tenant_id,actor_id,action,key,request_hash,response,status_code,created_at) VALUES(?,?,?,?,?,?,?,?)',[p.tenantId,p.userId,action,key,bodyHash,JSON.stringify({receiptId,userId:mutation.input.userId}),200,yield{kind:'now'}]);
  }
  return{receiptId,userId:mutation.input.userId,view:yield* this.view(actor,{workspaceId:mutation.input.workspaceId,limit:20})};
 }
 *change(p:Principal,mutation:MemberMutation):IdentityWorkflow<string>{
  const input=mutation.input,known=yield* query('SELECT id FROM workspaces WHERE tenant_id=?',[p.tenantId]),ids=[...input.workspaceIds].sort();
  if(ids.some(id=>!known.some(row=>row.id===id)))throw new AppError('MEMBER_WORKSPACE_INVALID','所选工作空间不属于本组织，请刷新后重新选择。',409);
  if(input.role==='admin'&&ids.length===0)throw new AppError('MEMBER_WORKSPACE_REQUIRED','管理员至少需要一个工作空间。',409);
  const at=(yield{kind:'now'}) as string;let version=1,origin='existing',createdAt=at;
  if(mutation.action==='create'){
   if((yield* query('SELECT id FROM users WHERE id=?',[input.userId])).length)throw new AppError('MEMBER_ID_UNAVAILABLE','成员编号已被使用，请重新建号。',409);
   if(Number((yield* query(`SELECT count(*) AS n FROM ${this.memberships} m WHERE m.tenant_id=?`,[p.tenantId]))[0].n)>=5000)throw new AppError('MEMBER_DIRECTORY_LIMIT','组织成员数量已达当前上限，请联系管理员。',409);
   yield{kind:'provisionUser',actorId:p.userId,userId:input.userId,tenantId:p.tenantId,name:mutation.input.name};origin='provisioned';
  }else{
   if(input.userId===p.userId)throw new AppError('IDENTITY_SELF_CONTROL_FORBIDDEN','请由另一位组织管理员处理当前登录账户。',409);
   yield{kind:'memberLock',userId:input.userId};const member=yield* this.identity.member(p.tenantId,input.userId),old=(yield* query('SELECT * FROM enterprise_member_directory WHERE tenant_id=? AND environment=? AND app_env=? AND user_id=?',[...this.identity.scope(p.tenantId),input.userId]))[0],current=Number(old?.version??0);
   if(current!==mutation.input.version||current>=1_000_000_000)throw new AppError('IDENTITY_VERSION_CHANGED','成员权限已被其他人更新，请刷新后重新核对。',409);
   if(member.role===input.role&&canonical(JSON.parse(String(member.workspace_ids)).sort())===canonical(ids))throw new AppError('IDENTITY_UNCHANGED','成员权限没有变化，请刷新核对。',409);
   version=current+1;origin=String(old?.origin??'existing');createdAt=String(old?.created_at??at);
  }
  yield* query('INSERT INTO enterprise_member_directory VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,environment,app_env,user_id) DO UPDATE SET role=excluded.role,workspace_ids=excluded.workspace_ids,version=excluded.version,updated_at=excluded.updated_at',[input.userId,...this.identity.scope(p.tenantId),input.role,JSON.stringify(ids),version,origin,createdAt,at]);
  yield* query('DELETE FROM auth_sessions WHERE user_id=? AND environment=? AND app_env=?',[input.userId,this.host.providerMode,this.host.appEnv]);
  const event=randomUUID();yield* query('INSERT INTO enterprise_member_events VALUES(?,?,?,?,?,?,?,?,?,?)',[event,p.tenantId,input.workspaceId,this.host.providerMode,this.host.appEnv,p.userId,input.userId,'member.'+mutation.action,version,at]);return event;
 }
}
