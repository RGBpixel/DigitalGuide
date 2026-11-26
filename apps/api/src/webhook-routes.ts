import { z } from 'zod';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { webhookScopeInput, webhookListInput, webhookCreateInput, webhookControlInput, webhookDeliveryInput, webhookMutationResultSchema, type WebhookMutation } from '../../../packages/contracts/src/developer-webhooks.js';
import type { DeveloperStore, DeveloperAuthorized } from './developer-routes.js';
import type { WebhookWorkflows } from '../../../packages/enterprise/src/webhook-workflows.js';
export function webhookMutation(action: WebhookMutation['action'], body: unknown): WebhookMutation {
  if (action === 'create') return { action, input: webhookCreateInput.parse(body) };
  if (action === 'control') return { action, input: webhookControlInput.parse(body) };
  return { action, input: webhookDeliveryInput.parse(body) };
}
export function registerWebhookRoutes(app: FastifyInstance, workflow: WebhookWorkflows, store: DeveloperStore, authorized: DeveloperAuthorized, send: (req: FastifyRequest, reply: FastifyReply, data: unknown) => unknown) {
  app.get('/api/v1/enterprise/webhooks', async (req, reply) => send(req, reply, await authorized(req, false, p => store.run(workflow.view(p, webhookScopeInput.parse(req.query).workspaceId)))));
  app.get('/api/v1/enterprise/webhooks/deliveries', async (req, reply) => send(req, reply, await authorized(req, false, p => store.run(workflow.deliveries(p, webhookListInput.parse(req.query))))));
  for (const action of ['create', 'control', 'test', 'retry'] as const) app.post('/api/v1/enterprise/webhooks/' + action, async (req, reply) => {
    const mutation = webhookMutation(action, req.body), key = z.string().min(8).max(128).parse(req.headers['idempotency-key']);
    return send(req, reply, webhookMutationResultSchema.parse(await authorized(req, true, p => store.run(workflow.mutation(p, mutation, key)))));
  });
}
