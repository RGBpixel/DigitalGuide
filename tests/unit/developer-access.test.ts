import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { developerCreateInput, developerIssueInput, developerPageInput, developerViewSchema } from '../../packages/contracts/src/developer-access.js';
import { createDeveloperCredential, developerCredentialHash, developerHashMatches, parseDeveloperAuthorization } from '../../packages/enterprise/src/developer-credentials.js';
import { openapi } from '../../packages/contracts/src/index.js';
describe('开发者凭证与公开接入契约', () => {
  it('创建要求明确确认和具体不重复范围，不能提交租户、角色或额外权限', () => {
    const input = { workspaceId: randomUUID(), name: '合成开发者应用', scopes: ['projects.read'], confirmed: true };
    expect(developerCreateInput.safeParse(input).success).toBe(true);
    for (const extra of [{ confirmed: false }, { scopes: [] }, { scopes: ['projects.read', 'projects.read'] }, { scopes: ['jobs.write'] }, { tenantId: randomUUID() }, { role: 'admin' }]) expect(developerCreateInput.safeParse({ ...input, ...extra }).success).toBe(false);
  });
  it('凭证期限与列表容量有界，查询不能扩大空间或携带密钥', () => {
    const input = { workspaceId: randomUUID(), appId: randomUUID(), expectedVersion: 1, termDays: 30, confirmed: true };
    expect(developerIssueInput.safeParse(input).success).toBe(true);
    expect(developerIssueInput.safeParse({ ...input, termDays: 365 }).success).toBe(false);
    for (const value of [{ limit: 101 }, { workspaceId: randomUUID() }, { token: 'not-a-supported-query-credential' }]) expect(developerPageInput.safeParse(value).success).toBe(false);
  });
  it('完整密钥与持久摘要分开，绑定凭证编号并拒绝非Bear​​er及截断密钥', () => {
    const a = createDeveloperCredential(), b = createDeveloperCredential(), parsed = parseDeveloperAuthorization('Bearer ' + a.token);
    expect(a.id).not.toBe(b.id); expect(a.hash).not.toBe(b.hash); expect(parsed).toEqual({ id: a.id, hash: a.hash });
    expect(developerHashMatches(a.hash, parsed!.hash)).toBe(true); expect(developerHashMatches(null, a.hash)).toBe(false);
    expect(developerCredentialHash(b.id, a.token.split('.')[1])).not.toBe(a.hash);
    expect(parseDeveloperAuthorization(a.token)).toBeNull(); expect(parseDeveloperAuthorization('Bearer ' + a.token.slice(0, -1))).toBeNull();
    expect(JSON.stringify(parsed)).not.toContain(a.token); expect(a.hash).toMatch(/^[a-f0-9]{64}$/);
  });
  it('公开接口使用独立Bearer方案及正确服务地址，管理接口仍要求人员会话', () => {
    const machine = openapi.paths['/open/v1/projects'] as { servers: { url: string }[]; get: { security: unknown[] } };
    expect(machine.servers).toEqual([{ url: '/api' }]); expect(machine.get.security).toEqual([{ developerBearer: [] }]);
    expect((openapi.paths['/enterprise/developers'] as { get: { security: unknown[] } }).get.security).toEqual([{ session: [] }]);
    expect(developerViewSchema.shape.writesSupported.safeParse(true).success).toBe(true);
    expect(developerViewSchema.shape.writesSupported.safeParse(false).success).toBe(true);
    expect(developerViewSchema.shape.writesSupported.safeParse('true').success).toBe(false);
  });
});
