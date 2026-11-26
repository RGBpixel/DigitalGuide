import {createHash,randomUUID} from 'node:crypto';
import {AppError,canonical,type Principal} from '../../domain/src/index.js';
import {contentDraftPayload,type ContentDraftPayload} from '../../contracts/src/index.js';
import type {NativeCoreRepository} from './runtime-repository.js';
import {NativeContentSources,nativeContentDependency} from './runtime-content-sources.js';

export const nativeContentHash=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
export class NativeContentOrigins {
 readonly sources:NativeContentSources;
 constructor(readonly core:NativeCoreRepository){this.sources=new NativeContentSources(core);}
 async get(p:Principal,workspaceId:string,id:string){return nativeContentDependency('origin:'+id,async()=>{
  await this.sources.scope(p,workspaceId);const r=(await this.core.db.query<{source_refs:string;expires_at:string|null;payload:string;payload_hash:string;draft_id:string;draft_version:string}>("SELECT o.source_refs,o.expires_at,o.draft_id,o.draft_version,n.payload,n.payload_hash FROM studio_content_origins o JOIN _dg_native_content_origins n ON n.origin_id=o.id WHERE o.id=$1 AND o.tenant_id=$2 AND o.workspace_id=$3 AND o.environment='mock' AND o.app_env=$4",[id,p.tenantId,workspaceId,this.core.db.config.appEnv])).rows[0];if(!r)throw new AppError('CONTENT_ORIGIN_UNAVAILABLE','脚本来源凭据不存在或不在当前空间。',409);
  let payload:ContentDraftPayload;try{payload=contentDraftPayload.parse(JSON.parse(r.payload));if(nativeContentHash(payload)!==r.payload_hash||canonical(payload.sourceRefs)!==canonical(JSON.parse(r.source_refs)))throw new Error('hash');}catch{throw new AppError('CONTENT_ORIGIN_CHANGED','固定脚本来源凭据或正文引用不一致，请重新核对。',409);}
  if(r.expires_at&&r.expires_at<=await this.core.db.now())throw new AppError('CONTENT_SOURCE_EXPIRED','脚本继承的来源使用期限已到期。',409);const rows=await this.sources.references(p,workspaceId,payload.sourceRefs),expiresAt=[...(payload.inheritedExpiresAt?[payload.inheritedExpiresAt]:[]),...rows.map(s=>s.expires_at)].sort()[0]??null;if(expiresAt!==r.expires_at)throw new AppError('CONTENT_ORIGIN_CHANGED','脚本固定期限与来源不一致，请重新核对。',409);return{id,refs:payload.sourceRefs,expiresAt,snapshotHash:r.payload_hash};
 });}
 async create(p:Principal,workspaceId:string,draftId:string,draftVersion:number,payload:ContentDraftPayload){await this.sources.scope(p,workspaceId,true);const rows=await this.sources.references(p,workspaceId,payload.sourceRefs),expiresAt=[...(payload.inheritedExpiresAt?[payload.inheritedExpiresAt]:[]),...rows.map(s=>s.expires_at)].sort()[0]??null,id=randomUUID();if(expiresAt&&expiresAt<=await this.core.db.now())throw new AppError('CONTENT_SOURCE_EXPIRED','脚本来源已到期，请重新核对。',409);await this.core.db.query("INSERT INTO studio_content_origins VALUES($1,$2,$3,$4,$5,$6,'mock',$7,dg_utc_now(),$8)",[id,p.tenantId,workspaceId,draftId,draftVersion,JSON.stringify(payload.sourceRefs),this.core.db.config.appEnv,expiresAt]);await this.core.db.query('INSERT INTO _dg_native_content_origins VALUES($1,$2,$3,dg_utc_now())',[id,JSON.stringify(payload),nativeContentHash(payload)]);return{id,expiresAt};}
}
