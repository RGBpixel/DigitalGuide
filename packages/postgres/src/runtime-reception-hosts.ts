import type {z} from 'zod';
import {AppError,type Principal,requirePermission} from '../../domain/src/index.js';
import type {ReceptionHost,ReceptionHostCandidate,receptionHostCreateInput,receptionHostUpdateInput} from '../../contracts/src/index.js';
import type {NativeCoreRepository} from './runtime-repository.js';

const errors:Record<string,[number,string]>={NOT_FOUND:[404,'受访人配置不存在或不属于当前工作空间。'],FORBIDDEN:[403,'只有本空间管理员可以配置受访人。'],VERSION_CONFLICT:[409,'受访人配置已变化，请刷新后核对。'],VALIDATION_FAILED:[400,'受访人配置无效，请核对称呼、接待账号与版本。'],RECIPIENT_UNAVAILABLE:[409,'接待账号已离开本空间或没有接待权限，请重新选择。'],ALIAS_CONFLICT:[409,'本空间已有启用的同名受访人，请修改称呼或停用原配置。'],QUOTA_EXCEEDED:[429,'本空间受访人配置已达到200条，请联系管理员处理。']};
export class NativeReceptionHosts {
 constructor(readonly core:NativeCoreRepository){}
 async call<T>(fn:string,args:unknown[]):Promise<T>{try{return(await this.core.db.query<{value:T}>('SELECT '+fn+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') AS value',args)).rows[0].value;}catch(error){const message=error instanceof Error?error.message:'',match=/^(?:DGVISITHOST:|DGRECEPTION:)([A-Z_]+)$/.exec(message),known=match&&errors[match[1]];if(match&&known)throw new AppError(match[1],known[1],known[0]);throw error;}}
 async prepare(p:Principal,workspace:string|null,id:string|null,recipient:string){requirePermission(p,'visit.manage');return this.call<string>('dg_native_visit_host_prepare',[workspace,id,recipient]);}
 async view(p:Principal,id:string){requirePermission(p,'visit.manage');return this.call<ReceptionHost>('dg_native_visit_host_view',[id]);}
 async list(p:Principal,workspace:string,cursor:string,limit:number){requirePermission(p,'visit.manage');return this.call<ReceptionHost[]>('dg_native_visit_hosts_list',[workspace,cursor,limit]);}
 async candidates(p:Principal,workspace:string,cursor:string,limit:number){requirePermission(p,'visit.manage');return this.call<ReceptionHostCandidate[]>('dg_native_visit_host_candidates',[workspace,cursor,limit]);}
 async apply(p:Principal,id:string|null,input:z.infer<typeof receptionHostCreateInput>|z.infer<typeof receptionHostUpdateInput>){requirePermission(p,'visit.manage');return this.call<string>('dg_native_visit_host_apply',[id,input]);}
}
