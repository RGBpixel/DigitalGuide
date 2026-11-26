import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { fixtureIds as f } from '../packages/test-fixtures/src/seed.js';
import { originalWordContentFixture } from '../packages/test-fixtures/src/content.js';
import type { ContentSource,ContentBrief,Asset,Character,CharacterJob } from '@digitalguide/contracts';
const base='http://127.0.0.1:4301/api/v1',origin='http://127.0.0.1:5174',folder=process.env.CONTENT_SOURCE_EVIDENCE_DIR||'docs/evidence/T24/content-sources/runtime',stateFile='storage/content-source-preview-state.json',verifyOnly=process.argv.includes('--verify-only');
fs.mkdirSync(folder,{recursive:true});
interface PreviewState {expiresAt:string;sourceIds:Record<string,string>;keys:Record<string,string>;briefId?:string}
const state:PreviewState=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile,'utf8')):{expiresAt:new Date(Date.now()+30*86400000).toISOString(),sourceIds:{},keys:{}};
const checkpoint=()=>fs.writeFileSync(stateFile,JSON.stringify(state,null,2)+'\n'),checks:{name:string;status:number}[]=[];
const digest=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const health=await fetch(base+'/readiness');assert.equal(health.status,200);checks.push({name:'readiness',status:200});
const login=await fetch(base+'/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({accountId:f.adminA})});assert.equal(login.status,200);const cookie=login.headers.getSetCookie()[0].split(';')[0];
async function get<T>(url:string):Promise<T>{const r=await fetch(base+url,{headers:{cookie},signal:AbortSignal.timeout(15000)});checks.push({name:url,status:r.status});assert.equal(r.status,200);return(await r.json()).data;}
const me=await get<{csrfToken:string}>('/me');
async function post<T>(url:string,body:object,key:string):Promise<T>{const r=await fetch(base+url,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',cookie,'X-CSRF-Token':me.csrfToken,'Idempotency-Key':key},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});assert.equal(r.status,200,await r.clone().text());return(await r.json()).data;}
const rights={subject:'平台原创合成内容作者',proof:'本项目代码及文字原创的演示资料，仅作本地内容制作测试，不含真人资料。',expiresAt:state.expiresAt,confirmed:true};
if(!verifyOnly){
  checkpoint();
  const wordFile=path.join(folder,'original-source.docx');
  if(!fs.existsSync(wordFile))fs.writeFileSync(wordFile,await originalWordContentFixture());
  const characterState=JSON.parse(fs.readFileSync('storage/character-preview-state.json','utf8')),videoCharacter=await get<Character>('/studio/characters/'+characterState.characters.video),video=await get<Asset>('/assets/'+videoCharacter.sourceAssetId);
  const inputs:Record<string,object>={
    text:{kind:'text',name:'原创合成 · 展厅口播文字',text:'欢迎来到数字导览展厅。\n第一站介绍平台如何把内容制作和接待服务连接起来。\n您可以先了解展品，再选择适合自己的参观路线。'},
    docx:{kind:'docx',name:'原创合成 · Word讲稿',fileName:'原创来源.docx',contentBase64:fs.readFileSync(wordFile).toString('base64')},
    web:{kind:'web',name:'原创合成 · 网页HTML快照',url:'https://example.invalid/digitalguide-demo',capture:'snapshot',html:'<html><head><title>原创合成演示页</title></head><body><article><p>这是项目原创的静态HTML讲稿示例。</p><p>example.invalid仅为未部署的占位出处，本条未进行网页抓取。</p></article></body></html>'},
    video:{kind:'video',name:'原创合成 · 色块原片人工说明',assetId:video.id,assetVersion:video.version,transcript:'本条是对项目原创色块测试片的人工说明。\n画面与测试音由代码生成，不含真人，本正文不是自动识别的台词。',transcriptOrigin:'manual'}
  };
  for(const [kind,input] of Object.entries(inputs)){
    if(state.sourceIds[kind])continue;state.keys[kind]||=randomUUID();checkpoint();
    const source=await post<ContentSource>('/studio/content/sources',{workspaceId:f.workspaceA,rights,...input},state.keys[kind]);state.sourceIds[kind]=source.id;checkpoint();
  }
  if(!state.briefId){state.keys.brief||=randomUUID();checkpoint();const brief=await post<ContentBrief>('/studio/content/briefs',{workspaceId:f.workspaceA,name:'原创合成 · 平台讲解账号',position:'解释统一数字人平台的内容制作和现场服务',audience:'初次了解平台的参观者',objective:'帮助观众理解制作、传播及接待的流程',channel:'官网、展厅与预制短视频',tone:'清楚、亲切且保留能力边界',topics:['从讲稿到成片的制作流程','前台与餐厅如何交接服务','如何核对素材授权与真实能力']},state.keys.brief);state.briefId=brief.id;checkpoint();}
}
const sources=await Promise.all(Object.values(state.sourceIds).map(id=>get<ContentSource>('/studio/content/sources/'+id)));assert.equal(sources.length,4);
for(const s of sources){assert.equal(s.available,true);assert.ok(s.text);assert.equal(digest(s.text!),s.textSHA256);assert.ok(s.paragraphs.length>0);}
const brief=await get<ContentBrief>('/studio/content/briefs/'+state.briefId);assert.ok(brief.topics.length===3);
const capabilities=await get<{automaticVideoASR:boolean;scriptGeneration:boolean;recording:boolean}>('/studio/content/capabilities?workspaceId='+f.workspaceA);assert.equal(capabilities.automaticVideoASR,true);const writingCapabilities=await get<{available:boolean}>('/studio/content/writing/capabilities?workspaceId='+f.workspaceA);assert.equal(capabilities.scriptGeneration,writingCapabilities.available);assert.equal(capabilities.recording,true);
const characterState=JSON.parse(fs.readFileSync('storage/character-preview-state.json','utf8')),oldJob=await get<CharacterJob>('/studio/character-jobs/'+characterState.jobId);
const motion=await fetch(base+'/studio/character-jobs/'+oldJob.id+'/file',{headers:{cookie}});assert.equal(motion.status,200);const motionBytes=Buffer.from(await motion.arrayBuffer());assert.equal(digest(motionBytes),oldJob.outputs[0].sha256);
const voice=await get<Asset>('/assets/c9dd1736-b100-44e7-b9dd-8dbd897b3e65'),voiceResponse=await fetch(base+'/assets/'+voice.id+'/content',{headers:{cookie}});assert.equal(voiceResponse.status,200);assert.equal(digest(Buffer.from(await voiceResponse.arrayBuffer())),voice.sha256);
const anon=await fetch(base+'/studio/content/sources/'+sources[0].id);assert.equal(anon.status,401);checks.push({name:'anonymous source refused',status:401});
const db=new DatabaseSync(path.resolve('storage/digitalguide.sqlite'),{readOnly:true});let migrations:{name:string}[];try{migrations=db.prepare('SELECT name FROM schema_migrations ORDER BY name').all() as {name:string}[];assert.ok(migrations.some(r=>r.name==='025-content-sources.sql'));}finally{db.close();}
const binary=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),listeners=JSON.parse(execFileSync(binary,['-NoLogo','-NoProfile','-NonInteractive','-Command','Get-NetTCPConnection -State Listen -LocalPort 4301,5174 | Select-Object LocalAddress,LocalPort,OwningProcess | ConvertTo-Json -Compress'],{encoding:'utf8',windowsHide:true}));assert.equal(listeners.length,2);for(const l of listeners)assert.equal(l.LocalAddress,'127.0.0.1');
const result={result:'PASS_CONTENT_SOURCE_SUBMODULE_RUNTIME',verifiedAt:new Date().toISOString(),sessionHandle:process.env.PREVIEW_SESSION_HANDLE||null,preview:origin+'/studio/content',login:'林知 · 管理员；品牌与接待',sourceIds:state.sourceIds,briefId:brief.id,sourceKinds:sources.map(s=>s.kind),sourceChecks:sources.map(s=>({id:s.id,kind:s.kind,version:s.version,textSHA256:s.textSHA256,materialSHA256:s.materialSHA256})),checks,capabilities,migrations,listeners,originalCharacterVideo:{id:oldJob.id,size:motionBytes.length,sha256:digest(motionBytes)},originalSystemVoice:{id:voice.id,sha256:voice.sha256},scope:'内容来源与人工定位子模块，T24整体仍in_progress；未启用真实设备、模型或对外业务。'};fs.writeFileSync(path.join(folder,'preview.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({result:result.result,sources:sources.length,briefVersion:brief.version,checks:checks.length,schema:'025'}));
