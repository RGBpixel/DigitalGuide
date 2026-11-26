import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Repository } from '@digitalguide/database';
import { AppError, canonical, type Principal } from '@digitalguide/domain';
import { selectVisionProvider, type RuntimeAdapters, type VisionProvider, type VisionProviderResult } from '@digitalguide/providers';
import type { VisualGrant, VisualState, VisualReference, SceneAppSnapshot } from '@digitalguide/contracts';
import { visualGrantInput, visualQuestionInput } from '@digitalguide/contracts';
import { ReceptionService, type SessionRow } from './reception-service.js';
import { SceneService } from './knowledge-service.js';
import { releaseVisualGrant, releaseSessionVisuals, visualControllers } from './visual-lifecycle.js';
export interface VisualGrantRow { id: string; session_id: string; tenant_id: string; workspace_id: string; environment: string; app_env: string; focus_version: number; source: 'camera' | 'screen'; provider_id: string; status: VisualGrant['status']; version: number; expires_at: string; created_at: string }
interface VisualRequestRow { id: string; session_id: string; grant_id: string; request_hash: string; grant_version: number; focus_version: number; reply_epoch: number; status: string; expires_at: string; reply_id: string | null }
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export {visualFrame} from './visual-frame.js';
export class VisionService {
  reception: ReceptionService; scenes: SceneService;
  constructor(public repo: Repository, public environment: string, public appEnv: string, public adapters: RuntimeAdapters = {}) { this.reception = new ReceptionService(repo, environment, appEnv); this.scenes = new SceneService(repo, environment, appEnv); }
  actor(s: SessionRow): Principal { return { userId: 'guest:' + s.id, tenantId: s.tenant_id, workspaceIds: [s.workspace_id], role: 'viewer' }; }
  grantView(g: VisualGrantRow): VisualGrant { return { id: g.id, source: g.source, provider: g.provider_id, focusVersion: g.focus_version, version: g.version, status: g.status, expiresAt: g.expires_at, createdAt: g.created_at }; }
  policy(s: SessionRow) {
    if (!s.scene_app_snapshot) return { camera: false, screen: false, provider: 'disabled' };
    const snapshot = JSON.parse(s.scene_app_snapshot) as SceneAppSnapshot; this.scenes.active(snapshot);
    const row = this.repo.get<{ config: string }>('SELECT config FROM scene_apps WHERE id=? AND tenant_id=? AND workspace_id=? AND environment=? AND app_env=?', snapshot.id, s.tenant_id, s.workspace_id, this.environment, this.appEnv);
    const current = row ? JSON.parse(row.config) : {};
    const provider = snapshot.visionProvider || 'disabled';
    return { camera: !!snapshot.allowCamera && !!current.allowCamera && current.visionProvider === provider, screen: !!snapshot.allowScreen && !!current.allowScreen && current.visionProvider === provider, provider };
  }
  state(s: SessionRow): VisualState {
    let policy = { camera: false, screen: false, provider: 'disabled', configured: false };
    try { const p = this.policy(s); policy = { ...p, configured: false }; selectVisionProvider(p.provider, this.environment, this.appEnv, this.adapters); policy.configured = true; } catch (e) { if (!(e instanceof AppError)) throw e; }
    const row = this.repo.get<VisualGrantRow>("SELECT * FROM visual_grants WHERE session_id=? AND status='active'", s.id);
    return { grant: row ? this.grantView(row) : null, policy, storage: 'transient_frame_metadata_only', maxFrameBytes: 1_048_576 };
  }
  issue(s: SessionRow, input: z.infer<typeof visualGrantInput>) {
    this.reception.version(s, input.version, input.focusVersion);
    if (s.status !== 'active') throw new AppError('STATE_CONFLICT', '当前已转人工或结束，不能开启画面问答。', 409);
    const policy = this.policy(s); if (!policy[input.source]) throw new AppError('CAPABILITY_UNAVAILABLE', '本场景不允许此画面来源，请选择已启用的来源或继续文字接待。', 409);
    selectVisionProvider(policy.provider, this.environment, this.appEnv, this.adapters);
    if (this.repo.get<{ n: number }>('SELECT count(*) n FROM visual_grants WHERE session_id=? AND created_at>?', s.id, new Date(Date.now() - 60000).toISOString())!.n >= 10) throw new AppError('RATE_LIMITED', '切换画面过于频繁，请稍后再试。', 429);
    releaseSessionVisuals(this.repo, s.id, 'source_replaced');
    const id = randomUUID(), at = new Date().toISOString(), expiry = new Date(Math.min(Date.now() + 5 * 60000, Date.parse(s.expires_at))).toISOString();
    this.repo.run('INSERT INTO visual_grants(id,session_id,tenant_id,workspace_id,environment,app_env,focus_version,source,provider_id,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', id, s.id, s.tenant_id, s.workspace_id, this.environment, this.appEnv, s.focus_version, input.source, policy.provider, expiry, at);
    this.repo.audit(this.actor(s), s.workspace_id, 'visual.granted.' + input.source, id, id);
    return this.grantView(this.repo.get<VisualGrantRow>('SELECT * FROM visual_grants WHERE id=?', id)!);
  }
  active(s: SessionRow, id: string, version: number) {
    const g = this.repo.get<VisualGrantRow>('SELECT * FROM visual_grants WHERE id=? AND session_id=? AND tenant_id=? AND workspace_id=? AND environment=? AND app_env=?', id, s.id, s.tenant_id, s.workspace_id, this.environment, this.appEnv);
    if (s.status !== 'active' || !g || g.status !== 'active' || g.expires_at <= new Date().toISOString() || g.version !== version || g.focus_version !== s.focus_version) throw new AppError('VISUAL_CONTEXT_REVOKED', '画面授权已结束或服务对象已变化，请重新核对画面。', 409);
    const policy = this.policy(s); if (!policy[g.source] || policy.provider !== g.provider_id) throw new AppError('VISUAL_CONTEXT_REVOKED', '此画面来源已停用，请重新核对场景。', 409);
    return g;
  }
  revoke(s: SessionRow, id: string, version: number) {
    const g = this.repo.get<VisualGrantRow>('SELECT * FROM visual_grants WHERE id=? AND session_id=? AND focus_version=?', id, s.id, s.focus_version);
    if (!g) throw new AppError('NOT_FOUND', '当前会话没有此画面授权。', 404);
    if (g.status !== 'active') return { revoked: true, grantId: id };
    if (g.status === 'active' && g.version !== version) throw new AppError('VERSION_CONFLICT', '画面来源已变化，请刷新后重试。', 409);
    releaseVisualGrant(this.repo, id, 'participant_revoked');
    this.repo.audit(this.actor(s), s.workspace_id, 'visual.revoked', id, id);
    return { revoked: true, grantId: id };
  }
  begin(s: SessionRow, input: z.infer<typeof visualQuestionInput>, key: string, image: { imageHash: string; width: number; height: number }) {
    const g = this.active(s, input.grantId, input.grantVersion);
    if (input.focusVersion !== s.focus_version) throw new AppError('VERSION_CONFLICT', '服务对象已变化，不能使用旧画面。', 409);
    const keyHash = sha(z.string().min(8).max(128).parse(key)), requestHash = sha(canonical({ ...input, frameBase64: image.imageHash }));
    const previous = this.repo.get<VisualRequestRow>('SELECT * FROM visual_requests WHERE session_id=? AND key_hash=?', s.id, keyHash);
    if (previous) {
      if (previous.request_hash !== requestHash) throw new AppError('IDEMPOTENCY_CONFLICT', '同一画面操作的内容发生变化，请重新发起。', 409);
      if (previous.status === 'completed') return { request: previous, grant: g, replay: true };
      throw new AppError(previous.status === 'pending' ? 'REQUEST_IN_PROGRESS' : 'DATA_REMOVED', previous.status === 'pending' ? '画面正在处理，请稍后刷新，勿重复提交。' : '此画面请求已取消或失败，请重新选择当前画面。', 409);
    }
    this.reception.version(s, input.version, input.focusVersion);
    const age = Date.now() - Date.parse(input.capturedAt); if (age > 10000 || age < -2000) throw new AppError('FRAME_EXPIRED', '画面已过期，请重新截取当前画面后再提问。', 409);
    if (this.repo.get<{ n: number }>('SELECT count(*) n FROM visual_requests WHERE session_id=? AND created_at>?', s.id, new Date(Date.now() - 60000).toISOString())!.n >= 12) throw new AppError('RATE_LIMITED', '画面提问过于频繁，请稍后再试。', 429);
    if (this.repo.get('SELECT id FROM visual_requests WHERE session_id=? AND status=\'pending\'', s.id)) throw new AppError('REQUEST_IN_PROGRESS', '已有画面正在处理，请先等待或撤回共享。', 409);
    if (this.repo.get<{ n: number }>('SELECT count(*) n FROM reception_messages WHERE session_id=?', s.id)!.n >= 198) throw new AppError('QUOTA_EXCEEDED', '本次会话已达到消息上限，请开始新的接待。', 409);
    const id = randomUUID(), epoch = s.reply_epoch + 1, at = new Date().toISOString();
    this.reception.cancelReplies(s); this.reception.addMessage(s.id, 'visitor', input.question, 'received', epoch, s.focus_version);
    this.repo.run('UPDATE reception_sessions SET version=version+1,reply_epoch=?,activity_at=? WHERE id=?', epoch, at, s.id);
    this.repo.run('INSERT INTO visual_requests(id,session_id,grant_id,key_hash,request_hash,focus_version,reply_epoch,grant_version,image_hash,width,height,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', id, s.id, g.id, keyHash, requestHash, s.focus_version, epoch, g.version, image.imageHash, image.width, image.height, at, new Date(Date.now() + 15000).toISOString());
    this.repo.audit(this.actor(s), s.workspace_id, 'visual.question_received', id, id);
    return { request: this.repo.get<VisualRequestRow>('SELECT * FROM visual_requests WHERE id=?', id)!, grant: g, replay: false };
  }
  async inspect(id: string, g: VisualGrantRow, image: { frame: Buffer; width: number; height: number }, question: string, provider: VisionProvider) {
    const controller = new AbortController(); visualControllers(this.repo).set(id, { grantId: g.id, controller });
    let timedOut = false, onAbort: () => void = () => {};
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 8000);
    try {
      const cancelled = new Promise<never>((_, reject) => { onAbort = () => reject(new AppError(timedOut ? 'VISION_TIMEOUT' : controller.signal.reason === 'request_cancelled' ? 'REQUEST_CANCELLED' : 'VISUAL_CONTEXT_REVOKED', timedOut ? '画面分析超时，请重新提问或请求人工。' : '本次画面处理已取消，迟到结果不会采用。', 409)); controller.signal.addEventListener('abort', onAbort, { once: true }); });
      const result = await Promise.race([provider.inspect({ ...image, question, source: g.source, signal: controller.signal }), cancelled]);
      const value = z.strictObject({ text: z.string().trim().min(1).max(5000), simulated: z.boolean() }).parse(result);
      if ((this.environment === 'mock') !== value.simulated) throw new AppError('PROVIDER_CONTRACT_INVALID', '视觉服务返回的环境标记不一致，结果未采用。', 502);
      return value;
    } finally { clearTimeout(timer); controller.signal.removeEventListener('abort', onAbort); visualControllers(this.repo).delete(id); image.frame.fill(0); }
  }
  complete(s: SessionRow, request: VisualRequestRow, g: VisualGrantRow, result: VisionProviderResult, image: { width: number; height: number }) {
    this.active(s, g.id, g.version);
    const current = this.repo.get<VisualRequestRow>('SELECT * FROM visual_requests WHERE id=?', request.id)!;
    if (current.status !== 'pending' || current.expires_at <= new Date().toISOString() || s.focus_version !== request.focus_version || s.reply_epoch !== request.reply_epoch) throw new AppError('STATE_CONFLICT', '画面处理期间会话已变化，迟到结果未展示或记录。', 409);
    const reference: VisualReference = { requestId: request.id, grantId: g.id, source: g.source, provider: g.provider_id, simulated: result.simulated, ...image, expiresAt: g.expires_at };
    const replyId = this.reception.addMessage(s.id, 'assistant', result.text, 'ready', request.reply_epoch, s.focus_version);
    this.repo.run('UPDATE reception_messages SET visual_context=? WHERE id=?', JSON.stringify(reference), replyId);
    this.repo.run("UPDATE visual_requests SET status='completed',reply_id=?,completed_at=? WHERE id=?", replyId, new Date().toISOString(), request.id);
    this.repo.run('UPDATE reception_sessions SET version=version+1 WHERE id=?', s.id);
    this.repo.event(s.tenant_id, s.workspace_id, request.id, 'visual.answer_ready', this.environment);
  }
}
