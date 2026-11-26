import {z} from 'zod';
import {directoryScope,directoryGroupScope,directoryViewSchema,directoryGroupsViewSchema,directoryMutationResultSchema,directoryConnectorInput,directoryReviewInput} from './enterprise-directory.js';
export function registerDirectorySpec(paths:Record<string,unknown>,response:(schema:z.ZodType)=>z.ZodType,error:z.ZodType){
 const json=(schema:z.ZodType)=>({description:'当前目录配置或复核结果',content:{'application/json':{schema:z.toJSONSchema(response(schema))}}});
 const failure={description:'权限、版本或当前私有配置不满足要求',content:{'application/json':{schema:z.toJSONSchema(error)}}};
 const errors=Object.fromEntries([400,401,403,404,409,503].map(code=>[code,failure]));
 paths['/enterprise/directory']={get:{
  summary:'组织管理员读取固定目录策略、成员复核版本及事件',security:[{session:[]}],
  parameters:Object.entries(directoryScope.shape).map(([name,schema])=>({name,in:'query',required:name==='workspaceId',schema:z.toJSONSchema(schema,{io:'input'})})),
  responses:{200:json(directoryViewSchema),...errors}
 }};
 for(const[action,input]of [['connector',directoryConnectorInput],['review',directoryReviewInput]] as const){
  paths['/enterprise/directory/'+action]={post:{
   summary:action==='connector'?'明确启用目录连接或轮换凭据后关闭':'明确保留本地停用或恢复固定目录策略',security:[{session:[]}],
   parameters:[{name:'Idempotency-Key',in:'header',required:true,schema:{type:'string',minLength:8,maxLength:128}},{name:'X-CSRF-Token',in:'header',required:true,schema:{type:'string'}}],
   requestBody:{required:true,content:{'application/json':{schema:z.toJSONSchema(input,{io:'input'})}}},responses:{200:json(directoryMutationResultSchema),...errors}
  }};
 }
 paths['/enterprise/directory/groups']={get:{summary:'组织管理员分页读取同连接的用户组及成员计数，组名不赋予权限',security:[{session:[]}],parameters:Object.entries(directoryGroupScope.shape).map(([name,schema])=>({name,in:'query',required:['workspaceId','connectorId'].includes(name),schema:z.toJSONSchema(schema,{io:'input'})})),responses:{200:json(directoryGroupsViewSchema),...errors}}};
 const scimFailure={
  description:'标准SCIM错误；正文不采用应用data包装',
  content:{'application/scim+json':{schema:{type:'object',required:['schemas','status','detail'],properties:{schemas:{type:'array',items:{type:'string'}},status:{type:'string'},detail:{type:'string'},scimType:{type:'string'}}}}}
 };
 const scimErrors=Object.fromEntries([400,401,403,404,409,412,413,415,503].map(code=>[code,scimFailure]));
 const credential={security:[{directoryBearer:[]}]};
 const connector={name:'connectorId',in:'path',required:true,schema:{type:'string',format:'uuid'}};
 const resourceId={name:'id',in:'path',required:true,schema:{type:'string'}};
 const resource={description:'核心SCIM资源或列表；固定非管理员角色及空间，不按邮箱合并账户',content:{'application/scim+json':{schema:{type:'object'}}},headers:{ETag:{schema:{type:'string'}},Location:{schema:{type:'string'}}}};
 const body={required:true,content:{'application/scim+json':{schema:{type:'object'}}}};
 for(const kind of ['Users','Groups']){
  const root='/scim/v2/{connectorId}/'+kind;
  paths[root]={
   get:{...credential,summary:'一基分页；仅单项eq过滤及顶层属性投影',parameters:[connector,...['filter','startIndex','count','attributes','excludedAttributes'].map(name=>({name,in:'query',schema:{type:'string'}}))],responses:{200:resource,...scimErrors}},
   post:{...credential,parameters:[connector],requestBody:body,responses:{201:resource,...scimErrors}}
  };
  paths[root+'/{id}']={
   get:{...credential,parameters:[connector,resourceId,{name:'If-None-Match',in:'header',schema:{type:'string'}}],responses:{200:resource,304:{description:'资源版本未变化'},...scimErrors}},
   ...Object.fromEntries(['put','patch'].map(method=>[method,{...credential,parameters:[connector,resourceId,{name:'If-Match',in:'header',schema:{type:'string'}}],requestBody:body,responses:{200:resource,...scimErrors}}])),
   delete:{...credential,parameters:[connector,resourceId,{name:'If-Match',in:'header',schema:{type:'string'}}],responses:{204:{description:'资源删除；User账户停用且原登录撤销'},...scimErrors}}
  };
 }
 for(const kind of ['ServiceProviderConfig','Schemas','ResourceTypes']){
  paths['/scim/v2/{connectorId}/'+kind]={get:{...credential,parameters:[connector],responses:{200:resource,...scimErrors}}};
  if(kind!=='ServiceProviderConfig')paths['/scim/v2/{connectorId}/'+kind+'/{id}']={get:{...credential,parameters:[connector,resourceId],responses:{200:resource,...scimErrors}}};
 }
}
