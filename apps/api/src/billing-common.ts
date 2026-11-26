import { createHmac } from 'node:crypto';
import { canonical } from '@digitalguide/domain';
import type { Config } from './config.js';
import type { FinancialQuoteRow } from './billing-types.js';
export function financialToken(config:Config,q:FinancialQuoteRow){return createHmac('sha256',config.sessionSecret).update(canonical({purpose:'financial-confirm-v1',environment:config.providerMode,appEnv:config.appEnv,id:q.id,hash:q.hash,kind:q.kind,actor:q.actor_id,session:q.session_id,focus:q.focus_version,expires:q.expires_at})).digest('base64url');}
