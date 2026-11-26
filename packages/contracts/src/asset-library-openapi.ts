import {z} from 'zod';
import * as c from './asset-library.js';
export function registerAssetLibrarySpec(paths:Record<string,Record<string,unknown>>,response:(s:z.ZodType)=>z.ZodType,error:z.ZodType){
  const params=(path:string)=>[...path.matchAll(/\{(\w+)\}/g)].map(m=>({name:m[1],in:'path',required:true,schema:{type:'string',format:'uuid'}})),responses=(schema:z.ZodType)=>({'200':{description:'当前登录、来源和权限下的素材库状态',content:{'application/json':{schema:z.toJSONSchema(response(schema))}}},...Object.fromEntries(['400','401','403','404','409','429','500'].map(code=>[code,{description:'明确错误及下一步，冲突需重新核对',content:{'application/json':{schema:z.toJSONSchema(error)}}}]))}),base='/asset-library';
  function get(path:string,schema:z.ZodType,summary:string,query:unknown[]=[]){paths[path]={...paths[path],get:{summary,security:[{session:[]}],parameters:[...params(path),...query],responses:responses(schema)}};}
  function post(path:string,input:z.ZodType,schema:z.ZodType,summary:string,idempotent=true){paths[path]={...paths[path],post:{summary,security:[{session:[]}],parameters:[...params(path),{name:'X-CSRF-Token',in:'header',required:true,schema:{type:'string'}},...(idempotent?[{name:'Idempotency-Key',in:'header',required:true,schema:{type:'string',minLength:8,maxLength:128}}]:[])],requestBody:{required:true,content:{'application/json':{schema:z.toJSONSchema(input,{io:'input'})}}},responses:responses(schema)}};}
  const workspace={name:'workspaceId',in:'query',required:true,schema:{type:'string',format:'uuid'}};
  get(base+'/folders',z.array(c.libraryFolderSchema),'工作空间内五层文件夹与归档位置',[workspace]);
  post(base+'/folders',c.libraryFolderCreate,c.libraryFolderSchema,'创建独立于素材内容版本的分类文件夹');
  post(base+'/folders/{id}/save',c.libraryFolderSave,c.libraryFolderSchema,'乐观锁重命名或移动文件夹，拒绝循环与越界');
  post(base+'/folders/{id}/archive',c.libraryFolderArchive,c.libraryFolderSchema,'归档空文件夹或明确恢复，保留历史位置');
  get(base+'/families',z.strictObject({items:z.array(c.libraryFamilySchema),nextCursor:z.uuid().nullable()}),'按文件夹、标签、媒体用途及回收状态分页检索素材组',[workspace,...Object.entries(c.libraryListInput.shape).filter(([name])=>name!=='workspaceId').map(([name,schema])=>({name,in:'query',schema:z.toJSONSchema(schema,{io:'input'})}))]);
  get(base+'/families/{id}',c.libraryDetailSchema,'读取全部文件版本，显示不可用原因，不自动退回旧版');
  paths[base+'/families/{id}/files/{assetId}']={get:{summary:'当前权限和来源下校验实际SHA-256后读取所选原件；异步后重检，支持私有Range',security:[{session:[]}],parameters:params(base+'/families/{id}/files/{assetId}'),responses:{'200':{description:'实际原文件',content:{'application/octet-stream':{schema:{type:'string',format:'binary'}}}},'206':{description:'私有文件字节范围'},'401':{description:'当前登录失效'},'404':{description:'越权或分组已变化'},'409':{description:'原文件、来源、期限或字节校验失败'}}}};
  post(base+'/families/{id}/save',c.libraryFamilySave,c.libraryDetailSchema,'保存名称、位置和标签，不改变素材版本或工程引用');
  post(base+'/families/{id}/versions',c.libraryRevisionAdd,c.libraryDetailSchema,'将独立素材明确加入新版，保留原文件ID和授权边界');
  post(base+'/families/{id}/recycle-plan',c.libraryRecycleInput,c.libraryRecyclePlanSchema,'预览所选文件回收或恢复的直接引用及影响',false);
  post(base+'/families/{id}/recycle',c.libraryRecycleApply,c.libraryDetailSchema,'核对当前影响摘要后回收或恢复选定文件');
  get(base+'/families/{id}/events',z.strictObject({items:z.array(c.libraryEventSchema),nextCursor:z.int().nullable()}),'分页查看素材组整理、版本与回收历史',[{name:'after',in:'query',schema:{type:'integer',minimum:0}},{name:'limit',in:'query',schema:{type:'integer',minimum:1,maximum:100}}]);
}
