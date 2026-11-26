import { randomUUID } from 'node:crypto';
import { AppError, canonical, type Principal } from '../../domain/src/index.js';
import { developerViewSchema, type DeveloperGatewayResult, type DeveloperMutation, type DeveloperMutationResult, type DeveloperPageInput, type DeveloperResource, type DeveloperView } from '../../contracts/src/developer-access.js';
import { createDeveloperCredential, developerCredentialHash, developerCredentialPrefix, developerHashMatches } from './developer-credentials.js';
import type { IdentityRow, IdentityWorkflow, IdentityWorkflows } from './identity-workflows.js';
type Host = { providerMode: 'mock' | 'sandbox' | 'live'; appEnv: 'development' | 'sandbox' | 'production' };
function* q(sql: string, args: unknown[] = [], postgresSql?: string): IdentityWorkflow<IdentityRow[]> { return (yield { kind: 'query', sql, args, ...(postgresSql ? { postgresSql } : {}) }) as IdentityRow[]; }
function* now(): IdentityWorkflow<string> { return (yield { kind: 'now' }) as string; }
const n = (v: unknown) => Number(v);
const denied = (): DeveloperGatewayResult => ({ error: { code: 'DEVELOPER_AUTH_REQUIRED', status: 401 } });
export class DeveloperWorkflows {
  constructor(readonly host: Host, readonly identity: IdentityWorkflows, readonly native = false, readonly webhooksAvailable = false, readonly studioAvailable = false) {}
  scope(tenantId: string, workspaceId: string) { return [tenantId, workspaceId, this.host.providerMode, this.host.appEnv]; }
  *access(p: Principal, workspaceId: string, manage = false): IdentityWorkflow<{ principal: Principal; canManage: boolean }> {
    yield* this.identity.organization(p.tenantId, manage);
    if (!(yield* q('SELECT id FROM workspaces WHERE id=? AND tenant_id=?', [workspaceId, p.tenantId])).length) throw new AppError('NOT_FOUND', '工作空间不存在或不属于当前组织。', 404);
    return yield* this.identity.actor(p, workspaceId, manage);
  }
  *app(p: Principal, workspaceId: string, appId: string): IdentityWorkflow<IdentityRow> {
    const sql = 'SELECT * FROM developer_apps WHERE tenant_id=? AND workspace_id=? AND environment=? AND app_env=? AND id=?';
    const row = (yield* q(sql, [...this.scope(p.tenantId, workspaceId), appId], sql + ' FOR UPDATE'))[0];
    if (!row) throw new AppError('NOT_FOUND', '开发者应用不存在或不属于当前空间。', 404); return row;
  }
  *view(p: Principal, workspaceId: string): IdentityWorkflow<DeveloperView> {
    const access = yield* this.access(p, workspaceId), at = yield* now();
    const apps = yield* q('SELECT * FROM developer_apps WHERE tenant_id=? AND workspace_id=? AND environment=? AND app_env=? ORDER BY id LIMIT 51', this.scope(p.tenantId, workspaceId));
    if (apps.length > 50) throw new AppError('DEVELOPER_APP_LIMIT', '当前空间应用超过可管理范围，请联系管理员。', 409);
    const rows = [];
    for (const app of apps) {
      const keys = yield* q('SELECT id,expires_at,revoked_at,created_at FROM developer_credentials WHERE app_id=? ORDER BY CASE WHEN revoked_at IS NULL AND expires_at>? THEN 0 ELSE 1 END,created_at DESC,id DESC LIMIT 31', [app.id, at]);
      rows.push({ id: app.id, name: app.name, enabled: n(app.enabled) === 1, scopes: JSON.parse(String(app.scopes)), version: n(app.version), createdAt: app.created_at, updatedAt: app.updated_at, credentials: keys.slice(0, 30).map(k => ({ id: k.id, prefix: developerCredentialPrefix(String(k.id)), expiresAt: k.expires_at, revokedAt: k.revoked_at, createdAt: k.created_at, status: k.revoked_at ? 'revoked' : String(k.expires_at) <= at ? 'expired' : 'active' })), credentialHistoryTruncated: keys.length > 30 });
    }
    const changes = yield* q('SELECT id,app_id,credential_id,action,revision,created_at FROM developer_events WHERE tenant_id=? AND workspace_id=? AND environment=? AND app_env=? ORDER BY created_at DESC,id DESC LIMIT 20', this.scope(p.tenantId, workspaceId));
    return developerViewSchema.parse({ tenantId: p.tenantId, workspaceId, environment: this.host.providerMode, appEnv: this.host.appEnv, canManageOrganization: access.canManage, apps: rows, recentChanges: changes.map(e => ({ id: e.id, appId: e.app_id, credentialId: e.credential_id, action: e.action, revision: n(e.revision), createdAt: e.created_at })), rateLimit: { requests: 60, windowSeconds: 60 }, writesSupported: this.studioAvailable, webhooksSupported: this.webhooksAvailable, embedSupported: false });
  }
  *mutation(p: Principal, mutation: DeveloperMutation, key: string): IdentityWorkflow<DeveloperMutationResult> {
    const w = mutation.input.workspaceId, access = yield* this.access(p, w, true), actor = access.principal;
    const action = 'POST /api/v1/enterprise/developers/' + mutation.action;
    const requestHash = developerCredentialHash('request', canonical(mutation.input));
    const existing = (yield* q('SELECT request_hash,response,redacted FROM idempotency WHERE tenant_id=? AND actor_id=? AND action=? AND key=?', [p.tenantId, p.userId, action, key]))[0];
    let result: { receiptId: string; credentialId?: string }, token: string | null = null;
    if (existing) {
      if (existing.request_hash !== requestHash) throw new AppError('IDEMPOTENCY_CONFLICT', '同一操作编号的内容发生变化，请重新操作。', 409);
      if (n(existing.redacted)) throw new AppError('DATA_REMOVED', '旧操作内容已清理，请刷新。', 409);
      result = JSON.parse(String(existing.response));
    } else {
      const changed = yield* this.change(actor, mutation); result = { receiptId: changed.receiptId, ...(changed.credentialId ? { credentialId: changed.credentialId } : {}) }; token = changed.token ?? null;
      yield* q('INSERT INTO idempotency(tenant_id,actor_id,action,key,request_hash,response,status_code,created_at) VALUES(?,?,?,?,?,?,?,?)', [p.tenantId, p.userId, action, key, requestHash, JSON.stringify(result), 200, yield* now()]);
    }
    return { receiptId: result.receiptId, view: yield* this.view(actor, w), ...(result.credentialId ? { issuedCredential: { id: result.credentialId, oneTimeToken: token } } : {}) };
  }
  *change(p: Principal, mutation: DeveloperMutation): IdentityWorkflow<{ receiptId: string; credentialId?: string; token?: string }> {
    const input = mutation.input, at = yield* now(); let appId: string, credentialId: string | null = null, revision = 1, action: string, token: string | undefined;
    if (mutation.action === 'create') {
      const count = (yield* q('SELECT count(*) n FROM developer_apps WHERE tenant_id=? AND workspace_id=? AND environment=? AND app_env=?', this.scope(p.tenantId, input.workspaceId)))[0];
      if (n(count.n) >= 50) throw new AppError('DEVELOPER_APP_LIMIT', '每个空间最多50个开发者应用，请复用现有应用。', 409);
      appId = randomUUID(); action = 'app.created';
      yield* q('INSERT INTO developer_apps VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', [appId, ...this.scope(p.tenantId, input.workspaceId), mutation.input.name, canonical([...mutation.input.scopes].sort()), 1, revision, p.userId, at, at]);
    } else {
      appId = mutation.input.appId; const old = yield* this.app(p, input.workspaceId, appId);
      if (n(old.version) !== mutation.input.expectedVersion) throw new AppError('DEVELOPER_VERSION_CHANGED', '应用已被其他人更新，请刷新后重新核对。', 409);
      if (n(old.version) >= 1_000_000_000) throw new AppError('DEVELOPER_VERSION_LIMIT', '应用修订已达上限，请创建新应用。', 409); revision = n(old.version) + 1;
      if (mutation.action === 'control') {
        action = 'app.updated'; const scopes = canonical([...mutation.input.scopes].sort());
        if (!mutation.input.enabled || scopes !== old.scopes) yield* q('UPDATE developer_credentials SET revoked_at=? WHERE app_id=? AND revoked_at IS NULL', [at, appId]);
        yield* q('UPDATE developer_apps SET name=?,scopes=?,enabled=?,version=?,updated_at=? WHERE id=?', [mutation.input.name, scopes, mutation.input.enabled ? 1 : 0, revision, at, appId]);
      } else if (mutation.action === 'issue') {
        if (n(old.enabled) !== 1) throw new AppError('DEVELOPER_APP_DISABLED', '应用已停用，请先启用应用再签发凭证。', 409);
        const count = (yield* q('SELECT count(*) n FROM developer_credentials WHERE app_id=?', [appId]))[0], active = (yield* q('SELECT count(*) n FROM developer_credentials WHERE app_id=? AND revoked_at IS NULL AND expires_at>?', [appId, at]))[0];
        if (n(count.n) >= 1000 || n(active.n) >= 2) throw new AppError('DEVELOPER_CREDENTIAL_LIMIT', '每个应用最多两份有效凭证；请先撤销旧凭证。累计达到1000份时需创建新应用。', 409);
        const created = createDeveloperCredential(); credentialId = created.id; token = created.token; action = 'credential.issued';
        yield* q('INSERT INTO developer_credentials VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', [credentialId, appId, ...this.scope(p.tenantId, input.workspaceId), created.hash, new Date(Date.parse(at) + mutation.input.termDays * 86400000).toISOString(), null, p.userId, at, 1]);
        yield* q('UPDATE developer_apps SET version=?,updated_at=? WHERE id=?', [revision, at, appId]);
      } else {
        credentialId = mutation.input.credentialId; const credential = (yield* q('SELECT id,revoked_at FROM developer_credentials WHERE id=? AND app_id=?', [credentialId, appId]))[0];
        if (!credential) throw new AppError('NOT_FOUND', '凭证不存在或不属于当前应用。', 404);
        if (credential.revoked_at) throw new AppError('DEVELOPER_CREDENTIAL_REVOKED', '该凭证已撤销，请刷新核对。', 409);
        action = 'credential.revoked'; yield* q('UPDATE developer_credentials SET revoked_at=? WHERE id=?', [at, credentialId]); yield* q('UPDATE developer_apps SET version=?,updated_at=? WHERE id=?', [revision, at, appId]);
      }
    }
    const receiptId = randomUUID();
    yield* q('INSERT INTO developer_events VALUES(?,?,?,?,?,?,?,?,?,?,?)', [receiptId, ...this.scope(p.tenantId, input.workspaceId), p.userId, appId, credentialId, action, revision, at]);
    return { receiptId, ...(action === 'credential.issued' && credentialId ? { credentialId } : {}), ...(token ? { token } : {}) };
  }
  *gateway(auth: { id: string; hash: string } | null, resource: DeveloperResource, page: DeveloperPageInput, target?: string): IdentityWorkflow<DeveloperGatewayResult> {
    if (!auth) return denied();
    if (this.native) return (yield* q('SELECT dg_native_developer_read(?,?,?,?,?,?) value', [auth.id, auth.hash, resource, target ?? '', page.cursor ?? '', page.limit]))[0].value as DeveloperGatewayResult;
    const key = (yield* q('SELECT * FROM developer_credentials WHERE id=?', [auth.id]))[0];
    if (!key || !developerHashMatches(key.secret_hash, auth.hash)) return denied();
    const app = (yield* q('SELECT * FROM developer_apps WHERE id=? AND environment=? AND app_env=?', [key.app_id, this.host.providerMode, this.host.appEnv]))[0], at = yield* now();
    if (!app || n(app.enabled) !== 1 || key.revoked_at || String(key.expires_at) <= at || !(yield* q('SELECT id FROM workspaces WHERE id=? AND tenant_id=?', [app.workspace_id, app.tenant_id])).length) return denied();
    const window = at.slice(0, 16), rate = (yield* q('SELECT window_start,request_count FROM developer_rate_windows WHERE credential_id=?', [auth.id]))[0];
    if (rate?.window_start === window && n(rate.request_count) >= 60) return { error: { code: 'DEVELOPER_RATE_LIMIT', status: 429 } };
    yield* q('INSERT INTO developer_rate_windows VALUES(?,?,1) ON CONFLICT(credential_id) DO UPDATE SET window_start=excluded.window_start,request_count=CASE WHEN developer_rate_windows.window_start=excluded.window_start THEN developer_rate_windows.request_count+1 ELSE 1 END', [auth.id, window]);
    const scopes = JSON.parse(String(app.scopes)) as string[];
    if (resource === 'context') return { data: { appId: app.id, workspaceId: app.workspace_id, environment: app.environment, appEnv: app.app_env, scopes, identity: 'organization_application', rateLimit: { requests: 60, windowSeconds: 60 } } };
    const projects = resource.startsWith('projects.'), required = projects ? 'projects.read' : 'exports.read';
    if (!scopes.includes(required)) return { error: { code: 'DEVELOPER_SCOPE_REQUIRED', status: 403 } };
    const columns = (projects ? 'id,name,purpose,version,archived,created_at,updated_at' : 'id,project_id,project_version,kind,status,progress,created_at,updated_at').split(',').map(c => 'r.' + c).join(',');
    const detail = resource.endsWith('.get'), table = projects ? 'studio_projects' : 'studio_exports';
    const join = projects ? '' : ' JOIN studio_projects p ON p.id=r.project_id AND p.tenant_id=r.tenant_id AND p.workspace_id=r.workspace_id AND p.environment=r.environment AND p.app_env=r.app_env';
    const rows = yield* q('SELECT ' + columns + ' FROM ' + table + ' r' + join + ' WHERE r.tenant_id=? AND r.workspace_id=? AND r.environment=? AND r.app_env=? AND r.id' + (detail ? '=?' : '>?') + ' ORDER BY r.id LIMIT ?', [app.tenant_id, app.workspace_id, app.environment, app.app_env, detail ? target : page.cursor ?? '', detail ? 1 : page.limit + 1]);
    const items = rows.slice(0, page.limit).map(r => projects ? { id: r.id, name: r.name, purpose: r.purpose, version: n(r.version), archived: n(r.archived) === 1, createdAt: r.created_at, updatedAt: r.updated_at } : { id: r.id, projectId: r.project_id, projectVersion: n(r.project_version), kind: r.kind, status: r.status, progress: n(r.progress), createdAt: r.created_at, updatedAt: r.updated_at });
    return detail ? items.length ? { data: items[0] } : { error: { code: 'NOT_FOUND', status: 404 } } : { data: { items, nextCursor: rows.length > page.limit ? String(rows[page.limit - 1].id) : null } };
  }
}
