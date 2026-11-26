import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Repository } from '@digitalguide/database';
import { AppError, type Principal } from '@digitalguide/domain';
import { selectExhibitDeviceProvider } from '@digitalguide/providers';
import { exhibitDeviceInput, type DisplayState, type ExhibitDevice, type ExhibitCommand, type deviceAction } from '@digitalguide/contracts';
import { ExhibitionContent, at } from './exhibition-content.js';
import { tourPolicyReason, tourPosition, type TourRow, type TourSnapshot } from './tour-policy.js';
type Action = z.infer<typeof deviceAction>;
export interface DeviceRow { id: string; hall_id: string; tenant_id: string; workspace_id: string; name: string; provider: string; online: number; allowed_actions: string; version: number; state_version: number; display_state: string | null; active_session_id: string | null }
interface CommandRow { id: string; device_id: string; session_id: string; tenant_id: string; workspace_id: string; action: Action; payload: string; kind: string; status: ExhibitCommand['status']; reason: string | null; fixture: 'success' | 'failure' | 'unknown'; device_version: number; playback_epoch: number; receipt_id: string | null; simulated: number; created_at: string }
export class ExhibitionDevices {
  content: ExhibitionContent;
  constructor(public repo: Repository, public environment: string, public appEnv: string) { this.content = new ExhibitionContent(repo, environment, appEnv); }
  device(p: Principal, id: string) { const r = this.repo.get<DeviceRow>('SELECT * FROM exhibit_devices WHERE id=? AND tenant_id=?', id, p.tenantId); if (!r) throw new AppError('NOT_FOUND', '设备不存在。', 404); this.content.hall(p, r.hall_id); return r; }
  view(d: DeviceRow): ExhibitDevice {
    let display: DisplayState | null = d.display_state ? JSON.parse(d.display_state) : null;
    if (display?.sessionId) { const s = this.repo.get<TourRow>('SELECT * FROM tour_sessions WHERE id=?', display.sessionId); if (!s || s.id !== d.active_session_id || tourPolicyReason(this.repo, s) || ['ended', 'invalidated'].includes(s.status)) display = null; }
    return { id: d.id, hallId: d.hall_id, name: d.name, provider: d.provider, online: d.provider === 'mock-display' && !!d.online, allowedActions: JSON.parse(d.allowed_actions), version: d.version, stateVersion: d.state_version, display, activeSessionId: d.active_session_id };
  }
  save(p: Principal, input: z.infer<typeof exhibitDeviceInput>, old?: DeviceRow) {
    const hall = this.content.hall(p, input.hallId), id = old?.id || randomUUID(), online = input.provider === 'mock-display' && input.online;
    if (old && old.provider !== input.provider && this.repo.get("SELECT id FROM tour_sessions WHERE device_id=? AND status IN ('ready','explaining','paused','answering','human')", old.id)) throw new AppError('STATE_CONFLICT', '请先结束占用此设备的导览再更换服务。', 409);
    if (old) this.repo.run('UPDATE exhibit_devices SET name=?,provider=?,online=?,allowed_actions=?,version=version+1,updated_at=? WHERE id=?', input.name, input.provider, +online, JSON.stringify([...new Set(input.allowedActions)]), at(), id);
    else this.repo.run('INSERT INTO exhibit_devices(id,hall_id,tenant_id,workspace_id,name,provider,online,allowed_actions,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)', id, hall.id, p.tenantId, hall.workspace_id, input.name, input.provider, +online, JSON.stringify([...new Set(input.allowedActions)]), at(), at()); return id;
  }
  cancel(s: TourRow, reason: string) { this.repo.run("UPDATE exhibit_device_commands SET status='cancelled',reason=?,updated_at=? WHERE session_id=? AND status='pending'", reason, at(), s.id); }
  queue(s: TourRow, action: Action, kind: 'auto' | 'manual', fixture: CommandRow['fixture'] = 'success') {
    if (!s.device_id) throw new AppError('CAPABILITY_UNAVAILABLE', '本次导览未绑定设备。', 409);
    if (kind === 'auto' && !s.auto_devices && action !== 'blank') return null;
    const d = this.repo.get<DeviceRow>('SELECT * FROM exhibit_devices WHERE id=? AND hall_id=? AND tenant_id=?', s.device_id, s.hall_id, s.tenant_id);
    if (!d || d.active_session_id !== s.id) throw new AppError('DEVICE_NOT_BOUND', '设备不属于本次导览，请由工作人员核对。', 409);
    selectExhibitDeviceProvider(d.provider, this.environment, this.appEnv);
    if (!(JSON.parse(d.allowed_actions) as string[]).includes(action)) throw new AppError('ACTION_NOT_ALLOWED', '该动作不在设备白名单中，请联系工作人员。', 403);
    const cursor = tourPosition(s), step = (JSON.parse(s.snapshot) as TourSnapshot).steps[cursor.stepIndex], segment = step.segments[cursor.segmentIndex];
    if ((action === 'show_slide' && segment.screen.kind !== 'slide') || (action === 'play_video' && segment.screen.kind !== 'video')) throw new AppError('MEDIA_KIND_MISMATCH', '所选动作与当前讲解段的展示方式不一致。', 409);
    const state: DisplayState = action === 'blank' ? { kind: 'blank', title: '', lines: [], contentVersion: null, contentId: null, stepId: null, segmentId: null, offsetMs: 0, simulated: true, sessionId: null } : { kind: action === 'pause_media' ? 'paused' : segment.screen.kind, title: segment.screen.title, lines: segment.screen.lines, contentVersion: step.contentVersion, contentId: step.contentId, stepId: step.id, segmentId: segment.id, offsetMs: cursor.offsetMs, simulated: true, sessionId: s.id };
    const id = randomUUID(); this.repo.run('INSERT INTO exhibit_device_commands(id,device_id,session_id,tenant_id,workspace_id,action,payload,kind,fixture,device_version,playback_epoch,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', id, d.id, s.id, s.tenant_id, s.workspace_id, action, JSON.stringify(state), kind, fixture, d.version, s.playback_epoch, at(), at()); return id;
  }
  automatic(s: TourRow, action: Action) {
    if (!s.device_id) return null;
    try { return this.queue(s, action, 'auto'); } catch (e) {
      if (!(e instanceof AppError)) throw e;
      const d = this.repo.get<DeviceRow>('SELECT * FROM exhibit_devices WHERE id=?', s.device_id)!; const id = randomUUID();
      this.repo.run("INSERT INTO exhibit_device_commands(id,device_id,session_id,tenant_id,workspace_id,action,payload,kind,status,reason,device_version,playback_epoch,created_at,updated_at) VALUES (?,?,?,?,?,?,'{}','auto','failed',?,?,?,?,?)", id, d.id, s.id, s.tenant_id, s.workspace_id, action, e.code.toLowerCase(), d.version, s.playback_epoch, at(), at()); return id;
    }
  }
  autoCue(s: TourRow) { if (s.auto_devices) { const c = tourPosition(s), seg = (JSON.parse(s.snapshot) as TourSnapshot).steps[c.stepIndex].segments[c.segmentIndex]; return this.automatic(s, seg.screen.kind === 'slide' ? 'show_slide' : 'play_video'); } return null; }
  commands(sessionId: string): ExhibitCommand[] { return this.repo.all<CommandRow>('SELECT * FROM exhibit_device_commands WHERE session_id=? ORDER BY created_at DESC,rowid DESC LIMIT 30', sessionId).map(c => ({ id: c.id, action: c.action, status: c.status, reason: c.reason, receiptId: c.receipt_id, simulated: !!c.simulated, createdAt: c.created_at })); }
  process() {
    let processed = 0;
    for (const item of this.repo.all<{ id: string }>("SELECT c.id FROM exhibit_device_commands c JOIN tour_sessions s ON s.id=c.session_id WHERE c.status='pending' AND s.environment=? AND s.app_env=? ORDER BY c.created_at,c.rowid LIMIT 50", this.environment, this.appEnv)) this.repo.transaction(() => {
      const c = this.repo.get<CommandRow>("SELECT * FROM exhibit_device_commands WHERE id=? AND status='pending'", item.id); if (!c) return;
      const s = this.repo.get<TourRow>('SELECT * FROM tour_sessions WHERE id=?', c.session_id)!, d = this.repo.get<DeviceRow>('SELECT * FROM exhibit_devices WHERE id=?', c.device_id)!;
      const failure = d.active_session_id !== s.id ? 'lease_changed' : c.playback_epoch !== s.playback_epoch ? 'stale_playback' : c.action !== 'blank' && (tourPolicyReason(this.repo, s) || !['ready', 'explaining', 'paused', 'answering', 'human'].includes(s.status)) ? 'tour_not_active' : d.version !== c.device_version ? 'device_configuration_changed' : !(JSON.parse(d.allowed_actions) as string[]).includes(c.action) ? 'action_not_allowed' : !d.online ? 'device_offline' : null;
      if (failure) { this.repo.run("UPDATE exhibit_device_commands SET status=?,reason=?,updated_at=? WHERE id=?", ['lease_changed', 'stale_playback', 'tour_not_active'].includes(failure) ? 'cancelled' : 'failed', failure, at(), c.id); processed++; return; }
      let result;
      try { result = selectExhibitDeviceProvider(d.provider, this.environment, this.appEnv).apply(JSON.parse(c.payload), c.fixture); } catch (e) { if (!(e instanceof AppError)) throw e; result = { status: 'failed' as const, reason: 'provider_not_configured', receiptId: null, state: null }; }
      const prior = this.repo.get<{ receipt_id: string; state: string }>('SELECT * FROM exhibit_device_receipts WHERE command_id=?', c.id);
      if (prior) result = { status: 'succeeded', reason: 'mock_confirmed_existing_receipt', receiptId: prior.receipt_id, state: JSON.parse(prior.state) as DisplayState };
      if (result.state && result.receiptId && !prior) {
        this.repo.run('INSERT INTO exhibit_device_receipts VALUES (?,?,?,?)', c.id, result.receiptId, JSON.stringify(result.state), at());
        this.repo.run('UPDATE exhibit_devices SET display_state=?,state_version=state_version+1,updated_at=? WHERE id=?', JSON.stringify(result.state), at(), d.id);
        if (c.action === 'blank' && ['ended', 'completed', 'invalidated'].includes(s.status)) this.repo.run('UPDATE exhibit_devices SET active_session_id=NULL WHERE id=? AND active_session_id=?', d.id, s.id);
      }
      this.repo.run('UPDATE exhibit_device_commands SET status=?,reason=?,receipt_id=?,updated_at=? WHERE id=?', result.status, result.reason, result.receiptId, at(), c.id);
      this.repo.audit({ tenantId: s.tenant_id, workspaceIds: [s.workspace_id], role: 'admin', userId: 'system:display-worker' }, s.workspace_id, 'exhibition.device_' + result.status, c.id, c.id); processed++;
    });
    return processed;
  }
}
