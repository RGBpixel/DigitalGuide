import {identitySessionQuery,assertIdentitySession} from '../../../packages/enterprise/src/identity-session.js';
import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { Repository } from '@digitalguide/database';
import { AppError } from '@digitalguide/domain';
import type { Config } from './config.js';
export function authenticatedSession(repo: Repository, req: FastifyRequest, config: Config) {
  const unsigned = req.cookies.dg_session ? req.unsignCookie(req.cookies.dg_session) : null;
  const session = unsigned?.valid ? repo.get<{ user_id: string; csrf_token: string }>('SELECT user_id,csrf_token FROM auth_sessions WHERE token_hash=? AND expires_at>? AND environment=? AND app_env=?', createHash('sha256').update(unsigned.value!).digest('hex'), new Date().toISOString(), config.providerMode, config.appEnv) : null;
  if (!session) throw new AppError('AUTH_REQUIRED', '请先登录演示工作空间。', 401);
  const principal={...repo.principal(session.user_id),environment:config.providerMode,appEnv:config.appEnv};
  if(repo.get("SELECT 1 FROM sqlite_master WHERE type='table' AND name='enterprise_identity_session_origins'"))assertIdentitySession(repo.get(identitySessionQuery,createHash('sha256').update(unsigned!.value!).digest('hex')),{...principal,environment:config.providerMode,appEnv:config.appEnv},repo.identityFingerprints);
  return {principal,csrfToken:session.csrf_token};
}
