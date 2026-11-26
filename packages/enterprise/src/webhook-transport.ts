import http from 'node:http';
import https from 'node:https';
import type { WebhookDestination, WebhookHost } from './webhook-runtime.js';
import type { WebhookResult } from '../../contracts/src/developer-webhooks.js';
import { webhookSignature } from './webhook-signature.js';
export async function sendWebhook(host: Pick<WebhookHost, 'providerMode' | 'appEnv'>, destination: WebhookDestination, deliveryId: string, body: string, options: { allowExternal?: boolean; signal?: AbortSignal } = {}): Promise<WebhookResult> {
  if (Buffer.byteLength(body) > 65536) return { outcome: 'blocked', code: 'PAYLOAD_INVALID', httpStatus: null, retryAfterSeconds: 0 };
  let url: URL;
  try { url = new URL(destination.url); if (!['local_test', 'https'].includes(destination.mode) || url.username || url.password || url.search || url.hash || destination.mode === 'local_test' && (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname)) || destination.mode === 'https' && url.protocol !== 'https:') throw new Error(); } catch { return { outcome: 'blocked', code: 'CONFIG_REQUIRED', httpStatus: null, retryAfterSeconds: 0 }; }
  if (destination.mode === 'https' && (!options.allowExternal || host.providerMode === 'mock')) return { outcome: 'blocked', code: 'EXTERNAL_NOT_AUTHORIZED', httpStatus: null, retryAfterSeconds: 0 };
  if (destination.mode === 'local_test' && (host.providerMode !== 'mock' || host.appEnv === 'production')) return { outcome: 'blocked', code: 'CONFIG_REQUIRED', httpStatus: null, retryAfterSeconds: 0 };
  const timestamp = new Date().toISOString(), signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000);
  return new Promise(resolve => {
    let settled = false; const finish = (result: WebhookResult) => { if (!settled) { settled = true; resolve(result); } };
    const request = (url.protocol === 'https:' ? https : http).request(url, { method: 'POST', agent: false, signal, maxHeaderSize: 8192, ...(url.protocol === 'https:' ? { rejectUnauthorized: true, minVersion: 'TLSv1.2' as const } : {}), headers: { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'user-agent': 'DigitalGuide-Webhooks/1', 'x-digitalguide-delivery': deliveryId, 'x-digitalguide-timestamp': timestamp, 'x-digitalguide-signature': webhookSignature(destination.secret, timestamp, deliveryId, body), 'idempotency-key': deliveryId } }, response => {
      const status = response.statusCode ?? 0; response.destroy();
      if (status < 100 || status > 599) { finish({ outcome: 'unknown', code: 'TRANSPORT_UNCERTAIN', httpStatus: null, retryAfterSeconds: 0 }); return; }
      if (status >= 200 && status < 300) finish({ outcome: 'accepted', code: 'HTTP_ACCEPTED', httpStatus: status, retryAfterSeconds: 0 });
      else if (status >= 300 && status < 400) finish({ outcome: 'rejected', code: 'REDIRECT_BLOCKED', httpStatus: status, retryAfterSeconds: 0 });
      else if (status === 429 || status >= 500) { const retry = Number(response.headers['retry-after']); finish({ outcome: 'retryable', code: 'HTTP_RETRYABLE', httpStatus: status, retryAfterSeconds: Number.isInteger(retry) && retry > 0 ? Math.min(retry, 3600) : 0 }); }
      else finish({ outcome: 'rejected', code: 'HTTP_REJECTED', httpStatus: status >= 100 ? status : null, retryAfterSeconds: 0 });
    });
    request.on('error', () => finish({ outcome: 'unknown', code: 'TRANSPORT_UNCERTAIN', httpStatus: null, retryAfterSeconds: 0 })); request.end(body);
  });
}
