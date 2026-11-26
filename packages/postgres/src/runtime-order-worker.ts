import {z} from 'zod';
import {AppError,canonical} from '../../domain/src/index.js';
import {createHash} from 'node:crypto';
import {posMutationSchema,posReceiptSchema,posScenario,type POSMutation,type POSReceipt,type POSScenario} from '../../contracts/src/index.js';
import {NativeOrders} from './runtime-orders.js';
import type {NativeCoreRepository} from './runtime-repository.js';
const leaseSchema=z.strictObject({changeId:z.uuid(),leaseToken:z.uuid(),expiresAt:z.string(),mode:z.enum(['submit','lookup']),requestHash:z.string().regex(/^[a-f0-9]{64}$/)});
const contextSchema=leaseSchema.extend({request:posMutationSchema,scenario:posScenario,sourceExpiresAt:z.string()});
export type NativeOrderLease=z.infer<typeof leaseSchema>;
export interface NativePOSAdapter {submit(request:POSMutation,scenario:POSScenario,signal:AbortSignal):Promise<POSReceipt>;lookup(requestId:string,signal:AbortSignal):Promise<POSReceipt|null>}
export class NativeOrderWorker {
 readonly orders:NativeOrders;
 constructor(readonly core:NativeCoreRepository,secret:string,readonly adapter?:NativePOSAdapter){this.orders=new NativeOrders(core,secret);}
 get db(){return this.core.db;}
 async claim(){const raw=await this.db.transaction(()=>this.orders.call<unknown>('dg_native_order_worker_claim'));return raw===null?null:leaseSchema.parse(raw);}
 async context(lease:NativeOrderLease,send=false){const value=contextSchema.parse(await this.db.transaction(()=>this.orders.call<unknown>('dg_native_order_worker_context',[lease.changeId,lease.leaseToken,send])));if(value.changeId!==lease.changeId||value.leaseToken!==lease.leaseToken||value.mode!==lease.mode||value.expiresAt!==lease.expiresAt||value.request.requestId!==lease.changeId||value.requestHash!==lease.requestHash||createHash('sha256').update(canonical(value.request)).digest('hex')!==lease.requestHash)throw new AppError('ORDER_WORKER_INPUT','固定派单请求、摘要或租约不匹配，不能发送。',409);return value;}
 complete(lease:NativeOrderLease,receipt:POSReceipt|null){return this.db.transaction(()=>this.orders.call<{duplicate:boolean;applied:boolean;conflict:boolean}>('dg_native_order_worker_complete',[lease.changeId,lease.leaseToken,receipt]));}
 async runOne(stopSignal?:AbortSignal){
  if(stopSignal?.aborted)return false;const lease=await this.claim();if(!lease)return false;
  const abort=new AbortController(),stop=()=>abort.abort(),deadline=Math.min(5000,Math.max(1,Date.parse(lease.expiresAt)-Date.now()-250)),timer=setTimeout(stop,deadline);stopSignal?.addEventListener('abort',stop,{once:true});if(stopSignal?.aborted)stop();let removeAbort:()=>void=()=>{};
  try{
   const context=await this.context(lease,true);abort.signal.throwIfAborted();
   const work=(async():Promise<POSReceipt|null>=>{if(this.adapter){const raw=lease.mode==='submit'?await this.adapter.submit(context.request,context.scenario,abort.signal):await this.adapter.lookup(lease.changeId,abort.signal);return raw===null?null:posReceiptSchema.parse(raw);}const value=await this.db.transaction(()=>this.orders.call<{receipt:unknown;errorCode:string|null}>('dg_native_order_mock_io',[lease.changeId,lease.leaseToken]));return value.errorCode||value.receipt===null?null:posReceiptSchema.parse(value.receipt);})();
   const cancelled=new Promise<never>((_,reject)=>{const fail=()=>reject(new AppError('ORDER_WORKER_TIMEOUT','原请求结果尚未核实，将保留库存并查询原请求。',409));abort.signal.addEventListener('abort',fail,{once:true});removeAbort=()=>abort.signal.removeEventListener('abort',fail);if(abort.signal.aborted)fail();});
   const receipt=await Promise.race([work,cancelled]);abort.signal.throwIfAborted();await this.complete(lease,receipt);
  }catch(error){
   if(!(error instanceof AppError&&error.code==='ORDER_WORKER_LEASE')){try{await this.complete(lease,null);}catch(failure){if(!(failure instanceof AppError&&failure.code==='ORDER_WORKER_LEASE'))throw failure;}}
  }finally{clearTimeout(timer);removeAbort();stopSignal?.removeEventListener('abort',stop);}return true;
 }
}
