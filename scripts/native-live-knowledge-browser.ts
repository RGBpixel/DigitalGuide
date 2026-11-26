import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chromium,expect,type BrowserContext,type Page,type Response} from '@playwright/test';

export async function nativeLiveKnowledgeBrowser(input:{origin:string;folder:string;profileRoot:string;cookie:string;viewerCookie:string;sessionId:string;timelineId:string;profileId:string}){
 fs.mkdirSync(input.folder,{recursive:false});
 const contexts:BrowserContext[]=[],pages:Page[]=[],checks:string[]=[],samples:object[]=[],errors:string[]=[],apiErrors:object[]=[],expectedUnavailable:object[]=[],pending=new Set<Promise<void>>(),listeners=new Map<Page,(r:Response)=>void>(),unreadable=new Set<string>();
 let failure:unknown,observed=0,devices=0;
 const redact=(s:string)=>[input.cookie,input.viewerCookie].reduce((v,k)=>v.replaceAll(k,'[redacted]'),s);
 const known=(url:string)=>/^\/api\/v1\/(live-answers|live-speech)(\/|$)/.test(url)||/^\/api\/v1\/live-sessions\/[^/]+\/(speech|model-answers|peer-invites)(\/|$)/.test(url);
 async function page(name:string,cookie:string){
  const context=await chromium.launchPersistentContext(path.join(input.profileRoot,'native-knowledge-browser-'+name),{channel:'chrome',headless:true,viewport:{width:1440,height:1100}});contexts.push(context);
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

  const owner=await page('owner',input.cookie);await owner.goto(input.origin+'/knowledge');await expect(owner.getByRole('heading',{name:'知识与场景应用',exact:true})).toBeVisible();
  const savedCollection=owner.getByLabel('当前知识库').locator('option').filter({hasText:'界面原创知识库 · 公开'});
  if(await savedCollection.count()){await owner.getByLabel('当前知识库').selectOption((await savedCollection.first().getAttribute('value'))!);}else{await owner.getByRole('button',{name:'新建知识库',exact:true}).click();await owner.getByLabel('知识库名称',{exact:true}).fill('界面原创知识库');await owner.getByRole('group',{name:'适用场景',exact:true}).getByLabel('线上直播',{exact:true}).check();await owner.getByRole('button',{name:'保存知识库范围',exact:true}).click();}
  await expect.poll(()=>owner.getByLabel('当前知识库').evaluate((e:HTMLSelectElement)=>e.selectedOptions[0]?.textContent)).toBe('界面原创知识库 · 公开');checks.push('built_form_creates_scoped_public_live_collection');

  await expect.poll(async()=>Boolean(await owner.locator('.knowledge-doc-list button').count()||await owner.getByText('先新增资料，经核对发布后才会参与回答。',{exact:true}).isVisible())).toBe(true);
  const savedDocument=owner.locator('.knowledge-doc-list button').filter({hasText:'界面原文展册'});
  if(await savedDocument.count()){await savedDocument.first().click();await expect(owner.getByRole('heading',{name:'界面原文展册',exact:true})).toBeVisible();}else{
   await owner.getByRole('button',{name:'新增资料草稿',exact:true}).click();await owner.getByLabel('资料标题',{exact:true}).fill('界面原文展册');await owner.getByLabel('正文',{exact:true}).fill('界面原创展册放在三号展柜，仅供合成演示。');await owner.getByLabel('来源名称',{exact:true}).fill('界面原创合成手册');await owner.getByRole('button',{name:'保存待审草稿',exact:true}).click();await expect(owner.getByRole('heading',{name:'界面原文展册',exact:true})).toBeVisible();
  }
  if(await owner.getByRole('button',{name:'发布选中版本',exact:true}).count()){await owner.getByLabel('检索问题',{exact:true}).fill('界面原创展册');await owner.getByRole('button',{name:'检索已发布资料',exact:true}).click();await expect(owner.getByText('当前权限和场景下没有匹配的已发布资料。',{exact:true})).toBeVisible();await owner.getByLabel('我已核对正文、来源及当前知识库的可见范围',{exact:true}).check();await owner.getByRole('button',{name:'发布选中版本',exact:true}).click();}
  await expect(owner.getByRole('button',{name:'撤回当前发布版',exact:true})).toBeVisible();await owner.getByLabel('检索问题',{exact:true}).fill('界面原创展册');await owner.getByRole('button',{name:'检索已发布资料',exact:true}).click();await expect(owner.locator('.knowledge-snippet').first()).toContainText('三号展柜');checks.push('built_draft_excluded_publish_builds_search_index_and_real_source_citation');
  await owner.getByRole('button',{name:'场景应用配置',exact:true}).click();const savedApp=owner.locator('.knowledge-doc-list button').filter({hasText:'界面原创直播应用'});if(await savedApp.count()){await savedApp.first().click();}else{await owner.getByLabel('应用名称',{exact:true}).fill('界面原创直播应用');await owner.getByLabel('独立频道标识',{exact:true}).fill('gui-original-live');await owner.getByLabel('行业配置向导').selectOption('custom');await owner.getByLabel('运行场景').selectOption('live');await owner.getByLabel('统一角色').selectOption(input.profileId);await owner.getByLabel('界面原创知识库 · 公开',{exact:true}).check();await owner.getByRole('button',{name:'保存场景配置',exact:true}).click();}await expect(owner.getByRole('heading',{name:/^编辑场景应用 · v[12]$/})).toBeVisible();await owner.getByLabel('场景试问',{exact:true}).fill('界面原创展册');await owner.getByRole('button',{name:'预览模拟回答',exact:true}).click();await expect(owner.locator('.knowledge-preview')).toContainText('三号展柜');await expect(owner.getByLabel('知识来源',{exact:true})).toContainText('界面原文展册');checks.push('built_saved_public_scene_profile_and_knowledge_preview');
  if(await owner.getByRole('heading',{name:'编辑场景应用 · v1',exact:true}).count()){await owner.getByLabel('开场问候').fill('界面修订的原创问候');await owner.getByRole('button',{name:'保存场景配置',exact:true}).click();}await expect(owner.getByRole('heading',{name:'编辑场景应用 · v2',exact:true})).toBeVisible();await owner.reload();await owner.getByRole('button',{name:'场景应用配置',exact:true}).click();await owner.locator('.knowledge-doc-list button').filter({hasText:'界面原创直播应用'}).click();await expect(owner.getByRole('heading',{name:'编辑场景应用 · v2',exact:true})).toBeVisible();await expect(owner.getByLabel('开场问候')).toHaveValue('界面修订的原创问候');await owner.screenshot({path:path.join(input.folder,'knowledge-scene-desktop.png'),fullPage:true});await mobile(owner,'scene390');await owner.screenshot({path:path.join(input.folder,'knowledge-scene-mobile.png'),fullPage:true});checks.push('built_scene_cas_revision_reload_persistence_and390px_layout');
  await owner.setViewportSize({width:1440,height:1100});await owner.goto(input.origin+'/live?session='+input.sessionId);const q=owner.locator('.live-question').filter({hasText:'界面验证虚构观众'});await expect(q).toBeVisible();await q.getByRole('button',{name:'加入问答队列',exact:true}).click();await q.getByRole('button',{name:'准备待播回复',exact:true}).click();await expect(q.locator('.live-answer')).toContainText('一号展柜');await expect(q.locator('.live-answer')).toContainText('公开知识模拟回复');await q.locator('.live-answer summary').click();await expect(q.locator('.live-answer')).toContainText('原创合成服务手册');await q.getByLabel('插播时长（秒）',{exact:true}).fill('1');await q.getByRole('button',{name:'插播此模拟回复',exact:true}).click();await expect(q).toContainText('回复已播完',{timeout:20000});await owner.screenshot({path:path.join(input.folder,'knowledge-live-answer.png'),fullPage:true});await owner.getByRole('button',{name:'立即停止本场',exact:true}).click();checks.push('built_live_moderation_public_citation_prepare_play_and_mainline_return');
  await owner.goto(input.origin+'/live?session='+input.timelineId);await decoded(owner,'owner-knowledge-archive');await owner.getByLabel('本地节目实际归档',{exact:true}).screenshot({path:path.join(input.folder,'knowledge-timeline-decoded.png')});checks.push('built_actual_knowledge_timeline_mp4_decodes720p');
  const viewer=await page('viewer',input.viewerCookie);await viewer.goto(input.origin+'/knowledge');await expect(viewer.getByRole('heading',{name:'知识管理需要编辑权限',exact:true})).toBeVisible();await expect(viewer.getByRole('button',{name:'新建知识库',exact:true})).toHaveCount(0);await mobile(viewer,'readonly-knowledge390');await viewer.screenshot({path:path.join(input.folder,'knowledge-readonly-mobile.png'),fullPage:true});await viewer.goto(input.origin+'/live?session='+input.timelineId);await decoded(viewer,'readonly-knowledge-archive390');for(const name of['创建拆条工程','撤回归档及派生用途','立即停止本场'])await expect(viewer.getByRole('button',{name,exact:true})).toHaveCount(0);checks.push('built_viewer390px_source_management_denied_archive_playback_and_no_write_controls');
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
