import type { FastifyInstance,FastifyRequest,FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Repository } from '@digitalguide/database';
import type { Principal } from '@digitalguide/domain';
import { contentDraftCreateInput,contentProjectDraftInput,contentDraftSaveInput,contentDraftForkInput,contentDraftRestoreInput,contentPlanCreateInput,contentPlanSaveInput,contentPlanApplyInput,contentPlanCancelInput } from '@digitalguide/contracts';
import { AppError } from '@digitalguide/domain';
import type { Config } from './config.js';
import { authenticatedSession } from './auth-check.js';
import { executeIdempotent } from './idempotency.js';
import { ContentDrafts } from './content-drafts.js';
import { ContentPlans } from './content-plans.js';
export function registerContentDraftRoutes(app:FastifyInstance,repo:Repository,config:Config){
  const d=new ContentDrafts(repo,config),plans=new ContentPlans(d),fresh=(req:FastifyRequest)=>authenticatedSession(repo,req,config).principal,id=z.uuid(),resource=(req:FastifyRequest)=>id.parse((req.params as {id:string}).id);
  const send=(req:FastifyRequest,reply:FastifyReply,data:unknown)=>reply.send({data,requestId:req.id});
  type Ref={id:string;workspaceId:string};
  function write(req:FastifyRequest,reply:FastifyReply,guard:(p:Principal)=>void,work:(p:Principal)=>Ref,view:(p:Principal,ref:Ref)=>unknown){
    repo.transaction(()=>guard(fresh(req)));
    const p=fresh(req),result=executeIdempotent(repo,req,p.tenantId,p.userId,()=>{const current=fresh(req);guard(current);const ref=work(current);repo.audit(current,ref.workspaceId,'content.'+req.routeOptions.url,ref.id,req.id);return ref;});
    return send(req,reply,repo.transaction(()=>{const current=fresh(req);guard(current);return view(current,result.data);}));
  }
  const draftView=(p:Principal,ref:Ref)=>d.view(p,d.row(p,ref.id)),planView=(p:Principal,ref:Ref)=>plans.view(p,plans.row(p,ref.id));
  app.get('/api/v1/studio/content/drafts',(req,reply)=>{
    const q=z.strictObject({workspaceId:id,cursor:id.optional(),limit:z.coerce.number().int().min(1).max(100).default(30),rootId:id.optional()}).parse(req.query),p=fresh(req);d.scope(p,q.workspaceId);
    const rows=repo.all<{id:string}>('SELECT id FROM studio_content_drafts WHERE tenant_id=? AND workspace_id=? AND environment=? AND app_env=? AND id>?'+(q.rootId?' AND root_id=?':'')+' ORDER BY id LIMIT ?',p.tenantId,q.workspaceId,config.providerMode,config.appEnv,q.cursor||'',...(q.rootId?[q.rootId]:[]),q.limit+1);
    return send(req,reply,{items:rows.slice(0,q.limit).map(r=>d.view(p,d.row(p,r.id))),nextCursor:rows.length>q.limit?rows[q.limit-1].id:null});
  });
  app.post('/api/v1/studio/content/drafts',async(req,reply)=>{
    const input=contentDraftCreateInput.parse(req.body),p=fresh(req);d.scope(p,input.workspaceId,true);const payload=await d.prepare(p,input);
    return write(req,reply,p=>{d.preparedCurrent(p,input.workspaceId,payload);},p=>({id:d.insert(p,input.workspaceId,payload),workspaceId:input.workspaceId}),draftView);
  });
  app.get('/api/v1/studio/content/drafts/:id',(req,reply)=>{const p=fresh(req);return send(req,reply,d.view(p,d.row(p,resource(req))));});
  app.post('/api/v1/studio/projects/:id/content-draft',(req,reply)=>{
    const input=contentProjectDraftInput.parse(req.body);
    return write(req,reply,p=>{d.projectDraftPayload(p,resource(req),input);},p=>({id:d.fromProject(p,resource(req),input),workspaceId:d.studio.project(p,resource(req)).workspace_id}),draftView);
  });
  app.post('/api/v1/studio/content/drafts/:id/save',(req,reply)=>{
    const input=contentDraftSaveInput.parse(req.body);
    return write(req,reply,p=>{d.current(p,d.row(p,resource(req),true));},p=>{const r=d.row(p,resource(req),true);return{id:d.save(p,r,input),workspaceId:r.workspace_id};},draftView);
  });
  app.post('/api/v1/studio/content/drafts/:id/fork',(req,reply)=>{
    const input=contentDraftForkInput.parse(req.body);
    return write(req,reply,p=>{d.current(p,d.row(p,resource(req),true));},p=>{const r=d.row(p,resource(req),true);d.studio.version(r,input.version);const payload=d.current(p,r,true);return{id:d.insert(p,r.workspace_id,{...payload,name:input.name},r),workspaceId:r.workspace_id};},draftView);
  });
  app.get('/api/v1/studio/content/drafts/:id/versions',(req,reply)=>{
    const p=fresh(req),r=d.row(p,resource(req));
    return send(req,reply,repo.all<{version:number;payload:string;createdAt:string}>('SELECT version,payload,created_at AS createdAt FROM studio_content_draft_versions WHERE draft_id=? ORDER BY version DESC',r.id).map(v=>{const payload=d.payload({...r,payload:v.payload}),sourceReason=d.sourceReason(p,r,payload);return{version:v.version,createdAt:v.createdAt,payload:sourceReason?null:payload,sourceReason};}));
  });
  app.post('/api/v1/studio/content/drafts/:id/restore',(req,reply)=>{
    const input=contentDraftRestoreInput.parse(req.body);
    return write(req,reply,p=>{d.current(p,d.row(p,resource(req),true));},p=>{const r=d.row(p,resource(req),true);d.studio.version(r,input.version);const old=repo.get<{payload:string}>('SELECT payload FROM studio_content_draft_versions WHERE draft_id=? AND version=?',r.id,input.revision);if(!old)throw new AppError('NOT_FOUND','草稿历史修订不存在。',404);const payload=d.payload({...r,payload:old.payload}),reason=d.sourceReason(p,r,payload);if(reason)throw new AppError('CONTENT_SOURCE_UNAVAILABLE',reason,409);return{id:d.commit(p,r,payload),workspaceId:r.workspace_id};},draftView);
  });
  app.get('/api/v1/studio/content/drafts/:id/plans',(req,reply)=>{
    const p=fresh(req),r=d.row(p,resource(req));return send(req,reply,repo.all<{id:string}>('SELECT id FROM studio_content_plans WHERE draft_id=? ORDER BY created_at DESC,rowid DESC',r.id).map(x=>plans.view(p,plans.row(p,x.id))));
  });
  app.post('/api/v1/studio/content/drafts/:id/plans',(req,reply)=>{
    const input=contentPlanCreateInput.parse(req.body);
    return write(req,reply,p=>{plans.prepare(p,d.row(p,resource(req),true),input);},p=>{const r=d.row(p,resource(req),true);return{id:plans.create(p,r,input),workspaceId:r.workspace_id};},planView);
  });
  app.get('/api/v1/studio/content/plans/:id',(req,reply)=>{const p=fresh(req);return send(req,reply,plans.view(p,plans.row(p,resource(req))));});
  app.post('/api/v1/studio/content/plans/:id/save',(req,reply)=>{
    const input=contentPlanSaveInput.parse(req.body);
    return write(req,reply,p=>{plans.current(p,plans.row(p,resource(req),true));},p=>{const r=plans.row(p,resource(req),true);return{id:plans.save(p,r,input),workspaceId:r.workspace_id};},planView);
  });
  app.post('/api/v1/studio/content/plans/:id/apply',(req,reply)=>{
    const input=contentPlanApplyInput.parse(req.body);
    return write(req,reply,p=>{plans.current(p,plans.row(p,resource(req),true));},p=>{const r=plans.row(p,resource(req),true);return{id:plans.apply(p,r,input.version,input.planHash),workspaceId:r.workspace_id};},planView);
  });
  app.post('/api/v1/studio/content/plans/:id/cancel',(req,reply)=>{
    const input=contentPlanCancelInput.parse(req.body);
    return write(req,reply,p=>{plans.row(p,resource(req),true);},p=>{const r=plans.row(p,resource(req),true);return{id:plans.cancel(p,r,input.version),workspaceId:r.workspace_id};},planView);
  });
  app.get('/api/v1/studio/content/plans/:id/versions',(req,reply)=>{
    const p=fresh(req),r=plans.row(p,resource(req)),sourceReason=plans.sourceReason(p,r);
    return send(req,reply,repo.all<{version:number;snapshot:string;planHash:string;createdAt:string}>('SELECT version,snapshot,plan_hash AS planHash,created_at AS createdAt FROM studio_content_plan_versions WHERE plan_id=? ORDER BY version DESC',r.id).map(v=>({version:v.version,createdAt:v.createdAt,planHash:v.planHash,patches:sourceReason?null:plans.snapshot({...r,snapshot:v.snapshot}).patches,sourceReason})));
  });
}
