import { describe, it, expect } from 'vitest';
import { openapi } from '../../packages/contracts/src/index.js';
describe('Webhook管理与出站接收端文档契约', () => {
  it('六个管理入口保留人员会话，写入声明CSRF、幂等和具体修订，不能提交任意URL', () => {
    for (const suffix of ['', '/deliveries', '/create', '/control', '/test', '/retry']) {
      const operation = (openapi.paths['/enterprise/webhooks' + suffix] as {get?: unknown;post?: unknown})[suffix === '' || suffix === '/deliveries' ? 'get' : 'post'] as {security: unknown[]; parameters: {name: string}[]; requestBody?: {content: {'application/json': {schema: {properties: Record<string, unknown>;additionalProperties: boolean}}}}};
      expect(operation.security).toEqual([{session: []}]);
      if (operation.requestBody) { expect(operation.parameters.map(p => p.name)).toEqual(['X-CSRF-Token', 'Idempotency-Key']); const schema = operation.requestBody.content['application/json'].schema; expect(schema.additionalProperties).toBe(false); expect(schema.properties.expectedAppVersion).toBeDefined(); expect(schema.properties.url).toBeUndefined(); expect(schema.properties.secret).toBeUndefined(); }
    }
  });
  it('出站契约独立于平台paths，包含原始字节验签、时间窗口与重试去重约定', () => {
    const spec = openapi as typeof openapi & {webhooks: {digitalGuideEvent: {post: {description: string; parameters: {name: string;required: boolean}[];security: unknown[];requestBody: unknown}}}};
    const operation = spec.webhooks.digitalGuideEvent.post; expect(operation.security).toEqual([{webhookSignature: []}]); expect(operation.parameters.every(p => p.required)).toBe(true);
    expect(operation.parameters.map(p => p.name)).toEqual(['X-DigitalGuide-Delivery', 'X-DigitalGuide-Timestamp', 'X-DigitalGuide-Signature', 'Idempotency-Key']);
    expect(operation.description).toContain('原始正文'); expect(operation.description).toContain('五分钟'); expect(operation.description).toContain('HMAC-SHA256'); expect(operation.description).toContain('正文不变');
    expect(openapi.paths['/digitalGuideEvent']).toBeUndefined(); expect(operation.requestBody).toBeDefined();
  });
});
