import {z} from 'zod';
import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify';
import type {Repository} from '@digitalguide/database';
import {AppError} from '@digitalguide/domain';
import {memberCreateInput,memberAccessInput,memberDirectoryScope} from '../../../packages/contracts/src/member-directory.js';
import {IdentityWorkflows} from '../../../packages/enterprise/src/identity-workflows.js';
import {MemberWorkflows,type MemberMutation} from '../../../packages/enterprise/src/member-workflows.js';
import type {IdentityRuntime} from '../../../packages/enterprise/src/identity-runtime.js';
import {SqliteIdentityStore} from './identity-store.js';
import {authenticatedSession} from './auth-check.js';
import type {Config} from './config.js';
export function memberMutation(action:MemberMutation['action'],body:unknown):MemberMutation{return action==='create'?{action,input:memberCreateInput.parse(body)}:{action,input:memberAccessInput.parse(body)};}
export function registerMemberRoutes(app:FastifyInstance,repo:Repository,config:Config,runtime:IdentityRuntime,send:(req:FastifyRequest,reply:FastifyReply,data:unknown)=>unknown){
 const store=new SqliteIdentityStore(repo),workflow=new MemberWorkflows(new IdentityWorkflows(runtime));
 app.get('/api/v1/enterprise/members',(req,reply)=>{const{principal}=authenticatedSession(repo,req,config);return send(req,reply,store.run(workflow.view(principal,memberDirectoryScope.parse(req.query))));});
 for(const action of ['create','access'] as const)app.post('/api/v1/enterprise/members/'+action,(req,reply)=>{const input=memberMutation(action,req.body),key=z.string().min(8).max(128).parse(req.headers['idempotency-key']),{principal,csrfToken}=authenticatedSession(repo,req,config);if(req.headers['x-csrf-token']!==csrfToken)throw new AppError('FORBIDDEN','安全凭证已失效，请刷新后重试。',403);return send(req,reply,store.run(workflow.mutation(principal,input,key)));});
}
