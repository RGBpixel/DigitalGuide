import {z} from 'zod';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {Repository} from '@digitalguide/database';
import {AppError} from '@digitalguide/domain';
import {aeMediaInput,aeMediaCreate,aeMediaConfirm} from '@digitalguide/contracts';
import type {Config} from './config.js';
import {authenticatedSession} from './auth-check.js';
import {executeIdempotent} from './idempotency.js';
import {AeMediaAdoptions} from './ae-media-adoptions.js';
export function registerAeMediaRoutes(app:FastifyInstance,repo:Repository,config:Config){
 const s=new AeMediaAdoptions(repo,config),fresh=(req:FastifyRequest)=>authenticatedSession(repo,req,config).principal,key=(req:FastifyRequest)=>z.uuid().parse((req.params as {id:string}).id);
 app.post('/api/v1/studio/ae-artifacts/:id/media-plan',async(req,reply)=>{const input=aeMediaInput.parse(req.body),prepared=await s.prepare(fresh(req),key(req),input),p=fresh(req);s.scope(p,prepared.plan.workspaceId,true);return reply.send({data:prepared.plan,requestId:req.id});});
 app.post('/api/v1/studio/ae-artifacts/:id/media-adoptions',async(req,reply)=>{
  const body=aeMediaCreate.parse(req.body),planHash=body.planHash,input={version:body.version,name:body.name,rightsNote:body.rightsNote,expiresAt:body.expiresAt},p=fresh(req),prepared=await s.prepare(p,key(req),input);
  if(planHash!==prepared.plan.hash)throw new AppError('AE_MEDIA_PLAN_CHANGED','AE固定来源或采用条件已变化，请重新审阅计划。',409);
  const result=executeIdempotent<{id:string}>(repo,req,p.tenantId,p.userId,()=>{const actor=fresh(req);s.scope(actor,prepared.plan.workspaceId,true);const id=s.create(actor,input,prepared);repo.audit(actor,prepared.plan.workspaceId,'studio.ae_media_queued',id,req.id);return{id};});
  const actor=fresh(req),row=s.row(actor,result.data.id);s.scope(actor,row.workspace_id,true);s.current(actor,row);return reply.send({data:s.view(actor,row),requestId:req.id});
 });
 app.get('/api/v1/studio/ae-artifacts/:id/media-adoption',(req,reply)=>{const p=fresh(req),a=repo.get<{job_id:string}>('SELECT job_id FROM ae_render_artifacts WHERE id=?',key(req));if(!a)throw new AppError('NOT_FOUND','此AE结果不存在。',404);const j=repo.get<{batch_id:string}>('SELECT batch_id FROM ae_render_jobs WHERE id=?',a.job_id)!;s.ae.batch(p,j.batch_id);const existing=repo.get<{id:string}>('SELECT id FROM ae_media_adoptions WHERE artifact_id=?',key(req));return reply.send({data:existing?s.view(p,s.row(p,existing.id)):null,requestId:req.id});});
 app.get('/api/v1/studio/ae-media-adoptions/:id',(req,reply)=>{const p=fresh(req);return reply.send({data:s.view(p,s.row(p,key(req))),requestId:req.id});});
 for(const action of ['cancel','retry','withdraw']as const)app.post('/api/v1/studio/ae-media-adoptions/:id/'+action,(req,reply)=>{const input=aeMediaConfirm.parse(req.body),p=fresh(req),row=s.row(p,key(req));s.scope(p,row.workspace_id,true);const result=executeIdempotent<{id:string}>(repo,req,p.tenantId,p.userId,()=>{const actor=fresh(req),r=s.row(actor,row.id);s[action](actor,r,input.version);repo.audit(actor,r.workspace_id,'studio.ae_media_'+action,r.id,req.id);return{id:r.id};});const actor=fresh(req),current=s.row(actor,result.data.id);s.scope(actor,current.workspace_id,true);return reply.send({data:s.view(actor,current),requestId:req.id});});
}
