import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import type {SpeakerFocusView,SpeakerReference} from '../../contracts/src/index.js';
import {AppError,canonical} from '../../domain/src/index.js';
import {nativeBusinessInteger,type NativeCoreRepository} from './runtime-repository.js';
import {NativeVisits} from './runtime-visits.js';
import {NativeReception,type NativeReceptionMeta} from './runtime-reception.js';
import type {NativeMemoryContext} from './runtime-guest-memory.js';
import {nativeVisitCanonical,nativeVisitHash} from './runtime-visit-hash.js';

const errors:Record<string,[number,string]>={
 HANDOFF_UNAVAILABLE:[409,'交接已领取、过期或原对象已变化，请使用新会话或联系前台重新打开。'],EVENT_QUOTA_EXCEEDED:[409,'本次专注对话已达到事件上限，请结束后重新开始。'],INVALID_SOURCE:[409,'本次发言来源无法核对，请重新确认当前发问人。'],AUTH_REQUIRED:[401,'本次接待访问已失效，请由前台重新打开。'],FORBIDDEN:[403,'当前凭证或账号无权操作专注对话。'],NOT_FOUND:[404,'当前会话不存在或不属于本工作空间。'],SESSION_ENDED:[410,'本次接待已结束或超时，请联系前台开始新会话。'],
 CAPABILITY_UNAVAILABLE:[409,'此场景或参考方式尚未接通专注对话，请使用文字或联系前台。'],PROVIDER_NOT_CONFIGURED:[409,'目标声音服务尚未配置，请使用文字或人工接待。'],SOURCE_UNAVAILABLE:[409,'原场景或参考来源已不可用，请联系前台重新开始。'],VERSION_CONFLICT:[409,'专注对话或当前服务对象已变化，请刷新后重新核对。'],STATE_CONFLICT:[409,'当前专注对话状态不允许此操作，请刷新或使用文字回退。'],
 FOCUS_NOT_ACTIVE:[409,'本次专注对话尚未开始或已释放，请重新确认服务对象。'],REFERENCE_EXPIRED:[409,'声音参考已到期或撤回，请重新确认本人参考。'],REFERENCE_USE_DENIED:[409,'参考使用码已失效或不属于当前会话，请由本人重新核对授权。'],REFERENCE_QUALITY_INSUFFICIENT:[409,'合成参考质量不足，请选择清晰的单人样例。'],SCOPE_CONFLICT:[409,'参考与本次接待的工作空间或匹配服务不符，请重新选择。'],QUOTA_EXCEEDED:[409,'本人的有效参考已达十份，请先撤回不再使用的参考。'],IDEMPOTENCY_CONFLICT:[409,'同一操作编号的内容发生变化，请使用新编号。'],VALIDATION_FAILED:[400,'请核对本次会话、版本和明确同意信息。'],RATE_LIMITED:[429,'专注对话操作过于频繁，请稍后继续。']
};
interface TicketDescriptor {id:string;referenceId:string;referenceVersion:number;provider:string;tenantId:string;workspaceId:string;ownerId:string;sessionId:string;focusVersion:number;expiresAt:string}
export interface NativeSpeakerUse {id:string;referenceId:string;sessionId:string;expiresAt:string;useCode:string}
export interface NativeSpeakerEventInput {focusVersion:number;segmentId:string;sequence:number;fixture:string;text:string;source:'mock_speaker_event'}
export interface NativeSpeakerEventResult {accepted:boolean;buffered:boolean;interrupted:boolean;reason:string;decisionId:string|null;focusVersion:number;simulated:true}
interface EventDescriptor extends Record<string,unknown> {decisionId:string;sessionId:string;focusVersion:number;source:string;attribution:string;final:boolean;accepted:boolean;textHash:string|null}
interface EventContext {meta:NativeReceptionMeta;descriptor:EventDescriptor;signatureHash:string;memory:NativeMemoryContext|null;visit:{text:string}|null}
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
export class NativeSpeaker {
 readonly visits:NativeVisits;
 constructor(readonly core:NativeCoreRepository,readonly secret:string){this.visits=new NativeVisits(core,secret);}
 get db(){return this.core.db;}
 async call<T>(name:string,args:unknown[]=[]):Promise<T>{try{return(await this.db.query<{value:T}>('SELECT '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') AS value',args)).rows[0].value;}catch(error){const match=/^(?:DGSPEAKER:|DGRECEPTION:|DGPEOPLE:)([A-Z_]+)$/.exec(error instanceof Error?error.message:''),known=match&&errors[match[1]];if(match&&known)throw new AppError(match[1],known[1],known[0]);throw error;}}
 prelock(sid:string,hash:string|null,ticket:string|null=null){return this.call<Record<string,unknown>>('dg_native_speaker_prelock',[sid,hash,ticket]);}
 view(sid:string,hash:string){return this.call<SpeakerFocusView>('dg_native_speaker_view',[sid,hash]);}
 adminView(sid:string){return this.call<SpeakerFocusView>('dg_native_speaker_admin_view',[sid]);}
 async apply(sid:string,hash:string,csrfHash:string,action:string,input:Record<string,unknown>,hint:Record<string,unknown>){
  if(action==='start'&&input.mode==='enrolled'){
   const code=String(input.useCode??''),descriptor=await this.call<TicketDescriptor>('dg_native_speaker_guest_ticket',[sid,hash,csrfHash,input.focusVersion,code.split('.')[1]??'']),expected=this.useCode(descriptor);
   if(Buffer.byteLength(code)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(code),Buffer.from(expected)))throw new AppError('REFERENCE_USE_DENIED',errors.REFERENCE_USE_DENIED[1],409);
  }
  const result=await this.call<{id:string;rebindVisitId:string|null}>('dg_native_speaker_apply',[sid,hash,csrfHash,action,input,hint]);if(result.rebindVisitId)await this.visits.bindConfirmation(sid,hash,result.rebindVisitId);return result.id;
 }
 receipt(sid:string,hash:string,id:string,focus:number){return this.call<SpeakerFocusView>('dg_native_speaker_receipt_view',[sid,hash,id,focus]);}
 referencePrepare(id:string|null,workspaceId:string|null,sessionId:string|null=null){return this.call<Record<string,unknown>>('dg_native_speaker_reference_prepare',[id,workspaceId,sessionId]);}
 referenceList(workspaceId:string){return this.call<SpeakerReference[]>('dg_native_speaker_reference_list',[workspaceId]);}
 referenceView(id:string){return this.call<SpeakerReference>('dg_native_speaker_reference_view',[id]);}
 useCode(descriptor:TicketDescriptor){return'SF1.'+descriptor.id+'.'+createHmac('sha256',this.secret).update(canonical(['native-speaker-use-v1',this.db.config.runtimeId,this.db.config.appEnv,descriptor])).digest('base64url');}
 async referenceApply(id:string|null,action:string,input:Record<string,unknown>,hint:Record<string,unknown>){const value=await this.call<string>('dg_native_speaker_reference_apply',[id,action,input,hint]);if(action==='authorize-use'){const descriptor=await this.call<TicketDescriptor>('dg_native_speaker_ticket_descriptor',[value]);await this.call('dg_native_speaker_ticket_bind',[value,digest(this.useCode(descriptor))]);}return value;}
 async revealUse(id:string):Promise<NativeSpeakerUse>{const d=await this.call<TicketDescriptor>('dg_native_speaker_ticket_descriptor',[id]);return{id:d.id,referenceId:d.referenceId,sessionId:d.sessionId,expiresAt:d.expiresAt,useCode:this.useCode(d)};}
 useAttempt(sid:string,hash:string,csrfHash:string,focus:number,key:string,input:unknown){return this.call<void>('dg_native_speaker_use_attempt',[sid,hash,csrfHash,focus,digest(key),digest(canonical(input))]);}
 eventSignature(descriptor:EventDescriptor){return digest(createHmac('sha256',this.secret).update(nativeVisitCanonical(['native-speaker-event-v1',this.db.config.runtimeId,this.db.config.appEnv,descriptor])).digest('base64url'));}
 async event(sid:string,input:NativeSpeakerEventInput,hint:Record<string,unknown>){
  const normalized={...input,text:input.text.trim()},prepared=await this.call<{id:string;accepted:boolean;descriptor:EventDescriptor|null}>('dg_native_speaker_event_prepare',[sid,normalized,hint]);
  if(prepared.descriptor)await this.call('dg_native_speaker_event_bind',[prepared.descriptor.decisionId,nativeVisitHash(prepared.descriptor),this.eventSignature(prepared.descriptor)]);
  if(prepared.accepted){
   const source=await this.call<EventContext>('dg_native_speaker_event_context',[prepared.descriptor!.decisionId]),d=source.descriptor,expected=this.eventSignature(d);
   if(!/^[a-f0-9]{64}$/.test(source.signatureHash)||!timingSafeEqual(Buffer.from(source.signatureHash),Buffer.from(expected))||nativeVisitCanonical(d)!==nativeVisitCanonical(prepared.descriptor)||d.sessionId!==sid||d.focusVersion!==input.focusVersion||d.source!=='mock_speaker_event'||d.attribution!=='target'||!d.final||!d.accepted||d.textHash!==digest(normalized.text))throw new AppError('INVALID_SOURCE','本次发言来源无法核对，请重新确认当前发问人。',409);
   // Filtering, current authority and the signed text digest are checked before
   // any retrieval/answer composition. Failed/partial text never reaches it.
   const answer=await new NativeReception(this.core).composeReply(source.meta,normalized.text,{visit:async()=>source.visit,memory:async()=>source.memory});
   await this.call('dg_native_speaker_event_finish',[d.decisionId,{text:normalized.text,...answer}]);
   await this.call('dg_native_service_suggest',['audio',d.decisionId]);
  }
  return prepared.id;
 }
 eventReceipt(sid:string,id:string){return this.call<NativeSpeakerEventResult>('dg_native_speaker_event_receipt',[id,sid]);}
 async sweep(){return nativeBusinessInteger(await this.call<unknown>('dg_native_speaker_sweep'));}
}
