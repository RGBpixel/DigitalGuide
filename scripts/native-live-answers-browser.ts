import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chromium,expect,type BrowserContext,type Page,type Response} from '@playwright/test';

export async function nativeLiveAnswerBrowser(input:{origin:string;folder:string;profileRoot:string;cookie:string;viewerCookie:string;sessionId:string;readyId:string}){
 fs.mkdirSync(input.folder,{recursive:false});
 const contexts:BrowserContext[]=[],pages:Page[]=[],checks:string[]=[],samples:object[]=[],errors:string[]=[],apiErrors:object[]=[],expectedUnavailable:object[]=[],pending=new Set<Promise<void>>(),listeners=new Map<Page,(r:Response)=>void>(),unreadable=new Set<string>();
 let failure:unknown,observed=0,devices=0;
 const redact=(s:string)=>[input.cookie,input.viewerCookie].reduce((v,k)=>v.replaceAll(k,'[redacted]'),s);
 const known=(url:string)=>/^\/api\/v1\/live-sessions\/[^/]+\/peer-invites(\/|$)/.test(url)||url==='/api/v1/studio/characters';
 async function page(name:string,cookie:string){
  const context=await chromium.launchPersistentContext(path.join(input.profileRoot,'native-model-browser-'+name),{channel:'chrome',headless:true,viewport:{width:1440,height:1100}});contexts.push(context);
  const at=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,at),value:cookie.slice(at+1),url:input.origin,httpOnly:true,sameSite:'Strict'}]);
  await context.addInitScript({content:"globalThis.__timelineDevices=0;if(navigator.mediaDevices)for(const key of ['getUserMedia','getDisplayMedia'])Object.defineProperty(navigator.mediaDevices,key,{configurable:true,value:()=>{globalThis.__timelineDevices++;return Promise.reject(new Error('Physical devices disabled for private verification'));}});"});
  const p=await context.newPage();pages.push(p);p.on('pageerror',e=>errors.push(redact(e.message)));
  const listener=(r:Response)=>{
   const url=new URL(r.url());if(url.origin!==input.origin||!url.pathname.startsWith('/api/v1/')||r.status()<400)return;
   const task=(async()=>{let code='';try{code=(await r.json()).error?.code??'';}catch{/* A response aborted by navigation is independently rechecked below. */}
    if(r.status()===503&&known(url.pathname)&&r.request().method()==='GET'&&(!code||code==='PG_MODULE_NOT_MIGRATED')){if(!code)unreadable.add(url.pathname+url.search);else expectedUnavailable.push({path:url.pathname,code,status:503});}
    else apiErrors.push({path:url.pathname,status:r.status(),code});
   })().finally(()=>pending.delete(task));pending.add(task);
  };listeners.set(p,listener);p.on('response',listener);return p;
 }
 async function decoded(p:Page,label:string){
  const video=p.getByLabel('本地节目实际归档',{exact:true});await expect(video).toBeVisible();await video.evaluate(async(v:HTMLVideoElement)=>{v.muted=true;await v.play();});
  await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>v.videoWidth===1280&&v.videoHeight===720&&v.getVideoPlaybackQuality().totalVideoFrames>=3&&v.readyState>=2),{timeout:20000}).toBe(true);
  await video.evaluate((v:HTMLVideoElement)=>{v.pause();v.currentTime=.8;});
  await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>{if(v.seeking||v.readyState<2)return false;const c=document.createElement('canvas');c.width=1280;c.height=720;const g=c.getContext('2d')!;g.drawImage(v,0,0);const pixel=g.getImageData(40,300,1,1).data;return pixel[2]>pixel[0]+60;})).toBe(true);
  samples.push({label,...await video.evaluate((v:HTMLVideoElement)=>{const c=document.createElement('canvas');c.width=1280;c.height=720;const g=c.getContext('2d')!;g.drawImage(v,0,0);return{width:v.videoWidth,height:v.videoHeight,decodedFrames:v.getVideoPlaybackQuality().totalVideoFrames,currentTime:v.currentTime,pixel:[...g.getImageData(40,300,1,1).data]};})});
 }
 async function mobile(p:Page,label:string){
  await p.setViewportSize({width:390,height:844});await expect.poll(()=>p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await expect.poll(()=>p.locator('.sidebar').evaluate(e=>e.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
  samples.push({label,viewport:390,sidebar:await p.locator('.sidebar').evaluate(e=>({right:e.getBoundingClientRect().right,open:e.classList.contains('open')}))});
 }
 try{


  const owner=await page('owner',input.cookie);await owner.goto(input.origin+'/live?session='+input.readyId);await expect(owner.getByRole('heading',{name:'本机模型问答',exact:true})).toBeVisible();
  const ready=await owner.evaluate(async id=>(await(await fetch('/api/v1/live-sessions/'+id+'/model-answers')).json()).data,input.readyId);if(!ready.configuration.enabled){await owner.getByText('设置本场模型问答',{exact:true}).click();await owner.getByLabel('启用本场实际本机模型',{exact:true}).check();await owner.getByLabel('自动为已审核问题生成候选',{exact:true}).uncheck();await owner.getByLabel('模型问答提示语言',{exact:true}).selectOption('en-US');await expect(owner.getByRole('button',{name:'应用本场模型设置',exact:true})).toBeEnabled({timeout:45000});await owner.getByRole('button',{name:'应用本场模型设置',exact:true}).click();}
  await expect(owner.getByText(/本场已启用实际本机模型/)).toBeVisible();await owner.reload();await expect(owner.getByText(/本场已启用实际本机模型/)).toBeVisible();const configured=await owner.evaluate(async id=>(await(await fetch('/api/v1/live-sessions/'+id+'/model-answers')).json()).data,input.readyId);assert.equal(configured.configuration.version,1);assert.equal(configured.configuration.autoDraft,false);assert.equal(configured.jobs.length,0);checks.push('built_explicit_real_model_optin_configuration_reload_without_candidates_or_start');await owner.screenshot({path:path.join(input.folder,'model-ready-desktop.png'),fullPage:true});
  await owner.goto(input.origin+'/live?session='+input.sessionId);await expect(owner.getByText('本机模型答复（主持已确认）',{exact:true})).toHaveCount(2,{timeout:45000});const models=await owner.evaluate(async id=>(await(await fetch('/api/v1/live-sessions/'+id+'/model-answers')).json()).data,input.sessionId);assert.equal(models.jobs.length,2);assert.equal(models.jobs.filter((j:{adopted:boolean})=>j.adopted).length,2);for(const j of models.jobs){assert.ok(j.evidence?.compiledWorkerEntry&&j.evidence?.offlineCpu&&j.result?.supported&&j.references.length);assert.ok(j.question.includes(j.evidence.effectiveQuestion));}samples.push({actualModelJobs:models.jobs.map((j:{id:string;attempts:number;adopted:boolean;evidence:{elapsedMs:number;inputSHA256:string}})=>({id:j.id,attempts:j.attempts,adopted:j.adopted,elapsedMs:j.evidence.elapsedMs,inputSHA256:j.evidence.inputSHA256}))});checks.push('built_same_prepared_continuous_session_two_actual_model_receipts_two_reviewed_adoptions');
  const panel=owner.locator('section').filter({has:owner.getByRole('heading',{name:'本机模型问答',exact:true})}).last(),citations=panel.locator('summary').filter({hasText:/^(公开知识|固定商品资料) ·/});const citationCount=await citations.count();assert.ok(citationCount>=2);for(let i=0;i<citationCount;i++)await citations.nth(i).click();await expect(panel.getByText('固定来源段落',{exact:true})).toHaveCount(citationCount);const receipts=panel.getByText('本机模型与生成回执',{exact:true});await expect(receipts).toHaveCount(2);for(let i=0;i<2;i++)await receipts.nth(i).click();await expect(panel.getByText(/Qwen3-4B-Instruct-2507-Q8_0 · E5语义检索/)).toHaveCount(2);checks.push('built_original_question_literal_query_and_actual_fixed_source_paragraphs_and_engine_receipts');
  await expect(owner.getByLabel('答复系统语音试听',{exact:true})).toHaveCount(2);const wavs=await owner.evaluate(async id=>{const speech=(await(await fetch('/api/v1/live-sessions/'+id+'/speech')).json()).data,values=[];for(const j of speech.plans[0].jobs.filter((j:{kind:string})=>j.kind==='answer')){if(!j.audioUrl||!j.wav)throw new Error('Actual model answer WAV missing');const r=await fetch(j.audioUrl);if(!r.ok)throw new Error('Actual WAV unavailable');const bytes=await r.arrayBuffer(),sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join(''),audio=await new OfflineAudioContext(1,1,22050).decodeAudioData(bytes.slice(0)),pcm=audio.getChannelData(0);let energy=0;for(const v of pcm)energy+=v*v;const rms=Math.sqrt(energy/pcm.length);if(sha256!==j.wav.sha256||rms<.001||audio.sampleRate!==22050)throw new Error('Actual WAV differs from immutable receipt');values.push({id:j.id,sha256,rms,durationMs:audio.duration*1000});}return values;},input.sessionId);assert.equal(wavs.length,2);samples.push(...wavs);checks.push('browser_two_actual_grounded_answer_wav_sha_and_offline_nonzero_pcm_without_devices');
  await decoded(owner,'owner-actual-model-recording');await owner.screenshot({path:path.join(input.folder,'model-recorded-desktop.png'),fullPage:true});await owner.getByLabel('本地节目实际归档',{exact:true}).screenshot({path:path.join(input.folder,'model-archive-decoded.png')});await mobile(owner,'model390');await owner.screenshot({path:path.join(input.folder,'model-recorded-mobile.png'),fullPage:true});await owner.reload();await expect(owner.getByText('本机模型答复（主持已确认）',{exact:true})).toHaveCount(2);checks.push('built_actual720p_archive_and_two_reviewed_answers_persist_on_reload_and390px');
  const viewer=await page('viewer',input.viewerCookie);await viewer.goto(input.origin+'/live?session='+input.sessionId);await mobile(viewer,'model-readonly390');await decoded(viewer,'readonly-actual-model-recording');await expect(viewer.getByText('本机模型答复（主持已确认）',{exact:true})).toHaveCount(2);for(const name of['应用本场模型设置','按当前场控准备模型候选','确认采用为待播答复','停止此模型生成','重试此模型任务','撤回模型答复及其媒体用途'])await expect(viewer.getByRole('button',{name,exact:true})).toHaveCount(0);await viewer.screenshot({path:path.join(input.folder,'model-readonly-mobile.png'),fullPage:true});checks.push('built_readonly390_actual_model_receipts_audio_video_without_write_controls');
  for(const p of pages)p.off('response',listeners.get(p)!);await Promise.allSettled([...pending]);
  for(const url of unreadable){const r=await owner.request.get(input.origin+url);assert.equal(r.status(),503);assert.equal((await r.json()).error.code,'PG_MODULE_NOT_MIGRATED');expectedUnavailable.push({path:url,status:503,code:'PG_MODULE_NOT_MIGRATED',independentReadOnlyCheck:true});}
  for(const p of pages)devices+=await p.evaluate(()=>Reflect.get(window,'__timelineDevices')as number);assert.equal(devices,0);assert.deepEqual(errors,[]);assert.deepEqual(apiErrors,[]);checks.push('unported_panels_explicit503_no_device_capture_or_unexpected_errors');
 }catch(e){failure=new Error(redact(e instanceof Error?e.message:String(e)));for(const[i,p]of pages.entries())await p.screenshot({path:path.join(input.folder,'failure-'+i+'.png'),fullPage:true}).catch(()=>{});}
 finally{
  try{if(contexts.length){
   const roots=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$taskRoot=$env:DG_TIMELINE_BROWSER_ROOT;ConvertTo-Json -InputObject @(Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\"|Where-Object {$_.CommandLine -and $_.CommandLine.IndexOf($taskRoot,[StringComparison]::OrdinalIgnoreCase) -ge 0}|ForEach-Object {[int]$_.ProcessId}) -Compress"],{windowsHide:true,encoding:'utf8',env:{...process.env,DG_TIMELINE_BROWSER_ROOT:input.profileRoot}}));assert.ok(roots.length);
   fs.writeFileSync(path.join(input.folder,'browser-roots.json'),JSON.stringify(roots),{flag:'wx'});execFileSync('powershell.exe',['-NoProfile','-File','scripts/postgres-media-process-audit.ps1','-Mode','observe','-InputPath',path.join(input.folder,'browser-roots.json'),'-OutputPath',path.join(input.folder,'observed-browser-processes.json'),'-Port','0'],{windowsHide:true});observed=JSON.parse(fs.readFileSync(path.join(input.folder,'observed-browser-processes.json'),'utf8').replace(/^\uFEFF/,'')).processes.length;
  }}catch(e){failure??=e;}
  for(const context of contexts)await context.close();
  try{if(observed)execFileSync('powershell.exe',['-NoProfile','-File','scripts/postgres-media-process-audit.ps1','-Mode','closed','-InputPath',path.join(input.folder,'observed-browser-processes.json'),'-OutputPath',path.join(input.folder,'browser-cleanup.json'),'-Port','0'],{windowsHide:true});}catch(e){failure??=e;}
 }
 const report={result:failure?'FAIL':'PASS',error:failure instanceof Error?redact(failure.stack??failure.message):failure?redact(String(failure)):null,checks,samples,errors,apiErrors,expectedUnavailable,devices,observedBrowserProcesses:observed,browserClosed:true,remoteCaptureVerified:false};
 fs.writeFileSync(path.join(input.folder,'browser.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});if(failure)throw failure;return report;
}
