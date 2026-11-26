import type { FileHandle } from 'node:fs/promises';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '@digitalguide/domain';
import { studioProjectSchema } from '../../../packages/contracts/src/studio.js';
import { studioExportSchema, exportPlanSchema } from '../../../packages/contracts/src/export.js';
import { developerStudioScope, developerStudioGrantInput, developerStudioGrantResult, developerStudioContext, developerStudioCreateInput, developerStudioSaveInput, developerStudioExportPlanInput, developerStudioExportCreateInput, developerStudioExportCancelInput, developerStudioMutationResult, type DeveloperStudioAction } from '../../../packages/contracts/src/developer-studio.js';
import type { DeveloperStudioWorkflows } from '../../../packages/enterprise/src/developer-studio-workflows.js';
import { parseDeveloperAuthorization } from '../../../packages/enterprise/src/developer-credentials.js';
import type { DeveloperAuthorized, DeveloperStore } from './developer-routes.js';
import type { DeveloperStudioAdapter, DeveloperStudioCommand } from './developer-studio-ports.js';
import { developerStudioRange, openDeveloperStudioFile } from './developer-studio-files.js';
export function registerDeveloperStudioRoutes(app:FastifyInstance,workflow:DeveloperStudioWorkflows,store:DeveloperStore,authorized:DeveloperAuthorized,send:(req:FastifyRequest,reply:FastifyReply,data:unknown)=>unknown,adapter:DeveloperStudioAdapter){
  app.get('/api/v1/enterprise/developer-studio',async(req,reply)=>send(req,reply,await authorized(req,false,p=>store.run(workflow.view(p,developerStudioScope.parse(req.query).workspaceId)))));
  app.post('/api/v1/enterprise/developer-studio/configure',async(req,reply)=>{const input=developerStudioGrantInput.parse(req.body),key=z.string().min(8).max(128).parse(req.headers['idempotency-key']);return send(req,reply,developerStudioGrantResult.parse(await authorized(req,true,p=>store.run(workflow.configure(p,input,key)))));});
  async function authenticate(req:FastifyRequest){
    const auth=parseDeveloperAuthorization(req.headers.authorization),result=await store.run(workflow.developer.gateway(auth,'context',{limit:20}));
    if('error' in result){if(result.error.status===429)throw new AppError('DEVELOPER_RATE_LIMIT','该应用凭证本分钟请求已达上限，请稍后重试。',429);throw new AppError('DEVELOPER_AUTH_REQUIRED','应用凭证无效、已到期或已撤销，请管理员签发当前环境凭证。',401);}
    if(!auth)throw new AppError('DEVELOPER_AUTH_REQUIRED','请使用独立应用Bearer凭证。',401);return auth;
  }
  const emptyQuery=(req:FastifyRequest)=>z.strictObject({}).parse(req.query),target=(req:FastifyRequest)=>z.object({id:z.uuid()}).parse(req.params).id,key=(req:FastifyRequest)=>z.string().min(8).max(128).parse(req.headers['idempotency-key']);
  function json(path:string,method:'GET'|'POST',action:DeveloperStudioAction|null,schema:z.ZodType,command:(req:FastifyRequest)=>DeveloperStudioCommand){
    app.route({method,url:'/api/open/v1/studio'+path,handler:async(req,reply)=>{
      try{const auth=await authenticate(req);emptyQuery(req);const result=await adapter.execute(workflow.authorize(auth,action),command(req));if(result.kind!=='json')throw new AppError('DEVELOPER_STUDIO_RESPONSE_INVALID','制作接口结果暂不可读取，请联系管理员。',503);return send(req,reply.header('Cache-Control','private, no-store'),schema.parse(result.data));}
      catch(error){if(error instanceof AppError&&error.status===429)reply.header('Retry-After','60');throw error;}
    }});
  }
  json('/context','GET',null,developerStudioContext,()=>({kind:'context'}));
  json('/projects/:id','GET','projects.write',studioProjectSchema,req=>({kind:'project.get',id:target(req)}));
  json('/projects','POST','projects.write',developerStudioMutationResult,req=>({kind:'project.create',input:developerStudioCreateInput.parse(req.body),key:key(req),requestId:req.id}));
  json('/projects/:id/save','POST','projects.write',developerStudioMutationResult,req=>({kind:'project.save',id:target(req),input:developerStudioSaveInput.parse(req.body),key:key(req),requestId:req.id}));
  json('/projects/:id/export-plan','POST','exports.submit',exportPlanSchema,req=>({kind:'export.plan',id:target(req),input:developerStudioExportPlanInput.parse(req.body)}));
  json('/projects/:id/exports','POST','exports.submit',developerStudioMutationResult,req=>({kind:'export.create',id:target(req),input:developerStudioExportCreateInput.parse(req.body),key:key(req),requestId:req.id}));
  json('/exports/:id','GET',null,studioExportSchema,req=>({kind:'export.get',id:target(req)}));
  json('/exports/:id/cancel','POST','exports.cancel',developerStudioMutationResult,req=>({kind:'export.cancel',id:target(req),input:developerStudioExportCancelInput.parse(req.body),key:key(req),requestId:req.id}));
  app.route({method:['GET','HEAD'],url:'/api/open/v1/studio/exports/:id/files/:artifactId',handler:async(req,reply)=>{
    let handle:FileHandle|undefined;const abort=new AbortController(),stop=()=>abort.abort();req.raw.once('aborted',stop);reply.raw.once('close',stop);
    try{
      const auth=await authenticate(req);emptyQuery(req);const params=z.strictObject({id:z.uuid(),artifactId:z.uuid()}).parse(req.params),command:Extract<DeveloperStudioCommand,{kind:'export.file'}>={kind:'export.file',id:params.id,artifactId:params.artifactId,range:z.string().max(512).optional().parse(req.headers.range),ifRange:z.string().max(512).optional().parse(req.headers['if-range']),head:req.method==='HEAD',requestId:req.id};
      const prepared=await adapter.execute(workflow.authorize(auth,'exports.download'),command);if(prepared.kind!=='file')throw new AppError('DEVELOPER_STUDIO_RESPONSE_INVALID','输出文件暂不可读取，请联系管理员。',503);
      const range=developerStudioRange(prepared.file.size,command.range,command.ifRange,prepared.file.sha256);if(!range)return reply.code(416).header('Content-Range','bytes */'+prepared.file.size).header('Cache-Control','private, no-store').send();
      handle=(await openDeveloperStudioFile(adapter.dataDir,prepared.file,abort.signal)).handle;
      const fresh=await adapter.execute(workflow.authorize(auth,'exports.download'),{...command,verifiedFingerprint:prepared.fingerprint});if(fresh.kind!=='file'||fresh.fingerprint!==prepared.fingerprint)throw new AppError('EXPORT_UNAVAILABLE','文件核对期间输出或授权发生变化，请重新请求。',409);abort.signal.throwIfAborted();
      reply.code(range.status).type(prepared.file.mediaType).header('Cache-Control','private, no-store').header('Pragma','no-cache').header('Content-Security-Policy',"default-src 'none'; sandbox").header('X-Content-Type-Options','nosniff').header('Accept-Ranges','bytes').header('ETag','"'+prepared.file.sha256+'"').header('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(prepared.file.name).replace(/'/g,'%27')).header('Content-Length',range.length);
      if(range.status===206)reply.header('Content-Range',`bytes ${range.start}-${range.end}/${prepared.file.size}`);
      if(req.method==='HEAD'||!range.length){await handle.close();handle=undefined;return reply.send(req.method==='HEAD'?undefined:Buffer.alloc(0));}
      const stream=handle.createReadStream({start:range.start,end:range.end,autoClose:true});handle=undefined;return reply.send(stream);
    }catch(error){if(error instanceof AppError&&error.status===429)reply.header('Retry-After','60');throw error;}finally{req.raw.off('aborted',stop);reply.raw.off('close',stop);await handle?.close();}
  }});
}
