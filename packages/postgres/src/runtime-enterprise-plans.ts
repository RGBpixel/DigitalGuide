import {effectiveMemberships} from '../../enterprise/src/membership-sql.js';
import {randomUUID} from 'node:crypto';
import {AppError,requirePermission,requireWorkspace,type Principal} from '../../domain/src/index.js';
import type {EnterprisePlanAssign,EnterpriseSeatChange} from '../../contracts/src/enterprise-plans.js';
import {assertPlanWritable,planAssignmentDecision,seatDecision,type PlanAssignmentRow,type PlanSeatRow} from '../../enterprise/src/policy.js';
import {enterprisePlanView,type PlanMemberRow,type PlanEventRow} from '../../enterprise/src/view.js';
import type {NativeCoreRepository} from './runtime-repository.js';
export class NativeEnterprisePlanService{
 constructor(readonly core:NativeCoreRepository){}
 get db(){return this.core.db;}
 parameters(p:Principal){return[p.tenantId,'mock',this.db.config.appEnv];}
 async scope(p:Principal,w:string,write=false){requirePermission(p,write?'operations.manage':'operations.read');requireWorkspace(p,w);await this.core.workspaceLock(p,w,write);if(!(await this.db.query('SELECT 1 FROM workspaces WHERE id=$1 AND tenant_id=$2',[w,p.tenantId])).rowCount)throw new AppError('NOT_FOUND','工作空间不存在或已撤回。',404);if(write)assertPlanWritable('mock',this.db.config.appEnv);const tenant=(await this.db.query<{daily_limit:string}>('SELECT daily_limit FROM dg_native_locked_tenant($1)',[p.tenantId])).rows[0];if(!tenant)throw new AppError('AUTH_REQUIRED','组织已失效。',401);return tenant;}
 async assignment(p:Principal){return(await this.db.query<PlanAssignmentRow>('SELECT * FROM enterprise_plan_assignments WHERE tenant_id=$1 AND environment=$2 AND app_env=$3',this.parameters(p))).rows[0];}
 async seats(p:Principal){return(await this.db.query<PlanSeatRow>('SELECT user_id,workspace_id,revoked_at FROM enterprise_seats WHERE tenant_id=$1 AND environment=$2 AND app_env=$3',this.parameters(p))).rows;}
 async member(p:Principal,w:string,userId:string){return(await this.db.query<PlanMemberRow>(`SELECT m.user_id,u.name,m.role FROM ${effectiveMemberships('mock',this.db.config.appEnv)} m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND m.user_id=$2 AND jsonb_exists(m.workspace_ids::jsonb,$3)`,[p.tenantId,userId,w])).rows[0];}
 async view(p:Principal,w:string){const tenant=await this.scope(p,w),now=await this.db.now();return enterprisePlanView({tenantId:p.tenantId,workspaceId:w,environment:'mock',appEnv:this.db.config.appEnv,now,assignment:await this.assignment(p),seats:await this.seats(p),members:(await this.db.query<PlanMemberRow>(`SELECT m.user_id,u.name,m.role FROM ${effectiveMemberships('mock',this.db.config.appEnv)} m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND jsonb_exists(m.workspace_ids::jsonb,$2) ORDER BY m.user_id LIMIT 201`,[p.tenantId,w])).rows,events:(await this.db.query<PlanEventRow>('SELECT id,action,revision,created_at FROM enterprise_plan_events WHERE tenant_id=$1 AND environment=$2 AND app_env=$3 AND workspace_id=$4 ORDER BY created_at DESC,id DESC LIMIT 20',[...this.parameters(p),w])).rows,legacyLimit:tenant.daily_limit,used:(await this.db.query<{n:string}>('SELECT count(*) n FROM jobs WHERE tenant_id=$1 AND environment=$2 AND created_at>=$3',[p.tenantId,'mock',now.slice(0,10)])).rows[0].n});}
 async event(p:Principal,w:string,subject:string,action:PlanEventRow['action'],revision:number,now:string,requestId:string){const id=randomUUID();await this.db.query('INSERT INTO enterprise_plan_events VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,p.tenantId,w,'mock',this.db.config.appEnv,p.userId,subject,action,revision,now]);await this.core.audit(p,w,'enterprise.'+action,id,requestId);return id;}
 async assign(p:Principal,input:EnterprisePlanAssign,requestId:string){
  await this.scope(p,input.workspaceId,true);const now=await this.db.now(),row=await this.assignment(p),seats=await this.seats(p),actorSeat=seats.find(seat=>seat.user_id===p.userId&&!seat.revoked_at),decision=planAssignmentDecision(row,input,seats.filter(seat=>!seat.revoked_at).length,!!actorSeat,now);
  await this.db.query('INSERT INTO enterprise_plan_assignments VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(tenant_id,environment,app_env) DO UPDATE SET plan_id=excluded.plan_id,revision=excluded.revision,expires_at=excluded.expires_at,updated_at=excluded.updated_at,updated_by=excluded.updated_by',[...this.parameters(p),input.planId,decision.revision,decision.expiresAt,now,p.userId]);
  if(!actorSeat)await this.db.query('INSERT INTO enterprise_seats VALUES($1,$2,$3,$4,$5,$6,NULL) ON CONFLICT(tenant_id,environment,app_env,user_id) DO UPDATE SET workspace_id=excluded.workspace_id,created_at=excluded.created_at,revoked_at=NULL',[...this.parameters(p),p.userId,input.workspaceId,now]);
  return this.event(p,input.workspaceId,input.planId,'plan.assign',decision.revision,now,requestId);
 }
 async seat(p:Principal,input:EnterpriseSeatChange,requestId:string){
  await this.scope(p,input.workspaceId,true);const row=await this.assignment(p),seats=await this.seats(p),seat=seats.find(seat=>seat.user_id===input.userId),member=await this.member(p,input.workspaceId,input.userId),now=await this.db.now();
  if(!member&&seat?.workspace_id!==input.workspaceId)throw new AppError('ENTERPRISE_MEMBER_UNAVAILABLE','该成员不在当前工作空间。',404);
  const revision=seatDecision(row,input,seats.filter(seat=>!seat.revoked_at).length,seat,!!member&&['admin','editor'].includes(member.role),now);
  if(input.action==='assign')await this.db.query('INSERT INTO enterprise_seats VALUES($1,$2,$3,$4,$5,$6,NULL) ON CONFLICT(tenant_id,environment,app_env,user_id) DO UPDATE SET workspace_id=excluded.workspace_id,created_at=excluded.created_at,revoked_at=NULL',[...this.parameters(p),input.userId,input.workspaceId,now]);
  else await this.db.query('UPDATE enterprise_seats SET revoked_at=$1 WHERE tenant_id=$2 AND environment=$3 AND app_env=$4 AND user_id=$5',[now,...this.parameters(p),input.userId]);
  await this.db.query('UPDATE enterprise_plan_assignments SET revision=$1,updated_at=$2,updated_by=$3 WHERE tenant_id=$4 AND environment=$5 AND app_env=$6',[revision,now,p.userId,...this.parameters(p)]);
  return this.event(p,input.workspaceId,input.userId,input.action==='assign'?'seat.assign':'seat.release',revision,now,requestId);
 }
}
