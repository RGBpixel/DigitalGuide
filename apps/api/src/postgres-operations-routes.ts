import {requirePermission,requireWorkspace} from '@digitalguide/domain';
import {operationsMetricsQuery} from '../../../packages/contracts/src/operations.js';
import {operationsAggregateQuery,assembleOperationsMetrics,type OperationsRawRow,type OperationsScope} from '../../../packages/operations/src/metrics.js';
import type {RouteContext} from './postgres-asset-routes.js';
export function registerNativeOperationsRoutes({app,repo,authenticated,send}:RouteContext){
 app.get('/api/v1/operations-metrics',async(req,reply)=>send(req,reply.header('Cache-Control','private, no-store'),await authenticated(req,async({principal:p})=>{requirePermission(p,'operations.read');const q=operationsMetricsQuery.parse(req.query);requireWorkspace(p,q.workspaceId);await repo.workspaceLock(p,q.workspaceId);const context:OperationsScope={principal:p,environment:'mock',appEnv:repo.db.config.appEnv,database:'postgres',capturedAt:await repo.db.now()},query=operationsAggregateQuery(q,context),rows=(await repo.db.query<OperationsRawRow>(query.sql,query.parameters)).rows;return assembleOperationsMetrics(q,context,rows);}))); 
}
