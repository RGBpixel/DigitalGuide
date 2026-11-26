import { z } from 'zod';
import * as b from './billing.js';
import * as s from './dining-service.js';
export function registerBillingSpec(paths:Record<string,Record<string,unknown>>,response:(schema:z.ZodType)=>z.ZodType,error:z.ZodType){
 const parameters=(path:string)=>Array.from(path.matchAll(/\{(\w+)\}/g),m=>({name:m[1],in:'path',required:true,schema:{type:'string',format:'uuid'}})),security=(path:string)=>path.startsWith('/guest/')?[{guestSession:[]}]:[{session:[]}],responses=(schema:z.ZodType)=>({'200':{description:'当前作用域内的服务器账单、模拟资金及服务状态',content:{'application/json':{schema:z.toJSONSchema(response(schema))}}},...Object.fromEntries(['400','401','403','404','409','429'].map(code=>[code,{description:'结构化错误及下一步',content:{'application/json':{schema:z.toJSONSchema(error)}}}]))});
 function get(path:string,schema:z.ZodType,summary:string){paths[path]={...paths[path],get:{summary,security:security(path),parameters:parameters(path),responses:responses(schema)}};}
 function post(path:string,schema:z.ZodObject,result:z.ZodType,summary:string){
  const guest=path.startsWith('/guest/'),body=guest&&'focusVersion' in schema.shape?schema.safeExtend({focusVersion:z.int().nonnegative()}):schema,json=z.toJSONSchema(body,{io:'input'}),native=guest&&[b.billReviewInput,b.financialConfirmInput,b.financialActionInput].some(value=>value===schema);
  const service=schema===s.diningServiceInput?s.nativeDiningServiceInput:schema===s.diningServiceActionInput?s.nativeDiningServiceActionInput:null;
  const aftercare=schema===s.feedbackInput?s.nativeAftercareFeedbackInput:schema===s.followupConsentInput?s.nativeAftercareFollowupInput:schema===s.aftercareRevokeInput?s.nativeAftercareRevokeInput:null,versioned=service??aftercare;
  const requestSchema=versioned?{oneOf:[json,z.toJSONSchema(guest?versioned.safeExtend({focusVersion:z.int().nonnegative(),selectionVersion:z.int().nonnegative()}):versioned,{io:'input'})],'x-native-postgres-schema-index':1,description:'原生PostgreSQL餐中/餐后服务使用第二分支，要求当前partyVersion；顾客还须提交当前focusVersion和selectionVersion。旧SQLite使用第一分支。'}:native?{oneOf:[json,{...z.toJSONSchema(body.safeExtend({selectionVersion:z.int().nonnegative()}),{io:'input'}),description:'原生 PostgreSQL 顾客写入须同时提交当前 focusVersion 和 selectionVersion。'}]}:json;
  paths[path]={...paths[path],post:{summary,security:security(path),parameters:[...parameters(path),{name:'Idempotency-Key',in:'header',required:true,schema:{type:'string',minLength:8,maxLength:128}},{name:'X-CSRF-Token',in:'header',required:true,schema:{type:'string'}}],requestBody:{required:true,content:{'application/json':{schema:requestSchema}}},responses:responses(result)}};
 }
 for(const guest of [false,true]){
  const base=guest?'/guest/sessions/{id}/dining':'/restaurant';
  get(base+'/parties/{partyId}/billing',b.partyBillingSchema,'本人当前组账单与未出账订单；收款和制作履行分别核实');
  post(base+'/orders/{orderId}/billing/review',b.billReviewInput,b.billSchema,'服务器从已接单有效数量及原价生成两分钟账单审阅');
  get(base+'/bills/{billId}',b.billSchema,'读取账单、单独资金事实及退款额度；未知不等于失败');
  get(base+'/bills/{billId}/receipt',b.receiptDocumentSchema,'仅核实结算后读取本地模拟收据；不是实际付款或税务发票');
  post(base+'/billing/confirm',b.financialConfirmInput,b.billSchema,'当前确认人核对令牌后创建收银入口或经理退款请求，创建入口不是付款');
  post(base+'/financial-operations/{operationId}/actions',b.financialActionInput,b.billSchema,'明确模拟付款、核对/关闭原支付或撤回未发送请求，未知不重发');
  get(base+'/parties/{partyId}/services',z.array(s.serviceRequestSchema),'当前顾客的服务请求，厨房无此权限');
  post(base+'/parties/{partyId}/services',s.diningServiceInput,s.serviceRequestSchema,'明确建立本次店员服务请求，不自动改变订单或付款');
  post(base+'/services/{requestId}/actions',s.diningServiceActionInput,s.serviceRequestSchema,'店员接收/完成，顾客或店员取消；版本与focus检查');
  get(base+'/parties/{partyId}/aftercare',s.diningAftercareSchema,'核实结束后送别、自愿评价和独立回访授权；只返回脱敏联系信息');
 }
 for(const [suffix,schema] of [['feedback',s.feedbackInput],['followup',s.followupConsentInput],['feedback/revoke',s.aftercareRevokeInput],['followup/revoke',s.aftercareRevokeInput]] as const)post('/guest/sessions/{id}/dining/parties/{partyId}/'+suffix,schema,s.diningAftercareSchema,'本人自愿评价/单独回访授权及撤回，联系方式加密且不进入记忆或日志');
 post('/restaurant/bills/{billId}/refund-review',b.refundReviewInput,b.billSchema,'仅本店经理审阅原收款、可退额及退款原因，未知退款继续保留额度');
 get('/restaurants/{id}/payments',b.paymentConfigSchema,'独立支付连接；未接入真实支付不回退模拟');post('/restaurants/{id}/payments',b.paymentConfigInput,b.paymentConfigSchema,'经理按版本配置显式模拟，生产环境禁止模拟');
 post('/restaurant/financial-operations/{operationId}/mock-result',b.financialFixtureInput,b.billSchema,'仅非生产经理为未知模拟请求建立显式测试事实，金额商户来自服务器原请求');
 get('/restaurants/{id}/services',z.array(s.serviceRequestSchema),'门店迎宾/经理服务队列，厨房不得访问顾客服务说明');
 get('/restaurants/{id}/aftercare',z.array(s.diningAftercareSchema.extend({partyName:z.string()})),'获授权店员查看自愿评价和脱敏回访状态，不读取完整联系方式');
 paths['/restaurant/aftercare/manage']={post:{summary:'原生本人餐后凭证：仅撤回一个评价或回访授权并清除内容',description:'凭证放在POST正文，不进入URL。无需原终端仍在线；不读取评价或联系方式、不授予顾客登录或任何员工/订单/支付权限。同一原凭证重复撤回不会重复推进版本；更新授权后旧凭证失效。同一原生实例的API共用数据库计数，每来源IP30次/分钟；仅保存服务端用途哈希。',security:[],'x-native-postgres-only':true,requestBody:{required:true,content:{'application/json':{schema:z.toJSONSchema(s.aftercareManagementInput,{io:'input'})}}},responses:{'200':{description:'仅本项清除状态，无私人内容',content:{'application/json':{schema:z.toJSONSchema(response(s.aftercareManagementResult))}}},...Object.fromEntries(['400','404','409','429','503'].map(code=>[code,{description:'明确拒绝或失败，不返回模拟成功',content:{'application/json':{schema:z.toJSONSchema(error)}}}]))}}};
 paths['/webhooks/mock-payments']={post:{summary:'仅模拟资金回执：验签、时窗、原金额/商户/币种匹配、去重与成功不降级',security:[],parameters:[{name:'X-Payment-Timestamp',in:'header',required:true,schema:{type:'string',format:'date-time'}},{name:'X-Payment-Signature',in:'header',required:true,schema:{type:'string',pattern:'^[a-f0-9]{64}$'}}],requestBody:{required:true,content:{'application/json':{schema:z.toJSONSchema(b.financialCallbackInput,{io:'input'})}}},responses:responses(z.strictObject({duplicate:z.boolean(),applied:z.boolean(),attention:z.boolean()}))}};
}
