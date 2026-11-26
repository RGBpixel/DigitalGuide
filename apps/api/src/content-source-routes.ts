import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Repository } from '@digitalguide/database';
import { contentSourceInput, contentSourceWithdrawInput, contentBriefConfig, contentBriefInput, contentBriefSaveInput } from '@digitalguide/contracts';
import type { Principal } from '@digitalguide/domain';
import type { Config } from './config.js';
import {ContentWriting} from './content-writing.js';
import { authenticatedSession } from './auth-check.js';
import { executeIdempotent } from './idempotency.js';
import { ContentSources } from './content-sources.js';
import {systemAsrRecognizers} from '../../../packages/providers/src/system-asr.js';
export function registerContentSourceRoutes(app:FastifyInstance,repo:Repository,config:Config) {
  const service=new ContentSources(repo,config),id=z.uuid(),fresh=(req:FastifyRequest)=>authenticatedSession(repo,req,config).principal,resource=(req:FastifyRequest)=>id.parse((req.params as {id:string}).id);
  const send=(req:FastifyRequest,reply:FastifyReply,data:unknown)=>reply.send({data,requestId:req.id});
  function write(req:FastifyRequest,reply:FastifyReply,guard:(p:Principal)=>void,work:(p:Principal)=>{id:string;workspaceId:string},view:(p:Principal,id:string)=>unknown) {
    repo.transaction(()=>guard(fresh(req)));
    const p=fresh(req),result=executeIdempotent(repo,req,p.tenantId,p.userId,()=>{
      const current=fresh(req);guard(current);const reference=work(current);
      repo.audit(current,reference.workspaceId,'content.'+req.routeOptions.url,reference.id,req.id);return reference;
    });
    return send(req,reply,repo.transaction(()=>{const current=fresh(req);guard(current);return view(current,result.data.id);}));
  }
  function query(req:FastifyRequest) {
    const q=z.strictObject({workspaceId:id,cursor:id.optional(),limit:z.coerce.number().int().min(1).max(100).default(30)}).parse(req.query);
    service.scope(fresh(req),q.workspaceId);return q;
  }
  app.get('/api/v1/studio/content/capabilities',async(req,reply)=>{
    const {workspaceId}=z.strictObject({workspaceId:id}).parse(req.query);service.scope(fresh(req),workspaceId);
    let available=false;try{available=(await systemAsrRecognizers(config.root,AbortSignal.timeout(20000))).length>0;}catch{/* Manual content remains available; the transcription workbench reports the actual engine reason. */}service.scope(fresh(req),workspaceId);
    const writing=await new ContentWriting(repo,config).capabilities();service.scope(fresh(req),workspaceId);
    return send(req,reply,{sourceKinds:['text','docx','web','video'],publicHttps:true,staticHtmlOnly:true,videoTranscript:available?'manual_or_reviewed_asr':'manual',maxDocxBytes:8388608,maxWebBytes:1000000,maxTextCharacters:60000,automaticVideoASR:available,scriptGeneration:writing.available,editableDrafts:true,reviewedProjectPlans:true,realContentModel:writing.available,recording:true,mediaProcessing:true,notice:'支持来源、规则草稿、审阅计划、录制与校对转写；实际本机资料脚本通过独立模型队列生成，各媒体模型能力见对应工作台。外部内容供应商仍需配置，缺失不会返回模拟成功。'});
  });
  app.get('/api/v1/studio/content/sources',(req,reply)=>{
    const q=query(req),p=fresh(req),rows=repo.all<{id:string}>('SELECT id FROM studio_content_sources WHERE tenant_id=? AND workspace_id=? AND environment=? AND app_env=? AND id>? ORDER BY id LIMIT ?',p.tenantId,q.workspaceId,config.providerMode,config.appEnv,q.cursor||'',q.limit+1);
    return send(req,reply,{items:rows.slice(0,q.limit).map(r=>service.view(p,service.source(p,r.id))),nextCursor:rows.length>q.limit?rows[q.limit-1].id:null});
  });
  app.post('/api/v1/studio/content/sources',async(req,reply)=>{
    const input=contentSourceInput.parse(req.body);
    const p=fresh(req);service.rights(p,input.workspaceId,input.rights);
    const capture=await service.capture(p,input);
    return write(req,reply,p=>service.rights(p,input.workspaceId,input.rights),p=>({id:service.create(p,input,capture),workspaceId:input.workspaceId}),(p,id)=>service.view(p,service.source(p,id)));
  });
  app.get('/api/v1/studio/content/sources/:id',(req,reply)=>{const p=fresh(req);return send(req,reply,service.view(p,service.source(p,resource(req))));});
  app.post('/api/v1/studio/content/sources/:id/withdraw',(req,reply)=>{
    const input=contentSourceWithdrawInput.parse(req.body);
    return write(req,reply,p=>{service.source(p,resource(req),true);},p=>{const r=service.source(p,resource(req),true);return{id:service.withdraw(p,r,input.version),workspaceId:r.workspace_id};},(p,id)=>service.view(p,service.source(p,id)));
  });
  app.get('/api/v1/studio/content/sources/:id/versions',(req,reply)=>{
    const p=fresh(req),r=service.source(p,resource(req));
    return send(req,reply,repo.all('SELECT version,action,created_at AS createdAt,material_sha256 AS materialSHA256,text_sha256 AS textSHA256 FROM studio_content_source_versions WHERE source_id=? ORDER BY version DESC',r.id));
  });
  app.get('/api/v1/studio/content/briefs',(req,reply)=>{
    const q=query(req),p=fresh(req),rows=repo.all<{id:string}>('SELECT id FROM studio_content_briefs WHERE tenant_id=? AND workspace_id=? AND environment=? AND app_env=? AND id>? ORDER BY id LIMIT ?',p.tenantId,q.workspaceId,config.providerMode,config.appEnv,q.cursor||'',q.limit+1);
    return send(req,reply,{items:rows.slice(0,q.limit).map(r=>service.briefView(p,service.brief(p,r.id))),nextCursor:rows.length>q.limit?rows[q.limit-1].id:null});
  });
  app.post('/api/v1/studio/content/briefs',(req,reply)=>{
    const input=contentBriefInput.parse(req.body),{workspaceId,...configuration}=input;
    return write(req,reply,p=>service.scope(p,workspaceId,true),p=>({id:service.saveBrief(p,workspaceId,configuration),workspaceId}),(p,id)=>service.briefView(p,service.brief(p,id)));
  });
  app.get('/api/v1/studio/content/briefs/:id',(req,reply)=>{const p=fresh(req);return send(req,reply,service.briefView(p,service.brief(p,resource(req))));});
  app.post('/api/v1/studio/content/briefs/:id/save',(req,reply)=>{
    const input=contentBriefSaveInput.parse(req.body),{version,...configuration}=input;
    return write(req,reply,p=>{service.brief(p,resource(req),true);},p=>{const r=service.brief(p,resource(req),true);return{id:service.saveBrief(p,r.workspace_id,configuration,r,version),workspaceId:r.workspace_id};},(p,id)=>service.briefView(p,service.brief(p,id)));
  });
  app.get('/api/v1/studio/content/briefs/:id/versions',(req,reply)=>{
    const p=fresh(req),r=service.brief(p,resource(req));
    return send(req,reply,repo.all<{version:number;configuration:string;createdAt:string}>('SELECT version,configuration,created_at AS createdAt FROM studio_content_brief_versions WHERE brief_id=? ORDER BY version DESC',r.id).map(v=>({...v,configuration:contentBriefConfig.parse(JSON.parse(v.configuration))})));
  });
}
