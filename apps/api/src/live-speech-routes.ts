import {z} from 'zod';
import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify';
import type {Repository} from '@digitalguide/database';
import {AppError,type Principal} from '@digitalguide/domain';
import {liveSpeechPlanCreate,liveSpeechPlanControl,liveSpeechJobCreate,liveSpeechJobControl,liveSpeechPlay} from '@digitalguide/contracts';
import {fileDigest} from '../../../packages/media/src/files.js';
import {LiveSpeech} from './live-speech-service.js';
import {authenticatedSession} from './auth-check.js';
import {executeIdempotent} from './idempotency.js';
import {privateFile} from './private-file.js';
import type {Config} from './config.js';
export function registerLiveSpeechRoutes(app:FastifyInstance,repo:Repository,config:Config){
 const service=new LiveSpeech(repo,config),id=z.uuid(),key=(req:FastifyRequest)=>id.parse((req.params as {id:string}).id),fresh=(req:FastifyRequest,write=false)=>{const s=authenticatedSession(repo,req,config);if(write&&s.csrfToken!==req.headers['x-csrf-token'])throw new AppError('FORBIDDEN','安全凭证已更新，请重新登录。',403);return s.principal;},send=(req:FastifyRequest,reply:FastifyReply,data:unknown)=>reply.header('Cache-Control','private, no-store').send({data,requestId:req.id});
 function write(req:FastifyRequest,reply:FastifyReply,guard:(p:Principal)=>unknown,work:(p:Principal)=>{id:string;workspaceId:string},view:(p:Principal,id:string)=>unknown){guard(fresh(req,true));const p=fresh(req,true),result=executeIdempotent(repo,req,p.tenantId,p.userId,()=>{const current=fresh(req,true);guard(current);const r=work(current);repo.audit(current,r.workspaceId,'live.speech.'+req.routeOptions.url,r.id,req.id);return{id:r.id};});return send(req,reply,repo.transaction(()=>{const current=fresh(req,true);guard(current);return view(current,result.data.id);}));}
 const sessionGuard=(req:FastifyRequest)=>(p:Principal)=>{const s=service.live.session(p,key(req));service.live.scope(p,s.workspace_id,'live.start');},planView=(p:Principal,id:string)=>service.planView(p,service.plan(p,id)),jobView=(p:Principal,id:string)=>service.jobView(p,service.job(p,id));
 app.get('/api/v1/live-speech/capabilities',async(req,reply)=>{const q=z.strictObject({workspaceId:id}).parse(req.query);service.live.scope(fresh(req),q.workspaceId);const cap=await service.capabilities();service.live.scope(fresh(req),q.workspaceId);return send(req,reply,cap);});
 app.get('/api/v1/live-sessions/:id/speech',(req,reply)=>send(req,reply,service.sessionView(fresh(req),key(req))));
 app.post('/api/v1/live-sessions/:id/speech-plans',async(req,reply)=>{const input=liveSpeechPlanCreate.parse(req.body);sessionGuard(req)(fresh(req,true));const voice=await service.prepareVoice(input);return write(req,reply,sessionGuard(req),p=>{const session=service.live.session(p,key(req));return{id:service.createPlan(p,session,input,voice),workspaceId:session.workspace_id};},planView);});
 app.post('/api/v1/live-sessions/:id/speech-jobs',(req,reply)=>{const input=liveSpeechJobCreate.parse(req.body);return write(req,reply,sessionGuard(req),p=>{const session=service.live.session(p,key(req));return{id:service.createJob(p,session,input),workspaceId:session.workspace_id};},jobView);});
 app.get('/api/v1/live-speech-plans/:id',(req,reply)=>send(req,reply,planView(fresh(req),key(req))));
 app.get('/api/v1/live-speech-jobs/:id',(req,reply)=>send(req,reply,jobView(fresh(req),key(req))));
 app.post('/api/v1/live-speech-plans/:id/control',(req,reply)=>{const input=liveSpeechPlanControl.parse(req.body);return write(req,reply,p=>service.plan(p,key(req),true),p=>{const r=service.plan(p,key(req),true);service.controlPlan(p,r,input);return{id:r.id,workspaceId:r.workspace_id};},planView);});
 app.post('/api/v1/live-speech-jobs/:id/control',(req,reply)=>{const input=liveSpeechJobControl.parse(req.body);return write(req,reply,p=>service.job(p,key(req),true),p=>{const r=service.job(p,key(req),true);service.controlJob(p,r,input);return{id:r.id,workspaceId:r.workspace_id};},jobView);});
 app.post('/api/v1/live-speech-jobs/:id/play',(req,reply)=>{const input=liveSpeechPlay.parse(req.body);return write(req,reply,p=>{const r=service.job(p,key(req),true);service.context(p,r,true);},p=>{const r=service.job(p,key(req),true);return{id:service.play(p,r,input),workspaceId:r.workspace_id};},(p,id)=>service.live.sessionView(p,service.live.session(p,id)));});
 app.get('/api/v1/live-speech-jobs/:id/audio',async(req,reply)=>{const jobId=key(req),p=fresh(req),before=service.job(p,jobId);service.context(p,before,true);const file=service.audioFile(before),actual=await fileDigest(file.file).catch(()=>{throw new AppError('LIVE_SPEECH_AUDIO_MISSING','实际语音文件缺失，请重新准备；不会返回替代声音。',409);}),current=fresh(req),after=service.job(current,jobId);service.context(current,after,true);const next=service.audioFile(after);if(next.file!==file.file||actual.sha256!==next.format.sha256||actual.size!==next.format.size)throw new AppError('LIVE_SPEECH_AUDIO_CHANGED','实际语音摘要不符，停止提供文件。',409);return privateFile(req,reply,next.file,'audio/wav');});
}
