import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Repository } from '@digitalguide/database';
import { blankStudioDocument, type StudioProject, type StudioImport, type StudioClone } from '@digitalguide/contracts';
import { fixtureIds as f } from '../../packages/test-fixtures/src/seed.js';
import { pptxFixture, pdfFixture } from '../../packages/test-fixtures/src/documents.js';
import { harness } from './helpers.js';
import { runStudioPreview } from '../../apps/worker/src/studio-previews.js';
import { runStudioImport } from '../../apps/worker/src/studio-imports.js';
import { runOne } from '../../apps/worker/src/runner.js';
import { createApp } from '../../apps/api/src/app.js';
import * as storyboard from '../../packages/media/src/storyboard-preview.js';
let h: Awaited<ReturnType<typeof harness>>;
beforeEach(async () => { h = await harness(); }); afterEach(async () => { vi.restoreAllMocks(); await h.close(); });
function post(path: string, data: Record<string, unknown>, headers = h.headers, key = randomUUID()) { return h.app.inject({ method: 'POST', url: '/api/v1' + path, payload: data, headers: { ...headers, 'idempotency-key': key } }); }
function get(path: string, headers = h.headers) { return h.app.inject({ url: '/api/v1' + path, headers }); }
async function good(path: string, data: Record<string, unknown>) { const r = await post(path, data); expect(r.statusCode, r.body).toBeGreaterThanOrEqual(200); expect(r.statusCode, r.body).toBeLessThan(300); return r.json().data; }
async function project(doc = blankStudioDocument()) { return await good('/studio/projects', { workspaceId: f.workspaceA, name: '合成创作工程', purpose: 'video', document: doc }) as StudioProject; }
async function readProject(id: string) { const r = await get('/studio/projects/' + id); expect(r.statusCode, r.body).toBe(200); return r.json().data as StudioProject; }
async function preview(p: StudioProject, ids = p.document.segments.map(s => s.id)) { const plan = await good('/studio/projects/' + p.id + '/plan', { version: p.version }); return good('/studio/projects/' + p.id + '/previews', { version: p.version, planHash: plan.hash, confirmed: true, segmentIds: ids }); }
async function importDoc(format: 'pdf' | 'pptx', bytes: Buffer) { return await good('/studio/imports', { workspaceId: f.workspaceA, name: '已授权的合成文档', fileName: 'test.' + format, contentBase64: bytes.toString('base64'), rightsNote: '本项目原创合成测试文档', rightsConfirmed: true }) as StudioImport; }
async function readImport(id: string) { return (await get('/studio/imports/' + id)).json().data as StudioImport; }
async function consent(assetId = f.avatarA, purpose = 'train_avatar') { return await good('/assets/' + assetId + '/consents', { purpose, subject: '虚构授权人', proof: '合成测试专项授权记录，不是真人素材', expiresAt: new Date(Date.now() + 86400000).toISOString(), noticeVersion: 'local-v1' }); }
async function clone(kind: 'avatar' | 'voice' = 'avatar', simulate = 'success') { const c = await consent(kind === 'avatar' ? f.avatarA : f.voiceA, kind === 'avatar' ? 'train_avatar' : 'train_voice'); return await good('/studio/clones', { workspaceId: f.workspaceA, name: '显式模拟参考', kind, assetId: kind === 'avatar' ? f.avatarA : f.voiceA, consentId: c.id, simulate }) as StudioClone; }
async function readClone(id: string) { return (await get('/studio/clones/' + id)).json().data as StudioClone; }
describe('T08 工程、模板、品牌及局部预览', () => {
  it('工程保存后脚本、分镜与六类关联轨道一致，重新建立 API/数据库仍保留内容', async () => {
    const p = await project(), doc = structuredClone(p.document); doc.segments[0].text = '已保存的合成脚本'; doc.segments[0].notes = '长备注'.repeat(1000); doc.segments.push({ ...structuredClone(doc.segments[0]), id: randomUUID(), title: '第二分镜', text: '第二段', elements: [] });
    const saved = await good('/studio/projects/' + p.id + '/save', { version: p.version, name: '持久化工程', document: doc }) as StudioProject; expect(saved.version).toBe(2); expect(saved.tracks).toHaveLength(6); expect(saved.tracks.find(t => t.type === 'subtitle')?.clips.map(c => c.startMs)).toEqual([0, 6000]);
    const repo = new Repository(h.config.dataDir, h.config.root), app = await createApp(h.config, repo);
    try { const r = await app.inject({ url: '/api/v1/studio/projects/' + p.id, headers: h.headers }); expect(r.statusCode).toBe(200); expect(r.json().data.document).toEqual(saved.document); expect(r.json().data.tracks).toEqual(saved.tracks); } finally { await app.close(); repo.close(); }
  });
  it('实际生成 PNG，局部台词修改只使对应分镜过期，其他缓存和链接保持有效', async () => {
    const doc = blankStudioDocument(); doc.segments.push({ ...structuredClone(doc.segments[0]), id: randomUUID(), title: '第二页', text: '第二条脚本', elements: [] }); const p = await project(doc), job = await preview(p); expect(job.status).toBe('queued'); await runStudioPreview(h.repo, h.config);
    const ready = await readProject(p.id); expect(ready.frames.filter(f => f.status === 'ready')).toHaveLength(2); const [first, second] = doc.segments.map(s => ready.frames.find(f => f.segmentId === s.id)!);
    const bytes = await get(first.url.replace('/api/v1', '')); expect(bytes.statusCode).toBe(200); expect(bytes.rawPayload.subarray(0, 8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));
    const next = structuredClone(doc); next.segments[0].text = '只更改第一句'; const edited = await good('/studio/projects/' + p.id + '/save', { version: p.version, name: p.name, document: next }) as StudioProject;
    expect(edited.frames.find(f => f.segmentId === doc.segments[0].id)?.status).toBe('stale'); expect(edited.frames.find(f => f.segmentId === doc.segments[1].id)).toMatchObject({ id: second.id, status: 'ready', fingerprint: second.fingerprint }); expect((await get(first.url.replace('/api/v1', ''))).statusCode).toBe(409); expect((await get(second.url.replace('/api/v1', ''))).statusCode).toBe(200);
    await preview(edited, [next.segments[0].id]); await runStudioPreview(h.repo, h.config); expect((await readProject(p.id)).frames.filter(f => f.status === 'ready')).toHaveLength(2);
  });
  it('旧版本保存不覆盖其他窗口，恢复历史创建新修订，归档与恢复均有记录', async () => {
    const p = await project(), doc = structuredClone(p.document); doc.segments[0].text = '当前新内容'; const saved = await good('/studio/projects/' + p.id + '/save', { version: 1, name: '新修订', document: doc });
    expect((await post('/studio/projects/' + p.id + '/save', { version: 1, name: '旧窗口', document: p.document })).statusCode).toBe(409); expect((await readProject(p.id)).name).toBe('新修订');
    const restored = await good('/studio/projects/' + p.id + '/restore', { version: saved.version, revision: 1 }); expect(restored.version).toBe(3); expect(restored.document).toEqual(p.document);
    const archived = await good('/studio/projects/' + p.id + '/archive', { version: 3, archived: true }); expect((await post('/studio/projects/' + p.id + '/save', { version: archived.version, name: p.name, document: p.document })).statusCode).toBe(409); await good('/studio/projects/' + p.id + '/archive', { version: 4, archived: false });
    expect((await get('/studio/projects/' + p.id + '/versions')).json().data.map((v: { version: number }) => v.version)).toEqual([5,4,3,2,1]);
  });
  it('模板变量实际套用，未知/缺失/过长值拒绝，不执行脚本，版本更新需重新选择', async () => {
    const p = await project(), doc = structuredClone(p.document); doc.segments[0].text = '{{script}}'; const input = { workspaceId: f.workspaceA, name: '自有模板', description: '合成模板', purpose: 'video', document: doc, variables: [{ key: 'script', label: '文案', required: true, defaultValue: '', maxLength: 80 }], licenseNote: '本项目原创合成布局', rightsConfirmed: true }, template = await good('/studio/templates', input);
    const base = { workspaceId: f.workspaceA, name: '套用模板', purpose: 'video', templateId: template.id, templateVersion: 1 };
    expect((await post('/studio/projects', { ...base, variables: {} })).statusCode).toBe(400); expect((await post('/studio/projects', { ...base, variables: { unknown: 'test' } })).statusCode).toBe(400);
    const expanded = await good('/studio/projects', { ...base, variables: { script: '<script>not executed</script>' } }); expect(expanded.document.segments[0].text).toBe('<script>not executed</script>'); expect(expanded.document.segments[0].id).not.toBe(doc.segments[0].id);
    await good('/studio/templates/' + template.id + '/update', { ...input, workspaceId: undefined, version: 1, name: '新版模板' }); expect((await post('/studio/projects', { ...base, variables: { script: '旧版本' } })).statusCode).toBe(409);
  });
  it('品牌素材持久化且不改写已有工程，跨租户/工作空间/类型和只读写入被拒绝', async () => {
    const p = await project(), brand = await good('/studio/brands', { workspaceId: f.workspaceA, name: '合成品牌', style: { ...p.document.brand, logoAssetId: f.avatarA }, licenseNote: '原创合成图像', rightsConfirmed: true }); expect(brand.style.logoAssetId).toBe(f.avatarA);
    await good('/studio/brands/' + brand.id + '/update', { version: 1, name: '新品牌', style: { ...brand.style, primaryColor: '#AA2233' }, licenseNote: '原创', rightsConfirmed: true }); expect((await readProject(p.id)).document.brand).toEqual(p.document.brand);
    const other = await h.login(f.adminB), viewer = await h.login(f.viewerA); expect((await get('/studio/projects/' + p.id, other)).statusCode).toBe(404); expect((await post('/studio/projects', { workspaceId: f.workspaceA, name: '越权', purpose: 'video' }, viewer)).statusCode).toBe(403);
    const bad = structuredClone(p.document); bad.brand.logoAssetId = f.avatarB; expect((await post('/studio/projects/' + p.id + '/save', { version: 1, name: p.name, document: bad })).statusCode).toBe(404);
    expect((await post('/studio/brands', { workspaceId: f.workspaceA, name: '错类型', style: { ...p.document.brand, logoAssetId: f.voiceA }, licenseNote: '测试', rightsConfirmed: true })).statusCode).toBe(409);
  });
  it('生成期间工程变化使迟到 PNG 无法提交，未确认或过期计划不能启动', async () => {
    const p = await project(), plan = await good('/studio/projects/' + p.id + '/plan', { version: 1 });
    expect((await post('/studio/projects/' + p.id + '/previews', { version: 1, planHash: plan.hash, confirmed: false, segmentIds: [p.document.segments[0].id] })).statusCode).toBe(400);
    await preview(p); let release!: () => void, started!: () => void; const held = new Promise<void>(r => { release = r; }), ready = new Promise<void>(r => { started = r; }), render = storyboard.renderStoryboard;
    vi.spyOn(storyboard, 'renderStoryboard').mockImplementation(async (...args) => { started(); await held; return render(...args); }); const work = runStudioPreview(h.repo, h.config); await ready;
    const changed = structuredClone(p.document); changed.segments[0].text = '新台词'; await good('/studio/projects/' + p.id + '/save', { version: 1, name: p.name, document: changed }); release(); await work;
    expect(h.repo.get('SELECT status FROM studio_preview_jobs WHERE project_id=?', p.id)).toMatchObject({ status: 'failed' }); expect((await readProject(p.id)).frames).toHaveLength(0);
    expect((await post('/studio/projects/' + p.id + '/previews', { version: 1, planHash: plan.hash, confirmed: true, segmentIds: [p.document.segments[0].id] })).statusCode).toBe(409);
  });
});
describe('T08 持久化文档导入与选页审阅', () => {
  it('PPTX 真正解析、审阅所选页再建工程，文字/图片/备注均可继续编辑', async () => {
    const bytes = pptxFixture(), job = await importDoc('pptx', bytes); expect(job.status).toBe('queued'); await runStudioImport(h.repo, h.config); const result = await readImport(job.id); expect(result.status).toBe('review'); expect(result.pages).toHaveLength(2);
    const p = await good('/studio/imports/' + job.id + '/apply', { version: result.version, name: '备注分镜', pageIds: [result.pages[0].id], purpose: 'presentation', narrationFrom: 'notes', confirmed: true }) as StudioProject;
    expect(p.document.segments[0].text).toContain('本页演讲者备注 1'); expect(p.document.segments[0].elements.some(e => e.type === 'image')).toBe(true); await preview(p); await runStudioPreview(h.repo, h.config); expect((await readProject(p.id)).frames[0].status).toBe('ready');
    expect((await post('/studio/imports/' + job.id + '/cancel', { version: result.version })).json().error.code).toBe('SOURCE_IN_USE'); expect((await get('/studio/imports/' + job.id + '/source')).rawPayload).toEqual(bytes);
  });
  it('PDF 真正分页、提供参考 PNG，与可编辑分镜区分；取消的来源不能读取', async () => {
    const input = await importDoc('pdf', await pdfFixture()); await runStudioImport(h.repo, h.config); const result = await readImport(input.id); expect(result.status).toBe('review'); expect(result.pages[0].text).toContain('Synthetic PDF page 1');
    expect((await get('/studio/import-media/' + result.pages[0].referenceMediaId)).statusCode).toBe(200); const cancelled = await good('/studio/imports/' + input.id + '/cancel', { version: result.version }); expect(cancelled.pages).toHaveLength(0); expect((await get('/studio/import-media/' + result.pages[0].referenceMediaId)).statusCode).toBe(409);
  });
  it('未同意来源权利、假扩展名、跨组织源页、已取消任务或恶意宏不能绕过审阅', async () => {
    const bytes = pptxFixture(); expect((await post('/studio/imports', { workspaceId: f.workspaceA, name: '未授权', fileName: 'test.pptx', contentBase64: bytes.toString('base64'), rightsNote: '测试', rightsConfirmed: false })).statusCode).toBe(400);
    expect((await post('/studio/imports', { workspaceId: f.workspaceA, name: '错格式', fileName: '../test.pdf', contentBase64: bytes.toString('base64'), rightsNote: '合成', rightsConfirmed: true })).statusCode).toBe(422);
    const job = await importDoc('pptx', bytes), other = await h.login(f.adminB); expect((await get('/studio/imports/' + job.id, other)).statusCode).toBe(404); await good('/studio/imports/' + job.id + '/cancel', { version: job.version }); expect(await runStudioImport(h.repo, h.config)).toBe(false);
    const macro = await importDoc('pptx', pptxFixture({ macro: true })); await runStudioImport(h.repo, h.config); expect((await readImport(macro.id)).status).toBe('failed'); expect(h.repo.get<{ n: number }>('SELECT count(*) n FROM studio_import_media WHERE import_id=?', macro.id)!.n).toBe(0);
  });
});
describe('T08 专项授权的模拟克隆验收', () => {
  it('形象和声音分别授权、模拟训练、原始参考预览和明确验收，不声称实际克隆', async () => {
    for (const kind of ['avatar','voice'] as const) { const c = await clone(kind); expect(c.status).toBe('training'); expect((await post('/studio/clones/' + c.id + '/control', { version: c.version, action: 'accept', confirmed: true })).statusCode).toBe(409); await runOne(h.repo, 'mock'); const review = await readClone(c.id); expect(review.status).toBe('awaiting_review'); const accepted = await good('/studio/clones/' + c.id + '/control', { version: review.version, action: 'accept', confirmed: true }); expect(accepted).toMatchObject({ status: 'accepted', simulated: true, readyForRealService: false }); expect((await get(accepted.previewUrl.replace('/api/v1',''))).statusCode).toBe(200); }
  });
  it('撤回专项授权会撤销已验收模拟参考，并阻止旧帧、旧计划与历史恢复继续使用', async () => {
    const c = await clone(); await runOne(h.repo, 'mock'); const review = await readClone(c.id), accepted = await good('/studio/clones/' + c.id + '/control', { version: review.version, action: 'accept', confirmed: true }), doc = blankStudioDocument(); doc.speakers[0].avatarAssetId = accepted.assetId; doc.speakers[0].avatarCloneId = c.id;
    const p = await project(doc); await preview(p); await runStudioPreview(h.repo, h.config); const frame = (await readProject(p.id)).frames[0]; expect((await get(frame.url.replace('/api/v1',''))).statusCode).toBe(200);
    await good('/consents/' + c.consentId + '/revoke', {}); expect((await readClone(c.id)).status).toBe('revoked'); expect((await get(frame.url.replace('/api/v1',''))).statusCode).toBe(409); expect((await good('/studio/projects/' + p.id + '/plan', { version: 1 })).canPreview).toBe(false); expect((await post('/studio/projects/' + p.id + '/restore', { version: 1, revision: 1 })).statusCode).toBe(409);
  });
  it('未知任务需要显式新建模拟重试，拒绝后可重做，重复提交不产生第二项训练', async () => {
    const c = await clone('voice', 'unknown'); await runOne(h.repo, 'mock'); const unknown = await readClone(c.id); expect(unknown.status).toBe('unknown'); expect(await runOne(h.repo, 'mock')).toBe(false);
    const payload = { version: unknown.version, action: 'retry', confirmed: true }, key = randomUUID(); const a = await post('/studio/clones/' + c.id + '/control', payload, h.headers, key), b = await post('/studio/clones/' + c.id + '/control', payload, h.headers, key); expect(a.statusCode).toBe(200); expect(b.statusCode).toBe(200); expect(h.repo.get<{ n: number }>('SELECT count(*) n FROM jobs')!.n).toBe(2);
    await runOne(h.repo, 'mock'); const review = await readClone(c.id); const rejected = await good('/studio/clones/' + c.id + '/control', { version: review.version, action: 'reject', confirmed: true }); expect(rejected.status).toBe('rejected');
  });
});
