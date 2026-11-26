import {identitySessionQuery,assertIdentitySession} from '../../enterprise/src/identity-session.js';
import type {AeHost} from '../../providers/src/ae-catalog.js';
import {assertCorePlanAdmission,type PlanAssignmentRow,type PlanSeatRow} from '../../enterprise/src/policy.js';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {AppError,assertUsableAsset,requirePermission,requireWorkspace,canonical,type Principal} from '../../domain/src/index.js';
import {jobInput,type JobInput,type Job} from '../../contracts/src/index.js';
import {NativePostgresDatabase} from './runtime-database.js';
import {NativeAssetRepository} from './runtime-assets.js';

const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export const nativeBusinessInteger=(s:unknown)=>{const n=Number(s);if(!Number.isSafeInteger(n))throw new AppError('PG_INTEGER_RANGE','业务整数超出可安全处理的范围，请联系管理员。',503);return n;};
const integer=nativeBusinessInteger;
export interface NativeSession {principal:Principal;csrfToken:string}
export interface NativeLease {id:string;tenant_id:string;workspace_id:string;actor_id:string;kind:string;payload:string;attempts:number;max_attempts:number;lease_token:string;lease_until:string}
export interface NativeFailure {code:string;message:string;retryable:boolean;unknown:boolean}
export class NativeCoreRepository {
 readonly assets:NativeAssetRepository;
 identityFingerprints:ReadonlyMap<string,string>=new Map();
 aeCatalogHost?:AeHost;
 speakerUiPreview=false;
 visionUiPreview=false;
 diningUiPreview=false;
 foodUiPreview=false;
 orderUiPreview=false;
 hospitalityUiPreview=false;
 aftercareUiPreview=false;
 constructor(public readonly db:NativePostgresDatabase){this.assets=new NativeAssetRepository(this);}
 async workspaceLock(p:Principal,workspaceId:string,write=false){requireWorkspace(p,workspaceId);await this.db.advisoryLock(canonical(['native-asset-workspace',p.tenantId,workspaceId]),write);}
 async principal(userId:string):Promise<Principal>{
  const r=(await this.db.query<{tenant_id:string;role:Principal['role'];workspace_ids:string}>('SELECT tenant_id,role,workspace_ids FROM dg_native_locked_membership($1)',[userId])).rows[0];
  if(!r||!['admin','editor','reviewer','viewer'].includes(r.role))throw new AppError('AUTH_REQUIRED','登录或成员权限已失效，请重新登录。',401);
  let ids:unknown;try{ids=JSON.parse(r.workspace_ids);}catch{throw new AppError('FORBIDDEN','成员空间配置无效，请联系管理员。',403);}
  if(!Array.isArray(ids)||ids.length>1000||ids.some(x=>typeof x!=='string')||new Set(ids).size!==ids.length)throw new AppError('FORBIDDEN','成员空间配置无效，请联系管理员。',403);
  const workspaces=(await this.db.query<{id:string}>('SELECT id FROM workspaces WHERE tenant_id=$1 AND id=ANY($2::text[])',[r.tenant_id,ids])).rows;
  if(workspaces.length!==ids.length)throw new AppError('FORBIDDEN','成员空间不属于当前组织，请联系管理员核对。',403);
  return{userId,tenantId:r.tenant_id,role:r.role,workspaceIds:ids,environment:'mock',appEnv:this.db.config.appEnv};
 }
 async login(accountId:string){return this.db.transaction(async()=>{
  if(!(await this.principal(accountId)).workspaceIds.length)throw new AppError('AUTH_REQUIRED','该成员尚未分配工作空间，请联系管理员。',401);const token=randomBytes(40).toString('hex'),csrf=randomBytes(32).toString('hex'),now=await this.db.now();await this.db.query('DELETE FROM auth_sessions WHERE expires_at<=$1',[now]);await this.db.query('INSERT INTO auth_sessions VALUES ($1,$2,$3,$4,$5,$6)',[hash(token),accountId,csrf,new Date(Date.parse(now)+8*3600_000).toISOString(),'mock',this.db.config.appEnv]);return{token};
 });}
 async authenticate(tokenHash:string,exclusiveSession=false):Promise<NativeSession>{
  const r=(await this.db.query<{user_id:string;csrf_token:string}>('SELECT user_id,csrf_token FROM auth_sessions WHERE token_hash=$1 AND expires_at>dg_utc_now() AND environment=$2 AND app_env=$3 FOR '+(exclusiveSession?'UPDATE':'SHARE'),[tokenHash,'mock',this.db.config.appEnv])).rows[0];if(!r)throw new AppError('AUTH_REQUIRED','请先登录当前工作空间。',401);const principal=await this.principal(r.user_id),origin=(await this.db.query(identitySessionQuery.replace('?', '$1'),[tokenHash])).rows[0];assertIdentitySession(origin,{...principal,environment:'mock',appEnv:this.db.config.appEnv},this.identityFingerprints);return{principal,csrfToken:r.csrf_token};
 }
 async audit(p:Principal,workspace:string,action:string,resource:string,requestId:string){await this.db.query('INSERT INTO audit_events VALUES ($1,$2,$3,$4,$5,$6,$7,$8,dg_utc_now())',[randomUUID(),p.tenantId,workspace,p.userId,action,resource,'confirmed',requestId]);}
 async event(tenant:string,workspace:string,resource:string,type:string){await this.db.query("INSERT INTO outbox_events VALUES ($1,$2,$3,$4,$5,'mock','{}',dg_utc_now(),NULL)",[randomUUID(),tenant,workspace,resource,type]);}
 async job(p:Principal,id:string,lock=false):Promise<Job>{
  const r=(await this.db.query('SELECT * FROM jobs WHERE id=$1 AND tenant_id=$2 AND environment=$3'+(lock?' FOR UPDATE':''),[id,p.tenantId,'mock'])).rows[0];if(!r)throw new AppError('NOT_FOUND','任务不存在或无权访问。',404);requireWorkspace(p,String(r.workspace_id));return{id:String(r.id),workspaceId:String(r.workspace_id),kind:String(r.kind),status:r.status as Job['status'],attempts:integer(r.attempts),maxAttempts:integer(r.max_attempts),errorCode:r.error_code as string|null,errorMessage:r.error_message as string|null,result:r.result?JSON.parse(String(r.result)):null,environment:String(r.environment),createdAt:String(r.created_at),updatedAt:String(r.updated_at)};
 }
 async idempotentJob(p:Principal,input:{action:string;key:string;body:unknown;code:number},work:()=>Promise<string>){
  await this.db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[canonical([p.tenantId,p.userId,input.action,input.key])]);const h=hash(canonical(input.body??{})),old=(await this.db.query('SELECT request_hash,response,status_code,redacted FROM idempotency WHERE tenant_id=$1 AND actor_id=$2 AND action=$3 AND key=$4',[p.tenantId,p.userId,input.action,input.key])).rows[0];let id:string;
  if(old){if(old.request_hash!==h)throw new AppError('IDEMPOTENCY_CONFLICT','同一操作编号的内容发生变化，请使用新的编号。',409);if(integer(old.redacted))throw new AppError('DATA_REMOVED','旧操作内容已删除，请重新加载当前状态。',409);id=JSON.parse(String(old.response)).jobId;}else{id=await work();await this.db.query('INSERT INTO idempotency(tenant_id,actor_id,action,key,request_hash,response,status_code,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,dg_utc_now())',[p.tenantId,p.userId,input.action,input.key,h,JSON.stringify({jobId:id}),input.code]);}
  return{jobId:id,statusUrl:'/api/v1/jobs/'+id,...await this.job(p,id)};
 }
 async idempotentResource(p:Principal,input:{action:string;key:string;body:unknown;code:number},work:()=>Promise<string>){
  await this.db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[canonical([p.tenantId,p.userId,input.action,input.key])]);
  const bodyHash=hash(canonical(input.body)),old=(await this.db.query<{request_hash:string;response:string;redacted:string}>('SELECT request_hash,response,redacted FROM idempotency WHERE tenant_id=$1 AND actor_id=$2 AND action=$3 AND key=$4',[p.tenantId,p.userId,input.action,input.key])).rows[0];
  if(old){if(old.request_hash!==bodyHash)throw new AppError('IDEMPOTENCY_CONFLICT','同一操作编号的内容发生变化，请使用新编号。',409);if(integer(old.redacted))throw new AppError('DATA_REMOVED','旧操作内容已删除，请重新加载。',409);return JSON.parse(old.response).resourceId as string;}
  const resourceId=await work();await this.db.query('INSERT INTO idempotency(tenant_id,actor_id,action,key,request_hash,response,status_code,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,dg_utc_now())',[p.tenantId,p.userId,input.action,input.key,bodyHash,JSON.stringify({resourceId}),input.code]);return resourceId;
 }
 async createJob(p:Principal,input:JobInput,requestId:string){
  requirePermission(p,'job.write');requireWorkspace(p,input.workspaceId);await this.workspaceLock(p,input.workspaceId,true);
  const source=input.kind==='provider.check'?null:await this.assets.trainingSource(p,input);
  const tenant=(await this.db.query<{daily_limit:string}>('SELECT daily_limit FROM dg_native_locked_tenant($1)',[p.tenantId])).rows[0];if(!tenant)throw new AppError('AUTH_REQUIRED','组织已失效，请重新登录。',401);const now=await this.db.now();if(source){assertUsableAsset(source.asset,now);if(source.consent.expires_at<=now)throw new AppError('CONSENT_REQUIRED','等待额度锁期间授权已到期，请重新登记后新建任务。',409);}
  if((await this.db.query('SELECT 1 FROM provider_health WHERE tenant_id=$1 AND provider_id=$2 AND open_until>$3',[p.tenantId,'mock-local',now])).rowCount)throw new AppError('PROVIDER_CIRCUIT_OPEN','提供商连续失败，已暂停新任务，请稍后核对。',409,true);
  const count=(await this.db.query<{n:number}>('SELECT count(*)::int AS n FROM jobs WHERE tenant_id=$1 AND environment=$2 AND created_at>=$3',[p.tenantId,'mock',now.slice(0,10)])).rows[0].n;const plan=(await this.db.query<PlanAssignmentRow>('SELECT * FROM enterprise_plan_assignments WHERE tenant_id=$1 AND environment=$2 AND app_env=$3',[p.tenantId,'mock',this.db.config.appEnv])).rows[0],seat=plan?(await this.db.query<PlanSeatRow>('SELECT user_id,workspace_id,revoked_at FROM enterprise_seats WHERE tenant_id=$1 AND environment=$2 AND app_env=$3 AND user_id=$4',[p.tenantId,'mock',this.db.config.appEnv,p.userId])).rows[0]:undefined;assertCorePlanAdmission(plan,seat,input.kind,now,integer(tenant.daily_limit),count);if(count>=integer(tenant.daily_limit))throw new AppError('QUOTA_EXCEEDED','今日任务额度已用完，请联系管理员或明日再试。',409);
  const id=randomUUID();await this.db.query("INSERT INTO jobs(id,tenant_id,workspace_id,actor_id,kind,payload,environment,status,available_at,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,'mock','queued',$7,$7,$7)",[id,p.tenantId,input.workspaceId,p.userId,input.kind,JSON.stringify(input),now]);
  if(source)await this.db.query('INSERT INTO _dg_native_job_sources VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',[id,source.asset.id,source.asset.version,source.uploadId,source.asset.sha256,source.consent.id,source.consent.expires_at,now]);
  await this.audit(p,input.workspaceId,'job.create',id,requestId);await this.event(p.tenantId,input.workspaceId,id,'job.queued');return id;
 }
 async cancelJob(p:Principal,id:string,requestId:string){requirePermission(p,'job.write');const job=await this.job(p,id,true);if(['succeeded','failed','cancelled','unknown'].includes(job.status))throw new AppError('STATE_CONFLICT','任务已经结束或结果未知，不能再次取消。',409);const status=job.status==='running'||job.status==='cancellation_requested'?'cancellation_requested':'cancelled';await this.db.query('UPDATE jobs SET status=$1,updated_at=dg_utc_now() WHERE id=$2',[status,id]);await this.event(p.tenantId,job.workspaceId,id,'job.'+status);await this.audit(p,job.workspaceId,'job.cancel',id,requestId);return id;}
 async validateLeaseActor(lease:NativeLease,beforeExecution=false){const p=await this.principal(lease.actor_id);if(p.tenantId!==lease.tenant_id||!p.workspaceIds.includes(lease.workspace_id))throw new AppError('FORBIDDEN','任务创建人的组织或空间权限已变化。',403);requirePermission(p,'job.write');const payload=jobInput.parse(JSON.parse(lease.payload));if(lease.kind!==payload.kind||payload.workspaceId!==lease.workspace_id)throw new AppError('JOB_SOURCE_CHANGED','任务类型或作用域不匹配。',409);if(payload.kind!=='provider.check')await this.assets.trainingSource(p,payload,lease.id);if(beforeExecution&&!(await this.db.query("SELECT 1 FROM jobs WHERE id=$1 AND status='running' AND lease_token=$2 AND lease_until>dg_utc_now()",[lease.id,lease.lease_token])).rowCount)throw new AppError('JOB_LEASE_INACTIVE','任务已取消、租约已到期或已被重新领取，当前执行不会启动。',409);return payload;}
 async claim(providerId:string,maxConcurrent:number):Promise<NativeLease|null>{return this.db.transaction(async()=>{
  const now=await this.db.now();const expired=(await this.db.query("SELECT * FROM jobs WHERE environment='mock' AND kind IN ('provider.check','training.avatar','training.voice') AND ((status='cancellation_requested' AND lease_until<=$1) OR (status='running' AND lease_until<=$1 AND attempts>=max_attempts)) ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED",[now])).rows;
  for(const r of expired){const cancelled=r.status==='cancellation_requested',status=cancelled?'cancelled':'failed';await this.db.query('UPDATE jobs SET status=$1,error_code=$2,error_message=$3,lease_token=NULL,lease_until=NULL,updated_at=$4 WHERE id=$5',[status,cancelled?null:'RETRY_EXHAUSTED',cancelled?null:'重试次数已用完，请检查后重新提交。',now,r.id]);await this.event(String(r.tenant_id),String(r.workspace_id),String(r.id),'job.'+status);}
  const skipped:string[]=[];for(let i=0;i<32;i++){
   const r=(await this.db.query("SELECT j.* FROM jobs j WHERE j.environment='mock' AND j.kind IN ('provider.check','training.avatar','training.voice') AND j.tenant_id<>ALL($1::text[]) AND ((j.status IN ('queued','retrying') AND j.available_at<=$2) OR (j.status='running' AND j.lease_until<=$2 AND j.attempts<j.max_attempts)) AND NOT EXISTS(SELECT 1 FROM provider_health h WHERE h.tenant_id=j.tenant_id AND h.provider_id=$3 AND h.open_until>$2) ORDER BY j.created_at,j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED",[skipped,now,providerId])).rows[0];if(!r)return null;
    const tenant=(await this.db.query('SELECT id FROM dg_native_locked_tenant($1)',[r.tenant_id])).rows[0];if(!tenant){skipped.push(String(r.tenant_id));continue;}const leaseNow=await this.db.now(),n=(await this.db.query<{n:number}>("SELECT count(*)::int AS n FROM jobs WHERE tenant_id=$1 AND environment='mock' AND status IN ('running','cancellation_requested') AND lease_until>$2",[r.tenant_id,leaseNow])).rows[0].n;if(n>=maxConcurrent){skipped.push(String(r.tenant_id));continue;}
    const token=randomUUID(),until=new Date(Date.parse(leaseNow)+10000).toISOString();await this.db.query("UPDATE jobs SET status='running',attempts=attempts+1,lease_token=$1,lease_until=$2,updated_at=$3 WHERE id=$4",[token,until,leaseNow,r.id]);return{id:String(r.id),tenant_id:String(r.tenant_id),workspace_id:String(r.workspace_id),actor_id:String(r.actor_id),kind:String(r.kind),payload:String(r.payload),attempts:integer(r.attempts)+1,max_attempts:integer(r.max_attempts),lease_token:token,lease_until:until};
  }return null;
 });}
 async finish(lease:NativeLease,providerId:string,result:unknown,failure?:NativeFailure){return this.db.transaction(async()=>{
  // Match API lock order: current membership before the job, then use fresh DB time after all waits.
  try{await this.validateLeaseActor(lease);}catch(e){if(!failure)failure={code:'JOB_PERMISSION_CHANGED',message:e instanceof AppError?e.message:'执行权限已变化，结果未采用。',retryable:false,unknown:false};}
  const current=(await this.db.query<{status:string;lease_token:string;lease_until:string}>('SELECT status,lease_token,lease_until FROM jobs WHERE id=$1 FOR UPDATE',[lease.id])).rows[0],now=await this.db.now();if(!current||current.lease_token!==lease.lease_token||current.lease_until<=now||!['running','cancellation_requested'].includes(current.status))return false;
  if(current.status==='cancellation_requested'){const changed=await this.db.query("UPDATE jobs SET status='cancelled',lease_token=NULL,lease_until=NULL,updated_at=$1 WHERE id=$2 AND lease_token=$3 AND lease_until>dg_utc_now()",[now,lease.id,lease.lease_token]);if(!changed.rowCount)return false;await this.event(lease.tenant_id,lease.workspace_id,lease.id,'job.cancelled');return true;}
  const status=failure?failure.unknown?'unknown':failure.retryable&&lease.attempts<lease.max_attempts?'retrying':'failed':'succeeded',changed=await this.db.query('UPDATE jobs SET status=$1,result=$2,error_code=$3,error_message=$4,available_at=$5,lease_token=NULL,lease_until=NULL,updated_at=$6 WHERE id=$7 AND lease_token=$8 AND lease_until>dg_utc_now()',[status,failure?null:JSON.stringify(result),failure?.code??null,failure?.message??null,new Date(Date.parse(now)+Math.min(lease.attempts*500,5000)).toISOString(),now,lease.id,lease.lease_token]);if(!changed.rowCount)return false;
  if(failure?.code.startsWith('PROVIDER_')){await this.db.query('INSERT INTO provider_health(tenant_id,provider_id,failures) VALUES ($1,$2,1) ON CONFLICT(tenant_id,provider_id) DO UPDATE SET failures=provider_health.failures+1',[lease.tenant_id,providerId]);await this.db.query('UPDATE provider_health SET open_until=$1 WHERE tenant_id=$2 AND provider_id=$3 AND failures>=3',[new Date(Date.parse(now)+30000).toISOString(),lease.tenant_id,providerId]);}else if(!failure)await this.db.query('DELETE FROM provider_health WHERE tenant_id=$1 AND provider_id=$2',[lease.tenant_id,providerId]);
  if(status==='succeeded')await this.db.query("INSERT INTO provider_usage(job_id,tenant_id,workspace_id,environment,units,cost_minor,created_at) VALUES ($1,$2,$3,'mock',1,NULL,$4) ON CONFLICT(job_id) DO NOTHING",[lease.id,lease.tenant_id,lease.workspace_id,now]);await this.event(lease.tenant_id,lease.workspace_id,lease.id,'job.'+status);return true;
 });}
 async dispatchOutbox(){return this.db.transaction(async()=>{const events=(await this.db.query<{id:string}>("SELECT id FROM outbox_events WHERE environment='mock' AND type LIKE 'job.%' AND delivered_at IS NULL ORDER BY created_at,id LIMIT 100 FOR UPDATE SKIP LOCKED")).rows;for(const r of events){await this.db.query('INSERT INTO event_deliveries VALUES ($1,dg_utc_now()) ON CONFLICT(event_id) DO NOTHING',[r.id]);await this.db.query('UPDATE outbox_events SET delivered_at=dg_utc_now() WHERE id=$1',[r.id]);}return events.length;});}
}
