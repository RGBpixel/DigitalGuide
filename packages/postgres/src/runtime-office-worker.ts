import {z} from 'zod';
import {AppError} from '../../domain/src/index.js';
import {OfficeDeliveryError,type OfficeDeliveryRequest,type OfficeDeliveryReceipt} from '../../providers/src/office.js';
import type {NativeCoreRepository} from './runtime-repository.js';
import {officeHash,officeNoticeRow,type NativeOfficeNotice} from './runtime-office-state.js';

const requestSchema=z.strictObject({notificationId:z.uuid(),recipientId:z.uuid(),sourceId:z.uuid(),revision:z.int().positive(),kind:z.enum(['relay','invite','reminder','update','cancel','removed']),title:z.string().min(1).max(200),body:z.string().max(2000),scenario:z.enum(['normal','failed','unknown'])});
export interface NativeOfficeLease extends NativeOfficeNotice {recovering:boolean}
export interface NativeOfficeContext {row:NativeOfficeLease;request:OfficeDeliveryRequest|null;requestHash:string}
export interface NativeOfficeAdapter {send(input:OfficeDeliveryRequest,signal:AbortSignal):Promise<OfficeDeliveryReceipt>;lookup(notificationId:string,signal:AbortSignal):Promise<OfficeDeliveryReceipt|null>}

export class NativeOfficeWorker {
 constructor(readonly core:NativeCoreRepository,readonly customAdapter?:NativeOfficeAdapter){}
 get db(){return this.core.db;}
 async claim(){return this.db.transaction(async()=>{const row=(await this.db.query<{value:NativeOfficeLease|null}>('SELECT dg_native_office_claim() AS value')).rows[0].value;return row?{...officeNoticeRow(row),recovering:row.recovering}:null;});}
 async context(lease:NativeOfficeLease):Promise<NativeOfficeContext>{const value=(await this.db.query<{value:{row:NativeOfficeLease;request:unknown;requestHash:string}|null}>('SELECT dg_native_office_context($1,$2) AS value',[lease.id,lease.lease_token])).rows[0].value;if(!value)throw new AppError('OFFICE_DELIVERY_LEASE','通知已取消、失去租约或来源/成员范围已变化，旧投递不能提交。',409);const row={...officeNoticeRow(value.row),recovering:value.row.recovering},request=value.request===null?null:requestSchema.parse(value.request);if(!/^[a-f0-9]{64}$/.test(value.requestHash)||row.id!==lease.id||row.lease_token!==lease.lease_token||request&&(officeHash(request)!==value.requestHash||request.notificationId!==row.id||request.recipientId!==row.recipient_user_id||request.sourceId!==row.source_id||request.revision!==row.source_revision||request.kind!==row.kind||request.scenario!==row.scenario)||row.channel==='mock'&&!request||row.channel==='local'&&request)throw new AppError('OFFICE_DELIVERY_INPUT','固定投递范围或请求摘要不符，旧消息没有提交。',409);return{row,request,requestHash:value.requestHash};}
 adapter(lease:NativeOfficeLease,context:NativeOfficeContext):NativeOfficeAdapter {
  if(this.customAdapter)return this.customAdapter;
  return{
   send:async(input,signal)=>{
    signal.throwIfAborted();if(input.scenario==='failed')throw new OfficeDeliveryError('MOCK_REJECTED',false);if(input.scenario==='unknown')throw new OfficeDeliveryError('CHANNEL_RESULT_UNKNOWN',true);
    await new Promise<void>((resolve,reject)=>{const cancel=()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);reject(new AppError('OFFICE_DELIVERY_INTERRUPTED','模拟投递已停止，原任务保留等待查回执。',409));},timer=setTimeout(()=>{signal.removeEventListener('abort',cancel);resolve();},10);signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();});
    signal.throwIfAborted();return this.db.transaction(async()=>{const value=(await this.db.query<{value:OfficeDeliveryReceipt}>('SELECT dg_native_office_mock_submit($1,$2,$3) AS value',[lease.id,lease.lease_token,context.requestHash])).rows[0].value;if(value?.status!=='submitted_mock'||value.remoteId!=='mock-office:'+lease.id)throw new AppError('OFFICE_DELIVERY_RECEIPT','模拟回执与原通知不一致。',409);return value;});
   },
   lookup:async(id,signal)=>{signal.throwIfAborted();if(id!==lease.id)throw new AppError('OFFICE_DELIVERY_INPUT','不能查询其他通知的回执。',409);return this.db.transaction(async()=>(await this.db.query<{value:OfficeDeliveryReceipt|null}>('SELECT dg_native_office_mock_lookup($1,$2,$3) AS value',[lease.id,lease.lease_token,context.requestHash])).rows[0].value);}
  };
 }
 async finish(lease:NativeOfficeLease,context:NativeOfficeContext,dispatch:'local'|'submitted_mock'|'failed'|'unknown',receipt:OfficeDeliveryReceipt|null,errorCode:string|null,onStaged?:(data:{notificationId:string;dispatch:string})=>Promise<void>){return this.db.transaction(async()=>{await this.context(lease);await this.db.query('SELECT dg_native_office_finish($1,$2,$3,$4,$5,$6)',[lease.id,lease.lease_token,dispatch,receipt?.remoteId??null,errorCode,context.requestHash]);await this.core.event(lease.tenant_id,lease.workspace_id,lease.id,'office.notification_available');await onStaged?.({notificationId:lease.id,dispatch});});}
 async runOne(stopSignal?:AbortSignal,onClaim?:(lease:NativeOfficeLease)=>void,onSubmitted?:(lease:NativeOfficeLease,receipt:OfficeDeliveryReceipt)=>Promise<void>,onStaged?:Parameters<NativeOfficeWorker['finish']>[5]){
  if(stopSignal?.aborted)return false;const lease=await this.claim();if(!lease)return false;onClaim?.(lease);const abort=new AbortController(),stop=()=>abort.abort();stopSignal?.addEventListener('abort',stop,{once:true});if(stopSignal?.aborted)stop();let timer:ReturnType<typeof setInterval>|undefined,pending:Promise<void>|undefined;
  const tick=async()=>{await this.db.transaction(async()=>{if(!(await this.db.query<{ok:boolean}>('SELECT dg_native_office_hold($1,$2) AS ok',[lease.id,lease.lease_token])).rows[0].ok)throw new AppError('OFFICE_DELIVERY_LEASE','办公室投递物理槽位已变化。',409);});await this.db.transaction(async()=>{if(!(await this.db.query<{ok:boolean}>('SELECT dg_native_office_renew($1,$2) AS ok',[lease.id,lease.lease_token])).rows[0].ok)throw new AppError('OFFICE_DELIVERY_LEASE','通知已取消或来源失效，停止原投递。',409);});};
  try{
   const context=await this.db.transaction(()=>this.context(lease));timer=setInterval(()=>{if(pending)return;pending=tick().catch(()=>abort.abort()).finally(()=>{pending=undefined;});},500);let receipt:OfficeDeliveryReceipt|null=null,dispatch:'local'|'submitted_mock'|'failed'|'unknown'='local',errorCode:string|null=null;
   if(context.row.channel==='mock'){
    const adapter=this.adapter(lease,context);try{if(context.row.recovering){receipt=await adapter.lookup(lease.id,abort.signal);if(!receipt){dispatch='unknown';errorCode='CHANNEL_RESULT_UNKNOWN';}}else receipt=await adapter.send(context.request!,abort.signal);if(receipt){dispatch='submitted_mock';await onSubmitted?.(lease,receipt);}}
    catch(e){if(abort.signal.aborted||stopSignal?.aborted)throw e;const known=e instanceof OfficeDeliveryError||e instanceof AppError;errorCode=known?e.code:'CHANNEL_RESULT_UNKNOWN';dispatch=e instanceof OfficeDeliveryError&&!e.unknown||e instanceof AppError?'failed':'unknown';if(dispatch==='unknown'){receipt=await adapter.lookup(lease.id,abort.signal);if(receipt){dispatch='submitted_mock';errorCode=null;}}}
   }
   if(timer)clearInterval(timer);timer=undefined;await pending;abort.signal.throwIfAborted();await this.finish(lease,context,dispatch,receipt,errorCode,onStaged);
  }catch(e){if(timer)clearInterval(timer);timer=undefined;await pending;await this.db.transaction(async()=>{await this.db.query('SELECT dg_native_office_fail($1,$2,$3,$4)',[lease.id,lease.lease_token,e instanceof AppError?e.code:'OFFICE_DELIVERY_UNKNOWN',stopSignal?.aborted??false]);});}
  finally{if(timer)clearInterval(timer);await pending;stopSignal?.removeEventListener('abort',stop);await this.db.transaction(()=>this.db.query('SELECT dg_native_office_release($1,$2)',[lease.id,lease.lease_token]));}return true;
 }
}
