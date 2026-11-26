import {z} from 'zod';
import {operationsMetricsQuery,operationsMetricsSchema} from './operations.js';
export function registerOperationsSpec(paths:Record<string,unknown>,response:(s:z.ZodType)=>z.ZodType,error:z.ZodType){
 paths['/operations-metrics']={get:{summary:'管理员读取单工作空间跨场景运营快照；未知费用不计为零',security:[{session:[]}],parameters:Object.entries(operationsMetricsQuery.shape).map(([name,schema])=>({name,in:'query',required:name==='workspaceId',schema:z.toJSONSchema(schema,{io:'input'})})),responses:{200:{description:'只读运营汇总；未迁移指标显式不可用，金额未经过正式账单核对',content:{'application/json':{schema:z.toJSONSchema(response(operationsMetricsSchema))}}},401:{description:'登录失效',content:{'application/json':{schema:z.toJSONSchema(error)}}},403:{description:'需要运营读取权限'},404:{description:'工作空间不存在或无权限'}}}};
}
