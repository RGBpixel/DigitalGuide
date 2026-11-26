import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Repository } from '@digitalguide/database';
import { AppError, assertUsableAsset, requirePermission, requireWorkspace, type Principal } from '@digitalguide/domain';
import { selectLanguageProvider, selectExhibitDeviceProvider } from '@digitalguide/providers';
import { tourStartInput, tourControlInput, tourQuestionInput, type TourCursor, type TourView, type TourQuestion, type SceneAppSnapshot, type KnowledgeCitation } from '@digitalguide/contracts';
import { ExhibitionContent, at, expectVersion } from './exhibition-content.js';
import { ExhibitionBookings } from './exhibition-bookings.js';
import { ExhibitionDevices, type DeviceRow } from './exhibition-devices.js';
import { SceneService } from './knowledge-service.js';
import { liveTourStatuses, tourPolicyReason, tourPosition, type TourRow, type TourSnapshot } from './tour-policy.js';
interface QuestionRow { id: string; audience_label: string; text: string; answer: string | null; citations: string; status: string; created_at: string }
interface TourCitation extends KnowledgeCitation { kind: 'exhibit' | 'knowledge' }
function queryTokens(text: string) { const value = text.normalize('NFKC').toLowerCase(), words: string[] = value.match(/[a-z0-9]+/g) || []; for (const m of value.matchAll(/[\p{Script=Han}]+/gu)) { const chars = [...m[0]]; for (let i = 0; i < chars.length - 1; i++) words.push(chars[i] + chars[i + 1]); } return [...new Set(words)]; }
export class TourService {
  content: ExhibitionContent; bookings: ExhibitionBookings; devices: ExhibitionDevices; scenes: SceneService;
  constructor(public repo: Repository, public environment: string, public appEnv: string) { this.content = new ExhibitionContent(repo, environment, appEnv); this.bookings = new ExhibitionBookings(repo, environment, appEnv); this.devices = new ExhibitionDevices(repo, environment, appEnv); this.scenes = new SceneService(repo, environment, appEnv); }
  raw(id: string) { const r = this.repo.get<TourRow>('SELECT * FROM tour_sessions WHERE id=? AND environment=? AND app_env=?', id, this.environment, this.appEnv); if (!r) throw new AppError('NOT_FOUND', '导览会话不存在。', 404); return r; }
  session(p: Principal, id: string) { const s = this.raw(id); if (s.tenant_id !== p.tenantId) throw new AppError('NOT_FOUND', '导览会话不存在。', 404); requireWorkspace(p, s.workspace_id); return this.synchronize(s); }
  current(s: TourRow) { return this.raw(s.id); }
  start(p: Principal, input: z.infer<typeof tourStartInput>) {
    const route = this.content.route(p, input.routeId), plan = this.content.plan(p, route, input.plan), hall = this.content.hall(p, route.hall_id), app = this.scenes.snapshot(this.scenes.app(p, input.sceneAppId));
    if (plan.hash !== input.planHash) throw new AppError('PLAN_CHANGED', '讲稿、路线或条件已变化，请重新预览后开始。', 409);
    if (app.workspaceId !== hall.workspace_id || app.scene !== 'exhibition' || app.audience !== 'public' || !app.profile.scenes.includes('exhibition')) throw new AppError('SCOPE_CONFLICT', '请选择同工作空间的公开展厅场景应用。', 409);
    this.scenes.active(app); assertUsableAsset(this.repo.asset(p, app.profile.avatarAssetId)); if (app.profile.voiceAssetId) assertUsableAsset(this.repo.asset(p, app.profile.voiceAssetId));
    if (this.repo.get<{ n: number }>("SELECT count(*) n FROM tour_sessions WHERE tenant_id=? AND workspace_id=? AND status IN ('ready','explaining','paused','answering','human')", p.tenantId, hall.workspace_id)!.n >= 100) throw new AppError('QUOTA_EXCEEDED', '当前工作空间已达一百个本地导览并发，请先结束不用的会话。', 409);
    if (input.bookingId) {
      const booking = this.bookings.booking(p, input.bookingId), slot = this.bookings.slot(p, booking.slot_id);
      if (slot.hall_id !== hall.id || booking.status !== 'checked_in' || booking.party_size !== input.groupSize || booking.language !== input.plan.language || slot.ends_at <= at()) throw new AppError('BOOKING_NOT_READY', '请核对本馆已签到团体、人数、语言和时段。', 409);
    }
    if (input.deviceId) {
      requirePermission(p, 'device.control'); const d = this.devices.device(p, input.deviceId);
      if (d.hall_id !== hall.id) throw new AppError('SCOPE_CONFLICT', '设备不属于本展馆。', 409);
      selectExhibitDeviceProvider(d.provider, this.environment, this.appEnv);
      if (!d.online) throw new AppError('DEVICE_OFFLINE', '模拟设备离线，请恢复后开始或关闭设备联动。', 409);
      if (this.repo.get("SELECT id FROM tour_sessions WHERE device_id=? AND status IN ('ready','explaining','paused','answering','human')", d.id)) throw new AppError('DEVICE_IN_USE', '设备正在被另一场导览使用。', 409);
      const needed = new Set(['blank', ...(input.autoDevices ? ['pause_media', ...plan.steps.flatMap(s => s.segments.map(g => g.screen.kind === 'slide' ? 'show_slide' : 'play_video'))] : [])]);
      if ([...needed].some(action => !(JSON.parse(d.allowed_actions) as string[]).includes(action))) throw new AppError('ACTION_NOT_ALLOWED', '设备白名单未覆盖路线所需动作及停止清屏，请先核对设备配置。', 403);
    }
    const id = randomUUID(), snapshot: TourSnapshot = { ...plan, hallName: hall.name, routeName: route.name }, expiresAt = new Date(Date.now() + 4 * 3600000).toISOString();
    this.repo.run('INSERT INTO tour_sessions(id,hall_id,tenant_id,workspace_id,route_id,route_version,booking_id,snapshot,scene_snapshot,language,group_size,device_id,auto_devices,cursor,environment,app_env,created_at,updated_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', id, hall.id, p.tenantId, hall.workspace_id, route.id, route.version, input.bookingId || null, JSON.stringify(snapshot), JSON.stringify(app), plan.language, input.groupSize, input.deviceId || null, +input.autoDevices, JSON.stringify({ stepIndex: 0, segmentIndex: 0, offsetMs: 0 }), this.environment, this.appEnv, at(), at(), expiresAt);
    if (input.bookingId) this.repo.run("UPDATE tour_bookings SET status='in_tour',version=version+1,updated_at=? WHERE id=?", at(), input.bookingId);
    if (input.deviceId) this.repo.run('UPDATE exhibit_devices SET active_session_id=?,updated_at=? WHERE id=?', id, at(), input.deviceId);
    this.repo.event(p.tenantId, hall.workspace_id, id, 'tour.started', this.environment); return id;
  }
  close(s: TourRow, status: 'completed' | 'ended' | 'invalidated', reason: string) {
    this.devices.cancel(s, reason); const cursor = tourPosition(s);
    this.repo.run('UPDATE tour_sessions SET status=?,cursor=?,resume_cursor=NULL,active_question_id=NULL,play_started_at=NULL,last_reason=?,version=version+1,focus_version=focus_version+1,playback_epoch=playback_epoch+1,access_version=access_version+?,updated_at=? WHERE id=?', status, JSON.stringify(cursor), reason, +(status === 'ended'), at(), s.id);
    this.repo.run("UPDATE tour_questions SET status='cancelled' WHERE session_id=? AND status IN ('queued','answering')", s.id);
    if (s.booking_id) this.repo.run("UPDATE tour_bookings SET status=?,version=version+1,updated_at=? WHERE id=? AND status='in_tour'", status === 'completed' ? 'completed' : 'checked_in', at(), s.booking_id);
    const current = this.current(s); this.devices.automatic(current, 'blank'); this.repo.event(s.tenant_id, s.workspace_id, s.id, 'tour.' + status, this.environment); return current;
  }
  synchronize(s: TourRow): TourRow {
    if (s.status === 'ended' || s.status === 'invalidated') return s;
    const reason = tourPolicyReason(this.repo, s); if (reason) return this.close(s, 'invalidated', reason);
    if (s.status !== 'explaining' || !s.play_started_at) return s;
    const snapshot = JSON.parse(s.snapshot) as TourSnapshot, cursor = JSON.parse(s.cursor) as TourCursor; let remaining = cursor.offsetMs + Math.max(0, Date.now() - Date.parse(s.play_started_at)), moved = false;
    while (remaining >= snapshot.steps[cursor.stepIndex].segments[cursor.segmentIndex].durationMs) {
      remaining -= snapshot.steps[cursor.stepIndex].segments[cursor.segmentIndex].durationMs; moved = true;
      if (cursor.segmentIndex + 1 < snapshot.steps[cursor.stepIndex].segments.length) cursor.segmentIndex++;
      else if (cursor.stepIndex + 1 < snapshot.steps.length) { cursor.stepIndex++; cursor.segmentIndex = 0; }
      else { cursor.offsetMs = snapshot.steps[cursor.stepIndex].segments[cursor.segmentIndex].durationMs; this.repo.run('UPDATE tour_sessions SET cursor=?,play_started_at=NULL WHERE id=?', JSON.stringify(cursor), s.id); return this.close(this.current(s), 'completed', 'route_finished'); }
    }
    if (moved) { cursor.offsetMs = remaining; this.devices.cancel(s, 'narration_advanced'); this.repo.run('UPDATE tour_sessions SET cursor=?,play_started_at=?,version=version+1,playback_epoch=playback_epoch+1,updated_at=? WHERE id=?', JSON.stringify(cursor), at(), at(), s.id); const current = this.current(s); this.devices.autoCue(current); return current; }
    return s;
  }
  assertInput(s: TourRow, version: number, focusVersion: number) { expectVersion(s, version); if (s.focus_version !== focusVersion) throw new AppError('VERSION_CONFLICT', '当前发问人或导览状态已变化，请重新载入。', 409); }
  main(s: TourRow) { if (!['ready', 'explaining', 'paused'].includes(s.status)) throw new AppError('STATE_CONFLICT', '请先结束本次答疑或交由工作人员处理。', 409); }
  effectiveScene(s: TourRow) {
    const frozen = JSON.parse(s.scene_snapshot) as SceneAppSnapshot, current = JSON.parse(this.repo.get<{ config: string }>('SELECT config FROM scene_apps WHERE id=?', frozen.id)!.config) as SceneAppSnapshot;
    return { ...frozen, collectionIds: frozen.collectionIds.filter(id => current.collectionIds.includes(id)), tools: frozen.tools.filter(t => t === 'knowledge.search' && current.tools.includes(t)) };
  }
  answer(s: TourRow, text: string): { text: string; citations: TourCitation[] } {
    const app = this.effectiveScene(s), snapshot = JSON.parse(s.snapshot) as TourSnapshot, tokens = queryTokens(text);
    const scores = snapshot.steps.flatMap(step => step.segments.map(segment => ({ step, segment, score: tokens.filter(t => (step.title + segment.text).toLowerCase().includes(t)).length }))).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 2);
    const citations: TourCitation[] = scores.map(({ step, segment }) => ({ kind: 'exhibit', collectionId: s.hall_id, documentId: step.exhibitId, versionId: step.contentId, version: step.contentVersion, title: step.title, sourceLabel: step.sourceName, sourceUrl: step.sourceUrl, snippet: segment.text.slice(0, 600), score: 1 }));
    const knowledge = this.scenes.answer(app, text); citations.push(...knowledge.citations.slice(0, 2).map(c => ({ ...c, kind: 'knowledge' as const })));
    return { ...selectLanguageProvider(app.llmProvider, this.environment, this.appEnv).respond({ question: text, citations, tools: [], hostNames: [] }), citations };
  }
  question(s: TourRow, input: z.infer<typeof tourQuestionInput>) {
    this.assertInput(s, input.version, input.focusVersion);
    if (!['ready', 'explaining', 'paused', 'answering'].includes(s.status)) throw new AppError('STATE_CONFLICT', '当前不接收自动答疑，请联系工作人员。', 409);
    if (this.repo.get<{ n: number }>("SELECT count(*) n FROM tour_questions WHERE session_id=? AND status='queued'", s.id)!.n >= 20 || this.repo.get<{ n: number }>('SELECT count(*) n FROM tour_questions WHERE session_id=?', s.id)!.n >= 100) throw new AppError('QUEUE_FULL', '提问队列已满，请等待或联系工作人员。', 409);
    if (this.repo.get<{ n: number }>('SELECT count(*) n FROM tour_questions WHERE session_id=? AND created_at>?', s.id, new Date(Date.now() - 60000).toISOString())!.n >= 10) throw new AppError('RATE_LIMITED', '提问过于频繁，请稍后继续。', 429);
    const id = randomUUID(); this.repo.run('INSERT INTO tour_questions(id,session_id,audience_label,text,focus_version,created_at) VALUES (?,?,?,?,?,?)', id, s.id, input.audienceLabel, input.text, s.focus_version, at()); this.repo.run('UPDATE tour_sessions SET version=version+1,updated_at=? WHERE id=?', at(), s.id); return id;
  }
  cancelQuestion(s: TourRow, version: number, focusVersion: number, questionId: string) {
    this.assertInput(s, version, focusVersion); if (!this.repo.get("SELECT id FROM tour_questions WHERE id=? AND session_id=? AND status='queued'", questionId, s.id)) throw new AppError('STATE_CONFLICT', '只能取消本次导览中尚未回答的问题。', 409);
    this.repo.run("UPDATE tour_questions SET status='cancelled' WHERE id=?", questionId); this.repo.run('UPDATE tour_sessions SET version=version+1,updated_at=? WHERE id=?', at(), s.id);
  }
  control(s: TourRow, input: z.infer<typeof tourControlInput>, staff: boolean) {
    this.assertInput(s, input.version, input.focusVersion); const action = input.action;
    if (action === 'end') { if (['ended', 'invalidated'].includes(s.status)) throw new AppError('STATE_CONFLICT', '导览已结束。', 409); return this.close(s, 'ended', 'manual_end'); }
    if (!liveTourStatuses.includes(s.status)) throw new AppError('STATE_CONFLICT', '导览已完成或失效，请开启新的导览。', 409);
    if (action === 'resume' && !staff) throw new AppError('FORBIDDEN', '恢复自动讲解需要工作人员操作。', 403);
    let cursor = tourPosition(s), status = s.status, resume: TourCursor | null = s.resume_cursor ? JSON.parse(s.resume_cursor) : null, activeQuestionId = s.active_question_id;
    if (['play', 'pause', 'seek', 'next'].includes(action)) this.main(s);
    if (action === 'play') { if (!['ready', 'paused'].includes(s.status)) throw new AppError('STATE_CONFLICT', '讲解已经在进行。', 409); status = 'explaining'; }
    if (action === 'pause') { if (s.status !== 'explaining') throw new AppError('STATE_CONFLICT', '当前没有正在播放的讲解。', 409); status = 'paused'; }
    if (action === 'seek') { const seg = (JSON.parse(s.snapshot) as TourSnapshot).steps[cursor.stepIndex].segments[cursor.segmentIndex]; if (input.offsetMs === undefined || input.offsetMs >= seg.durationMs) throw new AppError('INVALID_CURSOR', '请选择当前段落有效范围内的位置。', 409); cursor.offsetMs = input.offsetMs; }
    if (action === 'next') { const snapshot = JSON.parse(s.snapshot) as TourSnapshot; if (cursor.segmentIndex + 1 < snapshot.steps[cursor.stepIndex].segments.length) cursor.segmentIndex++; else if (cursor.stepIndex + 1 < snapshot.steps.length) { cursor.stepIndex++; cursor.segmentIndex = 0; } else { cursor.offsetMs = snapshot.steps[cursor.stepIndex].segments[cursor.segmentIndex].durationMs; this.repo.run('UPDATE tour_sessions SET cursor=?,play_started_at=NULL WHERE id=?', JSON.stringify(cursor), s.id); return this.close(this.current(s), 'completed', 'route_finished'); } cursor.offsetMs = 0; }
    if (action === 'answer_next') {
      this.main(s); const q = this.repo.get<QuestionRow>("SELECT * FROM tour_questions WHERE session_id=? AND status='queued' ORDER BY created_at,rowid LIMIT 1", s.id); if (!q) throw new AppError('QUEUE_EMPTY', '当前没有排队中的问题。', 409);
      const answer = this.answer(s, q.text); resume = { ...cursor }; status = 'answering'; activeQuestionId = q.id;
      this.repo.run("UPDATE tour_questions SET status='answering',answer=?,citations=?,focus_version=? WHERE id=?", answer.text, JSON.stringify(answer.citations), s.focus_version + 1, q.id);
    }
    if (action === 'finish_answer') { if (s.status !== 'answering' || !resume || !activeQuestionId) throw new AppError('STATE_CONFLICT', '没有需要结束的答疑。', 409); this.repo.run("UPDATE tour_questions SET status='answered',answered_at=? WHERE id=? AND session_id=?", at(), activeQuestionId, s.id); cursor = { ...resume }; resume = null; activeQuestionId = null; status = 'paused'; }
    if (action === 'handoff') { if (resume) cursor = { ...resume }; resume = null; status = 'human'; if (activeQuestionId) this.repo.run("UPDATE tour_questions SET status='cancelled' WHERE id=?", activeQuestionId); activeQuestionId = null; }
    if (action === 'resume') { if (s.status !== 'human') throw new AppError('STATE_CONFLICT', '当前没有人工接管。', 409); status = 'paused'; }
    this.devices.cancel(s, 'playback_changed'); const changeFocus = ['answer_next', 'finish_answer', 'handoff', 'resume'].includes(action);
    this.repo.run('UPDATE tour_sessions SET status=?,cursor=?,resume_cursor=?,active_question_id=?,play_started_at=?,last_reason=?,version=version+1,focus_version=focus_version+?,playback_epoch=playback_epoch+1,updated_at=? WHERE id=?', status, JSON.stringify(cursor), resume ? JSON.stringify(resume) : null, activeQuestionId, status === 'explaining' ? at() : null, action, +changeFocus, at(), s.id);
    const current = this.current(s); if (status === 'explaining') this.devices.autoCue(current); else if (s.device_id && (s.auto_devices || action === 'handoff')) this.devices.automatic(current, action === 'handoff' ? 'blank' : 'pause_media');
    this.repo.event(s.tenant_id, s.workspace_id, s.id, 'tour.' + action, this.environment); return current;
  }
  view(s: TourRow): TourView {
    const snapshot = JSON.parse(s.snapshot) as TourSnapshot, app = JSON.parse(s.scene_snapshot) as SceneAppSnapshot, redacted = ['ended', 'invalidated'].includes(s.status);
    const questions: TourQuestion[] = redacted ? [] : this.repo.all<QuestionRow>('SELECT * FROM tour_questions WHERE session_id=? ORDER BY created_at,rowid LIMIT 100', s.id).map(q => {
      const citations = JSON.parse(q.citations) as TourCitation[]; let withdrawn = false;
      if (citations.some(c => c.kind === 'knowledge')) { const current = this.scenes.answer(this.effectiveScene(s), q.text); withdrawn = citations.some(c => c.kind === 'knowledge' && !current.citations.some(live => live.versionId === c.versionId && live.snippet === c.snippet)); }
      return { id: q.id, audienceLabel: q.audience_label, text: q.text, answer: withdrawn ? '引用资料已撤回或不可用，请重新提问。' : q.answer, citations: withdrawn ? [] : citations.map(c => ({ title: c.title, contentVersion: c.version, sourceName: c.sourceLabel, sourceUrl: c.sourceUrl })), status: q.status, createdAt: q.created_at };
    });
    const device = s.device_id ? this.devices.view(this.repo.get<DeviceRow>('SELECT * FROM exhibit_devices WHERE id=?', s.device_id)!) : null;
    if (device && device.activeSessionId !== s.id) device.display = null;
    return { id: s.id, hallId: s.hall_id, hallName: snapshot.hallName, routeName: snapshot.routeName, status: s.status, version: s.version, focusVersion: s.focus_version, playbackEpoch: s.playback_epoch, cursor: tourPosition(s), resumeCursor: s.resume_cursor ? JSON.parse(s.resume_cursor) : null, language: s.language, groupSize: s.group_size, durationMs: snapshot.durationMs, steps: redacted ? [] : snapshot.steps, questions, activeQuestionId: s.active_question_id, reason: s.last_reason, expiresAt: s.expires_at, simulated: true, device: redacted ? null : device, commands: this.devices.commands(s.id), profileName: app.profile.name };
  }
  sweep() { for (const r of this.repo.all<{ id: string }>("SELECT id FROM tour_sessions WHERE environment=? AND app_env=? AND status IN ('ready','explaining','paused','answering','human') ORDER BY expires_at LIMIT 1000", this.environment, this.appEnv)) this.synchronize(this.raw(r.id)); }
}
