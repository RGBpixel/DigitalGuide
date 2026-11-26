import { z } from 'zod';
import * as d from './developer-studio.js';
import { studioProjectSchema } from './studio.js';
import { studioExportSchema, exportPlanSchema } from './export.js';

export function registerDeveloperStudioSpec(paths:Record<string,unknown>,response:(schema:z.ZodType)=>z.ZodType,error:z.ZodType){
 const result=(schema:z.ZodType)=>({description:'当前应用范围、责任人权限与来源核对后的制作结果',content:{'application/json':{schema:z.toJSONSchema(response(schema))}}});
 const failure={description:'输入、当前应用凭证、委托、责任人、动作、资源来源或版本不满足条件；业务失败仍计入已认证凭证的请求额度',content:{'application/json':{schema:z.toJSONSchema(error)}}};
 const errors={400:failure,401:failure,403:failure,404:failure,409:failure,429:{...failure,headers:{'Retry-After':{description:'当前凭证每UTC分钟最多60次请求；配额与原只读API共用并持久保存',schema:{type:'string',const:'60'}}}},503:failure};
 const parameter=(name:string)=>({in:'path',name,required:true,schema:{type:'string',format:'uuid'}});
 const idempotency={in:'header',name:'Idempotency-Key',required:true,schema:{type:'string',minLength:8,maxLength:128},description:'同应用、同动作范围内稳定去重，跨凭证轮换保留；同键更改正文返回409。重试会重新检查当前授权和资源，不缓存原工程正文。'};
 paths['/enterprise/developer-studio']={get:{summary:'管理员查看当前空间的应用制作委托、可选责任人及有界操作记录',security:[{session:[]}],parameters:[{in:'query',name:'workspaceId',required:true,schema:{type:'string',format:'uuid'}}],responses:{200:result(d.developerStudioViewSchema),...errors}}};
 paths['/enterprise/developer-studio/configure']={post:{summary:'完整组织管理员明确确认制作责任人、动作和7/30/90天期限；保存撤销旧凭证并取消旧代次未完成的应用导出',description:'expectedAppVersion与expectedVersion必须匹配当前状态。启用或更换责任人需要当前列表返回的responsibleConfigurationToken；责任人的角色、成员和目录权限修订变化后需要重新确认。应用重启用不恢复旧委托。',security:[{session:[]}],parameters:[{in:'header',name:'X-CSRF-Token',required:true,schema:{type:'string'}},idempotency],requestBody:{required:true,content:{'application/json':{schema:z.toJSONSchema(d.developerStudioGrantInput,{io:'input'})}}},responses:{200:result(d.developerStudioGrantResult),...errors}}};
 const base='/open/v1/studio',description='使用独立组织应用Bearer凭证；不会建立员工登录。固定租户、工作空间、供应商环境和应用环境，不能通过正文、查询或cookie扩大范围。每次请求复核责任人的当前制作权限、委托修订与期限。';
 function operation(suffix:string,method:'get'|'post',summary:string,schema:z.ZodType,action:string|null,input?:z.ZodType,write=false){paths[base+suffix]={servers:[{url:'/api'}],[method]:{summary,description,security:[{developerBearer:[]}],'x-developer-actions':action?[action]:[],parameters:[...(suffix.includes('{id}')?[parameter('id')]:[]),...(write?[idempotency]:[])],...(input?{requestBody:{required:true,content:{'application/json':{schema:z.toJSONSchema(input,{io:'input'})}}}}:{}),responses:{200:result(schema),...errors}}};}
 operation('/context','get','核对当前应用制作委托、具体动作和期限',d.developerStudioContext,null);
 operation('/projects/{id}','get','读取当前空间完整可编辑工程；不包含人员会话专用分镜预览文件URL',studioProjectSchema,'projects.write');
 operation('/projects','post','明确创建可编辑工程；工程正文和模板来源互斥，空间由应用限定',d.developerStudioMutationResult,'projects.write',d.developerStudioCreateInput,true);
 operation('/projects/{id}/save','post','按当前工程版本明确保存新修订，并核对当前素材与来源',d.developerStudioMutationResult,'projects.write',d.developerStudioSaveInput,true);
 operation('/projects/{id}/export-plan','post','核对导出计划、来源、当前版本及本机能力，不创建任务',exportPlanSchema,'exports.submit',d.developerStudioExportPlanInput);
 operation('/projects/{id}/exports','post','确认原计划摘要和使用权后提交导出；保存应用、凭证和责任人来源',d.developerStudioMutationResult,'exports.submit',d.developerStudioExportCreateInput,true);
 operation('/exports/{id}','get','读取制作导出当前状态；需要至少一个exports动作，文件链接仅在获下载动作时提供',studioExportSchema,null);
 operation('/exports/{id}/cancel','post','明确取消尚未完成的导出；同操作编号重试返回现有取消状态',d.developerStudioMutationResult,'exports.cancel',d.developerStudioExportCancelInput,true);
 const headers={'Cache-Control':{schema:{type:'string',const:'private, no-store'}},ETag:{description:'带双引号的文件SHA256强摘要',schema:{type:'string'}},'Accept-Ranges':{schema:{type:'string',const:'bytes'}},'Content-Length':{schema:{type:'integer',minimum:0}},'Content-Disposition':{schema:{type:'string'}}};
 const binary={description:'已重新核对授权、来源、文件大小与完整SHA256的输出文件',headers,content:Object.fromEntries(['video/mp4','video/quicktime','audio/wav','application/zip','application/json','text/plain','text/vtt'].map(mediaType=>[mediaType,{schema:{type:'string',format:'binary'}}]))};
 const fileParameters=[parameter('id'),parameter('artifactId'),{in:'header',name:'Range',schema:{type:'string',maxLength:512},description:'仅支持一个bytes范围：start-end、start-或-suffix；无效/多范围/越界返回416。'},{in:'header',name:'If-Range',schema:{type:'string',maxLength:512},description:'只接受完全匹配的SHA256强ETag。其他值使Range失效并返回完整200。'}];
 const fileDescription=description+' 必须有exports.download动作。先读取当前来源，在数据库事务外核对完整文件，再以同一文件句柄流式发送；传输开始前重新校验凭证、委托及文件指纹。工程修订、素材或来源失效返回409，不把原文件变成公开链接。单文件最大32GiB，HEAD不记录下载开始事件。';
 paths[base+'/exports/{id}/files/{artifactId}']={servers:[{url:'/api'}],get:{summary:'受控下载当前有效输出，支持单段断点续传',description:fileDescription,security:[{developerBearer:[]}],'x-developer-actions':['exports.download'],parameters:fileParameters,responses:{200:binary,206:{...binary,description:'有效单段字节范围',headers:{...headers,'Content-Range':{schema:{type:'string'}}}},416:{description:'无效字节范围',headers:{'Content-Range':{schema:{type:'string'}}}},...errors}},head:{summary:'核对当前有效输出文件的大小、摘要和范围，不返回正文',description:fileDescription,security:[{developerBearer:[]}],'x-developer-actions':['exports.download'],parameters:fileParameters,responses:{200:{description:'文件已核对，无正文',headers},206:{description:'单段范围已核对，无正文',headers:{...headers,'Content-Range':{schema:{type:'string'}}}},416:{description:'无效字节范围，无正文'},...errors}}};
}
