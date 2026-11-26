export * from './member-directory.js';
export * from './enterprise-identity.js';
import {registerGuestProgrammeSpec} from './live-guest-programme-openapi.js';
import { registerBillingSpec } from './billing-openapi.js';
export * from './orders.js';
import { registerOrderSpec } from './orders-openapi.js';
import { restaurantOperations,guestDiningPartyOperations,diningReservationUpdateInput,diningVersionInput,diningSeatInput,restaurantSchema,restaurantGrantSchema,restaurantTerminalSchema,restaurantTableSchema,staffMenuItemSchema,staffMenuSchema,diningPartySchema,diningHoldPlanSchema,diningRecommendationSchema,diningMemoryImportSchema,guestDiningSchema,restaurantStockAdjustmentSchema } from './restaurant.js';
export * from './restaurant.js';
import { distributionOperations,distributionVersionSchema,distributionVariantSchema,distributionReviewSchema,distributionProjectResultSchema,channelSchema,publishingPlanSchema,publishingJobSchema,publishingPackageSchema,publishingMetricsSchema,publishingCapabilitiesSchema,publishingReceiptInput } from './distribution.js';
export * from './distribution.js';
import { studioOperations, studioReads } from './studio.js';
import { studioTeamOperations,batchPlanSchema,batchSummarySchema,studioBatchSchema,studioCommentSchema,studioReviewSchema,projectReviewSummarySchema } from './studio-team.js';
export * from './studio-team.js';
import { timelineOperations,timelineRenderSchema } from './timeline-api.js';
import { exportOperations,exportPlanSchema,studioExportSchema,transferOperations,mediaTransferSchema } from './export.js';
export * from './timeline-api.js';
export * from './export.js';
export * from './studio.js';
export * from './timeline.js';
import { exhibitionOperations } from './exhibition.js';
export * from './exhibition.js';
import { speakerOperations, speakerFocusSchema, speakerReferenceSchema, focusState } from './speaker.js';
import { runtimeOperations, runtimeProbeSchema } from './runtime.js';
import { visionOperations, visualStateSchema } from './vision.js';
import { officeOperations, officeRelaySchema, officeNotificationSchema, calendarEventSchema } from './office.js';
import { knowledgeOperations, collectionSchema, documentSchema, sceneAppSchema } from './knowledge.js';
export * from './knowledge.js';
export * from './vision.js';
export * from './runtime.js';
export * from './speaker.js';
import { z } from 'zod';
import { receptionOperations, receptionSessionSchema } from './reception.js';
import { visitOperations, visitSchema, internalVisitSchema, notificationReceiptInput } from './visits.js';
import { peopleOperations, memoryViewSchema } from './people.js';
export * from './reception.js';
export * from './visits.js';
export * from './people.js';
export * from './office.js';

export const id = z.uuid();
export const environment = z.enum(['mock', 'sandbox', 'live']);
export const scene = z.enum(['video', 'presentation', 'live', 'exhibition', 'reception', 'restaurant', 'learning']);
export const loginInput = z.strictObject({ accountId: id });
export const uploadInput = z.strictObject({ workspaceId: id, fileName: z.string().trim().min(1).max(120), contentBase64: z.string().min(4).max(12_000_000) });
export const assetInput = z.strictObject({ uploadId: id, name: z.string().trim().min(1).max(80), category: z.enum(['avatar', 'voice', 'background', 'reference']), expiresAt: z.iso.datetime().nullable().default(null) });
export const assetUpdateInput = z.strictObject({ version: z.int().positive(), name: z.string().trim().min(1).max(80).optional(), archived: z.boolean().optional() });
export const consentInput = z.strictObject({ purpose: z.enum(['train_avatar', 'train_voice', 'voice_style', 'character_use', 'demo_usage']), subject: z.string().trim().min(1).max(80), proof: z.string().trim().min(8).max(300), expiresAt: z.iso.datetime(), noticeVersion: z.literal('local-v1') });
export const jobInput = z.strictObject({ workspaceId: id, kind: z.enum(['provider.check', 'training.avatar', 'training.voice']), assetId: id.optional(), consentId: id.optional(), simulate: z.enum(['success', 'transient_failure', 'permanent_failure', 'unknown']).default('success') });
export const profileInput = z.strictObject({ workspaceId: id, name: z.string().trim().min(1).max(80), avatarAssetId: id, voiceAssetId: id.optional(), scenes: z.array(scene).min(1).max(7) });
export const profileUpdateInput = z.strictObject({ version: z.int().positive(), name: z.string().trim().min(1).max(80), scenes: z.array(scene).min(1).max(7) });
export const routeInput = z.strictObject({ scene, version: z.int().positive() });
export const listInput = z.object({ cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(100).default(50), workspaceId: id.optional(), archived: z.enum(['true', 'false']).default('false'),mediaType: z.enum(['image/png','audio/wav','video/mp4','video/quicktime','video']).optional() });

export const jobStatus = z.enum(['queued', 'running', 'retrying', 'cancellation_requested', 'cancelled', 'succeeded', 'failed', 'unknown']);
export type JobStatus = z.infer<typeof jobStatus>;
export type JobInput = z.infer<typeof jobInput>;
export type Scene = z.infer<typeof scene>;
export interface Workspace { id: string; name: string }
export interface Me { developerStudioAvailable?:boolean;developerWebhooksAvailable?:boolean;developerAccessAvailable?:boolean;enterpriseDirectoryLifecycleAvailable?:boolean;enterpriseDirectoryGroupAccessAvailable?:boolean;enterpriseDirectoryAvailable?:boolean;enterpriseMembersAvailable?:boolean;enterpriseIdentityAvailable?:boolean;resourceShelfAvailable?:boolean; enterprisePlansAvailable?:boolean; operationsMetricsAvailable?:boolean; id: string; name: string; tenantId: string; tenantName: string; role: 'admin' | 'editor' | 'viewer' | 'reviewer'; workspaces: Workspace[]; csrfToken: string; environment: 'mock' | 'sandbox' | 'live' }
export interface Asset { unavailableReason?:string|null; id: string; workspaceId: string; name: string; category: string; mediaType: string; size: number; sha256: string; specs: Record<string, number>; version: number; archived: boolean; expiresAt: string | null; createdAt: string; synthetic: boolean }
export interface Consent { id: string; assetId: string; purpose: string; subject: string; expiresAt: string; revokedAt: string | null }
export interface Job { id: string; workspaceId: string; kind: string; status: JobStatus; attempts: number; maxAttempts: number; errorCode: string | null; errorMessage: string | null; result: Record<string, unknown> | null; environment: string; createdAt: string; updatedAt: string }
export interface Profile { id: string; workspaceId: string; name: string; avatarAssetId: string; voiceAssetId: string | null; scenes: Scene[]; version: number; createdAt: string }
export interface Capability { id: string; name: string; environment: 'mock' | 'sandbox' | 'live'; verification: 'contract_verified' | 'not_configured' | 'live_verified'; features: string[]; realCapabilities: string[]; cost: { currency: string; estimatedMinor: number | null }; limits: { maxConcurrent: number; dailyJobs: number }; circuit: 'closed' | 'open' | 'half_open'; nextStep: string }
export interface Overview { assets: number; profiles: number; queued: number; succeeded: number; failed: number; unknown: number; dailyUsed: number; dailyLimit: number; environment: string; faceRecognitionEnabled: false }
export interface ApiResponse<T> { data: T; requestId: string }
export interface Page<T> { items: T[]; nextCursor: string | null }

export const assetSchema = z.object({ unavailableReason:z.string().nullable().optional(),id, workspaceId: id, name: z.string(), category: z.string(), mediaType: z.enum(['image/png', 'audio/wav','video/mp4','video/quicktime','model/gltf-binary','application/vnd.digitalguide.puppet+json']), size: z.int().positive(), sha256: z.string().regex(/^[a-f0-9]{64}$/), specs: z.record(z.string(), z.number()), version: z.int().positive(), archived: z.boolean(), synthetic: z.boolean(), expiresAt: z.iso.datetime().nullable(), createdAt: z.iso.datetime() });
export const jobSchema = z.object({ id, workspaceId: id, kind: jobInput.shape.kind, status: jobStatus, attempts: z.int().nonnegative(), maxAttempts: z.int().positive(), errorCode: z.string().nullable(), errorMessage: z.string().nullable(), result: z.record(z.string(), z.unknown()).nullable(), environment, createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() });
export const profileSchema = z.object({ id, workspaceId: id, name: z.string(), avatarAssetId: id, voiceAssetId: id.nullable(), scenes: z.array(scene), version: z.int().positive(), createdAt: z.iso.datetime() });
const responseSchema = (data: z.ZodType) => z.object({ data, requestId: id });
const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }), requestId: id });
const pageSchema = (item: z.ZodType) => z.object({ items: z.array(item), nextCursor: id.nullable() });

// OpenAPI 3.1 uses the same input schemas as runtime validation.
const operations = [
  ...receptionOperations, ...exhibitionOperations, ...studioOperations,...studioTeamOperations,...timelineOperations,...exportOperations,...transferOperations,...distributionOperations,
  ...visitOperations,
  ...officeOperations,
  ...knowledgeOperations, ...visionOperations, ...runtimeOperations, ...speakerOperations,
  ...peopleOperations,
  ['post', '/auth/login', loginInput, '演示登录'], ['post', '/assets/uploads', uploadInput, '上传 PNG 或 PCM WAV'],
  ['post', '/assets', assetInput, '确认资产'], ['patch', '/assets/{id}', assetUpdateInput, '更新资产'],
  ['post', '/assets/{id}/consents', consentInput, '登记用途授权'], ['post', '/jobs', jobInput, '提交模拟任务'],
  ['post', '/profiles', profileInput, '创建统一角色'], ['put', '/profiles/{id}', profileUpdateInput, '保存角色版本'],
  ['post', '/profiles/{id}/resolve', routeInput, '校验场景资产路由']
] as const;
export const openapi = {
  openapi: '3.1.0', info: { title: 'DigitalGuide API', version: '0.1.0' }, servers: [{ url: '/api/v1' }],
  components: { securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: 'dg_session' }, guestSession: { type: 'apiKey', in: 'cookie', name: 'dg_guest' }, tourSession: { type: 'apiKey', in: 'cookie', name: 'dg_tour' } } },
  paths: Object.fromEntries(operations.map(([method, path, schema, summary]) => [path, { [method]: { summary, security: path === '/auth/login' ? [] : path.startsWith('/guest/tours/') ? [{ tourSession: [] }] : path.startsWith('/guest/') ? [{ guestSession: [] }] : [{ session: [] }], parameters: [
    ...(path.includes('{id}') ? [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }] : []),
    { name: 'Idempotency-Key', in: 'header', required: path !== '/auth/login', schema: { type: 'string' } },
    { name: 'X-CSRF-Token', in: 'header', required: path !== '/auth/login', schema: { type: 'string' } }
  ], requestBody: { required: true, content: { 'application/json': { schema: z.toJSONSchema(schema, { io: 'input' }) } } }, responses: { '200': { description: '操作成功；data 与 requestId' }, '201': { description: '资源已创建；data 与 requestId' }, '202': { description: '异步任务已接受' }, ...Object.fromEntries(['400', '401', '403', '404', '409', '413', '500'].map(code => [code, { description: '结构化错误，包含下一步说明', content: { 'application/json': { schema: z.toJSONSchema(errorSchema) } } }])) } } }])) as Record<string, Record<string, unknown>>
};

for (const [path, summary, schema] of [
  ['/assets', '列出当前权限范围的资产', pageSchema(assetSchema)], ['/assets/{id}', '读取资产', assetSchema],
  ['/jobs', '列出当前环境任务', pageSchema(jobSchema)], ['/jobs/{id}', '读取任务', jobSchema],
  ['/profiles', '列出统一角色', pageSchema(profileSchema)], ['/profiles/{id}', '读取角色配置', profileSchema],
  ['/sessions/{id}', '工作人员查看匿名会话', receptionSessionSchema],
  ['/terminals', '列出有权管理的接待终端', z.unknown()],
  ['/visits', '前台管理当前授权范围内的来访', pageSchema(internalVisitSchema)], ['/visits/inbox', '仅分配给当前登录账号的接待请求', pageSchema(internalVisitSchema)],
  ['/me', '当前身份、工作空间与 CSRF 凭证', z.object({ id, name: z.string(), tenantId: id, tenantName: z.string(), role: z.enum(['admin', 'editor', 'viewer','reviewer']), workspaces: z.array(z.object({ id, name: z.string() })), csrfToken: z.string(), environment })],
  ...['health', 'readiness', 'auth/demo-accounts', 'venues', 'overview', 'capabilities', 'assets/{id}/versions', 'assets/{id}/consents', 'profiles/{id}/versions', 'audit-events', 'provider-usage', 'events', 'openapi.json'].map(path => ['/' + path, path, z.unknown()] as const)
] as const) {
  openapi.paths[path] = { ...openapi.paths[path], get: { summary, security: ['/health', '/readiness', '/auth/demo-accounts'].includes(path) ? [] : [{ session: [] }], parameters: [
    ...(path.includes('{id}') ? [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }] : []),
    ...(['/assets', '/jobs', '/profiles', '/audit-events', '/events', '/provider-usage'].includes(path) ? [{ name: 'workspaceId', in: 'query', schema: { type: 'string', format: 'uuid' } }, { name: 'cursor', in: 'query', schema: { type: 'string', format: 'uuid' } }, { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } }] : [])
  ], responses: { '200': { description: '成功', content: { 'application/json': { schema: z.toJSONSchema(responseSchema(schema)) } } } } } };
}
for (const [path, permission] of [['/jobs/{id}/cancel', 'job.write'], ['/consents/{id}/revoke', 'asset.train'], ['/auth/logout', 'authenticated']] as const) {
  openapi.paths[path] = { post: { summary: permission, security: [{ session: [] }], parameters: [{ name: 'X-CSRF-Token', in: 'header', required: true, schema: { type: 'string' } }, ...(path.includes('{id}') ? [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string' } }] : [])], responses: { '200': { description: '操作成功' }, '409': { description: '当前状态不能执行此操作' } } } };
}
openapi.paths['/assets/{id}/content'] = { get: { summary: '受鉴权保护的源素材下载', security: [{ session: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: '已探测的 PNG / PCM WAV 原始字节', content: { 'image/png': {}, 'audio/wav': {} } } } } };
openapi.paths['/guest/sessions/{id}'] = { get: { summary: '访客读取仅属于本会话的消息与受限能力', security: [{ guestSession: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: '匿名会话与防 CSRF 凭证', content: { 'application/json': { schema: z.toJSONSchema(responseSchema(z.object({ session: receptionSessionSchema, csrfToken: z.string(), capabilities: z.array(z.string()), audio: z.object({ state: z.enum(['not_configured', 'mock_focus']), focus: z.enum(['unlocked', ...focusState.options]) }), environment }))) } } } } } };
openapi.paths['/guest/sessions/{id}/visit'] = { ...openapi.paths['/guest/sessions/{id}/visit'], get: { summary: '仅本人会话的来访记录，不包含接待人内部备注', security: [{ guestSession: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: '来访草稿、处理状态与确认挑战', content: { 'application/json': { schema: z.toJSONSchema(responseSchema(z.object({ visit: visitSchema.nullable(), confirmation: z.object({ token: z.string(), expiresAt: z.iso.datetime() }).nullable() }))) } } } } } };
openapi.paths['/webhooks/mock-notification'] = { post: { summary: '签名模拟通知回执，含时间窗口与事件去重', security: [], parameters: [{ name: 'X-Notification-Signature', in: 'header', required: true, schema: { type: 'string' } }, { name: 'X-Notification-Timestamp', in: 'header', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: z.toJSONSchema(notificationReceiptInput) } } }, responses: { '200': { description: '回执已应用或幂等忽略，不等于员工同意接待' }, '403': { description: '签名错误或已过期' } } } };

for (const base of ['/people/self', '/people/{id}', '/guest/sessions/{id}/memory']) {
  for (const suffix of base === '/people/self' ? [''] : ['', '/search', '/export']) {
    const schema = suffix === '' ? memoryViewSchema : z.unknown(), path = base + suffix;
    openapi.paths[path] = { ...openapi.paths[path], get: { summary: suffix === '/search' ? '仅已确认且允许接待使用的本人记忆' : suffix === '/export' ? '本人资料与本次对话导出' : '本人资料、候选记忆、摘要和待办', security: base.startsWith('/guest') ? [{ guestSession: [] }] : [{ session: [] }], parameters: [
      ...(base.includes('{id}') ? [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }] : [{ name: 'workspaceId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } }]),
      ...(suffix === '/search' ? [{ name: 'q', in: 'query', schema: { type: 'string', maxLength: 100 } }] : [])
    ], responses: { '200': { description: '成功；私人资料仅本人可读', content: { 'application/json': { schema: z.toJSONSchema(responseSchema(schema)) } } } } } };
  }
}
openapi.paths['/people'] = { get: { summary: '前台目录，仅含姓名、多角色和资料状态，不含私人记忆', security: [{ session: [] }], responses: { '200': { description: '已授权工作空间的最小目录' } } } };

for (const [endpoint, schema] of [["relays", officeRelaySchema], ["inbox", officeNotificationSchema], ["calendar", calendarEventSchema]] as const) {
  const base = "/office/" + endpoint;
  for (const isDetail of [false, true]) {
    const path = isDetail ? (endpoint === "inbox" ? "/office/notifications/{id}" : base + "/{id}") : base;
    openapi.paths[path] = { ...openapi.paths[path], get: { summary: "仅本人发出、收到或参与的员工事务", security: [{ session: [] }], parameters: isDetail ? [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }] : ["workspaceId", "cursor", "limit"].map(name => ({ name, in: "query", schema: name === "limit" ? { type: "integer", minimum: 1, maximum: 100 } : { type: "string", format: "uuid" } })), responses: { "200": { description: "成功", content: { "application/json": { schema: z.toJSONSchema(responseSchema(isDetail ? schema : pageSchema(schema))) } } } } } };
  }
}
for (const endpoint of ["members", "public-notice"]) openapi.paths["/office/" + endpoint] = { get: { summary: endpoint === "members" ? "仅本工作空间最小成员目录" : "本人公共场合提示，不包含私密正文或日程", security: [{ session: [] }], responses: { "200": { description: "成功" } } } };

for (const [endpoint, schema] of [["/knowledge/collections", collectionSchema], ["/scene-apps", sceneAppSchema]] as const) openapi.paths[endpoint] = { ...openapi.paths[endpoint], get: { summary: "授权工作空间内的配置目录", security: [{ session: [] }], responses: { "200": { description: "成功", content: { "application/json": { schema: z.toJSONSchema(responseSchema(pageSchema(schema))) } } } } } };
for (const [endpoint, schema] of [["/knowledge/documents/{id}", documentSchema], ["/scene-apps/{id}", sceneAppSchema], ["/knowledge/collections/{id}/documents", pageSchema(documentSchema)]] as const) openapi.paths[endpoint] = { get: { summary: "有权限的版本或配置详情", security: [{ session: [] }], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: "成功", content: { "application/json": { schema: z.toJSONSchema(responseSchema(schema)) } } } } } };

openapi.paths['/guest/sessions/{id}/vision'] = { get: { summary: '当前访客的画面授权状态，不包含原始帧', security: [{ guestSession: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: '成功', content: { 'application/json': { schema: z.toJSONSchema(responseSchema(visualStateSchema)) } } } } } };

const probePath = '/scene-apps/{id}/pipeline/check';
(openapi.paths[probePath].post as { responses: Record<string, unknown> }).responses['200'] = { description: '仅模拟语音链路契约，不读取麦克风或执行业务', content: { 'application/json': { schema: z.toJSONSchema(responseSchema(runtimeProbeSchema)) } } };

for (const endpoint of ['/guest/sessions/{id}/speaker-focus', '/sessions/{id}/speaker-focus']) openapi.paths[endpoint] = { ...openapi.paths[endpoint], get: { summary: '专注对话状态，不含参考模板或未确认字幕', security: endpoint.startsWith('/guest/') ? [{ guestSession: [] }] : [{ session: [] }], responses: { '200': { description: '状态与明确模拟能力', content: { 'application/json': { schema: z.toJSONSchema(responseSchema(speakerFocusSchema)) } } } } } };
openapi.paths['/speaker-references'] = { ...openapi.paths['/speaker-references'], get: { summary: '仅本人登记的声音参考元数据', security: [{ session: [] }], responses: { '200': { description: '本人参考', content: { 'application/json': { schema: z.toJSONSchema(responseSchema(z.array(speakerReferenceSchema))) } } } } } };
export * from './speaker-benchmark.js';

for (const path of ['/exhibitions','/exhibits','/tour-routes','/tour-slots','/tour-bookings','/exhibit-devices','/tours','/tours/{id}','/guest/tours/{id}']) {
  openapi.paths[path] = { ...openapi.paths[path], get: { summary: path.startsWith('/guest/') ? '受限导览状态、内容与 CSRF' : '授权范围内的展厅资源', security: path.startsWith('/guest/') ? [{ tourSession: [] }] : [{ session: [] }], parameters: path.includes('{id}') ? [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }] : [{ name: path === '/exhibitions' ? 'workspaceId' : 'hallId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: '成功，data 与 requestId；来源、状态及模拟模式明确区分' } } } };
}
export * from './studio-defaults.js';
for (const [path,summary,schema,workspace] of studioReads) {
  openapi.paths[path] = { ...openapi.paths[path],get: { summary,security: [{ session: [] }],parameters: [
    ...(path.includes('{id}') ? [{ name: 'id',in: 'path',required: true,schema: { type: 'string',format: 'uuid' } }] : []),
    ...(workspace ? [{ name: 'workspaceId',in: 'query',required: true,schema: { type: 'string',format: 'uuid' } }] : []),
    ...(!path.includes('{id}') ? [{ name: 'cursor',in: 'query',schema: { type: 'string',format: 'uuid' } },{ name: 'limit',in: 'query',schema: { type: 'integer',minimum: 1,maximum: 100 } }] : []),
    ...(path === '/studio/projects' ? [{ name: 'archived',in: 'query',schema: { type: 'string',enum: ['true','false'] } }] : [])
  ],responses: { '200': { description: '成功；当前权限与环境范围',content: { 'application/json': { schema: z.toJSONSchema(responseSchema(schema)) } } } } } };
}
for (const [path,type,summary] of [['/studio/previews/{id}','image/png','下载当前有效静态分镜 PNG'],['/studio/import-media/{id}','image/png','读取已审阅文档的受控图片'],['/studio/imports/{id}/source','application/octet-stream','下载已授权原始文档']] as const) openapi.paths[path] = { get: { summary,security: [{ session: [] }],parameters: [{ name: 'id',in: 'path',required: true,schema: { type: 'string',format: 'uuid' } }],responses: { '200': { description: '鉴权后的二进制内容',content: { [type]: { schema: { type: 'string',format: 'binary' } } } } } } };
for (const path of ['/studio/projects/{id}/timeline-previews','/studio/timeline-previews/{id}']) openapi.paths[path] = { ...openapi.paths[path],get: { summary: '读取授权范围的持久化时间线预览任务',security: [{ session: [] }],parameters: [{ name: 'id',in: 'path',required: true,schema: { type: 'string',format: 'uuid' } }],responses: { '200': { description: '实际本地预览状态；真实克隆未执行',content: { 'application/json': { schema: z.toJSONSchema(responseSchema(path.includes('/projects/') ? z.array(timelineRenderSchema) : timelineRenderSchema)) } } } } } };
for (const [suffix,type] of [['video','video/mp4'],['audio','audio/wav']] as const) openapi.paths['/studio/timeline-previews/{id}/'+suffix] = { get: { summary: '读取仍然有效的预览媒体，支持单一字节区间',security: [{ session: [] }],parameters: [{ name: 'id',in: 'path',required: true,schema: { type: 'string',format: 'uuid' } },{ name: 'Range',in: 'header',schema: { type: 'string' } }],responses: { '200': { description: '完整媒体',content: { [type]: { schema: { type: 'string',format: 'binary' } } } },'206': { description: '字节区间媒体' },'416': { description: '无效字节区间' } } } };
for (const path of ['/studio/projects/{id}/exports','/studio/exports/{id}']) openapi.paths[path] = { ...openapi.paths[path],get: { summary: '读取授权范围的持久化导出及文件状态',security: [{ session: [] }],parameters: [{ name: 'id',in: 'path',required: true,schema: { type: 'string',format: 'uuid' } }],responses: { '200': { description: '导出状态；下载需来源仍有效',content: { 'application/json': { schema: z.toJSONSchema(responseSchema(path.includes('/projects/') ? z.array(studioExportSchema) : studioExportSchema)) } } } } } };
openapi.paths['/studio/projects/{id}/export-plan'].post = { ...openapi.paths['/studio/projects/{id}/export-plan'].post as object,responses: { '200': { description: '当前版本的实际输出规格与源素材限制',content: { 'application/json': { schema: z.toJSONSchema(responseSchema(exportPlanSchema)) } } },'409': { description: '工程版本或范围不适用' } } };
openapi.paths['/studio/exports/{id}/files/{artifactId}'] = { get: { summary: '鉴权并核对当前来源后下载实际导出文件',security: [{ session: [] }],parameters: [{ name: 'id',in: 'path',required: true,schema: { type: 'string',format: 'uuid' } },{ name: 'artifactId',in: 'path',required: true,schema: { type: 'string',format: 'uuid' } },{ name: 'Range',in: 'header',schema: { type: 'string' } }],responses: { '200': { description: '当前有效文件',content: Object.fromEntries(['video/mp4','video/quicktime','audio/wav','application/x-subrip','text/vtt','application/json','application/zip'].map(type => [type,{ schema: { type: 'string',format: 'binary' } }])) },'206': { description: '单一字节区间' },'401': { description: '未登录' },'404': { description: '无权访问或文件不存在' },'409': { description: '来源、授权或版本变化，文件不可下载' },'416': { description: '无效字节区间' } } } };

for (const path of ['/studio/transfers','/studio/transfers/{id}']) openapi.paths[path] = { ...openapi.paths[path],get: { summary: '读取本人的持久化分片传输和检查进度',security: [{session: []}],parameters: path.includes('{id}') ? [{name:'id',in:'path',required:true,schema:{type:'string',format:'uuid'}}] : [{name:'workspaceId',in:'query',required:true,schema:{type:'string',format:'uuid'}},{name:'cursor',in:'query',schema:{type:'string',format:'uuid'}},{name:'limit',in:'query',schema:{type:'integer',minimum:1,maximum:100}}],responses: {'200':{description:'当前账号、空间与环境内的上传状态',content:{'application/json':{schema:z.toJSONSchema(responseSchema(path.includes('{id}') ? mediaTransferSchema : pageSchema(mediaTransferSchema)))}}}}}};
openapi.paths['/assets/{id}/poster'] = {get:{summary:'鉴权读取实际视频封面帧',security:[{session:[]}],parameters:[{name:'id',in:'path',required:true,schema:{type:'string',format:'uuid'}}],responses:{'200':{description:'视频实际PNG封面',content:{'image/png':{schema:{type:'string',format:'binary'}}}},'404':{description:'素材不在权限内或没有封面'}}}};

(openapi.paths['/assets'].get as {parameters: unknown[]}).parameters.push({name:'mediaType',in:'query',required:false,schema:{type:'string',enum:['image/png','audio/wav','video/mp4']}});
openapi.paths['/assets/{id}/content'] = {get:{summary:'鉴权读取原始PNG、WAV或已检查MP4，支持单一字节区间',security:[{session:[]}],parameters:[{name:'id',in:'path',required:true,schema:{type:'string',format:'uuid'}},{name:'Range',in:'header',schema:{type:'string'}}],responses:{'200':{description:'当前可用源素材',content:Object.fromEntries(['image/png','audio/wav','video/mp4'].map(type=>[type,{schema:{type:'string',format:'binary'}}]))},'206':{description:'单一字节区间'},'401':{description:'未登录'},'404':{description:'无权访问'},'409':{description:'已归档、到期或原文件缺失'},'416':{description:'无效字节区间'}}}};

for (const [path,schema,workspace,paged] of [
 ['/studio/batches',pageSchema(batchSummarySchema),true,true],['/studio/batches/{id}',studioBatchSchema,false,false],['/studio/projects/{id}/comments',pageSchema(studioCommentSchema),false,true],['/studio/projects/{id}/review-summary',projectReviewSummarySchema,false,false],['/studio/reviews',pageSchema(studioReviewSchema),true,true],['/studio/reviews/{id}',studioReviewSchema,false,false]
] as const) openapi.paths[path] = { ...openapi.paths[path],get: { summary: '读取当前组织/空间/环境内的批次或团队审核',security: [{session: []}],parameters: [...(path.includes('{id}') ? [{name: 'id',in: 'path',required: true,schema: {type: 'string',format: 'uuid'}}] : []),...(workspace ? [{name: 'workspaceId',in: 'query',required: true,schema: {type: 'string',format: 'uuid'}}] : []),...(paged ? [{name: 'cursor',in: 'query',schema: {type: 'string',format: 'uuid'}},{name: 'limit',in: 'query',schema: {type: 'integer',minimum: 1,maximum: 100}}] : []),...(path === '/studio/reviews' ? [{name:'assigned',in:'query',schema:{type:'string',enum:['me','all']}},{name:'status',in:'query',schema:{type:'string',enum:['pending','all']}}] : [])],responses: {'200': {description:'持久化状态；审批是否有效需核对当前版本和来源',content:{'application/json':{schema:z.toJSONSchema(responseSchema(schema))}}}}}};
for (const [,path] of studioTeamOperations) { const schema = path === '/studio/batch-plan' ? batchPlanSchema : path.startsWith('/studio/batches') ? studioBatchSchema : path.includes('/comments') ? studioCommentSchema : studioReviewSchema;const operation = openapi.paths[path].post as {parameters: object[]};openapi.paths[path].post = {...operation,parameters:[...operation.parameters,...['itemId','commentId'].filter(key=>path.includes('{'+key+'}')).map(name=>({name,in:'path',required:true,schema:{type:'string',format:'uuid'}}))],responses:{'200':{description:'状态及版本化结果',content:{'application/json':{schema:z.toJSONSchema(responseSchema(schema))}}}}};}

for(const [,path] of distributionOperations){
 const schema=path==='/distribution/variant-projects'?distributionProjectResultSchema:path==='/distribution/publish-plan'?publishingPlanSchema:path.includes('/accounts')?channelSchema:path.includes('/reviews')?distributionReviewSchema:path.endsWith('/packages')?publishingPackageSchema:path.endsWith('/metrics')?publishingMetricsSchema:path.startsWith('/distribution/jobs')?publishingJobSchema:distributionVariantSchema;
 const op=openapi.paths[path].post as Record<string,unknown>;openapi.paths[path].post={...op,responses:{'200':{description:'版本化传播工作流结果',content:{'application/json':{schema:z.toJSONSchema(responseSchema(schema))}}}}};
}
for(const [path,schema] of [
 ['/distribution/capabilities',publishingCapabilitiesSchema],['/distribution/variants',pageSchema(distributionVariantSchema)],['/distribution/variants/{id}',distributionVariantSchema],['/distribution/variants/{id}/versions',z.array(distributionVersionSchema)],['/distribution/accounts',pageSchema(channelSchema)],['/distribution/jobs',pageSchema(publishingJobSchema)],['/distribution/jobs/{id}',publishingJobSchema],['/distribution/jobs/{id}/metrics',publishingMetricsSchema],['/distribution/variants/{id}/packages',z.array(publishingPackageSchema)],['/distribution/packages/{id}',publishingPackageSchema]
] as const){openapi.paths[path]={...openapi.paths[path],get:{summary:'传播与渠道状态（当前仅人工包与显式模拟）',security:[{session:[]}],parameters:path.includes('{id}')?[{name:'id',in:'path',required:true,schema:{type:'string',format:'uuid'}}]:path.endsWith('/capabilities')?[]:[{name:'workspaceId',in:'query',required:true,schema:{type:'string',format:'uuid'}},{name:'cursor',in:'query',schema:{type:'string',format:'uuid'}},{name:'limit',in:'query',schema:{type:'integer',minimum:1,maximum:100}}],responses:{'200':{description:'传播对象和状态',content:{'application/json':{schema:z.toJSONSchema(responseSchema(schema))}}}}}};}
openapi.paths['/distribution/packages/{id}/file']={get:{summary:'鉴权和当前审批校验后的实际人工发布ZIP',security:[{session:[]}],parameters:[{name:'id',in:'path',required:true,schema:{type:'string',format:'uuid'}}],responses:{'200':{description:'实际视频、封面、字幕和元数据',content:{'application/zip':{}}}}}};
openapi.paths['/webhooks/mock-publishing']={post:{summary:'本地模拟发布签名回执，支持事件去重与乱序保护',security:[],parameters:[{name:'X-Publishing-Timestamp',in:'header',required:true,schema:{type:'string'}},{name:'X-Publishing-Signature',in:'header',required:true,schema:{type:'string'}}],requestBody:{required:true,content:{'application/json':{schema:z.toJSONSchema(publishingReceiptInput)}}},responses:{'200':{description:'回执已验证接收'},'403':{description:'签名或时间窗口无效'},'409':{description:'环境、远端请求或事件冲突'}}}};

// Restaurant writes reuse runtime schemas; guest writes require the current focus version.
const restaurantWrites=[...restaurantOperations,...guestDiningPartyOperations.map(([suffix,schema])=>['post','/guest/sessions/{id}/dining/parties/{partyId}/'+suffix,schema,'仅当前顾客及发问人的餐厅操作'] as const),
 ...(['update','check-in'] as const).map(suffix=>['post','/guest/sessions/{id}/dining/reservations/{reservationId}/'+suffix,suffix==='update'?diningReservationUpdateInput:diningVersionInput,'本人预约改期或到店签到'] as const),
 ...(['seat','release'] as const).map(suffix=>['post','/guest/sessions/{id}/dining/table-holds/{holdId}/'+suffix,diningSeatInput,'本人有效桌位预留的确认或释放'] as const)];
for(const [method,path,schema,summary] of restaurantWrites){
 const guest=path.startsWith('/guest/'),body=guest&&schema instanceof z.ZodObject&&'focusVersion' in schema.shape?schema.safeExtend({focusVersion:z.int().nonnegative()}):schema;
 const nativeBody=guest&&schema instanceof z.ZodObject?schema.safeExtend({focusVersion:z.int().nonnegative(),selectionVersion:z.int().nonnegative()}):null;
 const requestSchema=nativeBody?{oneOf:[z.toJSONSchema(body,{io:'input'}),z.toJSONSchema(nativeBody,{io:'input'})],'x-native-postgres-schema-index':1,description:'原生PostgreSQL顾客接口使用第二分支，必须携带当前focusVersion与selectionVersion；SQLite使用第一分支。'}:z.toJSONSchema(body,{io:'input'});
 const result=path.endsWith('/table-plan')?diningHoldPlanSchema:path.endsWith('/recommendations')?diningRecommendationSchema:path.endsWith('/memory-import')?diningMemoryImportSchema:path.endsWith('/access')?z.strictObject({sessionId:id,terminalUrl:z.string()}):path.endsWith('/session')?receptionSessionSchema:path.endsWith('/staff')?z.array(restaurantGrantSchema):path.endsWith('/terminals')?restaurantTerminalSchema:path.includes('/tables')?restaurantTableSchema:path.includes('/menu-items')||path.includes('/skus/')?staffMenuItemSchema:path==='/restaurant/restaurants'||/^\/restaurant\/restaurants\/\{id\}\/update$/.test(path)?restaurantSchema:diningPartySchema;
 openapi.paths[path]={...openapi.paths[path],[method]:{summary,security:guest?[{guestSession:[]}]:[{session:[]}],parameters:[...Array.from(path.matchAll(/\{(\w+)\}/g),m=>({name:m[1],in:'path',required:true,schema:{type:'string',format:'uuid'}})),{name:'Idempotency-Key',in:'header',required:true,schema:{type:'string',minLength:8,maxLength:128}},{name:'X-CSRF-Token',in:'header',required:true,schema:{type:'string'}}],requestBody:{required:true,content:{'application/json':{schema:requestSchema}}},responses:{'200':{description:'当前权限和最新状态下的结果；幂等缓存仅存资源引用',content:{'application/json':{schema:z.toJSONSchema(responseSchema(result))}}},...Object.fromEntries(['400','401','403','404','409','410','429'].map(code=>[code,{description:'结构化错误及下一步',content:{'application/json':{schema:z.toJSONSchema(errorSchema)}}}]))}}};
}
for(const [path,schema] of [
 ['/restaurant/restaurants',pageSchema(restaurantSchema)],['/restaurant/restaurants/{id}',restaurantSchema],['/restaurant/restaurants/{id}/staff',z.array(restaurantGrantSchema)],['/restaurant/restaurants/{id}/members',z.array(z.strictObject({id,name:z.string()}))],['/restaurant/restaurants/{id}/terminals',z.array(restaurantTerminalSchema)],['/restaurant/restaurants/{id}/tables',z.array(restaurantTableSchema)],['/restaurant/restaurants/{id}/menu',staffMenuSchema],['/restaurant/restaurants/{id}/parties',pageSchema(diningPartySchema)],['/restaurant/parties/{id}',diningPartySchema],['/restaurant/recommendations/{id}',diningRecommendationSchema],['/restaurant/skus/{id}/stock-history',z.array(restaurantStockAdjustmentSchema)],['/guest/sessions/{id}/dining',guestDiningSchema],['/guest/sessions/{id}/dining/recommendations/{recommendationId}',diningRecommendationSchema]
] as const){openapi.paths[path]={...openapi.paths[path],get:{summary:'餐厅当前持久化状态；顾客仅访问本人记录及公开菜单',security:path.startsWith('/guest/')?[{guestSession:[]}]:[{session:[]}],parameters:[...Array.from(path.matchAll(/\{(\w+)\}/g),m=>({name:m[1],in:'path',required:true,schema:{type:'string',format:'uuid'}})),...(path==='/restaurant/restaurants'?[{name:'workspaceId',in:'query',schema:{type:'string',format:'uuid'}}]:path.endsWith('/parties')?[{name:'kind',in:'query',schema:{type:'string',enum:['queue','reservations','history']}},{name:'cursor',in:'query',schema:{type:'string',format:'uuid'}},{name:'limit',in:'query',schema:{type:'integer',minimum:1,maximum:100}}]:[])],responses:{'200':{description:'本地业务数据；真实POS未接入',content:{'application/json':{schema:z.toJSONSchema(responseSchema(schema))}}}}}};}

registerOrderSpec(openapi.paths,responseSchema,errorSchema);

openapi.paths['/guest/sessions/{id}/dining/memory-imports/{importId}']={get:{summary:'原生餐厅顾客读取本人当前仍有效的建议快照',security:[{guestSession:[]}],'x-native-postgres-only':true,parameters:[{name:'id',in:'path',required:true,schema:{type:'string',format:'uuid'}},{name:'importId',in:'path',required:true,schema:{type:'string',format:'uuid'}}],responses:{'200':{description:'当前本人、门店、发问人和就餐选择范围内的建议',content:{'application/json':{schema:z.toJSONSchema(responseSchema(diningMemoryImportSchema))}}},...Object.fromEntries(['401','403','404','409'].map(code=>[code,{description:'授权或建议来源已失效',content:{'application/json':{schema:z.toJSONSchema(errorSchema)}}}]))}}};
export * from './billing.js';
export * from './dining-service.js';
export * from './proactive.js';
import {registerProactiveSpec} from './proactive.js';
registerProactiveSpec(openapi.paths,responseSchema,errorSchema);
export * from './voice.js';
import { registerVoiceSpec } from './voice-openapi.js';

registerBillingSpec(openapi.paths,responseSchema,errorSchema);
registerVoiceSpec(openapi.paths,responseSchema,errorSchema);

export * from './character.js';

import { registerCharacterSpec } from './character-openapi.js';
registerCharacterSpec(openapi.paths,responseSchema,errorSchema,assetSchema);

export * from './content.js';
import { registerContentSpec } from './content-openapi.js';
registerContentSpec(openapi.paths,responseSchema,errorSchema);

export * from './content-drafts.js';
import { registerContentDraftSpec } from './content-draft-openapi.js';
registerContentDraftSpec(openapi.paths,responseSchema,errorSchema);

export * from './recordings.js';
import {registerRecordingSpec} from './recording-openapi.js';
registerRecordingSpec(openapi.paths,responseSchema,errorSchema);

export * from './media-processing.js';
export * from './semantic-clips.js';
export * from './restoration.js';
export * from './media-limits.js';
export * from './media-types.js';
import {registerMediaProcessingSpec} from './media-processing-openapi.js';
registerMediaProcessingSpec(openapi.paths,responseSchema,errorSchema);
export * from './transcriptions.js';
import {registerTranscriptionSpec} from './transcription-openapi.js';
registerTranscriptionSpec(openapi.paths,responseSchema,errorSchema);
export * from './frame-reviews.js';
import {registerFrameReviewSpec} from './frame-review-openapi.js';
Object.assign(openapi.components.securitySchemes,{reviewSession:{type:'apiKey',in:'cookie',name:'dg_frame_review'}});
registerFrameReviewSpec(openapi.paths,responseSchema,errorSchema);
export * from './asset-library.js';
import {registerAssetLibrarySpec} from './asset-library-openapi.js';
registerAssetLibrarySpec(openapi.paths,responseSchema,errorSchema);
export * from './file-collections.js';
import {registerFileCollectionSpec} from './file-collection-openapi.js';
Object.assign(openapi.components.securitySchemes,{collectionSession:{type:'apiKey',in:'cookie',name:'dg_file_collection'}});
registerFileCollectionSpec(openapi.paths,responseSchema,errorSchema);
export * from './presentations.js';
import {registerPresentationSpec} from './presentation-openapi.js';
registerPresentationSpec(openapi.paths,responseSchema,errorSchema);
export * from './courses.js';
import {registerCourseSpec} from './course-openapi.js';
registerCourseSpec(openapi.paths,responseSchema,errorSchema);
export * from './template-controls.js';
import {registerTemplateControlSpec} from './template-control-openapi.js';
registerTemplateControlSpec(openapi.paths,responseSchema,errorSchema);
export * from './ae-templates.js';
export * from './ae-media.js';
export * from './live-peers.js';
import {registerLivePeerSpec} from './live-peer-openapi.js';
Object.assign(openapi.components.securitySchemes,{peerGuest:{type:'apiKey',in:'cookie',name:'dg_live_peer'},programmeGuest:{type:'apiKey',in:'cookie',name:'dg_live_programme'}});
registerLivePeerSpec(openapi.paths,responseSchema,errorSchema);
registerGuestProgrammeSpec(openapi.paths,responseSchema,errorSchema);
import {registerAeMediaSpec} from './ae-media-openapi.js';
registerAeMediaSpec(openapi.paths,responseSchema,errorSchema);
export * from './ae-source.js';
export * from './denoising.js';
import {registerAeSourceSpec} from './ae-source-openapi.js';
registerAeSourceSpec(openapi.paths,responseSchema,errorSchema);
import {registerAeSpec} from './ae-openapi.js';
registerAeSpec(openapi.paths,responseSchema,errorSchema);
export * from './shares.js';
import {registerShareSpec} from './share-openapi.js';
Object.assign(openapi.components.securitySchemes,{shareSession:{type:'apiKey',in:'cookie',name:'dg_share'}});
registerShareSpec(openapi.paths,responseSchema,errorSchema);
export * from './content-governance.js';
import {registerContentGovernanceSpec} from './content-governance-openapi.js';
registerContentGovernanceSpec(openapi.paths,responseSchema,errorSchema);
export * from './live.js';
import {registerLiveSpec} from './live-openapi.js';
registerLiveSpec(openapi.paths,responseSchema,errorSchema);
export * from './live-output.js';

export * from './advertising.js';

import {registerAdvertisingSpec} from './advertising-openapi.js';
registerAdvertisingSpec(openapi.paths,responseSchema,errorSchema);

export * from './studio-assistant.js';

import {registerStudioAssistantSpec} from './studio-assistant-openapi.js';
registerStudioAssistantSpec(openapi.paths,responseSchema,errorSchema);

export * from './local-editor.js';
export * from './presentation-answers.js';
export * from './live-speech.js';
export * from './gaze.js';
export * from './live-answers.js';
export * from './live-puppet.js';
export * from './content-writing.js';

import {registerContentWritingSpec} from './content-writing-openapi.js';
registerContentWritingSpec(openapi.paths,responseSchema,errorSchema);
export * from './writing-review.js';

export * from './live-guest-programme.js';
export * from './practice.js';

export * from './practice-presets.js';
export * from './reception-hosts.js';
import {registerReceptionHostSpec} from './reception-hosts-openapi.js';
registerReceptionHostSpec(openapi.paths,responseSchema,errorSchema);

import {registerPracticeSpec} from './practice-openapi.js';
registerPracticeSpec(openapi.paths,responseSchema,errorSchema);

export * from './operations.js';
import {registerOperationsSpec} from './operations-openapi.js';
registerOperationsSpec(openapi.paths,responseSchema,errorSchema);

export * from './enterprise-plans.js';
import {registerEnterprisePlansSpec} from './enterprise-plans-openapi.js';
registerEnterprisePlansSpec(openapi.paths,responseSchema,errorSchema);

export * from './resource-shelf.js';
import {registerResourceShelfSpec} from './resource-shelf-openapi.js';
registerResourceShelfSpec(openapi.paths,responseSchema,errorSchema);

import {registerEnterpriseIdentitySpec} from './enterprise-identity-openapi.js';
registerEnterpriseIdentitySpec(openapi.paths,responseSchema,errorSchema);

export * from './enterprise-directory.js';
import {registerDirectorySpec} from './enterprise-directory-openapi.js';
registerDirectorySpec(openapi.paths,responseSchema,errorSchema);
Object.assign(openapi.components.securitySchemes,{directoryBearer:{type:'http',scheme:'bearer'}});

export * from './directory-access.js';
import {registerDirectoryAccessSpec} from './directory-access-openapi.js';
registerDirectoryAccessSpec(openapi.paths,responseSchema,errorSchema);

export * from './directory-lifecycle.js';

import {registerDirectoryLifecycleSpec} from './directory-lifecycle-openapi.js';
registerDirectoryLifecycleSpec(openapi.paths,responseSchema,errorSchema);

export * from './developer-access.js';
import {registerDeveloperAccessSpec} from './developer-access-openapi.js';
registerDeveloperAccessSpec(openapi.paths,responseSchema,errorSchema);
Object.assign(openapi.components.securitySchemes,{developerBearer:{type:'http',scheme:'bearer'}});

export * from './developer-webhooks.js';
import {registerDeveloperWebhooksSpec,outboundDeveloperWebhooks} from './developer-webhooks-openapi.js';
registerDeveloperWebhooksSpec(openapi.paths,responseSchema,errorSchema);
Object.assign(openapi,{webhooks:outboundDeveloperWebhooks});
Object.assign(openapi.components.securitySchemes,{webhookSignature:{type:'apiKey',in:'header',name:'X-DigitalGuide-Signature',description:'HMAC-SHA256绑定原始正文摘要、时间戳与投递编号，接收端须验证并持久去重。'}});

export * from './developer-studio.js';

import {registerDeveloperStudioSpec} from './developer-studio-openapi.js';
registerDeveloperStudioSpec(openapi.paths,responseSchema,errorSchema);
