import { z } from 'zod';
import * as c from './content-drafts.js';
export function registerContentDraftSpec(paths:Record<string,Record<string,unknown>>,response:(schema:z.ZodType)=>z.ZodType,error:z.ZodType){
  const parameters=(path:string)=>[...path.matchAll(/\{(\w+)\}/g)].map(m=>({name:m[1],in:'path',required:true,schema:{type:'string',format:'uuid'}}));
  const responses=(schema:z.ZodType)=>({'200':{description:'当前范围内的草稿、修订或已审阅计划',content:{'application/json':{schema:z.toJSONSchema(response(schema))}}},...Object.fromEntries(['400','401','403','404','409','422','500'].map(code=>[code,{description:'明确失败及下一步',content:{'application/json':{schema:z.toJSONSchema(error)}}}]))});
  function get(path:string,schema:z.ZodType,summary:string,list=false){paths[path]={get:{summary,security:[{session:[]}],parameters:[...parameters(path),...(list?[{name:'workspaceId',in:'query',required:true,schema:{type:'string',format:'uuid'}},{name:'cursor',in:'query',schema:{type:'string',format:'uuid'}},{name:'rootId',in:'query',schema:{type:'string',format:'uuid'}},{name:'limit',in:'query',schema:{type:'integer',minimum:1,maximum:100}}]:[])],responses:responses(schema)}};}
  function post(path:string,input:z.ZodType,schema:z.ZodType,summary:string){paths[path]={...paths[path],post:{summary,security:[{session:[]}],parameters:[...parameters(path),{name:'X-CSRF-Token',in:'header',required:true,schema:{type:'string'}},{name:'Idempotency-Key',in:'header',required:true,schema:{type:'string',minLength:8,maxLength:128}}],requestBody:{required:true,content:{'application/json':{schema:z.toJSONSchema(input,{io:'input'})}}},responses:responses(schema)}};}
  get('/studio/content/drafts',z.strictObject({items:z.array(c.contentDraftSchema),nextCursor:z.uuid().nullable()}),'草稿与独立变体；失效来源不返回正文',true);
  post('/studio/content/drafts',c.contentDraftCreateInput,c.contentDraftSchema,'按真实来源规则整理或明确模拟生成可编辑草稿');
  get('/studio/content/drafts/{id}',c.contentDraftSchema,'当前草稿及来源/定位变化');
  post('/studio/projects/{id}/content-draft',c.contentProjectDraftInput,c.contentDraftSchema,'从已保存工程所选分镜建立独立草稿快照');
  post('/studio/content/drafts/{id}/save',c.contentDraftSaveInput,c.contentDraftSchema,'版本锁保存人工修订，可明确采用定位新版本');
  post('/studio/content/drafts/{id}/fork',c.contentDraftForkInput,c.contentDraftSchema,'另存独立变体并保留根稿及父版本来源');
  post('/studio/content/drafts/{id}/restore',c.contentDraftRestoreInput,c.contentDraftSchema,'将有效历史内容恢复为新修订，不覆写原历史');
  get('/studio/content/drafts/{id}/versions',z.array(c.contentDraftVersionSchema),'不可覆写草稿修订，历史受当前来源约束');
  get('/studio/content/drafts/{id}/plans',z.array(c.contentPlanSchema),'局部改稿/新工程/工程替换的计划记录');
  post('/studio/content/drafts/{id}/plans',c.contentPlanCreateInput,c.contentPlanSchema,'先生成前后对照及当前来源绑定，不立即改写工程');
  get('/studio/content/plans/{id}',c.contentPlanSchema,'读取当前审阅计划及失效原因');
  post('/studio/content/plans/{id}/save',c.contentPlanSaveInput,c.contentPlanSchema,'只能修改计划原已选段落的新文字');
  post('/studio/content/plans/{id}/apply',c.contentPlanApplyInput,c.contentPlanSchema,'确认哈希后原子应用，仅变更目标并保留无关内容');
  post('/studio/content/plans/{id}/cancel',c.contentPlanCancelInput,c.contentPlanSchema,'取消未应用计划，允许清理失效来源计划');
  get('/studio/content/plans/{id}/versions',z.array(c.contentPlanVersionSchema),'计划文字和哈希修订，失效来源不返回正文');
}
