import {randomUUID} from 'node:crypto';
import type {Repository} from '@digitalguide/database';
import {AppError,requirePermission,requireWorkspace,type Principal} from '@digitalguide/domain';
import type {EnterprisePlanAssign,EnterpriseSeatChange} from '../../../packages/contracts/src/enterprise-plans.js';
import {assertCorePlanAdmission,assertPlanWritable,planAssignmentDecision,seatDecision,type PlanAssignmentRow,type PlanSeatRow} from '../../../packages/enterprise/src/policy.js';
import {enterprisePlanView,type PlanMemberRow,type PlanEventRow} from '../../../packages/enterprise/src/view.js';
import type {Config} from './config.js';
export class EnterprisePlanService{
 constructor(readonly repo:Repository,readonly config:Config){}
 scope(p:Principal,w:string,write=false){requirePermission(p,write?'operations.manage':'operations.read');requireWorkspace(p,w);if(!this.repo.get('SELECT 1 FROM workspaces WHERE id=? AND tenant_id=?',w,p.tenantId))throw new AppError('NOT_FOUND','工作空间不存在或已撤回。',404);if(write)assertPlanWritable(this.config.providerMode,this.config.appEnv);}
 parameters(p:Principal){return[p.tenantId,this.config.providerMode,this.config.appEnv];}
 assignment(p:Principal){return this.repo.get<PlanAssignmentRow>('SELECT * FROM enterprise_plan_assignments WHERE tenant_id=? AND environment=? AND app_env=?',...this.parameters(p));}
 seats(p:Principal){return this.repo.all<PlanSeatRow>('SELECT user_id,workspace_id,revoked_at FROM enterprise_seats WHERE tenant_id=? AND environment=? AND app_env=?',...this.parameters(p));}
 member(p:Principal,w:string,userId:string){return this.repo.get<PlanMemberRow>(`SELECT m.user_id,u.name,m.role FROM ${this.repo.membershipsSql()} m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=? AND m.user_id=? AND EXISTS(SELECT 1 FROM json_each(m.workspace_ids) j WHERE j.value=?)`,p.tenantId,userId,w);}
 view(p:Principal,w:string){this.scope(p,w);const now=new Date().toISOString();return enterprisePlanView({tenantId:p.tenantId,workspaceId:w,environment:this.config.providerMode,appEnv:this.config.appEnv,now,assignment:this.assignment(p),seats:this.seats(p),members:this.repo.all<PlanMemberRow>(`SELECT m.user_id,u.name,m.role FROM ${this.repo.membershipsSql()} m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=? AND EXISTS(SELECT 1 FROM json_each(m.workspace_ids) j WHERE j.value=?) ORDER BY m.user_id LIMIT 201`,p.tenantId,w),events:this.repo.all<PlanEventRow>('SELECT id,action,revision,created_at FROM enterprise_plan_events WHERE tenant_id=? AND environment=? AND app_env=? AND workspace_id=? ORDER BY created_at DESC,id DESC LIMIT 20',...this.parameters(p),w),legacyLimit:this.repo.get<{daily_limit:number}>('SELECT daily_limit FROM tenants WHERE id=?',p.tenantId)!.daily_limit,used:this.repo.get<{n:number}>('SELECT count(*) n FROM jobs WHERE tenant_id=? AND environment=? AND created_at>=?',p.tenantId,this.config.providerMode,now.slice(0,10))!.n});}
 event(p:Principal,w:string,subject:string,action:PlanEventRow['action'],revision:number,now:string,requestId:string){const id=randomUUID();this.repo.run('INSERT INTO enterprise_plan_events VALUES(?,?,?,?,?,?,?,?,?,?)',id,p.tenantId,w,this.config.providerMode,this.config.appEnv,p.userId,subject,action,revision,now);this.repo.audit(p,w,'enterprise.'+action,id,requestId);return id;}
 assign(p:Principal,input:EnterprisePlanAssign,requestId:string){
  this.scope(p,input.workspaceId,true);const now=new Date().toISOString(),row=this.assignment(p),seats=this.seats(p),actorSeat=seats.find(seat=>seat.user_id===p.userId&&!seat.revoked_at),decision=planAssignmentDecision(row,input,seats.filter(seat=>!seat.revoked_at).length,!!actorSeat,now);
  this.repo.run('INSERT INTO enterprise_plan_assignments VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,environment,app_env) DO UPDATE SET plan_id=excluded.plan_id,revision=excluded.revision,expires_at=excluded.expires_at,updated_at=excluded.updated_at,updated_by=excluded.updated_by',...this.parameters(p),input.planId,decision.revision,decision.expiresAt,now,p.userId);
  if(!actorSeat)this.repo.run('INSERT INTO enterprise_seats VALUES(?,?,?,?,?,?,NULL) ON CONFLICT(tenant_id,environment,app_env,user_id) DO UPDATE SET workspace_id=excluded.workspace_id,created_at=excluded.created_at,revoked_at=NULL',...this.parameters(p),p.userId,input.workspaceId,now);
  return this.event(p,input.workspaceId,input.planId,'plan.assign',decision.revision,now,requestId);
 }
 seat(p:Principal,input:EnterpriseSeatChange,requestId:string){
  this.scope(p,input.workspaceId,true);const row=this.assignment(p),seats=this.seats(p),seat=seats.find(seat=>seat.user_id===input.userId),member=this.member(p,input.workspaceId,input.userId),now=new Date().toISOString();
  if(!member&&seat?.workspace_id!==input.workspaceId)throw new AppError('ENTERPRISE_MEMBER_UNAVAILABLE','该成员不在当前工作空间。',404);
  const revision=seatDecision(row,input,seats.filter(seat=>!seat.revoked_at).length,seat,!!member&&['admin','editor'].includes(member.role),now);
  if(input.action==='assign')this.repo.run('INSERT INTO enterprise_seats VALUES(?,?,?,?,?,?,NULL) ON CONFLICT(tenant_id,environment,app_env,user_id) DO UPDATE SET workspace_id=excluded.workspace_id,created_at=excluded.created_at,revoked_at=NULL',...this.parameters(p),input.userId,input.workspaceId,now);
  else this.repo.run('UPDATE enterprise_seats SET revoked_at=? WHERE tenant_id=? AND environment=? AND app_env=? AND user_id=?',now,...this.parameters(p),input.userId);
  this.repo.run('UPDATE enterprise_plan_assignments SET revision=?,updated_at=?,updated_by=? WHERE tenant_id=? AND environment=? AND app_env=?',revision,now,p.userId,...this.parameters(p));
  return this.event(p,input.workspaceId,input.userId,input.action==='assign'?'seat.assign':'seat.release',revision,now,requestId);
 }
 admission(p:Principal,kind:string,now:string,legacy:number,used:number){assertCorePlanAdmission(this.assignment(p),this.seats(p).find(seat=>seat.user_id===p.userId),kind,now,legacy,used);}
}
