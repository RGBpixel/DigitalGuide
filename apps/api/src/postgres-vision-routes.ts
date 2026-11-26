import {timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import type {FastifyRequest,FastifyReply} from 'fastify';
import {AppError} from '@digitalguide/domain';
import {visualGrantInput,visualRevokeInput,visualQuestionInput} from '@digitalguide/contracts';
import {nativeReceptionCookieName} from '../../../packages/postgres/src/runtime-reception.js';
import {NativeVision,type NativeVisualClaim,type NativeVisualFrame} from '../../../packages/postgres/src/runtime-vision.js';
import type {RouteContext} from './postgres-asset-routes.js';
import type {Config} from './config.js';
import {visualFrame} from './visual-frame.js';
export function registerNativeVisionRoutes(context:RouteContext,config:Config){
 const{app,repo}=context,s=new NativeVision(repo),r=s.reception,base='/api/v1/guest/sessions/:id/vision',id=(req:FastifyRequest)=>z.uuid().parse((req.params as{id:string}).id),key=(req:FastifyRequest)=>z.string().min(8).max(128).parse(req.headers['idempotency-key']),cookie=nativeReceptionCookieName(config.nativePostgres!.runtimeId),send=(req:FastifyRequest,reply:FastifyReply,value:unknown)=>context.send(req,reply.header('Cache-Control','private, no-store'),value);
 function proof(req:FastifyRequest,write=false){const p=r.credentials(config.sessionSecret,config.nativePostgres!.runtimeId,id(req),req.cookies[cookie]);if(write){const supplied=req.headers['x-csrf-token'];if(typeof supplied!=='string'||Buffer.byteLength(supplied)!==Buffer.byteLength(p.csrfToken)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(p.csrfToken)))throw new AppError('FORBIDDEN','请刷新本人终端后重新核对画面。',403);}return p;}
 async function prepare(req:FastifyRequest,write=false){const p=proof(req,write);try{await repo.db.transaction(()=>s.authorize(id(req),p));}catch(error){await repo.db.transaction(()=>r.sweep()).catch(()=>undefined);throw error;}await repo.db.transaction(()=>r.sweep());return p;}
 app.get(base,async(req,reply)=>{const p=await prepare(req);return send(req,reply,await repo.db.transaction(async()=>{await s.authorize(id(req),p);return s.state(id(req),p);}));});
 app.post(base+'/grants',async(req,reply)=>{const b=visualGrantInput.parse(req.body),p=await prepare(req,true);const result=await repo.db.transaction(async()=>{const meta=await s.authorize(id(req),p,true);if(meta.focusVersion!==b.focusVersion)throw new AppError('VERSION_CONFLICT','服务对象已变化，请重新核对。',409);const actor=r.guestActor(meta),grant=await repo.idempotentResource(actor,{action:req.method+' '+req.url.split('?')[0],key:key(req),body:b,code:200},()=>s.grant(id(req),p,b));return s.grantView(id(req),p,grant);});return send(req,reply,result);});
 app.post(base+'/revoke',async(req,reply)=>{const b=visualRevokeInput.parse(req.body),p=await prepare(req,true);const grant=await repo.db.transaction(async()=>{const meta=await s.authorize(id(req),p,true);if(meta.focusVersion!==b.focusVersion)throw new AppError('VERSION_CONFLICT','服务对象已变化，旧画面操作不可继续。',409);return repo.idempotentResource(r.guestActor(meta),{action:req.method+' '+req.url.split('?')[0],key:key(req),body:b,code:200},()=>s.revoke(id(req),p,b));});return send(req,reply,{revoked:true,grantId:grant});});
 app.post(base+'/questions',async(req,reply)=>{
  let image:NativeVisualFrame|undefined,claim:NativeVisualClaim|undefined,input:z.infer<typeof visualQuestionInput>|undefined;const controller=new AbortController(),closed=()=>{if(!reply.sent)controller.abort('request_cancelled');};reply.raw.once('close',closed);
  try{
   const p=await prepare(req,true);input=visualQuestionInput.parse(req.body);const requestKey=key(req);image=visualFrame(input.frameBase64);
   claim=await repo.db.transaction(async()=>{await s.authorize(id(req),p,true);return s.begin(id(req),p,requestKey,input!,image!);});
   if(!claim.replay){const result=await s.inspect(claim,image,input.question,controller.signal);await repo.db.transaction(async()=>{await s.authorize(id(req),p,true);await s.complete(id(req),p,claim!,result);});}
   const view=await repo.db.transaction(async()=>{await s.authorize(id(req),p);return r.guestView(id(req),p.tokenHash,p.csrfToken);});return send(req,reply,view);
  }catch(error){if(claim?.attemptId&&!claim.replay)await repo.db.transaction(()=>s.fail(claim!,error instanceof AppError?error.code:'VISION_PROVIDER_FAILED')).catch(()=>undefined);if(error instanceof AppError||error instanceof z.ZodError)throw error;throw new AppError('VISION_PROVIDER_FAILED','画面处理未完成，结果未采用；请继续文字或请求人工。',502);}
  finally{reply.raw.off('close',closed);image?.frame.fill(0);if(input)input.frameBase64='';if(req.body&&typeof req.body==='object'&&'frameBase64'in req.body)(req.body as{frameBase64:string}).frameBase64='';}
 });
}
