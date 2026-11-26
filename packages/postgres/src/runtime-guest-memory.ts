import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {AppError,canonical} from '../../domain/src/index.js';
import type {MemoryView,RecoveryDescriptor,RecoveryIssue} from '../../contracts/src/index.js';
import {nativeBusinessInteger,type NativeCoreRepository} from './runtime-repository.js';
import type {NativeReceptionMeta} from './runtime-reception.js';
const receptionHash=(value:string)=>createHash('sha256').update(value).digest('hex');

export interface NativeMemoryContext {personId:string;version:number;facts:{id:string;key:string;value:string;version:number}[]}
const errors:Record<string,{status:number;message:string}>={AUTH_REQUIRED:{status:401,message:'本次接待访问已失效，请由工作人员重新打开终端。'},FORBIDDEN:{status:403,message:'当前访客凭证没有此项权限，请刷新或联系工作人员。'},NOT_FOUND:{status:404,message:'本次本人资料不存在、已到期或已删除，请重新核对。'},STATE_CONFLICT:{status:409,message:'当前会话已有资料或服务对象已变化，请由前台结束后重新开始，不能覆盖他人的资料。'},VERSION_CONFLICT:{status:409,message:'资料或当前服务对象已经变化，请刷新核对；转人工或换人后需要开启新会话再恢复本人资料。'},DATA_REMOVED:{status:409,message:'旧操作涉及的资料、偏好或凭证已经变更或删除，请重新载入。'},INVALID_SOURCE:{status:409,message:'只能引用当前服务对象仍在保留期内的文字或已确认目标发言，不能使用旧目标、系统回复或归属不明音频。'},INVALID_EXPIRY:{status:400,message:'记忆有效期必须晚于现在且不超过本人授权期限。'},VALIDATION_FAILED:{status:400,message:'输入或确认信息无效，请核对后重试。'},QUOTA_EXCEEDED:{status:409,message:'本人记忆、复核记录或恢复凭证已达到容量上限，请清理后再试。'},RATE_LIMITED:{status:429,message:'本次操作过于频繁，请稍后再试或联系工作人员。'},RESTORE_UNAVAILABLE:{status:409,message:'恢复凭证无效、已过期、已使用，或原会话尚未结束。请核对凭证或联系工作人员。'}};
export class NativeGuestMemory {
 readonly db;
 constructor(readonly core:NativeCoreRepository){this.db=core.db;}
 async call<T>(fn:string,args:unknown[]=[]):Promise<T>{try{return(await this.db.query<{value:T}>('SELECT '+fn+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') AS value',args)).rows[0].value;}catch(e){const message=e instanceof Error?e.message:'',match=/^(?:DGPEOPLE|DGRECEPTION|DGDINING):([A-Z_]+)$/.exec(message),code=match?.[1]??'',known=errors[code];if(known)throw new AppError(code,known.message,known.status);throw e;}}
 async sweep(greet=false){return nativeBusinessInteger(await this.call<unknown>('dg_native_guest_memory_sweep',[greet]));}
 view(id:string,tokenHash:string){return this.call<MemoryView>('dg_native_guest_memory_view',[id,tokenHash]);}
 context(id:string,tokenHash:string){return this.call<NativeMemoryContext|null>('dg_native_guest_memory_context',[id,tokenHash]);}
 search(id:string,tokenHash:string,query:string){return this.call<{personId:string;items:{id:string;key:string;value:string}[]}>('dg_native_guest_memory_search',[id,tokenHash,query]);}
 export(id:string,tokenHash:string){return this.call<MemoryView&{schemaVersion:number;exportedAt:string;transcript:unknown[];exclusions:string[]}>('dg_native_guest_memory_export',[id,tokenHash]);}
 code(secret:string,runtimeId:string,meta:NativeReceptionMeta,personId:string,credentialId:string){return'DG1.'+credentialId+'.'+createHmac('sha256',secret).update(canonical(['native-guest-memory-v1',runtimeId,meta.tenantId,meta.workspaceId,this.db.config.appEnv,personId,credentialId])).digest('base64url');}
 async apply(meta:NativeReceptionMeta,proof:{tokenHash:string;csrfHash:string},action:string,input:Record<string,unknown>,secret:string,runtimeId:string){
  if(input.focusVersion!==meta.focusVersion||meta.status!=='active')throw new AppError('VERSION_CONFLICT',errors.VERSION_CONFLICT.message,409);
  if(input.workspaceId!==undefined&&input.workspaceId!==meta.workspaceId)throw new AppError('NOT_FOUND',errors.NOT_FOUND.message,404);
  const{focusVersion:_,workspaceId:__,...body}=input;void _;void __;
  if(action==='recovery'){const view=await this.view(meta.id,proof.tokenHash);if(!view.person)throw new AppError('NOT_FOUND',errors.NOT_FOUND.message,404);const credentialId=randomUUID();body.credentialId=credentialId;body.tokenHash=receptionHash(this.code(secret,runtimeId,meta,view.person.id,credentialId));}
  if(action==='restore'){const code=String(body.recoveryCode),credentialId=code.split('.')[1],descriptor=await this.call<RecoveryDescriptor>('dg_native_guest_memory_recovery_meta',[meta.id,proof.tokenHash,credentialId,receptionHash(code)]),expected=this.code(secret,runtimeId,meta,descriptor.personId,credentialId);if(code.length!==expected.length||!timingSafeEqual(Buffer.from(code),Buffer.from(expected)))throw new AppError('RESTORE_UNAVAILABLE',errors.RESTORE_UNAVAILABLE.message,409);delete body.recoveryCode;body.credentialId=credentialId;body.codeHash=receptionHash(code);}
  return this.call<string>('dg_native_guest_memory_apply',[meta.id,proof.tokenHash,proof.csrfHash,meta.focusVersion,action,body]);
 }
 attempt(meta:NativeReceptionMeta,proof:{tokenHash:string;csrfHash:string},key:string,input:Record<string,unknown>){if(input.focusVersion!==meta.focusVersion||meta.status!=='active')throw new AppError('VERSION_CONFLICT',errors.VERSION_CONFLICT.message,409);return this.call<void>('dg_native_guest_memory_attempt',[meta.id,proof.tokenHash,proof.csrfHash,meta.focusVersion,receptionHash(key),receptionHash(canonical(input))]);}
 result<T=MemoryView>(receipt:string,tokenHash:string){return this.call<T>('dg_native_guest_memory_result',[receipt,tokenHash]);}
 reveal(meta:NativeReceptionMeta,descriptor:RecoveryDescriptor,secret:string,runtimeId:string):RecoveryIssue{return{...descriptor,recoveryCode:this.code(secret,runtimeId,meta,descriptor.personId,descriptor.credentialId)};}
}
