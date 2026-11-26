import fs from 'node:fs/promises';
import path from 'node:path';
import {AppError} from '../../domain/src/index.js';
import {runLocalEditor} from '../../providers/src/run-local-editor.js';
import {requireLocalEditor} from '../../providers/src/local-editor-model.js';
import {NativeAssistantInterpretations} from './runtime-assistant-interpretations.js';
import {assistantHash,assistantInterpretationRow,type NativeAssistantInterpretation} from './runtime-assistant-state.js';
import type {NativeCoreRepository} from './runtime-repository.js';

export class NativeAssistantWorker {
 readonly service:NativeAssistantInterpretations;
 constructor(readonly core:NativeCoreRepository,readonly root=process.cwd(),readonly engine=runLocalEditor,readonly checkEngine=requireLocalEditor){this.service=new NativeAssistantInterpretations(core,root);}
 get db(){return this.core.db;}
 async claim(){return this.db.transaction(async()=>{const row=(await this.db.query<{value:NativeAssistantInterpretation|null}>('SELECT dg_native_assistant_interpretation_claim() AS value')).rows[0].value;return row?assistantInterpretationRow(row):null;});}
 async complete(lease:NativeAssistantInterpretation,value:unknown,onStaged?:(data:{jobId:string;turnId:string})=>Promise<void>){return this.db.transaction(async()=>{const {row}=await this.service.workerContext(lease),proposal=this.service.validate(row,value),hash=assistantHash({parentTurnId:row.parent_turn_id,provider:'local_llm',instruction:this.service.request(row).instruction,proposal}),turnId=(await this.db.query<{id:string}>('SELECT dg_native_commit_assistant_interpretation($1,$2,$3,$4,$5) AS id',[row.id,row.lease_token,row.input_hash,JSON.stringify(proposal),hash])).rows[0].id;await this.core.event(row.tenant_id,row.workspace_id,row.id,'studio.assistant_interpreted');await onStaged?.({jobId:row.id,turnId});return turnId;});}
 async runOne(stopSignal?:AbortSignal,onClaim?:(lease:NativeAssistantInterpretation)=>void,onStaged?:Parameters<NativeAssistantWorker['complete']>[2]){
  if(stopSignal?.aborted)return false;const lease=await this.claim();if(!lease)return false;onClaim?.(lease);const abort=new AbortController(),stop=()=>abort.abort();stopSignal?.addEventListener('abort',stop,{once:true});if(stopSignal?.aborted)stop();let timer:ReturnType<typeof setInterval>|undefined,pending:Promise<void>|undefined,progress=0;
  const tick=async()=>{await this.db.transaction(async()=>{if(!(await this.db.query<{ok:boolean}>('SELECT dg_native_assistant_interpretation_hold($1,$2) AS ok',[lease.id,lease.lease_token])).rows[0].ok)throw new AppError('ASSISTANT_INTERPRETATION_LEASE','本机模型物理槽位已变化。',409);});await this.db.transaction(async()=>{await this.service.workerContext(lease);if(!(await this.db.query<{ok:boolean}>('SELECT dg_native_assistant_interpretation_renew($1,$2,$3) AS ok',[lease.id,lease.lease_token,Math.min(.95,progress*.95)])).rows[0].ok)throw new AppError('ASSISTANT_INTERPRETATION_LEASE','语义任务租约已经变化。',409);});};
  try{const context=await this.db.transaction(()=>this.service.workerContext(lease));await this.checkEngine(this.root,context.engine);timer=setInterval(()=>{if(pending)return;pending=tick().catch(()=>abort.abort()).finally(()=>{pending=undefined;});},500);const directory=path.join(this.db.config.dataDir,'assistant-interpretation-work',lease.id+'-'+lease.lease_token);await fs.mkdir(directory,{recursive:true,mode:0o700});const result=await this.engine({root:this.root,directory,request:context.request,engine:context.engine},abort.signal,n=>{if(Number.isFinite(n)&&n>=0&&n<=1)progress=Math.max(progress,n);});if(timer)clearInterval(timer);timer=undefined;await pending;abort.signal.throwIfAborted();await this.complete(lease,result,onStaged);}
  catch(e){if(timer)clearInterval(timer);timer=undefined;await pending;await this.db.transaction(async()=>{await this.db.query('SELECT dg_native_assistant_interpretation_fail($1,$2,$3,$4,$5)',[lease.id,lease.lease_token,e instanceof AppError?e.code:'ASSISTANT_INTERPRETATION_FAILED',e instanceof AppError?e.message:'本机语义编辑未完成，请核对原任务后重试。',stopSignal?.aborted??false]);});}
  finally{if(timer)clearInterval(timer);await pending;stopSignal?.removeEventListener('abort',stop);await this.db.transaction(()=>this.db.query('SELECT dg_native_assistant_interpretation_release($1,$2)',[lease.id,lease.lease_token]));}return true;
 }
}
