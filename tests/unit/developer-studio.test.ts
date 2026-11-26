import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { developerStudioCreateInput, developerStudioGrantInput } from '../../packages/contracts/src/developer-studio.js';
import { developerStudioFileFingerprint, developerStudioRange, openDeveloperStudioFile } from '../../apps/api/src/developer-studio-files.js';
import type { DeveloperStudioFile } from '../../apps/api/src/developer-studio-ports.js';

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
function fixture() {
  const root = path.resolve('storage/test-runs/developer-studio-unit-' + randomUUID());
  fs.mkdirSync(path.join(root, 'objects'), { recursive: true });
  const bytes = Buffer.alloc(600_001, 42), storageKey = randomUUID() + '.json';
  const file: DeveloperStudioFile = { exportId: randomUUID(), artifactId: randomUUID(), projectId: randomUUID(), projectVersion: 1, storageKey, size: bytes.length, sha256: digest(bytes), name: '合成文件.json', mediaType: 'application/json' };
  const target = path.join(root, 'objects', storageKey); fs.writeFileSync(target, bytes);
  return { root, bytes, file, target };
}

describe('独立应用制作委托和文件核对', () => {
  it('机器创建工程不能注入空间，且继承原工程的互斥来源校验', () => {
    const input = { name: '合成工程', purpose: 'video', confirmed: true };
    expect(developerStudioCreateInput.safeParse(input).success).toBe(true);
    expect(developerStudioCreateInput.safeParse({ ...input, workspaceId: randomUUID() }).success).toBe(false);
    expect(developerStudioCreateInput.safeParse({ ...input, confirmed: false }).success).toBe(false);
    const document = { schemaVersion: 1, canvas: { width: 640, height: 360, fps: 30 }, brand: { primaryColor: '#000000', accentColor: '#111111', textColor: '#ffffff', fontFamily: 'sans' }, speakers: [], segments: [{ id: randomUUID(), title: '测试', speakerId: null, text: '合成文字', durationMs: 1000, elements: [], backgroundColor: '#000000', avatar: { x: 0, y: 0, width: 1, height: 1 } }] };
    expect(developerStudioCreateInput.safeParse({ ...input, document }).success).toBe(true);
    expect(developerStudioCreateInput.safeParse({ ...input, templateId: randomUUID() }).success).toBe(true);
    expect(developerStudioCreateInput.safeParse({ ...input, document, templateId: randomUUID() }).success).toBe(false);
  });

  it('委托需要明确确认、版本和有界动作，拒绝租户或身份注入', () => {
    const input = { workspaceId: randomUUID(), appId: randomUUID(), expectedAppVersion: 1, expectedVersion: 0, responsibleUserId: randomUUID(), actions: ['projects.write'], enabled: true, termDays: 30, confirmed: true };
    expect(developerStudioGrantInput.safeParse(input).success).toBe(true);
    for (const change of [{ confirmed: false }, { actions: [] }, { actions: ['projects.write', 'projects.write'] }, { actions: ['payments.submit'] }, { termDays: 365 }, { tenantId: randomUUID() }, { actorId: randomUUID() }, { expectedAppVersion: 0 }, { responsibleConfigurationToken: 'invalid' }]) expect(developerStudioGrantInput.safeParse({ ...input, ...change }).success).toBe(false);
  });

  it('单段字节范围支持首尾、后缀、开放结尾和强摘要 If-Range', () => {
    const sha = 'a'.repeat(64);
    expect(developerStudioRange(100, undefined, undefined, sha)).toEqual({ start: 0, end: 99, length: 100, status: 200 });
    expect(developerStudioRange(100, 'bytes=10-19', undefined, sha)).toEqual({ start: 10, end: 19, length: 10, status: 206 });
    expect(developerStudioRange(100, 'bytes=-10', undefined, sha)).toEqual({ start: 90, end: 99, length: 10, status: 206 });
    expect(developerStudioRange(100, 'bytes=90-', '"' + sha + '"', sha)).toEqual({ start: 90, end: 99, length: 10, status: 206 });
    expect(developerStudioRange(100, 'bytes=90-1000', undefined, sha)?.end).toBe(99);
    expect(developerStudioRange(100, 'bytes=1-2', 'W/"' + sha + '"', sha)?.status).toBe(200);
    expect(developerStudioRange(0, undefined, undefined, sha)).toEqual({ start: 0, end: -1, length: 0, status: 200 });
  });

  it('拒绝多范围、越界和非安全整数，空文件没有有效字节范围', () => {
    for (const range of ['bytes=1-2,4-5', 'bytes=100-', 'bytes=99-98', 'bytes=-0', 'bytes=-', 'items=1-2', 'bytes=9007199254740993-', 'x'.repeat(201)]) expect(developerStudioRange(100, range, undefined, 'a'.repeat(64))).toBeNull();
    expect(developerStudioRange(0, 'bytes=0-', undefined, 'a'.repeat(64))).toBeNull();
    for (const size of [-1, 1.5, Number.MAX_SAFE_INTEGER]) expect(() => developerStudioRange(size, undefined, undefined, 'a'.repeat(64))).toThrow();
  });

  it('文件指纹绑定工程版本、文件标识、存储键、大小和摘要', () => {
    const x = fixture(), original = developerStudioFileFingerprint(x.file);
    expect(original).toMatch(/^[a-f0-9]{64}$/);
    for (const change of [{ projectVersion: 2 }, { artifactId: randomUUID() }, { storageKey: randomUUID() + '.json' }, { size: x.file.size - 1 }, { sha256: '0'.repeat(64) }]) expect(developerStudioFileFingerprint({ ...x.file, ...change })).not.toBe(original);
    expect(developerStudioFileFingerprint({ ...x.file })).toBe(original);
  });

  it('实际分块核对合成文件的完整摘要，并保留同一可读取文件句柄', async () => {
    const x = fixture(), opened = await openDeveloperStudioFile(x.root, x.file);
    try { expect(opened.size).toBe(x.bytes.length); const bytes = Buffer.alloc(17); await opened.handle.read(bytes, 0, 17, 300_000); expect(bytes).toEqual(x.bytes.subarray(300_000, 300_017)); }
    finally { await opened.handle.close(); }
  });

  it('实际文件同大小篡改、缺失或元数据大小不符时拒绝下载', async () => {
    const x = fixture();
    await expect(openDeveloperStudioFile(x.root, { ...x.file, size: x.file.size - 1 })).rejects.toMatchObject({ code: 'MEDIA_INTEGRITY', status: 409 });
    const bytes = Buffer.from(x.bytes); bytes[300_000] ^= 1; fs.writeFileSync(x.target, bytes);
    await expect(openDeveloperStudioFile(x.root, x.file)).rejects.toMatchObject({ code: 'MEDIA_INTEGRITY', status: 409 });
    await expect(openDeveloperStudioFile(x.root, { ...x.file, storageKey: randomUUID() + '.json' })).rejects.toMatchObject({ code: 'MEDIA_INTEGRITY', status: 409 });
  });

  it('拒绝越过对象目录的存储键和不合法摘要', async () => {
    const x = fixture();
    for (const change of [{ storageKey: '../outside.json' }, { storageKey: 'C:\\outside.json' }, { sha256: 'invalid' }, { size: -1 }]) await expect(openDeveloperStudioFile(x.root, { ...x.file, ...change })).rejects.toMatchObject({ code: 'MEDIA_INTEGRITY', status: 409 });
  });

  it('取消的下载在文件核对前中止，不转成完整性错误', async () => {
    const x = fixture(), controller = new AbortController(), reason = new Error('Synthetic download cancelled'); controller.abort(reason);
    await expect(openDeveloperStudioFile(x.root, x.file, controller.signal)).rejects.toBe(reason);
  });
});
