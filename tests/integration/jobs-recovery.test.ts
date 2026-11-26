import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Repository } from '@digitalguide/database';
import { jobSchema } from '@digitalguide/contracts';
import { runOne, dispatchOutbox } from '../../apps/worker/src/runner.js';
import { MockTaskProvider, type TaskProvider } from '@digitalguide/providers';
import { fixtureIds as f, seed } from '../../packages/test-fixtures/src/seed.js';
import { harness } from './helpers.js';
let h: Awaited<ReturnType<typeof harness>>;
beforeEach(async () => { h = await harness(); }); afterEach(async () => { await h.close(); });
async function submit(simulate = 'success', key = randomUUID()) {
  const result = await h.app.inject({ method: 'POST', url: '/api/v1/jobs', headers: { ...h.headers, 'idempotency-key': key }, payload: { workspaceId: f.workspaceA, kind: 'provider.check', simulate } });
  expect(result.statusCode).toBe(202); return result.json().data.id as string;
}
describe('持久队列、事务与失败处理', () => {
  it('并发重复请求只创建一个任务与 outbox 事件，重新打开数据库可恢复', async () => {
    const key = randomUUID(), ids = await Promise.all(Array.from({ length: 12 }, () => submit('success', key)));
    expect(new Set(ids).size).toBe(1);
    const reopened = new Repository(h.config.dataDir); seed(reopened);
    expect(reopened.get<{ n: number }>('SELECT count(*) AS n FROM jobs')!.n).toBe(1);
    await runOne(reopened, 'mock'); reopened.close();
    expect(h.repo.job(h.repo.principal(f.adminA), ids[0]).status).toBe('succeeded');
    expect(jobSchema.safeParse(h.repo.job(h.repo.principal(f.adminA), ids[0])).success).toBe(true);
    expect(h.repo.get<{ n: number }>('SELECT count(*) AS n FROM provider_usage')!.n).toBe(1);
    dispatchOutbox(h.repo, 'mock'); dispatchOutbox(h.repo, 'mock');
    expect(h.repo.get<{ n: number }>('SELECT count(*) AS n FROM event_deliveries')!.n).toBe(2);
  });
  it('过期租约能接管；首次瞬态失败重试，实际用量只记一次', async () => {
    const jobId = await submit('transient_failure');
    await runOne(h.repo, 'mock'); expect(h.repo.job(h.repo.principal(f.adminA), jobId).status).toBe('retrying');
    h.repo.run("UPDATE jobs SET available_at='2000-01-01T00:00:00.000Z' WHERE id=?", jobId);
    await runOne(h.repo, 'mock'); expect(h.repo.job(h.repo.principal(f.adminA), jobId).attempts).toBe(2);
    expect(h.repo.get<{ n: number }>('SELECT count(*) AS n FROM provider_usage')!.n).toBe(1);
    const lost = await submit();
    h.repo.run("UPDATE jobs SET status='running',attempts=1,lease_token='dead-worker',lease_until='2000-01-01T00:00:00.000Z' WHERE id=?", lost);
    await runOne(h.repo, 'mock'); expect(h.repo.job(h.repo.principal(f.adminA), lost).status).toBe('succeeded');
  });
  it('取消排队或运行中任务时不提交成功回执，不记用量', async () => {
    const jobId = await submit();
    const blocked: TaskProvider = { capabilities: new MockTaskProvider().capabilities, lookup: async () => null, execute: async () => {
      const result = await h.app.inject({ method: 'POST', url: '/api/v1/jobs/' + jobId + '/cancel', headers: { ...h.headers, 'idempotency-key': randomUUID() }, payload: {} });
      expect(result.json().data.status).toBe('cancellation_requested'); return { simulated: true, provider: 'mock-local', remoteId: 'mock:' + jobId, operation: 'provider.check', message: 'cancel test' };
    } };
    await runOne(h.repo, 'mock', blocked);
    expect(h.repo.job(h.repo.principal(f.adminA), jobId).status).toBe('cancelled');
    expect(h.repo.get<{ n: number }>('SELECT count(*) AS n FROM provider_usage')!.n).toBe(0);
  });
  it('未知结果不会重发；环境、任务及用量隔离', async () => {
    const jobId = await submit('unknown'); await runOne(h.repo, 'mock');
    expect(h.repo.job(h.repo.principal(f.adminA), jobId).status).toBe('unknown');
    expect(await runOne(h.repo, 'mock')).toBe(false);
    expect(dispatchOutbox(h.repo, 'live')).toBe(0);
    const other = await h.login(f.adminB);
    expect((await h.app.inject({ url: '/api/v1/jobs/' + jobId, headers: other })).statusCode).toBe(404);
    expect((await h.app.inject({ url: '/api/v1/jobs', headers: other })).json().data.items).toHaveLength(0);
    expect((await h.app.inject({ url: '/api/v1/provider-usage', headers: other })).json().data.items).toHaveLength(0);
  });
  it('训练授权必须匹配用途和素材；入队后撤回会阻止 worker', async () => {
    const headers = () => ({ ...h.headers, 'idempotency-key': randomUUID() });
    const job = { workspaceId: f.workspaceA, kind: 'training.avatar', assetId: f.avatarA };
    expect((await h.app.inject({ method: 'POST', url: '/api/v1/jobs', headers: headers(), payload: job })).json().error.code).toBe('CONSENT_REQUIRED');
    const proof = 'synthetic-authorized-proof-marker';
    const consent = await h.app.inject({ method: 'POST', url: '/api/v1/assets/' + f.avatarA + '/consents', headers: headers(), payload: { purpose: 'train_avatar', subject: '虚构测试角色', proof, expiresAt: new Date(Date.now() + 3600000).toISOString(), noticeVersion: 'local-v1' } });
    expect(consent.statusCode).toBe(201); const consentId = consent.json().data.id;
    const created = await h.app.inject({ method: 'POST', url: '/api/v1/jobs', headers: headers(), payload: { ...job, consentId } }); expect(created.statusCode).toBe(202);
    await h.app.inject({ method: 'POST', url: '/api/v1/consents/' + consentId + '/revoke', headers: headers(), payload: {} });
    await runOne(h.repo, 'mock'); expect(h.repo.job(h.repo.principal(f.adminA), created.json().data.id).errorCode).toBe('CONSENT_REQUIRED');
    expect((await h.app.inject({ url: '/api/v1/audit-events', headers: h.headers })).body).not.toContain(proof);
  });
  it('每日限额在提交事务中检查；连续失败触发熔断，冷却后可恢复', async () => {
    for (let i = 0; i < 3; i++) { await submit('permanent_failure'); await runOne(h.repo, 'mock'); }
    const headers = { ...h.headers, 'idempotency-key': randomUUID() }, payload = { workspaceId: f.workspaceA, kind: 'provider.check' };
    expect((await h.app.inject({ method: 'POST', url: '/api/v1/jobs', headers, payload })).json().error.code).toBe('PROVIDER_CIRCUIT_OPEN');
    h.repo.run("UPDATE provider_health SET open_until='2000-01-01T00:00:00.000Z'");
    await submit(); await runOne(h.repo, 'mock');
    expect((await h.app.inject({ url: '/api/v1/capabilities', headers: h.headers })).json().data[0].circuit).toBe('closed');
    h.repo.run('UPDATE tenants SET daily_limit=4 WHERE id=?', f.tenantA);
    expect((await h.app.inject({ method: 'POST', url: '/api/v1/jobs', headers: { ...headers, 'idempotency-key': randomUUID() }, payload })).json().error.code).toBe('QUOTA_EXCEEDED');
  });
  it('过期 worker 的迟到结果不能覆盖接管者或重复记账', async () => {
    const jobId = await submit(); let release: () => void = () => {};
    const wait = new Promise<void>(resolve => { release = resolve; });
    const slow: TaskProvider = { capabilities: new MockTaskProvider().capabilities, lookup: async () => null, execute: async () => { await wait; return { simulated: true, provider: 'mock-local', remoteId: 'stale-result', operation: 'provider.check', message: 'stale' }; } };
    const staleRun = runOne(h.repo, 'mock', slow);
    h.repo.run("UPDATE jobs SET lease_until='2000-01-01T00:00:00.000Z' WHERE id=?", jobId);
    const second = new Repository(h.config.dataDir);
    try { await runOne(second, 'mock'); } finally { second.close(); release(); }
    await staleRun;
    const job = h.repo.job(h.repo.principal(f.adminA), jobId);
    expect(job.result?.remoteId).toBe('mock:' + jobId); expect(job.attempts).toBe(2);
    expect(h.repo.get<{ n: number }>('SELECT count(*) AS n FROM provider_usage')!.n).toBe(1);
  });
  it('并发额度包含取消中的租约，不阻塞另一个租户的可用任务', async () => {
    const occupied = [await submit(), await submit(), await submit()]; const waiting = await submit();
    for (const [index, jobId] of occupied.entries()) h.repo.run('UPDATE jobs SET status=?,lease_token=?,lease_until=? WHERE id=?', index === 0 ? 'cancellation_requested' : 'running', randomUUID(), new Date(Date.now() + 60000).toISOString(), jobId);
    const other = await h.login(f.adminB);
    const b = await h.app.inject({ method: 'POST', url: '/api/v1/jobs', headers: { ...other, 'idempotency-key': randomUUID() }, payload: { workspaceId: f.workspaceB, kind: 'provider.check' } }); expect(b.statusCode).toBe(202);
    await runOne(h.repo, 'mock');
    expect(h.repo.job(h.repo.principal(f.adminA), waiting).status).toBe('queued');
    expect(h.repo.job(h.repo.principal(f.adminB), b.json().data.id).status).toBe('succeeded');
  });
  it('重启清理取消租约或重试耗尽时，状态和 outbox 同步持久化', async () => {
    const cancelled = await submit(), exhausted = await submit();
    h.repo.run("UPDATE jobs SET status='cancellation_requested',lease_until='2000-01-01T00:00:00.000Z' WHERE id=?", cancelled);
    h.repo.run("UPDATE jobs SET status='running',attempts=3,lease_until='2000-01-01T00:00:00.000Z' WHERE id=?", exhausted);
    expect(await runOne(h.repo, 'mock')).toBe(false);
    expect(h.repo.job(h.repo.principal(f.adminA), cancelled).status).toBe('cancelled');
    expect(h.repo.job(h.repo.principal(f.adminA), exhausted).errorCode).toBe('RETRY_EXHAUSTED');
    expect(h.repo.get<{ n: number }>("SELECT count(*) AS n FROM outbox_events WHERE type IN ('job.cancelled','job.failed')")!.n).toBe(2);
  });
});
