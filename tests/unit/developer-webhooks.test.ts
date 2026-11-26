import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { webhookCreateInput, webhookControlInput, webhookWireSchema } from '../../packages/contracts/src/developer-webhooks.js';
import { WebhookRuntime } from '../../packages/enterprise/src/webhook-runtime.js';
import { webhookBodyHash, webhookSignature, verifyWebhookSignature } from '../../packages/enterprise/src/webhook-signature.js';
import { webhookFinalState, webhookSourceAllowed } from '../../packages/enterprise/src/webhook-queue.js';
import { sendWebhook } from '../../packages/enterprise/src/webhook-transport.js';
function configuration() {
  const root = path.resolve('storage/webhook-unit/' + randomUUID()), dataDir = path.join(root, 'data'), secretFile = path.join(root, 'receiver.key'), registry = path.join(root, 'receivers.private.json');
  fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(secretFile, randomBytes(32).toString('base64url'), { mode: 0o600 });
  const definition = { version: 1, environment: 'mock', appEnv: 'development', destinations: [{ id: randomUUID(), tenantId: randomUUID(), workspaceId: randomUUID(), name: '合成本机接收端', mode: 'local_test', url: 'http://127.0.0.1:1/callback', secretFile }] };
  const save = () => fs.writeFileSync(registry, JSON.stringify(definition), { mode: 0o600 }); save();
  const runtime = new WebhookRuntime({ dataDir, providerMode: 'mock', appEnv: 'development', sessionSecret: randomBytes(48).toString('hex'), developerWebhooksFile: registry });
  return { root, dataDir, registry, secretFile, definition, runtime, save };
}
describe('Webhook签名、配置与投递边界', () => {
  it('签名绑定原始UTF8字节、时间、投递编号及密钥，五分钟窗口外拒绝', () => {
    const secret = randomBytes(32).toString('base64url'), timestamp = '2026-11-26T01:02:03.000Z', deliveryId = randomUUID(), body = '{"name":"合成口播","n":1}', now = Date.parse(timestamp);
    const input = { secret, timestamp, deliveryId, body, signature: webhookSignature(secret, timestamp, deliveryId, body), now };
    expect(verifyWebhookSignature(input)).toBe(true);
    for (const changed of [{ body: '{ "name":"合成口播","n":1}' }, { body: body + '\n' }, { deliveryId: randomUUID() }, { timestamp: '2026-11-26T01:02:04.000Z' }, { secret: randomBytes(32).toString('base64url') }, { signature: 'v2=' + '0'.repeat(64) }, { now: now + 300001 }, { now: now - 300001 }, { now: Number.NaN }, { now: Number.POSITIVE_INFINITY }, { secret: '' }]) expect(verifyWebhookSignature({ ...input, ...changed })).toBe(false);
    expect(verifyWebhookSignature({ ...input, now: now + 300000 })).toBe(true);
    expect(webhookBodyHash(Buffer.from(body))).toBe(webhookBodyHash(body));
    expect(verifyWebhookSignature({ ...input, body: '中'.repeat(22000) })).toBe(false);
  });
  it('订阅只接受明确确认、当前应用修订和已登记接收端，不接受任意URL或额外范围', () => {
    const body = { workspaceId: randomUUID(), appId: randomUUID(), expectedAppVersion: 1, destinationId: randomUUID(), configurationToken: 'a'.repeat(64), topics: ['projects.changed'], confirmed: true };
    expect(webhookCreateInput.safeParse(body).success).toBe(true);
    for (const extra of [{ confirmed: false }, { expectedAppVersion: 0 }, { topics: [] }, { topics: ['projects.changed', 'projects.changed'] }, { topics: ['people.changed'] }, { url: 'https://example.invalid/callback' }, { tenantId: randomUUID() }]) expect(webhookCreateInput.safeParse({ ...body, ...extra }).success).toBe(false);
    expect(webhookControlInput.safeParse({ workspaceId: body.workspaceId, appId: body.appId, expectedAppVersion: 1, subscriptionId: randomUUID(), expectedVersion: 1, topics: body.topics, enabled: false, confirmed: true }).success).toBe(true);
  });
  it('私有注册表按空间过滤，改地址或轮换密钥会使原确认令牌失效', () => {
    const x = configuration(), d = x.definition.destinations[0], first = x.runtime.current(d.id);
    expect(x.runtime.catalog(d.tenantId, d.workspaceId).entries.length).toBe(1);
    expect(x.runtime.catalog(d.tenantId, randomUUID()).entries.length).toBe(0);
    d.url = 'http://127.0.0.1:1/new-callback'; x.save(); const changed = x.runtime.current(d.id);
    expect(changed.fingerprint === first.fingerprint).toBe(false); expect(changed.configurationToken === first.configurationToken).toBe(false);
    fs.writeFileSync(x.secretFile, randomBytes(32).toString('base64url')); expect(x.runtime.current(d.id).fingerprint === changed.fingerprint).toBe(false);
    fs.writeFileSync(x.secretFile, 'invalid'); const failure = x.runtime.catalog(d.tenantId, d.workspaceId);
    expect(failure.entries).toEqual([]); expect(Boolean(failure.issue)).toBe(true); expect(String(failure.issue).includes(x.secretFile)).toBe(false);
  });
  it('恢复副本、环境不符、DATA_DIR内配置及非字面回环HTTP均拒绝且不泄露配置', () => {
    const x = configuration();
    for (const host of [{ ...x.runtime.host, recoveryValidationOnly: true as const }, { ...x.runtime.host, providerMode: 'live' as const }, { ...x.runtime.host, developerWebhooksFile: path.join(x.dataDir, 'config.json') }]) expect(new WebhookRuntime(host).catalog(randomUUID(), randomUUID()).entries).toEqual([]);
    for (const url of ['http://localhost:1/callback', 'http://127.0.0.1:1/callback?token=private', 'http://user:private@127.0.0.1:1/callback', 'http://127.0.0.1:1/callback#fragment']) { x.definition.destinations[0].url = url; x.save(); expect(Boolean(x.runtime.catalog(randomUUID(), randomUUID()).issue)).toBe(true); }
  });
  it('应用/订阅/代次/配置与具体事件权限都必须仍然有效', () => {
    const row = { app_enabled: 1, sub_enabled: 1, sub_version: 2, generation: 2, sub_fingerprint: 'a', fingerprint: 'a', topic: 'projects.changed', scopes: '["projects.read"]', topics: '["projects.changed"]' };
    expect(webhookSourceAllowed(row)).toBe(true);
    for (const change of [{ app_enabled: 0 }, { sub_enabled: 0 }, { sub_version: 3 }, { sub_fingerprint: 'b' }, { scopes: '["exports.read"]' }, { topics: '["exports.changed"]' }]) expect(webhookSourceAllowed({ ...row, ...change })).toBe(false);
    expect(webhookSourceAllowed({ ...row, topic: 'webhook.test' })).toBe(true);
  });
  it('未知传输结果保留不确定状态，失败重试受次数限制', () => {
    const result = { outcome: 'unknown' as const, code: 'TRANSPORT_UNCERTAIN' as const, httpStatus: null, retryAfterSeconds: 0 };
    expect(webhookFinalState(result, 1, 5)).toBe('retrying'); expect(webhookFinalState(result, 5, 5)).toBe('unknown');
    expect(webhookFinalState({ ...result, outcome: 'retryable' }, 5, 5)).toBe('failed');
    expect(webhookFinalState({ ...result, outcome: 'accepted' }, 1, 5)).toBe('delivered'); expect(webhookFinalState({ ...result, outcome: 'blocked' }, 1, 5)).toBe('blocked');
  });
  it('真实HTTPS外发默认拒绝，mock即使传授权标志也不外发，超大正文发送前拒绝', async () => {
    const x = configuration(), d = { ...x.runtime.current(x.definition.destinations[0].id), mode: 'https' as const, url: 'https://example.invalid/callback' }, id = randomUUID();
    expect((await sendWebhook({ providerMode: 'live', appEnv: 'production' }, d, id, '{}')).code).toBe('EXTERNAL_NOT_AUTHORIZED');
    expect((await sendWebhook({ providerMode: 'mock', appEnv: 'development' }, d, id, '{}', { allowExternal: true })).code).toBe('EXTERNAL_NOT_AUTHORIZED');
    expect((await sendWebhook(x.runtime.host, d, id, '中'.repeat(22000))).code).toBe('PAYLOAD_INVALID');
  });
  it('回调正文拒绝未声明的私人字段，签名封装包含应用和订阅编号', () => {
    const id = randomUUID(), event = { version: 1, id, type: 'webhook.test', occurredAt: new Date().toISOString(), sequence: 1, tenantId: randomUUID(), workspaceId: randomUUID(), environment: 'mock', appEnv: 'development', data: { subscriptionId: id, message: 'DigitalGuide Webhook connection test' } };
    const wire = { event, applicationId: randomUUID(), subscriptionId: id }; expect(webhookWireSchema.safeParse(wire).success).toBe(true);
    expect(webhookWireSchema.safeParse({ ...wire, event: { ...event, data: { ...event.data, transcript: 'private' } } }).success).toBe(false);
    expect(webhookWireSchema.safeParse({ event }).success).toBe(false);
  });
});
