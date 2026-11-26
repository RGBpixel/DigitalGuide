import {directoryErasureInput,directoryErasureApply} from '../../../packages/contracts/src/directory-lifecycle.js';
import {directoryAccessScope,directoryAccessHistoryScope,directoryAccessPreviewInput,directoryAccessApplyInput} from '../../../packages/contracts/src/directory-access.js';
import {z} from 'zod';
import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify';
import {AppError,type Principal} from '@digitalguide/domain';
import {directoryScope,directoryGroupScope,directoryConnectorInput,directoryReviewInput} from '../../../packages/contracts/src/enterprise-directory.js';
import {DirectoryWorkflows} from '../../../packages/enterprise/src/directory-workflows.js';
import type {IdentityWorkflow} from '../../../packages/enterprise/src/identity-workflows.js';
import {ScimError,SCIM} from '../../../packages/enterprise/src/scim-profile.js';
export interface DirectoryStore{run<T>(workflow:IdentityWorkflow<T>):T|Promise<T>}
type Authorized=<T>(request:FastifyRequest,write:boolean,work:(p:Principal)=>T|Promise<T>)=>T|Promise<T>;
const clientStatus=(error:unknown)=>{const code=(error as {statusCode?:unknown}|null)?.statusCode;return typeof code==='number'&&code>=400&&code<500?code:503;};
export function registerDirectoryAdminRoutes(app:FastifyInstance,workflow:DirectoryWorkflows,store:DirectoryStore,authorized:Authorized,send:(req:FastifyRequest,reply:FastifyReply,data:unknown)=>unknown){
 app.get('/api/v1/enterprise/directory',async(req,reply)=>send(req,reply,await authorized(req,false,p=>store.run(workflow.view(p,directoryScope.parse(req.query))))));
 app.get('/api/v1/enterprise/directory/groups',async(req,reply)=>send(req,reply,await authorized(req,false,p=>store.run(workflow.groupsView(p,directoryGroupScope.parse(req.query))))));
 app.get('/api/v1/enterprise/directory/group-access',async(req,reply)=>send(req,reply,await authorized(req,false,p=>store.run(workflow.access.rules(p,directoryAccessScope.parse(req.query))))));
 app.get('/api/v1/enterprise/directory/group-access/history',async(req,reply)=>send(req,reply,await authorized(req,false,p=>store.run(workflow.access.history(p,directoryAccessHistoryScope.parse(req.query))))));
 app.post('/api/v1/enterprise/directory/group-access/preview',async(req,reply)=>{const input=directoryAccessPreviewInput.parse(req.body);return send(req,reply,await authorized(req,true,p=>store.run(workflow.access.preview(p,input))));});
 app.post('/api/v1/enterprise/directory/group-access/apply',async(req,reply)=>{const input=directoryAccessApplyInput.parse(req.body),key=z.string().min(8).max(128).parse(req.headers['idempotency-key']);return send(req,reply,await authorized(req,true,p=>store.run(workflow.access.apply(p,input,key))));});
 app.post('/api/v1/enterprise/directory/profile-erasure/preview',async(req,reply)=>{const input=directoryErasureInput.parse(req.body);return send(req,reply,await authorized(req,true,p=>store.run(workflow.lifecycle.preview(p,input))));});
 app.post('/api/v1/enterprise/directory/profile-erasure/apply',async(req,reply)=>{const input=directoryErasureApply.parse(req.body),key=z.string().min(8).max(128).parse(req.headers['idempotency-key']);return send(req,reply,await authorized(req,true,p=>store.run(workflow.lifecycle.apply(p,input,key))));});
 app.post('/api/v1/enterprise/directory/connector',async(req,reply)=>{const input=directoryConnectorInput.parse(req.body),key=z.string().min(8).max(128).parse(req.headers['idempotency-key']);return send(req,reply,await authorized(req,true,p=>store.run(workflow.mutation(p,{action:'connector',input},key))));});
 app.post('/api/v1/enterprise/directory/review',async(req,reply)=>{const input=directoryReviewInput.parse(req.body),key=z.string().min(8).max(128).parse(req.headers['idempotency-key']);return send(req,reply,await authorized(req,true,p=>store.run(workflow.mutation(p,{action:'review',input},key))));});
}
export function registerScimRoutes(app:FastifyInstance,workflow:DirectoryWorkflows,store:DirectoryStore){
 void app.register(async scim=>{
  scim.setErrorHandler((error,_req,reply)=>{const status=error instanceof AppError?error.status:clientStatus(error);return reply.type('application/scim+json').code(status).send({schemas:[SCIM.Error],status:String(status),detail:error instanceof ScimError?error.message:status===503?'目录服务暂不可用，请联系部署管理员。':status===400?'请求结构无效，请核对目录接口格式。':'目录授权或当前状态不满足要求，请联系组织管理员。',...(error instanceof ScimError&&error.scimType?{scimType:error.scimType}:{})});});
  scim.addContentTypeParser('application/scim+json',{parseAs:'string',bodyLimit:65536},(_req,body,done)=>{try{done(null,JSON.parse(String(body)));}catch{done(new ScimError('JSON格式无效。',400,'invalidSyntax'),undefined);}});
  for(const resource of ['Users','Groups','ServiceProviderConfig','Schemas','ResourceTypes'] as const){for(const item of [false,true]){if(resource==='ServiceProviderConfig'&&item)continue;const url='/api/v1/scim/v2/:connectorId/'+resource+(item?'/:id':'');scim.route({url,method:resource==='Users'||resource==='Groups'?item?['GET','PUT','PATCH','DELETE']:['GET','POST']:'GET',bodyLimit:65536,handler:async(req,reply)=>{const params=req.params as {connectorId:string;id?:string},provider=workflow.runtime.authenticate(params.connectorId,req.headers.authorization);if(!provider)throw new ScimError('目录凭据无效或未配置。',401);const result=await store.run(workflow.request(provider,{method:req.method,resource,id:params.id,query:req.query,body:req.body,match:req.headers['if-match'],noneMatch:req.headers['if-none-match']}));if(result.etag)reply.header('ETag',result.etag);if(result.location)reply.header('Location',result.location);reply.type('application/scim+json').code(result.status);return result.body?reply.send(result.body):reply.send();}});}}
 });
}
