import { it,expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Repository } from '@digitalguide/database';
import { seed,fixtureIds as f } from '../../packages/test-fixtures/src/seed.js';
import { hasPermission } from '@digitalguide/domain';
it('018升级保留已有组织、角色和工作空间授权，新增审核员不会继承编辑权限',() => {
  const folder = path.resolve('storage/test-runs/upgrade-'+randomUUID()),oldRoot = path.join(folder,'old'),data = path.join(folder,'data'),migrations = path.join(oldRoot,'migrations/sqlite');fs.mkdirSync(migrations,{ recursive: true });for (const name of fs.readdirSync('migrations/sqlite').filter(n => n.endsWith('.sql') && n < '018-')) fs.copyFileSync(path.join('migrations/sqlite',name),path.join(migrations,name));
  const before = new Repository(data,oldRoot);seed(before);const initial = before.all('SELECT * FROM memberships ORDER BY user_id');before.close();const after = new Repository(data,process.cwd());try { expect(after.all('SELECT * FROM memberships ORDER BY user_id')).toEqual(initial);seed(after);expect(after.principal(f.reviewerA)).toMatchObject({ role: 'reviewer',workspaceIds: [f.workspaceA] });expect(hasPermission(after.principal(f.reviewerA),'studio.write')).toBe(false);expect(hasPermission(after.principal(f.reviewerA),'studio.approve')).toBe(true);expect(after.principal(f.adminA).workspaceIds).toEqual([f.workspaceA,f.workspacePrivate]); } finally { after.close(); }
});
