import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import { PNG } from 'pngjs';
import { createCanvas,loadImage } from '@napi-rs/canvas';
import { blankStudioDocument,type StudioProject,type ExportPlan,type StudioExport,type Asset } from '@digitalguide/contracts';
import { fixtureIds as f } from '../../packages/test-fixtures/src/seed.js';
import { harness } from './helpers.js';
import { enableTimeline,newTimelineClip,fullTransform } from '../../packages/domain/src/timeline.js';
import { runStudioExport } from '../../apps/worker/src/studio-exports.js';
import * as runner from '../../packages/media/src/run-delivery.js';
import { mediaTools,runMediaTool,probeLocalMedia } from '../../packages/media/src/media-tools.js';
import { createTimelineRenderer } from '../../packages/media/src/timeline-frame.js';
import { syntheticPng,syntheticToneWav,inspectMedia } from '@digitalguide/media';
let h: Awaited<ReturnType<typeof harness>>;
beforeEach(async () => { h = await harness(); });afterEach(async () => { vi.restoreAllMocks();vi.unstubAllEnvs();await h.close(); });
async function post(url: string,body: unknown,headers = h.headers,key = randomUUID()) { return h.app.inject({ method: 'POST',url: '/api/v1'+url,payload: body as object,headers: { ...headers,'idempotency-key': key } }); }
const get = (url: string,headers: Record<string,string> = h.headers) => h.app.inject({ url: '/api/v1'+url,headers });
async function good<T>(url: string,body: unknown) { const r = await post(url,body);expect(r.statusCode,r.body).toBeGreaterThanOrEqual(200);expect(r.statusCode,r.body).toBeLessThan(300);return r.json().data as T; }
const defaults = { preset: 'hd',fps: 24,transparent: false,omitBackground: false,burnSubtitles: true };
const evidenceDirectory = process.env.EVIDENCE_DIR ? path.resolve(process.env.EVIDENCE_DIR,'delivery') : null;
function evidence(name: string,data: unknown,files: Record<string,string> = {}) { if (!evidenceDirectory) return;fs.mkdirSync(evidenceDirectory,{ recursive: true });fs.writeFileSync(path.join(evidenceDirectory,name+'.json'),JSON.stringify(data,null,2));for (const [target,source] of Object.entries(files)) fs.copyFileSync(source,path.join(evidenceDirectory,target)); }
async function create(audio = false,timeline = true) {
  const doc = blankStudioDocument();doc.canvas.width = 1280;doc.canvas.height = 720;doc.segments[0].durationMs = 1000;doc.segments[0].elements = [];doc.segments[0].speakerId = null;doc.segments[0].text = '原创导出字幕';
  if (timeline) { enableTimeline(doc);for (const t of doc.timeline!.tracks) t.clips = [];doc.timeline!.tracks.find(t => t.type === 'background')!.clips.push(newTimelineClip({ type: 'color',color: '#35516B' },{ durationMs: 500 }));doc.timeline!.tracks.find(t => t.type === 'overlay')!.clips.push(newTimelineClip({ type: 'shape',shape: 'ellipse',color: '#C82568' },{ durationMs: 500,transform: { ...fullTransform(),x: 0.15,y: 0.15,width: 0.4,height: 0.6 } }));doc.timeline!.tracks.find(t => t.type === 'subtitle')!.clips.push(newTimelineClip({ type: 'segment_subtitle' },{ segmentId: doc.segments[0].id,durationMs: 500,transform: { ...fullTransform(),x: 0.2,y: 0.85,width: 0.6,height: 0.1 } })); }
  if (audio) { const u = await good<{ uploadId: string }>('/assets/uploads',{ workspaceId: f.workspaceA,fileName: '原创400Hz.wav',contentBase64: syntheticToneWav(500,400).toString('base64') }),a = await good<Asset>('/assets',{ uploadId: u.uploadId,name: '原创合成400Hz',category: 'voice' });doc.speakers[0].voiceAssetId = a.id;doc.segments[0].speakerId = doc.speakers[0].id;if (timeline) doc.timeline!.tracks.find(t => t.type === 'voice')!.clips.push(newTimelineClip({ type: 'segment_narration' },{ segmentId: doc.segments[0].id,speakerId: doc.speakers[0].id,durationMs: 500 })); }
  return good<StudioProject>('/studio/projects',{ workspaceId: f.workspaceA,name: '原创矢量与合成音频导出',purpose: 'video',document: doc });
}
async function plan(p: StudioProject,settings: Record<string,unknown> = {},kind = 'video') { return good<ExportPlan>('/studio/projects/'+p.id+'/export-plan',{ version: p.version,kind,settings: { ...defaults,...settings },startMs: 0,durationMs: 500 }); }
async function queue(p: StudioProject,settings: Record<string,unknown> = {},kind = 'video') { const review = await plan(p,settings,kind);return good<StudioExport>('/studio/projects/'+p.id+'/exports',{ version: p.version,kind,settings: review.settings,startMs: review.startMs,durationMs: review.durationMs,planHash: review.hash,confirmed: true,rightsConfirmed: true }); }
const job = async (id: string) => (await get('/studio/exports/'+id)).json().data as StudioExport;
const download = async (j: StudioExport,kind: string) => get(j.artifacts.find(a => a.kind === kind)!.url!.replace('/api/v1',''));
describe('T10 实际本地成片导出',() => {
  it('实际1080p成片与PCM/SRT/VTT/manifest一致；幂等、范围和访问权限有效',async () => {
    const p = await create(true),review = await plan(p),input = { version: 1,kind: 'video',settings: review.settings,startMs: 0,durationMs: 500,planHash: review.hash,confirmed: true,rightsConfirmed: true },key = randomUUID();
    expect((await post('/studio/projects/'+p.id+'/exports',{ ...input,rightsConfirmed: false })).statusCode).toBe(400);
    const queued = await post('/studio/projects/'+p.id+'/exports',input,h.headers,key);expect(queued.statusCode,queued.body).toBe(200);const repeated = await post('/studio/projects/'+p.id+'/exports',input,h.headers,key);expect(repeated.json().data.id).toBe(queued.json().data.id);await runStudioExport(h.repo,h.config);
    const j = await job(queued.json().data.id);expect(j.status,JSON.stringify(j)).toBe('succeeded');expect(j.artifacts.map(a => a.kind)).toEqual(['video','audio','srt','vtt','manifest']);
    const video = await download(j,'video'),a = j.artifacts.find(a => a.kind === 'video')!;expect(createHash('sha256').update(video.rawPayload).digest('hex')).toBe(a.sha256);const manifest = JSON.parse((await download(j,'manifest')).body);expect(manifest.output).toMatchObject({ width: 1920,height: 1080,fps: 24,videoCodec: 'h264',audioCodec: 'aac',alpha: false,sampleRate: 48000,channels: 2 });expect(manifest.files.find((f: {kind: string}) => f.kind === 'video').sha256).toBe(a.sha256);
    const mediaRow = h.repo.get<{storage_key: string}>("SELECT storage_key FROM studio_export_artifacts WHERE export_id=? AND kind='video'",j.id)!;evidence('1080p',manifest,{ '1080p.mp4': path.join(h.config.dataDir,'objects',mediaRow.storage_key) });
    const wav = (await download(j,'audio')).rawPayload;expect(inspectMedia(wav).specs.durationMs).toBe(500);expect(wav.subarray(44).some(v => v !== 0)).toBe(true);expect((await download(j,'srt')).body).toContain('00:00:00,000 --> 00:00:00,500');expect((await download(j,'vtt')).body).toContain('原创导出字幕');
    const range = await get(a.url!.replace('/api/v1',''),{ ...h.headers,range: 'bytes=0-31' });expect(range.statusCode).toBe(206);expect(range.rawPayload.length).toBe(32);expect((await get(a.url!.replace('/api/v1',''),{ ...h.headers,range: 'bytes=-0' })).statusCode).toBe(416);
    expect((await get(a.url!.replace('/api/v1',''),{})).statusCode).toBe(401);const other = await h.login(f.adminB);expect((await get('/studio/exports/'+j.id,other)).statusCode).toBe(404);expect((await get(a.url!.replace('/api/v1',''),other)).statusCode).toBe(404);
    const changed = structuredClone(p.document);changed.timeline!.tracks.find(t => t.type === 'overlay')!.clips[0].color.brightness = 0.6;await good('/studio/projects/'+p.id+'/save',{ version: 1,name: p.name,document: changed });expect((await get(a.url!.replace('/api/v1',''))).statusCode).toBe(409);expect((await job(j.id)).artifacts.every(f => f.url === null)).toBe(true);
  },60000);
  it('实际UHD包含3840×2160视频帧，禁用烧录仍保留外挂字幕',async () => {
    const p = await create(),queued = await queue(p,{ preset: 'uhd',burnSubtitles: false });await runStudioExport(h.repo,h.config);const j = await job(queued.id);expect(j.status,JSON.stringify(j)).toBe('succeeded');
    const manifest = JSON.parse((await download(j,'manifest')).body);expect(manifest.output).toMatchObject({ width: 3840,height: 2160,fps: 24 });expect((await download(j,'vtt')).body).toContain('原创导出字幕');
    const row = h.repo.get<{storage_key: string}>("SELECT storage_key FROM studio_export_artifacts WHERE export_id=? AND kind='video'",j.id)!,file = path.join(h.config.dataDir,'objects',row.storage_key),probe = await probeLocalMedia(file,h.config.root);expect(probe.streams.find(s => s.codec_type === 'video')).toMatchObject({ width: 3840,height: 2160 });
    const png = path.join(h.config.dataDir,'uhd-frame.png');await runMediaTool(mediaTools(h.config.root).ffmpeg,['-v','error','-nostdin','-n','-i',file,'-frames:v','1','-update','1',png],undefined,30000);const frame = PNG.sync.read(fs.readFileSync(png));expect([frame.width,frame.height]).toEqual([3840,2160]);
    evidence('4k',{ manifest,decodedFrame: { width: frame.width,height: frame.height } },{ '4k.mp4': file,'4k-frame.png': png });
  },90000);
  it('ProRes4444实有Alpha与细边缘，在黑白两底色合成接近原始目标分辨率图形',async () => {
    const p = await create(),queued = await queue(p,{ transparent: true,omitBackground: true,burnSubtitles: false });await runStudioExport(h.repo,h.config);const j = await job(queued.id);expect(j.status,JSON.stringify(j)).toBe('succeeded');
    const artifact = h.repo.get<{storage_key: string}>("SELECT storage_key FROM studio_export_artifacts WHERE export_id=? AND kind='video'",j.id)!,video = path.join(h.config.dataDir,'objects',artifact.storage_key),alpha = path.join(h.config.dataDir,'alpha.png'),ffmpeg = mediaTools(h.config.root).ffmpeg;
    await runMediaTool(ffmpeg,['-v','error','-nostdin','-n','-i',video,'-frames:v','1','-vf','format=rgba','-update','1',alpha]);const decoded = PNG.sync.read(fs.readFileSync(alpha));let min = 255,max = 0,partial = 0;for (let i = 3;i < decoded.data.length;i += 4) { const a = decoded.data[i];min = Math.min(min,a);max = Math.max(max,a);if (a > 0 && a < 255) partial++; }expect([min,max]).toEqual([0,255]);expect(partial).toBeGreaterThan(100);
    const d = structuredClone(p.document);d.canvas.transparent = true;d.timeline!.tracks.find(t => t.type === 'background')!.muted = true;d.timeline!.tracks.find(t => t.type === 'subtitle')!.muted = true;
    const renderer = await createTimelineRenderer(d,() => { throw Error('No images'); },640,0,500,{ width: 1920,height: 1080,flatten: false,referenceLabels: false }),native = (await renderer.renderAsync(0,false)).canvas.toBuffer('image/png'),image = await loadImage(native);
    const comparisons: { color: string;meanAbsoluteError: number;edgeMeanAbsoluteError: number }[] = [],compositeFiles: Record<string,string> = { 'alpha.mov': video,'alpha.png': alpha };
    for (const color of ['black','white']) {
      const out = path.join(h.config.dataDir,'composite-'+color+'.png');await runMediaTool(ffmpeg,['-v','error','-nostdin','-n','-f','lavfi','-i',`color=c=${color}:s=1920x1080:r=24`,'-i',video,'-filter_complex','[0:v][1:v]overlay=shortest=1:format=auto,format=rgba','-frames:v','1','-update','1',out],undefined,30000);
      const actual = PNG.sync.read(fs.readFileSync(out)),gold = createCanvas(1920,1080),ctx = gold.getContext('2d');ctx.fillStyle = color;ctx.fillRect(0,0,1920,1080);ctx.drawImage(image,0,0);const expected = ctx.getImageData(0,0,1920,1080).data;let error = 0,count = 0,edgeError = 0,edgeCount = 0;
      for (let i = 0;i < actual.data.length;i += 4) { for (let c = 0;c < 3;c++) { const delta = Math.abs(actual.data[i+c]-expected[i+c]);error += delta;count++;if (decoded.data[i+3] > 0 && decoded.data[i+3] < 255) { edgeError += delta;edgeCount++; } } }
      expect(error/count).toBeLessThan(3);expect(edgeError/edgeCount).toBeLessThan(20);
      comparisons.push({ color,meanAbsoluteError: error/count,edgeMeanAbsoluteError: edgeError/edgeCount });compositeFiles['alpha-over-'+color+'.png'] = out;
    }
    const manifest = JSON.parse((await download(j,'manifest')).body);expect(manifest.output).toMatchObject({ videoCodec: 'prores',alpha: true,audioCodec: 'pcm_s16le' });expect(manifest.output.pixelFormat).toMatch(/^yuva444p/);
    evidence('alpha',{ manifest,alpha: { min,max,partialPixels: partial },comparisons },compositeFiles);
  },90000);
  it('普通分镜无需修改工程即可重复审阅并实际单独导出音频',async () => {
    const p = await create(true,false),one = await plan(p,{},'audio'),two = await plan(p,{},'audio');expect(one.hash).toBe(two.hash);const queued = await queue(p,{},'audio');await runStudioExport(h.repo,h.config);const j = await job(queued.id);expect(j.status,JSON.stringify(j)).toBe('succeeded');expect(j.artifacts.map(a => a.kind)).toEqual(['audio','srt','vtt','manifest']);expect((await get('/studio/projects/'+p.id)).json().data.document.timeline).toBeNull();expect(inspectMedia((await download(j,'audio')).rawPayload).specs.durationMs).toBe(500);
  },30000);
  it('只读、错误版本、缺少媒体工具与取消明确失败，工程包独立审阅',async () => {
    const p = await create(),review = await plan(p),viewer = await h.login(f.viewerA),input = { version: 1,kind: 'video',settings: review.settings,startMs: 0,durationMs: 500,planHash: review.hash,confirmed: true,rightsConfirmed: true };
    expect((await post('/studio/projects/'+p.id+'/exports',input,viewer)).statusCode).toBe(403);expect((await post('/studio/projects/'+p.id+'/exports',{ ...input,version: 2 })).statusCode).toBe(409);expect((await plan(p,{},'package')).canExport).toBe(true);
    vi.stubEnv('FFMPEG_PATH',path.join(h.config.dataDir,'missing.exe'));vi.stubEnv('FFPROBE_PATH',path.join(h.config.dataDir,'missing-probe.exe'));expect((await plan(p)).canExport).toBe(false);expect((await post('/studio/projects/'+p.id+'/exports',input)).statusCode).toBe(409);vi.unstubAllEnvs();
    const queued = await queue(p);await good('/studio/exports/'+queued.id+'/cancel',{ version: 1 });expect(await runStudioExport(h.repo,h.config)).toBe(false);expect((await job(queued.id)).status).toBe('cancelled');
  });
  it('渲染中取消阻断迟到产物，租约可从数据库恢复',async () => {
    const p = await create(),queued = await queue(p);let release!: () => void,started!: () => void;const hold = new Promise<void>(r => { release = r; }),ready = new Promise<void>(r => { started = r; }),actual = runner.runDelivery;
    vi.spyOn(runner,'runDelivery').mockImplementation(async (...args) => { started();await hold;return actual(...args); });const work = runStudioExport(h.repo,h.config);await ready;await good('/studio/exports/'+queued.id+'/cancel',{ version: 1 });release();await work;
    expect((await job(queued.id)).status).toBe('cancelled');expect(h.repo.get<{n: number}>('SELECT count(*) n FROM studio_export_artifacts')!.n).toBe(0);vi.restoreAllMocks();
    const next = await queue(p);h.repo.run("UPDATE studio_exports SET status='rendering',attempts=1,lease_token='old',lease_until='2000-01-01T00:00:00.000Z' WHERE id=?",next.id);await runStudioExport(h.repo,h.config);expect((await job(next.id)).status).toBe('succeeded');expect(h.repo.get<{attempts: number}>('SELECT attempts FROM studio_exports WHERE id=?',next.id)!.attempts).toBe(2);
  },60000);
  it('源文件字节被更改时拒绝导出，失败清理工作文件',async () => {
    const p = await create(true),queued = await queue(p),assetId = p.document.speakers[0].voiceAssetId!,u = h.repo.get<{storage_key: string}>('SELECT u.storage_key FROM uploads u JOIN assets a ON a.upload_id=u.id WHERE a.id=?',assetId)!;fs.writeFileSync(path.join(h.config.dataDir,'objects',u.storage_key),syntheticPng());await runStudioExport(h.repo,h.config);expect((await job(queued.id))).toMatchObject({ status: 'failed',errorMessage: expect.stringContaining('校验不一致') });expect(h.repo.get<{n: number}>('SELECT count(*) n FROM studio_export_artifacts')!.n).toBe(0);
  });
  it('生成完成前工程发生修改会拒绝提交，素材归档后旧下载失效',async () => {
    const p = await create(true),queued = await queue(p,{},'audio');let release!: () => void,rendered!: () => void;const hold = new Promise<void>(r => { release = r; }),ready = new Promise<void>(r => { rendered = r; }),actual = runner.runDelivery;
    vi.spyOn(runner,'runDelivery').mockImplementation(async (...args) => { const result = await actual(...args);rendered();await hold;return result; });const work = runStudioExport(h.repo,h.config);await ready;const changed = structuredClone(p.document);changed.segments[0].text = '输出完成前修改的字幕';await good('/studio/projects/'+p.id+'/save',{ version: 1,name: p.name,document: changed });release();await work;expect((await job(queued.id)).status).toBe('failed');expect(h.repo.get<{n: number}>('SELECT count(*) n FROM studio_export_artifacts')!.n).toBe(0);vi.restoreAllMocks();
    const fresh = (await get('/studio/projects/'+p.id)).json().data as StudioProject,next = await queue(fresh,{},'audio');await runStudioExport(h.repo,h.config);const done = await job(next.id);expect(done.status).toBe('succeeded');const url = done.artifacts.find(a => a.kind === 'audio')!.url!;
    const asset = p.document.speakers[0].voiceAssetId!,archived = await h.app.inject({ method: 'PATCH',url: '/api/v1/assets/'+asset,payload: { version: 1,archived: true },headers: { ...h.headers,'idempotency-key': randomUUID() } });expect(archived.statusCode,archived.body).toBe(200);expect((await get(url.replace('/api/v1',''))).statusCode).toBe(409);
  },30000);
  it('独立图形工程的品牌标志也绑定素材版本，未使用的角色参考不参与渲染',async () => {
    const u = await good<{uploadId: string}>('/assets/uploads',{ workspaceId: f.workspaceA,fileName: '原创品牌.png',contentBase64: syntheticPng().toString('base64') }),asset = await good<Asset>('/assets',{ uploadId: u.uploadId,name: '原创品牌标志',category: 'reference' });
    const p = await create(),doc = structuredClone(p.document);doc.brand.logoAssetId = asset.id;doc.speakers[0].avatarAssetId = f.avatarB;
    const saved = await good<StudioProject>('/studio/projects/'+p.id+'/save',{ version: 1,name: p.name,document: doc }),review = await plan(saved);expect(review.sourceSpecs.map(a => a.id)).toContain(asset.id);expect(review.sourceSpecs.map(a => a.id)).not.toContain(f.avatarB);
    const queued = await queue(saved,{},'audio');await runStudioExport(h.repo,h.config);expect((await job(queued.id)).status).toBe('succeeded');
    const renamed = await h.app.inject({ method: 'PATCH',url: '/api/v1/assets/'+asset.id,payload: { version: 1,name: '品牌新名称' },headers: { ...h.headers,'idempotency-key': randomUUID() } });expect(renamed.statusCode,renamed.body).toBe(200);expect((await plan(saved)).hash).not.toBe(review.hash);expect((await job(queued.id)).artifacts.every(a => a.url === null)).toBe(true);
  },30000);
  it('工作进程停止会保留同一排队任务，重启后完成；用户取消不会被恢复覆盖',async () => {
    const p = await create(),queued = await queue(p,{},'audio'),stop = new AbortController();let release!: () => void,started!: () => void;const hold = new Promise<void>(r => { release = r; }),ready = new Promise<void>(r => { started = r; }),actual = runner.runDelivery;
    vi.spyOn(runner,'runDelivery').mockImplementation(async (...args) => { started();await hold;return actual(...args); });const work = runStudioExport(h.repo,h.config,stop.signal);await ready;stop.abort();release();await work;expect((await job(queued.id))).toMatchObject({ status: 'queued',artifacts: [] });vi.restoreAllMocks();
    await runStudioExport(h.repo,h.config);expect((await job(queued.id)).status).toBe('succeeded');expect(h.repo.get<{attempts: number}>('SELECT attempts FROM studio_exports WHERE id=?',queued.id)!.attempts).toBe(1);
    const cancelled = await queue(p,{},'audio');await good('/studio/exports/'+cancelled.id+'/cancel',{ version: 1 });expect(await runStudioExport(h.repo,h.config,stop.signal)).toBe(false);expect((await job(cancelled.id)).status).toBe('cancelled');
  },30000);
});
