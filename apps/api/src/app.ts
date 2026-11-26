import {SqliteDeveloperStudioAdapter} from './developer-studio-sqlite.js';
import {WebhookRuntime} from '../../../packages/enterprise/src/webhook-runtime.js';
import {registerDeveloperRoutes} from './developer-routes.js';
import {DeveloperWorkflows} from '../../../packages/enterprise/src/developer-workflows.js';
import {scopedMemberName} from '../../../packages/enterprise/src/member-name-sql.js';
import {DirectoryRuntime} from '../../../packages/enterprise/src/directory-runtime.js';
import {IdentityWorkflows} from '../../../packages/enterprise/src/identity-workflows.js';
import {DirectoryWorkflows} from '../../../packages/enterprise/src/directory-workflows.js';
import {SqliteIdentityStore} from './identity-store.js';
import {registerDirectoryAdminRoutes,registerScimRoutes} from './directory-routes.js';
import {IdentityRuntime} from '../../../packages/enterprise/src/identity-runtime.js';
import {registerIdentityRoutes} from './identity-routes.js';
import {registerResourceShelfRoutes} from './resource-shelf-routes.js';
import {registerEnterprisePlanRoutes} from './enterprise-plan-routes.js';
import {EnterprisePlanService} from './enterprise-plan-service.js';
import {registerOperationsRoutes} from './operations-routes.js';
import {setApiErrorHandler} from './api-errors.js';
import {createPostgresCoreApp} from './postgres-core-app.js';
import {assertSqliteDataDirectory} from '../../../packages/database/src/store-selection.js';
import {registerPracticeRoutes} from './practice-routes.js';
import {registerLiveGuestProgrammeRoutes} from './live-guest-programme-routes.js';
import {registerContentWritingRoutes} from './content-writing-routes.js';
import {registerLiveAnswerRoutes} from './live-answers-routes.js';
import {registerLiveSpeechRoutes} from './live-speech-routes.js';
import {registerStudioAssistantRoutes} from './studio-assistant-routes.js';
import {registerAdvertisingRoutes} from './advertising-routes.js';
import {registerLiveOutputRoutes} from './live-output-routes.js';
import {registerAeRoutes} from './ae-template-routes.js';
import {registerAeSourceRoutes} from './ae-source-routes.js';
import {registerAeMediaRoutes} from './ae-media-routes.js';
import {registerLivePeerRoutes} from './live-peer-routes.js';
import {registerShareRoutes} from './share-routes.js';
import {registerContentGovernanceRoutes} from './content-governance-routes.js';
import {registerLiveRoutes} from './live-routes.js';
import { registerCharacterRoutes } from './character-routes.js';
import { registerContentSourceRoutes } from './content-source-routes.js';
import { registerContentDraftRoutes } from './content-draft-routes.js';
import {registerRecordingRoutes} from './recording-routes.js';
import {registerMediaProcessingRoutes} from './media-processing-routes.js';
import {registerTranscriptionRoutes} from './transcription-routes.js';
import {registerFrameReviewRoutes} from './frame-review-routes.js';
import {registerAssetLibraryRoutes} from './asset-library-routes.js';
import {registerFileCollectionRoutes} from './file-collection-routes.js';
import {registerPresentationRoutes} from './presentation-routes.js';
import {registerCourseRoutes} from './course-routes.js';
import {registerTemplateControlRoutes} from './template-control-routes.js';
import {registerAlphaVideoRoutes} from './alpha-video-routes.js';
import { grantAssetConsent,revokeAssetConsent } from './asset-consent-actions.js';
import { registerDistributionRoutes } from './distribution-routes.js';
import { registerStudioTeamRoutes } from './studio-team-routes.js';
import { registerStudioRoutes } from './studio-routes.js';
import { registerVoiceAuthoringRoutes } from './voice-authoring-routes.js';
import { registerTimelineRoutes } from './timeline-routes.js';
import { registerStudioExportRoutes } from './studio-export-routes.js';
import { registerMediaTransferRoutes } from './media-transfer-routes.js';
import { privateFile } from './private-file.js';
import { ownedFile } from '../../../packages/media/src/files.js';
import { registerExhibitionRoutes } from './exhibition-routes.js';
import { clearAllSpeakerBuffers } from './speaker-lifecycle.js';
import { authenticatedSession } from './auth-check.js';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { Repository } from '@digitalguide/database';
import { AppError, assertUsableAsset, requirePermission, requireWorkspace, type Permission, type Principal } from '@digitalguide/domain';
import { assetInput, assetUpdateInput, id, jobInput, listInput, loginInput, openapi, profileInput, profileUpdateInput, routeInput, uploadInput, type Capability, type Me } from '@digitalguide/contracts';
import { inspectMedia } from '@digitalguide/media';
import { MockTaskProvider, selectProvider, type RuntimeAdapters } from '@digitalguide/providers';
import type { Config } from './config.js';
import {assertRecoveryAccess,recoveryReadAllowed} from '../../../packages/recovery/src/guard.js';
import { executeIdempotent } from './idempotency.js';
import { registerReceptionRoutes } from './reception-routes.js';
import { registerOfficeRoutes } from './office-routes.js';
import { registerKnowledgeRoutes } from './knowledge-routes.js';

declare module 'fastify' { interface FastifyRequest { principal: Principal; csrfToken: string } }
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const cookieOptions = { path: '/api', httpOnly: true, sameSite: 'strict' as const };

export async function createApp(config: Config, repository?: Repository, adapters: RuntimeAdapters = {}) {
  if(config.nativeSpeakerUiPreview&&!config.nativePostgres)throw new AppError('NATIVE_PREVIEW_MODE_INVALID','专注界面预览仅限独立原生mock验证实例。',503);
  if(config.nativeFoodUiPreview&&!config.nativePostgres)throw new AppError('NATIVE_PREVIEW_MODE_INVALID','偏好界面预览仅限独立原生mock验证实例。',503);
  if(config.nativeDiningUiPreview&&!config.nativePostgres)throw new AppError('NATIVE_PREVIEW_MODE_INVALID','餐厅业务预览仅限独立原生mock验证实例。',503);
  if(config.nativePostgres){if(repository||Object.keys(adapters).length)throw new AppError('PG_RUNTIME_INJECTION_FORBIDDEN','原生实例不能注入SQLite仓库或未验收适配器。',503);return createPostgresCoreApp(config);}
  assertSqliteDataDirectory(config.dataDir);
  assertRecoveryAccess(config.dataDir,{appEnv:config.appEnv,environment:config.providerMode,recoveryValidationOnly:config.recoveryValidationOnly});
  const identityRuntime=new IdentityRuntime(config),directoryRuntime=new DirectoryRuntime(config);
  const repo = repository || new Repository(config.dataDir, config.root,{environment:config.providerMode,appEnv:config.appEnv},{recoveryValidationOnly:config.recoveryValidationOnly});
  repo.aeCatalogHost=config;repo.identityFingerprints=identityRuntime.fingerprints;
  const app = Fastify({ bodyLimit: 12_100_000, logger: false, genReqId: () => randomUUID() });
  await app.register(cookie, { secret: config.recoveryValidationOnly?randomBytes(48).toString('hex'):config.sessionSecret });
  app.decorateRequest('principal'); app.decorateRequest('csrfToken', '');
  const publicPaths = new Set(['/api/v1/health', '/api/v1/readiness', '/api/v1/auth/demo-accounts', '/api/v1/auth/login','/api/v1/auth/methods','/api/v1/auth/oidc/start','/api/v1/auth/oidc/callback', '/api/v1/webhooks/mock-notification','/api/v1/webhooks/mock-publishing','/api/v1/webhooks/mock-advertising','/api/v1/webhooks/mock-pos','/api/v1/webhooks/mock-payments']);
  app.addHook('onRequest', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff').header('Cache-Control', 'no-store').header('Referrer-Policy', 'same-origin');
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (unsafe && req.headers.origin && req.headers.origin !== config.webOrigin) throw new AppError('FORBIDDEN', '请求来源不受信任，请从本地工作台操作。', 403);
    const pathname = req.url.split('?')[0];
    if(config.recoveryValidationOnly){reply.header('X-DigitalGuide-Recovery','validation-only');if(!recoveryReadAllowed(req.method,pathname))throw new AppError('RECOVERY_READ_ONLY','恢复副本仅开放核心只读检查；任务、通知、发布、支付、接待与所有业务写入保持关闭。',403);}
    if (req.routeOptions.url?.startsWith('/api/v1/scim/v2/') || req.routeOptions.url?.startsWith('/api/open/v1/')) return;
    if (publicPaths.has(pathname) || (pathname.startsWith('/api/v1/guest/sessions/') || pathname.startsWith('/api/v1/guest/tours/') || pathname.startsWith('/api/v1/external/frame-reviews/') || pathname.startsWith('/api/v1/external/file-collections/') || pathname.startsWith('/api/v1/external/shares/') || pathname.startsWith('/api/v1/external/live-programme/') || pathname.startsWith('/api/v1/external/live-peers/'))) return;
    const session = authenticatedSession(repo, req, config); req.principal = session.principal; req.csrfToken = session.csrfToken;
    if (unsafe && req.headers['x-csrf-token'] !== session.csrfToken) throw new AppError('FORBIDDEN', '安全凭证已失效，请刷新页面后重试。', 403);
  });
  setApiErrorHandler(app);
  const send = (req: FastifyRequest, reply: FastifyReply, data: unknown, code = 200) => reply.code(code).send({ data, requestId: req.id });
  function mutate(req: FastifyRequest, reply: FastifyReply, permission: Permission, work: () => unknown, code = 200) {
    requirePermission(req.principal, permission);
    const value = executeIdempotent(repo, req, req.principal.tenantId, req.principal.userId, work, code);
    return send(req, reply, value.data, value.code);
  }
  function scope(req: FastifyRequest) {
    const q = listInput.parse(req.query), p = req.principal;
    const ids = q.workspaceId ? [q.workspaceId] : p.workspaceIds;
    ids.forEach(workspaceId => requireWorkspace(p, workspaceId));
    if (!ids.length) throw new AppError('FORBIDDEN', '尚未分配工作空间，请联系管理员。', 403);
    if (q.cursor) id.parse(q.cursor);
    return { q, ids, placeholders: ids.map(() => '?').join(',') };
  }
  const resourceId = (req: FastifyRequest) => id.parse((req.params as { id: string }).id);
  const page = <T extends { id: string }>(items: T[], limit: number) => ({ items: items.slice(0, limit), nextCursor: items.length > limit ? items[limit - 1].id : null });
  function capability(p: Principal): Capability {
    const base = new MockTaskProvider().capabilities;
    const health = repo.get<{ failures: number; open_until: string | null }>('SELECT * FROM provider_health WHERE tenant_id=? AND provider_id=?', p.tenantId, base.id);
    if (config.providerMode !== 'mock') return { ...base, id: 'unconfigured-' + config.providerMode, name: '待接入供应商', environment: config.providerMode, verification: 'not_configured', features: [], circuit: 'closed', nextStep: '请由管理员配置当前环境适配器。系统不会静默使用模拟结果。' };
    return { ...base, circuit: health?.open_until ? health.open_until > new Date().toISOString() ? 'open' : 'half_open' : 'closed' };
  }

  app.get('/api/v1/health', (req, reply) => send(req, reply, { status: 'ok', service: 'DigitalGuide API', environment: config.providerMode }));
  app.get('/api/v1/readiness', (req, reply) => { repo.get('SELECT 1'); return send(req, reply, { status: 'ready', database: 'sqlite', gate: config.recoveryValidationOnly?'recovery_validation_only':'G1_in_progress', worker: config.recoveryValidationOnly?'disabled':'independent', ...(config.recoveryValidationOnly?{recoveryValidationOnly:true,businessEnabled:false}:{}) }); });
  app.get('/api/v1/auth/demo-accounts', (req, reply) => {
    if (config.appEnv === 'production') throw new AppError('NOT_FOUND', '生产环境不提供演示账号，请使用企业登录。', 404);
    return send(req, reply, repo.all(`SELECT u.id,${scopedMemberName('u','m.tenant_id',config.providerMode,config.appEnv)} AS name,t.name AS tenantName,m.role FROM users u JOIN ${repo.membershipsSql()} m ON m.user_id=u.id JOIN tenants t ON t.id=m.tenant_id WHERE json_array_length(m.workspace_ids)>0 AND NOT EXISTS(SELECT 1 FROM enterprise_member_controls c WHERE c.user_id=u.id AND c.tenant_id=m.tenant_id AND c.environment=? AND c.app_env=? AND c.status='suspended') ORDER BY u.id`,config.providerMode,config.appEnv));
  });
  app.post('/api/v1/auth/login', (req, reply) => {
    if (config.appEnv === 'production') throw new AppError('FORBIDDEN', '生产环境禁止演示登录；请配置企业身份服务。', 403);
    const input = loginInput.parse(req.body);
    const token = randomBytes(40).toString('hex'), csrf = randomBytes(32).toString('hex');
    repo.transaction(() => {
      if(!repo.principal(input.accountId).workspaceIds.length)throw new AppError('AUTH_REQUIRED','该成员尚未分配工作空间，请联系管理员。',401);
      repo.run('DELETE FROM auth_sessions WHERE expires_at<=?', new Date().toISOString());
      repo.run('INSERT INTO auth_sessions VALUES (?,?,?,?,?,?)', digest(token), input.accountId, csrf, new Date(Date.now() + 8 * 3600_000).toISOString(), config.providerMode, config.appEnv);
    });
    reply.setCookie('dg_session', token, { ...cookieOptions, signed: true, secure: config.webOrigin.startsWith('https:'), maxAge: 8 * 3600 });
    return send(req, reply, { authenticated: true });
  });
  app.post('/api/v1/auth/logout', (req, reply) => {
    const unsigned = req.unsignCookie(req.cookies.dg_session!);
    if (unsigned.valid) repo.run('DELETE FROM auth_sessions WHERE token_hash=?', digest(unsigned.value!));
    reply.clearCookie('dg_session', cookieOptions); return send(req, reply, { authenticated: false });
  });
  app.get('/api/v1/me', (req, reply) => {
    const p = req.principal;
    const user = repo.get<{name:string}>(`SELECT ${scopedMemberName('u','t.id',config.providerMode,config.appEnv)} AS name FROM users u CROSS JOIN tenants t WHERE u.id=? AND t.id=?`,p.userId,p.tenantId)!;
    const tenant = repo.get<{ name: string }>('SELECT name FROM tenants WHERE id=?', p.tenantId)!;
    const workspaces = repo.all<{ id: string; name: string }>('SELECT id,name FROM workspaces WHERE tenant_id=?', p.tenantId).filter(w => p.workspaceIds.includes(w.id));
    const me: Me = { developerStudioAvailable:!config.recoveryValidationOnly,developerWebhooksAvailable:!config.recoveryValidationOnly,developerAccessAvailable:!config.recoveryValidationOnly,enterpriseDirectoryLifecycleAvailable:!config.recoveryValidationOnly,enterpriseDirectoryGroupAccessAvailable:!config.recoveryValidationOnly,enterpriseDirectoryAvailable:!config.recoveryValidationOnly,enterpriseMembersAvailable:!config.recoveryValidationOnly,enterpriseIdentityAvailable:!config.recoveryValidationOnly, resourceShelfAvailable:!config.recoveryValidationOnly, enterprisePlansAvailable:!config.recoveryValidationOnly, operationsMetricsAvailable:!config.recoveryValidationOnly, id: p.userId, name: user.name, tenantId: p.tenantId, tenantName: tenant.name, role: p.role, workspaces, csrfToken: req.csrfToken, environment: config.providerMode };
    return send(req, reply, me);
  });
  app.get('/api/v1/venues', (req, reply) => {
    const { ids, placeholders } = scope(req);
    return send(req, reply, repo.all(`SELECT id,name,workspace_id AS workspaceId,timezone FROM venues WHERE tenant_id=? AND workspace_id IN (${placeholders})`, req.principal.tenantId, ...ids));
  });
  registerIdentityRoutes(app,repo,config,identityRuntime,send);
  const directoryStore=new SqliteIdentityStore(repo,id=>{directoryRuntime.rotate(id);}),directoryWorkflow=new DirectoryWorkflows(new IdentityWorkflows(identityRuntime),directoryRuntime);
  registerScimRoutes(app,directoryWorkflow,directoryStore);
  registerDirectoryAdminRoutes(app,directoryWorkflow,directoryStore,(req,write,work)=>{const session=authenticatedSession(repo,req,config);if(write&&req.headers['x-csrf-token']!==session.csrfToken)throw new AppError('FORBIDDEN','安全凭证已失效，请刷新后重试。',403);return work(session.principal);},send);
  registerDeveloperRoutes(app,new DeveloperWorkflows(config,new IdentityWorkflows(identityRuntime),false,true,true),new SqliteIdentityStore(repo),(req,write,work)=>{const session=authenticatedSession(repo,req,config);if(write&&req.headers['x-csrf-token']!==session.csrfToken)throw new AppError('FORBIDDEN','安全凭证已失效，请刷新后重试。',403);return work(session.principal);},send,new WebhookRuntime(config),workflow=>new SqliteDeveloperStudioAdapter(repo,config,workflow));
  registerResourceShelfRoutes(app,repo,config,send);
  registerEnterprisePlanRoutes(app,repo,config,send);
  registerOperationsRoutes(app,repo,config,send);
  app.get('/api/v1/overview', (req, reply) => {
    const { ids, placeholders } = scope(req), p = req.principal;
    const count = (table: 'assets' | 'profiles' | 'jobs', extra = '', args: string[] = []) => repo.get<{ n: number }>(`SELECT count(*) AS n FROM ${table} WHERE tenant_id=? AND workspace_id IN (${placeholders}) ${extra}`, p.tenantId, ...ids, ...args)!.n;
    return send(req, reply, { assets: count('assets', 'AND archived=0'), profiles: count('profiles'), queued: count('jobs', "AND status IN ('queued','running','retrying','cancellation_requested') AND environment=?", [config.providerMode]), succeeded: count('jobs', "AND status='succeeded' AND environment=?", [config.providerMode]), failed: count('jobs', "AND status='failed' AND environment=?", [config.providerMode]), unknown: count('jobs', "AND status='unknown' AND environment=?", [config.providerMode]), dailyUsed: count('jobs', 'AND created_at>=? AND environment=?', [new Date().toISOString().slice(0, 10), config.providerMode]), dailyLimit: repo.get<{ daily_limit: number }>('SELECT daily_limit FROM tenants WHERE id=?', p.tenantId)!.daily_limit, environment: config.providerMode, faceRecognitionEnabled: false });
  });
  app.get('/api/v1/capabilities', (req, reply) => {
    const notification: Capability = { id: config.providerMode === 'mock' ? 'mock-notification' : 'unconfigured-notification', name: '来访通知适配器', environment: config.providerMode, verification: config.providerMode === 'mock' ? 'contract_verified' : 'not_configured', features: config.providerMode === 'mock' ? ['notification.visit'] : [], realCapabilities: [], cost: { currency: 'CNY', estimatedMinor: null }, limits: { maxConcurrent: 1, dailyJobs: Math.min(100, repo.get<{ daily_limit: number }>('SELECT daily_limit FROM tenants WHERE id=?', req.principal.tenantId)!.daily_limit) }, circuit: 'closed', nextStep: '当前仅模拟通知与签名回执；真实通讯渠道需要测试账号、应用权限及指定收件人。' };
    return send(req, reply, [capability(req.principal), notification]);
  });
  app.get('/api/v1/openapi.json', (req, reply) => send(req, reply, openapi));

  app.post('/api/v1/assets/uploads', (req, reply) => mutate(req, reply, 'asset.write', () => {
    const input = uploadInput.parse(req.body), p = req.principal; requireWorkspace(p, input.workspaceId);
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input.contentBase64) || input.contentBase64.length % 4 !== 0) throw new AppError('INVALID_MEDIA', '文件编码无效，请重新选择文件。');
    const buffer = Buffer.from(input.contentBase64, 'base64');
    if (buffer.length > 8 * 1024 * 1024) throw new AppError('FILE_TOO_LARGE', '文件超过 8 MB，请压缩后重新上传。', 413);
    const specs = inspectMedia(buffer), uploadId = randomUUID(), sha = digest(buffer), key = uploadId + '.bin';
    writeFileSync(path.join(config.dataDir, 'objects', key), buffer, { flag: 'wx' });
    repo.run('INSERT INTO uploads VALUES (?,?,?,?,?,?,?,?,?,?)', uploadId, p.tenantId, input.workspaceId, p.userId, key, sha, buffer.length, specs.mediaType, JSON.stringify(specs.specs), new Date().toISOString());
    repo.audit(p, input.workspaceId, 'asset.upload', uploadId, req.id);
    return { uploadId, mediaType: specs.mediaType, specs: specs.specs, size: buffer.length, sha256: sha };
  }, 201));
  app.post('/api/v1/assets', (req, reply) => mutate(req, reply, 'asset.write', () => {
    const input = assetInput.parse(req.body), p = req.principal;
    const upload = repo.get<{ workspace_id: string; media_type: string }>('SELECT workspace_id,media_type FROM uploads WHERE id=? AND tenant_id=? AND owner_id=?', input.uploadId, p.tenantId, p.userId);
    if (!upload) throw new AppError('NOT_FOUND', '上传记录不存在，请重新上传素材。', 404);
    requireWorkspace(p, upload.workspace_id);
    if (repo.get('SELECT id FROM assets WHERE upload_id=?', input.uploadId)) throw new AppError('STATE_CONFLICT', '该上传文件已登记为资产，请查看资产列表。', 409);
    if ((input.category === 'voice' && upload.media_type !== 'audio/wav') || (['avatar', 'background'].includes(input.category) && upload.media_type !== 'image/png')) throw new AppError('INVALID_MEDIA', '素材用途与格式不匹配：形象和背景请上传 PNG，声音请上传 PCM WAV。');
    if (input.expiresAt && input.expiresAt <= new Date().toISOString()) throw new AppError('ASSET_EXPIRED', '素材有效期必须晚于当前时间。', 409);
    const assetId = randomUUID(), now = new Date().toISOString();
    repo.run('INSERT INTO assets(id,tenant_id,workspace_id,upload_id,name,category,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?)', assetId, p.tenantId, upload.workspace_id, input.uploadId, input.name, input.category, input.expiresAt, now);
    const asset = repo.asset(p, assetId); repo.run('INSERT INTO asset_versions VALUES (?,?,?,?)', assetId, 1, JSON.stringify(asset), now);
    repo.audit(p, upload.workspace_id, 'asset.create', assetId, req.id); return asset;
  }, 201));
  app.get('/api/v1/assets', (req, reply) => {
    const { q, ids, placeholders } = scope(req), p = req.principal;
    const mediaTypes=q.mediaType==='video'?['video/mp4','video/quicktime']:q.mediaType?[q.mediaType]:[];
    const rows = repo.all<{ id: string }>(`SELECT id FROM assets WHERE tenant_id=? AND workspace_id IN (${placeholders}) AND archived=? AND id>?${mediaTypes.length ? ' AND upload_id IN (SELECT id FROM uploads WHERE media_type IN ('+mediaTypes.map(()=>'?').join(',')+'))' : ''} ORDER BY id LIMIT ?`, p.tenantId, ...ids, q.archived === 'true' ? 1 : 0, q.cursor || '',...mediaTypes,q.limit + 1);
    return send(req, reply, page(rows.map(row => repo.asset(p, row.id)), q.limit));
  });
  app.get('/api/v1/assets/:id', (req, reply) => send(req, reply, repo.asset(req.principal, resourceId(req))));
  app.get('/api/v1/assets/:id/content', (req, reply) => {
    const asset = repo.asset(req.principal, resourceId(req)); assertUsableAsset(asset);
    const upload = repo.get<{ storage_key: string }>('SELECT u.storage_key FROM uploads u JOIN assets a ON a.upload_id=u.id WHERE a.id=? AND a.tenant_id=?', asset.id, req.principal.tenantId)!;
    return privateFile(req,reply,ownedFile(path.join(config.dataDir,'objects'),upload.storage_key),asset.mediaType);
  });
  app.patch('/api/v1/assets/:id', (req, reply) => mutate(req, reply, 'asset.write', () => {
    const input = assetUpdateInput.parse(req.body), p = req.principal, asset = repo.asset(p, resourceId(req));
    if (asset.version !== input.version) throw new AppError('VERSION_CONFLICT', '素材已被其他成员修改，请刷新后重试。', 409);
    repo.run('UPDATE assets SET name=?,archived=?,version=version+1 WHERE id=? AND tenant_id=? AND version=?', input.name || asset.name, Number(input.archived ?? asset.archived), asset.id, p.tenantId, input.version);
    const updated = repo.asset(p, asset.id); repo.run('INSERT INTO asset_versions VALUES (?,?,?,?)', asset.id, updated.version, JSON.stringify(updated), new Date().toISOString());
    repo.audit(p, asset.workspaceId, input.archived ? 'asset.archive' : 'asset.update', asset.id, req.id); return updated;
  }));
  app.get('/api/v1/assets/:id/versions', (req, reply) => {
    const asset = repo.asset(req.principal, resourceId(req));
    return send(req, reply, repo.all<{ version: number; snapshot: string; createdAt: string }>('SELECT version,snapshot,created_at AS createdAt FROM asset_versions WHERE asset_id=? ORDER BY version DESC', asset.id).map(r => ({ ...r, snapshot: JSON.parse(r.snapshot) })));
  });
  app.post('/api/v1/assets/:id/consents',(req,reply)=>grantAssetConsent(repo,config,req,reply));
  app.get('/api/v1/assets/:id/consents', (req, reply) => {
    const asset = repo.asset(req.principal, resourceId(req));
    return send(req, reply, repo.all('SELECT id,asset_id AS assetId,purpose,subject,expires_at AS expiresAt,revoked_at AS revokedAt FROM consents WHERE asset_id=? AND tenant_id=?', asset.id, req.principal.tenantId));
  });
  app.post('/api/v1/consents/:id/revoke',(req,reply)=>revokeAssetConsent(repo,config,req,reply));

  app.post('/api/v1/jobs', (req, reply) => mutate(req, reply, 'job.write', () => {
    const input = jobInput.parse(req.body), p = req.principal; requireWorkspace(p, input.workspaceId);
    const provider = selectProvider(config.providerMode);
    if (!provider.capabilities.features.includes(input.kind)) throw new AppError('CAPABILITY_UNAVAILABLE', '提供商不支持此任务，请选择兼容的提供商。', 409);
    if (capability(p).circuit === 'open') throw new AppError('PROVIDER_CIRCUIT_OPEN', '提供商连续失败，已暂停新任务。请在 30 秒后重试。', 409, true);
    if (input.kind !== 'provider.check') {
      requirePermission(p, 'asset.train');
      if (!input.assetId || !input.consentId) throw new AppError('CONSENT_REQUIRED', '训练前需要选择素材及有效的专项授权，请先登记授权。', 409);
      const asset = repo.asset(p, input.assetId); assertUsableAsset(asset);
      if (asset.workspaceId !== input.workspaceId) throw new AppError('NOT_FOUND', '素材不属于当前工作空间。', 404);
      if ((input.kind === 'training.avatar' && asset.mediaType !== 'image/png') || (input.kind === 'training.voice' && asset.mediaType !== 'audio/wav')) throw new AppError('INVALID_MEDIA', '训练类型与素材格式不匹配。');
      if (!repo.get('SELECT id FROM consents WHERE id=? AND tenant_id=? AND asset_id=? AND purpose=? AND revoked_at IS NULL AND expires_at>?', input.consentId, p.tenantId, asset.id, input.kind === 'training.avatar' ? 'train_avatar' : 'train_voice', new Date().toISOString())) throw new AppError('CONSENT_REQUIRED', '缺少此素材的有效用途授权，请先登记或更新授权。', 409);
    }
    const used = repo.get<{ n: number }>('SELECT count(*) AS n FROM jobs WHERE tenant_id=? AND environment=? AND created_at>=?', p.tenantId, config.providerMode, new Date().toISOString().slice(0, 10))!.n;
    const limit = repo.get<{ daily_limit: number }>('SELECT daily_limit FROM tenants WHERE id=?', p.tenantId)!.daily_limit;
    new EnterprisePlanService(repo,config).admission(p,input.kind,new Date().toISOString(),limit,used);
    if (used >= limit) throw new AppError('QUOTA_EXCEEDED', '今日任务额度已用完，请明日重试或联系管理员。', 409);
    const jobId = randomUUID(), now = new Date().toISOString();
    repo.run('INSERT INTO jobs(id,tenant_id,workspace_id,actor_id,kind,payload,environment,status,available_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,\'queued\',?,?,?)', jobId, p.tenantId, input.workspaceId, p.userId, input.kind, JSON.stringify(input), config.providerMode, now, now, now);
    repo.event(p.tenantId, input.workspaceId, jobId, 'job.queued', config.providerMode); repo.audit(p, input.workspaceId, 'job.create', jobId, req.id);
    return { jobId, statusUrl: '/api/v1/jobs/' + jobId, ...repo.job(p, jobId) };
  }, 202));
  app.get('/api/v1/jobs', (req, reply) => {
    const { q, ids, placeholders } = scope(req), p = req.principal;
    const rows = repo.all<{ id: string }>(`SELECT id FROM jobs WHERE tenant_id=? AND workspace_id IN (${placeholders}) AND environment=? AND id>? ORDER BY id LIMIT ?`, p.tenantId, ...ids, config.providerMode, q.cursor || '', q.limit + 1);
    return send(req, reply, page(rows.map(r => repo.job(p, r.id)), q.limit));
  });
  app.get('/api/v1/jobs/:id', (req, reply) => send(req, reply, repo.job(req.principal, resourceId(req))));
  app.post('/api/v1/jobs/:id/cancel', (req, reply) => mutate(req, reply, 'job.write', () => {
    const p = req.principal, job = repo.job(p, resourceId(req));
    if (!['queued', 'retrying', 'running', 'cancellation_requested'].includes(job.status)) throw new AppError('STATE_CONFLICT', '任务已结束或结果未知，不能取消；请查看任务详情。', 409);
    const status = ['queued', 'retrying'].includes(job.status) ? 'cancelled' : 'cancellation_requested';
    repo.run('UPDATE jobs SET status=?,updated_at=? WHERE id=? AND tenant_id=?', status, new Date().toISOString(), job.id, p.tenantId);
    repo.event(p.tenantId, job.workspaceId, job.id, 'job.' + status, job.environment); repo.audit(p, job.workspaceId, 'job.cancel', job.id, req.id); return repo.job(p, job.id);
  }));

  app.post('/api/v1/profiles', (req, reply) => mutate(req, reply, 'profile.write', () => {
    const input = profileInput.parse(req.body), p = req.principal; requireWorkspace(p, input.workspaceId);
    const avatar = repo.asset(p, input.avatarAssetId), voice = input.voiceAssetId ? repo.asset(p, input.voiceAssetId) : null;
    for (const asset of [avatar, voice].filter(a => a !== null)) { assertUsableAsset(asset); if (asset.workspaceId !== input.workspaceId) throw new AppError('NOT_FOUND', '角色绑定素材必须属于同一工作空间。', 404); }
    if (avatar.mediaType !== 'image/png' || (voice && voice.mediaType !== 'audio/wav')) throw new AppError('INVALID_MEDIA', '形象请绑定 PNG 参考，声音请绑定 PCM WAV。');
    const profileId = randomUUID(), now = new Date().toISOString();
    repo.run('INSERT INTO profiles VALUES (?,?,?,?,?,?,?,1,?)', profileId, p.tenantId, input.workspaceId, input.name, avatar.id, voice?.id || null, JSON.stringify([...new Set(input.scenes)]), now);
    const profile = repo.profile(p, profileId); repo.run('INSERT INTO profile_versions VALUES (?,?,?,?)', profileId, 1, JSON.stringify(profile), now);
    repo.audit(p, input.workspaceId, 'profile.create', profileId, req.id); return profile;
  }, 201));
  app.get('/api/v1/profiles', (req, reply) => {
    const { q, ids, placeholders } = scope(req), p = req.principal;
    const rows = repo.all<{ id: string }>(`SELECT id FROM profiles WHERE tenant_id=? AND workspace_id IN (${placeholders}) AND id>? ORDER BY id LIMIT ?`, p.tenantId, ...ids, q.cursor || '', q.limit + 1);
    return send(req, reply, page(rows.map(r => repo.profile(p, r.id)), q.limit));
  });
  app.get('/api/v1/profiles/:id', (req, reply) => send(req, reply, repo.profile(req.principal, resourceId(req))));
  app.put('/api/v1/profiles/:id', (req, reply) => mutate(req, reply, 'profile.write', () => {
    const input = profileUpdateInput.parse(req.body), p = req.principal, profile = repo.profile(p, resourceId(req));
    if (profile.version !== input.version) throw new AppError('VERSION_CONFLICT', '角色已更新，请刷新后再保存。', 409);
    repo.run('UPDATE profiles SET name=?,scenes=?,version=version+1 WHERE id=? AND tenant_id=? AND version=?', input.name, JSON.stringify([...new Set(input.scenes)]), profile.id, p.tenantId, input.version);
    const updated = repo.profile(p, profile.id); repo.run('INSERT INTO profile_versions VALUES (?,?,?,?)', profile.id, updated.version, JSON.stringify(updated), new Date().toISOString());
    repo.audit(p, profile.workspaceId, 'profile.update', profile.id, req.id); return updated;
  }));
  app.get('/api/v1/profiles/:id/versions', (req, reply) => {
    const profile = repo.profile(req.principal, resourceId(req));
    return send(req, reply, repo.all<{ version: number; snapshot: string }>('SELECT version,snapshot FROM profile_versions WHERE profile_id=? ORDER BY version DESC', profile.id).map(v => ({ version: v.version, snapshot: JSON.parse(v.snapshot) })));
  });
  app.post('/api/v1/profiles/:id/resolve', (req, reply) => mutate(req, reply, 'profile.write', () => {
    const input = routeInput.parse(req.body), p = req.principal, profile = repo.profile(p, resourceId(req));
    if (input.version !== profile.version) throw new AppError('VERSION_CONFLICT', '角色版本已变化，请刷新后重新检查。', 409);
    if (!profile.scenes.includes(input.scene)) throw new AppError('CAPABILITY_UNAVAILABLE', '角色没有启用此场景，请先编辑角色配置。', 409);
    const avatar = repo.asset(p, profile.avatarAssetId); assertUsableAsset(avatar);
    if (profile.voiceAssetId) assertUsableAsset(repo.asset(p, profile.voiceAssetId));
    selectProvider(config.providerMode);
    if (capability(p).circuit === 'open') throw new AppError('PROVIDER_CIRCUIT_OPEN', '提供商暂时熔断，请稍后检查。', 409, true);
    repo.audit(p, profile.workspaceId, 'profile.resolve', profile.id, req.id);
    return { profileId: profile.id, profileVersion: profile.version, scene: input.scene, environment: config.providerMode, providerId: 'mock-local', simulated: true, snapshot: profile, assets: { avatar: { id: avatar.id, version: avatar.version }, voice: profile.voiceAssetId ? { id: profile.voiceAssetId, version: repo.asset(p, profile.voiceAssetId).version } : null }, readyForRealService: false, message: '模拟场景绑定检查完成。此参考素材不是真实数字人模型。' };
  }));
  for (const [url, table, permission] of [['audit-events', 'audit_events', 'audit.read'], ['provider-usage', 'provider_usage', 'asset.read'], ['events', 'outbox_events', 'asset.read']] as const) {
    app.get('/api/v1/' + url, (req, reply) => {
      requirePermission(req.principal, permission); const { q, ids, placeholders } = scope(req);
      const cursorColumn = table === 'provider_usage' ? 'job_id' : 'id';
      const rows = repo.all<Record<string, unknown>>(`SELECT * FROM ${table} WHERE tenant_id=? AND workspace_id IN (${placeholders}) AND ${cursorColumn}>? ${table !== 'audit_events' ? 'AND environment=?' : ''} ORDER BY ${cursorColumn} LIMIT ?`, req.principal.tenantId, ...ids, q.cursor || '', ...(table !== 'audit_events' ? [config.providerMode] : []), q.limit + 1);
      return send(req, reply, { items: rows.slice(0, q.limit), nextCursor: rows.length > q.limit ? String(rows[q.limit - 1][cursorColumn]) : null });
    });
  }
  registerReceptionRoutes(app, repo, config, adapters);
  registerOfficeRoutes(app, repo, config);
  registerExhibitionRoutes(app, repo, config);
  registerStudioRoutes(app, repo, config); registerTimelineRoutes(app,repo,config);registerStudioExportRoutes(app,repo,config);registerMediaTransferRoutes(app,repo,config);registerVoiceAuthoringRoutes(app,repo,config);registerCharacterRoutes(app,repo,config);registerContentSourceRoutes(app,repo,config);registerContentDraftRoutes(app,repo,config);registerContentWritingRoutes(app,repo,config);registerRecordingRoutes(app,repo,config);registerMediaProcessingRoutes(app,repo,config);registerAlphaVideoRoutes(app,repo,config);registerTranscriptionRoutes(app,repo,config);registerFrameReviewRoutes(app,repo,config);registerAssetLibraryRoutes(app,repo,config);registerFileCollectionRoutes(app,repo,config);registerPresentationRoutes(app,repo,config);
  registerAeRoutes(app,repo,config);
  registerAeSourceRoutes(app,repo,config);
  registerAeMediaRoutes(app,repo,config);
  registerLivePeerRoutes(app,repo,config);
  registerLiveGuestProgrammeRoutes(app,repo,config);
  registerShareRoutes(app,repo,config);
  registerContentGovernanceRoutes(app,repo,config);
  registerLiveRoutes(app,repo,config);
  registerLiveOutputRoutes(app,repo,config);
  registerLiveSpeechRoutes(app,repo,config);registerLiveAnswerRoutes(app,repo,config);
  registerCourseRoutes(app,repo,config);
  registerPracticeRoutes(app,repo,config);
  registerTemplateControlRoutes(app,repo,config);
  registerStudioTeamRoutes(app,repo,config);
  registerDistributionRoutes(app,repo,config);
  registerAdvertisingRoutes(app,repo,config);
  registerStudioAssistantRoutes(app,repo,config);
  registerKnowledgeRoutes(app, repo, config, adapters);
  app.setNotFoundHandler((req, reply) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: '接口尚未实现，请查看当前阶段说明。', retryable: false }, requestId: req.id }));
  app.addHook('onClose', () => { clearAllSpeakerBuffers(repo); });
  if (!repository) app.addHook('onClose', () => { repo.close(); });
  await app.ready(); return app;
}
