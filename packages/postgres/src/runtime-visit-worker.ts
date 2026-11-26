import {setTimeout as pause} from 'node:timers/promises';
import {z} from 'zod';
import {AppError} from '../../domain/src/index.js';
import {nativeVisitHash} from './runtime-visit-hash.js';
import {NotificationFailure,type NotificationRequest,type NotificationReceipt} from '../../providers/src/notifications.js';
import type {NativeCoreRepository} from './runtime-repository.js';
const requestSchema=z.strictObject({deliveryId:z.uuid(),recipientRef:z.uuid(),visitRef:z.uuid(),visitorName:z.string().min(1).max(40),company:z.string().max(80),purpose:z.string().min(1).max(200),scenario:z.enum(['normal','failed','unknown'])});
export interface NativeVisitLease {id:string;visitId:string;tenantId:string;workspaceId:string;channel:'local'|'mock';token:string;leaseUntil:string;attempt:number;recovering:boolean}
export interface NativeVisitDeliveryContext {lease:NativeVisitLease;request:NotificationRequest|null;requestHash:string}
export interface NativeVisitAdapter {send(request:NotificationRequest,signal:AbortSignal):Promise<NotificationReceipt>;lookup(deliveryId:string,requestHash:string,signal:AbortSignal):Promise<NotificationReceipt|null>}
export class NativeVisitWorker {
 constructor(readonly core:NativeCoreRepository,readonly customAdapter?:NativeVisitAdapter){}
 get db(){return this.core.db;}
 async call<T>(fn:string,args:unknown[]=[]):Promise<T>{return(await this.db.query<{value:T}>('SELECT '+fn+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') value',args)).rows[0].value;}
 claim(){return this.db.transaction(()=>this.call<NativeVisitLease|null>('dg_native_visit_delivery_claim'));}
 async context(lease:NativeVisitLease){const value=await this.call<NativeVisitDeliveryContext|null>('dg_native_visit_delivery_context',[lease.id,lease.token]);if(!value)throw new AppError('NOTIFICATION_LEASE_LOST','原投递租约已失效，将核对原回执，不重新发送。',409);const request=value.request===null?null:requestSchema.parse(value.request);if(value.lease.id!==lease.id||value.lease.token!==lease.token||request&&nativeVisitHash(request)!==value.requestHash)throw new AppError('NOTIFICATION_SOURCE_CHANGED','投递来源已变化，不能沿旧内容继续提交。',409);return{...value,request};}
 adapter(lease:NativeVisitLease):NativeVisitAdapter{return this.customAdapter??{
  send:async(request,signal)=>{await pause(100,undefined,{signal});if(request.scenario==='failed')throw new NotificationFailure('MOCK_NOTIFICATION_FAILED',false);if(request.scenario==='unknown')throw new NotificationFailure('MOCK_NOTIFICATION_UNKNOWN',true);return this.db.transaction(()=>this.call<NotificationReceipt>('dg_native_visit_mock_submit',[lease.id,lease.token,nativeVisitHash(request)]));},
  lookup:async(id,hash,signal)=>{signal.throwIfAborted();return this.db.transaction(()=>this.call<NotificationReceipt|null>('dg_native_visit_mock_lookup',[id,lease.token,hash]));}
 };}
 async runOne(stopSignal?:AbortSignal,onClaimed?:(lease:NativeVisitLease)=>void,onSubmitted?:(lease:NativeVisitLease,receipt:NotificationReceipt)=>Promise<void>,onStaged?:(lease:NativeVisitLease)=>Promise<void>){
  const lease=await this.claim();if(!lease)return false;onClaimed?.(lease);
  try{
   const context=await this.db.transaction(()=>this.context(lease)),signal=AbortSignal.any([AbortSignal.timeout(Math.max(1,Math.min(3000,Date.parse(lease.leaseUntil)-Date.now()))),...(stopSignal?[stopSignal]:[])]);
   let status:'submitted'|'failed'|'unknown'='submitted',remoteId:string|null='local-inbox:'+lease.id,errorCode:string|null=null;
   if(lease.channel==='mock'){
    const adapter=this.adapter(lease);let receipt:NotificationReceipt|null=null;
    try{if(lease.recovering)receipt=await adapter.lookup(lease.id,context.requestHash,signal);else{if(!context.request)throw new AppError('NOTIFICATION_SOURCE_CHANGED','原投递已撤回，不继续发送。',409);receipt=await adapter.send(context.request,signal);}if(!receipt){status='unknown';errorCode='NOTIFICATION_RESULT_UNKNOWN';}}
    catch(error){signal.throwIfAborted();status=error instanceof NotificationFailure&&!error.unknown?'failed':'unknown';errorCode=error instanceof NotificationFailure||error instanceof AppError?error.code:'NOTIFICATION_RESULT_UNKNOWN';if(status==='unknown')receipt=await adapter.lookup(lease.id,context.requestHash,signal);if(receipt){status='submitted';errorCode=null;}}
    remoteId=receipt?.remoteId??null;if(receipt)await onSubmitted?.(lease,receipt);
   }
   signal.throwIfAborted();await this.db.transaction(async()=>{await this.call('dg_native_visit_delivery_finish',[lease.id,lease.token,context.requestHash,status,remoteId,errorCode]);await onStaged?.(lease);});
  }catch(error){await this.db.transaction(()=>this.call('dg_native_visit_delivery_fail',[lease.id,lease.token,error instanceof AppError?error.code:'NOTIFICATION_DELIVERY_INTERRUPTED']));}
  finally{await this.db.transaction(()=>this.call('dg_native_visit_delivery_release',[lease.id,lease.token]));}
  return true;
 }
}
