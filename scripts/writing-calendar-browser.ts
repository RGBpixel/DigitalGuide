import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import {spawn,type ChildProcess} from 'node:child_process';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {chromium,expect} from '@playwright/test';
import type {ContentWritingJob} from '@digitalguide/contracts';
import {fixtureIds as f} from '../packages/test-fixtures/src/seed.js';

const mainOrigin='http://127.0.0.1:5174',base='http://127.0.0.1:4301',built=process.argv.includes('--built'),folder=path.resolve(process.env.WRITING_CALENDAR_BROWSER_DIR||'docs/evidence/T24/writing-calendar/runtime/browser-release');
const state=JSON.parse(fs.readFileSync('storage/writing-calendar-preview-state.json','utf8')) as {phase:string;ids:Record<string,string>;stableJob:ContentWritingJob},old=JSON.parse(fs.readFileSync('storage/writing-review-preview-state.json','utf8')) as {ids:Record<string,string>;stable:{job:ContentWritingJob}};
assert.equal(state.phase,'complete');assert.ok(process.env.PREVIEW_SESSION_HANDLE);fs.mkdirSync(folder,{recursive:true});assert.ok(!fs.existsSync(path.join(folder,'browser.json')));
function business(){const db=new DatabaseSync('storage/digitalguide.sqlite',{readOnly:true});try{return Object.fromEntries([
  ['newJob',db.prepare('SELECT * FROM studio_content_writing_jobs WHERE id=?').all(state.ids.job)],
  ['oldJob',db.prepare('SELECT * FROM studio_content_writing_jobs WHERE id=?').all(old.ids.job)],
  ['source',db.prepare('SELECT * FROM studio_content_sources WHERE id=?').all(state.ids.source)],
  ['brief',db.prepare('SELECT * FROM studio_content_briefs WHERE id=?').all(state.ids.brief)],
  ['oldDraft',db.prepare('SELECT * FROM studio_content_drafts WHERE id=?').all(old.ids.draft)],
  ['oldProject',db.prepare('SELECT * FROM studio_projects WHERE id=?').all(old.ids.project)],
  ['oldSpeech',db.prepare('SELECT * FROM studio_speech_jobs WHERE id=?').all(old.ids.speech)],
  ['oldExport',db.prepare('SELECT * FROM studio_exports WHERE id=?').all(old.ids.video)],
  ['adoptions',db.prepare('SELECT * FROM studio_content_writing_adoptions WHERE job_id IN (?,?) ORDER BY job_id,variant_index').all(state.ids.job,old.ids.job)],
]);}finally{db.close();}}
const before=business(),login=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{Origin:mainOrigin,'Content-Type':'application/json'},body:JSON.stringify({accountId:f.adminA})});assert.equal(login.status,200);
const cookie=login.headers.getSetCookie()[0].split(';')[0],browser=await chromium.launch({channel:'chrome',headless:true});
const checks:string[]=[],errors:string[]=[],writes:string[]=[],apiErrors:object[]=[],bundles:{file:string;sha256:string}[]=[];let server:ChildProcess|undefined,origin=mainOrigin,failure:unknown,devices=-1;
try{
  if(built){
    const port=await new Promise<number>((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=(s.address()as net.AddressInfo).port;s.close(()=>resolve(p));});});origin='http://127.0.0.1:'+port;
    const fd=fs.openSync(path.join(folder,'built-server.log'),'wx');try{server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--config','apps/web/vite.config.ts','--host','127.0.0.1','--port',String(port),'--strictPort'],{env:{...process.env,API_PORT:'4301',WEB_ORIGIN:origin},windowsHide:true,stdio:['ignore',fd,fd]});}finally{fs.closeSync(fd);}
    await expect.poll(async()=>{try{return(await fetch(origin)).status;}catch{return 0;}},{timeout:30000}).toBe(200);
  }
  const context=await browser.newContext({baseURL:origin,viewport:{width:1440,height:1100}});
  await context.addCookies([{name:'dg_session',value:cookie.slice('dg_session='.length),url:origin,httpOnly:true,sameSite:'Lax'}]);
  await context.addInitScript({content:"window.__calendarDevices=0;for(const method of ['getUserMedia','getDisplayMedia'])Object.defineProperty(navigator.mediaDevices,method,{configurable:true,value:()=>{window.__calendarDevices++;return Promise.reject(new Error('No physical devices'));}});"});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.url().includes('/api/v1/')&&!['GET','HEAD','OPTIONS'].includes(r.method()))writes.push(r.method()+' '+new URL(r.url()).pathname);});
  page.on('response',r=>{const u=new URL(r.url());if(u.pathname.includes('/api/v1/')&&r.status()>=400)apiErrors.push({path:u.pathname,status:r.status()});if(built&&u.origin===origin&&u.pathname.startsWith('/assets/')&&u.pathname.endsWith('.js')){const file='dist/web'+u.pathname;if(fs.existsSync(file)&&!bundles.some(b=>b.file===file))bundles.push({file,sha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex')});}});
  await page.goto('/studio/drafts?writing='+state.ids.job);
  for(const number of [1,2])await expect(page.getByRole('article',{name:'模型候选 '+number,exact:true})).toBeVisible();
  const current=await page.evaluate(async id=>(await(await fetch('/api/v1/studio/content/writing/jobs/'+id)).json()).data,state.ids.job) as ContentWritingJob;
  assert.deepEqual(current,state.stableJob);assert.equal(current.adoptions.length,0);assert.equal(current.evidence!.engine.policy,'source-script-reviewed-v3');checks.push('same_saved_actual_v3_two_candidates_with_no_automatic_adoption');
  await page.getByText('逐段模型核对与局部修订',{exact:true}).click();
  await expect(page.getByText(/开放安排已增加开放日、闭馆例外和时间起止顺序/)).toBeVisible();
  await expect(page.getByText(/模型自检仍可能误判/)).toBeVisible();checks.push('current_calendar_rule_scope_and_manual_review_limits_visible');
  const review=page.getByText('逐段模型核对与局部修订',{exact:true}).locator('..');await review.screenshot({path:path.join(folder,'review-details.png')});
  if(current.evidence!.review!.patch){await page.getByText('查看本次片段替换',{exact:true}).click();for(const patch of current.evidence!.review!.patch.sectionPatches)for(const edit of patch.edits)await expect(page.getByText('原片段：'+edit.oldText,{exact:true}).first()).toBeVisible();}
  checks.push('actual_model_opinions_and_optional_actual_patch_displayed_without_relabeling');
  await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(folder,'desktop-viewport.png')});
  await page.goto('/studio/drafts?writing='+old.ids.job+'&draft='+old.ids.draft);
  await expect(page.getByText('本机模型起稿 · 可人工修订',{exact:true})).toBeVisible();
  assert.deepEqual(await page.evaluate(async id=>(await(await fetch('/api/v1/studio/content/writing/jobs/'+id)).json()).data,old.ids.job),old.stable.job);
  await page.getByText('逐段模型核对与局部修订',{exact:true}).click();await expect(page.getByText(/开放安排已增加开放日、闭馆例外和时间起止顺序/)).toHaveCount(0);checks.push('original_v2_job_draft_and_version_specific_review_remain_readable_and_unchanged');
  await page.goto('/studio/drafts?writing='+state.ids.job);await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole('article',{name:'模型候选 1',exact:true})).toBeVisible();
  await expect.poll(()=>page.locator('.sidebar').evaluate(e=>e.getBoundingClientRect().right)).toBeLessThanOrEqual(1);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(folder,'mobile-viewport.png')});checks.push('390_pixel_mobile_layout_has_no_horizontal_overflow');
  devices=await page.evaluate(()=>Number(Reflect.get(window,'__calendarDevices')));assert.equal(devices,0);assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.deepEqual(apiErrors,[]);assert.deepEqual(business(),before);if(built)assert.ok(bundles.length);checks.push('zero_device_capture_errors_api_errors_business_writes_and_all_bound_business_rows_unchanged');
}catch(error){failure=error;}finally{
  await browser.close();if(server&&server.exitCode===null&&server.signalCode===null){const closed=new Promise<void>(resolve=>server!.once('close',()=>resolve()));server.kill();await closed;}
}
fs.writeFileSync(path.join(folder,'browser.json'),JSON.stringify({result:failure?'FAIL':'PASS',checkedAt:new Date().toISOString(),previewSession:process.env.PREVIEW_SESSION_HANDLE,built,readOnly:true,checks,devices,errors,writes,apiErrors,bundles,ownedBrowserAndPreviewServerClosed:true,generalFactualQualityVerified:false,actualAvatarOrVoiceClone:false,error:failure instanceof Error?failure.stack:failure?String(failure):null},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({result:failure?'FAIL':'PASS',checks:checks.length,built,readOnly:true}));if(failure)throw failure;
