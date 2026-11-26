import { canonical } from '../../domain/src/index.js';
import { webhookLeaseSchema, webhookWireSchema, type WebhookLease, type WebhookResult } from '../../contracts/src/developer-webhooks.js';
import type { IdentityWorkflow } from './identity-workflows.js';
import { WebhookRuntime } from './webhook-runtime.js';
import { WebhookQueue } from './webhook-queue.js';
import { webhookBodyHash } from './webhook-signature.js';
import { sendWebhook } from './webhook-transport.js';
export interface WebhookStore { run<T>(workflow: IdentityWorkflow<T>): T | Promise<T> }
export async function dispatchWebhook(store: WebhookStore, queue: WebhookQueue, runtime: WebhookRuntime, options: { allowExternal?: boolean; signal?: AbortSignal; onClaim?: (lease: WebhookLease) => void | Promise<void> } = {}) {
  const raw = await store.run(queue.claim()); if (!raw) return { result: 'idle' as const };
  await options.onClaim?.(raw);
  const identity = { id: raw.id, leaseToken: raw.leaseToken }, parsed = webhookLeaseSchema.safeParse(raw);
  let result: WebhookResult;
  if (!parsed.success || parsed.data.event.id !== raw.eventId || ['tenantId', 'workspaceId', 'environment', 'appEnv'].some(field => Reflect.get(parsed.data.event, field) !== Reflect.get(parsed.data, field))) result = { outcome: 'blocked', code: 'PAYLOAD_INVALID', httpStatus: null, retryAfterSeconds: 0 };
  else {
    const lease = parsed.data, body = canonical(webhookWireSchema.parse({ event: lease.event, applicationId: lease.applicationId, subscriptionId: lease.subscriptionId }));
    let destination;
    try { destination = runtime.current(lease.destinationId); } catch { result = { outcome: 'blocked', code: 'CONFIG_REQUIRED', httpStatus: null, retryAfterSeconds: 0 }; return { result: 'processed' as const, deliveryId: raw.id, ...await store.run(queue.finish(identity, result)) }; }
    if (destination.tenantId !== lease.tenantId || destination.workspaceId !== lease.workspaceId) result = { outcome: 'blocked', code: 'CONFIG_CHANGED', httpStatus: null, retryAfterSeconds: 0 };
    else {
      const ready = await store.run(queue.ready(identity, destination.fingerprint, webhookBodyHash(body)));
      if (!ready.ready) return { result: 'processed' as const, deliveryId: raw.id, recorded: true, status: ready.status, code: ready.code };
      result = await sendWebhook(runtime.host, destination, lease.id, body, options);
    }
  }
  return { result: 'processed' as const, deliveryId: raw.id, ...await store.run(queue.finish(identity, result)) };
}
