import {AppError} from '../../domain/src/index.js';
import {proactiveViewSchema,type ProactiveSettingsInput} from '../../contracts/src/index.js';
import type {NativeCoreRepository} from './runtime-repository.js';
const errors:Record<string,[number,string]>={NOT_FOUND:[404,'请从本店当前顾客终端管理本次主动问候。'],VERSION_CONFLICT:[409,'当前接待、发问人或就餐选择已变化，请载入后重新确认。'],DATA_REMOVED:[409,'原问候授权已经变更或失效，请重新核对当前设置。'],VALIDATION_FAILED:[400,'请核对主动问候用途、同意、静默时段和冷却设置。'],MEMORY_UNAVAILABLE:[409,'公开称呼需要本人另行授权并确认的本店资料；可关闭公开称呼后使用普通问候。'],SETTINGS_LIMIT:[429,'本次问候设置变更过于频繁，请联系店员或重新开始接待。'],FORBIDDEN:[403,'主动问候只能由受控任务进程按本人的有效设置触发。']};
export class NativeProactive {
 constructor(readonly core:NativeCoreRepository){}
 async call<T>(name:string,args:unknown[]):Promise<T>{try{return(await this.core.db.query<{value:T}>('SELECT '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') value',args)).rows[0].value;}catch(error){const match=/^DGPROACTIVE:([A-Z_]+)$/.exec(error instanceof Error?error.message:''),known=match&&errors[match[1]];if(known)throw new AppError(match![1],known[1],known[0]);throw error;}}
 async view(id:string,tokenHash:string){return proactiveViewSchema.parse(await this.call<unknown>('dg_native_proactive_view',[id,tokenHash]));}
 apply(id:string,tokenHash:string,csrfHash:string,input:ProactiveSettingsInput){return this.call<string>('dg_native_proactive_apply',[id,tokenHash,csrfHash,input]);}
 async result(receipt:string,id:string,tokenHash:string){return proactiveViewSchema.parse(await this.call<unknown>('dg_native_proactive_result',[receipt,id,tokenHash]));}
}
