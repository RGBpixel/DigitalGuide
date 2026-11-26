import {AppError} from '../../domain/src/index.js';
import {enterprisePlanCatalog,type EnterprisePlanAssign,type EnterpriseSeatChange} from '../../contracts/src/enterprise-plans.js';

export interface PlanAssignmentRow{tenant_id:string;environment:string;app_env:string;plan_id:string;revision:number|string;expires_at:string;updated_at:string;updated_by:string}
export interface PlanSeatRow{user_id:string;workspace_id:string;revoked_at:string|null}
export function planInteger(value:unknown){const n=typeof value==='number'?value:typeof value==='string'&&/^\d+$/.test(value)?Number(value):NaN;if(!Number.isSafeInteger(n)||n<0)throw new AppError('ENTERPRISE_STATE_INVALID','套餐数据超出有效范围，请联系管理员核对。',503);return n;}
export function currentPlan(row:PlanAssignmentRow|undefined){if(!row)return undefined;const plan=enterprisePlanCatalog.find(plan=>plan.id===row.plan_id);if(!plan||!Number.isFinite(Date.parse(row.expires_at)))throw new AppError('ENTERPRISE_STATE_INVALID','套餐记录无效，请联系管理员核对。',503);return plan;}
export function planRevision(row:PlanAssignmentRow|undefined){return row?planInteger(row.revision):0;}
export function assertPlanRevision(row:PlanAssignmentRow|undefined,expected:number){if(planRevision(row)!==expected)throw new AppError('ENTERPRISE_VERSION_CONFLICT','套餐或席位已被其他人更新，请刷新后核对再操作。',409);if(expected>=1_000_000_000)throw new AppError('ENTERPRISE_STATE_INVALID','套餐版本已到上限，请联系管理员。',503);}
export function assertPlanWritable(environment:string,appEnv:string){if(environment!=='mock'||!['development','sandbox'].includes(appEnv))throw new AppError('ENTERPRISE_LIVE_UNAVAILABLE','当前只开放沙箱套餐管理；正式订阅与计费尚未接入，请联系管理员。',503);}
export function planAssignmentDecision(row:PlanAssignmentRow|undefined,input:EnterprisePlanAssign,allocated:number,actorAllocated:boolean,now:string){
 assertPlanRevision(row,input.expectedRevision);const plan=enterprisePlanCatalog.find(plan=>plan.id===input.planId)!;
 if(allocated+(actorAllocated?0:1)>plan.seatLimit)throw new AppError('ENTERPRISE_SEAT_LIMIT','新套餐容纳不下现有席位和当前管理员，请先释放不用的席位。',409);
 return{plan,revision:input.expectedRevision+1,expiresAt:new Date(Date.parse(now)+input.termDays*86_400_000).toISOString()};
}
export function seatDecision(row:PlanAssignmentRow|undefined,input:EnterpriseSeatChange,allocated:number,seat:PlanSeatRow|undefined,eligible:boolean,now:string){
 assertPlanRevision(row,input.expectedRevision);const plan=currentPlan(row);if(!row||!plan)throw new AppError('ENTERPRISE_PLAN_REQUIRED','请先分配沙箱套餐，再管理席位。',409);
 if(input.action==='assign'){
  if(row.expires_at<=now)throw new AppError('ENTERPRISE_PLAN_EXPIRED','套餐已到期，请先重新分配沙箱套餐。',409);
  if(!eligible)throw new AppError('ENTERPRISE_MEMBER_UNAVAILABLE','该成员不在当前工作空间或没有核心任务制作权限。',404);
  if(seat&&!seat.revoked_at)throw new AppError('ENTERPRISE_SEAT_UNCHANGED','该成员已分配席位，请刷新查看当前状态。',409);
  if(allocated>=plan.seatLimit)throw new AppError('ENTERPRISE_SEAT_LIMIT','套餐席位已用完，请释放不用的席位或选择其他沙箱套餐。',409);
 }else if(!seat||seat.revoked_at)throw new AppError('ENTERPRISE_SEAT_UNCHANGED','该成员当前没有席位，请刷新查看当前状态。',409);
 return input.expectedRevision+1;
}
export function assertCorePlanAdmission(row:PlanAssignmentRow|undefined,seat:PlanSeatRow|undefined,kind:string,now:string,legacyLimit:number,used:number){
 const plan=currentPlan(row);if(!row||!plan)return;
 if(row.expires_at<=now)throw new AppError('ENTERPRISE_PLAN_EXPIRED','沙箱套餐已到期，不能提交新的核心任务；请联系管理员续期。',409);
 if(!seat||seat.revoked_at)throw new AppError('ENTERPRISE_SEAT_REQUIRED','当前账号未分配制作席位，请联系管理员。',403);
 if(kind==='training.avatar'&&!plan.avatarTraining||kind==='training.voice'&&!plan.voiceTraining)throw new AppError('ENTERPRISE_ENTITLEMENT_REQUIRED','当前沙箱套餐未包含此训练权益，请联系管理员。',403);
 if(used>=Math.min(plan.dailyCoreTaskLimit,legacyLimit))throw new AppError('QUOTA_EXCEEDED','今日核心任务额度已用完，请联系管理员或明日再试。',409);
}
