import {z} from 'zod';
import {enterpriseScopeInput,enterprisePlanAssignInput,enterpriseSeatInput,enterprisePlanViewSchema} from './enterprise-plans.js';
export function registerEnterprisePlansSpec(paths:Record<string,unknown>,response:(s:z.ZodType)=>z.ZodType,error:z.ZodType){
 const schema=(s:z.ZodType)=>z.toJSONSchema(s,{io:'input'}),result=(s:z.ZodType)=>({description:'当前沙箱套餐与席位状态',content:{'application/json':{schema:z.toJSONSchema(response(s))}}});
 const failure={description:'输入、权限、当前版本或服务状态不满足操作条件',content:{'application/json':{schema:z.toJSONSchema(error)}}},errors={400:failure,401:failure,403:failure,404:failure,409:failure,503:failure};
 paths['/enterprise/plans']={get:{summary:'管理员查看本空间成员与组织沙箱套餐',security:[{session:[]}],parameters:[{in:'query',name:'workspaceId',required:true,schema:schema(enterpriseScopeInput.shape.workspaceId)}],responses:{200:result(enterprisePlanViewSchema),...errors}}};
 for(const[action,input]of [['assign',enterprisePlanAssignInput],['seats',enterpriseSeatInput]] as const)paths['/enterprise/plans/'+action]={post:{summary:action==='assign'?'明确分配或续期沙箱套餐，不触发收费':'分配或释放制作席位，不改变成员权限',security:[{session:[]}],parameters:[{in:'header',name:'Idempotency-Key',required:true,schema:{type:'string',minLength:8,maxLength:128}},{in:'header',name:'X-CSRF-Token',required:true,schema:{type:'string'}}],requestBody:{required:true,content:{'application/json':{schema:schema(input)}}},responses:{200:result(z.strictObject({receiptId:z.uuid(),view:enterprisePlanViewSchema})),...errors}}};
}
