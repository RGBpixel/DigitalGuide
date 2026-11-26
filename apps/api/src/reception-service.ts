import { releaseSessionSpeaker, sweepSpeakerState } from './speaker-lifecycle.js';
import { cancelConversationTools, sweepConversationTools, toolView, type ToolRow } from './conversation-tools.js';
import { createHash, randomUUID } from 'node:crypto';
import type { Repository } from '@digitalguide/database';
import { AppError, assertUsableAsset, requirePermission, requireWorkspace, type Principal } from '@digitalguide/domain';
import { selectRealtimeProvider } from '@digitalguide/providers';
import type { PresenceResult, ReceptionMessage, ReceptionSession, ReceptionTerminal, SceneAppSnapshot } from '@digitalguide/contracts';
import { releaseSessionVisuals, sweepVisuals } from './visual-lifecycle.js';
import { VisitService } from './visit-service.js';

export interface TerminalRow { id: string; tenant_id: string; workspace_id: string; venue_id: string; name: string; environment: string; version: number }
export interface SessionRow { service_scene: 'reception'|'restaurant'; dining_party_id:string|null; id: string; tenant_id: string; workspace_id: string; terminal_id: string; track_hash: string; status: ReceptionSession['status']; source: ReceptionSession['source']; environment: ReceptionSession['environment']; app_env: string; version: number; reply_epoch: number; focus_version: number; access_version: number; activity_at: string; expires_at: string; profile_snapshot: string | null; scene_app_snapshot: string | null }
export class ReceptionService {
  constructor(public repo: Repository, public environment: string, public appEnv: string) {}
  terminal(p: Principal, terminalId: string): TerminalRow {
    requirePermission(p, 'session.manage');
    const row = this.repo.get<TerminalRow>('SELECT * FROM reception_terminals WHERE id=? AND tenant_id=? AND environment=?', terminalId, p.tenantId, this.environment);
    if (!row) throw new AppError('NOT_FOUND', '接待终端不存在或无权访问，请检查工作空间。', 404);
    requireWorkspace(p, row.workspace_id); return row;
  }
  session(p: Principal, sessionId: string): SessionRow {
    const row = this.repo.get<SessionRow>('SELECT * FROM reception_sessions WHERE id=? AND tenant_id=? AND environment=? AND app_env=?', sessionId, p.tenantId, this.environment, this.appEnv);
    if (!row) throw new AppError('NOT_FOUND', '接待会话不存在或无权访问。', 404);
    this.terminal(p, row.terminal_id); return row;
  }
  current(terminalId: string) { return this.repo.get<SessionRow>("SELECT * FROM reception_sessions WHERE terminal_id=? AND app_env=? AND status IN ('active','human')", terminalId, this.appEnv); }
  view(row: SessionRow): ReceptionSession {
    const messages = this.repo.all<Omit<ReceptionMessage, 'citations' | 'visualContext' | 'toolRequests' | 'restaurantContext'> & { citations: string; visualContext: string | null; restaurantContext: string|null }>('SELECT id,role,text,status,reply_epoch AS replyEpoch,focus_version AS focusVersion,created_at AS createdAt,knowledge_citations AS citations,visual_context AS visualContext,input_source AS inputSource,speaker_decision_id AS speakerDecisionId,restaurant_context AS restaurantContext FROM reception_messages WHERE session_id=? AND tenant_id=? ORDER BY created_at,rowid', row.id, row.tenant_id).map(m => ({ ...m, restaurantContext: m.restaurantContext ? JSON.parse(m.restaurantContext) : null, citations: JSON.parse(m.citations), visualContext: m.visualContext ? JSON.parse(m.visualContext) : null, toolRequests: this.repo.all<ToolRow>('SELECT * FROM conversation_tool_requests WHERE session_id=? AND reply_id=? ORDER BY created_at', row.id, m.id).map(toolView) }));
    return { id: row.id, terminalId: row.terminal_id, status: row.status, version: row.version, replyEpoch: row.reply_epoch, focusVersion: row.focus_version, source: row.source, environment: row.environment, identity: 'anonymous', scene: row.service_scene, sceneAppId: row.scene_app_snapshot ? JSON.parse(row.scene_app_snapshot).id : null, sceneAppName: row.scene_app_snapshot ? JSON.parse(row.scene_app_snapshot).name : null, expiresAt: row.expires_at, activityAt: row.activity_at, profileName: row.profile_snapshot ? JSON.parse(row.profile_snapshot).name : null, messages };
  }
  terminalView(row: TerminalRow): ReceptionTerminal {
    const queued = this.repo.get<{ n: number }>('SELECT count(*) AS n FROM reception_presence WHERE terminal_id=? AND queue_at IS NOT NULL AND last_seen_at>?', row.id, new Date(Date.now() - 30000).toISOString())!.n;
    return { id: row.id, workspaceId: row.workspace_id, venueId: row.venue_id, name: row.name, environment: row.environment, version: row.version, currentSessionId: this.current(row.id)?.id || null, queued };
  }
  create(p: Principal, terminal: TerminalRow, source: SessionRow['source'], trackHash: string, profileId?: string, sceneApp?: SceneAppSnapshot): SessionRow {
    selectRealtimeProvider(this.environment);
    const dining=this.repo.get<{profile_id:string|null;scene_app_id:string|null}>('SELECT r.profile_id,r.scene_app_id FROM restaurants r JOIN restaurant_terminals t ON t.restaurant_id=r.id WHERE t.terminal_id=? AND r.tenant_id=? AND r.workspace_id=? AND r.environment=? AND r.app_env=?',terminal.id,p.tenantId,terminal.workspace_id,this.environment,this.appEnv),serviceScene=dining?'restaurant':'reception';
    if(dining?.profile_id&&!profileId)profileId=dining.profile_id;

    const current = this.current(terminal.id);
    if (current) { if(current.service_scene!==serviceScene)throw new AppError('SCOPE_CONFLICT','当前终端已有其他场景的会话，请先结束。',409); if (sceneApp && (!current.scene_app_snapshot || JSON.parse(current.scene_app_snapshot).id !== sceneApp.id)) throw new AppError('STATE_CONFLICT', '当前会话使用其他应用，请先结束接待再切换。', 409); return current; }
    if (this.repo.get("SELECT id FROM reception_sessions WHERE terminal_id=? AND status IN ('active','human')", terminal.id)) throw new AppError('STATE_CONFLICT', '此终端由另一运行环境的会话占用，请使用独立终端配置。', 409);
    if (sceneApp) { if (sceneApp.scene !== serviceScene || sceneApp.audience !== 'public' || sceneApp.workspaceId !== terminal.workspace_id || (profileId && profileId !== sceneApp.profileId)) throw new AppError('SCOPE_CONFLICT', '匿名接待只能使用本工作空间对应场景的公开应用。', 409); profileId = sceneApp.profileId; }
    let snapshot: string | null = null;
    if (profileId) {
      const profile = sceneApp?.profile || this.repo.profile(p, profileId);
      if (profile.workspaceId !== terminal.workspace_id) throw new AppError('NOT_FOUND', '角色不属于当前工作空间。', 404);
      if (!profile.scenes.includes(serviceScene)) throw new AppError('CAPABILITY_UNAVAILABLE', '角色没有启用当前接待场景，请先修改角色配置。', 409);
      assertUsableAsset(this.repo.asset(p, profile.avatarAssetId));
      if (profile.voiceAssetId) assertUsableAsset(this.repo.asset(p, profile.voiceAssetId));
      snapshot = JSON.stringify(profile);
    }
    const now = new Date().toISOString(), sessionId = randomUUID();
    this.repo.run('INSERT INTO reception_sessions(id,tenant_id,workspace_id,terminal_id,track_hash,source,environment,app_env,status,created_at,activity_at,expires_at,profile_snapshot) VALUES (?,?,?,?,?,?,?,?,\'active\',?,?,?,?)', sessionId, p.tenantId, terminal.workspace_id, terminal.id, trackHash, source, this.environment, this.appEnv, now, now, new Date(Date.now() + (serviceScene==='restaurant'?6*3600000:15*60000)).toISOString(), snapshot);
    this.repo.run('UPDATE reception_sessions SET service_scene=? WHERE id=?',serviceScene,sessionId);
    if (sceneApp) this.repo.run('UPDATE reception_sessions SET scene_app_snapshot=? WHERE id=?', JSON.stringify(sceneApp), sessionId);
    this.repo.run('UPDATE reception_terminals SET version=version+1 WHERE id=?', terminal.id);
    this.addMessage(sessionId, 'assistant', sceneApp ? '【模拟问候】' + sceneApp.welcomeText : serviceScene==='restaurant'?'【本地餐厅】欢迎光临，请核对人数或预约，我们会协助安排座位。':'【模拟问候】您好，欢迎来访。您可以输入问题，也可以请求人工接待。', 'ready', 0, 0);
    this.repo.event(p.tenantId, terminal.workspace_id, sessionId, 'session.started', this.environment);
    return this.repo.get<SessionRow>('SELECT * FROM reception_sessions WHERE id=?',sessionId)!;
  }
  addMessage(sessionId: string, role: ReceptionMessage['role'], text: string, status: ReceptionMessage['status'], epoch: number, focusVersion: number) {
    const row = this.repo.get<SessionRow>('SELECT * FROM reception_sessions WHERE id=?', sessionId)!;
    const messageId = randomUUID();
    this.repo.run('INSERT INTO reception_messages(id,session_id,tenant_id,workspace_id,role,text,status,reply_epoch,focus_version,created_at,input_source) VALUES (?,?,?,?,?,?,?,?,?,?,?)', messageId, row.id, row.tenant_id, row.workspace_id, role, text, status, epoch, focusVersion, new Date().toISOString(), role === 'visitor' ? 'typed' : 'system');
    return messageId;
  }
  active(row: SessionRow) {
    if (!['active', 'human'].includes(row.status)) throw new AppError('SESSION_ENDED', '本次接待已结束或超时，请由前台开始新会话。', 410);
  }
  version(row: SessionRow, version: number, focusVersion: number) {
    if (row.version !== version || row.focus_version !== focusVersion) throw new AppError('VERSION_CONFLICT', '会话状态已变化，请刷新后重试，旧确认已失效。', 409);
  }
  cancelReplies(row: SessionRow) { cancelConversationTools(this.repo, row.id); this.repo.run("UPDATE reception_messages SET status='cancelled' WHERE session_id=? AND role='assistant' AND status IN ('ready','playing')", row.id); }
  end(row: SessionRow, reason: string, expired = false) {
    releaseSessionSpeaker(this.repo, row, reason, row.focus_version + 1);
    releaseSessionVisuals(this.repo, row.id, reason);
    this.cancelReplies(row);
    this.repo.run('UPDATE reception_sessions SET status=?,version=version+1,reply_epoch=reply_epoch+1,focus_version=focus_version+1,access_version=access_version+1,ended_reason=? WHERE id=?', expired ? 'expired' : 'ended', reason, row.id);
    this.repo.run('UPDATE reception_terminals SET version=version+1 WHERE id=?', row.terminal_id);
    this.repo.event(row.tenant_id, row.workspace_id, row.id, expired ? 'session.expired' : 'session.ended', row.environment);
    new VisitService(this.repo, this.environment, this.appEnv).onSessionEnd(row);
  }
  expire(now = new Date()) {
    const stale = this.repo.all<SessionRow>("SELECT * FROM reception_sessions WHERE environment=? AND app_env=? AND status IN ('active','human') AND (expires_at<=? OR (service_scene='restaurant' AND activity_at<=?) OR (service_scene<>'restaurant' AND activity_at<=?))", this.environment, this.appEnv, now.toISOString(), new Date(now.getTime()-30*60000).toISOString(), new Date(now.getTime() - 120000).toISOString());
    for (const row of stale) this.end(row, 'timeout', true);
    this.repo.run('UPDATE reception_presence SET queue_at=NULL WHERE last_seen_at<=? AND terminal_id IN (SELECT id FROM reception_terminals WHERE environment=?)', new Date(now.getTime() - 30000).toISOString(), this.environment);
    sweepVisuals(this.repo, this.environment, this.appEnv);
    sweepConversationTools(this.repo, this.environment, this.appEnv);
    sweepSpeakerState(this.repo, this.environment, this.appEnv);
    return stale.length;
  }
  presence(p: Principal, terminal: TerminalRow, input: { type: 'entered' | 'left'; trackId: string; sessionId?: string }): PresenceResult {
    if (this.environment !== 'mock' || this.appEnv === 'production') throw new AppError('CAPABILITY_UNAVAILABLE', '模拟接近事件只在本地模拟环境开放，真实检测尚未接通。', 409);
    const hash = createHash('sha256').update(terminal.id + ':' + input.trackId).digest('hex');
    const current = this.current(terminal.id), now = new Date().toISOString();
    const record = this.repo.get<{ cooldown_until: string; queue_at: string | null }>('SELECT cooldown_until,queue_at FROM reception_presence WHERE terminal_id=? AND track_hash=?', terminal.id, hash);
    if (input.type === 'left') {
      if (current?.track_hash === hash) {
        if (input.sessionId !== current.id) throw new AppError('STATE_CONFLICT', '离开事件不属于当前会话，已忽略旧事件。', 409);
        this.end(current, 'presence_left');
      }
      this.repo.run('UPDATE reception_presence SET queue_at=NULL,last_seen_at=? WHERE terminal_id=? AND track_hash=?', '2000-01-01T00:00:00.000Z', terminal.id, hash);
      return { disposition: 'left', sessionId: current?.id || null, greeted: false, queuePosition: null };
    }
    this.repo.run("INSERT INTO reception_presence VALUES (?,?,?,'2000-01-01T00:00:00.000Z',NULL) ON CONFLICT(terminal_id,track_hash) DO UPDATE SET last_seen_at=excluded.last_seen_at", terminal.id, hash, now);
    if (current?.track_hash === hash) return { disposition: 'active', sessionId: current.id, greeted: false, queuePosition: null };
    if (record && record.cooldown_until > now) return { disposition: 'cooldown', sessionId: null, greeted: false, queuePosition: null };
    const waiting = this.repo.get<{ track_hash: string }>('SELECT track_hash FROM reception_presence WHERE terminal_id=? AND queue_at IS NOT NULL AND last_seen_at>? ORDER BY queue_at,rowid LIMIT 1', terminal.id, new Date(Date.now() - 30000).toISOString());
    if (current || (waiting && waiting.track_hash !== hash)) {
      if (!record?.queue_at && this.terminalView(terminal).queued >= 8) throw new AppError('QUEUE_FULL', '当前等候人数较多，请由工作人员接待。', 409);
      this.repo.run('UPDATE reception_presence SET queue_at=COALESCE(queue_at,?) WHERE terminal_id=? AND track_hash=?', now, terminal.id, hash);
      const queued = this.repo.all<{ track_hash: string }>('SELECT track_hash FROM reception_presence WHERE terminal_id=? AND queue_at IS NOT NULL ORDER BY queue_at,rowid', terminal.id);
      return { disposition: 'queued', sessionId: null, greeted: false, queuePosition: queued.findIndex(q => q.track_hash === hash) + 1 };
    }
    const session = this.create(p, terminal, 'mock_presence', hash);
    this.repo.run('UPDATE reception_presence SET cooldown_until=?,queue_at=NULL WHERE terminal_id=? AND track_hash=?', new Date(Date.now() + 60000).toISOString(), terminal.id, hash);
    return { disposition: 'started', sessionId: session.id, greeted: true, queuePosition: null };
  }
}
