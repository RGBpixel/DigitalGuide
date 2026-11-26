import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chromium,expect,type BrowserContext,type Page,type Response} from '@playwright/test';

export async function nativeLiveTerminalBrowser(input:{origin:string;folder:string;profileRoot:string;cookie:string;viewerCookie:string;sessionId:string}){
 fs.mkdirSync(input.folder,{recursive:false});
 const contexts:BrowserContext[]=[],pages:Page[]=[],checks:string[]=[],samples:object[]=[],errors:string[]=[],apiErrors:object[]=[],expectedUnavailable:object[]=[],pending=new Set<Promise<void>>(),listeners=new Map<Page,(r:Response)=>void>(),unreadable=new Set<string>();
 let failure:unknown,observed=0,devices=0,clipProjectId='';
 const redact=(s:string)=>[input.cookie,input.viewerCookie].reduce((v,k)=>v.replaceAll(k,'[redacted]'),s);
 const known=(url:string)=>/^\/api\/v1\/(scene-apps|live-answers|live-speech)(\/|$)/.test(url)||/^\/api\/v1\/live-sessions\/[^/]+\/(speech|model-answers|peer-invites)(\/|$)/.test(url);
 async function page(name:string,cookie:string){
  const context=await chromium.launchPersistentContext(path.join(input.profileRoot,'native-terminal-browser-'+name),{channel:'chrome',headless:true,viewport:{width:1440,height:1100}});contexts.push(context);
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
  await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>{if(v.seeking||v.readyState<2)return false;const c=document.createElement('canvas');c.width=1280;c.height=720;const g=c.getContext('2d')!;g.drawImage(v,0,0);const pixel=g.getImageData(640,360,1,1).data;return pixel[2]>pixel[0]+60;})).toBe(true);
  samples.push({label,...await video.evaluate((v:HTMLVideoElement)=>{const c=document.createElement('canvas');c.width=1280;c.height=720;const g=c.getContext('2d')!;g.drawImage(v,0,0);return{width:v.videoWidth,height:v.videoHeight,decodedFrames:v.getVideoPlaybackQuality().totalVideoFrames,currentTime:v.currentTime,pixel:[...g.getImageData(640,360,1,1).data]};})});
 }
 async function mobile(p:Page,label:string){
  await p.setViewportSize({width:390,height:844});await expect.poll(()=>p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await expect.poll(()=>p.locator('.sidebar').evaluate(e=>e.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
  samples.push({label,viewport:390,sidebar:await p.locator('.sidebar').evaluate(e=>({right:e.getBoundingClientRect().right,open:e.classList.contains('open')}))});
 }
 try{
  const owner=await page('owner',input.cookie);await owner.goto(input.origin+'/live?session='+input.sessionId);await expect(owner.getByText('本场已达到600段时间轴容量并停止。归档以已保存片段为准，请新建场次继续；未记录的尾段不会补造。',{exact:true})).toBeVisible();checks.push('built_terminal_capacity_reason_and_next_step_visible');
  await expect(owner.getByRole('heading',{name:'本地节目时间轴归档',exact:true})).toBeVisible();await expect(owner.getByText(/按保存的播出时间轴生成实际720p文件/)).toBeVisible();await decoded(owner,'owner-initial');checks.push('built_timeline_mode_explanation_and_actual720p_decoded_frame');
  await owner.getByLabel('拆条名称',{exact:true}).fill('界面创建的时间轴拆条');await owner.getByLabel('区间时长（秒）',{exact:true}).fill('1');await owner.getByRole('button',{name:'创建拆条工程',exact:true}).click();
  const link=owner.getByRole('link',{name:'打开拆条工程',exact:true});await expect(link).toBeVisible();clipProjectId=(await link.getAttribute('href'))!.split('/').at(-1)!;assert.match(clipProjectId,/^[a-f0-9-]{36}$/);checks.push('built_form_creates_editable_clip_project');
  await owner.reload();await decoded(owner,'owner-reloaded');await owner.screenshot({path:path.join(input.folder,'terminal-desktop.png'),fullPage:true});await owner.getByLabel('本地节目实际归档',{exact:true}).screenshot({path:path.join(input.folder,'terminal-decoded.png')});checks.push('built_reload_retains_real_recording_metadata_and_file');
  await mobile(owner,'owner390');await decoded(owner,'owner390');await owner.screenshot({path:path.join(input.folder,'terminal-mobile.png'),fullPage:true});
  const viewer=await page('viewer',input.viewerCookie);await viewer.goto(input.origin+'/live?session='+input.sessionId);await mobile(viewer,'viewer390');await decoded(viewer,'viewer390');
  for(const name of['创建拆条工程','撤回归档及派生用途','取消本次归档','立即停止本场'])await expect(viewer.getByRole('button',{name,exact:true})).toHaveCount(0);
  await viewer.screenshot({path:path.join(input.folder,'terminal-readonly-mobile.png'),fullPage:true});checks.push('built_owner_readonly390px_playback_permissions_without_horizontal_overflow');
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
 const report={result:failure?'FAIL':'PASS',error:failure instanceof Error?redact(failure.stack??failure.message):failure?redact(String(failure)):null,checks,samples,errors,apiErrors,expectedUnavailable,devices,observedBrowserProcesses:observed,browserClosed:true,clipProjectId,remoteCaptureVerified:false};
 fs.writeFileSync(path.join(input.folder,'browser.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});if(failure)throw failure;return report;
}
