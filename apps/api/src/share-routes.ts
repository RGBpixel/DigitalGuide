import fs from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify';
import type {Repository} from '@digitalguide/database';
import {AppError,type Principal} from '@digitalguide/domain';
import {shareCreate,shareSave,sharePublish,shareConfirm,shareLinkCreate,shareJoin,shareConsent,shareForget,shareEvent} from '@digitalguide/contracts';
import {shareOrigin} from '../../../packages/domain/src/shares.js';
import type {Config} from './config.js';
import {authenticatedSession} from './auth-check.js';
import {executeIdempotent} from './idempotency.js';
import {Shares,type ShareRow,type ShareLinkRow} from './shares.js';
import {privateFile} from './private-file.js';
import {shareHtml} from './share-shell.js';

export function registerShareRoutes(app:FastifyInstance,repo:Repository,config:Config){
 const s=new Shares(repo,config),base='/api/v1/shares',releaseBase='/api/v1/share-releases',linkBase='/api/v1/share-links',external='/api/v1/external/shares',cookieName='dg_share';
 const id=z.uuid(),key=(req:FastifyRequest)=>id.parse((req.params as {id:string}).id),send=(req:FastifyRequest,reply:FastifyReply,data:unknown)=>reply.send({data,requestId:req.id});
 const fresh=(req:FastifyRequest,write=false)=>{const session=authenticatedSession(repo,req,config);if(write&&req.headers['x-csrf-token']!==session.csrfToken)throw new AppError('FORBIDDEN','页面安全凭证已变化，请重新登录。',403);return session.principal;};
 function write(req:FastifyRequest,reply:FastifyReply,guard:(p:Principal)=>unknown,work:(p:Principal)=>{id:string;workspaceId:string},view:(p:Principal,id:string)=>unknown){
  repo.transaction(()=>guard(fresh(req,true)));const p=fresh(req,true),result=executeIdempotent(repo,req,p.tenantId,p.userId,()=>{const p=fresh(req,true);guard(p);const ref=work(p);repo.audit(p,ref.workspaceId,'share.'+req.routeOptions.url,ref.id,req.id);return{id:ref.id};});
  return send(req,reply,repo.transaction(()=>{const p=fresh(req,true);guard(p);return view(p,result.data.id);}));
 }
 const view=(p:Principal,id:string)=>s.view(p,s.row(p,id)),rv=(p:Principal,id:string)=>s.releaseView(p,s.release(p,id)),lv=(p:Principal,id:string)=>s.linkView(p,s.link(p,id)),issued=(p:Principal,id:string)=>s.issued(p,s.link(p,id));
 const draftGuard=(req:FastifyRequest)=>(p:Principal)=>{const r=s.row(p,key(req));s.scope(p,r.workspace_id,'studio.write');};
 const releaseGuard=(req:FastifyRequest)=>(p:Principal)=>{const r=s.release(p,key(req));s.scope(p,r.workspace_id,'publishing.publish');};
 const linkGuard=(req:FastifyRequest)=>(p:Principal)=>{const l=s.link(p,key(req));s.scope(p,l.workspace_id,'publishing.publish');};
 const query=z.strictObject({workspaceId:id,cursor:id.optional(),limit:z.coerce.number().int().min(1).max(100).default(30)});
 app.get(base,(req,reply)=>{const q=query.parse(req.query),p=fresh(req);s.scope(p,q.workspaceId);const rows=repo.all<ShareRow>('SELECT * FROM studio_shares WHERE tenant_id=? AND workspace_id=? AND environment=? AND app_env=? AND id>? ORDER BY id LIMIT ?',p.tenantId,q.workspaceId,config.providerMode,config.appEnv,q.cursor||'',q.limit+1);return send(req,reply,{items:rows.slice(0,q.limit).map(r=>s.view(p,r)),nextCursor:rows.length>q.limit?rows[q.limit-1].id:null});});
 app.post(base,(req,reply)=>{const input=shareCreate.parse(req.body);return write(req,reply,p=>s.scope(p,input.workspaceId,'studio.write'),p=>({id:s.create(p,input),workspaceId:input.workspaceId}),view);});
 app.get(base+'/:id',(req,reply)=>send(req,reply,view(fresh(req),key(req))));
 app.post(base+'/:id/save',(req,reply)=>{const input=shareSave.parse(req.body);return write(req,reply,draftGuard(req),p=>{const r=s.row(p,key(req));return{id:s.save(p,r,input),workspaceId:r.workspace_id};},view);});
 app.get(base+'/:id/versions',(req,reply)=>{const p=fresh(req),r=s.row(p,key(req));return send(req,reply,repo.all<{version:number;name:string;variantId:string;definition:string;createdAt:string}>('SELECT version,name,variant_id variantId,definition,created_at createdAt FROM studio_share_versions WHERE share_id=? ORDER BY version DESC LIMIT 200',r.id).map(v=>({...v,definition:JSON.parse(v.definition)})));});
 app.post(base+'/:id/publish',async(req,reply)=>{const input=sharePublish.parse(req.body),p=fresh(req,true),r=s.row(p,key(req));s.scope(p,r.workspace_id,'publishing.publish');const checked=await s.checked(p,r);return write(req,reply,current=>{const r=s.row(current,key(req));s.scope(current,r.workspace_id,'publishing.publish');},current=>{const latest=s.row(current,key(req));return{id:s.publish(current,latest,input.version,input.planHash,checked),workspaceId:latest.workspace_id};},rv);});
 app.get(releaseBase+'/:id',(req,reply)=>send(req,reply,rv(fresh(req),key(req))));
 app.post(releaseBase+'/:id/withdraw',(req,reply)=>{const input=shareConfirm.parse(req.body);return write(req,reply,releaseGuard(req),p=>{const r=s.release(p,key(req));return{id:s.withdraw(p,r,input.version),workspaceId:r.workspace_id};},rv);});
 app.get(releaseBase+'/:id/stats',(req,reply)=>{const p=fresh(req);return send(req,reply,s.stats(p,s.release(p,key(req))));});
 app.get(releaseBase+'/:id/links',(req,reply)=>{const p=fresh(req),r=s.release(p,key(req));s.scope(p,r.workspace_id,'publishing.publish');return send(req,reply,repo.all<ShareLinkRow>('SELECT * FROM studio_share_links WHERE release_id=? ORDER BY created_at,id',r.id).map(l=>s.linkView(p,l)));});
 app.post(releaseBase+'/:id/links',(req,reply)=>{const input=shareLinkCreate.parse(req.body);return write(req,reply,releaseGuard(req),p=>{const r=s.release(p,key(req));return{id:s.createLink(p,r,input),workspaceId:r.workspace_id};},issued);});
 app.post(linkBase+'/:id/access',(req,reply)=>{shareConfirm.parse(req.body);return write(req,reply,linkGuard(req),p=>{const l=s.link(p,key(req));s.version(l,shareConfirm.parse(req.body).version);return{id:l.id,workspaceId:l.workspace_id};},issued);});
 for(const action of ['rotate','revoke'] as const)app.post(linkBase+'/:id/'+action,(req,reply)=>{const input=shareConfirm.parse(req.body);return write(req,reply,linkGuard(req),p=>{const l=s.link(p,key(req));return{id:s.controlLink(p,l,input.version,action),workspaceId:l.workspace_id};},action==='rotate'?issued:lv);});

 const cookiePath=(linkId:string)=>external+'/'+linkId;
 const cookieOptions=(linkId:string)=>({path:cookiePath(linkId),httpOnly:true,signed:true,secure:config.webOrigin.startsWith('https:'),sameSite:config.webOrigin.startsWith('https:')?'none' as const:'lax' as const,...(config.webOrigin.startsWith('https:')?{partitioned:true}:{}),maxAge:24*3600});
 function auth(req:FastifyRequest,write=false){
  const link=s.publicLink(key(req)),unsigned=req.cookies[cookieName]?req.unsignCookie(req.cookies[cookieName]):null,session=s.session(link,unsigned?.valid?unsigned.value:undefined),context=s.external(link);
  if(write&&(req.headers.origin!==config.webOrigin||req.headers['x-csrf-token']!==s.derive('csrf',session.id,session.nonce)))throw new AppError('FORBIDDEN','观看安全凭证或页面来源无效，请重新打开分享。',403);
  return{...context,session};
 }
 const requestKey=(req:FastifyRequest)=>z.string().min(8).max(128).parse(req.headers['idempotency-key']);
 app.get(external+'/player.js',(_req,reply)=>{const file=path.join(config.root,'dist','share-player.js');if(!fs.existsSync(file))throw new AppError('SHARE_PLAYER_UNAVAILABLE','播放器尚未构建，请先运行 pnpm build:share-player。',503);return reply.type('application/javascript; charset=utf-8').header('Cache-Control','no-store').send(fs.createReadStream(file));});
 app.get(external+'/:id/player',(req,reply)=>{
  const l=s.publicLink(key(req)),origins=(JSON.parse(l.embed_origins) as string[]).map(o=>shareOrigin(o,config.appEnv!=='production'));
  reply.header('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; media-src 'self'; frame-ancestors 'self' "+origins.join(' ')+"; base-uri 'none'; form-action 'none'; object-src 'none'").header('Referrer-Policy','no-referrer').header('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  return reply.type('text/html; charset=utf-8').send(shareHtml);
 });
 app.post(external+'/:id/join',(req,reply)=>{
  if(req.headers.origin!==config.webOrigin)throw new AppError('FORBIDDEN','请从分享播放器进入观看。',403);const input=shareJoin.parse(req.body),result=repo.transaction(()=>{const l=s.publicLink(key(req)),unsigned=req.cookies[cookieName]?req.unsignCookie(req.cookies[cookieName]):null,session=s.join(l,input.access,requestKey(req),unsigned?.valid?unsigned.value:undefined);return{session,link:l};});
  reply.setCookie(cookieName,s.derive('session',result.session.id,result.session.nonce),{...cookieOptions(result.link.id),maxAge:Math.max(1,Math.floor((Date.parse(result.session.expires_at)-Date.now())/1000))});return send(req,reply,{joined:true});
 });
 app.get(external+'/:id/context',(req,reply)=>send(req,reply,repo.transaction(()=>{const c=auth(req);return s.player(c.link,c.session);}))); 
 app.get(external+'/:id/provenance',(req,reply)=>{const c=repo.transaction(()=>auth(req));if(!c.s.provenance)throw new AppError('NOT_FOUND','此分享暂无生成来源回执。',404);return reply.type('application/json').header('Content-Disposition','attachment; filename="generation-receipt.json"').send(JSON.stringify(c.s.provenance,null,2));});
 app.post(external+'/:id/consent',(req,reply)=>{const input=shareConsent.parse(req.body);return send(req,reply,repo.transaction(()=>{const c=auth(req,true);return s.state(c.link,s.consent(c.link,c.session,input.version,input.enabled));}));});
 app.post(external+'/:id/forget',(req,reply)=>{const input=shareForget.parse(req.body);return send(req,reply,repo.transaction(()=>{const c=auth(req,true);return s.state(c.link,s.consent(c.link,c.session,input.version,false));}));});
 app.post(external+'/:id/events',(req,reply)=>{const input=shareEvent.parse(req.body);return send(req,reply,repo.transaction(()=>{const c=auth(req,true);return s.state(c.link,s.event(c.link,c.session,input,requestKey(req)));}));});
 async function media(req:FastifyRequest,reply:FastifyReply,kind:'video'|'vtt'|'cover',type:string){
  const initial=auth(req),f=initial.files.find(f=>f.kind===kind)!;await s.checkFile(f);const current=auth(req),latest=current.files.find(f=>f.kind===kind);
  if(!latest||f.file!==latest.file||f.sha256!==latest.sha256||initial.release.release_hash!==current.release.release_hash||initial.link.version!==current.link.version)throw new AppError('SHARE_UNAVAILABLE','分享内容已变化，请重新打开链接。',409);
  return privateFile(req,reply,f.file,type);
 }
 app.get(external+'/:id/video',(req,reply)=>media(req,reply,'video','video/mp4'));
 app.get(external+'/:id/captions',(req,reply)=>media(req,reply,'vtt','text/vtt; charset=utf-8'));
 app.get(external+'/:id/poster',(req,reply)=>media(req,reply,'cover','image/png'));
}
