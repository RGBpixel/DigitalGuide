import {z} from 'zod';
import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify';
import {aeSourceInput,aeSourceCreate,aeSourceControl,aeSourceRetry} from '@digitalguide/contracts';
import {AppError,type Principal} from '@digitalguide/domain';
import type {Repository} from '@digitalguide/database';
import type {Config} from './config.js';
import {authenticatedSession} from './auth-check.js';
import {executeIdempotent} from './idempotency.js';
import {privateFile} from './private-file.js';
import {AeSourceExports,type AeSourceRow} from './ae-source-exports.js';
export function registerAeSourceRoutes(app:FastifyInstance,repo:Repository,config:Config){
 const s=new AeSourceExports(repo,config),id=z.uuid(),fresh=(req:FastifyRequest)=>authenticatedSession(repo,req,config).principal,key=(req:FastifyRequest)=>id.parse((req.params as {id:string}).id),send=(req:FastifyRequest,reply:FastifyReply,data:unknown)=>reply.send({data,requestId:req.id});
 function mutation(req:FastifyRequest,guard:(p:Principal)=>void,work:(p:Principal)=>{id:string;workspaceId:string}){
  guard(fresh(req));const actor=fresh(req);return executeIdempotent(repo,req,actor.tenantId,actor.userId,()=>{const p=fresh(req);guard(p);const r=work(p);repo.audit(p,r.workspaceId,'studio.ae.source.'+req.routeOptions.url,r.id,req.id);return{id:r.id};}).data.id;
 }
 async function view(req:FastifyRequest,reply:FastifyReply,jobId:string){
  for(let attempt=0;attempt<3;attempt++){const p=fresh(req),row=s.row(p,jobId),v=await s.view(p,row),current=s.row(fresh(req),jobId);if(current.version===row.version)return send(req,reply,v);}throw new AppError('AE_SOURCE_BUSY','源文件任务正在更新，请重新载入当前进度。',409);
 }
 app.get('/api/v1/studio/ae-source-permission',(req,reply)=>{const q=z.strictObject({workspaceId:id}).parse(req.query);return send(req,reply,s.permission(fresh(req),q.workspaceId));});
 app.get('/api/v1/studio/ae-templates/:id/source-capability',async(req,reply)=>{const q=z.strictObject({templateVersion:z.coerce.number().int().positive()}).parse(req.query),templateId=key(req),result=await s.capability(fresh(req),templateId,q.templateVersion);s.fixed(fresh(req),templateId,q.templateVersion);return send(req,reply,result);});
 app.post('/api/v1/studio/ae-source-exports/plan',async(req,reply)=>{const prepared=await s.prepare(fresh(req),aeSourceInput.parse(req.body));repo.transaction(()=>s.validatePrepared(fresh(req),prepared));return send(req,reply,prepared.plan);});
 app.post('/api/v1/studio/ae-source-exports',async(req,reply)=>{
  const input=aeSourceCreate.parse(req.body),prepared=await s.prepare(fresh(req),aeSourceInput.parse({workspaceId:input.workspaceId,templateId:input.templateId,templateVersion:input.templateVersion,name:input.name}));
  if(prepared.plan.hash!==input.planHash||prepared.plan.mode!==input.expectedMode)throw new AppError('AE_SOURCE_PLAN_CHANGED','源文件导出计划或模式已有变化，请重新核对。',409);
  const jobId=mutation(req,p=>s.validatePrepared(p,prepared),p=>({id:s.create(p,prepared),workspaceId:input.workspaceId}));return view(req,reply,jobId);
 });
 app.get('/api/v1/studio/ae-source-exports',async(req,reply)=>{
  const q=z.strictObject({workspaceId:id,cursor:id.optional(),limit:z.coerce.number().int().min(1).max(100).default(20)}).parse(req.query),p=fresh(req);s.permit(p,q.workspaceId);
  const rows=repo.all<AeSourceRow>('SELECT * FROM ae_source_exports WHERE tenant_id=? AND workspace_id=? AND environment=? AND app_env=? AND id>? ORDER BY id LIMIT ?',p.tenantId,q.workspaceId,config.providerMode,config.appEnv,q.cursor||'',q.limit+1),items=[];
  for(const r of rows.slice(0,q.limit))items.push(await s.view(fresh(req),s.row(fresh(req),r.id)));s.permit(fresh(req),q.workspaceId);return send(req,reply,{items,nextCursor:rows.length>q.limit?rows[q.limit-1].id:null});
 });
 app.get('/api/v1/studio/ae-source-exports/:id',(req,reply)=>view(req,reply,key(req)));
 for(const action of ['cancel','withdraw','retry']as const)app.post('/api/v1/studio/ae-source-exports/:id/'+action,async(req,reply)=>{
  const input=(action==='retry'?aeSourceRetry:aeSourceControl).parse(req.body),row=s.row(fresh(req),key(req)),authority=action==='retry'?await s.authority(fresh(req),row,true):null;
  const guard=(p:Principal)=>{const current=s.row(p,row.id);if(authority)s.validateRow(current,authority);};
  const jobId=mutation(req,guard,p=>{const current=s.row(p,row.id);s.control(p,current,input.controlVersion,action);return{id:row.id,workspaceId:current.workspace_id};});return view(req,reply,jobId);
 });
 app.get('/api/v1/studio/ae-source-exports/:id/file',async(req,reply)=>{
  const result=await s.file(fresh(req),key(req));return repo.transaction(()=>{const p=fresh(req),row=s.row(p,result.row.id);if(row.status!=='succeeded'||row.version!==result.row.version||row.storage_key!==result.row.storage_key)throw new AppError('AE_SOURCE_FILE_UNAVAILABLE','源文件任务已有变化或已撤回，请重新载入。',409);s.validateRow(row,result.authority);repo.audit(p,row.workspace_id,'studio.ae.source.download',row.id,req.id);return privateFile(req,reply,result.file,'application/zip',s.fileName(row));});
 });
}
