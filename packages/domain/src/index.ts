export type Permission = 'operations.manage' | 'operations.read' | 'asset.read' | 'asset.write' | 'asset.train' | 'profile.write' | 'job.write' | 'audit.read' | 'session.manage' | 'visit.manage' | 'visit.respond' | 'people.directory' | 'office.write' | 'knowledge.manage' | 'exhibit.manage' | 'device.control' | 'studio.write' | 'studio.source.export' | 'studio.comment' | 'studio.approve' | 'publishing.publish' | 'live.manage' | 'live.start' | 'live.moderate' | 'ad.plan' | 'ad.approve' | 'ad.activate' | 'ad.budget.manage';
export interface Principal { userId: string; tenantId: string; role: 'admin' | 'editor' | 'viewer' | 'reviewer'; workspaceIds: string[];environment?:string;appEnv?:string }
export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400, public retryable = false) { super(message); }
}
export function requirePermission(principal: Principal, permission: Permission) {
  const grants: Record<Principal['role'], Permission[]> = {
    admin: ['operations.manage', 'operations.read', 'asset.read', 'asset.write', 'asset.train', 'profile.write', 'job.write', 'audit.read', 'session.manage', 'visit.manage', 'visit.respond', 'people.directory', 'office.write', 'knowledge.manage', 'exhibit.manage', 'device.control', 'studio.write','studio.source.export','studio.comment','studio.approve','publishing.publish','live.manage','live.start','live.moderate','ad.plan','ad.approve','ad.activate','ad.budget.manage'],
    editor: ['asset.read', 'asset.write', 'asset.train', 'profile.write', 'job.write', 'visit.respond', 'office.write', 'knowledge.manage', 'exhibit.manage', 'studio.write','studio.comment','live.manage','live.moderate','ad.plan'], viewer: ['asset.read'],reviewer: ['asset.read','studio.comment','studio.approve']
  };
  if (!grants[principal.role].includes(permission)) throw new AppError('FORBIDDEN', '当前账号没有操作权限，请联系企业管理员。', 403);
}
export function hasPermission(principal: Principal,permission: Permission) { try { requirePermission(principal,permission);return true; } catch (e) { if (e instanceof AppError && e.code === 'FORBIDDEN') return false;throw e; } }
export function requireWorkspace(principal: Principal, workspaceId: string) {
  if (!principal.workspaceIds.includes(workspaceId)) throw new AppError('NOT_FOUND', '资源不存在或不在当前工作空间，请切换账号。', 404);
}
export function assertUsableAsset(asset: { archived: boolean; expiresAt: string | null;unavailableReason?:string|null }, now = new Date().toISOString()) {
  if (asset.archived) throw new AppError('STATE_CONFLICT', '素材已在回收站，请先恢复素材。', 409);
  if (asset.unavailableReason) throw new AppError('ASSET_SOURCE_UNAVAILABLE',asset.unavailableReason,409);
  if (asset.expiresAt && asset.expiresAt <= now) throw new AppError('ASSET_EXPIRED', '素材权益已到期，请续期或选择其他素材。', 409);
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value) ?? 'null';
}

export * from './speech.js';
export * from './voice-localization.js';

export * from './character-motion.js';
