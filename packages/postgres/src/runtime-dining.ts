import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {AppError,canonical,type Principal} from '../../domain/src/index.js';
import {diningPartySchema,guestDiningSchema,type DiningParty,type DiningHoldPlan,type GuestDining} from '../../contracts/src/index.js';
import {nativeBusinessInteger,type NativeCoreRepository} from './runtime-repository.js';
export type NativeDiningKind='restaurant'|'party'|'reservation'|'plan'|'hold';
export interface NativeDiningProof {id:string;tokenHash:string;csrfHash?:string;focusVersion?:number}
export interface NativeDiningContext {restaurantId:string;workspaceId:string;tenantId:string;partyId:string|null;actorType:'staff'|'guest';actorId:string;sessionId:string|null;accessId:string|null;focusVersion:number|null;selectionVersion:number|null}
interface PrivateClaim {nonce:string;sha256:string;expiresAt:string}
type RawParty=DiningParty&{_claim:PrivateClaim|null};
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const errors:Record<string,[number,string]>={AUTH_REQUIRED:[401,'本次接待凭证已失效，请由店员重新打开当前终端。'],NOT_FOUND:[404,'就餐记录、桌位或安排不存在，或不属于当前顾客与门店。'],FORBIDDEN:[403,'当前顾客或门店职责不能进行此操作，请联系店员。'],VERSION_CONFLICT:[409,'当前顾客、就餐组或安排版本已变化，请刷新并重新核对。'],AUTHORIZATION_CHANGED:[409,'原操作的人员、授权或就餐问答对象已变化，请重新核对。'],VALIDATION_FAILED:[400,'就餐输入无效，请核对人数、时段、版本和确认信息。'],PARTY_LIMIT:[409,'当前未结束的就餐记录较多，请先整理已有安排或联系店员。'],NOT_ACCEPTING_GUESTS:[409,'门店暂不接受新预约或排队，请联系店员。'],RESTAURANT_CLOSED:[409,'所选时段不在门店营业窗口内，请调整时间或联系店员。'],INVALID_DINING_INTERVAL:[409,'请选择大于0且不超过4小时的时段。'],INVALID_BOOKING_TIME:[409,'预约须在未来366天内，结束时间须晚于当前一分钟。'],NO_RESERVATION_TABLE:[409,'此时段没有满足人数的无冲突桌位，请调整时间或联系店员。'],BOOKING_CAPACITY:[409,'当前人数与预约桌位不符，请先协调调桌。'],BOOKING_LOCKED:[409,'只有尚未签到的有效预约可改期，请联系店员处理当前安排。'],CHECK_IN_WINDOW:[409,'当前不在原预约的签到窗口内，请核对时间或联系店员。'],PARTY_ALREADY_ASSIGNED:[409,'本组已预留或入座，不能直接改变人数，请联系店员。'],PARTY_NOT_WAITING:[409,'请先签到或排队；已预留或入座的顾客不能再占另一桌。'],DINING_SLOT_ENDING:[409,'当前预约时段即将结束，请联系店员协调。'],NO_TABLE_AVAILABLE:[409,'当前没有满足人数和预约条件的可用桌位，请继续等候或联系店员。'],TABLE_PLAN_CHANGED:[409,'桌位、人数、会话或预约已变化，请重新查看桌位方案。'],TABLE_CHANGED:[409,'桌位或预约条件已变化，请联系店员重新安排。'],HOLD_EXPIRED:[409,'原预留已结束，请重新取得桌位，不会覆盖其他顾客占用。'],PARTY_ENDED:[409,'本组已结束或预约失效，请联系店员。'],PARTY_SEATED:[409,'本组已入座，请由店员核对订单与桌位后结束。'],FINANCIAL_PENDING:[409,'本组已有订单，须接通并核对订单与账单后再结束就餐。'],INVALID_DINING_CLAIM:[404,'就餐凭证无效、已使用或已过期，请核对最新凭证或联系店员。'],CLAIM_RATE_LIMITED:[429,'本次接待核对次数较多，请稍后再试或联系店员。'],RATE_LIMITED:[429,'桌位方案请求过于频繁，请稍后再试。'],CURSOR_CHANGED:[409,'列表已变化，请从第一页重新载入。'],IDEMPOTENCY_CONFLICT:[409,'同一操作编号的内容已变化，请重新核对后发起新操作。'],SOURCE_UNAVAILABLE:[409,'本次接待来源已不可用，请联系店员重新开始。']};
export class NativeDining {
 constructor(readonly core:NativeCoreRepository,readonly secret:string){}
 get db(){return this.core.db;}
 async call<T>(name:string,args:unknown[]=[]):Promise<T>{try{return(await this.db.query<{value:T}>('SELECT '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') value',args)).rows[0].value;}catch(error){const match=/^(?:DGDINING:|DGRESTAURANT:|DGRECEPTION:|DGPEOPLE:)([A-Z_]+)$/.exec(error instanceof Error?error.message:''),known=match&&errors[match[1]];if(match&&known)throw new AppError(match[1],known[1],known[0]);throw error;}}
 proofArgs(proof?:NativeDiningProof,write=false){return[proof?.id??null,proof?.tokenHash??null,write?proof?.csrfHash??null:null,proof?.focusVersion??null];}
 async context(kind:NativeDiningKind,id:string,proof?:NativeDiningProof,write=false){return this.call<NativeDiningContext>('dg_native_dining_context',[kind,id,...this.proofArgs(proof,write),write]);}
 async prepare(p:Principal,kind:NativeDiningKind,id:string,write=false){const meta=await this.context(kind,id,undefined,write);await this.core.workspaceLock(p,meta.workspaceId,write);return meta;}
 code(restaurantId:string,partyId:string,nonce:string,accessVersion:number){return'ND1.'+partyId+'.'+createHmac('sha256',this.secret).update(canonical(['native-dining-claim-v1',this.db.config.runtimeId,this.db.config.appEnv,restaurantId,partyId,nonce,accessVersion])).digest('base64url');}
 ticket(restaurantId:string,partyId:string,accessVersion:number){const nonce=randomUUID();return{partyId,nonce,sha256:hash(this.code(restaurantId,partyId,nonce,accessVersion))};}
 present(raw:RawParty):DiningParty{const{_claim,...party}=raw;let code:string|null=null;if(_claim){code=this.code(party.restaurantId,party.id,_claim.nonce,party.accessVersion);if(hash(code)!==_claim.sha256)throw new AppError('CREDENTIAL_UNAVAILABLE','当前就餐凭证校验失败，请联系店员核对；本次安排未返回其他凭证。',409);}return diningPartySchema.parse({...party,claimCode:code});}
 async party(id:string,proof?:NativeDiningProof){return this.present(await this.call<RawParty>('dg_native_dining_party_view',[id,proof?.id??null,proof?.tokenHash??null]));}
 async list(id:string,kind:string,cursor:string,limit:number){return(await this.call<RawParty[]>('dg_native_dining_parties',[id,kind,cursor,limit])).map(p=>this.present(p));}
 async guest(id:string,tokenHash:string){const value=await this.call<Omit<GuestDining,'parties'>&{parties:RawParty[]}>('dg_native_dining_guest_view',[id,tokenHash]);return guestDiningSchema.parse({...value,parties:value.parties.map(p=>this.present(p))});}
 async apply(kind:NativeDiningKind,id:string,action:string,input:Record<string,unknown>,proof?:NativeDiningProof){
  const meta=await this.context(kind,id,proof,true);let body={...input};
  if(action==='create'||action==='reserve')body._ticket=this.ticket(meta.restaurantId,randomUUID(),1);
  if(action==='seat'||action==='reschedule'){if(!meta.partyId)throw new AppError('NOT_FOUND',errors.NOT_FOUND[1],404);const p=await this.party(meta.partyId,proof);body._ticket=this.ticket(meta.restaurantId,p.id,p.accessVersion+1);}
  if(action==='claim'){
   if(!proof?.csrfHash||proof.focusVersion===undefined)throw new AppError('FORBIDDEN',errors.FORBIDDEN[1],403);const code=String(body.code??''),match=/^ND1\.([a-f0-9-]{36})\.[A-Za-z0-9_-]{43}$/.exec(code);if(!match)throw new AppError('INVALID_DINING_CLAIM',errors.INVALID_DINING_CLAIM[1],404);
   const descriptor=await this.call<{partyId:string;restaurantId:string;version:number;accessVersion:number;nonce:string;sha256:string}>('dg_native_dining_claim_descriptor',[proof.id,proof.tokenHash,proof.csrfHash,proof.focusVersion,match[1],hash(code)]),expected=this.code(descriptor.restaurantId,descriptor.partyId,descriptor.nonce,descriptor.accessVersion);if(Buffer.byteLength(code)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(code),Buffer.from(expected)))throw new AppError('INVALID_DINING_CLAIM',errors.INVALID_DINING_CLAIM[1],404);
   body={partyId:descriptor.partyId,version:descriptor.version,codeHash:hash(code),_ticket:this.ticket(descriptor.restaurantId,descriptor.partyId,descriptor.accessVersion+1),focusVersion:body.focusVersion,selectionVersion:body.selectionVersion,confirmed:body.confirmed};
  }
  return this.call<string>('dg_native_dining_apply',[kind,id,action,body,...this.proofArgs(proof,true)]);
 }
 async result(id:string,proof?:NativeDiningProof){const value=await this.call<RawParty|DiningHoldPlan>('dg_native_dining_action_result',[id,proof?.id??null,proof?.tokenHash??null]);return'_claim'in value?this.present(value):value;}
 claimAttempt(proof:NativeDiningProof,key:string,input:unknown){return this.call<void>('dg_native_dining_claim_attempt',[proof.id,proof.tokenHash,proof.csrfHash,proof.focusVersion,hash(key),hash(canonical(input))]);}
 async sweep(id?:string){return nativeBusinessInteger(await this.call<unknown>('dg_native_dining_sweep',[id??null]));}
}
