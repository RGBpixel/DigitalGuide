import path from 'node:path';
import {z} from 'zod';
import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify';
import type {Repository} from '@digitalguide/database';
import type {Principal} from '@digitalguide/domain';
import {AppError,assertUsableAsset} from '@digitalguide/domain';
import {recordingCreateInput,recordingSaveInput,recordingUploadInput,recordingWithdrawInput,recordingApplyInput,recordingSnapshot} from '@digitalguide/contracts';
import type {Config} from './config.js';
import {authenticatedSession} from './auth-check.js';
import {executeIdempotent} from './idempotency.js';
import {Recordings} from './recordings.js';
import {privateFile} from './private-file.js';
import {ownedFile} from '../../../packages/media/src/files.js';
export function registerRecordingRoutes(app:FastifyInstance,repo:Repository,config:Config){
  const service=new Recordings(repo,config),fresh=(req:FastifyRequest)=>authenticatedSession(repo,req,config).principal,resource=(req:FastifyRequest)=>z.uuid().parse((req.params as {id:string}).id),send=(req:FastifyRequest,reply:FastifyReply,data:unknown)=>reply.send({data,requestId:req.id});
  type Ref={id:string;projectId?:string};
  function write(req:FastifyRequest,reply:FastifyReply,guard:(p:Principal)=>void,work:(p:Principal)=>Ref){
    repo.transaction(()=>guard(fresh(req)));const p=fresh(req);
    const result=executeIdempotent(repo,req,p.tenantId,p.userId,()=>{const current=fresh(req);guard(current);const ref=work(current),r=service.row(current,ref.id);repo.audit(current,r.workspace_id,'recording.'+req.routeOptions.url,r.id,req.id);return ref;});
    return send(req,reply,repo.transaction(()=>{const current=fresh(req);guard(current);const r=service.row(current,result.data.id);return result.data.projectId?service.drafts.studio.view(current,service.drafts.studio.project(current,result.data.projectId)):service.view(current,r);}));
  }
  app.get('/api/v1/studio/recordings/capabilities',(req,reply)=>{const q=z.strictObject({workspaceId:z.uuid()}).parse(req.query);service.scope(fresh(req),q.workspaceId);return send(req,reply,{sources:['camera','screen','composite'],inputFormats:['webm','mp4'],normalizedFormat:'H.264/AAC MP4',maxBytes:134217728,maxDurationMs:600000,physicalDevicesVerified:false,notice:'设备仅在当前浏览器明确点击后申请，系统声音取决于共享来源和浏览器支持；提词稿不代表实际台词转写。开发验证使用合成画面和测试音。'});});
  app.get('/api/v1/studio/recordings',(req,reply)=>{const q=z.strictObject({workspaceId:z.uuid(),cursor:z.uuid().optional(),limit:z.coerce.number().int().min(1).max(100).default(30)}).parse(req.query),p=fresh(req);service.scope(p,q.workspaceId);const rows=repo.all<{id:string}>('SELECT id FROM studio_recordings WHERE tenant_id=? AND workspace_id=? AND actor_id=? AND environment=? AND app_env=? AND id>? ORDER BY id LIMIT ?',p.tenantId,q.workspaceId,p.userId,config.providerMode,config.appEnv,q.cursor||'',q.limit+1);return send(req,reply,{items:rows.slice(0,q.limit).map(x=>service.view(p,service.row(p,x.id))),nextCursor:rows.length>q.limit?rows[q.limit-1].id:null});});
  app.post('/api/v1/studio/recordings',(req,reply)=>{const input=recordingCreateInput.parse(req.body);return write(req,reply,p=>{service.prepare(p,input.workspaceId,input.configuration,input.rights.expiresAt);},p=>({id:service.create(p,input)}));});
  app.get('/api/v1/studio/recordings/:id',(req,reply)=>{const p=fresh(req);return send(req,reply,service.view(p,service.row(p,resource(req))));});
  for(const action of ['save','upload','withdraw','apply'] as const)app.post('/api/v1/studio/recordings/:id/'+action,(req,reply)=>{
    const id=resource(req),guard=(p:Principal)=>{const r=service.row(p,id,true);if(action!=='withdraw')service.current(p,r);};
    if(action==='save'){const input=recordingSaveInput.parse(req.body);return write(req,reply,guard,p=>({id:service.save(p,service.row(p,id,true),input)}));}
    if(action==='upload'){const input=recordingUploadInput.parse(req.body);return write(req,reply,guard,p=>({id:service.upload(p,service.row(p,id,true),input)}));}
    if(action==='withdraw'){const input=recordingWithdrawInput.parse(req.body);return write(req,reply,guard,p=>({id:service.withdraw(p,service.row(p,id,true),input.version)}));}
    const input=recordingApplyInput.parse(req.body);return write(req,reply,guard,p=>({id,projectId:service.apply(p,service.row(p,id,true),input).id}));
  });
  app.get('/api/v1/studio/recordings/:id/versions',(req,reply)=>{const p=fresh(req),r=service.row(p,resource(req)),currentReason=service.reason(p,r);return send(req,reply,repo.all<{version:number;createdAt:string;action:string;snapshot:string}>('SELECT version,action,snapshot,created_at AS createdAt FROM studio_recording_versions WHERE recording_id=? ORDER BY version DESC',r.id).map(v=>{const snapshot=recordingSnapshot.parse(JSON.parse(v.snapshot));let reason=currentReason;if(!reason)try{if(snapshot.expiresAt<=new Date().toISOString())throw new AppError('RECORDING_EXPIRED','本修订继承的来源已到期。',409);repo.contentReferences(p,r.workspace_id,config.providerMode,config.appEnv,snapshot.sourceRefs);}catch(e){if(e instanceof AppError)reason=e.message;else throw e;}return{version:v.version,createdAt:v.createdAt,action:v.action,snapshot:reason?null:snapshot,unavailableReason:reason};}));});
  app.get('/api/v1/studio/recordings/:id/source',(req,reply)=>{const p=fresh(req),r=service.row(p,resource(req));service.current(p,r);const output=service.output(r);if(!output)throw new AppError('NOT_FOUND','原始录制尚未保存，请等待处理完成。',404);assertUsableAsset(repo.asset(p,output.asset_id));reply.header('Content-Disposition','attachment; filename="recording.'+output.input_container+'"');return privateFile(req,reply,ownedFile(path.join(config.dataDir,'objects'),output.raw_key),output.input_container==='webm'?'video/webm':'video/mp4');});
}
