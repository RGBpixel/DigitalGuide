import {timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import type {FastifyRequest,FastifyReply} from 'fastify';
import {AppError} from '@digitalguide/domain';
import {proactiveSettingsInput} from '@digitalguide/contracts';
import {NativeReception,nativeReceptionCookieName} from '../../../packages/postgres/src/runtime-reception.js';
import {NativeGuestMemory} from '../../../packages/postgres/src/runtime-guest-memory.js';
import {NativeProactive} from '../../../packages/postgres/src/runtime-proactive.js';
import type {RouteContext} from './postgres-asset-routes.js';
import type {Config} from './config.js';
export function registerNativeProactiveRoutes(context:RouteContext,config:Config){
 const{app,repo}=context,reception=new NativeReception(repo),memory=new NativeGuestMemory(repo),proactive=new NativeProactive(repo),runtimeId=config.nativePostgres!.runtimeId,cookieName=nativeReceptionCookieName(runtimeId),base='/api/v1/guest/sessions/:id/proactive',id=(req:FastifyRequest)=>z.uuid().parse((req.params as{id:string}).id),key=(req:FastifyRequest)=>z.string().min(8).max(128).parse(req.headers['idempotency-key']),send=(req:FastifyRequest,reply:FastifyReply,value:unknown)=>context.send(req,reply.header('Cache-Control','private, no-store'),value);
 async function prepare(req:FastifyRequest,write=false){const proof=reception.credentials(config.sessionSecret,runtimeId,id(req),req.cookies[cookieName]);if(write){const csrf=req.headers['x-csrf-token'];if(typeof csrf!=='string'||Buffer.byteLength(csrf)!==Buffer.byteLength(proof.csrfToken)||!timingSafeEqual(Buffer.from(csrf),Buffer.from(proof.csrfToken)))throw new AppError('FORBIDDEN','本次终端安全凭证已变化，请刷新后核对。',403);}const meta=await repo.db.transaction(()=>reception.guest(id(req),proof.tokenHash,null));if(meta.serviceScene!=='restaurant')throw new AppError('NOT_FOUND','请从本店顾客终端管理本次主动问候。',404);await repo.db.transaction(()=>reception.sweep());await repo.db.transaction(()=>memory.sweep());return proof;}
 app.get(base,async(req,reply)=>{const proof=await prepare(req);return send(req,reply,await repo.db.transaction(()=>proactive.view(id(req),proof.tokenHash)));});
 app.post(base,async(req,reply)=>{const body=proactiveSettingsInput.parse(req.body),proof=await prepare(req,true);return send(req,reply,await repo.db.transaction(async()=>{const meta=await reception.guest(id(req),proof.tokenHash,proof.csrfHash,true);if(body.focusVersion!==meta.focusVersion)throw new AppError('VERSION_CONFLICT','当前发问人已变化，请重新确认本次到店问候用途。',409);const actor=reception.guestActor(meta),receipt=await repo.idempotentResource(actor,{action:req.method+' '+req.url.split('?')[0],key:key(req),body,code:200},async()=>{const receipt=await proactive.apply(meta.id,proof.tokenHash,proof.csrfHash,body);await repo.audit(actor,meta.workspaceId,'session.proactive_settings',meta.id,req.id);return receipt;});return proactive.result(receipt,meta.id,proof.tokenHash);}));});
}
