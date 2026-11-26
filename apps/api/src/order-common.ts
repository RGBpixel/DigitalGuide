import { createHash, createHmac } from 'node:crypto';
import { canonical } from '@digitalguide/domain';
import type { Config } from './config.js';
import type { QuoteRow } from './order-types.js';
export const orderNow = () => new Date().toISOString();
export const orderHash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
export function orderToken(config: Config, q: QuoteRow) {
 return createHmac('sha256', config.sessionSecret).update(canonical({ purpose:'order-confirm-v1', env:config.providerMode, app:config.appEnv, id:q.id, hash:q.hash, actor:q.actor_id, session:q.session_id, focus:q.focus_version, expires:q.expires_at })).digest('base64url');
}
