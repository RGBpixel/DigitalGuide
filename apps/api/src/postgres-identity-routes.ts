import type {DeveloperStudioAdapter} from './developer-studio-ports.js';
import type {DeveloperStudioWorkflows} from '../../../packages/enterprise/src/developer-studio-workflows.js';
import type {WebhookRuntime} from '../../../packages/enterprise/src/webhook-runtime.js';
import {registerDeveloperRoutes} from './developer-routes.js';
import {DeveloperWorkflows} from '../../../packages/enterprise/src/developer-workflows.js';
import {DirectoryWorkflows} from '../../../packages/enterprise/src/directory-workflows.js';
import type {DirectoryRuntime} from '../../../packages/enterprise/src/directory-runtime.js';
import {registerDirectoryAdminRoutes,registerScimRoutes} from './directory-routes.js';
import {memberDirectoryScope} from '../../../packages/contracts/src/member-directory.js';
import {MemberWorkflows} from '../../../packages/enterprise/src/member-workflows.js';
import {memberMutation} from './member-routes.js';
import {z} from 'zod';
import type {FastifyRequest} from 'fastify';
import {AppError} from '@digitalguide/domain';
import {identityScopeInput} from '../../../packages/contracts/src/enterprise-identity.js';
import {IdentityWorkflows} from '../../../packages/enterprise/src/identity-workflows.js';
import type {IdentityRuntime} from '../../../packages/enterprise/src/identity-runtime.js';
import {NativeIdentityStore,identityOrganizationKey} from '../../../packages/postgres/src/runtime-identity-store.js';
import {nativeRuntimeCookieName} from '../../../packages/postgres/src/runtime-config.js';
import {identityMutation} from './identity-routes.js';
import {registerIdentityPublicRoutes} from './identity-public-routes.js';
import type {RouteContext} from './postgres-asset-routes.js';
export function registerNativeIdentityRoutes({app,repo,authenticated,send}:RouteContext,runtime:IdentityRuntime,tokenHash:(req:FastifyRequest)=>string,directoryRuntime:DirectoryRuntime,webhookRuntime?:WebhookRuntime,studioFactory?:(workflow:DeveloperStudioWorkflows)=>DeveloperStudioAdapter){
 const store=new NativeIdentityStore(repo),workflow=new IdentityWorkflows(runtime),db=repo.db;registerIdentityPublicRoutes(app,runtime,store,nativeRuntimeCookieName(db.config.runtimeId),send);
 // Organization lock precedes all session/member locks for these organization-wide changes.
 async function scoped<T>(req:FastifyRequest,write:boolean,work:Parameters<typeof authenticated<T>>[1]){return db.transaction(async()=>{const hash=tokenHash(req),tenant=(await db.query<{tenant_id:string}>('SELECT m.tenant_id FROM auth_sessions s JOIN memberships m ON m.user_id=s.user_id WHERE s.token_hash=$1 AND s.environment=$2 AND s.app_env=$3',[hash,'mock',db.config.appEnv])).rows[0]?.tenant_id;if(!tenant)throw new AppError('AUTH_REQUIRED','请先登录当前工作空间。',401);await db.advisoryLock(identityOrganizationKey(tenant,'mock',db.config.appEnv),write);return authenticated(req,async session=>{if(session.principal.tenantId!==tenant)throw new AppError('AUTH_REQUIRED','账户组织已变化，请重新登录。',401);return work(session);},write);});}
 const directoryStore=new NativeIdentityStore(repo,id=>{directoryRuntime.rotate(id);}),directoryWorkflow=new DirectoryWorkflows(workflow,directoryRuntime);registerScimRoutes(app,directoryWorkflow,directoryStore);registerDirectoryAdminRoutes(app,directoryWorkflow,directoryStore,(req,write,work)=>scoped(req,write,({principal})=>Promise.resolve(work(principal))),send);
 registerDeveloperRoutes(app,new DeveloperWorkflows({providerMode:'mock',appEnv:db.config.appEnv},workflow,true,!!webhookRuntime,!!studioFactory),store,(req,write,work)=>scoped(req,write,({principal})=>Promise.resolve(work(principal))),send,webhookRuntime,studioFactory);
 const members=new MemberWorkflows(workflow);
 app.get('/api/v1/enterprise/members',async(req,reply)=>send(req,reply,await scoped(req,false,async({principal})=>store.run(members.view(principal,memberDirectoryScope.parse(req.query))))));
 for(const action of ['create','access'] as const)app.post('/api/v1/enterprise/members/'+action,async(req,reply)=>{const input=memberMutation(action,req.body),key=z.string().min(8).max(128).parse(req.headers['idempotency-key']);return send(req,reply,await scoped(req,true,async({principal})=>store.run(members.mutation(principal,input,key))));});
 app.get('/api/v1/enterprise/identity',async(req,reply)=>send(req,reply,await scoped(req,false,async({principal})=>store.run(workflow.view(principal,identityScopeInput.parse(req.query))))));
 for(const action of ['provider','binding','binding-control','member'] as const)app.post('/api/v1/enterprise/identity/'+action,async(req,reply)=>{const input=identityMutation(action,req.body),key=z.string().min(8).max(128).parse(req.headers['idempotency-key']);return send(req,reply,await scoped(req,true,async({principal})=>store.run(workflow.mutation(principal,input,key))));});
}
