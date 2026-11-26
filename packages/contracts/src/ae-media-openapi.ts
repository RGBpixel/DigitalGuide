import {z} from 'zod';
import {aeMediaInput,aeMediaCreate,aeMediaConfirm,aeMediaPlan,aeMediaJob} from './ae-media.js';
export function registerAeMediaSpec(paths:Record<string,Record<string,unknown>>,response:(s:z.ZodType)=>z.ZodType,error:z.ZodType){
 const base='/studio/ae-artifacts/{id}',jobs='/studio/ae-media-adoptions/{id}',parameters=[{name:'id',in:'path',required:true,schema:{type:'string',format:'uuid'}}];
 const replies=(schema:z.ZodType)=>({'200':{description:'当前空间/环境的AE成片采用计划或持久记录',content:{'application/json':{schema:z.toJSONSchema(response(schema))}}},...Object.fromEntries(['400','401','403','404','409','429','503'].map(c=>[c,{description:'输入、权限、固定来源、状态或实际媒体不可用',content:{'application/json':{schema:z.toJSONSchema(error)}}}]))});
 const get=(url:string,schema:z.ZodType,summary:string)=>{paths[url]={get:{summary,security:[{session:[]}],parameters,responses:replies(schema)}};};
 const post=(url:string,input:z.ZodType,schema:z.ZodType,summary:string,idem=true)=>{paths[url]={...paths[url],post:{summary,security:[{session:[]}],parameters:[...parameters,{name:'X-CSRF-Token',in:'header',required:true,schema:{type:'string'}},...(idem?[{name:'Idempotency-Key',in:'header',required:true,schema:{type:'string'}}]:[])],requestBody:{required:true,content:{'application/json':{schema:z.toJSONSchema(input,{io:'input'})}}},responses:replies(schema)}};};
 post(base+'/media-plan',aeMediaInput,aeMediaPlan,'核对固定AE视频/素材/使用期限，审阅独立成片工程计划；不要求渲染器',false);
 post(base+'/media-adoptions',aeMediaCreate,aeMediaJob,'明确确认后持久排队实际解码/原件入库/独立工程；同产物最多一个采用记录');
 get(base+'/media-adoption',aeMediaJob.nullable(),'读取产物已有的唯一采用记录，断线/刷新可继续');
 get(jobs,aeMediaJob,'读取持久采用进度、来源边界及工程编号');
 for(const action of ['cancel','retry','withdraw'])post(jobs+'/'+action,aeMediaConfirm,aeMediaJob,action==='withdraw'?'永久撤回AE采用用途，派生资产和工程停用':action==='retry'?'明确重试固定输入，最多三次，不产生重复工程':'取消当前AE采用，停止本任务私有检查');
}
