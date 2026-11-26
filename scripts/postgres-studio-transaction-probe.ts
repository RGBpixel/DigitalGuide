import {randomUUID} from 'node:crypto';
import {blankStudioDocument} from '../packages/contracts/src/index.js';
import {loadNativeRuntimeConfig} from '../packages/postgres/src/runtime-config.js';
import {NativePostgresDatabase} from '../packages/postgres/src/runtime-database.js';
import {NativeCoreRepository} from '../packages/postgres/src/runtime-repository.js';
import {NativeStudio} from '../packages/postgres/src/runtime-studio.js';
import {NativeStudioPreviews} from '../packages/postgres/src/runtime-studio-previews.js';
const db=await NativePostgresDatabase.open(loadNativeRuntimeConfig(process.argv[2]),'api'),repo=new NativeCoreRepository(db),studio=new NativeStudio(repo),previews=new NativeStudioPreviews(repo);
try{await db.transaction(async()=>{
 const p=await repo.principal('30000000-0000-4000-8000-000000000001'),workspaceId='20000000-0000-4000-8000-000000000001',document=blankStudioDocument();await db.query("SELECT set_config('digitalguide.actor_id',$1,true)",[p.userId]);
 const templateId=await studio.saveTemplate(p,{workspaceId,name:'提交前合成模板',description:'事务中断验证',purpose:'video',document,variables:[],licenseNote:'原创合成布局',rightsConfirmed:true},randomUUID()),brandId=await studio.saveBrand(p,{workspaceId,name:'提交前合成品牌',style:document.brand,licenseNote:'原创合成配色',rightsConfirmed:true},randomUUID());
 const projectId=await repo.idempotentResource(p,{action:'POST /api/v1/studio/projects',key:randomUUID(),body:{workspaceId,templateId},code:200},()=>studio.create(p,{workspaceId,name:'提交前合成工程',purpose:'video',templateId,templateVersion:1,variables:{}},randomUUID()));const current=await studio.project(p,projectId),plan=await studio.plan(p,current,1),previewId=await previews.create(p,projectId,{version:1,planHash:plan.hash,segmentIds:plan.steps.map(s=>s.id),confirmed:true},randomUUID());await studio.save(p,projectId,1,'提交前二版',JSON.parse(current.document),randomUUID());
 console.log(JSON.stringify({phase:'native_studio_staged',projectId,templateId,brandId,previewId}));await new Promise<void>(()=>{/* Parent actually kills this process after writes, before COMMIT. */});
});}finally{await db.close();}
