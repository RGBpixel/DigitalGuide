import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify';
import type {Repository} from '@digitalguide/database';
import {AppError} from '@digitalguide/domain';
import {enterpriseScopeInput,enterprisePlanAssignInput,enterpriseSeatInput} from '../../../packages/contracts/src/enterprise-plans.js';
import {EnterprisePlanService} from './enterprise-plan-service.js';
import {executeIdempotent} from './idempotency.js';
import {authenticatedSession} from './auth-check.js';
import type {Config} from './config.js';
export function registerEnterprisePlanRoutes(app:FastifyInstance,repo:Repository,config:Config,send:(req:FastifyRequest,reply:FastifyReply,data:unknown)=>unknown){
 const service=new EnterprisePlanService(repo,config);
 app.get('/api/v1/enterprise/plans',(req,reply)=>{const p=authenticatedSession(repo,req,config).principal,{workspaceId}=enterpriseScopeInput.parse(req.query);return send(req,reply.header('Cache-Control','private, no-store'),repo.transaction(()=>service.view(p,workspaceId)));});
 for(const action of ['assign','seats'] as const)app.post('/api/v1/enterprise/plans/'+action,(req,reply)=>{
  const{principal:p,csrfToken}=authenticatedSession(repo,req,config);if(req.headers['x-csrf-token']!==csrfToken)throw new AppError('FORBIDDEN','安全凭证已失效，请刷新后重试。',403);
  const input=action==='assign'?enterprisePlanAssignInput.parse(req.body):enterpriseSeatInput.parse(req.body);service.scope(p,input.workspaceId,true);
  const result=executeIdempotent(repo,req,p.tenantId,p.userId,()=>action==='assign'?service.assign(p,enterprisePlanAssignInput.parse(input),req.id):service.seat(p,enterpriseSeatInput.parse(input),req.id));
  return send(req,reply,{receiptId:result.data,view:repo.transaction(()=>service.view(p,input.workspaceId))});
 });
}
