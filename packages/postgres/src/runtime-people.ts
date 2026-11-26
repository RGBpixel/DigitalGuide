import type {z} from 'zod';
import {AppError,type Principal} from '../../domain/src/index.js';
import type {MemoryView,PrivacyReceipt,personEnrollInput,personSettingsInput,memoryProposeInput,memoryDecisionInput,memoryNoteInput,memoryNoteControlInput} from '../../contracts/src/index.js';
import {nativeBusinessInteger,NativeCoreRepository} from './runtime-repository.js';

const errors:Record<string,{status:number;message:string}>={NOT_FOUND:{status:404,message:'资料不存在、已到期或不属于本人，请重新载入当前工作空间。'},STATE_CONFLICT:{status:409,message:'资料或条目状态已经变化，请重新核对后操作。'},VERSION_CONFLICT:{status:409,message:'资料版本已经变化，请刷新并核对当前版本。'},INVALID_SOURCE:{status:409,message:'当前账号资料只接受本人填写的声明，不能引用未绑定的接待会话或字幕。'},INVALID_EXPIRY:{status:400,message:'记忆有效期必须晚于现在且不超过本人授权期限。'},VALIDATION_FAILED:{status:400,message:'资料格式或确认信息无效，请核对输入。'},QUOTA_EXCEEDED:{status:409,message:'本资料的记忆或摘要待办已达到100项上限，请清理后再试。'},DATA_REMOVED:{status:409,message:'旧操作涉及的资料已变更或删除，请重新加载当前状态。'},FORBIDDEN:{status:403,message:'当前登录账号没有此项资料访问权限。'}};
export class NativePeople {
 readonly db;
 constructor(readonly core:NativeCoreRepository){this.db=core.db;}
 async call<T>(fn:string,args:unknown[]=[]):Promise<T>{try{return(await this.db.query<{value:T}>('SELECT '+fn+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') AS value',args)).rows[0].value;}catch(e){const message=e instanceof Error?e.message:'',code=message.startsWith('DGPEOPLE:')?message.slice(9):'',known=errors[code];if(known)throw new AppError(code,known.message,known.status);throw e;}}
 async scope(p:Principal,workspace:string,write=false){await this.core.workspaceLock(p,workspace,write);}
 async sweep(){return nativeBusinessInteger(await this.call<unknown>('dg_native_people_sweep'));}
 async self(p:Principal,workspace:string){await this.scope(p,workspace);return this.call<MemoryView>('dg_native_people_self',[workspace]);}
 async view(p:Principal,id:string){const workspace=await this.call<string>('dg_native_people_scope',[id]);await this.scope(p,workspace);return this.call<MemoryView>('dg_native_people_view',[id]);}
 async enroll(p:Principal,workspace:string,input:z.infer<typeof personEnrollInput>){await this.scope(p,workspace,true);if(input.focusVersion!==undefined)throw new AppError('INVALID_SOURCE',errors.INVALID_SOURCE.message,409);return this.call<string>('dg_native_people_enroll',[workspace,{displayName:input.displayName,roles:input.roles,consent:input.consent,noticeVersion:input.noticeVersion,retentionDays:input.retentionDays}]);}
 async apply(id:string,action:'settings'|'propose'|'decide'|'note'|'note_control'|'greet'|'erase',input:unknown){return this.call<string>('dg_native_people_apply',[id,action,input]);}
 settings(id:string,input:z.infer<typeof personSettingsInput>){if(input.focusVersion!==undefined)throw new AppError('INVALID_SOURCE',errors.INVALID_SOURCE.message,409);const{focusVersion:_,...body}=input;void _;return this.apply(id,'settings',body);}
 propose(id:string,input:z.infer<typeof memoryProposeInput>){if(input.sourceMessageId||input.focusVersion!==undefined)throw new AppError('INVALID_SOURCE',errors.INVALID_SOURCE.message,409);return this.apply(id,'propose',{key:input.key,value:input.value,visibility:input.visibility,expiresAt:input.expiresAt});}
 decide(id:string,input:z.infer<typeof memoryDecisionInput>){if(input.focusVersion!==undefined)throw new AppError('INVALID_SOURCE',errors.INVALID_SOURCE.message,409);const{focusVersion:_,...body}=input;void _;return this.apply(id,'decide',body);}
 note(id:string,input:z.infer<typeof memoryNoteInput>){if(input.sourceMessageIds.length||input.focusVersion!==undefined)throw new AppError('INVALID_SOURCE',errors.INVALID_SOURCE.message,409);return this.apply(id,'note',{kind:input.kind,text:input.text,reviewed:input.reviewed,sourceMessageIds:[]});}
 noteControl(id:string,input:z.infer<typeof memoryNoteControlInput>){if(input.focusVersion!==undefined)throw new AppError('INVALID_SOURCE',errors.INVALID_SOURCE.message,409);const{focusVersion:_,...body}=input;void _;return this.apply(id,'note_control',body);}
 async search(id:string,query:string){return{personId:id,items:await this.call<{id:string;key:string;value:string}[]>('dg_native_people_search',[id,query])};}
 export(id:string){return this.call<MemoryView&{schemaVersion:number;exportedAt:string;transcript:unknown[];exclusions:string[]}>('dg_native_people_export',[id]);}
 greeting(id:string){return this.call<{personId:string;allowed:boolean;reason:string|null;text:string|null}>('dg_native_people_greeting',[id]);}
 receipt(id:string){return this.call<PrivacyReceipt>('dg_native_people_receipt',[id]);}
 async directory(p:Principal,workspaces:string[],cursor:string,limit:number){for(const w of workspaces)await this.scope(p,w);return this.call<{id:string;displayName:string;workspaceId:string;roles:string[];identity:string;expiresAt:string}[]>('dg_native_people_directory',[workspaces,cursor,limit]);}
}
