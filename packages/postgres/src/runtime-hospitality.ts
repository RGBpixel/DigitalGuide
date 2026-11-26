import {AppError} from '../../domain/src/index.js';
import {serviceRequestSchema,type DiningServiceRequest} from '../../contracts/src/index.js';
import {NativeDining,type NativeDiningProof} from './runtime-dining.js';
import type {Principal} from '../../domain/src/index.js';
export type NativeHospitalityKind='restaurant'|'party'|'service';
const errors:Record<string,[number,string]>={NOT_FOUND:[404,'服务请求不在当前顾客或本店职责范围内。'],FORBIDDEN:[403,'顾客只能提出或取消本人请求；接收和完成需由本店员工核对。'],VALIDATION_FAILED:[400,'请核对服务类型、说明、当前就餐版本和明确确认。'],VERSION_CONFLICT:[409,'顾客、就餐安排或服务版本已变化，请载入当前记录后重新核对。'],PARTY_ENDED:[409,'本次就餐已结束，不能再创建或处理餐中请求。'],SERVICE_REQUEST_LIMIT:[409,'本组已有10份待处理请求，请先等待店员处理。'],SERVICE_STATE_CHANGED:[409,'请求已经处理或状态发生变化，请载入当前记录。'],AUTHORIZATION_CHANGED:[409,'原操作的职责、顾客、发问人或就餐选择已变化，请重新核对。']};
export class NativeHospitality extends NativeDining{
 override async call<T>(name:string,args:unknown[]=[]):Promise<T>{try{return await super.call<T>(name,args);}catch(error){const match=/^DGHOSP:([A-Z_]+)$/.exec(error instanceof Error?error.message:''),known=match&&errors[match[1]];if(known)throw new AppError(match![1],known[1],known[0]);throw error;}}
 async hospitalityContext(kind:NativeHospitalityKind,id:string,proof?:NativeDiningProof,write=false,selectionVersion?:number){return this.call<{restaurantId:string;workspaceId:string;tenantId:string;partyId:string|null;partyVersion?:number;partyAccessVersion?:number}>('dg_native_hospitality_context',[kind,id,...this.proofArgs(proof,write),write,selectionVersion??null]);}
 async prepareHospitality(p:Principal,kind:NativeHospitalityKind,id:string,write=false){const meta=await this.hospitalityContext(kind,id,undefined,write);await this.core.workspaceLock(p,meta.workspaceId,write);return meta;}
 async services(kind:'party'|'restaurant',id:string,proof?:NativeDiningProof){return serviceRequestSchema.array().parse(await this.call<unknown>('dg_native_hospitality_read',[kind,id,proof?.id??null,proof?.tokenHash??null]));}
 applyHospitality(kind:'party'|'service',id:string,action:'create'|'acknowledge'|'resolve'|'cancel',input:Record<string,unknown>,proof?:NativeDiningProof){return this.call<string>('dg_native_hospitality_apply',[kind,id,action,input,...this.proofArgs(proof,true)]);}
 confirmSuggestion(proof:NativeDiningProof,input:Record<string,unknown>){return this.call<string>('dg_native_service_confirm',[input.requestId,proof.id,proof.tokenHash,proof.csrfHash,input]);}
 async hospitalityResult(id:string,proof?:NativeDiningProof):Promise<DiningServiceRequest>{return serviceRequestSchema.parse(await this.call<unknown>('dg_native_hospitality_result',[id,proof?.id??null,proof?.tokenHash??null]));}
}
