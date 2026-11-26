import {z} from 'zod';
import {AppError} from '../../domain/src/index.js';
import {diningAftercareSchema,aftercareManagementResult,type DiningAftercare} from '../../contracts/src/index.js';
import {NativeHospitality} from './runtime-hospitality.js';
import type {NativeDiningProof} from './runtime-dining.js';
import {aftercareDescriptorSchema,aftercareCredential,aftercareContactDigest,aftercareRateScope,parseAftercareCredential,sealNativeFollowup,type AftercareDescriptor,type AftercareKind} from './aftercare-crypto.js';

const errors:Record<string,[number,string]>={NOT_FOUND:[404,'餐后记录或本人撤回凭证无效，请核对本人保存的当前凭证。'],FORBIDDEN:[403,'评价和回访须由本人分别确认，员工不能代替顾客授权。'],VALIDATION_FAILED:[400,'请核对本次评价、回访目的、当前版本与明确确认。'],DINING_NOT_ENDED:[409,'请在店员核对结束就餐后，自愿选择评价或回访授权。'],FEEDBACK_EMPTY:[409,'请选择评分或填写本次建议，也可以跳过评价。'],VERSION_CONFLICT:[409,'本次评价、授权或就餐安排已变化，请载入当前记录后重新确认。'],AFTERCARE_REMOVED:[409,'本项内容已撤回或清除，请载入当前状态。'],AFTERCARE_EXPIRED:[409,'原授权已到期，请载入已清除的当前状态。'],AUTHORIZATION_CHANGED:[409,'原顾客、发问人、选择或餐后版本已变化，请重新核对。']};
type Management=Record<string,AftercareDescriptor&{tokenHash:string}>;
type RawAftercare=Omit<DiningAftercare,'feedback'|'followup'>&{feedback:DiningAftercare['feedback'];followup:DiningAftercare['followup'];_management?:Management};
export class NativeAftercare extends NativeHospitality{
 override async call<T>(name:string,args:unknown[]=[]):Promise<T>{try{return await super.call<T>(name,args);}catch(error){const match=/^DGAFTERCARE:([A-Z_]+)$/.exec(error instanceof Error?error.message:''),known=match&&errors[match[1]];if(known)throw new AppError(match![1],known[1],known[0]);throw error;}}
 private project(raw:RawAftercare){
  const {_management:management={},...value}=raw;
  for(const kind of ['feedback','followup'] as const){const source=management[kind],record=value[kind];if(!source||!record||record.status!=='active')continue;const{tokenHash,...metadata}=source,descriptor=aftercareDescriptorSchema.parse(metadata),credential=aftercareCredential(this.secret,this.db.config.appEnv,descriptor);if(descriptor.runtimeId!==this.db.config.runtimeId||descriptor.kind!==kind||descriptor.id!==record.id||descriptor.version!==record.version||credential.sha256!==tokenHash)throw new AppError('FOLLOWUP_CONTACT_UNAVAILABLE','本人餐后管理凭证无法按原范围核对，请联系工作人员。',409);if(kind==='feedback')value.feedback={...value.feedback!,managementCode:credential.code};else value.followup={...value.followup!,managementCode:credential.code};}
  return diningAftercareSchema.parse(value);
 }
 aftercareContext(partyId:string,proof?:NativeDiningProof,write=false,selectionVersion?:number){return this.call<{restaurantId:string;workspaceId:string;partyVersion:number;partyAccessVersion:number}>('dg_native_aftercare_context',[partyId,...this.proofArgs(proof,write),write,selectionVersion??null]);}
 async aftercare(partyId:string,proof?:NativeDiningProof){return this.project(await this.call<RawAftercare>('dg_native_aftercare_view',[partyId,proof?.id??null,proof?.tokenHash??null]));}
 async aftercareBoard(restaurantId:string){const rows=await this.call<Array<RawAftercare&{partyName:string}>>('dg_native_aftercare_board',[restaurantId]);return rows.map(({partyName,...raw})=>({...this.project(raw),partyName}));}
 sanitized(kind:AftercareKind,operation:'save'|'revoke',partyId:string,body:Record<string,unknown>){if(kind!=='followup'||operation!=='save')return body;const{contact,...rest}=body;return{...rest,contactDigest:aftercareContactDigest(this.secret,this.db.config.runtimeId,this.db.config.appEnv,partyId,z.string().parse(contact))};}
 async applyAftercare(partyId:string,kind:AftercareKind,operation:'save'|'revoke',body:Record<string,unknown>,proof:NativeDiningProof){
  const input=this.sanitized(kind,operation,partyId,body),descriptor=aftercareDescriptorSchema.parse(await this.call<unknown>('dg_native_aftercare_begin',[partyId,kind,operation,input,...this.proofArgs(proof,true)]));
  if(descriptor.runtimeId!==this.db.config.runtimeId||descriptor.partyId!==partyId||descriptor.kind!==kind)throw new AppError('AUTHORIZATION_CHANGED','餐后准备结果与当前范围不一致。',409);
  const credential=operation==='save'?aftercareCredential(this.secret,this.db.config.appEnv,descriptor):null,sealed=kind==='followup'&&operation==='save'?sealNativeFollowup(this.secret,this.db.config.appEnv,descriptor,z.enum(['phone','email']).parse(body.contactKind),z.string().parse(body.contact)):null;
  return this.call<string>('dg_native_aftercare_commit',[descriptor.actionId,input,sealed?.cipher??null,sealed?.mask??null,credential?.sha256??null,...this.proofArgs(proof,true)]);
 }
 async aftercareResult(actionId:string,proof:NativeDiningProof){return this.project(await this.call<RawAftercare>('dg_native_aftercare_result',[actionId,proof.id,proof.tokenHash]));}
 async manageAftercare(code:string){const value=parseAftercareCredential(code);return aftercareManagementResult.parse(await this.call<unknown>('dg_native_aftercare_manage',[value.kind,value.id,value.tokenHash]));}
 attemptManagement(ip:string){return this.call<boolean>('dg_native_aftercare_attempt',[aftercareRateScope(this.secret,this.db.config.runtimeId,ip)]);}
 sweepAftercare(restaurantId?:string){return this.call<string>('dg_native_aftercare_sweep',[restaurantId??null]);}
}
