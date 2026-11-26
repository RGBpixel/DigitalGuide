import type { Repository } from '@digitalguide/database';
import type { SceneAppSnapshot, TourView, TourPlan, TourCursor } from '@digitalguide/contracts';
import { AppError, assertUsableAsset } from '@digitalguide/domain';
import { SceneService } from './knowledge-service.js';
import { at } from './exhibition-content.js';
export interface TourRow { id: string; hall_id: string; tenant_id: string; workspace_id: string; route_id: string; route_version: number; booking_id: string | null; snapshot: string; scene_snapshot: string; language: string; group_size: number; device_id: string | null; auto_devices: number; status: TourView['status']; cursor: string; resume_cursor: string | null; active_question_id: string | null; play_started_at: string | null; last_reason: string; version: number; focus_version: number; playback_epoch: number; access_version: number; environment: string; app_env: string; expires_at: string }
export interface TourSnapshot extends TourPlan { hallName: string; routeName: string }
export const liveTourStatuses = ['ready', 'explaining', 'paused', 'answering', 'human'];
export function tourPolicyReason(repo: Repository, s: TourRow): string | null {
  if (s.expires_at <= at()) return 'tour_expired';
  const hall = repo.get<{ enabled: number; environment: string; app_env: string }>('SELECT enabled,environment,app_env FROM exhibition_halls WHERE id=? AND tenant_id=? AND workspace_id=?', s.hall_id, s.tenant_id, s.workspace_id), route = repo.get<{ enabled: number }>('SELECT enabled FROM tour_routes WHERE id=? AND hall_id=?', s.route_id, s.hall_id);
  if (!hall?.enabled || hall.environment !== s.environment || hall.app_env !== s.app_env || !route?.enabled) return 'hall_or_route_disabled';
  const snapshot = JSON.parse(s.snapshot) as TourSnapshot;
  for (const step of snapshot.steps) {
    const v = repo.get<{ status: string; body: string }>('SELECT status,body FROM exhibit_versions WHERE id=? AND exhibit_id=?', step.contentId, step.exhibitId);
    if (v?.status !== 'published') return 'content_withdrawn';
    const body = JSON.parse(v.body) as { effectiveFrom: string | null; effectiveUntil: string | null };
    if ((body.effectiveFrom && body.effectiveFrom > at()) || (body.effectiveUntil && body.effectiveUntil <= at())) return 'content_not_effective';
  }
  try {
    const app = JSON.parse(s.scene_snapshot) as SceneAppSnapshot; new SceneService(repo, s.environment, s.app_env).active(app);
    const p = { tenantId: s.tenant_id, userId: 'tour:' + s.id, role: 'viewer' as const, workspaceIds: [s.workspace_id] };
    assertUsableAsset(repo.asset(p, app.profile.avatarAssetId)); if (app.profile.voiceAssetId) assertUsableAsset(repo.asset(p, app.profile.voiceAssetId));
  } catch (e) { if (!(e instanceof AppError)) throw e; return 'scene_or_asset_unavailable'; }
  return null;
}
export function tourPosition(s: TourRow, currentTime = Date.now()): TourCursor {
  const cursor = JSON.parse(s.cursor) as TourCursor, snapshot = JSON.parse(s.snapshot) as TourSnapshot;
  if (s.status === 'explaining' && s.play_started_at) cursor.offsetMs = Math.min(snapshot.steps[cursor.stepIndex].segments[cursor.segmentIndex].durationMs, cursor.offsetMs + Math.max(0, currentTime - Date.parse(s.play_started_at)));
  return cursor;
}
