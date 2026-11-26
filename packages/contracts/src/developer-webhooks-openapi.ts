import { z } from 'zod';
import * as w from './developer-webhooks.js';
export function registerDeveloperWebhooksSpec(paths: Record<string, unknown>, response: (schema: z.ZodType) => z.ZodType, error: z.ZodType) {
  const result = (schema: z.ZodType) => ({ description: '当前授权范围内的事件订阅或投递记录', content: { 'application/json': { schema: z.toJSONSchema(response(schema)) } } });
  const failure = { description: '输入、人员权限、CSRF、当前应用/订阅版本或私有配置不满足条件', content: { 'application/json': { schema: z.toJSONSchema(error) } } };
  const failures = { 400: failure, 401: failure, 403: failure, 404: failure, 409: failure, 503: failure };
  const workspace = { in: 'query', name: 'workspaceId', required: true, schema: { type: 'string', format: 'uuid' } };
  paths['/enterprise/webhooks'] = { get: { summary: '管理员查看当前空间应用、已登记接收端和订阅；不返回地址、密钥文件或密钥', security: [{ session: [] }], parameters: [workspace], responses: { 200: result(w.webhookViewSchema), ...failures } } };
  paths['/enterprise/webhooks/deliveries'] = { get: { summary: '查看当前空间投递及不可变尝试回执，按创建时间与编号分页', security: [{ session: [] }], parameters: [workspace, { in: 'query', name: 'subscriptionId', schema: { type: 'string', format: 'uuid' } }, { in: 'query', name: 'cursor', schema: { type: 'string', format: 'uuid' } }, { in: 'query', name: 'limit', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } }], responses: { 200: result(w.webhookDeliveryPageSchema), ...failures } } };
  for (const [action, input] of [['create', w.webhookCreateInput], ['control', w.webhookControlInput], ['test', w.webhookDeliveryInput], ['retry', w.webhookDeliveryInput]] as const) paths['/enterprise/webhooks/' + action] = { post: { summary: action === 'test' ? '完整组织管理员明确排队连接测试，不同步执行HTTP或伪造成功回执' : action === 'retry' ? '明确重试当前代次的失败、不确定或受阻投递；累计最多20次，保持编号和正文' : '完整组织管理员明确确认当前应用授权、接收端配置和事件；重新配置取消旧代次待投递', security: [{ session: [] }], parameters: [{ in: 'header', name: 'X-CSRF-Token', required: true, schema: { type: 'string' } }, { in: 'header', name: 'Idempotency-Key', required: true, schema: { type: 'string', minLength: 8, maxLength: 128 } }], requestBody: { required: true, content: { 'application/json': { schema: z.toJSONSchema(input, { io: 'input' }) } } }, responses: { 200: result(w.webhookMutationResultSchema), ...failures } } };
}
export const outboundDeveloperWebhooks = {
  digitalGuideEvent: {
    description: '向私有注册表中精确登记的接收端发送事件；这是出站接收端契约，不是平台入站URL。事件同事务持久化，按至少一次语义投递；接收端须按投递编号去重并核对源事件sequence。重试可能乱序或重复。重新配置不自动重放历史。',
    post: {
      summary: '发送制作工程、导出状态或连接测试的不可变元数据事件',
      description: "必须对收到的原始正文字节计算SHA256，再计算HMAC-SHA256（私有密钥文件中的UTF8文本，签名结果小写hex）：'digitalguide-webhook-v1' + '\\n' + X-DigitalGuide-Timestamp + '\\n' + X-DigitalGuide-Delivery + '\\n' + bodySHA256。X-DigitalGuide-Signature为v1=<64hex>。时间戳为UTC ISO8601，接收端应只接受当前时间前后五分钟并按投递编号持久去重。应用和订阅编号在已签名的正文内。每次重试更新签名时间但保持投递编号、源事件和正文不变。接收端返回2xx只表示HTTP受理；3xx不跟随，429/5xx自动退避重试；网络中断记为不确定，接收端可能已经处理。",
      security: [{ webhookSignature: [] }],
      parameters: [
        { in: 'header', name: 'X-DigitalGuide-Delivery', required: true, schema: { type: 'string', format: 'uuid' }, description: '持久投递编号，所有自动或人工重试保持相同' },
        { in: 'header', name: 'X-DigitalGuide-Timestamp', required: true, schema: { type: 'string', format: 'date-time' } },
        { in: 'header', name: 'X-DigitalGuide-Signature', required: true, schema: { type: 'string', pattern: '^v1=[a-f0-9]{64}$' } },
        { in: 'header', name: 'Idempotency-Key', required: true, schema: { type: 'string', format: 'uuid' }, description: '与X-DigitalGuide-Delivery相同；接收端应在同一业务事务中去重' }
      ],
      requestBody: { required: true, content: { 'application/json': { schema: z.toJSONSchema(w.webhookWireSchema) } } },
      responses: { 204: { description: '接收端已受理，可使用其他2xx；业务处理结果由接收端核对' }, 307: { description: '不跟随跳转，保存拒绝结果' }, 422: { description: '永久拒绝请求，人工核对后可明确重试' }, 429: { description: '暂时限频，自动退避；正整数秒Retry-After最多采用3600秒' }, 500: { description: '接收端暂时失败，自动退避；初始最多5次，人工扩展累计不超过20次' } }
    }
  }
};
