import {z} from 'zod';
import * as c from './recordings.js';
import {studioProjectSchema} from './studio.js';
export function registerRecordingSpec(paths:Record<string,Record<string,unknown>>,response:(schema:z.ZodType)=>z.ZodType,error:z.ZodType){
  const responses=(schema:z.ZodType)=>({'200':{description:'当前账号、空间、来源及环境内的录制结果',content:{'application/json':{schema:z.toJSONSchema(response(schema))}}},...Object.fromEntries(['400','401','403','404','409','413','422','429','500'].map(code=>[code,{description:'明确失败及下一步',content:{'application/json':{schema:z.toJSONSchema(error)}}}]))});
  const parameters=(path:string)=>path.includes('{id}')?[{name:'id',in:'path',required:true,schema:{type:'string',format:'uuid'}}]:[{name:'workspaceId',in:'query',required:true,schema:{type:'string',format:'uuid'}}];
  function get(path:string,schema:z.ZodType,summary:string){paths[path]={...paths[path],get:{summary,security:[{session:[]}],parameters:parameters(path),responses:responses(schema)}};}
  function post(path:string,input:z.ZodType,schema:z.ZodType,summary:string){paths[path]={...paths[path],post:{summary,security:[{session:[]}],parameters:[...(path.includes('{id}')?parameters(path):[]),{name:'X-CSRF-Token',in:'header',required:true,schema:{type:'string'}},{name:'Idempotency-Key',in:'header',required:true,schema:{type:'string',minLength:8,maxLength:128}}],requestBody:{required:true,content:{'application/json':{schema:z.toJSONSchema(input,{io:'input'})}}},responses:responses(schema)}};}
  get('/studio/recordings',z.strictObject({items:z.array(c.recordingSchema),nextCursor:z.uuid().nullable()}),'本人录制方案及分片/转换进度');
  post('/studio/recordings',c.recordingCreateInput,c.recordingSchema,'固定设备/提词配置及独立录制用途，不开启设备');
  get('/studio/recordings/{id}',c.recordingSchema,'来源受限时隐藏提词稿及原片链接');
  post('/studio/recordings/{id}/save',c.recordingSaveInput,c.recordingSchema,'原始录制绑定前，版本锁保存方案');
  post('/studio/recordings/{id}/upload',c.recordingUploadInput,c.recordingSchema,'绑定一个WebM/MP4原片并开始持久分片上传');
  post('/studio/recordings/{id}/withdraw',c.recordingWithdrawInput,c.recordingSchema,'撤回用途并停止未完成传输；限制原片和派生文件');
  post('/studio/recordings/{id}/apply',c.recordingApplyInput,studioProjectSchema,'确认后以实际录像创建工程或追加独立分镜，保留其他内容');
  get('/studio/recordings/{id}/versions',z.array(c.recordingVersionSchema),'不可覆写方案修订，历史受当前来源约束');
  get('/studio/recordings/capabilities',z.strictObject({sources:z.array(z.enum(['camera','screen','composite'])),inputFormats:z.array(z.enum(['webm','mp4'])),normalizedFormat:z.string(),maxBytes:z.literal(134217728),maxDurationMs:z.literal(600000),physicalDevicesVerified:z.literal(false),notice:z.string()}),'实际转换边界及浏览器设备验证限制');
  paths['/studio/recordings/{id}/source']={get:{summary:'下载本人持久化原始录制；当前用途及来源重新检查',security:[{session:[]}],parameters:parameters('/{id}'),responses:{'200':{description:'原始WebM/MP4二进制',content:{'video/webm':{schema:{type:'string',format:'binary'}},'video/mp4':{schema:{type:'string',format:'binary'}}}},'206':{description:'私有原片字节范围'},'401':{description:'登录失效'},'403':{description:'当前权限不足'},'404':{description:'不存在或非本人'},'409':{description:'用途或来源失效'}}}};
}
