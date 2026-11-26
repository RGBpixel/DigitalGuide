import type {FileHandle} from 'node:fs/promises';
import type {FastifyRequest} from 'fastify';
import {z} from 'zod';
import {characterMotionInput,characterMotionSaveInput,characterQualityInput,characterPrepareInput,characterRenderInput,characterJobControlInput,characterJobApplyInput} from '@digitalguide/contracts';
import {requirePermission,type Principal} from '@digitalguide/domain';
import {NativeCharacterProduction} from '../../../packages/postgres/src/runtime-character-production.js';
import {NativeMediaFiles} from '../../../packages/postgres/src/runtime-media-files.js';
import {nativeBusinessInteger as integer} from '../../../packages/postgres/src/runtime-repository.js';
import type {RouteContext} from './postgres-asset-routes.js';

export function registerNativeCharacterProductionRoutes({app,repo,authenticated,send}:Pick<RouteContext,'app'|'repo'|'authenticated'|'send'>){
 const s=new NativeCharacterProduction(repo),key=(req:FastifyRequest)=>z.uuid().parse((req.params as {id:string}).id);
 const jobView=async(p:Principal,id:string)=>s.view(p,await s.row(p,id)),planView=async(p:Principal,id:string)=>s.plans.view(p,await s.plans.row(p,id));
 async function write<T>(req:FastifyRequest,body:unknown,guard:(p:Principal)=>Promise<unknown>,work:(p:Principal)=>Promise<string>,view:(p:Principal,id:string)=>Promise<T>){return authenticated(req,async({principal:p})=>{requirePermission(p,'studio.write');await guard(p);const id=await repo.idempotentResource(p,{action:req.method+' '+req.url.split('?')[0],key:z.string().min(8).max(128).parse(req.headers['idempotency-key']),body,code:200},()=>work(p));return view(p,id);});}
 app.get('/api/v1/studio/projects/:id/character-plans',async(req,reply)=>send(req,reply,await authenticated(req,async({principal:p})=>{await s.plans.studio.project(p,key(req));const rows=(await repo.db.query<{id:string}>('SELECT id FROM character_motion_plans WHERE project_id=$1 ORDER BY updated_at DESC,id',[key(req)])).rows;return Promise.all(rows.map(r=>planView(p,r.id)));})));
 app.post('/api/v1/studio/projects/:id/character-plans',async(req,reply)=>{const b=characterMotionInput.parse(req.body);return send(req,reply,await write(req,b,p=>s.plans.studio.project(p,key(req),true),p=>s.plans.save(p,key(req),b,req.id),planView));});
 app.get('/api/v1/studio/character-plans/:id',async(req,reply)=>send(req,reply,await authenticated(req,({principal:p})=>planView(p,key(req)))));
 app.post('/api/v1/studio/character-plans/:id/save',async(req,reply)=>{const b=characterMotionSaveInput.parse(req.body),{version,...content}=b;return send(req,reply,await write(req,b,p=>s.plans.row(p,key(req),true),async p=>{const row=await s.plans.row(p,key(req),true);s.characters.version(row,version);return s.plans.save(p,row.project_id,characterMotionInput.parse(content),req.id,row);},planView));});
 app.get('/api/v1/studio/character-plans/:id/versions',async(req,reply)=>send(req,reply,await authenticated(req,async({principal:p})=>{const row=await s.plans.row(p,key(req));return(await repo.db.query<{version:string;payload:string;createdAt:string}>('SELECT version,payload,created_at AS "createdAt" FROM character_motion_versions WHERE plan_id=$1 ORDER BY version DESC',[row.id])).rows.map(r=>({version:integer(r.version),createdAt:r.createdAt,configuration:JSON.parse(r.payload)}));})));
 app.get('/api/v1/studio/characters/:id/jobs',async(req,reply)=>send(req,reply,await authenticated(req,async({principal:p})=>{const row=await s.characters.row(p,key(req));const jobs=(await repo.db.query<{id:string}>("SELECT id FROM character_jobs WHERE character_id=$1 AND tenant_id=$2 AND environment='mock' AND app_env=$3 ORDER BY created_at DESC,id DESC LIMIT 50",[row.id,p.tenantId,repo.db.config.appEnv])).rows;return Promise.all(jobs.map(j=>jobView(p,j.id)));})));
 app.post('/api/v1/studio/characters/:id/quality',async(req,reply)=>{const b=characterQualityInput.parse(req.body);return send(req,reply,await write(req,b,p=>s.characters.row(p,key(req),true),async p=>{const row=await s.characters.row(p,key(req),true);return s.create(p,row,'quality',await s.quality(p,row,b),req.id);},jobView));});
 app.post('/api/v1/studio/characters/:id/prepare',async(req,reply)=>{const b=characterPrepareInput.parse(req.body);return send(req,reply,await write(req,b,p=>s.characters.row(p,key(req),true),async p=>{const row=await s.characters.row(p,key(req),true);return s.create(p,row,'mock_training',await s.prepare(p,row,b),req.id);},jobView));});
 app.post('/api/v1/studio/characters/:id/render',async(req,reply)=>{const b=characterRenderInput.parse(req.body);return send(req,reply,await write(req,b,p=>s.characters.row(p,key(req),true),async p=>{const row=await s.characters.row(p,key(req),true);return s.create(p,row,b.operation,await s.render(p,row,b),req.id);},jobView));});
 app.get('/api/v1/studio/character-jobs/:id',async(req,reply)=>send(req,reply,await authenticated(req,({principal:p})=>jobView(p,key(req)))));
 app.post('/api/v1/studio/character-jobs/:id/control',async(req,reply)=>{const b=characterJobControlInput.parse(req.body);return send(req,reply,await write(req,b,p=>s.row(p,key(req),true),async p=>s.control(p,await s.row(p,key(req),true),b.version,b.action,req.id),jobView));});
 app.post('/api/v1/studio/character-jobs/:id/apply',async(req,reply)=>{const b=characterJobApplyInput.parse(req.body);return send(req,reply,await write(req,b,p=>s.row(p,key(req),true),async p=>s.apply(p,await s.row(p,key(req),true),b,req.id),jobView));});
 app.get('/api/v1/studio/character-jobs/:id/file',async(req,reply)=>{
  const files=new NativeMediaFiles(repo.db.config);let handle:FileHandle|undefined;
  try{
   const v=await authenticated(req,async({principal:p})=>{const row=await s.row(p,key(req)),output=await s.output(p,row),opened=await files.open({storage_key:output.storageKey,sha256:output.sha256,size:output.size,media_type:output.mediaType});handle=opened.handle;await s.current(p,await s.row(p,row.id));return{output,opened};});
   reply.type(v.output.mediaType).header('Cache-Control','private, no-store').header('X-Content-Type-Options','nosniff').header('Content-Security-Policy',"default-src 'none'; sandbox").header('Accept-Ranges','bytes');
   const size=v.opened.size;let start=0,end=size-1;
   if(req.headers.range){const m=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range),invalid=()=>reply.code(416).header('Content-Range','bytes */'+size).send();if(!m||!m[1]&&!m[2])return invalid();start=m[1]?Number(m[1]):Math.max(0,size-Number(m[2]));end=m[1]&&m[2]?Math.min(size-1,Number(m[2])):size-1;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>end||start>=size)return invalid();reply.code(206).header('Content-Range','bytes '+start+'-'+end+'/'+size);}
   const stream=files.stream(v.opened.handle,start,end);handle=undefined;return reply.header('Content-Length',end-start+1).send(stream);
  }finally{await handle?.close();}
 });
}
