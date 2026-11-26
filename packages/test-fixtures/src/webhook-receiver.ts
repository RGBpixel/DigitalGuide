import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { webhookWireSchema } from '../../contracts/src/developer-webhooks.js';
import { verifyWebhookSignature, webhookBodyHash } from '../../enterprise/src/webhook-signature.js';
export type ReceiverMode = 'accept' | 'retry' | 'reject' | 'redirect' | 'drop' | 'hold';
export interface ReceiverObservation { deliveryId: string; eventId: string | null; bodySHA256: string; authenticated: boolean; sessionAuthorizationPresent: boolean; duplicate: boolean; mode: ReceiverMode; receivedAt: string; body: string }
export async function webhookReceiver(secret: () => string, options: {port?: number} = {}) {
  let mode: ReceiverMode = 'accept', redirectHits = 0;
  const observations: ReceiverObservation[] = [], applied = new Set<string>(), held = new Set<http.ServerResponse>();
  const server = http.createServer(async (request, response) => {
    if (request.url === '/redirect-target') { redirectHits++; response.writeHead(204).end(); return; }
    if (request.url !== '/callback' || request.method !== 'POST') { response.writeHead(404).end(); return; }
    try {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of request) { const bytes = Buffer.from(chunk); size += bytes.length; if (size > 65536) { response.writeHead(413).end(); return; } chunks.push(bytes); }
      const bytes = Buffer.concat(chunks), body = bytes.toString('utf8'), deliveryId = String(request.headers['x-digitalguide-delivery'] ?? ''), authenticated = verifyWebhookSignature({ secret: secret(), timestamp: request.headers['x-digitalguide-timestamp'], deliveryId, signature: request.headers['x-digitalguide-signature'], body: bytes });
      let eventId: string | null = null; try { eventId = webhookWireSchema.parse(JSON.parse(body)).event.id; } catch { /* Invalid payloads are rejected without logging request bodies. */ }
      const duplicate = applied.has(deliveryId), record: ReceiverObservation = { deliveryId, eventId, bodySHA256: webhookBodyHash(bytes), authenticated, sessionAuthorizationPresent: !!request.headers.cookie || !!request.headers.authorization, duplicate, mode, receivedAt: new Date().toISOString(), body };
      observations.push(record);
      if (!authenticated || !eventId || request.headers['idempotency-key'] !== deliveryId) { response.writeHead(401).end(); return; }
      if (['accept', 'drop', 'hold'].includes(mode)) applied.add(deliveryId);
      if (mode === 'drop') { request.socket.destroy(); return; }
      if (mode === 'hold') { held.add(response); response.on('close', () => held.delete(response)); return; }
      if (mode === 'redirect') { response.writeHead(307, { location: '/redirect-target' }).end(); return; }
      if (mode === 'retry') { response.writeHead(429, { 'retry-after': '1' }).end(); return; }
      response.writeHead(mode === 'reject' ? 422 : 204).end();
    } catch { if (!response.headersSent) response.writeHead(400).end(); else response.destroy(); }
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000;
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 0, '127.0.0.1', resolve); });
  const port = (server.address() as AddressInfo).port;
  return {
    port, url: 'http://127.0.0.1:' + port + '/callback', observations, applied,
    setMode: (value: ReceiverMode) => { mode = value; }, get redirectHits() { return redirectHits; },
    release: () => { for (const response of held) response.writeHead(204).end(); held.clear(); },
    waitForCount: async (count: number) => { const until = Date.now() + 5000; while (observations.length < count && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 15)); if (observations.length < count) throw new Error('Owned webhook receiver did not observe the expected request'); },
    close: async () => { for (const response of held) response.destroy(); held.clear(); await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }); }
  };
}
