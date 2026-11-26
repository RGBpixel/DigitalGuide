import {AppError,type Principal} from '../../domain/src/index.js';
import {NativeLiveAudience} from './runtime-live-audience.js';
import type {NativeCoreRepository} from './runtime-repository.js';
import type {NativeReviewSeal} from './runtime-team-reviews.js';
import type {NativeLiveSessionRow} from './runtime-live-shapes.js';

import {nativeOutputAttachment} from './runtime-live-output-state.js';

export class NativeLiveWorker {
 readonly service:NativeLiveAudience;
 constructor(public readonly core:NativeCoreRepository,root=process.cwd()){this.service=new NativeLiveAudience(core,root);}
 get db(){return this.core.db;}
 async runOne(){await this.db.transaction(async()=>{await this.db.query('SELECT dg_native_peer_sweep()');await this.db.query('SELECT dg_native_programme_sweep()');});const rows=await this.db.transaction(async()=>(await this.db.query<NativeLiveSessionRow>("SELECT * FROM live_sessions WHERE environment='mock' AND app_env=$1 AND status IN('scheduled','preview','live') ORDER BY created_at,id LIMIT 30",[this.db.config.appEnv])).rows);for(const initial of rows){const seals:NativeReviewSeal[]=[];try{await this.db.transaction(async()=>{
   const p=await this.service.actor(initial);await this.service.scope(p,initial.workspace_id,true,'live.start');let r=await this.service.session(p,initial.id);if(!['scheduled','preview','live'].includes(r.status))return;const snapshot=await this.service.checked(p,r,seals),now=await this.db.now();
   if(r.status==='scheduled'){if(!r.scheduled_at||r.scheduled_at>now)return;await this.service.start(p,r,r.version,r.snapshot_hash,'native-live-worker:start:'+r.id,seals);r=await this.service.session(p,r.id);}
   const state=await this.service.advance(r);if(state.answerId){const q=await this.service.question(p,state.answerId);if(q.status!=='playing'||!q.answer||q.answer!==state.answerText||!['manual','product','knowledge','local_model'].includes(q.answer_kind??''))throw new AppError('LIVE_ANSWER_CHANGED','正在插播的答复与已确认内容不符。',409);await this.service.knowledge.current(q);}
   if(state.stopped)await this.service.finish(p,r,state,'native-live-worker:end:'+r.id);else await this.service.saveClock(r,state);
   await this.db.query("UPDATE live_commands SET status='superseded' WHERE session_id=$1 AND status='pending' AND epoch<>$2",[r.id,state.epoch]);if(!await nativeOutputAttachment(this.service,r.id))await this.db.query("UPDATE live_commands SET status='applied',simulator_applied_at=dg_utc_now() WHERE session_id=$1 AND status='pending' AND epoch=$2",[r.id,state.epoch]);
   if(r.kind==='broadcast_simulation'&&!state.stopped)for(const row of(await this.db.query<{id:string}>('SELECT id FROM live_destinations WHERE session_id=$1',[r.id])).rows){const t=await this.service.target(p,row.id);if(t.status==='connecting'){const d=snapshot.definition.destinations.find(d=>d.id===t.definition_id)!;if(!t.operation_id)throw new AppError('LIVE_OPERATION_MISSING','分发操作编号缺失，停止本场等待核对。',409);const receipt=await this.service.receipt(t,'connect',{targetId:t.id,operationId:t.operation_id,attempt:t.attempts,behavior:d.behavior});await this.service.applyReceipt(t,receipt);await this.core.audit(p,r.workspace_id,'live.target_connected_simulation',t.id,'native-live-worker:target:'+t.operation_id);}else if(t.status==='connected'&&(!t.heartbeat_at||Date.parse(now)-Date.parse(t.heartbeat_at)>=2000))await this.db.query('UPDATE live_destinations SET heartbeat_at=dg_utc_now(),updated_at=dg_utc_now() WHERE id=$1',[t.id]);}
   for(const seal of seals)await seal.unchanged();
  });}catch(error){await this.db.transaction(async()=>{
   const p:Principal={userId:initial.actor_id,tenantId:initial.tenant_id,workspaceIds:[initial.workspace_id],role:'viewer',environment:'mock',appEnv:this.db.config.appEnv};await this.service.scope(p,initial.workspace_id,true);const r=await this.service.session(p,initial.id);if(!['scheduled','preview','live'].includes(r.status))return;const state=await this.service.advance(r);await this.service.finish(p,r,state,'native-live-worker:failed:'+r.id,'failed',error instanceof AppError?error.message:'原生本地场控异常，请核对原记录后新建场次。');
  });}finally{await Promise.allSettled(seals.map(s=>s.close()));}}return rows.length>0;}
}
