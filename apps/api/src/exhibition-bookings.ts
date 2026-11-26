import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Repository } from '@digitalguide/database';
import { AppError, type Principal } from '@digitalguide/domain';
import { slotInput, bookingInput, type TourSlot, type TourBooking } from '@digitalguide/contracts';
import { ExhibitionContent, expectVersion, at } from './exhibition-content.js';
export interface SlotRow { id: string; hall_id: string; tenant_id: string; workspace_id: string; starts_at: string; ends_at: string; capacity: number; open: number; version: number }
export interface BookingRow { id: string; slot_id: string; tenant_id: string; workspace_id: string; group_name: string; party_size: number; language: TourBooking['language']; note: string; status: TourBooking['status']; version: number; created_at: string }
export class ExhibitionBookings {
  content: ExhibitionContent;
  constructor(public repo: Repository, public environment: string, public appEnv: string) { this.content = new ExhibitionContent(repo, environment, appEnv); }
  slot(p: Principal, id: string) { const r = this.repo.get<SlotRow>('SELECT * FROM tour_slots WHERE id=? AND tenant_id=?', id, p.tenantId); if (!r) throw new AppError('NOT_FOUND', '预约时段不存在。', 404); this.content.hall(p, r.hall_id); return r; }
  booking(p: Principal, id: string) { const r = this.repo.get<BookingRow>('SELECT * FROM tour_bookings WHERE id=? AND tenant_id=?', id, p.tenantId); if (!r) throw new AppError('NOT_FOUND', '团体预约不存在。', 404); this.slot(p, r.slot_id); return r; }
  slotView(s: SlotRow): TourSlot { return { id: s.id, hallId: s.hall_id, startsAt: s.starts_at, endsAt: s.ends_at, capacity: s.capacity, used: this.repo.get<{ n: number }>("SELECT COALESCE(sum(party_size),0) n FROM tour_bookings WHERE slot_id=? AND status NOT IN ('cancelled','no_show')", s.id)!.n, open: !!s.open, version: s.version }; }
  bookingView(b: BookingRow): TourBooking { return { id: b.id, slotId: b.slot_id, groupName: b.group_name, partySize: b.party_size, language: b.language, note: b.note, status: b.status, version: b.version, createdAt: b.created_at }; }
  createSlot(p: Principal, input: z.infer<typeof slotInput>) {
    const hall = this.content.hall(p, input.hallId); if (!hall.enabled || input.endsAt <= at() || Date.parse(input.endsAt) - Date.parse(input.startsAt) > 8 * 3600000) throw new AppError('INVALID_SLOT', '请选择开放展馆的未来有效时段，单个时段不超过八小时。', 409);
    if (this.repo.get('SELECT id FROM tour_slots WHERE hall_id=? AND starts_at<? AND ends_at>?', hall.id, input.endsAt, input.startsAt)) throw new AppError('SLOT_OVERLAP', '同一展馆的时段不能重叠，请使用已有时段或调整时间。', 409);
    const id = randomUUID(); this.repo.run('INSERT INTO tour_slots(id,hall_id,tenant_id,workspace_id,starts_at,ends_at,capacity,created_at) VALUES (?,?,?,?,?,?,?,?)', id, hall.id, p.tenantId, hall.workspace_id, input.startsAt, input.endsAt, input.capacity, at()); return id;
  }
  createBooking(p: Principal, input: z.infer<typeof bookingInput>) {
    const s = this.slot(p, input.slotId), hall = this.content.hall(p, s.hall_id);
    if (!s.open || !hall.enabled || s.ends_at <= at()) throw new AppError('SLOT_CLOSED', '该预约时段已关闭或结束，请选择其他时段。', 409);
    if (this.slotView(s).used + input.partySize > s.capacity) throw new AppError('CAPACITY_EXCEEDED', '剩余名额不足，请减少人数或选择其他时段。', 409);
    const id = randomUUID(); this.repo.run('INSERT INTO tour_bookings(id,slot_id,tenant_id,workspace_id,group_name,party_size,language,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)', id, s.id, p.tenantId, s.workspace_id, input.groupName, input.partySize, input.language, input.note, at(), at()); return id;
  }
  control(p: Principal, b: BookingRow, version: number, action: 'check_in' | 'cancel' | 'no_show') {
    expectVersion(b, version); const s = this.slot(p, b.slot_id);
    if (b.status === 'in_tour' || ['completed', 'cancelled', 'no_show'].includes(b.status)) throw new AppError('STATE_CONFLICT', '该团体状态不允许修改，请先结束正在进行的导览。', 409);
    if (action === 'check_in' && (b.status !== 'reserved' || Date.now() < Date.parse(s.starts_at) - 30 * 60000 || at() >= s.ends_at)) throw new AppError('CHECK_IN_WINDOW', '仅可在开始前半小时至时段结束前签到。', 409);
    if (action === 'no_show' && (s.ends_at > at() || b.status !== 'reserved')) throw new AppError('STATE_CONFLICT', '时段结束且尚未签到的预约才可标记未到。', 409);
    this.repo.run('UPDATE tour_bookings SET status=?,version=version+1,updated_at=? WHERE id=?', action === 'check_in' ? 'checked_in' : action === 'cancel' ? 'cancelled' : 'no_show', at(), b.id); return b.id;
  }
}
