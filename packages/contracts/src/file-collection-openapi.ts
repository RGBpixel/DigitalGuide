import {z} from 'zod';
import * as c from './file-collections.js';
export function registerFileCollectionSpec(paths:Record<string,Record<string,unknown>>,response:(s:z.ZodType)=>z.ZodType,error:z.ZodType){
  const base='/asset-collections',external='/external/file-collections',page=(s:z.ZodType)=>z.strictObject({items:z.array(s),nextCursor:z.uuid().nullable()}),params=(path:string)=>[...path.matchAll(/\{(\w+)\}/g)].map(m=>({name:m[1],in:'path',required:true,schema:{type:'string',format:m[1]==='kind'?undefined:'uuid',...(m[1]==='kind'?{enum:['original','poster','preview']}:{})}})),responses=(schema:z.ZodType)=>({'200':{description:'当前身份/来源/期限下的状态；上传不等于验收或训练授权',content:{'application/json':{schema:z.toJSONSchema(response(schema))}}},...Object.fromEntries(['400','401','403','404','409','413','422','429','500'].map(code=>[code,{description:'明确错误及下一步，外部响应不含内部身份/原件',content:{'application/json':{schema:z.toJSONSchema(error)}}}]))});
  function get(path:string,schema:z.ZodType,summary:string,publicRoute=false,query:unknown[]=[]){paths[path]={...paths[path],get:{summary,security:[publicRoute?{collectionSession:[]}:{session:[]}],parameters:[...params(path),...query],responses:responses(schema)}};}
  function post(path:string,input:z.ZodType,schema:z.ZodType,summary:string,publicRoute=false,join=false){paths[path]={...paths[path],post:{summary,security:join?[]:[publicRoute?{collectionSession:[]}:{session:[]}],parameters:[...params(path),...(!join?[{name:'X-CSRF-Token',in:'header',required:true,schema:{type:'string'}}]:[]),{name:'Idempotency-Key',in:'header',required:true,schema:{type:'string',minLength:8,maxLength:128}},...(publicRoute?[{name:'Origin',in:'header',required:true,schema:{type:'string'}}]:[])],requestBody:{required:true,content:{'application/json':{schema:z.toJSONSchema(input,{io:'input'})}}},responses:responses(schema)}};}
  const paging=[{name:'cursor',in:'query',schema:{type:'string',format:'uuid'}},{name:'limit',in:'query',schema:{type:'integer',minimum:1,maximum:100}}],receipt=base+'/{id}/receipts/{receiptId}';
  get(base,page(c.fileCollectionSchema),'编辑成员按环境和工作空间分页浏览文件收集',false,[{name:'workspaceId',in:'query',required:true,schema:{type:'string',format:'uuid'}},...paging,{name:'state',in:'query',schema:{type:'string',enum:['open','closed','all']}}]);
  post(base,c.collectionCreate,c.fileCollectionSchema,'创建不可变范围的文件收集，明确类型/容量/截止时间');
  get(base+'/{id}',c.fileCollectionSchema,'读取收集状态和建议入库位置');
  post(base+'/{id}/close',c.collectionClose,c.fileCollectionSchema,'永久关闭新上传；已提交文件和已验收素材分别保管');
  get(base+'/{id}/links',z.array(c.collectionLinkSchema),'邀请元数据，不返回访问密钥');
  post(base+'/{id}/links',c.collectionLinkCreate,z.strictObject({link:c.collectionLinkSchema,invitationUrl:z.string()}),'创建最多七天/不超过收集截止的独立上传邀请，不对外发送');
  post(base+'/{id}/links/{linkId}/revoke',c.collectionLinkRevoke,c.collectionLinkSchema,'永久撤回上传邀请，已提交文件仍可在内部验收');
  get(base+'/{id}/receipts',page(c.collectionReceiptSchema),'分页读取隔离收件箱，只有编辑成员可看原件',false,[...paging,{name:'status',in:'query',schema:z.toJSONSchema(c.collectionReceiptStatus)}]);
  get(receipt,c.collectionReceiptSchema,'读取真实检查、来源期限和独立使用许可状态');
  post(receipt+'/accept',c.collectionReceiptAccept,c.collectionReceiptSchema,'检查实际字节后明确验收入库，不复制或创建训练/克隆授权');
  post(receipt+'/reject',c.collectionReceiptReject,c.collectionReceiptSchema,'拒收并清理待验收文件，内部原因不向受邀者泄漏');
  for(const action of ['cancel','retry'])post(receipt+'/'+action,c.collectionReceiptControl,c.collectionReceiptSchema,action==='cancel'?'停止未验收文件，拒绝迟到结果':'有界重试相同文件检查，不重新占用登记额度');
  post(receipt+'/revoke-use',c.collectionUseRevoke,c.collectionReceiptSchema,'永久撤回入库素材使用许可，保留工程历史');
  paths[receipt+'/files/{kind}']={get:{summary:'编辑成员读取隔离原件/实际封面/浅底播放副本；验收后继续检查独立许可；摘要后重鉴权',security:[{session:[]}],parameters:params(receipt+'/files/{kind}'),responses:{'200':{description:'实际受控文件',content:{'application/octet-stream':{schema:{type:'string',format:'binary'}}}},'206':{description:'私有Range'},'401':{description:'会话失效'},'403':{description:'无编辑权限'},'404':{description:'范围不符或文件不存在'},'409':{description:'期限、用途、状态或实际摘要无效'}}}};
  post(external+'/{id}/join',c.collectionJoin,c.externalCollectionContextSchema,'片段凭证换取独立路径HttpOnly上传会话，不授予成员身份',true,true);
  get(external+'/{id}/context',c.externalCollectionContextSchema,'本次邀请及本人自报会话，无内部目录/人员信息',true);
  get(external+'/{id}/receipts',page(c.collectionReceiptSchema),'仅本人会话的上传回执；所有内部媒体URL/资产ID/内部意见均为空',true,paging);
  post(external+'/{id}/receipts',c.collectionReceiptCreate,c.collectionReceiptSchema,'按文件指纹及登记ID持久化接收；生命周期容量不能靠取消重置',true);
  const own=external+'/{id}/receipts/{receiptId}';get(own,c.collectionReceiptSchema,'仅本人回执，不提供媒体下载或其他人的文件',true);
  post(own+'/parts',c.collectionPartInput,c.collectionReceiptSchema,'校验固定指纹与4MB分片，不能覆盖其他文件',true);
  post(own+'/submit',c.collectionReceiptControl,c.collectionReceiptSchema,'明确提交后进入真实格式/解码检查；不会自动入库',true);
  for(const action of ['cancel','retry'])post(own+'/'+action,c.collectionReceiptControl,c.collectionReceiptSchema,action==='cancel'?'本人停止未验收文件':'本人有界重试相同已提交文件',true);
  post(external+'/{id}/leave',z.strictObject({confirmed:z.literal(true)}),z.strictObject({closed:z.literal(true)}),'关闭上传会话和未提交文件，保留已提交回执',true);
}
