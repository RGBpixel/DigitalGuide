import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Repository } from '@digitalguide/database';
import { AppError,requirePermission,requireWorkspace,type Principal } from '@digitalguide/domain';
import { contentDraftPayload,contentDraftCreateInput,contentDraftSaveInput,contentProjectDraftInput,type ContentDraftPayload,type ContentDraft,type ContentSourceReference,type ContentBrief } from '@digitalguide/contracts';
import { contentWritingProvider,validateContentSections } from '../../../packages/domain/src/content-writing.js';
import { ContentSources } from './content-sources.js';
import { StudioService } from './studio-service.js';
import { checkContentReferences,contentOriginReferences } from './content-dependencies.js';
import type { Config } from './config.js';
export interface ContentDraftRow {id:string;tenant_id:string;workspace_id:string;root_id:string;parent_id:string|null;payload:string;version:number;updated_at:string}
const now=()=>new Date().toISOString();
export class ContentDrafts {
  sources:ContentSources;studio:StudioService;
  constructor(public repo:Repository,public config:Config){this.sources=new ContentSources(repo,config);this.studio=new StudioService(repo,config.providerMode,config.appEnv,config.dataDir);}
  scope(p:Principal,workspaceId:string,write=false){requireWorkspace(p,workspaceId);if(write)requirePermission(p,'studio.write');}
  row(p:Principal,id:string,write=false){const r=this.repo.get<ContentDraftRow>('SELECT * FROM studio_content_drafts WHERE id=? AND tenant_id=? AND environment=? AND app_env=?',id,p.tenantId,this.config.providerMode,this.config.appEnv);if(!r)throw new AppError('NOT_FOUND','脚本草稿不存在或不在当前环境。',404);this.scope(p,r.workspace_id,write);return r;}
  payload(r:ContentDraftRow){return contentDraftPayload.parse(JSON.parse(r.payload));}
  sourceReason(p:Principal,r:ContentDraftRow,payload=this.payload(r)){
    try{
      if(payload.inheritedExpiresAt&&payload.inheritedExpiresAt<=now())throw new AppError('CONTENT_SOURCE_EXPIRED','草稿继承的来源使用期限已到期。',409);
      checkContentReferences(this.repo,p,r.workspace_id,this.config.providerMode,this.config.appEnv,payload.sourceRefs);
      if(payload.originProject){const project=this.studio.project(p,payload.originProject.id);if(project.workspace_id!==r.workspace_id||project.archived)throw new AppError('CONTENT_ORIGIN_UNAVAILABLE','草稿原工程已归档或范围变化。',409);}
      if(payload.brief){const brief=this.sources.brief(p,payload.brief.id);if(brief.workspace_id!==r.workspace_id)throw new AppError('CONTENT_BRIEF_UNAVAILABLE','账号定位不在当前空间。',409);}
      return null;
    }catch(error){if(!(error instanceof AppError))throw error;return error.message;}
  }
  briefChanged(p:Principal,payload:ContentDraftPayload){return !!payload.brief&&this.sources.brief(p,payload.brief.id).version!==payload.brief.version;}
  current(p:Principal,r:ContentDraftRow,strictBrief=false){const payload=this.payload(r),reason=this.sourceReason(p,r,payload);if(reason)throw new AppError('CONTENT_SOURCE_UNAVAILABLE',reason,409);if(strictBrief&&this.briefChanged(p,payload))throw new AppError('CONTENT_BRIEF_CHANGED','账号定位已有新修订；保留草稿文字，核对并采用当前定位后再生成计划。',409);return payload;}
  view(p:Principal,r:ContentDraftRow):ContentDraft{
    this.scope(p,r.workspace_id);const payload=this.payload(r),reason=this.sourceReason(p,r,payload);
    return {id:r.id,workspaceId:r.workspace_id,rootId:r.root_id,parentId:r.parent_id,version:r.version,name:payload.name,payload:reason?null:payload,sourceAvailable:!reason,sourceReason:reason,briefChanged:!reason&&this.briefChanged(p,payload),simulated:payload.provider==='mock-content',updatedAt:r.updated_at};
  }
  brief(p:Principal,workspaceId:string,id:string|null,version:number|null):ContentDraftPayload['brief']{
    if(!id){if(version!==null)throw new AppError('CONTENT_BRIEF_VERSION_INVALID','未选择账号定位时不能指定版本。',422);return null;}
    const r=this.sources.brief(p,id);if(r.workspace_id!==workspaceId)throw new AppError('CONTENT_BRIEF_UNAVAILABLE','定位不在当前工作空间。',409);this.studio.version(r,version||0);
    const b=this.sources.briefView(p,r),{id:_,workspaceId:__,version:___,updatedAt:____,...configuration}=b;void _;void __;void ___;void ____;
    return {id:b.id,version:b.version,configuration};
  }
  async prepare(p:Principal,input:z.infer<typeof contentDraftCreateInput>):Promise<ContentDraftPayload>{
    this.scope(p,input.workspaceId,true);
    if(new Set(input.sources.map(s=>s.id)).size!==input.sources.length)throw new AppError('CONTENT_REFERENCES_INVALID','内容来源重复，请重新选择。',422);
    const sources=input.sources.map(ref=>{const r=this.sources.source(p,ref.id),view=this.sources.view(p,r);if(r.workspace_id!==input.workspaceId||r.version!==ref.version||!view.available)throw new AppError('CONTENT_SOURCE_UNAVAILABLE',view.unavailableReason||'内容来源版本或空间已变化。',409);return view;});
    const brief=this.brief(p,input.workspaceId,input.briefId,input.briefVersion);
    if(brief&&input.topic&&!brief.configuration.topics.includes(input.topic))throw new AppError('CONTENT_TOPIC_CHANGED','选题不属于所选定位版本，请重新选择或更新定位。',409);
    const provider=contentWritingProvider(input.provider,this.config.providerMode==='mock'&&this.config.appEnv!=='production');
    const sections=await provider.generate({texts:sources.map(s=>s.text!),brief:brief?{...brief.configuration,id:brief.id,version:brief.version,workspaceId:input.workspaceId,updatedAt:''} as ContentBrief:null,topic:input.topic,chunkCharacters:input.chunkCharacters});
    return contentDraftPayload.parse({name:input.name,sourceRefs:sources.map(s=>({id:s.id,version:s.version,textSHA256:s.textSHA256})),brief,originProject:null,sections,provider:provider.id,topic:input.topic,instruction:'按来源整理；'+(provider.simulated?'明确模拟写作，需人工审阅。':'本地按段落分块，不做语义改写。')});
  }
  insert(p:Principal,workspaceId:string,payload:ContentDraftPayload,parent?:ContentDraftRow){
    this.preparedCurrent(p,workspaceId,payload);validateContentSections(payload.sections);
    if(this.repo.get<{n:number}>('SELECT count(*) n FROM studio_content_drafts WHERE tenant_id=? AND workspace_id=? AND environment=? AND app_env=?',p.tenantId,workspaceId,this.config.providerMode,this.config.appEnv)!.n>=300)throw new AppError('CONTENT_DRAFT_QUOTA','本地每空间最多300份草稿/变体，请整理后继续。',409);
    if(parent&&parent.workspace_id!==workspaceId)throw new AppError('CONTENT_DRAFT_SCOPE','草稿变体不在相同工作空间。',409);
    const id=randomUUID(),time=now(),json=JSON.stringify(payload);
    this.repo.run('INSERT INTO studio_content_drafts(id,tenant_id,workspace_id,root_id,parent_id,payload,environment,app_env,actor_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',id,p.tenantId,workspaceId,parent?.root_id||id,parent?.id||null,json,this.config.providerMode,this.config.appEnv,p.userId,time,time);
    this.repo.run('INSERT INTO studio_content_draft_versions VALUES (?,1,?,?,?)',id,json,p.userId,time);return id;
  }
  preparedCurrent(p:Principal,workspaceId:string,payload:ContentDraftPayload){
    this.scope(p,workspaceId,true);checkContentReferences(this.repo,p,workspaceId,this.config.providerMode,this.config.appEnv,payload.sourceRefs);
    if(payload.inheritedExpiresAt&&payload.inheritedExpiresAt<=now())throw new AppError('CONTENT_SOURCE_EXPIRED','草稿继承的来源使用期限已到期。',409);
    if(payload.brief)this.brief(p,workspaceId,payload.brief.id,payload.brief.version);
    if(payload.originProject){const project=this.studio.project(p,payload.originProject.id);if(project.archived||project.workspace_id!==workspaceId)throw new AppError('CONTENT_ORIGIN_UNAVAILABLE','草稿原工程已归档或范围变化。',409);}
  }
  projectDraftPayload(p:Principal,id:string,input:z.infer<typeof contentProjectDraftInput>){
    const project=this.studio.project(p,id);this.scope(p,project.workspace_id,true);this.studio.editable(project);this.studio.version(project,input.projectVersion);
    const document=JSON.parse(project.document) as import('@digitalguide/contracts').StudioDocument;
    if(new Set(input.segmentIds).size!==input.segmentIds.length||input.segmentIds.some(id=>!document.segments.some(s=>s.id===id)))throw new AppError('CONTENT_SEGMENT_INVALID','所选分镜重复或已移除。',409);
    const segments=document.segments.filter(s=>input.segmentIds.includes(s.id)),refs=new Map<string,ContentSourceReference>();
    for(const s of segments)if(s.contentOriginId)for(const ref of contentOriginReferences(this.repo,p,project.workspace_id,this.config.providerMode,this.config.appEnv,s.contentOriginId))refs.set(ref.id,ref);
    const dates=segments.map(s=>s.contentExpiresAt).filter((s):s is string=>!!s).sort();
    const payload:ContentDraftPayload={name:input.name,sourceRefs:[...refs.values()],brief:null,originProject:{id:project.id,version:project.version},inheritedExpiresAt:dates[0]||null,sections:segments.map(s=>({id:randomUUID(),title:s.title,text:s.text,durationMs:s.durationMs})),provider:'manual',topic:'',instruction:'从已保存工程选择分镜，保留文字快照；未自动重写。'};
    return {workspaceId:project.workspace_id,payload};
  }
  fromProject(p:Principal,id:string,input:z.infer<typeof contentProjectDraftInput>){const prepared=this.projectDraftPayload(p,id,input);return this.insert(p,prepared.workspaceId,prepared.payload);}
  save(p:Principal,r:ContentDraftRow,input:z.infer<typeof contentDraftSaveInput>){
    this.scope(p,r.workspace_id,true);this.studio.version(r,input.version);const payload=this.current(p,r);
    validateContentSections(input.sections);payload.name=input.name;payload.sections=input.sections;
    if(input.adoptCurrentBrief&&payload.brief){const b=this.sources.brief(p,payload.brief.id);payload.brief=this.brief(p,r.workspace_id,b.id,b.version);}
    return this.commit(p,r,payload);
  }
  commit(p:Principal,r:ContentDraftRow,payload:ContentDraftPayload){
    this.scope(p,r.workspace_id,true);this.current(p,r);validateContentSections(payload.sections);
    const json=JSON.stringify(contentDraftPayload.parse(payload)),time=now();
    this.repo.run('UPDATE studio_content_drafts SET payload=?,version=version+1,updated_at=? WHERE id=?',json,time,r.id);
    this.repo.run('INSERT INTO studio_content_draft_versions VALUES (?,?,?,?,?)',r.id,r.version+1,json,p.userId,time);return r.id;
  }
}
