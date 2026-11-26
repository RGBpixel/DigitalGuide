import {randomUUID,createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {AppError,canonical} from '../../domain/src/index.js';
import {NativeReception,type NativeReceptionMeta} from './runtime-reception.js';
import {NativeSpeaker} from './runtime-speaker.js';
import type {NativeCoreRepository} from './runtime-repository.js';
export interface NativeHandoffInput {version:number;focusVersion:number;confirmed:true;nextVisitorConfirmed:true}
export interface NativeHandoffDescriptor {id:string;state:'prepared'|'committed';sessionId:string;input:NativeHandoffInput;expiresAt:string;nextSessionId:string|null;grantId:string|null;accessExpiresAt:string|null}
interface Proof {tokenHash:string;csrfHash:string;csrfToken:string}
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
export const nativeHandoffCookieName=(runtime:string)=>'dg_native_handoff_'+runtime.replaceAll('-','');
export const nativeHandoffCookiePath=(sid:string)=>'/api/v1/guest/sessions/'+sid+'/speaker-focus/';
export class NativeSpeakerHandoff {
 readonly reception:NativeReception;readonly speaker:NativeSpeaker;
 constructor(readonly core:NativeCoreRepository,readonly secret:string){this.reception=new NativeReception(core);this.speaker=new NativeSpeaker(core,secret);}
 get db(){return this.core.db;}
 code(sid:string,id:string){return'HT1.'+id+'.'+createHmac('sha256',this.secret).update(canonical(['native-speaker-handoff-v1',this.db.config.runtimeId,this.db.config.appEnv,sid,id])).digest('base64url');}
 credentials(sid:string,cookie:unknown){
  if(typeof cookie!=='string'||!/^HT1\.[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/.test(cookie))throw new AppError('HANDOFF_UNAVAILABLE','交接凭证已失效，请刷新当前接待或联系前台重新打开。',409);
  const id=cookie.split('.')[1],expected=this.code(sid,id);if(Buffer.byteLength(cookie)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(cookie),Buffer.from(expected)))throw new AppError('HANDOFF_UNAVAILABLE','交接凭证已失效，请刷新当前接待或联系前台重新打开。',409);return{id,hash:digest(cookie)};
 }
 async prepare(sid:string,proof:Proof,input:NativeHandoffInput,hint:Record<string,unknown>){const id=randomUUID();return this.speaker.call<string>('dg_native_speaker_handoff_prepare',[sid,proof.tokenHash,proof.csrfHash,id,digest(this.code(sid,id)),input,hint]);}
 descriptor(sid:string,proof:Proof,id:string){return this.speaker.call<NativeHandoffDescriptor>('dg_native_speaker_handoff_descriptor',[sid,proof.tokenHash,id,digest(this.code(sid,id))]);}
 async prelock(sid:string,proof:Proof,intent:{id:string;hash:string}){const meta=await this.speaker.call<NativeReceptionMeta>('dg_native_speaker_handoff_prelock',[sid,proof.tokenHash,proof.csrfHash,intent.id,intent.hash]);await this.reception.validate(meta,true);return meta;}
 nextAccess(d:NativeHandoffDescriptor){
  if(!d.nextSessionId||!d.grantId||!d.accessExpiresAt)throw new AppError('HANDOFF_UNAVAILABLE','交接尚未提交，请在原页面重试。',409);
  const sid=d.nextSessionId,grant=d.grantId,runtime=this.db.config.runtimeId,cookie='RG1.'+grant+'.'+this.reception.token(this.secret,runtime,sid,grant,'access'),csrf=this.reception.token(this.secret,runtime,sid,grant,'csrf');return{sessionId:sid,cookie,csrf,expiresAt:d.accessExpiresAt,terminalUrl:'/terminal/'+sid};
 }
 async apply(sid:string,proof:Proof,intent:{id:string;hash:string},input:NativeHandoffInput){
  const id=await this.speaker.call<string>('dg_native_speaker_handoff_apply',[sid,proof.tokenHash,proof.csrfHash,intent.id,intent.hash,input]),d=await this.descriptor(sid,proof,id),access=this.nextAccess(d);
  await this.speaker.call('dg_native_speaker_handoff_bind',[sid,proof.tokenHash,proof.csrfHash,id,intent.hash,digest(access.cookie),digest(access.csrf)]);return id;
 }
}
