import {createHash} from 'node:crypto';
import {z} from 'zod';
import {AppError,canonical} from '../../domain/src/index.js';
import {financialRequestSchema,financialReceiptSchema,financialScenario,type FinancialRequest,type FinancialReceipt,type FinancialScenario} from '../../contracts/src/index.js';
import {NativeBilling} from './runtime-billing.js';
import type {NativeCoreRepository} from './runtime-repository.js';
const leaseSchema=z.strictObject({operationId:z.uuid(),leaseToken:z.uuid(),mode:z.enum(['send','query','close','simulate']),expiresAt:z.string(),requestHash:z.string().regex(/^[a-f0-9]{64}$/)});
const contextSchema=leaseSchema.extend({request:financialRequestSchema,scenario:financialScenario,sourceExpiresAt:z.string()});
export type NativeFinancialLease=z.infer<typeof leaseSchema>;
export interface NativeFinancialAdapter {
 createCheckout(request:FinancialRequest,scenario:FinancialScenario,signal:AbortSignal):Promise<FinancialReceipt>;
 submitRefund(request:FinancialRequest,scenario:FinancialScenario,signal:AbortSignal):Promise<FinancialReceipt>;
 simulateCheckout(operationId:string,scenario:FinancialScenario,signal:AbortSignal):Promise<FinancialReceipt>;
 closeCheckout(operationId:string,signal:AbortSignal):Promise<FinancialReceipt|null>;
 lookup(operationId:string,signal:AbortSignal):Promise<FinancialReceipt|null>;
}
export class NativeFinancialWorker {
 readonly billing:NativeBilling;
 constructor(readonly core:NativeCoreRepository,secret:string,readonly adapter?:NativeFinancialAdapter){this.billing=new NativeBilling(core,secret);}
 get db(){return this.core.db;}
 async claim(){const raw=await this.db.transaction(()=>this.billing.call<unknown>('dg_native_bill_worker_claim'));return raw===null?null:leaseSchema.parse(raw);}
 async context(lease:NativeFinancialLease,execute=false){const value=contextSchema.parse(await this.db.transaction(()=>this.billing.call<unknown>('dg_native_bill_worker_context',[lease.operationId,lease.leaseToken,execute])));if(value.operationId!==lease.operationId||value.leaseToken!==lease.leaseToken||value.mode!==lease.mode||value.expiresAt!==lease.expiresAt||value.request.operationId!==lease.operationId||value.requestHash!==lease.requestHash||createHash('sha256').update(canonical(value.request)).digest('hex')!==lease.requestHash)throw new AppError('FINANCIAL_WORKER_INPUT','原资金请求、摘要或租约不一致，未执行资金动作。',409);return value;}
 complete(lease:NativeFinancialLease,receipt:FinancialReceipt|null){return this.db.transaction(()=>this.billing.call<{duplicate:boolean;applied:boolean;attention:boolean}>('dg_native_bill_worker_complete',[lease.operationId,lease.leaseToken,receipt]));}
 async runOne(stopSignal?:AbortSignal){
  if(stopSignal?.aborted)return false;const lease=await this.claim();if(!lease)return false;const abort=new AbortController(),stop=()=>abort.abort();let timer=setTimeout(stop,Math.min(5000,Math.max(1,Date.parse(lease.expiresAt)-Date.now()-250)));stopSignal?.addEventListener('abort',stop,{once:true});if(stopSignal?.aborted)stop();let removeAbort:()=>void=()=>{};
  try{
   const context=await this.context(lease,true);if(lease.mode==='send'){clearTimeout(timer);timer=setTimeout(stop,Math.min(5000,Math.max(1,Math.min(Date.parse(lease.expiresAt),Date.parse(context.sourceExpiresAt))-Date.now()-250)));}abort.signal.throwIfAborted();
   const work=(async():Promise<FinancialReceipt|null>=>{if(this.adapter){const raw=lease.mode==='send'?context.request.kind==='payment'?await this.adapter.createCheckout(context.request,context.scenario,abort.signal):await this.adapter.submitRefund(context.request,context.scenario,abort.signal):lease.mode==='simulate'?await this.adapter.simulateCheckout(lease.operationId,context.scenario,abort.signal):lease.mode==='close'?await this.adapter.closeCheckout(lease.operationId,abort.signal):await this.adapter.lookup(lease.operationId,abort.signal);return raw===null?null:financialReceiptSchema.parse(raw);}const raw=await this.db.transaction(()=>this.billing.call<{receipt:unknown;errorCode:string|null}>('dg_native_bill_mock_io',[lease.operationId,lease.leaseToken]));return raw.errorCode||raw.receipt===null?null:financialReceiptSchema.parse(raw.receipt);})();
   const cancelled=new Promise<never>((_,reject)=>{const fail=()=>reject(new AppError('FINANCIAL_WORKER_TIMEOUT','资金结果仍待核实，将保留原编号和额度，仅查询原请求。',409));abort.signal.addEventListener('abort',fail,{once:true});removeAbort=()=>abort.signal.removeEventListener('abort',fail);if(abort.signal.aborted)fail();});const receipt=await Promise.race([work,cancelled]);abort.signal.throwIfAborted();await this.complete(lease,receipt);
  }catch(error){if(!(error instanceof AppError&&error.code==='FINANCIAL_WORKER_LEASE'))try{await this.complete(lease,null);}catch(failure){if(!(failure instanceof AppError&&failure.code==='FINANCIAL_WORKER_LEASE'))throw failure;}}
  finally{clearTimeout(timer);removeAbort();stopSignal?.removeEventListener('abort',stop);}return true;
 }
}
