import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Repository } from '@digitalguide/database';
import { AppError } from '@digitalguide/domain';
import type { RecoveryDescriptor, RecoveryIssue } from '@digitalguide/contracts';
import { MemoryService, type PersonRow } from './memory-service.js';
import type { SessionRow } from './reception-service.js';
interface CredentialRow { id: string; person_id: string; tenant_id: string; workspace_id: string; token_hash: string; expires_at: string; revoked_at: string | null; used_at: string | null; environment: string; app_env: string }
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const equal = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export class MemoryRecoveryService {
  memory: MemoryService;
  constructor(public repo: Repository, public environment: string, public appEnv: string, private secret: string) { this.memory = new MemoryService(repo, environment, appEnv); }
  code(row: CredentialRow) { return 'DG1.' + row.id + '.' + createHmac('sha256', this.secret).update(['guest-memory-recovery-v1', row.id, row.person_id, row.environment, row.app_env].join(':')).digest('base64url'); }
  own(session: SessionRow): PersonRow {
    const person = this.memory.guest(session);
    if (!person || person.owner_user_id || person.guest_session_id !== session.id) throw new AppError('NOT_FOUND', '当前本人会话没有可恢复的访客资料。', 404);
    return person;
  }
  revoke(person: PersonRow) {
    this.repo.run("UPDATE memory_recovery_credentials SET revoked_at=COALESCE(revoked_at,?),token_hash='' WHERE person_id=?", new Date().toISOString(), person.id);
    this.memory.invalidate(person.id);
  }
  issue(session: SessionRow, version: number): RecoveryDescriptor {
    const person = this.own(session); this.memory.version(person, version); this.revoke(person);
    const row: CredentialRow = { id: randomUUID(), person_id: person.id, tenant_id: person.tenant_id, workspace_id: person.workspace_id, token_hash: '', expires_at: new Date(Math.min(Date.parse(person.expires_at), Date.now() + 30 * 86400000)).toISOString(), revoked_at: null, used_at: null, environment: this.environment, app_env: this.appEnv };
    this.repo.run('INSERT INTO memory_recovery_credentials(id,person_id,tenant_id,workspace_id,token_hash,expires_at,created_at,environment,app_env) VALUES (?,?,?,?,?,?,?,?,?)', row.id, person.id, person.tenant_id, person.workspace_id, hash(this.code(row)), row.expires_at, new Date().toISOString(), this.environment, this.appEnv);
    this.repo.run('UPDATE people SET version=version+1 WHERE id=?', person.id);
    this.repo.event(person.tenant_id, person.workspace_id, person.id, 'memory.recovery_issued', this.environment);
    return { personId: person.id, credentialId: row.id, expiresAt: row.expires_at };
  }
  reveal(session: SessionRow, descriptor: RecoveryDescriptor): RecoveryIssue {
    const person = this.own(session), row = this.repo.get<CredentialRow>('SELECT * FROM memory_recovery_credentials WHERE id=? AND person_id=? AND environment=? AND app_env=?', descriptor.credentialId, person.id, this.environment, this.appEnv);
    if (!row || row.revoked_at || row.used_at || row.expires_at <= new Date().toISOString() || descriptor.personId !== person.id) throw new AppError('DATA_REMOVED', '旧凭证已经失效，请明确生成新的恢复凭证。', 409);
    return { ...descriptor, recoveryCode: this.code(row) };
  }
  restore(session: SessionRow, code: string) {
    const unavailable = () => new AppError('RESTORE_UNAVAILABLE', '恢复凭证无效、已过期，或原会话尚未结束。请核对凭证或联系工作人员。', 409);
    if (this.repo.get("SELECT id FROM people WHERE guest_session_id=? AND status='active'", session.id)) throw new AppError('STATE_CONFLICT', '当前会话已有资料，不能自动覆盖或合并。', 409);
    const credential = this.repo.get<CredentialRow>('SELECT * FROM memory_recovery_credentials WHERE id=? AND tenant_id=? AND workspace_id=? AND environment=? AND app_env=?', code.split('.')[1], session.tenant_id, session.workspace_id, this.environment, this.appEnv);
    if (!credential || credential.revoked_at || credential.used_at || credential.expires_at <= new Date().toISOString() || !equal(credential.token_hash, hash(code)) || !equal(code, this.code(credential))) throw unavailable();
    const person = this.repo.get<PersonRow>("SELECT * FROM people WHERE id=? AND tenant_id=? AND workspace_id=? AND status='active' AND owner_user_id IS NULL AND identity_kind='self_reported' AND environment=? AND app_env=?", credential.person_id, session.tenant_id, session.workspace_id, this.environment, this.appEnv);
    if (!person || person.expires_at <= new Date().toISOString() || !person.guest_session_id) throw unavailable();
    const old = this.repo.get<SessionRow>('SELECT * FROM reception_sessions WHERE id=?', person.guest_session_id);
    if (!old || ['active', 'human'].includes(old.status)) throw unavailable();
    const now = new Date().toISOString(), expiresAt = new Date(Math.min(Date.parse(person.expires_at), Date.now() + 30 * 86400000)).toISOString();
    this.memory.invalidate(person.id, old.id);
    this.repo.run('UPDATE people SET guest_session_id=?,version=version+1,updated_at=? WHERE id=?', session.id, now, person.id);
    this.repo.run('INSERT INTO memory_session_links(session_id,person_id,focus_version,consent_at,transcript_expires_at) VALUES (?,?,?,?,?)', session.id, person.id, session.focus_version, now, expiresAt);
    this.revoke(person); this.repo.run('UPDATE memory_recovery_credentials SET used_at=? WHERE id=?', now, credential.id);
    this.repo.event(session.tenant_id, session.workspace_id, person.id, 'memory.restored', this.environment);
    return this.memory.view(this.repo.get<PersonRow>('SELECT * FROM people WHERE id=?', person.id)!);
  }
}

