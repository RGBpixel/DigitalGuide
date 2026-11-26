import {registerDeveloperStudioRoutes} from './developer-studio-routes.js';
import {DeveloperStudioWorkflows} from '../../../packages/enterprise/src/developer-studio-workflows.js';
import type {DeveloperStudioAdapter} from './developer-studio-ports.js';
import {registerWebhookRoutes} from './webhook-routes.js';
import {WebhookWorkflows} from '../../../packages/enterprise/src/webhook-workflows.js';
import type {WebhookRuntime} from '../../../packages/enterprise/src/webhook-runtime.js';
import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError, type Principal } from '@digitalguide/domain';
import { developerScopeInput, developerCreateInput, developerControlInput, developerIssueInput, developerRevokeInput, developerPageInput, developerContextSchema, developerProjectSchema, developerProjectPageSchema, developerExportSchema, developerExportPageSchema, developerMutationResultSchema, type DeveloperMutation, type DeveloperResource } from '../../../packages/contracts/src/developer-access.js';
import type { IdentityWorkflow } from '../../../packages/enterprise/src/identity-workflows.js';
import type { DeveloperWorkflows } from '../../../packages/enterprise/src/developer-workflows.js';
import { parseDeveloperAuthorization } from '../../../packages/enterprise/src/developer-credentials.js';
export interface DeveloperStore { run<T>(workflow: IdentityWorkflow<T>): T | Promise<T> }
export type DeveloperAuthorized = <T>(req: FastifyRequest, write: boolean, work: (p: Principal) => T | Promise<T>) => T | Promise<T>;
export function developerMutation(action: DeveloperMutation['action'], body: unknown): DeveloperMutation {
  switch (action) {
    case 'create': return { action, input: developerCreateInput.parse(body) };
    case 'control': return { action, input: developerControlInput.parse(body) };
    case 'issue': return { action, input: developerIssueInput.parse(body) };
    case 'revoke': return { action, input: developerRevokeInput.parse(body) };
  }
}
export function registerDeveloperRoutes(app: FastifyInstance, workflow: DeveloperWorkflows, store: DeveloperStore, authorized: DeveloperAuthorized, send: (req: FastifyRequest, reply: FastifyReply, data: unknown) => unknown, webhookRuntime?: WebhookRuntime, studioFactory?: (workflow:DeveloperStudioWorkflows)=>DeveloperStudioAdapter) {
  if(studioFactory){const studio=new DeveloperStudioWorkflows(workflow);registerDeveloperStudioRoutes(app,studio,store,authorized,send,studioFactory(studio));}
  if (webhookRuntime) registerWebhookRoutes(app,new WebhookWorkflows(workflow,webhookRuntime),store,authorized,send);
  app.get('/api/v1/enterprise/developers', async (req, reply) => send(req, reply, await authorized(req, false, p => store.run(workflow.view(p, developerScopeInput.parse(req.query).workspaceId)))));
  for (const action of ['create', 'control', 'issue', 'revoke'] as const) app.post('/api/v1/enterprise/developers/' + action, async (req, reply) => {
    const mutation = developerMutation(action, req.body), key = z.string().min(8).max(128).parse(req.headers['idempotency-key']);
    const result = await authorized(req, true, p => store.run(workflow.mutation(p, mutation, key)));
    return send(req, reply.header('Cache-Control', 'no-store').header('Pragma', 'no-cache'), developerMutationResultSchema.parse(result));
  });
  for (const [pathname, resource, schema] of [
    ['/context', 'context', developerContextSchema], ['/projects', 'projects.list', developerProjectPageSchema], ['/projects/:id', 'projects.get', developerProjectSchema], ['/exports', 'exports.list', developerExportPageSchema], ['/exports/:id', 'exports.get', developerExportSchema]
  ] as const) app.get('/api/open/v1' + pathname, async (req, reply) => {
    const page = resource === 'context' ? (z.strictObject({}).parse(req.query), { limit: 20 }) : developerPageInput.parse(req.query);
    const target = resource.endsWith('.get') ? z.strictObject({ id: z.uuid() }).parse(req.params).id : undefined;
    const result = await store.run(workflow.gateway(parseDeveloperAuthorization(req.headers.authorization), resource as DeveloperResource, page, target));
    if ('error' in result) {
      const messages = { DEVELOPER_AUTH_REQUIRED: '应用凭证无效、已到期或已撤销，请联系管理员签发当前环境凭证。', DEVELOPER_SCOPE_REQUIRED: '应用未获此读取范围，请联系管理员核对应用授权。', DEVELOPER_RATE_LIMIT: '该凭证本分钟请求已达上限，请稍后重试。', NOT_FOUND: '记录不存在或不属于该应用的空间和环境。' };
      if (result.error.status === 429) reply.header('Retry-After', '60');
      throw new AppError(result.error.code, messages[result.error.code], result.error.status);
    }
    return send(req, reply, schema.parse(result.data));
  });
}
