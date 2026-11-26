import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import type { Asset,MediaTransfer } from '@digitalguide/contracts';
import { fixtureIds as f } from '../../packages/test-fixtures/src/seed.js';
import { originalVideoFixture } from '../../packages/test-fixtures/src/video.js';
import { runMediaTransfer } from '../../apps/worker/src/media-transfers.js';
import { transferChunkSize } from '../../apps/api/src/media-transfer-service.js';
import * as inspector from '../../packages/media/src/run-video-inspection.js';
import { syntheticPng } from '@digitalguide/media';
import { harness } from './helpers.js';
let h: Awaited<ReturnType<typeof harness>>;
beforeEach(async () => { h = await harness(); });afterEach(async () => { vi.restoreAllMocks();await h.close(); });
const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
async function post(url: string,data: object,headers = h.headers,key = randomUUID()) { return h.app.inject({ method: 'POST',url: '/api/v1'+url,payload: data,headers: { ...headers,'idempotency-key': key } }); }
const get = (url: string,headers: Record<string,string> = h.headers) => h.app.inject({ url: '/api/v1'+url,headers });
async function good<T>(url: string,data: object) { const r = await post(url,data);expect(r.statusCode,r.body).toBe(200);return r.json().data as T; }
async function begin(bytes: Buffer) { const hashes: string[] = [];for (let i = 0;i < bytes.length;i += transferChunkSize) hashes.push(hash(bytes.subarray(i,i+transferChunkSize)));return good<MediaTransfer>('/studio/transfers',{ workspaceId: f.workspaceA,kind: 'video',name: '原创4色4音视频',fileName: 'original.mp4',size: bytes.length,sha256: hash(bytes),partHashes: hashes,rightsNote: '本项目代码生成的4色4音原创合成视频',rightsConfirmed: true }); }
async function upload(bytes: Buffer) { let row = await begin(bytes);for (let i = 0;i < row.chunkCount;i++) { const part = bytes.subarray(i*row.chunkSize,(i+1)*row.chunkSize);row = await good('/studio/transfers/'+row.id+'/parts',{ index: i,contentBase64: part.toString('base64'),sha256: hash(part) }); }return good<MediaTransfer>('/studio/transfers/'+row.id+'/finalize',{ version: row.version }); }
async function row(id: string) { return (await get('/studio/transfers/'+id)).json().data as MediaTransfer; }
describe('T10 分片视频导入',() => {
  it('分片在重读后可续传，重复分片不增加记录，实际解码后建立MP4资产和封面',async () => {
    const file = await originalVideoFixture(path.join(h.config.dataDir,'original'),h.config.root,{ padding: transferChunkSize }),bytes = fs.readFileSync(file);let r = await begin(bytes);expect(r.chunkCount).toBe(2);const part = bytes.subarray(0,r.chunkSize),input = { index: 0,contentBase64: part.toString('base64'),sha256: hash(part) },key = randomUUID();
    const first = await post('/studio/transfers/'+r.id+'/parts',input,h.headers,key),repeat = await post('/studio/transfers/'+r.id+'/parts',input,h.headers,key);expect(first.json().data.version).toBe(repeat.json().data.version);r = await row(r.id);expect(r.receivedParts).toEqual([0]);expect((await post('/studio/transfers/'+r.id+'/finalize',{ version: r.version })).statusCode).toBe(409);
    const end = bytes.subarray(r.chunkSize);r = await good('/studio/transfers/'+r.id+'/parts',{ index: 1,contentBase64: end.toString('base64'),sha256: hash(end) });await good('/studio/transfers/'+r.id+'/finalize',{ version: r.version });await runMediaTransfer(h.repo,h.config);r = await row(r.id);expect(r.status,JSON.stringify(r)).toBe('ready');expect(r.sha256).toBe(hash(bytes));
    const asset = (await get('/assets/'+r.assetId)).json().data as Asset;expect(asset).toMatchObject({ name: '原创4色4音视频',mediaType: 'video/mp4',size: bytes.length,sha256: hash(bytes),specs: { width: 640,height: 360,durationMs: 4000,fps: 25,hasAudio: 1 } });
    const content = await get('/assets/'+r.assetId+'/content',{ ...h.headers,range: 'bytes=0-63' });expect(content.statusCode).toBe(206);expect(content.rawPayload).toEqual(bytes.subarray(0,64));expect((await get('/assets/'+r.assetId+'/content',{})).statusCode).toBe(401);expect((await get('/assets/'+r.assetId+'/poster')).headers['content-type']).toContain('image/png');expect(h.repo.get<{n: number}>('SELECT count(*) n FROM media_transfer_parts WHERE transfer_id=?',r.id)!.n).toBe(2);expect(fs.readdirSync(path.join(h.config.dataDir,'transfer-chunks'))).toEqual([]);
  },60000);
  it('只读、跨账号/组织与错误分片被拒绝，未完成不能提交，取消清理临时分片',async () => {
    const bytes = syntheticPng(),r = await begin(bytes),viewer = await h.login(f.viewerA),editor = await h.login(f.editorA),other = await h.login(f.adminB),input = { index: 0,contentBase64: bytes.toString('base64'),sha256: hash(bytes) };
    expect((await post('/studio/transfers/'+r.id+'/parts',input,viewer)).statusCode).toBe(403);expect((await get('/studio/transfers/'+r.id,editor)).statusCode).toBe(404);expect((await get('/studio/transfers/'+r.id,other)).statusCode).toBe(404);expect((await post('/studio/transfers/'+r.id+'/parts',{ ...input,sha256: '0'.repeat(64) })).statusCode).toBe(422);expect((await post('/studio/transfers/'+r.id+'/parts',{ ...input,index: 1 })).statusCode).toBe(422);
    const current = await good<MediaTransfer>('/studio/transfers/'+r.id+'/parts',input);expect((await post('/studio/transfers/'+r.id+'/cancel',{ version: r.version })).statusCode).toBe(409);await good('/studio/transfers/'+r.id+'/cancel',{ version: current.version });expect((await row(r.id)).status).toBe('cancelled');expect(await runMediaTransfer(h.repo,h.config)).toBe(false);expect(fs.readdirSync(path.join(h.config.dataDir,'transfer-chunks'))).toEqual([]);
  });
  it('伪装MP4和被改写的分片不能进入素材库，待上传超时会明确失败',async () => {
    const invalid = await upload(syntheticPng());await runMediaTransfer(h.repo,h.config);expect((await row(invalid.id)).status).toBe('failed');expect(h.repo.get<{n: number}>('SELECT count(*) n FROM video_sources')!.n).toBe(0);
    const bytes = syntheticPng(),r = await begin(bytes),part = await good<MediaTransfer>('/studio/transfers/'+r.id+'/parts',{ index: 0,contentBase64: bytes.toString('base64'),sha256: hash(bytes) });const key = h.repo.get<{storage_key: string}>('SELECT storage_key FROM media_transfer_parts WHERE transfer_id=?',r.id)!.storage_key;fs.writeFileSync(path.join(h.config.dataDir,'transfer-chunks',key),Buffer.alloc(bytes.length));await good('/studio/transfers/'+r.id+'/finalize',{ version: part.version });await runMediaTransfer(h.repo,h.config);expect((await row(r.id)).errorMessage).toContain('分片校验');
    const expired = await begin(bytes);h.repo.run("UPDATE media_transfers SET updated_at='2000-01-01T00:00:00.000Z' WHERE id=?",expired.id);await runMediaTransfer(h.repo,h.config);expect((await row(expired.id))).toMatchObject({ status: 'failed',errorMessage: expect.stringContaining('24小时') });
  },30000);
  it('停止检查后同一任务可恢复，取消/迟到检查结果不能创建素材',async () => {
    const bytes = fs.readFileSync(await originalVideoFixture(path.join(h.config.dataDir,'original'),h.config.root,{ audio: false })),queued = await upload(bytes),stop = new AbortController();let release!: () => void,started!: () => void;const held = new Promise<void>(r => { release = r; }),ready = new Promise<void>(r => { started = r; }),actual = inspector.runVideoInspection;
    vi.spyOn(inspector,'runVideoInspection').mockImplementation(async (...args) => { started();await held;return actual(...args); });const work = runMediaTransfer(h.repo,h.config,stop.signal);await ready;stop.abort();release();await work;expect((await row(queued.id)).status).toBe('queued');vi.restoreAllMocks();await runMediaTransfer(h.repo,h.config);expect((await row(queued.id))).toMatchObject({ status: 'ready',assetId: expect.any(String) });
    const cancelled = await upload(bytes);let done!: () => void,finish!: () => void;const resultReady = new Promise<void>(r => { done = r; }),hold = new Promise<void>(r => { finish = r; });vi.spyOn(inspector,'runVideoInspection').mockImplementation(async (...args) => { const result = await actual(...args);done();await hold;return result; });const late = runMediaTransfer(h.repo,h.config);await resultReady;const fresh = await row(cancelled.id);await good('/studio/transfers/'+cancelled.id+'/cancel',{ version: fresh.version });finish();await late;expect((await row(cancelled.id))).toMatchObject({ status: 'cancelled',assetId: null });expect(h.repo.get<{n: number}>('SELECT count(*) n FROM video_sources')!.n).toBe(1);
  },60000);
  it('过期租约恢复不会重复创建资产，恢复次数耗尽会明确失败',async () => {
    const bytes = fs.readFileSync(await originalVideoFixture(path.join(h.config.dataDir,'original'),h.config.root)),queued = await upload(bytes);h.repo.run("UPDATE media_transfers SET status='processing',attempts=1,lease_token='expired-owner',lease_until='2000-01-01T00:00:00.000Z' WHERE id=?",queued.id);await runMediaTransfer(h.repo,h.config);expect((await row(queued.id))).toMatchObject({ status: 'ready',assetId: expect.any(String) });expect(h.repo.get<{attempts: number}>('SELECT attempts FROM media_transfers WHERE id=?',queued.id)!.attempts).toBe(2);expect(h.repo.get<{n: number}>('SELECT count(*) n FROM video_sources')!.n).toBe(1);expect(await runMediaTransfer(h.repo,h.config)).toBe(false);
    const exhausted = await upload(bytes);h.repo.run("UPDATE media_transfers SET status='processing',attempts=2,lease_token='expired-owner',lease_until='2000-01-01T00:00:00.000Z' WHERE id=?",exhausted.id);expect(await runMediaTransfer(h.repo,h.config)).toBe(false);expect((await row(exhausted.id))).toMatchObject({ status: 'failed',assetId: null,errorMessage: expect.stringContaining('恢复次数') });expect(h.repo.get<{n: number}>('SELECT count(*) n FROM video_sources')!.n).toBe(1);
  },30000);
});
