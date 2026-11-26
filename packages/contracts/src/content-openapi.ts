import { z } from 'zod';
import * as c from './content.js';
export function registerContentSpec(paths:Record<string,Record<string,unknown>>,response:(schema:z.ZodType)=>z.ZodType,error:z.ZodType) {
  const parameters=(path:string)=>[...path.matchAll(/\{(\w+)\}/g)].map(m=>({name:m[1],in:'path',required:true,schema:{type:'string',format:'uuid'}}));
  const responses=(schema:z.ZodType)=>({
    '200':{description:'当前范围的来源、定位或修订',content:{'application/json':{schema:z.toJSONSchema(response(schema))}}},
    ...Object.fromEntries(['400','401','403','404','409','422','429','500'].map(code=>[code,{description:'明确失败原因和下一步',content:{'application/json':{schema:z.toJSONSchema(error)}}}]))
  });
  function get(path:string,schema:z.ZodType,summary:string,workspace=false) {
    const list=path.endsWith('/sources')||path.endsWith('/briefs');
    paths[path]={...paths[path],get:{summary,security:[{session:[]}],parameters:[...parameters(path),...(workspace?[{name:'workspaceId',in:'query',required:true,schema:{type:'string',format:'uuid'}}]:[]),...(list?[{name:'cursor',in:'query',schema:{type:'string',format:'uuid'}},{name:'limit',in:'query',schema:{type:'integer',minimum:1,maximum:100}}]:[])],responses:responses(schema)}};
  }
  function post(path:string,input:z.ZodType,result:z.ZodType,summary:string) {
    paths[path]={...paths[path],post:{summary,security:[{session:[]}],parameters:[...parameters(path),{name:'X-CSRF-Token',in:'header',required:true,schema:{type:'string'}},{name:'Idempotency-Key',in:'header',required:true,schema:{type:'string',minLength:8,maxLength:128}}],requestBody:{required:true,content:{'application/json':{schema:z.toJSONSchema(input,{io:'input'})}}},responses:responses(result)}};
  }
  const page=(schema:z.ZodType)=>z.strictObject({items:z.array(schema),nextCursor:z.uuid().nullable()});
  get('/studio/content/capabilities',z.strictObject({sourceKinds:z.array(z.enum(['text','docx','web','video'])),publicHttps:z.literal(true),staticHtmlOnly:z.literal(true),videoTranscript:z.enum(['manual','manual_or_reviewed_asr']),maxDocxBytes:z.literal(8388608),maxWebBytes:z.literal(1000000),maxTextCharacters:z.literal(60000),automaticVideoASR:z.boolean(),scriptGeneration:z.boolean(),editableDrafts:z.literal(true),reviewedProjectPlans:z.literal(true),realContentModel:z.boolean(),recording:z.literal(true),mediaProcessing:z.literal(true),notice:z.string()}),'当前内容/录制能力及真实内容模型边界',true);
  get('/studio/content/sources',page(c.contentSourceSchema),'来源列表；失效来源不返回正文',true);
  post('/studio/content/sources',c.contentSourceInput,c.contentSourceSchema,'实际提取文字、DOCX、静态网页或登记人工视频转写');
  get('/studio/content/sources/{id}',c.contentSourceSchema,'当前来源、正文和使用范围');
  post('/studio/content/sources/{id}/withdraw',c.contentSourceWithdrawInput,c.contentSourceSchema,'版本核对后撤回来源，旧缓存不能恢复正文');
  get('/studio/content/sources/{id}/versions',z.array(c.contentSourceVersionSchema),'只读来源捕获与撤回记录，历史不绕过正文权限');
  get('/studio/content/briefs',page(c.contentBriefSchema),'账号定位与选题列表',true);
  post('/studio/content/briefs',c.contentBriefInput,c.contentBriefSchema,'保存受众、定位、目标、渠道、表达及选题');
  get('/studio/content/briefs/{id}',c.contentBriefSchema,'读取当前账号定位');
  post('/studio/content/briefs/{id}/save',c.contentBriefSaveInput,c.contentBriefSchema,'版本锁保存定位，冲突保留人工输入');
  get('/studio/content/briefs/{id}/versions',z.array(c.contentBriefVersionSchema),'账号定位不可覆写修订');
}
