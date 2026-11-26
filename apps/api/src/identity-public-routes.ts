import {randomBytes} from 'node:crypto';
import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify';
import {AppError} from '@digitalguide/domain';
import {identityStartInput} from '../../../packages/contracts/src/enterprise-identity.js';
import type {IdentityWorkflow} from '../../../packages/enterprise/src/identity-workflows.js';
import {IdentityWorkflows} from '../../../packages/enterprise/src/identity-workflows.js';
import type {IdentityRuntime} from '../../../packages/enterprise/src/identity-runtime.js';
export interface IdentityRunner{run<T>(workflow:IdentityWorkflow<T>):T|Promise<T>}
export function registerIdentityPublicRoutes(app:FastifyInstance,runtime:IdentityRuntime,store:IdentityRunner,cookieName:string,send:(req:FastifyRequest,reply:FastifyReply,data:unknown)=>unknown){
 const workflow=new IdentityWorkflows(runtime),browserCookie=cookieName+'_oidc',options={path:'/api/v1/auth/oidc',httpOnly:true,sameSite:'lax' as const,signed:true,secure:runtime.host.webOrigin.startsWith('https:'),maxAge:600};
 app.get('/api/v1/auth/methods',async(req,reply)=>send(req,reply,await store.run(workflow.methods())));
 app.post('/api/v1/auth/oidc/start',async(req,reply)=>{if(req.headers.origin!==runtime.host.webOrigin)throw new AppError('FORBIDDEN','请从当前工作台开始企业登录。',403);const {providerId}=identityStartInput.parse(req.body),provider=runtime.provider(providerId),saved=req.cookies[browserCookie]?req.unsignCookie(req.cookies[browserCookie]):null,browser=saved?.valid&&saved.value&&/^[a-f0-9]{64}$/.test(saved.value)?saved.value:randomBytes(32).toString('hex'),intent=await runtime.intent(provider),expiresAt=await store.run(workflow.start(provider,intent,browser));reply.setCookie(browserCookie,browser,options);return send(req,reply,{authorizationUrl:intent.authorizationUrl,expiresAt,mode:provider.mode});});
 app.get('/api/v1/auth/oidc/callback',async(req,reply)=>{
  reply.header('Referrer-Policy','no-referrer').header('Cache-Control','no-store');try{const url=new URL(req.url,runtime.host.webOrigin),state=url.searchParams.get('state'),saved=req.cookies[browserCookie]?req.unsignCookie(req.cookies[browserCookie]):null;if(url.pathname!=='/api/v1/auth/oidc/callback'||req.url.length>8192||url.searchParams.getAll('state').length!==1||!state||state.length>128||!saved?.valid||!saved.value)throw new Error('Invalid callback');const claim=await store.run(workflow.claim(state,saved.value)),verified=await runtime.verify(claim.provider,url,claim,state),session=await store.run(workflow.finish(claim.provider,claim.providerVersion,verified));reply.setCookie(cookieName,session.token,{path:'/api',httpOnly:true,sameSite:'strict',signed:true,secure:runtime.host.webOrigin.startsWith('https:'),maxAge:8*3600});return reply.code(303).redirect(runtime.host.webOrigin+'/');}catch{return reply.code(303).redirect(runtime.host.webOrigin+'/?sso=failed');}
 });
}
