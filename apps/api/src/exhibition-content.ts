import { randomUUID, createHash } from 'node:crypto';
import type { z } from 'zod';
import type { Repository } from '@digitalguide/database';
import { AppError, canonical, requireWorkspace, type Principal } from '@digitalguide/domain';
import { hallInput, exhibitInput, tourRouteInput, tourPlanInput, type ExhibitionHall, type Exhibit, type TourRoute, type TourPlan, type TourStep } from '@digitalguide/contracts';
export interface HallRow { id: string; tenant_id: string; workspace_id: string; venue_id: string; name: string; description: string; zones: string; opening_hours: string; enabled: number; version: number }
export interface ExhibitRow { id: string; hall_id: string; tenant_id: string; workspace_id: string; code: string; title: string; zone_id: string; tags: string; accessible: number; version: number; draft_version: number; published_version: number | null }
export interface ExhibitVersionRow { id: string; exhibit_id: string; number: number; status: string; body: string }
export interface RouteRow { id: string; hall_id: string; tenant_id: string; workspace_id: string; name: string; steps: string; enabled: number; version: number }
export const at = () => new Date().toISOString();
export function expectVersion(row: { version: number }, version: number) { if (row.version !== version) throw new AppError('VERSION_CONFLICT', '资料已更新，请重新载入并核对。', 409); }
export class ExhibitionContent {
  constructor(public repo: Repository, public environment: string, public appEnv: string) {}
  hall(p: Principal, id: string) {
    const r = this.repo.get<HallRow>('SELECT * FROM exhibition_halls WHERE id=? AND tenant_id=? AND environment=? AND app_env=?', id, p.tenantId, this.environment, this.appEnv);
    if (!r) throw new AppError('NOT_FOUND', '展馆不存在或不在当前环境。', 404); requireWorkspace(p, r.workspace_id); return r;
  }
  exhibit(p: Principal, id: string) { const r = this.repo.get<ExhibitRow>('SELECT * FROM exhibits WHERE id=? AND tenant_id=?', id, p.tenantId); if (!r) throw new AppError('NOT_FOUND', '展品不存在。', 404); this.hall(p, r.hall_id); return r; }
  route(p: Principal, id: string) { const r = this.repo.get<RouteRow>('SELECT * FROM tour_routes WHERE id=? AND tenant_id=?', id, p.tenantId); if (!r) throw new AppError('NOT_FOUND', '路线不存在。', 404); this.hall(p, r.hall_id); return r; }
  hallView(r: HallRow): ExhibitionHall { return { id: r.id, workspaceId: r.workspace_id, venueId: r.venue_id, name: r.name, description: r.description, zones: JSON.parse(r.zones), openingHours: r.opening_hours, enabled: !!r.enabled, version: r.version }; }
  exhibitView(r: ExhibitRow): Exhibit { return { id: r.id, hallId: r.hall_id, code: r.code, title: r.title, zoneId: r.zone_id, tags: JSON.parse(r.tags), accessible: !!r.accessible, version: r.version, draftVersion: r.draft_version, publishedVersion: r.published_version, contentVersions: this.repo.all<ExhibitVersionRow>('SELECT * FROM exhibit_versions WHERE exhibit_id=? ORDER BY number DESC', r.id).map(v => ({ id: v.id, number: v.number, status: v.status, body: JSON.parse(v.body) })) }; }
  routeView(r: RouteRow): TourRoute { return { id: r.id, hallId: r.hall_id, name: r.name, version: r.version, enabled: !!r.enabled, steps: JSON.parse(r.steps) }; }
  saveHall(p: Principal, input: z.infer<typeof hallInput>, old?: HallRow) {
    requireWorkspace(p, input.workspaceId); const id = old?.id || randomUUID();
    if (new Set(input.zones.map(z => z.id)).size !== input.zones.length) throw new AppError('VALIDATION_FAILED', '展区编号不能重复。');
    if (old && this.repo.all<{ zone_id: string }>('SELECT zone_id FROM exhibits WHERE hall_id=?', old.id).some(e => !input.zones.some(z => z.id === e.zone_id))) throw new AppError('STATE_CONFLICT', '展区仍有展品，请先调整展品归属再移除展区。', 409);
    let venueId = old?.venue_id || input.venueId;
    if (venueId && !this.repo.get('SELECT id FROM venues WHERE id=? AND tenant_id=? AND workspace_id=?', venueId, p.tenantId, input.workspaceId)) throw new AppError('NOT_FOUND', '所属场所不在当前工作空间。', 404);
    if (!venueId) { venueId = randomUUID(); this.repo.run('INSERT INTO venues VALUES (?,?,?,?,?)', venueId, p.tenantId, input.workspaceId, input.name, 'Asia/Shanghai'); }
    if (old) this.repo.run('UPDATE exhibition_halls SET name=?,description=?,zones=?,opening_hours=?,enabled=?,version=version+1,updated_at=? WHERE id=?', input.name, input.description, JSON.stringify(input.zones), input.openingHours, +input.enabled, at(), id);
    else this.repo.run('INSERT INTO exhibition_halls(id,tenant_id,workspace_id,venue_id,name,description,zones,opening_hours,enabled,environment,app_env,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', id, p.tenantId, input.workspaceId, venueId, input.name, input.description, JSON.stringify(input.zones), input.openingHours, +input.enabled, this.environment, this.appEnv, at(), at());
    return id;
  }
  saveExhibit(p: Principal, input: z.infer<typeof exhibitInput>, old?: ExhibitRow) {
    const hall = this.hall(p, input.hallId), zones = JSON.parse(hall.zones) as ExhibitionHall['zones'];
    if (!zones.some(z => z.id === input.zoneId)) throw new AppError('NOT_FOUND', '展区不属于本展馆。', 404);
    if (this.repo.get('SELECT id FROM exhibits WHERE hall_id=? AND code=? AND id<>?', hall.id, input.code, old?.id || '')) throw new AppError('STATE_CONFLICT', '展品编号已使用，请换一个编号。', 409);
    if (new Set(input.body.segments.map(s => s.id)).size !== input.body.segments.length) throw new AppError('VALIDATION_FAILED', '讲解段编号不能重复。');
    const id = old?.id || randomUUID(), number = old ? old.draft_version + 1 : 1;
    if (old) this.repo.run('UPDATE exhibits SET code=?,title=?,zone_id=?,tags=?,accessible=?,version=version+1,draft_version=?,updated_at=? WHERE id=?', input.code, input.title, input.zoneId, JSON.stringify([...new Set(input.tags)]), +input.accessible, number, at(), id);
    else { if (this.repo.get<{ n: number }>('SELECT count(*) n FROM exhibits WHERE hall_id=?', hall.id)!.n >= 200) throw new AppError('QUOTA_EXCEEDED', '每馆最多二百件展品。', 409); this.repo.run('INSERT INTO exhibits(id,hall_id,tenant_id,workspace_id,code,title,zone_id,tags,accessible,draft_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,1,?,?)', id, hall.id, p.tenantId, hall.workspace_id, input.code, input.title, input.zoneId, JSON.stringify([...new Set(input.tags)]), +input.accessible, at(), at()); }
    // Metadata is frozen with each content version so narration and display cite the same published object.
    this.repo.run("INSERT INTO exhibit_versions(id,exhibit_id,number,status,body,created_at) VALUES (?,?,?,'draft',?,?)", randomUUID(), id, number, JSON.stringify({ ...input.body, title: input.title, zoneId: input.zoneId, tags: input.tags, accessible: input.accessible }), at()); return id;
  }
  publish(r: ExhibitRow, contentVersion: number, withdraw = false) {
    const v = this.repo.get<ExhibitVersionRow>('SELECT * FROM exhibit_versions WHERE exhibit_id=? AND number=?', r.id, contentVersion);
    if (!v || v.status === 'withdrawn' || (!withdraw && v.status !== 'draft') || (withdraw && v.status !== 'published')) throw new AppError('STATE_CONFLICT', '该讲稿版本不能执行此操作，请核对状态。', 409);
    this.repo.run('UPDATE exhibit_versions SET status=?,published_at=? WHERE id=?', withdraw ? 'withdrawn' : 'published', at(), v.id);
    this.repo.run('UPDATE exhibits SET published_version=?,version=version+1,updated_at=? WHERE id=?', withdraw ? r.published_version === contentVersion ? null : r.published_version : contentVersion, at(), r.id);
    return r.id;
  }
  saveRoute(p: Principal, input: z.infer<typeof tourRouteInput>, old?: RouteRow) {
    const hall = this.hall(p, input.hallId);
    if (new Set(input.steps.map(s => s.id)).size !== input.steps.length || new Set(input.steps.map(s => s.exhibitId)).size !== input.steps.length) throw new AppError('VALIDATION_FAILED', '同一路线不能重复步骤或展品。');
    for (const step of input.steps) if (this.exhibit(p, step.exhibitId).hall_id !== hall.id) throw new AppError('NOT_FOUND', '路线展品不属于本展馆。', 404);
    const id = old?.id || randomUUID();
    if (old) this.repo.run('UPDATE tour_routes SET name=?,steps=?,enabled=?,version=version+1,updated_at=? WHERE id=?', input.name, JSON.stringify(input.steps), +input.enabled, at(), id);
    else this.repo.run('INSERT INTO tour_routes(id,hall_id,tenant_id,workspace_id,name,steps,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)', id, hall.id, p.tenantId, hall.workspace_id, input.name, JSON.stringify(input.steps), +input.enabled, at(), at()); return id;
  }
  plan(p: Principal, route: RouteRow, input: z.infer<typeof tourPlanInput>): TourPlan {
    expectVersion(route, input.version); const hall = this.hall(p, route.hall_id); if (!hall.enabled || !route.enabled) throw new AppError('STATE_CONFLICT', '展馆或路线已停用。', 409);
    const steps = JSON.parse(route.steps) as TourRoute['steps'], zones = JSON.parse(hall.zones) as ExhibitionHall['zones'];
    const omitted: TourPlan['omitted'] = [];
    const candidates = steps.map(step => {
      const e = this.exhibit(p, step.exhibitId), v = this.repo.get<ExhibitVersionRow>("SELECT * FROM exhibit_versions WHERE exhibit_id=? AND number=? AND status='published'", e.id, e.published_version || 0);
      if (!v) { if (!step.required) { omitted.push({ exhibitId: e.id, reason: 'content_unavailable' }); return null; } throw new AppError('CONTENT_NOT_PUBLISHED', '必经展品尚未发布，请先发布讲稿。', 409); }
      const body = JSON.parse(v.body) as z.infer<typeof exhibitInput>['body'] & { title: string; zoneId: string; tags: string[]; accessible: boolean };
      if ((body.effectiveFrom && body.effectiveFrom > at()) || (body.effectiveUntil && body.effectiveUntil <= at())) { if (!step.required) { omitted.push({ exhibitId: e.id, reason: 'content_unavailable' }); return null; } throw new AppError('CONTENT_NOT_EFFECTIVE', '必经讲稿尚未生效或已到期。', 409); }
      if (body.segments.some(s => !s.text[input.language]?.trim())) { if (!step.required) { omitted.push({ exhibitId: e.id, reason: 'language_unavailable' }); return null; } throw new AppError('LANGUAGE_UNAVAILABLE', '必经展品缺少所选语言的完整讲稿，请补齐翻译或选择其他语言。', 409); }
      const zone = zones.find(z => z.id === body.zoneId); if (!zone) throw new AppError('STATE_CONFLICT', '已发布讲稿的展区已变化，请重新发布讲稿。', 409);
      const snapshot: TourStep = { id: step.id, exhibitId: e.id, contentId: v.id, contentVersion: v.number, title: body.title, zone: zone.name, floor: zone.floor, sourceName: body.sourceName, sourceUrl: body.sourceUrl, segments: body.segments.map(s => ({ id: s.id, text: s.text[input.language]!, durationMs: s.durationMs, screen: s.screen })) };
      return { step, snapshot, duration: snapshot.segments.reduce((n, s) => n + s.durationMs, 0), accessible: body.accessible, interest: input.interests.some(t => body.tags.includes(t)) };
    }).filter(c => c !== null);
    const selected = new Set<string>(); let used = 0;
    for (const c of candidates.filter(c => c.step.required)) { if (input.accessibleOnly && !c.accessible) throw new AppError('ROUTE_NOT_ACCESSIBLE', '必经展品不满足所选可达性，请调整路线。', 409); selected.add(c.step.id); used += c.duration; }
    if (used > input.timeBudgetMinutes * 60000) throw new AppError('TIME_BUDGET_TOO_SHORT', '必经讲解已超过时长，请增加时间或调整路线。', 409);
    for (const c of candidates.filter(c => !c.step.required).sort((a, b) => +b.interest - +a.interest)) {
      const reason = input.accessibleOnly && !c.accessible ? 'not_accessible' : input.interests.length && !c.interest ? 'not_interested' : used + c.duration > input.timeBudgetMinutes * 60000 ? 'time_budget' : null;
      if (reason) omitted.push({ exhibitId: c.snapshot.exhibitId, reason }); else { used += c.duration; selected.add(c.step.id); }
    }
    const result = { language: input.language, durationMs: used, steps: candidates.filter(c => selected.has(c.step.id)).map(c => c.snapshot), omitted };
    if (!result.steps.length) throw new AppError('EMPTY_ROUTE_PLAN', '所选条件下没有可讲解展品，请调整路线或偏好。', 409);
    return { ...result, hash: createHash('sha256').update(canonical({ routeId: route.id, routeVersion: route.version, hallVersion: hall.version, input, result })).digest('hex') };
  }
}
