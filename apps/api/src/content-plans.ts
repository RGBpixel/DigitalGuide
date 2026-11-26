import { createHash,randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { AppError,canonical,type Principal } from '@digitalguide/domain';
import { blankStudioDocument,contentPlanCreateInput,type ContentPlan,type ContentPlanPatch,type contentPlanSaveInput,type StudioDocument } from '@digitalguide/contracts';
import { contentInstruction,reviseContentText } from '../../../packages/domain/src/content-writing.js';
import { enableTimeline } from '../../../packages/domain/src/timeline.js';
import { ContentDrafts,type ContentDraftRow } from './content-drafts.js';
const now=()=>new Date().toISOString(),digest=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
type PlanInput=z.infer<typeof contentPlanCreateInput>;
interface PlanSnapshot {input:PlanInput;draftHash:string;patches:ContentPlanPatch[];warnings:string[];project:{id:string;version:number;documentHash:string}|null;simulated:boolean}
export interface ContentPlanRow {id:string;draft_id:string;draft_version:number;tenant_id:string;workspace_id:string;kind:ContentPlan['kind'];name:string;snapshot:string;plan_hash:string;status:ContentPlan['status'];version:number;applied_resource_id:string|null;applied_resource_version:number|null;updated_at:string}
function muteChangedMedia(doc:StudioDocument,ids:Set<string>){
  enableTimeline(doc);
  for(const track of doc.timeline!.tracks){
    if(track.muted)continue;
    const targets=track.clips.filter(c=>c.segmentId&&ids.has(c.segmentId)&&!c.muted&&(track.type==='voice'||(track.type==='subtitle'&&c.source.type==='text')));
    if(targets.length&&track.locked)throw new AppError('CONTENT_MEDIA_TRACK_LOCKED','所选分镜有锁定的旧配音或手工字幕，请先解锁/处理，再建立当前版本计划。',409);
    for(const clip of targets)clip.muted=true;
  }
}
export class ContentPlans {
  constructor(public d:ContentDrafts){}
  get repo(){return this.d.repo;}
  row(p:Principal,id:string,write=false){const r=this.repo.get<ContentPlanRow>('SELECT * FROM studio_content_plans WHERE id=? AND tenant_id=? AND environment=? AND app_env=?',id,p.tenantId,this.d.config.providerMode,this.d.config.appEnv);if(!r)throw new AppError('NOT_FOUND','内容审阅计划不存在或不在当前环境。',404);this.d.scope(p,r.workspace_id,write);this.d.row(p,r.draft_id,write);return r;}
  snapshot(r:ContentPlanRow){return JSON.parse(r.snapshot) as PlanSnapshot;}
  sourceReason(p:Principal,r:ContentPlanRow){const draft=this.d.row(p,r.draft_id);return this.d.sourceReason(p,draft);}
  staleReason(p:Principal,r:ContentPlanRow){
    try{
      const draft=this.d.row(p,r.draft_id),payload=this.d.current(p,draft,true),snapshot=this.snapshot(r);
      if(digest(snapshot)!==r.plan_hash)throw new AppError('CONTENT_PLAN_INVALID','计划校验不一致，请重新建立计划。',409);
      const expected=r.kind==='draft_edit'&&r.status==='applied'?r.applied_resource_version:r.draft_version;
      if(draft.version!==expected||(r.status!=='applied'&&digest(payload)!==snapshot.draftHash))throw new AppError('CONTENT_DRAFT_CHANGED','草稿已有新修订；当前计划保留，核对新草稿后重新建立计划。',409);
      if(snapshot.project){
        const project=this.d.studio.project(p,snapshot.project.id),expectedVersion=r.status==='applied'?r.applied_resource_version:snapshot.project.version;
        if(project.archived||project.version!==expectedVersion||(r.status!=='applied'&&digest(JSON.parse(project.document))!==snapshot.project.documentHash))throw new AppError('CONTENT_PROJECT_CHANGED','目标工程已有变化，请按当前工程版本重新建立计划。',409);
      }
      if(r.kind==='new_project'&&r.status==='applied'&&r.applied_resource_id){const project=this.d.studio.project(p,r.applied_resource_id);if(project.archived)throw new AppError('CONTENT_PROJECT_CHANGED','计划生成的工程已归档。',409);}
      return null;
    }catch(error){if(!(error instanceof AppError))throw error;return error.message;}
  }
  current(p:Principal,r:ContentPlanRow){const source=this.sourceReason(p,r),stale=this.staleReason(p,r);if(source||stale)throw new AppError('CONTENT_PLAN_STALE',source||stale!,409);}
  view(p:Principal,r:ContentPlanRow):ContentPlan{
    this.d.scope(p,r.workspace_id);const s=this.snapshot(r),source=this.sourceReason(p,r);
    return {id:r.id,draftId:r.draft_id,draftVersion:r.draft_version,kind:r.kind,name:r.name,version:r.version,status:r.status,planHash:r.plan_hash,patches:source?null:s.patches,warnings:s.warnings,sourceAvailable:!source,sourceReason:source,staleReason:this.staleReason(p,r),simulated:s.simulated,appliedResourceId:r.applied_resource_id,appliedResourceVersion:r.applied_resource_version,projectId:s.project?.id||null,updatedAt:r.updated_at};
  }
  prepare(p:Principal,draft:ContentDraftRow,input:PlanInput):PlanSnapshot{
    this.d.scope(p,draft.workspace_id,true);this.d.studio.version(draft,input.draftVersion);const payload=this.d.current(p,draft,true);
    let patches:ContentPlanPatch[]=[],project:PlanSnapshot['project']=null,simulated=payload.provider==='mock-content';const warnings:string[]=[];
    if(input.kind==='draft_edit'){
      if(new Set(input.sectionIds).size!==input.sectionIds.length||input.sectionIds.some(id=>!payload.sections.some(s=>s.id===id)))throw new AppError('CONTENT_SECTION_INVALID','选择的草稿段落重复或已移除。',409);
      if(input.operation==='external_rewrite')throw new AppError('CONTENT_PROVIDER_NOT_CONNECTED','真实改写模型尚未接入，不会静默退回模拟或规则。',409);
      let operation=input.operation,replacements=input.replacements;
      if(operation==='instruction'){const parsed=contentInstruction(input.instruction);operation=parsed.operation;if(parsed.operation==='replace'){if(input.sectionIds.length!==1)throw new AppError('CONTENT_SINGLE_REPLACEMENT','聊天文字替换请一次选择一段，或使用逐段替换表单。',422);replacements=[{sectionId:input.sectionIds[0],text:parsed.text!}];}}
      if(operation==='mock_rewrite'){
        if(this.d.config.providerMode!=='mock'||this.d.config.appEnv==='production')throw new AppError('CONTENT_MOCK_NOT_ALLOWED','当前环境不允许模拟内容模型。',409);
        simulated=true;warnings.push('这是明确模拟改写，不证明已完成语义、风格或事实核对。');
      }
      if(new Set(replacements.map(r=>r.sectionId)).size!==replacements.length||replacements.some(r=>!input.sectionIds.includes(r.sectionId))||(operation==='replace'&&replacements.length!==input.sectionIds.length))throw new AppError('CONTENT_REPLACEMENT_INVALID','替换文字须与所选段落逐一对应，不能夹带未选段落。',422);
      if(operation==='shorten')warnings.push('精简规则保留前半句组，可能遗漏信息；这是可撤回的候选计划，需对照原稿核对。');
      patches=payload.sections.filter(s=>input.sectionIds.includes(s.id)).map(section=>({sectionId:section.id,segmentId:null,title:section.title,beforeText:section.text,afterText:reviseContentText(section.text,operation,replacements.find(r=>r.sectionId===section.id)?.text,input.instruction),durationMs:section.durationMs}));
    }else if(input.kind==='new_project'){
      patches=payload.sections.map(s=>({sectionId:s.id,segmentId:randomUUID(),title:s.title,beforeText:null,afterText:s.text,durationMs:s.durationMs}));
      warnings.push('仅建立可编辑脚本与分镜；时长为草稿估计，真实声音、形象和画面请在工程中配置。');
    }else{
      const target=this.d.studio.project(p,input.projectId);this.d.scope(p,target.workspace_id,true);this.d.studio.editable(target);this.d.studio.version(target,input.projectVersion);
      if(target.workspace_id!==draft.workspace_id)throw new AppError('CONTENT_PROJECT_SCOPE','目标工程不在相同工作空间。',409);
      if(new Set(input.mappings.map(m=>m.sectionId)).size!==input.mappings.length||new Set(input.mappings.map(m=>m.segmentId)).size!==input.mappings.length)throw new AppError('CONTENT_MAPPING_INVALID','段落与目标分镜必须一一对应且不重复。',422);
      const doc=JSON.parse(target.document) as StudioDocument;
      patches=input.mappings.map(mapping=>{const section=payload.sections.find(s=>s.id===mapping.sectionId),segment=doc.segments.find(s=>s.id===mapping.segmentId);if(!section||!segment)throw new AppError('CONTENT_MAPPING_INVALID','所选段落或目标分镜已移除。',409);return {sectionId:section.id,segmentId:segment.id,title:segment.title,beforeText:segment.text,afterText:section.text,durationMs:segment.durationMs};});
      const changed=new Set(patches.filter(x=>x.beforeText!==x.afterText).map(x=>x.segmentId!));muteChangedMedia(structuredClone(doc),changed);
      project={id:target.id,version:target.version,documentHash:digest(doc)};
      warnings.push('仅替换映射分镜的台词，保留标题、时长、画面和其他分镜。所选分镜已绑定的旧配音/手工字幕保留并静音，需重新配音或校对。','未绑定分镜的音轨及画面文字不自动改写，请在正式输出前核对。');
    }
    if(patches.some(x=>x.afterText.length>4000))throw new AppError('CONTENT_PATCH_TOO_LONG','单段新文字超过4000字符，请缩短后再审阅。',422);
    return {input,draftHash:digest(payload),patches,warnings,project,simulated};
  }
  create(p:Principal,draft:ContentDraftRow,input:PlanInput){
    const snapshot=this.prepare(p,draft,input),id=randomUUID(),json=JSON.stringify(snapshot),hash=digest(snapshot),time=now();
    if(this.repo.get<{n:number}>('SELECT count(*) n FROM studio_content_plans WHERE draft_id=?',draft.id)!.n>=200)throw new AppError('CONTENT_PLAN_QUOTA','本草稿已有200份计划，请整理或另存变体。',409);
    this.repo.run('INSERT INTO studio_content_plans(id,draft_id,draft_version,tenant_id,workspace_id,kind,name,snapshot,plan_hash,environment,app_env,actor_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,draft.id,draft.version,p.tenantId,draft.workspace_id,input.kind,input.name,json,hash,this.d.config.providerMode,this.d.config.appEnv,p.userId,time,time);
    this.repo.run('INSERT INTO studio_content_plan_versions VALUES (?,1,?,?,?,?)',id,json,hash,p.userId,time);return id;
  }
  save(p:Principal,r:ContentPlanRow,input:z.infer<typeof contentPlanSaveInput>){
    this.d.scope(p,r.workspace_id,true);this.current(p,r);this.d.studio.version(r,input.version);
    if(r.status!=='review')throw new AppError('CONTENT_PLAN_CLOSED','当前计划已应用或取消，不能改写原决定。',409);
    const snapshot=this.snapshot(r);
    if(input.patches.length!==snapshot.patches.length||new Set(input.patches.map(x=>x.sectionId)).size!==input.patches.length||input.patches.some(x=>!snapshot.patches.some(p=>p.sectionId===x.sectionId)))throw new AppError('CONTENT_PLAN_SCOPE','计划只能修改已选段落的新文字；不能添加、移除或改写未选段落。',422);
    for(const patch of snapshot.patches)patch.afterText=input.patches.find(x=>x.sectionId===patch.sectionId)!.afterText;
    const json=JSON.stringify(snapshot),hash=digest(snapshot),time=now();
    this.repo.run('UPDATE studio_content_plans SET snapshot=?,plan_hash=?,version=version+1,updated_at=? WHERE id=?',json,hash,time,r.id);
    this.repo.run('INSERT INTO studio_content_plan_versions VALUES (?,?,?,?,?,?)',r.id,r.version+1,json,hash,p.userId,time);return r.id;
  }
  apply(p:Principal,r:ContentPlanRow,version:number,hash:string){
    this.d.scope(p,r.workspace_id,true);this.current(p,r);this.d.studio.version(r,version);
    if(r.status!=='review'||r.plan_hash!==hash)throw new AppError('CONTENT_PLAN_NOT_REVIEWABLE','计划已关闭或审阅内容变化，请载入当前计划重新核对。',409);
    const snapshot=this.snapshot(r),draft=this.d.row(p,r.draft_id,true),payload=this.d.current(p,draft,true);let resultId:string,resultVersion:number;
    if(r.kind==='draft_edit'){
      const patches=new Map(snapshot.patches.map(x=>[x.sectionId,x]));
      payload.sections=payload.sections.map(s=>patches.has(s.id)?{...s,text:patches.get(s.id)!.afterText}:s);
      if(snapshot.simulated)payload.provider='mock-content';payload.instruction=snapshot.input.kind==='draft_edit'?snapshot.input.instruction:payload.instruction;
      this.d.commit(p,draft,payload);resultId=draft.id;resultVersion=draft.version+1;
    }else{
      const dates=[...(payload.inheritedExpiresAt?[payload.inheritedExpiresAt]:[]),...payload.sourceRefs.map(ref=>this.repo.get<{expires_at:string}>('SELECT expires_at FROM studio_content_sources WHERE id=?',ref.id)!.expires_at)].sort(),expiresAt=dates[0]||null;
      const originId=randomUUID();this.repo.run('INSERT INTO studio_content_origins VALUES (?,?,?,?,?,?,?,?,?,?)',originId,p.tenantId,r.workspace_id,draft.id,draft.version,JSON.stringify(payload.sourceRefs),this.d.config.providerMode,this.d.config.appEnv,now(),expiresAt);
      if(snapshot.input.kind==='new_project'){
        const doc=blankStudioDocument(),example=doc.segments[0],sizes={landscape:[1920,1080],portrait:[1080,1920],square:[1080,1080]} as const;
        [doc.canvas.width,doc.canvas.height]=sizes[snapshot.input.layout];
        doc.segments=snapshot.patches.map(x=>({...structuredClone(example),id:x.segmentId!,title:x.title,text:x.afterText,durationMs:x.durationMs,elements:[],contentOriginId:originId,...(expiresAt?{contentExpiresAt:expiresAt}:{}),notes:snapshot.simulated?'稿件包含明确模拟写作建议，已由使用者审阅；不代表真实内容模型生成。':''}));
        resultId=this.d.studio.create(p,{workspaceId:r.workspace_id,name:snapshot.input.projectName,purpose:'video',document:doc,variables:{}});resultVersion=1;
      }else{
        if(!snapshot.project)throw new AppError('CONTENT_PLAN_INVALID','计划缺少目标工程快照。',409);
        const project=this.d.studio.project(p,snapshot.project.id),doc=JSON.parse(project.document) as StudioDocument,changed=new Set<string>();
        for(const patch of snapshot.patches){const segment=doc.segments.find(s=>s.id===patch.segmentId)!;if(segment.text!==patch.afterText)changed.add(segment.id);segment.text=patch.afterText;segment.contentOriginId=originId;if(expiresAt)segment.contentExpiresAt=expiresAt;else delete segment.contentExpiresAt;}
        muteChangedMedia(doc,changed);this.d.studio.save(p,project,project.version,project.name,doc,{allowContentOriginChanges:true});resultId=project.id;resultVersion=project.version+1;
      }
    }
    this.repo.run('UPDATE studio_content_plans SET status=?,applied_resource_id=?,applied_resource_version=?,version=version+1,updated_at=? WHERE id=?','applied',resultId,resultVersion,now(),r.id);return r.id;
  }
  cancel(p:Principal,r:ContentPlanRow,version:number){
    this.d.scope(p,r.workspace_id,true);this.d.studio.version(r,version);if(r.status!=='review')throw new AppError('CONTENT_PLAN_CLOSED','当前计划已关闭。',409);
    this.repo.run("UPDATE studio_content_plans SET status='cancelled',version=version+1,updated_at=? WHERE id=?",now(),r.id);return r.id;
  }
}
