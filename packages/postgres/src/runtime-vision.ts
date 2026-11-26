import {z} from 'zod';
import type {VisualState,VisualGrant,visualGrantInput,visualQuestionInput,visualRevokeInput} from '../../contracts/src/index.js';
import {AppError} from '../../domain/src/index.js';
import {selectVisionProvider,type VisionProvider} from '../../providers/src/runtime.js';
import {NativeReception,receptionHash,type NativeReceptionMeta} from './runtime-reception.js';
import type {NativeCoreRepository} from './runtime-repository.js';
export interface NativeVisualProof{tokenHash:string;csrfHash:string;csrfToken:string}
export interface NativeVisualFrame{frame:Buffer;width:number;height:number;imageHash:string}
export interface NativeVisualClaim{requestId:string;replay:boolean;attemptId?:string;leaseUntil?:string;expiresAt?:string;source?:'camera'|'screen';provider?:string;width?:number;height?:number}
const errors:Record<string,[number,string]>={AUTH_REQUIRED:[401,'本次接待访问已失效，请由工作人员重新打开。'],FORBIDDEN:[403,'当前凭证不能执行此画面操作，请刷新本人终端。'],NOT_FOUND:[404,'当前会话没有此画面授权。'],SESSION_ENDED:[410,'本次接待已结束，请联系工作人员。'],VERSION_CONFLICT:[409,'当前接待或服务对象已变化，请重新核对画面。'],SOURCE_UNAVAILABLE:[409,'角色或场景已停用，画面结果未采用。'],CAPABILITY_UNAVAILABLE:[409,'此场景未允许该画面来源，请继续文字接待。'],PROVIDER_NOT_CONFIGURED:[409,'所选视觉服务尚未接通，不会退回模拟识别。'],VALIDATION_FAILED:[400,'画面输入或同意信息无效，请重新核对。'],VISUAL_CONTEXT_REVOKED:[409,'画面授权或当前回合已结束，迟到结果不会采用。'],FRAME_EXPIRED:[409,'画面已过期，请重新截取当前画面。'],IDEMPOTENCY_CONFLICT:[409,'同一画面操作的内容已变化，请重新发起。'],REQUEST_IN_PROGRESS:[409,'本次画面仍在处理，请等待或撤回授权。'],REQUEST_CANCELLED:[409,'画面请求已取消，请重新选择当前画面。'],VISION_TIMEOUT:[409,'画面处理已超过原期限，请重新提问或请求人工。'],PROVIDER_CONTRACT_INVALID:[502,'视觉服务返回内容不符合当前模拟契约，结果未采用。'],VISION_PROVIDER_FAILED:[502,'视觉服务未完成本次请求，请重试或请求人工。'],RATE_LIMITED:[429,'画面操作过于频繁，请稍后重试。'],QUOTA_EXCEEDED:[409,'当前会话已达到消息上限，请开始新接待。']};
export class NativeVision{
 readonly reception:NativeReception;
 constructor(readonly core:NativeCoreRepository){this.reception=new NativeReception(core);}
 get db(){return this.core.db;}
 async call<T>(fn:string,args:unknown[]=[]):Promise<T>{try{return(await this.db.query<{value:T}>('SELECT '+fn+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') value',args)).rows[0].value;}catch(error){const text=error instanceof Error?error.message:'',code=text.startsWith('DGVISION:')?text.slice(9):text.startsWith('DGRECEPTION:')?text.slice(12):'',known=errors[code];if(known)throw new AppError(code,known[1],known[0]);throw error;}}
 state(id:string,p:NativeVisualProof){return this.call<VisualState>('dg_native_visual_state',[id,p.tokenHash]);}
 grant(id:string,p:NativeVisualProof,input:z.infer<typeof visualGrantInput>){return this.call<string>('dg_native_visual_grant',[id,p.tokenHash,p.csrfHash,input]);}
 grantView(id:string,p:NativeVisualProof,item:string){return this.call<VisualGrant>('dg_native_visual_grant_view',[id,p.tokenHash,item]);}
 revoke(id:string,p:NativeVisualProof,input:z.infer<typeof visualRevokeInput>){return this.call<string>('dg_native_visual_revoke',[id,p.tokenHash,p.csrfHash,input]);}
 begin(id:string,p:NativeVisualProof,key:string,input:z.infer<typeof visualQuestionInput>,image:NativeVisualFrame){return this.call<NativeVisualClaim>('dg_native_visual_begin',[id,p.tokenHash,p.csrfHash,receptionHash(key),{version:input.version,focusVersion:input.focusVersion,grantId:input.grantId,grantVersion:input.grantVersion,question:input.question,capturedAt:input.capturedAt,imageHash:image.imageHash,width:image.width,height:image.height}]);}
 provider(id:string):VisionProvider{return selectVisionProvider(id,'mock',this.db.config.appEnv);}
 async inspect(claim:NativeVisualClaim,image:NativeVisualFrame,question:string,external:AbortSignal){
  if(claim.replay||!claim.attemptId||!claim.leaseUntil||!claim.source||!claim.provider)throw new AppError('PROVIDER_CONTRACT_INVALID',errors.PROVIDER_CONTRACT_INVALID[1],502);
  const controller=new AbortController(),relay=()=>controller.abort('request_cancelled'),deadline=Date.parse(claim.leaseUntil),remaining=Math.min(8000,deadline-Date.now());let timedOut=false,done=false,pollTimer:ReturnType<typeof setTimeout>|undefined,checking:Promise<void>|undefined,onAbort=()=>{};
  external.addEventListener('abort',relay,{once:true});if(external.aborted)relay();
  const timer=setTimeout(()=>{timedOut=true;controller.abort('timeout');},Math.max(1,remaining));
  const schedule=()=>{pollTimer=setTimeout(()=>{checking=this.db.transaction(()=>this.call<boolean>('dg_native_visual_execution_valid',[claim.requestId,claim.attemptId]),true).then(valid=>{if(!valid)controller.abort('context_revoked');}).catch(()=>controller.abort('context_revoked')).finally(()=>{if(!done)schedule();});},100);};
  try{
   if(remaining<=0)throw new AppError('VISION_TIMEOUT',errors.VISION_TIMEOUT[1],409);
   if(controller.signal.aborted)throw new AppError('REQUEST_CANCELLED',errors.REQUEST_CANCELLED[1],409);
   const cancelled=new Promise<never>((_resolve,reject)=>{onAbort=()=>{const code=timedOut?'VISION_TIMEOUT':controller.signal.reason==='request_cancelled'?'REQUEST_CANCELLED':'VISUAL_CONTEXT_REVOKED';reject(new AppError(code,errors[code][1],errors[code][0]));};controller.signal.addEventListener('abort',onAbort,{once:true});});
   schedule();const raw=await Promise.race([this.provider(claim.provider).inspect({frame:image.frame,width:image.width,height:image.height,source:claim.source,question,signal:controller.signal}),cancelled]);
   const parsed=z.strictObject({text:z.string().trim().min(1).max(5000),simulated:z.literal(true)}).safeParse(raw);if(!parsed.success)throw new AppError('PROVIDER_CONTRACT_INVALID',errors.PROVIDER_CONTRACT_INVALID[1],502);return parsed.data;
  }finally{done=true;clearTimeout(timer);if(pollTimer)clearTimeout(pollTimer);controller.signal.removeEventListener('abort',onAbort);external.removeEventListener('abort',relay);image.frame.fill(0);await checking;}
 }
 complete(id:string,p:NativeVisualProof,claim:NativeVisualClaim,result:{text:string;simulated:true}){return this.call<void>('dg_native_visual_complete',[id,p.tokenHash,p.csrfHash,claim.requestId,claim.attemptId,result]);}
 fail(claim:NativeVisualClaim,code:string){return this.call<void>('dg_native_visual_fail',[claim.requestId,claim.attemptId,code]);}
 async authorize(id:string,p:NativeVisualProof,write=false):Promise<NativeReceptionMeta>{return this.reception.guest(id,p.tokenHash,write?p.csrfHash:null,write);}
}
