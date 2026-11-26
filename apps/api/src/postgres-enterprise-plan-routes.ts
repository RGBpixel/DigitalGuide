import {z} from 'zod';
import {enterpriseScopeInput,enterprisePlanAssignInput,enterpriseSeatInput} from '../../../packages/contracts/src/enterprise-plans.js';
import {NativeEnterprisePlanService} from '../../../packages/postgres/src/runtime-enterprise-plans.js';
import type {RouteContext} from './postgres-asset-routes.js';
export function registerNativeEnterprisePlanRoutes({app,repo,authenticated,send}:RouteContext){
 const service=new NativeEnterprisePlanService(repo);
 app.get('/api/v1/enterprise/plans',async(req,reply)=>send(req,reply.header('Cache-Control','private, no-store'),await authenticated(req,async({principal:p})=>service.view(p,enterpriseScopeInput.parse(req.query).workspaceId))));
 for(const action of ['assign','seats'] as const)app.post('/api/v1/enterprise/plans/'+action,async(req,reply)=>send(req,reply,await authenticated(req,async({principal:p})=>{
  const input=action==='assign'?enterprisePlanAssignInput.parse(req.body):enterpriseSeatInput.parse(req.body),key=z.string().min(8).max(128).parse(req.headers['idempotency-key']);await service.scope(p,input.workspaceId,true);
  const receiptId=await repo.idempotentResource(p,{action:'POST /api/v1/enterprise/plans/'+action,key,body:input,code:200},()=>action==='assign'?service.assign(p,enterprisePlanAssignInput.parse(input),req.id):service.seat(p,enterpriseSeatInput.parse(input),req.id));
  return{receiptId,view:await service.view(p,input.workspaceId)};
 })));
}
