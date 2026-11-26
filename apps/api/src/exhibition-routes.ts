import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Repository } from '@digitalguide/database';
import { AppError, requirePermission, requireWorkspace, type Permission } from '@digitalguide/domain';
import { id, hallInput, hallUpdateInput, exhibitInput, exhibitUpdateInput, exhibitPublishInput, tourRouteInput, tourRouteUpdateInput, tourPlanInput, tourStartInput, tourControlInput, tourQuestionInput, tourCancelQuestionInput, slotInput, slotUpdateInput, bookingInput, bookingControlInput, exhibitDeviceInput, exhibitDeviceUpdateInput, exhibitCommandInput, tourAccessInput } from '@digitalguide/contracts';
import { ExhibitionContent, expectVersion } from './exhibition-content.js';
import { ExhibitionBookings, type SlotRow, type BookingRow } from './exhibition-bookings.js';
import { ExhibitionDevices, type DeviceRow } from './exhibition-devices.js';
import { TourService } from './tour-service.js';
import { liveTourStatuses, type TourRow } from './tour-policy.js';
import { executeIdempotent } from './idempotency.js';
import type { Config } from './config.js';
const equal = (a: unknown, b: string) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function registerExhibitionRoutes(app: FastifyInstance, repo: Repository, config: Config) {
  const content = new ExhibitionContent(repo, config.providerMode, config.appEnv), bookings = new ExhibitionBookings(repo, config.providerMode, config.appEnv), devices = new ExhibitionDevices(repo, config.providerMode, config.appEnv), tours = new TourService(repo, config.providerMode, config.appEnv);
  const resource = (req: FastifyRequest) => id.parse((req.params as { id: string }).id), send = (req: FastifyRequest, reply: FastifyReply, data: unknown) => reply.send({ data, requestId: req.id });
  const hallQuery = (req: FastifyRequest) => content.hall(req.principal, z.strictObject({ hallId: id }).parse(req.query).hallId);
  function mutate(req: FastifyRequest, reply: FastifyReply, permission: Permission, work: () => { id: string; workspaceId: string }, project: (id: string) => unknown) {
    requirePermission(req.principal, permission);
    const result = executeIdempotent(repo, req, req.principal.tenantId, req.principal.userId, () => { const data = work(); repo.audit(req.principal, data.workspaceId, 'exhibition.' + req.method.toLowerCase(), data.id, req.id); return { id: data.id }; });
    return send(req, reply, project(result.data.id));
  }
  const scoped = (id: string, workspaceId: string) => ({ id, workspaceId });
  app.get('/api/v1/exhibitions', (req, reply) => { const q = z.strictObject({ workspaceId: id }).parse(req.query); requireWorkspace(req.principal, q.workspaceId); return send(req, reply, repo.all<{ id: string }>('SELECT id FROM exhibition_halls WHERE tenant_id=? AND workspace_id=? AND environment=? AND app_env=? ORDER BY created_at DESC LIMIT 100', req.principal.tenantId, q.workspaceId, config.providerMode, config.appEnv).map(r => content.hallView(content.hall(req.principal, r.id)))); });
  app.post('/api/v1/exhibitions', (req, reply) => mutate(req, reply, 'exhibit.manage', () => { const input = hallInput.parse(req.body); return scoped(content.saveHall(req.principal, input), input.workspaceId); }, id => content.hallView(content.hall(req.principal, id))));
  app.post('/api/v1/exhibitions/:id/update', (req, reply) => mutate(req, reply, 'exhibit.manage', () => { const input = hallUpdateInput.parse(req.body), old = content.hall(req.principal, resource(req)); expectVersion(old, input.version); return scoped(content.saveHall(req.principal, { ...input, workspaceId: old.workspace_id }, old), old.workspace_id); }, id => content.hallView(content.hall(req.principal, id))));
  app.get('/api/v1/exhibits', (req, reply) => { const h = hallQuery(req); return send(req, reply, repo.all<{ id: string }>('SELECT id FROM exhibits WHERE hall_id=? ORDER BY created_at,id LIMIT 200', h.id).map(r => content.exhibitView(content.exhibit(req.principal, r.id)))); });
  app.post('/api/v1/exhibits', (req, reply) => mutate(req, reply, 'exhibit.manage', () => { const input = exhibitInput.parse(req.body), hall = content.hall(req.principal, input.hallId); return scoped(content.saveExhibit(req.principal, input), hall.workspace_id); }, id => content.exhibitView(content.exhibit(req.principal, id))));
  app.post('/api/v1/exhibits/:id/update', (req, reply) => mutate(req, reply, 'exhibit.manage', () => { const input = exhibitUpdateInput.parse(req.body), old = content.exhibit(req.principal, resource(req)); expectVersion(old, input.version); return scoped(content.saveExhibit(req.principal, { ...input, hallId: old.hall_id }, old), old.workspace_id); }, id => content.exhibitView(content.exhibit(req.principal, id))));
  for (const action of ['publish', 'withdraw']) app.post('/api/v1/exhibits/:id/' + action, (req, reply) => mutate(req, reply, 'exhibit.manage', () => { const input = exhibitPublishInput.parse(req.body), old = content.exhibit(req.principal, resource(req)); expectVersion(old, input.version); return scoped(content.publish(old, input.contentVersion, action === 'withdraw'), old.workspace_id); }, id => content.exhibitView(content.exhibit(req.principal, id))));
  app.get('/api/v1/tour-routes', (req, reply) => { const hall = hallQuery(req); return send(req, reply, repo.all<{ id: string }>('SELECT id FROM tour_routes WHERE hall_id=? ORDER BY created_at,id LIMIT 100', hall.id).map(r => content.routeView(content.route(req.principal, r.id)))); });
  app.post('/api/v1/tour-routes', (req, reply) => mutate(req, reply, 'exhibit.manage', () => { const input = tourRouteInput.parse(req.body), hall = content.hall(req.principal, input.hallId); return scoped(content.saveRoute(req.principal, input), hall.workspace_id); }, id => content.routeView(content.route(req.principal, id))));
  app.post('/api/v1/tour-routes/:id/update', (req, reply) => mutate(req, reply, 'exhibit.manage', () => { const input = tourRouteUpdateInput.parse(req.body), old = content.route(req.principal, resource(req)); expectVersion(old, input.version); return scoped(content.saveRoute(req.principal, { ...input, hallId: old.hall_id }, old), old.workspace_id); }, id => content.routeView(content.route(req.principal, id))));
  app.post('/api/v1/tour-routes/:id/plan', (req, reply) => send(req, reply, content.plan(req.principal, content.route(req.principal, resource(req)), tourPlanInput.parse(req.body))));
  app.get('/api/v1/tour-slots', (req, reply) => { const hall = hallQuery(req); return send(req, reply, repo.all<SlotRow>('SELECT * FROM tour_slots WHERE hall_id=? ORDER BY starts_at DESC LIMIT 100', hall.id).map(r => bookings.slotView(r))); });
  app.post('/api/v1/tour-slots', (req, reply) => mutate(req, reply, 'exhibit.manage', () => { const input = slotInput.parse(req.body); return scoped(bookings.createSlot(req.principal, input), content.hall(req.principal, input.hallId).workspace_id); }, id => bookings.slotView(bookings.slot(req.principal, id))));
  app.post('/api/v1/tour-slots/:id/update', (req, reply) => mutate(req, reply, 'exhibit.manage', () => { const input = slotUpdateInput.parse(req.body), s = bookings.slot(req.principal, resource(req)); expectVersion(s, input.version); repo.run('UPDATE tour_slots SET open=?,version=version+1 WHERE id=?', +input.open, s.id); return scoped(s.id, s.workspace_id); }, id => bookings.slotView(bookings.slot(req.principal, id))));
  app.get('/api/v1/tour-bookings', (req, reply) => { requirePermission(req.principal, 'exhibit.manage'); const hall = hallQuery(req); return send(req, reply, repo.all<BookingRow>('SELECT b.* FROM tour_bookings b JOIN tour_slots s ON s.id=b.slot_id WHERE s.hall_id=? ORDER BY b.created_at DESC,b.id LIMIT 100', hall.id).map(r => bookings.bookingView(r))); });
  app.post('/api/v1/tour-bookings', (req, reply) => mutate(req, reply, 'exhibit.manage', () => { const input = bookingInput.parse(req.body), s = bookings.slot(req.principal, input.slotId); return scoped(bookings.createBooking(req.principal, input), s.workspace_id); }, id => bookings.bookingView(bookings.booking(req.principal, id))));
  app.post('/api/v1/tour-bookings/:id/control', (req, reply) => mutate(req, reply, 'exhibit.manage', () => { const input = bookingControlInput.parse(req.body), b = bookings.booking(req.principal, resource(req)); return scoped(bookings.control(req.principal, b, input.version, input.action), b.workspace_id); }, id => bookings.bookingView(bookings.booking(req.principal, id))));
  app.get('/api/v1/exhibit-devices', (req, reply) => { const hall = hallQuery(req); return send(req, reply, repo.all<DeviceRow>('SELECT * FROM exhibit_devices WHERE hall_id=? ORDER BY created_at,id LIMIT 100', hall.id).map(d => devices.view(d))); });
  app.post('/api/v1/exhibit-devices', (req, reply) => mutate(req, reply, 'device.control', () => { const input = exhibitDeviceInput.parse(req.body); return scoped(devices.save(req.principal, input), content.hall(req.principal, input.hallId).workspace_id); }, id => devices.view(devices.device(req.principal, id))));
  app.post('/api/v1/exhibit-devices/:id/update', (req, reply) => mutate(req, reply, 'device.control', () => { const input = exhibitDeviceUpdateInput.parse(req.body), d = devices.device(req.principal, resource(req)); expectVersion(d, input.version); return scoped(devices.save(req.principal, { ...input, hallId: d.hall_id }, d), d.workspace_id); }, id => devices.view(devices.device(req.principal, id))));
  app.post('/api/v1/exhibit-device-commands', (req, reply) => {
    requirePermission(req.principal, 'device.control'); const input = exhibitCommandInput.parse(req.body), s = repo.transaction(() => tours.session(req.principal, input.tourId));
    tours.assertInput(s, input.version, input.focusVersion); if (!liveTourStatuses.includes(s.status)) throw new AppError('STATE_CONFLICT', '当前导览不能控制设备。', 409);
    return mutate(req, reply, 'device.control', () => scoped(devices.queue(s, input.action, 'manual', input.fixture)!, s.workspace_id), () => tours.view(tours.current(s)));
  });
  app.get('/api/v1/tours', (req, reply) => { requirePermission(req.principal, 'exhibit.manage'); const hall = hallQuery(req); return send(req, reply, repo.transaction(() => repo.all<{ id: string }>('SELECT id FROM tour_sessions WHERE hall_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100', hall.id).map(r => { const s = tours.session(req.principal, r.id); return { id: s.id, status: s.status, language: s.language, groupSize: s.group_size, reason: s.last_reason }; }))); });
  app.get('/api/v1/tours/:id', (req, reply) => { requirePermission(req.principal, 'exhibit.manage'); return send(req, reply, repo.transaction(() => tours.view(tours.session(req.principal, resource(req))))); });
  app.post('/api/v1/tours', (req, reply) => mutate(req, reply, 'exhibit.manage', () => { const input = tourStartInput.parse(req.body), route = content.route(req.principal, input.routeId); return scoped(tours.start(req.principal, input), route.workspace_id); }, id => repo.transaction(() => tours.view(tours.session(req.principal, id)))));
  function token(s: TourRow, purpose: string) { return createHmac('sha256', config.sessionSecret).update([purpose, s.id, s.access_version, s.expires_at, config.providerMode, config.appEnv].join(':')).digest('base64url'); }
  app.post('/api/v1/tours/:id/access', (req, reply) => mutate(req, reply, 'exhibit.manage', () => { tourAccessInput.parse(req.body); const s = tours.session(req.principal, resource(req)); if (!liveTourStatuses.includes(s.status)) throw new AppError('STATE_CONFLICT', '请先开启有效的新导览。', 409); repo.run('UPDATE tour_sessions SET access_version=access_version+1 WHERE id=?', s.id); return scoped(s.id, s.workspace_id); }, id => {
    const s = tours.session(req.principal, id); if (!liveTourStatuses.includes(s.status)) throw new AppError('STATE_CONFLICT', '该终端访问已失效。', 409);
    reply.setCookie('dg_tour', token(s, 'tour-access'), { httpOnly: true, sameSite: 'strict', secure: config.webOrigin.startsWith('https:'), path: '/api/v1/guest/tours/' + s.id, maxAge: Math.max(0, Math.floor((Date.parse(s.expires_at) - Date.now()) / 1000)) }); return { terminalUrl: '/tour-terminal/' + s.id };
  }));
  app.post('/api/v1/tours/:id/control', (req, reply) => {
    requirePermission(req.principal, 'exhibit.manage'); const input = tourControlInput.parse(req.body), s = repo.transaction(() => tours.session(req.principal, resource(req)));
    if (input.focusVersion !== s.focus_version) throw new AppError('VERSION_CONFLICT', '当前发问人或导览状态已变化。', 409);
    return mutate(req, reply, 'exhibit.manage', () => { tours.control(s, input, true); return scoped(s.id, s.workspace_id); }, id => tours.view(tours.current({ id } as TourRow)));
  });
  function guest(req: FastifyRequest) {
    const s = tours.raw(resource(req)); if (s.expires_at <= new Date().toISOString() || !equal(req.cookies.dg_tour, token(s, 'tour-access'))) throw new AppError('AUTH_REQUIRED', '导览访问已失效，请从展厅中心重新打开。', 401);
    if (req.method !== 'GET' && !equal(req.headers['x-csrf-token'], token(s, 'tour-csrf'))) throw new AppError('FORBIDDEN', '导览安全凭证已变化，请刷新当前终端。', 403); return tours.synchronize(s);
  }
  const guestView = (s: TourRow) => ({ ...tours.view(s), csrfToken: token(s, 'tour-csrf') });
  app.get('/api/v1/guest/tours/:id', (req, reply) => send(req, reply, repo.transaction(() => guestView(guest(req)))));
  function guestMutation(req: FastifyRequest, reply: FastifyReply, work: (s: TourRow) => void) {
    const s = repo.transaction(() => guest(req)), fv = (req.body as { focusVersion?: unknown })?.focusVersion;
    if (fv !== s.focus_version) throw new AppError('VERSION_CONFLICT', '当前发问人或导览状态已变化，请重新载入。', 409);
    const result = executeIdempotent(repo, req, s.tenant_id, 'tour:' + s.id, () => { work(s); repo.audit({ tenantId: s.tenant_id, workspaceIds: [s.workspace_id], role: 'viewer', userId: 'tour:' + s.id }, s.workspace_id, 'tour.terminal_action', s.id, req.id); return { id: s.id }; }); return send(req, reply, guestView(tours.raw(result.data.id)));
  }
  app.post('/api/v1/guest/tours/:id/control', (req, reply) => { const input = tourControlInput.parse(req.body); return guestMutation(req, reply, s => { tours.control(s, input, false); }); });
  app.post('/api/v1/guest/tours/:id/questions', (req, reply) => { const input = tourQuestionInput.parse(req.body); return guestMutation(req, reply, s => { tours.question(s, input); }); });
  app.post('/api/v1/guest/tours/:id/questions/cancel', (req, reply) => { const input = tourCancelQuestionInput.parse(req.body); return guestMutation(req, reply, s => { tours.cancelQuestion(s, input.version, input.focusVersion, input.questionId); }); });
}
