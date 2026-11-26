// Main-loopback original demo only. Checkpointed requests never overwrite existing examples.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash,randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { fixtureIds as f } from '../packages/test-fixtures/src/seed.js';
import type { ContentDraft,ContentPlan,ContentSource,ContentBrief,StudioProject,CharacterJob,Asset } from '@digitalguide/contracts';
const folder=process.env.CONTENT_DRAFTS_EVIDENCE_DIR||'docs/evidence/T24/content-drafts/runtime',stateFile='storage/content-drafts-preview-state.json',base='http://127.0.0.1:4301/api/v1',origin='http://127.0.0.1:5174',verifyOnly=process.argv.includes('--verify-only');
fs.mkdirSync(folder,{recursive:true});
interface Step {url:string;body:object;key:string;id?:string}
interface State {steps:Record<string,Step>;draftId?:string;projectId?:string;variantId?:string;reviewPlanId?:string}
const state:State=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile,'utf8')):{steps:{}};
const checkpoint=()=>fs.writeFileSync(stateFile,JSON.stringify(state,null,2)+'\n');
const digest=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex'),checks:{name:string;status:number}[]=[];
const ready=await fetch(base+'/readiness');assert.equal(ready.status,200);checks.push({name:'readiness',status:200});
const login=await fetch(base+'/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({accountId:f.adminA})});assert.equal(login.status,200);const cookie=login.headers.getSetCookie()[0].split(';')[0];
async function get<T>(url:string):Promise<T>{const r=await fetch(base+url,{headers:{cookie},signal:AbortSignal.timeout(15000)});checks.push({name:url,status:r.status});assert.equal(r.status,200,await r.clone().text());return(await r.json()).data;}
const me=await get<{csrfToken:string}>('/me');
async function step(name:string,url:string,body:object):Promise<string>{
  if(state.steps[name]?.id)return state.steps[name].id!;
  assert.equal(verifyOnly,false,'Verification does not create missing demo steps: '+name);
  const request=state.steps[name]||{url,body,key:randomUUID()};state.steps[name]=request;checkpoint();
  const r=await fetch(base+request.url,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',cookie,'X-CSRF-Token':me.csrfToken,'Idempotency-Key':request.key},body:JSON.stringify(request.body),signal:AbortSignal.timeout(25000)});assert.equal(r.status,200,await r.clone().text());const data=(await r.json()).data as {id:string};assert.ok(data.id);request.id=data.id;checkpoint();return data.id;
}
const sourceState=JSON.parse(fs.readFileSync('storage/content-source-preview-state.json','utf8')) as {sourceIds:Record<string,string>;briefId:string};
const sources=await Promise.all(Object.values(sourceState.sourceIds).map(id=>get<ContentSource>('/studio/content/sources/'+id)));for(const source of sources){assert.equal(source.available,true);assert.equal(digest(source.text!),source.textSHA256);}assert.equal(sources.length,4);
const source=sources.find(s=>s.kind==='text')!,brief=await get<ContentBrief>('/studio/content/briefs/'+sourceState.briefId);
if(!verifyOnly){
  state.draftId=await step('draft','/studio/content/drafts',{workspaceId:f.workspaceA,name:'原创合成 · 展厅口播脚本',sources:[{id:source.id,version:source.version}],briefId:brief.id,briefVersion:brief.version,provider:'local-rules',topic:brief.topics[0],chunkCharacters:1000,confirmed:true});checkpoint();
  let draft=await get<ContentDraft>('/studio/content/drafts/'+state.draftId);
  const sections=[{id:draft.payload!.sections[0].id,title:'开场欢迎',text:'欢迎来到数字导览展厅。我们将一起了解内容制作与现场服务。',durationMs:6000},{id:state.steps.manual?((state.steps.manual.body as {sections:{id:string}[]}).sections[1].id):randomUUID(),title:'制作与服务',text:'第一站介绍平台如何把内容制作和接待服务连接起来。',durationMs:8000},{id:state.steps.manual?((state.steps.manual.body as {sections:{id:string}[]}).sections[2].id):randomUUID(),title:'路线选择',text:'您可以先了解展品，再选择适合自己的参观路线。',durationMs:6000}];
  await step('manual','/studio/content/drafts/'+draft.id+'/save',{version:draft.version,name:draft.name,sections});
  draft=await get<ContentDraft>('/studio/content/drafts/'+state.draftId);
  const editId=await step('editPlan','/studio/content/drafts/'+draft.id+'/plans',{kind:'draft_edit',draftVersion:draft.version,name:'只精简开场，保留其余两段',operation:'instruction',sectionIds:[draft.payload!.sections[0].id],instruction:'请精简所选段落',confirmed:true});
  let plan=await get<ContentPlan>('/studio/content/plans/'+editId);
  await step('editApply','/studio/content/plans/'+plan.id+'/apply',{version:plan.version,planHash:plan.planHash,acknowledgeMutedMedia:true,confirmed:true});
  draft=await get<ContentDraft>('/studio/content/drafts/'+state.draftId);
  const projectPlanId=await step('newProjectPlan','/studio/content/drafts/'+draft.id+'/plans',{kind:'new_project',draftVersion:draft.version,name:'审阅后建立独立横屏工程',projectName:'原创合成 · 展厅讲解脚本工程',layout:'landscape',confirmed:true});
  plan=await get<ContentPlan>('/studio/content/plans/'+projectPlanId);
  const appliedId=await step('newProjectApply','/studio/content/plans/'+plan.id+'/apply',{version:plan.version,planHash:plan.planHash,acknowledgeMutedMedia:true,confirmed:true});
  plan=await get<ContentPlan>('/studio/content/plans/'+appliedId);state.projectId=plan.appliedResourceId!;
  state.variantId=await step('variant','/studio/content/drafts/'+draft.id+'/fork',{version:draft.version,name:'原创合成 · 竖屏口播独立变体',confirmed:true});
  state.reviewPlanId=await step('pendingReview','/studio/content/drafts/'+draft.id+'/plans',{kind:'draft_edit',draftVersion:draft.version,name:'待人工审阅 · 更亲切的开场',operation:'replace',sectionIds:[draft.payload!.sections[0].id],replacements:[{sectionId:draft.payload!.sections[0].id,text:'欢迎参观。今天带您了解平台的制作与接待流程。'}],confirmed:true});checkpoint();
}
assert.ok(state.draftId&&state.projectId&&state.variantId&&state.reviewPlanId);
const draft=await get<ContentDraft>('/studio/content/drafts/'+state.draftId),variant=await get<ContentDraft>('/studio/content/drafts/'+state.variantId),plan=await get<ContentPlan>('/studio/content/plans/'+state.reviewPlanId),project=await get<StudioProject>('/studio/projects/'+state.projectId);
assert.equal(draft.version,3);assert.equal(draft.payload!.sections.length,3);assert.equal(draft.payload!.sections[0].text,'欢迎来到数字导览展厅。');assert.equal(draft.payload!.sections[1].text,'第一站介绍平台如何把内容制作和接待服务连接起来。');assert.equal(variant.parentId,draft.id);assert.equal(variant.version,1);assert.equal(plan.status,'review');assert.equal(plan.patches!.length,1);assert.equal(project.document.segments.length,3);assert.deepEqual(project.document.segments.map(s=>s.text),draft.payload!.sections.map(s=>s.text));assert.ok(project.document.segments.every(s=>s.contentOriginId&&s.contentExpiresAt));
const versions=await get<{version:number}[]>('/studio/content/drafts/'+draft.id+'/versions');assert.deepEqual(versions.map(v=>v.version),[3,2,1]);
const capabilities=await get<{editableDrafts:boolean;reviewedProjectPlans:boolean;realContentModel:boolean}>('/studio/content/capabilities?workspaceId='+f.workspaceA);assert.equal(capabilities.editableDrafts,true);assert.equal(capabilities.reviewedProjectPlans,true);const writing=await get<{available:boolean}>('/studio/content/writing/capabilities?workspaceId='+f.workspaceA);assert.equal(capabilities.realContentModel,writing.available);
const characterState=JSON.parse(fs.readFileSync('storage/character-preview-state.json','utf8')),oldJob=await get<CharacterJob>('/studio/character-jobs/'+characterState.jobId),motion=await fetch(base+'/studio/character-jobs/'+oldJob.id+'/file',{headers:{cookie}});assert.equal(motion.status,200);const motionHash=digest(Buffer.from(await motion.arrayBuffer()));assert.equal(motionHash,oldJob.outputs[0].sha256);
const voice=await get<Asset>('/assets/c9dd1736-b100-44e7-b9dd-8dbd897b3e65'),voiceResponse=await fetch(base+'/assets/'+voice.id+'/content',{headers:{cookie}});assert.equal(voiceResponse.status,200);assert.equal(digest(Buffer.from(await voiceResponse.arrayBuffer())),voice.sha256);
const anonymous=await fetch(base+'/studio/content/drafts/'+draft.id);assert.equal(anonymous.status,401);checks.push({name:'anonymous draft refused',status:401});
const db=new DatabaseSync(path.resolve('storage/digitalguide.sqlite'),{readOnly:true});let migrations:string[];try{migrations=(db.prepare('SELECT name FROM schema_migrations ORDER BY name').all() as {name:string}[]).map(r=>r.name);assert.ok(migrations.includes('026-content-drafts.sql'));}finally{db.close();}
const shell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),listeners=JSON.parse(execFileSync(shell,['-NoLogo','-NoProfile','-NonInteractive','-Command','Get-NetTCPConnection -State Listen -LocalPort 4301,5174 | Select-Object LocalAddress,LocalPort,OwningProcess | ConvertTo-Json -Compress'],{encoding:'utf8',windowsHide:true}));assert.equal(listeners.length,2);for(const l of listeners)assert.equal(l.LocalAddress,'127.0.0.1');
const result={result:'PASS_CONTENT_DRAFTS_SUBMODULE_RUNTIME',recordedAt:new Date().toISOString(),sessionHandle:process.env.PREVIEW_SESSION_HANDLE||null,verifyOnly,preview:origin+'/studio/drafts?draft='+draft.id,login:'林知 · 管理员；品牌与接待',draftId:draft.id,draftVersion:draft.version,variantId:variant.id,projectId:project.id,projectVersion:project.version,reviewPlanId:plan.id,sections:draft.payload!.sections,sourceIds:sourceState.sourceIds,briefId:brief.id,checks,capabilities,migrations,listeners,originalCharacterVideo:{id:oldJob.id,sha256:motionHash},originalSystemVoice:{id:voice.id,sha256:voice.sha256},projectMediaBoundary:'本主预览新增工程仅包含审阅后的文字分镜，尚未对新稿配音或驱动形象；真实系统配音及FHD文件在隔离编译证明中验证。',scope:'脚本/计划子模块；T24及AC-35/36/37整体仍未完成。无实际设备或对外业务。'};
fs.writeFileSync(path.join(folder,'preview.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({result:result.result,draftVersion:draft.version,sections:3,checks:checks.length,sessionHandle:result.sessionHandle,schema:'026'}));
