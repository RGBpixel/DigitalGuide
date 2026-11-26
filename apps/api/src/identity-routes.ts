import {registerMemberRoutes} from './member-routes.js';
import {z} from 'zod';
import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify';
import type {Repository} from '@digitalguide/database';
import {AppError} from '@digitalguide/domain';
import {identityScopeInput,identityProviderInput,identityBindingInput,identityBindingControlInput,identityMemberInput} from '../../../packages/contracts/src/enterprise-identity.js';
import {IdentityWorkflows,type IdentityMutation} from '../../../packages/enterprise/src/identity-workflows.js';
import type {IdentityRuntime} from '../../../packages/enterprise/src/identity-runtime.js';
import {SqliteIdentityStore} from './identity-store.js';
import {registerIdentityPublicRoutes} from './identity-public-routes.js';
import {authenticatedSession} from './auth-check.js';
import type {Config} from './config.js';
export function identityMutation(action:IdentityMutation['action'],body:unknown):IdentityMutation{switch(action){case'provider':return{action,input:identityProviderInput.parse(body)};case'binding':return{action,input:identityBindingInput.parse(body)};case'binding-control':return{action,input:identityBindingControlInput.parse(body)};case'member':return{action,input:identityMemberInput.parse(body)};}}
export function registerIdentityRoutes(app:FastifyInstance,repo:Repository,config:Config,runtime:IdentityRuntime,send:(req:FastifyRequest,reply:FastifyReply,data:unknown)=>unknown){
 registerMemberRoutes(app,repo,config,runtime,send);const store=new SqliteIdentityStore(repo),workflow=new IdentityWorkflows(runtime);registerIdentityPublicRoutes(app,runtime,store,'dg_session',send);
 app.get('/api/v1/enterprise/identity',(req,reply)=>{const {principal}=authenticatedSession(repo,req,config);return send(req,reply,store.run(workflow.view(principal,identityScopeInput.parse(req.query))));});
 for(const action of ['provider','binding','binding-control','member'] as const)app.post('/api/v1/enterprise/identity/'+action,(req,reply)=>{const input=identityMutation(action,req.body),key=z.string().min(8).max(128).parse(req.headers['idempotency-key']),{principal,csrfToken}=authenticatedSession(repo,req,config);if(req.headers['x-csrf-token']!==csrfToken)throw new AppError('FORBIDDEN','安全凭证已失效，请刷新后重试。',403);return send(req,reply,store.run(workflow.mutation(principal,input,key)));});
}
