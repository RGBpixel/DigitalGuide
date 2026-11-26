import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chromium,expect,type BrowserContext,type Page,type Response} from '@playwright/test';

export async function nativeLiveSpeechBrowser(input:{origin:string;folder:string;profileRoot:string;cookie:string;viewerCookie:string;sessionId:string;readyId:string;voiceId:string}){
 fs.mkdirSync(input.folder,{recursive:false});
 const contexts:BrowserContext[]=[],pages:Page[]=[],checks:string[]=[],samples:object[]=[],errors:string[]=[],apiErrors:object[]=[],expectedUnavailable:object[]=[],pending=new Set<Promise<void>>(),listeners=new Map<Page,(r:Response)=>void>(),unreadable=new Set<string>();
 let failure:unknown,observed=0,devices=0;
 const redact=(s:string)=>[input.cookie,input.viewerCookie].reduce((v,k)=>v.replaceAll(k,'[redacted]'),s);
 const known=(url:string)=>/^\/api\/v1\/(live-answers)(\/|$)/.test(url)||/^\/api\/v1\/live-sessions\/[^/]+\/(model-answers|peer-invites)(\/|$)/.test(url)||url==='/api/v1/studio/characters';
 async function page(name:string,cookie:string){
  const context=await chromium.launchPersistentContext(path.join(input.profileRoot,'native-speech-browser-'+name),{channel:'chrome',headless:true,viewport:{width:1440,height:1100}});contexts.push(context);
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


  const owner=await page('owner',input.cookie);await owner.goto(input.origin+'/live?session='+input.readyId);await expect(owner.getByRole('heading',{name:'系统播音',exact:true})).toBeVisible();
  await expect.poll(async()=>Boolean(await owner.getByLabel('节目系统语音试听',{exact:true}).count()||await owner.getByText('本场尚无播音方案。',{exact:true}).isVisible()),{timeout:45000}).toBe(true);
  if(!await owner.getByLabel('节目系统语音试听',{exact:true}).count()){await owner.getByLabel('直播系统声音',{exact:true}).selectOption(input.voiceId);await owner.getByLabel('已核对本场固定文字可用于播音',{exact:true}).check();await owner.getByRole('button',{name:'准备节目系统播音',exact:true}).click();}
  await expect(owner.getByText(/语音已准备/).first()).toBeVisible({timeout:45000});checks.push('built_form_actual_installed_voice_explicit_rights_prepares_persistent_program_audio');
  const prepare=owner.getByLabel('节目播音方案',{exact:true});if(await prepare.count()){const option=prepare.locator('option').filter({hasNotText:'不使用系统播音'});const values=await prepare.locator('option').evaluateAll(options=>options.map(o=>({value:(o as HTMLOptionElement).value,text:o.textContent})).filter(o=>o.value));assert.ok(values.length);await prepare.selectOption(values[0].value);void option;await owner.getByRole('button',{name:'预检连续媒体',exact:true}).click();await expect(owner.getByText('连续媒体预检可用',{exact:true})).toBeVisible();await owner.getByLabel('已确认所选背景、音乐和节目可用于本场本地合流',{exact:true}).check();await owner.getByRole('button',{name:'准备本场连续媒体',exact:true}).click();}
  await expect(owner.getByText(/已准备，等待开播/)).toBeVisible();await expect(owner.getByRole('button',{name:'开始本场本地试播',exact:true})).toBeVisible();await owner.reload();await expect(owner.getByText(/已准备，等待开播/)).toBeVisible();await owner.screenshot({path:path.join(input.folder,'speech-ready-desktop.png'),fullPage:true});checks.push('built_explicit_plan_selection_preflight_armed_output_reload_without_starting');
  await owner.goto(input.origin+'/live?session='+input.sessionId);await expect(owner.getByLabel('答复系统语音试听',{exact:true})).toBeVisible();await expect(owner.getByLabel('人工稿系统语音试听',{exact:true})).toBeVisible();await decoded(owner,'owner-actual-speech-recording');checks.push('built_actual_program_answer_manual_audio_and720p_archive_visible');
  const decodedWavs=await owner.evaluate(async id=>{const data=(await(await fetch('/api/v1/live-sessions/'+id+'/speech')).json()).data,values=[];for(const job of data.plans[0].jobs){if(!job.audioUrl||!job.wav)throw new Error('Original actual WAV missing');const r=await fetch(job.audioUrl);if(!r.ok)throw new Error('Actual WAV inaccessible');const bytes=await r.arrayBuffer(),sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join(''),context=new OfflineAudioContext(1,1,22050),audio=await context.decodeAudioData(bytes.slice(0)),pcm=audio.getChannelData(0);let energy=0;for(const sample of pcm)energy+=sample*sample;if(sha256!==job.wav.sha256||audio.sampleRate!==22050||audio.numberOfChannels!==1||Math.sqrt(energy/pcm.length)<.001)throw new Error('Actual WAV bytes or decoded samples differ');values.push({kind:job.kind,sha256,sampleRate:audio.sampleRate,channels:audio.numberOfChannels,durationMs:audio.duration*1000,rms:Math.sqrt(energy/pcm.length)});}return values;},input.sessionId);assert.deepEqual(decodedWavs.map(v=>v.kind).sort(),['answer','cue','manual']);samples.push(...decodedWavs);checks.push('browser_offline_actual_three_wav_sha_and_nonzero_pcm_decoding_without_device_playback');
  await owner.screenshot({path:path.join(input.folder,'speech-recorded-desktop.png'),fullPage:true});await owner.getByLabel('本地节目实际归档',{exact:true}).screenshot({path:path.join(input.folder,'speech-archive-decoded.png')});await mobile(owner,'speech390');await owner.screenshot({path:path.join(input.folder,'speech-recorded-mobile.png'),fullPage:true});await owner.reload();await expect(owner.getByLabel('人工稿系统语音试听',{exact:true})).toBeVisible();checks.push('built_saved_audio_and_playback_metadata_reload_and390px_layout');
  const viewer=await page('viewer',input.viewerCookie);await viewer.goto(input.origin+'/live?session='+input.sessionId);await mobile(viewer,'speech-readonly390');await decoded(viewer,'readonly-actual-spoken-recording390');await expect(viewer.getByLabel('答复系统语音试听',{exact:true})).toBeVisible();for(const name of['准备节目系统播音','明确播出此实际语音','撤回此方案及其媒体用途','撤回此语音及其媒体用途','创建拆条工程'])await expect(viewer.getByRole('button',{name,exact:true})).toHaveCount(0);await viewer.screenshot({path:path.join(input.folder,'speech-readonly-mobile.png'),fullPage:true});checks.push('built_readonly390px_actual_audio_video_and_absent_write_controls');
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
