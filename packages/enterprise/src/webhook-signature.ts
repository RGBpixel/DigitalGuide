import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
export const webhookBodyHash = (body: string | Buffer) => createHash('sha256').update(body).digest('hex');
export function webhookSignature(secret: string, timestamp: string, deliveryId: string, body: string | Buffer) {
  return 'v1=' + createHmac('sha256', secret).update('digitalguide-webhook-v1\n' + timestamp + '\n' + deliveryId + '\n' + webhookBodyHash(body)).digest('hex');
}
export function verifyWebhookSignature(input: { secret: string; timestamp: unknown; deliveryId: unknown; signature: unknown; body: string | Buffer; now?: number }) {
  const { secret, timestamp, deliveryId, signature, body } = input;
  const at = input.now ?? Date.now();
  if (!secret || !Number.isFinite(at) || typeof timestamp !== 'string' || !z.iso.datetime().safeParse(timestamp).success || typeof deliveryId !== 'string' || !z.uuid().safeParse(deliveryId).success || typeof signature !== 'string' || !/^v1=[a-f0-9]{64}$/.test(signature) || Buffer.byteLength(body) > 65536 || Math.abs(at - Date.parse(timestamp)) > 300000) return false;
  return timingSafeEqual(Buffer.from(signature.slice(3), 'hex'), Buffer.from(webhookSignature(secret, timestamp, deliveryId, body).slice(3), 'hex'));
}
