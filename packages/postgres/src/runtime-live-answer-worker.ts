import fs from 'node:fs/promises';
import path from 'node:path';
import {AppError} from '../../domain/src/index.js';
import {liveAnswerHash} from '../../domain/src/live-answers.js';
import {runLiveAnswer} from '../../providers/src/run-live-answer.js';
import {assertNoLinks} from '../../recovery/src/files.js';
import {NativeLiveAnswers} from './runtime-live-answers.js';
import {nativeLiveAnswerJobRow,type NativeLiveAnswerJobRow} from './runtime-live-answer-sources.js';
import type {LiveAnswerNativeResult} from '../../contracts/src/index.js';
import type {NativeCoreRepository} from './runtime-repository.js';

export class NativeLiveAnswerWorker{
 readonly service:NativeLiveAnswers;
 constructor(readonly core:NativeCoreRepository,readonly root=process.cwd(),readonly engine=runLiveAnswer){this.service=new NativeLiveAnswers(core,root);}
 get db(){return this.core.db;}
 async claim(){return this.db.transaction(async()=>{const row=(await this.db.query<{value:NativeLiveAnswerJobRow|null}>('SELECT dg_native_live_answer_claim() AS value')).rows[0].value;return row?nativeLiveAnswerJobRow(row):null;});}
 async complete(lease:NativeLiveAnswerJobRow,value:LiveAnswerNativeResult,onStaged?:(data:{jobId:string;native:LiveAnswerNativeResult})=>Promise<void>){return this.db.transaction(async()=>{
  const context=await this.service.workerContext(lease),native=this.service.answers.validate(context.row,value),result=JSON.stringify(native.result),evidence=JSON.stringify(native.evidence);await this.db.query('SELECT dg_native_commit_live_answer($1,$2,$3,$4,$5,$6)',[lease.id,lease.lease_token,lease.input_hash,result,evidence,liveAnswerHash(native.result)]);await this.core.event(lease.tenant_id,lease.workspace_id,lease.id,'live.model_answer.ready');await onStaged?.({jobId:lease.id,native});await this.service.workerContext(lease,true);
 });}
 async runOne(stopSignal:AbortSignal=new AbortController().signal,onClaim?:(row:NativeLiveAnswerJobRow)=>void,onStaged?:Parameters<NativeLiveAnswerWorker['complete']>[2]){
  if(stopSignal.aborted)return false;
  try{await this.db.transaction(()=>this.service.autoDraft());}catch(e){if(!(e instanceof AppError)||![403,404,409,429].includes(e.status))throw e;}
  const lease=await this.claim();if(!lease)return false;onClaim?.(lease);
  const abort=new AbortController(),signal=AbortSignal.any([abort.signal,stopSignal]),workRoot=path.resolve(this.db.config.dataDir,'live-answer-work'),directory=path.join(workRoot,lease.id+'-'+lease.lease_token);let timer:ReturnType<typeof setInterval>|undefined,pending:Promise<void>|undefined,progress=0;
  const tick=async()=>{
   const held=await this.db.transaction(async()=>(await this.db.query<{held:boolean}>('SELECT dg_native_live_answer_hold($1,$2) AS held',[lease.id,lease.lease_token])).rows[0].held);if(!held)throw new AppError('LIVE_ANSWER_LEASE','原本机模型资源租约已经变化。',409);
   await this.db.transaction(async()=>{await this.service.workerContext(lease);if(!(await this.db.query<{ok:boolean}>('SELECT dg_native_live_answer_renew($1,$2,$3) AS ok',[lease.id,lease.lease_token,Math.min(.96,progress)])).rows[0].ok)throw new AppError('LIVE_ANSWER_LEASE','原任务已失去当前场控或租约。',409);});
  };
  try{
   const context=await this.db.transaction(()=>this.service.workerContext(lease));await fs.mkdir(directory,{recursive:true,mode:0o700});assertNoLinks(directory);
   timer=setInterval(()=>{pending??=tick().catch(()=>abort.abort()).finally(()=>{pending=undefined;});},500);
   const native=await this.engine({root:this.root,directory,request:context.request,engine:context.configuration.engine},signal,value=>{if(Number.isFinite(value)&&value>=0&&value<=1)progress=Math.max(progress,value*.95);});
   clearInterval(timer);timer=undefined;await pending;signal.throwIfAborted();await this.complete(lease,native,onStaged);
  }catch(e){
   if(timer)clearInterval(timer);timer=undefined;await pending;
   await this.db.transaction(async()=>{let stale=false;try{await this.service.workerContext(lease);}catch(error){if(!(error instanceof AppError))throw error;stale=true;}const interrupted=stopSignal.aborted,code=stale?'LIVE_ANSWER_STALE':interrupted?'LIVE_ANSWER_INTERRUPTED':e instanceof AppError?e.code:'LIVE_ANSWER_FAILED',message=stale?'问题、公开来源、权限或人工场控已变化，迟到答复没有保存。':interrupted?'服务停止，保留同一任务等待有界恢复。':e instanceof AppError?e.message:'实际本机模型没有完成，请检查固定运行时或转人工；没有使用模拟模型成功。';await this.db.query('SELECT dg_native_live_answer_fail($1,$2,$3,$4,$5,$6)',[lease.id,lease.lease_token,code,message,interrupted,stale]);});
  }finally{
   if(timer)clearInterval(timer);await pending;await this.db.transaction(async()=>{await this.db.query('SELECT dg_native_live_answer_release($1,$2)',[lease.id,lease.lease_token]);});
   if(path.dirname(directory)===workRoot){assertNoLinks(directory,true);await fs.rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:150});}
  }return true;
 }
}
