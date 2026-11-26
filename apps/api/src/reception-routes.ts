import { sweepDiningAftercare } from './dining-aftercare-state.js';
import { registerRestaurantRoutes } from './restaurant-routes.js';
import { expireDining } from './restaurant-state.js';
import { registerSpeakerRoutes } from './speaker-routes.js';
import { SpeakerService } from './speaker-service.js';
import { type ToolRow } from './conversation-tools.js';
import { applyHospitalityRequest } from './restaurant-hospitality-tools.js';
import { applyRestaurantDraft } from './restaurant-order-tools.js';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Repository } from '@digitalguide/database';
import { AppError, requirePermission, requireWorkspace, type Principal } from '@digitalguide/domain';
import { id, listInput, messageInput, presenceInput, sessionControlInput, sessionEventInput, sessionInput, terminalInput, type GuestSessionView, type SceneAppSnapshot, toolConfirmInput } from '@digitalguide/contracts';
import { type RuntimeAdapters } from '@digitalguide/providers';
import type { Config } from './config.js';
import { executeIdempotent } from './idempotency.js';
import { ReceptionService, type SessionRow } from './reception-service.js';
import { VisitService } from './visit-service.js';
import { registerVisitRoutes } from './visit-routes.js';
import { registerPeopleRoutes } from './people-routes.js';
import { MemoryService } from './memory-service.js';
import { registerVisionRoutes } from './vision-routes.js';
import { releaseSessionVisuals, cancelVisualRequests } from './visual-lifecycle.js';
import { ReceptionConversation } from './reception-conversation.js';
import { releaseSessionSpeaker } from './speaker-lifecycle.js';
import { SceneService } from './knowledge-service.js';

export function registerReceptionRoutes(app: FastifyInstance, repo: Repository, config: Config, adapters: RuntimeAdapters = {}) {
  const service = new ReceptionService(repo, config.providerMode, config.appEnv);
  const resourceId = (req: FastifyRequest) => id.parse((req.params as { id: string }).id);
  const send = (req: FastifyRequest, reply: FastifyReply, data: unknown, code = 200) => reply.code(code).send({ data, requestId: req.id });
  const expire = () => repo.transaction(() => { service.expire(); expireDining(repo,config); sweepDiningAftercare(repo,config); new VisitService(repo, config.providerMode, config.appEnv).sweep(); new MemoryService(repo, config.providerMode, config.appEnv).sweep(); });
  const token = (row: SessionRow, purpose: string) => createHmac('sha256', config.sessionSecret).update([purpose, row.id, row.access_version, row.environment, row.app_env].join(':')).digest('base64url');
  const equal = (a: unknown, b: string) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  function guest(req: FastifyRequest): SessionRow {
    const row = repo.get<SessionRow>('SELECT * FROM reception_sessions WHERE id=? AND environment=? AND app_env=?', resourceId(req), config.providerMode, config.appEnv);
    if (!row || !equal(req.cookies.dg_guest, token(row, 'guest-access'))) throw new AppError('AUTH_REQUIRED', '会话访问已失效，请从企业接待台重新打开访客终端。', 401);
    service.active(row);
    if (req.method !== 'GET' && !equal(req.headers['x-csrf-token'], token(row, 'guest-csrf'))) throw new AppError('FORBIDDEN', '访客安全凭证已失效，请刷新当前终端。', 403);
    return row;
  }
  function issueAccess(reply:FastifyReply,row:SessionRow) { reply.setCookie('dg_guest', token(row, 'guest-access'), {path:'/api/v1/guest/sessions/'+row.id,httpOnly:true,sameSite:'strict',secure:config.webOrigin.startsWith('https:'),maxAge:Math.max(0,Math.floor((Date.parse(row.expires_at)-Date.now())/1000))}); }
  function guestView(row: SessionRow): GuestSessionView {
    const focus = new SpeakerService(repo, config.providerMode, config.appEnv, config.sessionSecret).view(row);
    return { session: service.view(row), csrfToken: token(row, 'guest-csrf'), capabilities: ['session.read', 'text.send', 'manual.stop', 'human.request', 'session.end'], audio: { state: focus.configured && focus.state !== 'idle' ? 'mock_focus' : 'not_configured', focus: focus.configured && focus.state !== 'idle' ? focus.state : 'unlocked' }, environment: config.providerMode };
  }
  function actor(row: SessionRow): Principal { return { tenantId: row.tenant_id, userId: 'guest:' + row.id, role: 'viewer', workspaceIds: [row.workspace_id] }; }
  function adminMutation(req: FastifyRequest, reply: FastifyReply, work: () => unknown, status = 200) {
    requirePermission(req.principal, 'session.manage'); expire();
    const result = executeIdempotent(repo, req, req.principal.tenantId, req.principal.userId, work, status);
    return send(req, reply, result.data, result.code);
  }
  function guestMutation(req: FastifyRequest, reply: FastifyReply, work: (row: SessionRow) => unknown, project?: (data: unknown) => unknown) {
    expire(); const row = guest(req);
    const focusVersion = (req.body as { focusVersion?: unknown } | undefined)?.focusVersion;
    if (focusVersion !== undefined && focusVersion !== row.focus_version) throw new AppError('VERSION_CONFLICT', '服务对象已变化，旧请求与旧确认不能继续使用。', 409);
    const result = executeIdempotent(repo, req, row.tenant_id, 'guest:' + row.id, () => { const value=work(guest(req)); return row.service_scene==='restaurant'&&value&&typeof value==='object'&&'session' in value?{restaurantSessionId:row.id}:value; });
    const data=result.data&&typeof result.data==='object'&&'restaurantSessionId' in result.data?guestView(repo.get<SessionRow>('SELECT * FROM reception_sessions WHERE id=?',row.id)!):result.data;
    return send(req, reply, project ? project(data) : data, result.code);
  }
  function control(row: SessionRow, input: z.infer<typeof sessionControlInput>, principal: Principal, requestId: string) {
    service.active(row); service.version(row, input.version, input.focusVersion);
    if (input.action === 'resume' && principal.userId.startsWith('guest:')) throw new AppError('FORBIDDEN', '恢复自动接待需要工作人员操作。', 403);
    if (input.action === 'end') service.end(row, 'manual_end');
    else {
      if (input.action === 'resume' && row.status !== 'human') throw new AppError('STATE_CONFLICT', '当前没有人工接管，请刷新状态。', 409);
      if (input.action !== 'stop') { releaseSessionVisuals(repo, row.id, 'session.' + input.action); releaseSessionSpeaker(repo, row, 'session.' + input.action, row.focus_version + 1); } else cancelVisualRequests(repo, row.id);
      service.cancelReplies(row);
      repo.run('UPDATE reception_sessions SET status=?,version=version+1,reply_epoch=reply_epoch+1,focus_version=focus_version+?,activity_at=? WHERE id=?', input.action === 'handoff' ? 'human' : input.action === 'resume' ? 'active' : row.status, input.action === 'stop' ? 0 : 1, new Date().toISOString(), row.id);
      repo.event(row.tenant_id, row.workspace_id, row.id, 'session.' + input.action, config.providerMode);
    }
    repo.audit(principal, row.workspace_id, 'session.' + input.action, row.id, requestId);
    const updated = repo.get<SessionRow>('SELECT * FROM reception_sessions WHERE id=?', row.id)!;
    return principal.userId.startsWith('guest:') ? guestView(updated) : service.view(updated);
  }

  app.get('/api/v1/terminals', (req, reply) => {
    requirePermission(req.principal, 'session.manage'); expire(); const query = listInput.parse(req.query);
    if (query.workspaceId) requireWorkspace(req.principal, query.workspaceId);
    const workspaces = query.workspaceId ? [query.workspaceId] : req.principal.workspaceIds;
    const visible = workspaces.length ? repo.all<{ id: string }>(`SELECT id FROM reception_terminals WHERE id NOT IN (SELECT terminal_id FROM restaurant_terminals) AND tenant_id=? AND environment=? AND workspace_id IN (${workspaces.map(() => '?').join(',')}) AND id>? ORDER BY id LIMIT ?`, req.principal.tenantId, config.providerMode, ...workspaces, query.cursor || '', query.limit + 1).map(row => service.terminal(req.principal, row.id)) : [];
    return send(req, reply, { items: visible.slice(0, query.limit).map(row => service.terminalView(row)), nextCursor: visible.length > query.limit ? visible[query.limit - 1].id : null });
  });
  app.post('/api/v1/terminals', (req, reply) => adminMutation(req, reply, () => {
    const input = terminalInput.parse(req.body), p = req.principal;
    const venue = repo.get<{ workspace_id: string }>('SELECT workspace_id FROM venues WHERE id=? AND tenant_id=?', input.venueId, p.tenantId);
    if (!venue) throw new AppError('NOT_FOUND', '场所不存在或不在当前组织。', 404);
    requireWorkspace(p, venue.workspace_id); const terminalId = randomUUID();
    repo.run('INSERT INTO reception_terminals(id,tenant_id,workspace_id,venue_id,name,environment,created_at) VALUES (?,?,?,?,?,?,?)', terminalId, p.tenantId, venue.workspace_id, input.venueId, input.name, config.providerMode, new Date().toISOString());
    repo.audit(p, venue.workspace_id, 'terminal.create', terminalId, req.id);
    return service.terminalView(service.terminal(p, terminalId));
  }, 201));
  app.post('/api/v1/terminals/:id/presence', (req, reply) => adminMutation(req, reply, () => {
    const input = presenceInput.parse(req.body), terminal = service.terminal(req.principal, resourceId(req));
    const result = service.presence(req.principal, terminal, input);
    repo.audit(req.principal, terminal.workspace_id, 'presence.mock.' + result.disposition, terminal.id, req.id);
    return result;
  }));
  app.post('/api/v1/terminals/:id/next', (req, reply) => adminMutation(req, reply, () => {
    if (config.providerMode !== 'mock' || config.appEnv === 'production') throw new AppError('CAPABILITY_UNAVAILABLE', '当前环境不允许模拟排队事件。', 409);
    z.strictObject({}).parse(req.body); const terminal = service.terminal(req.principal, resourceId(req));
    if (service.current(terminal.id)) throw new AppError('STATE_CONFLICT', '当前接待尚未结束，请先结束当前会话。', 409);
    const next = repo.get<{ track_hash: string }>('SELECT track_hash FROM reception_presence WHERE terminal_id=? AND queue_at IS NOT NULL AND last_seen_at>? ORDER BY queue_at,rowid LIMIT 1', terminal.id, new Date(Date.now() - 30000).toISOString());
    if (!next) throw new AppError('STATE_CONFLICT', '没有仍在场的等候访客，请重新触发接近事件。', 409);
    const row = service.create(req.principal, terminal, 'mock_presence', next.track_hash);
    repo.run('UPDATE reception_presence SET queue_at=NULL,cooldown_until=? WHERE terminal_id=? AND track_hash=?', new Date(Date.now() + 60000).toISOString(), terminal.id, next.track_hash);
    repo.audit(req.principal, terminal.workspace_id, 'presence.mock.next', row.id, req.id); return service.view(row);
  }));
  app.post('/api/v1/sessions', (req, reply) => adminMutation(req, reply, () => {
    const input = sessionInput.parse(req.body), terminal = service.terminal(req.principal, input.terminalId);
    const scenes = new SceneService(repo, config.providerMode, config.appEnv), appSnapshot = input.sceneAppId ? scenes.snapshot(scenes.app(req.principal, input.sceneAppId)) : undefined;
    if (appSnapshot) scenes.ready(appSnapshot);
    const row = service.create(req.principal, terminal, 'manual', randomUUID(), input.profileId, appSnapshot);
    repo.audit(req.principal, terminal.workspace_id, 'session.create', row.id, req.id); return service.view(row);
  }, 201));
  app.get('/api/v1/sessions/:id', (req, reply) => { expire(); return send(req, reply, service.view(service.session(req.principal, resourceId(req)))); });
  app.post('/api/v1/sessions/:id/access', (req, reply) => {
    requirePermission(req.principal, 'session.manage'); expire();
    const result = executeIdempotent(repo, req, req.principal.tenantId, req.principal.userId, () => {
      z.strictObject({}).parse(req.body); const row = service.session(req.principal, resourceId(req)); service.active(row);
      repo.audit(req.principal, row.workspace_id, 'session.guest_access', row.id, req.id); return { id: row.id, accessVersion: row.access_version };
    });
    const row = service.session(req.principal, resourceId(req)); service.active(row);
    if (row.access_version !== result.data.accessVersion) throw new AppError('STATE_CONFLICT', '会话访问版本已失效，请重新打开终端。', 409);
    reply.setCookie('dg_guest', token(row, 'guest-access'), { path: '/api/v1/guest/sessions/' + row.id, httpOnly: true, sameSite: 'strict', secure: config.webOrigin.startsWith('https:'), maxAge: Math.max(0, Math.floor((Date.parse(row.expires_at) - Date.now()) / 1000)) });
    return send(req, reply, { sessionId: row.id, terminalUrl: '/terminal/' + row.id });
  });
  app.post('/api/v1/sessions/:id/control', (req, reply) => adminMutation(req, reply, () => control(service.session(req.principal, resourceId(req)), sessionControlInput.parse(req.body), req.principal, req.id)));
  app.get('/api/v1/guest/sessions/:id', (req, reply) => { expire(); return send(req, reply, guestView(guest(req))); });
  app.post('/api/v1/guest/sessions/:id/messages', (req, reply) => guestMutation(req, reply, row => {
    const input = messageInput.parse(req.body); service.version(row, input.version, input.focusVersion);
    const current = new ReceptionConversation(repo, config.providerMode, config.appEnv).consume(row, input.text, req.id);
    return guestView(current);
  }));
  app.post('/api/v1/guest/sessions/:id/events', (req, reply) => guestMutation(req, reply, row => {
    const input = sessionEventInput.parse(req.body);
    if (input.type === 'audio.segment') {
      // No attribution provider is connected in T04. Even claimed target partials are rejected.
      repo.audit(actor(row), row.workspace_id, 'speaker.segment_rejected', input.segmentId, req.id, 'rejected');
      return { accepted: false, reason: input.focusVersion !== row.focus_version ? 'STALE_FOCUS' : 'SPEAKER_FOCUS_NOT_CONFIGURED', message: '当前没有可靠的目标归属服务，请使用文字输入或人工接待。' };
    }
    if (row.status !== 'active' || row.reply_epoch !== input.replyEpoch || row.focus_version !== input.focusVersion) throw new AppError('STATE_CONFLICT', '旧回复已停止或会话已切换，不再接受旧播放确认。', 409);
    const message = repo.get<{ status: string }>("SELECT status FROM reception_messages WHERE id=? AND session_id=? AND role='assistant' AND reply_epoch=? AND focus_version=?", input.replyId, row.id, input.replyEpoch, input.focusVersion);
    if (!message || message.status !== (input.type === 'reply.started' ? 'ready' : 'playing')) throw new AppError('STATE_CONFLICT', '回复已经更新或停止，请使用当前回复。', 409);
    repo.run('UPDATE reception_messages SET status=? WHERE id=? AND session_id=?', input.type === 'reply.started' ? 'playing' : 'completed', input.replyId, row.id);
    repo.run('UPDATE reception_sessions SET version=version+1,activity_at=? WHERE id=?', new Date().toISOString(), row.id);
    repo.event(row.tenant_id, row.workspace_id, row.id, input.type, config.providerMode);
    return guestView(repo.get<SessionRow>('SELECT * FROM reception_sessions WHERE id=?', row.id)!);
  }));
  app.post('/api/v1/guest/sessions/:id/tools/confirm', (req, reply) => guestMutation(req, reply, row => {
    const input = toolConfirmInput.parse(req.body); service.version(row, input.version, input.focusVersion);
    const request = repo.get<ToolRow>('SELECT * FROM conversation_tool_requests WHERE id=? AND session_id=?', input.requestId, row.id);
    if (!request || request.status !== 'proposed' || request.expires_at <= new Date().toISOString() || row.status !== 'active' || request.focus_version !== row.focus_version || request.reply_epoch !== row.reply_epoch || !row.scene_app_snapshot) throw new AppError('STATE_CONFLICT', '工具请求已失效，请重新核对当前对话。', 409);
    const snapshot = JSON.parse(row.scene_app_snapshot) as SceneAppSnapshot, scenes = new SceneService(repo, config.providerMode, config.appEnv); scenes.active(snapshot);
    if (request.app_id !== snapshot.id || !scenes.toolAllowed(snapshot, request.tool_name)) throw new AppError('TOOL_FORBIDDEN', '此工具不在当前场景白名单内。', 403);
    if(request.tool_name==='restaurant.service_request'){
      applyHospitalityRequest(repo,config,row,request);repo.run("UPDATE conversation_tool_requests SET status='confirmed',confirmed_at=? WHERE id=?",new Date().toISOString(),request.id);
      const updated=repo.get<SessionRow>('SELECT * FROM reception_sessions WHERE id=?',row.id)!;service.addMessage(row.id,'system','已保存本次服务请求，等待店员接收与处理；没有改变订单、支付或退款。','received',updated.reply_epoch,updated.focus_version);repo.audit(actor(row),row.workspace_id,'tool.confirmed.restaurant_service',request.id,req.id);return guestView(updated);
    }
    if(request.tool_name==='restaurant.order_draft'){
      applyRestaurantDraft(repo,config,row,request);repo.run("UPDATE conversation_tool_requests SET status='confirmed',confirmed_at=? WHERE id=?",new Date().toISOString(),request.id);
      const updated=repo.get<SessionRow>('SELECT * FROM reception_sessions WHERE id=?',row.id)!;
      service.addMessage(row.id,'system','已保存可编辑点单草稿。请到本次点单核对并独立审阅、确认及提交；当前尚未下单。','received',updated.reply_epoch,updated.focus_version);
      repo.audit(actor(row),row.workspace_id,'tool.confirmed.restaurant_order_draft',request.id,req.id);return guestView(updated);
    }
    repo.run("UPDATE conversation_tool_requests SET status='confirmed',confirmed_at=? WHERE id=?", new Date().toISOString(), request.id);
    control(row, { action: 'handoff', version: row.version, focusVersion: row.focus_version }, actor(row), req.id);
    const updated = repo.get<SessionRow>('SELECT * FROM reception_sessions WHERE id=?', row.id)!;
    service.addMessage(row.id, 'system', '已按您的明确确认转为人工接待，自动回复已暂停。', 'received', updated.reply_epoch, updated.focus_version);
    repo.audit(actor(row), row.workspace_id, 'tool.confirmed.reception_handoff', request.id, req.id); return guestView(updated);
  }));
  app.post('/api/v1/guest/sessions/:id/control', (req, reply) => guestMutation(req, reply, row => control(row, sessionControlInput.parse(req.body), actor(row), req.id)));
  registerSpeakerRoutes(app, repo, config, { guest, mutation: guestMutation, expire, issueAccess(reply, next, previousId) {
    reply.clearCookie('dg_guest', { path: '/api/v1/guest/sessions/' + previousId });
    reply.setCookie('dg_guest', token(next, 'guest-access'), { path: '/api/v1/guest/sessions/' + next.id, httpOnly: true, sameSite: 'strict', secure: config.webOrigin.startsWith('https:'), maxAge: Math.max(0, Math.floor((Date.parse(next.expires_at) - Date.now()) / 1000)) });
  } });
  registerRestaurantRoutes(app,repo,config,{guest,expire,issueAccess});
  const receptionGuest=(req:FastifyRequest)=>{const row=guest(req);if(row.service_scene!=='reception')throw new AppError('SCOPE_CONFLICT','此终端提供餐厅服务，不能访问企业来访或员工目录。',403);return row;};
  registerVisitRoutes(app, repo, config, { guest:receptionGuest, guestMutation(req,reply,work){receptionGuest(req);return guestMutation(req,reply,row=>{receptionGuest(req);return work(row);});} });
  registerPeopleRoutes(app, repo, config, { guest, guestMutation });
  registerVisionRoutes(app, repo, config, { guest, mutation: guestMutation, expire, view: guestView }, adapters);
}
