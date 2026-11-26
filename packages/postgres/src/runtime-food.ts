import {AppError} from '../../domain/src/index.js';
import {diningRecommendationSchema,diningMemoryImportSchema,type DiningParty,type DiningRecommendation,type DiningMemoryImport} from '../../contracts/src/index.js';
import {NativeDining,type NativeDiningProof} from './runtime-dining.js';
import {nativeBusinessInteger} from './runtime-repository.js';
import {NativeRestaurant} from './runtime-restaurant.js';

const errors:Record<string,[number,string]>={VALIDATION_FAILED:[400,'本次口味输入无效，请核对成分、辣度、预算和确认信息。'],PARTY_ENDED:[409,'本次就餐已结束，不能再改变本次口味。'],VERSION_CONFLICT:[409,'当前顾客、就餐组或安排已变化，请载入最新记录后重新核对。'],PREFERENCE_CHANGED:[409,'偏好草稿、当前发问人或安排已变化，请重新保存并核对本次内容。'],PREFERENCE_CONFIRMATION_REQUIRED:[409,'请先保存并明确确认当前安排下的本次偏好，再获取推荐。'],MENU_CHANGED:[409,'菜单、价格或库存已更新，请载入当前菜单后重新核对。'],MEMORY_IMPORT_REQUIRED:[409,'请先明确授权读取本人建议，再逐项选择来源并保存本次草稿。'],MEMORY_CONSENT_REQUIRED:[409,'请先自愿登记或恢复本店的本人资料，并开启个性化后再读取建议。'],MEMORY_SOURCE_CHANGED:[409,'本人记忆授权、来源或服务对象已经变化，请重新读取并选择本次建议。'],RATE_LIMITED:[429,'本次偏好或推荐操作较频繁，请稍后再试或联系店员。'],NOT_FOUND:[404,'推荐或本次偏好不在当前顾客与门店范围内。']};
export class NativeFood extends NativeDining {
 override async guest(id:string,tokenHash:string){const value=await super.guest(id,tokenHash);return{...value,restaurant:new NativeRestaurant(this.core).present(value.restaurant)};}
 override async call<T>(name:string,args:unknown[]=[]):Promise<T>{try{return await super.call<T>(name,args);}catch(error){const match=/^DGFOOD:([A-Z_]+)$/.exec(error instanceof Error?error.message:''),known=match&&errors[match[1]];if(match&&known)throw new AppError(match[1],known[1],known[0]);throw error;}}
 applyFood(id:string,action:'draft'|'confirm'|'recommend'|'memory',input:Record<string,unknown>,proof?:NativeDiningProof){return this.call<string>('dg_native_food_apply',[id,action,input,...this.proofArgs(proof,true)]);}
 async foodResult(id:string,proof?:NativeDiningProof):Promise<DiningParty|DiningRecommendation|DiningMemoryImport>{const value=await this.call<Record<string,unknown>>('dg_native_food_result',[id,proof?.id??null,proof?.tokenHash??null]);return'_claim'in value?this.present(value as Parameters<NativeDining['present']>[0]):'facts'in value?diningMemoryImportSchema.parse(value):diningRecommendationSchema.parse(value);}
 async memoryImport(id:string,proof:NativeDiningProof){return diningMemoryImportSchema.parse(await this.call<unknown>('dg_native_food_memory_import_project',[id,proof.id,proof.tokenHash]));}
 async recommendation(id:string,proof?:NativeDiningProof){return diningRecommendationSchema.parse(await this.call<unknown>('dg_native_food_recommendation_view',[id,proof?.id??null,proof?.tokenHash??null]));}
 override async sweep(id?:string){return(await super.sweep(id))+nativeBusinessInteger(await this.call<unknown>('dg_native_food_sweep',[id??null]));}
}
