import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { blankStudioDocument,contentDraftSchema,contentPlanSchema,type ContentSource,type ContentDraft,type ContentPlan,type StudioProject } from '@digitalguide/contracts';
import { enableTimeline } from '../../packages/domain/src/timeline.js';
import { fixtureIds as f } from '../../packages/test-fixtures/src/seed.js';
import { ContentDrafts } from '../../apps/api/src/content-drafts.js';
import { StudioService } from '../../apps/api/src/studio-service.js';
import { studioPackageSnapshot } from '../../apps/api/src/studio-package-service.js';
import { validatePortableProject } from '../../packages/domain/src/portable-project.js';
import { runSpeechJob } from '../../apps/worker/src/speech-jobs.js';
import { runStudioExport } from '../../apps/worker/src/studio-exports.js';
import { systemSpeechVoices } from '@digitalguide/providers';
import { expressionPresets,type SpeechJob,type StudioExport,type ExportPlan,type ContentBrief } from '@digitalguide/contracts';
import { harness } from './helpers.js';
let h:Awaited<ReturnType<typeof harness>>;
beforeEach(async()=>{h=await harness();});afterEach(async()=>{vi.restoreAllMocks();await h.close();});
const post=(url:string,body:object,headers=h.headers,key:string=randomUUID())=>h.app.inject({method:'POST',url:'/api/v1'+url,headers:{...headers,'idempotency-key':key},payload:body});
const get=(url:string,headers=h.headers)=>h.app.inject({url:'/api/v1'+url,headers});
async function good<T>(url:string,body:object,headers=h.headers,key?:string):Promise<T>{const r=await post(url,body,headers,key);expect(r.statusCode,r.body).toBe(200);return r.json().data;}
async function source(text='第一句。第二句。第三句。第四句。'){return good<ContentSource>('/studio/content/sources',{workspaceId:f.workspaceA,name:'原创草稿来源',kind:'text',text,rights:{subject:'虚构原创作者',proof:'原创合成文字用于本地草稿与计划测试',expiresAt:new Date(Date.now()+86400000).toISOString(),confirmed:true}});}
async function draft(s?:ContentSource){s||=await source();return good<ContentDraft>('/studio/content/drafts',{workspaceId:f.workspaceA,name:'原创脚本草稿',sources:[{id:s.id,version:s.version}],provider:'local-rules',confirmed:true});}
const readDraft=async(id:string)=>(await get('/studio/content/drafts/'+id)).json().data as ContentDraft;
const readPlan=async(id:string)=>(await get('/studio/content/plans/'+id)).json().data as ContentPlan;
const apply=(p:ContentPlan,key?:string)=>good<ContentPlan>('/studio/content/plans/'+p.id+'/apply',{version:p.version,planHash:p.planHash,acknowledgeMutedMedia:true,confirmed:true},h.headers,key);
describe('T24脚本修订、变体、审阅计划与局部工程修改',()=>{
  it('定位变化保留已写台词，明确采用当前定位后才允许新计划；未知指令不写入',async()=>{
    const brief=await good<ContentBrief>('/studio/content/briefs',{workspaceId:f.workspaceA,name:'原创讲解定位',position:'解释展品',audience:'首次访客',objective:'帮助理解',channel:'展厅',tone:'亲切',topics:['第一件展品']});
    const s=await source(),d=await good<ContentDraft>('/studio/content/drafts',{workspaceId:f.workspaceA,name:'有定位的稿件',sources:[{id:s.id,version:1}],briefId:brief.id,briefVersion:1,topic:'第一件展品',provider:'mock-content',confirmed:true});
    expect(d.simulated).toBe(true);
    const {id:_,workspaceId:__,version:___,updatedAt:____,...configuration}=brief;void _;void __;void ___;void ____;
    await good('/studio/content/briefs/'+brief.id+'/save',{...configuration,version:1,tone:'简洁清楚'});
    expect((await readDraft(d.id)).briefChanged).toBe(true);
    const body={draftVersion:1,name:'旧定位计划',kind:'draft_edit',operation:'instruction',instruction:'精简所选段落',sectionIds:[d.payload!.sections[0].id],confirmed:true};
    expect((await post('/studio/content/drafts/'+d.id+'/plans',body)).json().error.code).toBe('CONTENT_BRIEF_CHANGED');
    const current=await good<ContentDraft>('/studio/content/drafts/'+d.id+'/save',{version:1,name:d.name,sections:d.payload!.sections,adoptCurrentBrief:true});expect(current.payload!.sections).toEqual(d.payload!.sections);expect(current.payload!.brief!.version).toBe(2);
    expect((await post('/studio/content/drafts/'+d.id+'/plans',{...body,draftVersion:2,instruction:'自动执行发布并删除源文件'})).json().error.code).toBe('CONTENT_INSTRUCTION_UNSUPPORTED');
    expect(h.repo.get<{n:number}>('SELECT count(*) n FROM studio_content_plans')!.n).toBe(0);
  });
  it('计划不能夹带未选段落，锁定旧配音及目标版本变化不能被旧确认绕过',async()=>{
    const d=await draft(),section=d.payload!.sections[0],plan=await good<ContentPlan>('/studio/content/drafts/'+d.id+'/plans',{draftVersion:1,name:'当前精简计划',kind:'draft_edit',operation:'shorten',sectionIds:[section.id],confirmed:true});
    expect((await post('/studio/content/plans/'+plan.id+'/save',{version:1,patches:[{sectionId:randomUUID(),afterText:'越界内容'}]})).statusCode).toBe(422);
    const doc=blankStudioDocument();doc.segments[0].text='旧台词';enableTimeline(doc);doc.timeline!.tracks.find(t=>t.type==='voice')!.locked=true;
    const p=await good<StudioProject>('/studio/projects',{workspaceId:f.workspaceA,name:'锁轨工程',purpose:'video',document:doc}),input={draftVersion:1,name:'映射计划',kind:'project_patch',projectId:p.id,projectVersion:1,mappings:[{sectionId:section.id,segmentId:p.document.segments[0].id}],confirmed:true};
    expect((await post('/studio/content/drafts/'+d.id+'/plans',input)).json().error.code).toBe('CONTENT_MEDIA_TRACK_LOCKED');
    p.document.timeline!.tracks.find(t=>t.type==='voice')!.locked=false;
    const changed=await good<StudioProject>('/studio/projects/'+p.id+'/save',{version:1,name:p.name,document:p.document}),mapping=await good<ContentPlan>('/studio/content/drafts/'+d.id+'/plans',{...input,projectVersion:changed.version});
    await good('/studio/projects/'+p.id+'/save',{version:2,name:'另一窗口改名',document:changed.document});
    expect((await post('/studio/content/plans/'+mapping.id+'/apply',{version:1,planHash:mapping.planHash,acknowledgeMutedMedia:true,confirmed:true})).statusCode).toBe(409);
  });
  it('异步草稿结果遇到来源撤回在幂等缓存前拒绝，不留下新草稿',async()=>{
    const s=await source(),original=ContentDrafts.prototype.prepare;
    vi.spyOn(ContentDrafts.prototype,'prepare').mockImplementationOnce(async function(this:ContentDrafts,p,input){const result=await original.call(this,p,input);h.repo.run('UPDATE studio_content_sources SET withdrawn=1,version=version+1 WHERE id=?',s.id);return result;});
    const key=randomUUID(),response=await post('/studio/content/drafts',{workspaceId:f.workspaceA,name:'在途来源变化',sources:[{id:s.id,version:1}],provider:'local-rules',confirmed:true},h.headers,key);
    expect(response.statusCode).toBe(409);expect(h.repo.get<{n:number}>('SELECT count(*) n FROM studio_content_drafts')!.n).toBe(0);expect(h.repo.get('SELECT key FROM idempotency WHERE key=?',key)).toBeUndefined();
  });
  it.runIf(process.platform==='win32')('实际系统配音和FHD文件沿用稿件来源；撤回后原WAV/成片/旧确认都拒绝，无关素材仍可用',async()=>{
    const s=await source('Hello. Welcome.'),d=await draft(s),plan=await good<ContentPlan>('/studio/content/drafts/'+d.id+'/plans',{draftVersion:1,name:'原生配音工程计划',kind:'new_project',projectName:'原创脚本原生成片',layout:'landscape',confirmed:true}),applied=await apply(plan);
    let p=(await get('/studio/projects/'+applied.appliedResourceId)).json().data as StudioProject;
    p.document.segments[0].speakerId=null;p.document.segments[0].durationMs=3000;
    p=await good<StudioProject>('/studio/projects/'+p.id+'/save',{version:1,name:p.name,document:p.document});
    const voice=(await systemSpeechVoices(h.config.root)).find(v=>v.locale==='en-US')!;expect(voice).toBeTruthy();
    let job=await good<SpeechJob>('/studio/projects/'+p.id+'/speech-jobs',{projectVersion:p.version,providerId:'windows-sapi',voiceId:voice.id,locale:'en-US',controls:expressionPresets.neutral,segments:[{segmentId:p.document.segments[0].id,annotations:[]}],confirmed:true});
    await runSpeechJob(h.repo,h.config);job=(await get('/studio/speech-jobs/'+job.id)).json().data;expect(job.status).toBe('succeeded');
    job=await good<SpeechJob>('/studio/speech-jobs/'+job.id+'/apply',{version:job.version,projectVersion:p.version,confirmed:true,rightsConfirmed:true,replaceExistingVoice:true,trimLongAudio:true});
    p=(await get('/studio/projects/'+p.id)).json().data;
    expect(p.document.timeline!.tracks.find(t=>t.name.startsWith('本地系统配音'))!.clips[0].voiceRole).toBe('narration');
    const assetId=job.outputs[0].assetId!;expect(h.repo.asset(h.repo.principal(f.adminA),assetId).expiresAt).toBe(s.expiresAt);expect((await get('/assets/'+assetId+'/content')).statusCode).toBe(200);
    const studio=new StudioService(h.repo,h.config.providerMode,h.config.appEnv,h.config.dataDir),portable=studioPackageSnapshot(studio,h.repo.principal(f.adminA),studio.project(h.repo.principal(f.adminA),p.id)).portable;
    expect(portable.document.segments[0].contentOriginId).toBeUndefined();expect(portable.document.segments[0].contentExpiresAt).toBe(s.expiresAt);expect(portable.nonPortable.some(n=>n.kind==='content_origin')).toBe(true);
    const expired=structuredClone(portable);expired.document.segments[0].contentExpiresAt=new Date(0).toISOString();expect(()=>validatePortableProject(expired)).toThrow();
    const request={version:p.version,kind:'video',settings:{preset:'hd',fps:24,transparent:false,omitBackground:false,burnSubtitles:true},startMs:0,durationMs:1000},review=await good<ExportPlan>('/studio/projects/'+p.id+'/export-plan',request);
    expect(review.canExport).toBe(true);let exp=await good<StudioExport>('/studio/projects/'+p.id+'/exports',{...request,planHash:review.hash,confirmed:true,rightsConfirmed:true});await runStudioExport(h.repo,h.config);
    exp=(await get('/studio/exports/'+exp.id)).json().data;expect(exp.status).toBe('succeeded');const video=exp.artifacts.find(a=>a.kind==='video')!;expect((await h.app.inject({url:video.url!,headers:h.headers})).statusCode).toBe(200);
    await good('/studio/content/sources/'+s.id+'/withdraw',{version:1,confirmed:true});
    expect((await get('/assets/'+assetId+'/content')).statusCode).toBe(409);expect((await get('/studio/speech-jobs/'+job.id+'/segments/'+p.document.segments[0].id+'/audio')).statusCode).toBe(409);
    expect((await h.app.inject({url:video.url!,headers:h.headers})).statusCode).toBe(409);expect((await get('/assets/'+f.voiceA+'/content')).statusCode).toBe(200);
    expect((await post('/studio/content/plans/'+plan.id+'/apply',{version:plan.version,planHash:plan.planHash,acknowledgeMutedMedia:true,confirmed:true})).statusCode).toBe(409);
  },60000);
  it('来源形成实际可编辑草稿，人工修订和独立变体保留历史与来源',async()=>{
    const d=await draft();expect(contentDraftSchema.safeParse(d).success).toBe(true);expect(d.payload!.sections[0].text).toContain('第一句');
    const fork=await good<ContentDraft>('/studio/content/drafts/'+d.id+'/fork',{version:1,name:'另一种讲法',confirmed:true});expect(fork).toMatchObject({rootId:d.id,parentId:d.id,version:1});
    const sections=structuredClone(fork.payload!.sections);sections[0].text='人工核对后的另一种讲法。';
    const edited=await good<ContentDraft>('/studio/content/drafts/'+fork.id+'/save',{version:1,name:fork.name,sections});
    expect(edited.version).toBe(2);expect((await readDraft(d.id)).payload!.sections[0].text).not.toBe(sections[0].text);
    expect((await get('/studio/content/drafts/'+fork.id+'/versions')).json().data).toHaveLength(2);
    expect((await post('/studio/content/drafts/'+fork.id+'/save',{version:1,name:'冲突草稿',sections})).statusCode).toBe(409);
  });
  it('指令先生成前后对照计划，审阅修改只应用所选段落，缓存不重复提交',async()=>{
    const d=await draft(),sections=[...d.payload!.sections,{...d.payload!.sections[0],id:randomUUID(),title:'无关第二段',text:'第二段保持原样。'}];
    const saved=await good<ContentDraft>('/studio/content/drafts/'+d.id+'/save',{version:1,name:d.name,sections});
    let plan=await good<ContentPlan>('/studio/content/drafts/'+d.id+'/plans',{draftVersion:saved.version,name:'精简第一段',kind:'draft_edit',operation:'instruction',sectionIds:[sections[0].id],instruction:'请精简所选段落',confirmed:true});
    expect(contentPlanSchema.safeParse(plan).success).toBe(true);expect(plan.patches![0].afterText).toBe('第一句。第二句。');
    expect((await readDraft(d.id)).payload!.sections).toEqual(sections);
    plan=await good<ContentPlan>('/studio/content/plans/'+plan.id+'/save',{version:plan.version,patches:[{sectionId:sections[0].id,afterText:'审阅后采用的第一段。'}]});
    const key=randomUUID(),result=await apply(plan,key);expect(result.status).toBe('applied');const changed=await readDraft(d.id);expect(changed.version).toBe(3);expect(changed.payload!.sections[0].text).toBe('审阅后采用的第一段。');expect(changed.payload!.sections[1]).toEqual(sections[1]);
    expect((await apply(plan,key)).appliedResourceVersion).toBe(3);expect((await readDraft(d.id)).version).toBe(3);
    expect((await post('/studio/content/plans/'+plan.id+'/apply',{version:plan.version,planHash:plan.planHash,acknowledgeMutedMedia:true,confirmed:true})).statusCode).toBe(409);
  });
  it('确认计划建立独立工程及来源期限，不能在普通保存中静默去掉约束',async()=>{
    const s=await source(),d=await draft(s),plan=await good<ContentPlan>('/studio/content/drafts/'+d.id+'/plans',{draftVersion:d.version,name:'新工程审阅',kind:'new_project',projectName:'来源转成的工程',layout:'portrait',confirmed:true}),result=await apply(plan);
    const p=(await get('/studio/projects/'+result.appliedResourceId)).json().data as StudioProject;expect(p.document.canvas).toMatchObject({width:1080,height:1920});expect(p.document.segments[0]).toMatchObject({text:d.payload!.sections[0].text,contentExpiresAt:s.expiresAt});expect(p.document.segments[0].contentOriginId).toBeTruthy();
    const doc=structuredClone(p.document);delete doc.segments[0].contentOriginId;delete doc.segments[0].contentExpiresAt;
    expect((await post('/studio/projects/'+p.id+'/save',{version:1,name:p.name,document:doc})).json().error.code).toBe('CONTENT_ORIGIN_CHANGE_REQUIRES_PLAN');
    await good('/studio/content/sources/'+s.id+'/withdraw',{version:1,confirmed:true});
    expect((await readDraft(d.id)).payload).toBeNull();expect((await readPlan(plan.id)).patches).toBeNull();
    const exportsPlan=await good<{canExport:boolean}>('/studio/projects/'+p.id+'/export-plan',{version:p.version,kind:'video',settings:{preset:'hd',fps:24,transparent:false,omitBackground:false,burnSubtitles:true},startMs:0,durationMs:1000});
    expect(exportsPlan.canExport).toBe(false);
  });
  it('现有工程局部文字替换保留第二分镜和其片段，仅静音已关联的旧配音',async()=>{
    const document=blankStudioDocument(),first=document.segments[0];document.speakers[0].voiceAssetId=f.voiceA;first.durationMs=3000;first.text='原来第一段。';
    document.segments.push({...structuredClone(first),id:randomUUID(),title:'无关分镜',text:'无关台词和画面。',elements:[]});enableTimeline(document);
    const p=await good<StudioProject>('/studio/projects',{workspaceId:f.workspaceA,name:'已有局部编辑工程',purpose:'video',document}),other=p.document.segments[1],beforeClips=p.document.timeline!.tracks.flatMap(t=>t.clips).filter(c=>c.segmentId===other.id);
    const d=await good<ContentDraft>('/studio/projects/'+p.id+'/content-draft',{projectVersion:1,name:'当前分镜稿',segmentIds:[first.id],confirmed:true}),section={...d.payload!.sections[0],text:'替换后的第一段。'};
    const saved=await good<ContentDraft>('/studio/content/drafts/'+d.id+'/save',{version:1,name:d.name,sections:[section]});
    const plan=await good<ContentPlan>('/studio/content/drafts/'+d.id+'/plans',{draftVersion:saved.version,name:'只改第一段',kind:'project_patch',projectId:p.id,projectVersion:1,mappings:[{sectionId:section.id,segmentId:first.id}],confirmed:true});await apply(plan);
    const changed=(await get('/studio/projects/'+p.id)).json().data as StudioProject;
    expect(changed.version).toBe(2);expect(changed.document.segments[0].text).toBe(section.text);expect(changed.document.segments[0].durationMs).toBe(first.durationMs);expect(changed.document.segments[1]).toEqual(other);
    expect(changed.document.timeline!.tracks.flatMap(t=>t.clips).filter(c=>c.segmentId===other.id)).toEqual(beforeClips);
    expect(changed.document.timeline!.tracks.find(t=>t.type==='voice')!.clips.find(c=>c.segmentId===first.id)!.muted).toBe(true);
    expect((await get('/studio/projects/'+p.id+'/versions')).json().data).toHaveLength(2);
  });
  it('只读/跨空间拒绝写入，在途失权不创建草稿，未接模型及未知指令不假成功',async()=>{
    const s=await source(),viewer=await h.login(f.viewerA),body={workspaceId:f.workspaceA,name:'受限草稿',sources:[{id:s.id,version:s.version}],provider:'local-rules',confirmed:true};
    expect((await post('/studio/content/drafts',body,viewer)).statusCode).toBe(403);expect((await post('/studio/content/drafts',{...body,workspaceId:f.workspaceB})).statusCode).toBe(404);
    expect((await post('/studio/content/drafts',{...body,provider:'external-content'})).statusCode).toBe(409);
    const original=ContentDrafts.prototype.prepare;
    vi.spyOn(ContentDrafts.prototype,'prepare').mockImplementationOnce(async function(this:ContentDrafts,p,input){const payload=await original.call(this,p,input);h.repo.run('UPDATE memberships SET workspace_ids=? WHERE user_id=?','[]',f.adminA);return payload;});
    expect((await post('/studio/content/drafts',body)).statusCode).toBe(404);expect(h.repo.get<{n:number}>('SELECT count(*) n FROM studio_content_drafts')!.n).toBe(0);
  });
});
