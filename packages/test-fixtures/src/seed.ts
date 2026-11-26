import { randomUUID, createHash } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Repository } from '@digitalguide/database';
import { inspectMedia, syntheticPng } from '@digitalguide/media';

export const fixtureIds = {
  tenantA: '10000000-0000-4000-8000-000000000001', tenantB: '10000000-0000-4000-8000-000000000002',
  workspaceA: '20000000-0000-4000-8000-000000000001', workspacePrivate: '20000000-0000-4000-8000-000000000002', workspaceB: '20000000-0000-4000-8000-000000000003',
  adminA: '30000000-0000-4000-8000-000000000001', editorA: '30000000-0000-4000-8000-000000000002', viewerA: '30000000-0000-4000-8000-000000000003', reviewerA: '30000000-0000-4000-8000-000000000005', adminB: '30000000-0000-4000-8000-000000000004',
  avatarA: '40000000-0000-4000-8000-000000000001', voiceA: '40000000-0000-4000-8000-000000000002', privateAsset: '40000000-0000-4000-8000-000000000003', avatarB: '40000000-0000-4000-8000-000000000004'
};
export function syntheticWav() {
  const dataSize = 16000, wav = Buffer.alloc(44 + dataSize);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < dataSize / 2; i++) wav.writeInt16LE(Math.round(Math.sin(i / 8000 * Math.PI * 440 * 2) * 1600), 44 + i * 2);
  return wav;
}
export function seed(repo: Repository) {
  repo.transaction(() => {
    const f = fixtureIds;
    for (const [id, name] of [[f.tenantA, '星屿科技 · 演示组织'], [f.tenantB, '青禾餐饮 · 隔离测试组织']]) repo.run('INSERT OR IGNORE INTO tenants(id,name) VALUES (?,?)', id, name);
    for (const [id, tenantId, name] of [[f.workspaceA, f.tenantA, '品牌与接待'], [f.workspacePrivate, f.tenantA, '内部研发'], [f.workspaceB, f.tenantB, '餐饮运营']]) {
      repo.run('INSERT OR IGNORE INTO workspaces VALUES (?,?,?)', id, tenantId, name);
      if (!repo.get('SELECT id FROM venues WHERE workspace_id=?', id)) repo.run('INSERT INTO venues VALUES (?,?,?,?,?)', randomUUID(), tenantId, id, name + '演示场所', 'Asia/Shanghai');
    }
    for (const [id, name, tenantId, role, workspaces] of [
      [f.adminA, '林知 · 管理员', f.tenantA, 'admin', [f.workspaceA, f.workspacePrivate]],
      [f.editorA, '陈墨 · 内容编辑', f.tenantA, 'editor', [f.workspaceA]],
      [f.viewerA, '许宁 · 只读成员', f.tenantA, 'viewer', [f.workspaceA]],
      [f.reviewerA, '顾言 · 审核员', f.tenantA, 'reviewer', [f.workspaceA]],
      [f.adminB, '沈禾 · 餐饮管理员', f.tenantB, 'admin', [f.workspaceB]]
    ] as const) {
      repo.run('INSERT OR IGNORE INTO users VALUES (?,?)', id, name);
      repo.run('INSERT OR IGNORE INTO memberships VALUES (?,?,?,?)', id, tenantId, role, JSON.stringify(workspaces));
    }
    for (const [id, tenantId, workspaceId, userId, publicName] of [
      ['50000000-0000-4000-8000-000000000001', f.tenantA, f.workspaceA, f.adminA, '林知'],
      ['50000000-0000-4000-8000-000000000002', f.tenantA, f.workspaceA, f.editorA, '陈墨'],
      ['50000000-0000-4000-8000-000000000003', f.tenantB, f.workspaceB, f.adminB, '沈禾']
    ]) repo.run('INSERT OR IGNORE INTO reception_hosts(id,tenant_id,workspace_id,user_id,public_name) VALUES (?,?,?,?,?)', id, tenantId, workspaceId, userId, publicName);
    for (const [id, tenantId, workspaceId, name, category, buffer] of [
      [f.avatarA, f.tenantA, f.workspaceA, '小屿 · 合成形象参考', 'avatar', syntheticPng()],
      [f.voiceA, f.tenantA, f.workspaceA, '提示音 · 合成测试音频', 'voice', syntheticWav()],
      [f.privateAsset, f.tenantA, f.workspacePrivate, '内部工作空间测试素材', 'background', syntheticPng([85, 75, 110])],
      [f.avatarB, f.tenantB, f.workspaceB, '青禾 · 合成形象参考', 'avatar', syntheticPng([90, 95, 50])]
    ] as const) {
      if (repo.get('SELECT id FROM assets WHERE id=?', id)) continue;
      const uploadId = randomUUID(), now = new Date().toISOString(), key = uploadId + '.bin', specs = inspectMedia(buffer);
      if (!existsSync(path.join(repo.dataDir, 'objects', key))) writeFileSync(path.join(repo.dataDir, 'objects', key), buffer, { flag: 'wx' });
      repo.run('INSERT INTO uploads VALUES (?,?,?,?,?,?,?,?,?,?)', uploadId, tenantId, workspaceId, f.adminA, key, createHash('sha256').update(buffer).digest('hex'), buffer.length, specs.mediaType, JSON.stringify(specs.specs), now);
      repo.run('INSERT INTO assets(id,tenant_id,workspace_id,upload_id,name,category,synthetic,created_at) VALUES (?,?,?,?,?,?,1,?)', id, tenantId, workspaceId, uploadId, name, category, now);
      repo.run('INSERT INTO asset_versions VALUES (?,?,?,?)', id, 1, JSON.stringify({ name, category, synthetic: true }), now);
    }
  });
}
