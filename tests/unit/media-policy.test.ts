import { describe, it, expect } from 'vitest';
import { inspectMedia, syntheticPng } from '@digitalguide/media';
import { AppError, assertUsableAsset, canonical, requirePermission, requireWorkspace } from '@digitalguide/domain';
import { syntheticWav } from '../../packages/test-fixtures/src/seed.js';
describe('媒体探测及服务端规则', () => {
  it('读取真实 PNG 像素与 PCM WAV 规格，拒绝伪造及损坏文件', () => {
    expect(inspectMedia(syntheticPng()).specs).toEqual({ width: 360, height: 240 });
    expect(inspectMedia(syntheticWav()).specs).toEqual({ channels: 1, sampleRate: 8000, durationMs: 1000 });
    expect(() => inspectMedia(Buffer.from('<svg><script>alert(1)</script></svg>'))).toThrow(AppError);
    const broken = syntheticPng(); broken[45] ^= 255;
    expect(() => inspectMedia(broken)).toThrow(AppError);
    const fake = syntheticWav(); fake.writeUInt32LE(2_000_000, 40);
    expect(() => inspectMedia(fake)).toThrow(AppError);
  });
  it('拒绝解压炸弹尺寸以及过期或回收的素材', () => {
    const huge = syntheticPng(); huge.writeUInt32BE(100000, 16);
    expect(() => inspectMedia(huge)).toThrow();
    expect(() => assertUsableAsset({ archived: true, expiresAt: null })).toThrow();
    expect(() => assertUsableAsset({ archived: false, expiresAt: '2000-01-01T00:00:00.000Z' })).toThrow();
  });
  it('只读账号和不在范围内的工作空间不能写入，身份候选不会参与权限', () => {
    const p = { userId: 'u', tenantId: 't', role: 'viewer' as const, workspaceIds: ['w'] };
    expect(() => requirePermission(p, 'asset.train')).toThrow();
    expect(() => requireWorkspace(p, 'other')).toThrow();
    expect(() => requirePermission(p, 'asset.read')).not.toThrow();
    expect(canonical({ b: 2, a: { y: 1, x: 0 } })).toBe(canonical({ a: { x: 0, y: 1 }, b: 2 }));
  });
});
