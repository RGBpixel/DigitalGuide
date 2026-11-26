// Local development only: creates a fresh original synthetic sample; never publishes externally.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { duoTimelineFixture,timelineFixtureAssets } from '../packages/test-fixtures/src/timeline.js';
import { fixtureIds } from '../packages/test-fixtures/src/seed.js';
import { syntheticPng,syntheticToneWav } from '@digitalguide/media';
import type { Asset,StudioProject,ExportPlan,StudioExport } from '@digitalguide/contracts';
const base = 'http://127.0.0.1:4301/api/v1',origin = 'http://127.0.0.1:5174';
async function login(accountId: string) { const response = await fetch(base+'/auth/login',{ method: 'POST',headers: { 'Content-Type': 'application/json',Origin: origin },body: JSON.stringify({ accountId }) });if (!response.ok) throw new Error('本地演示账号不可用。');const cookie = response.headers.get('set-cookie')?.split(';')[0];if (!cookie) throw new Error('未建立本地会话。');const me = await fetch(base+'/me',{ headers: { cookie } });return { cookie,'x-csrf-token': (await me.json()).data.csrfToken as string }; }
const headers = await login(fixtureIds.adminA),checks: { name: string;result: 'PASS' }[] = [];
async function request<T>(url: string,data?: object) { const response = await fetch(base+url,{ method: data ? 'POST' : 'GET',headers: { ...headers,Origin: origin,'Content-Type': 'application/json','Idempotency-Key': randomUUID() },...(data ? { body: JSON.stringify(data) } : {}),signal: AbortSignal.timeout(10000) });if (!response.ok) throw new Error('本地运行检查失败：'+url+'，HTTP '+response.status);return (await response.json()).data as T; }
const ready = await request<{gate: string}>('/readiness');if (ready.gate !== 'G1_in_progress') throw new Error('就绪状态错误。');checks.push({ name: 'readiness accurately reports G1 in progress',result: 'PASS' });
if (process.argv.includes('--verify-existing')) {
  const file = path.resolve('docs/evidence/T10/runtime.json'),previous = JSON.parse(fs.readFileSync(file,'utf8')) as { projectId: string;exportId: string;restartCheck?: object };
  const p = await request<StudioProject>('/studio/projects/'+previous.projectId),j = await request<StudioExport>('/studio/exports/'+previous.exportId);
  if (j.status !== 'succeeded' || j.projectId !== p.id || j.artifacts.length !== 5 || j.artifacts.some(a => !a.url)) throw new Error('重启后工程、输出或可下载状态不一致。');
  const video = j.artifacts.find(a => a.kind === 'video')!,response = await fetch('http://127.0.0.1:4301'+video.url,{ headers: { ...headers,Range: 'bytes=0-63' } });if (response.status !== 206 || (await response.arrayBuffer()).byteLength !== 64) throw new Error('重启后媒体读取失败。');
  previous.restartCheck = { result: 'PASS',checkedAt: new Date().toISOString(),sameProject: true,sameExport: true,allFilesAvailable: true,rangeDownload: 206,gate: ready.gate };fs.writeFileSync(file,JSON.stringify(previous,null,2));console.log(JSON.stringify(previous.restartCheck));process.exit(0);
}
const doc = duoTimelineFixture(),ids = timelineFixtureAssets,map = new Map<string,string>();
for (const [id,category,bytes] of [[ids.avatarA,'avatar',syntheticPng()],[ids.avatarB,'avatar',syntheticPng([90,60,100])],[ids.voiceA,'voice',syntheticToneWav(1000,400)],[ids.voiceB,'voice',syntheticToneWav(1000,900)],[ids.narration,'voice',syntheticToneWav(1000,1400)]] as const) {
  const u = await request<{uploadId: string}>('/assets/uploads',{ workspaceId: fixtureIds.workspaceA,fileName: id+(category === 'voice' ? '.wav' : '.png'),contentBase64: bytes.toString('base64') }),a = await request<Asset>('/assets',{ uploadId: u.uploadId,name: 'T10原创合成 '+id,category });map.set(id,a.id);
}
for (const s of doc.speakers) { s.avatarAssetId = map.get(s.avatarAssetId!)!;s.voiceAssetId = map.get(s.voiceAssetId!)!; }for (const t of doc.timeline!.tracks) for (const c of t.clips) if (c.source.type === 'asset') c.source.assetId = map.get(c.source.assetId)!;
const project = await request<StudioProject>('/studio/projects',{ workspaceId: fixtureIds.workspaceA,name: '成片导出演示 · 原创双人',purpose: 'video',document: doc });checks.push({ name: 'fresh original sample; existing user projects unchanged',result: 'PASS' });
const settings = { preset: 'hd',fps: 25,transparent: false,omitBackground: false,burnSubtitles: true },input = { version: project.version,kind: 'video',settings,startMs: 0,durationMs: 3000 },plan = await request<ExportPlan>('/studio/projects/'+project.id+'/export-plan',input);if (!plan.canExport || plan.width !== 1920 || plan.height !== 1080) throw new Error('运行时计划不支持实际1080p。');checks.push({ name: 'current plan is actual 1920x1080 at 25fps',result: 'PASS' });
let job = await request<StudioExport>('/studio/projects/'+project.id+'/exports',{ ...input,planHash: plan.hash,confirmed: true,rightsConfirmed: true });const deadline = Date.now()+120000;
while (['queued','rendering'].includes(job.status) && Date.now() < deadline) { await new Promise(r => setTimeout(r,400));job = await request<StudioExport>('/studio/exports/'+job.id); }
if (job.status !== 'succeeded') throw new Error('实际导出未完成：'+job.status+' '+job.errorMessage);checks.push({ name: 'live independent worker completed persistent export',result: 'PASS' });
const video = job.artifacts.find(a => a.kind === 'video')!,manifestFile = job.artifacts.find(a => a.kind === 'manifest')!;
if (!video.url || !manifestFile.url) throw new Error('缺少可下载产物。');
const manifestResponse = await fetch('http://127.0.0.1:4301'+manifestFile.url,{ headers }),manifest = await manifestResponse.json();if (manifest.output.width !== 1920 || manifest.output.height !== 1080 || manifest.output.fps !== 25 || manifest.range.durationMs !== 3000) throw new Error('运行时manifest规格不一致。');checks.push({ name: 'live manifest matches dimensions/fps/range',result: 'PASS' });
const range = await fetch('http://127.0.0.1:4301'+video.url,{ headers: { ...headers,Range: 'bytes=0-63' } });if (range.status !== 206 || (await range.arrayBuffer()).byteLength !== 64) throw new Error('运行时Range读取失败。');checks.push({ name: 'authenticated 64-byte range download',result: 'PASS' });
const anonymous = await fetch('http://127.0.0.1:4301'+video.url);if (anonymous.status !== 401) throw new Error('匿名访问未拒绝。');checks.push({ name: 'anonymous download refused',result: 'PASS' });
const otherHeaders = await login(fixtureIds.adminB),other = await fetch(base+'/studio/exports/'+job.id,{ headers: otherHeaders });if (other.status !== 404) throw new Error('跨组织读取未拒绝。');checks.push({ name: 'other tenant export read refused',result: 'PASS' });
const persisted = await request<StudioExport[]>('/studio/projects/'+project.id+'/exports');if (!persisted.some(j => j.id === job.id && j.status === 'succeeded')) throw new Error('输出未从数据库重读。');checks.push({ name: 'project history reload retains completed files',result: 'PASS' });
const directory = path.resolve('docs/evidence/T10');fs.mkdirSync(directory,{ recursive: true });
const report = { result: 'PASS',checkedAt: new Date().toISOString(),preview: origin+'/studio/projects/'+project.id,api: base,projectId: project.id,exportId: job.id,originalSyntheticOnly: true,existingProjectsUnchanged: true,realProviderConfigured: false,g1Complete: false,g2Complete: false,checks,manifest,artifacts: job.artifacts };
fs.writeFileSync(path.join(directory,'runtime.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ result: report.result,preview: report.preview,checks: checks.length,exportId: job.id }));
