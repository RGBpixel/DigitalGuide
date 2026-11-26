import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
export const developerCredentialPrefix = (id: string) => 'dgk_' + id.slice(0, 8) + '…';
export const developerCredentialHash = (id: string, secret: string) => createHash('sha256').update('digitalguide-developer-v1\0' + id + '\0' + secret).digest('hex');
export function createDeveloperCredential() { const id = randomUUID(), secret = randomBytes(32).toString('hex'); return { id, token: 'dgk_' + id + '.' + secret, hash: developerCredentialHash(id, secret) }; }
export function parseDeveloperAuthorization(value: unknown) {
  if (typeof value !== 'string') return null;
  const match = /^Bearer dgk_([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([0-9a-f]{64})$/.exec(value);
  return match ? { id: match[1], hash: developerCredentialHash(match[1], match[2]) } : null;
}
export function developerHashMatches(actual: unknown, expected: string) { return typeof actual === 'string' && /^[0-9a-f]{64}$/.test(actual) && timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex')); }
