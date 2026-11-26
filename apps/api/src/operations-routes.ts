import type {FastifyInstance,FastifyReply,FastifyRequest} from 'fastify';
import type {Repository} from '@digitalguide/database';
import {AppError,requirePermission,requireWorkspace} from '@digitalguide/domain';
import {operationsMetricsQuery} from '../../../packages/contracts/src/operations.js';
import {operationsAggregateQuery,assembleOperationsMetrics,type OperationsRawRow,type OperationsScope} from '../../../packages/operations/src/metrics.js';
import {authenticatedSession} from './auth-check.js';
import type {Config} from './config.js';
export function registerOperationsRoutes(app:FastifyInstance,repo:Repository,config:Config,send:(req:FastifyRequest,reply:FastifyReply,data:unknown)=>unknown){
 app.get('/api/v1/operations-metrics',(req,reply)=>{const p=authenticatedSession(repo,req,config).principal;requirePermission(p,'operations.read');const q=operationsMetricsQuery.parse(req.query);requireWorkspace(p,q.workspaceId);if(!repo.get('SELECT 1 FROM workspaces WHERE id=? AND tenant_id=?',q.workspaceId,p.tenantId))throw new AppError('NOT_FOUND','工作空间不存在或已撤回，请重新选择。',404);const context:OperationsScope={principal:p,environment:config.providerMode,appEnv:config.appEnv,database:'sqlite',capturedAt:new Date().toISOString()},query=operationsAggregateQuery(q,context),rows=repo.all<OperationsRawRow>(query.sql,...query.parameters);return send(req,reply.header('Cache-Control','private, no-store'),assembleOperationsMetrics(q,context,rows));});
}
