import {createHash,createHmac,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import type {z} from 'zod';
import type {Repository} from '@digitalguide/database';
import {AppError,canonical,hasPermission,requirePermission,requireWorkspace,type Principal} from '@digitalguide/domain';
import {shareDefinition,shareCreate,shareSave,shareLinkCreate,shareEvent,type ShareDefinition,type ShareDraft,type SharePlan,type ShareRelease,type ShareLink,type ShareIssued,type ShareViewerState,type SharePlayer,type ShareStats} from '@digitalguide/contracts';
import {shareOrigin,validateShare,shareInteraction} from '../../../packages/domain/src/shares.js';
import {fileDigest} from '../../../packages/media/src/files.js';
import {DistributionService,type DistributionFile} from './distribution-service.js';
import {Courses} from './courses.js';
import type {Config} from './config.js';
import type {GovernancePublicReceipt} from '@digitalguide/contracts';

export const shareDigest=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
const tokenHash=(v:string)=>createHash('sha256').update(v).digest('hex'),now=()=>new Date().toISOString(),nonce=()=>randomBytes(32).toString('hex');
export interface ShareRow{id:string;tenant_id:string;workspace_id:string;actor_id:string;name:string;variant_id:string;definition:string;definition_hash:string;version:number;updated_at:string}
export interface ShareReleaseRow{id:string;share_id:string;tenant_id:string;workspace_id:string;actor_id:string;share_version:number;name:string;snapshot:string;release_hash:string;version:number;withdrawn_at:string|null;created_at:string}
export interface ShareLinkRow{id:string;release_id:string;tenant_id:string;workspace_id:string;actor_id:string;title:string;access:'unlisted'|'public';nonce:string;token_hash:string;embed_origins:string;recording_enabled:number;retention_days:number;expires_at:string;version:number;revoked_at:string|null;created_at:string}
export interface ShareSessionRow{id:string;link_id:string;link_version:number;nonce:string;token_hash:string;version:number;consent:number;position_ms:number;event_count:number;records_expires_at:string|null;expires_at:string;created_at:string;updated_at:string}
interface ShareSnapshot{schemaVersion:1;variantId:string;sourceHash:string;definition:ShareDefinition;title:string;description:string;aiDisclosure:string;expiresAt:string|null;media:{durationMs:number;width:number;height:number};files:{kind:string;size:number;sha256:string}[];provenance?:GovernancePublicReceipt}

export class Shares{
 distribution:DistributionService;courses:Courses;
 constructor(public repo:Repository,public config:Config){this.distribution=new DistributionService(repo,config);this.courses=new Courses(repo,config);}
 scope(p:Principal,workspaceId:string,permission:'asset.read'|'studio.write'|'publishing.publish'='asset.read'){requireWorkspace(p,workspaceId);requirePermission(p,permission);}
 version(r:{version:number},v:number){if(r.version!==v)throw new AppError('VERSION_CONFLICT','记录已更新，请刷新并核对保留的输入后重试。',409);}
 row(p:Principal,id:string){const r=this.repo.get<ShareRow>('SELECT * FROM studio_shares WHERE id=? AND tenant_id=? AND environment=? AND app_env=?',id,p.tenantId,this.config.providerMode,this.config.appEnv);if(!r)throw new AppError('NOT_FOUND','互动分享不存在或不在当前环境。',404);this.scope(p,r.workspace_id);return r;}
 definition(r:ShareRow){const d=shareDefinition.parse(JSON.parse(r.definition));if(shareDigest(d)!==r.definition_hash)throw new AppError('SHARE_DEFINITION_CHANGED','互动配置摘要不符，请联系管理员。',409);return d;}
 source(p:Principal,workspaceId:string,variantId:string){
  const v=this.distribution.row(p,variantId);if(v.workspace_id!==workspaceId)throw new AppError('NOT_FOUND','传播版本不在当前空间。',404);
  if(v.platform!=='custom')throw new AppError('SHARE_CHANNEL_REQUIRED','请为私域分享建立“自定义渠道”的传播版本，并完成独立成品及传播审核。',409);
  const m=this.distribution.released(p,v),artifact=this.repo.get<{id:string}>('SELECT id FROM studio_export_artifacts WHERE export_id=? AND kind=\'video\'',v.export_id)!;
  const native=this.courses.media(p,workspaceId,'video',{kind:'studio_export',exportId:v.export_id,artifactId:artifact.id},'video/mp4').snapshot;
  const cover=this.repo.asset(p,v.cover_asset_id),expires=[native.expiresAt,cover.expiresAt].filter((x):x is string=>!!x).sort();
  const snapshot={schemaVersion:1 as const,variantId:v.id,sourceHash:m.hash,title:v.title,description:v.description,aiDisclosure:m.metadata.aiDisclosure,...(m.metadata.governance?{provenance:m.metadata.governance}:{}),expiresAt:expires[0]||null,media:{durationMs:native.durationMs,width:native.width,height:native.height},files:m.files.filter(f=>['video','vtt','cover'].includes(f.kind)).map(f=>({kind:f.kind,size:f.size,sha256:f.sha256}))};
  return{snapshot,files:m.files};
 }
 prepare(p:Principal,workspaceId:string,variantId:string,d:ShareDefinition){const source=this.source(p,workspaceId,variantId);validateShare(d,source.snapshot.media.durationMs,this.config.appEnv!=='production');return source;}
 create(p:Principal,input:z.infer<typeof shareCreate>){
  this.scope(p,input.workspaceId,'studio.write');this.prepare(p,input.workspaceId,input.variantId,input.definition);
  if(this.repo.get<{n:number}>('SELECT count(*) n FROM studio_shares WHERE tenant_id=? AND workspace_id=? AND environment=? AND app_env=?',p.tenantId,input.workspaceId,this.config.providerMode,this.config.appEnv)!.n>=200)throw new AppError('SHARE_LIMIT','本空间已有二百份分享草稿，请整理已有内容。',429);
  const id=randomUUID(),at=now(),definition=JSON.stringify(input.definition),hash=shareDigest(input.definition);
  this.repo.run('INSERT INTO studio_shares(id,tenant_id,workspace_id,actor_id,name,variant_id,definition,definition_hash,environment,app_env,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',id,p.tenantId,input.workspaceId,p.userId,input.name,input.variantId,definition,hash,this.config.providerMode,this.config.appEnv,at,at);
  this.recordVersion(p,this.row(p,id));return id;
 }
 recordVersion(p:Principal,r:ShareRow){this.repo.run('INSERT INTO studio_share_versions VALUES (?,?,?,?,?,?,?,?)',r.id,r.version,r.name,r.variant_id,r.definition,r.definition_hash,p.userId,now());}
 save(p:Principal,r:ShareRow,input:z.infer<typeof shareSave>){
  this.scope(p,r.workspace_id,'studio.write');this.version(r,input.version);this.prepare(p,r.workspace_id,input.variantId,input.definition);
  this.repo.run('UPDATE studio_shares SET name=?,variant_id=?,definition=?,definition_hash=?,version=version+1,updated_at=? WHERE id=? AND version=?',input.name,input.variantId,JSON.stringify(input.definition),shareDigest(input.definition),now(),r.id,r.version);
  this.recordVersion(p,this.row(p,r.id));return r.id;
 }
 plan(p:Principal,r:ShareRow):SharePlan{
  const problems:string[]=[];let snapshot:ShareSnapshot|null=null;
  try{const d=this.definition(r),source=this.prepare(p,r.workspace_id,r.variant_id,d);snapshot={...source.snapshot,definition:d};}catch(e){if(!(e instanceof AppError))throw e;problems.push(e.message);}
  return{hash:shareDigest({pipeline:'interactive-share-v1',id:r.id,version:r.version,snapshot}),canPublish:!!snapshot&&!problems.length,problems,sourceHash:snapshot?.sourceHash||null,media:snapshot?.media||null,expiresAt:snapshot?.expiresAt||null,title:snapshot?.title||'',aiDisclosure:snapshot?.aiDisclosure||''};
 }
 async checked(p:Principal,r:ShareRow){const plan=this.plan(p,r);if(!plan.canPublish)throw new AppError('SHARE_SOURCE_UNAVAILABLE',plan.problems.join('；'),409);const source=this.prepare(p,r.workspace_id,r.variant_id,this.definition(r));for(const f of source.files)await this.checkFile(f);return plan.hash;}
 async checkFile(f:DistributionFile){const bytes=await fileDigest(f.file).catch(()=>{throw new AppError('SHARE_MEDIA_MISSING','分享文件缺失，请由制作人重新导出并审核。',409);});if(bytes.sha256!==f.sha256||bytes.size!==f.size)throw new AppError('SHARE_MEDIA_CHANGED','分享文件实际字节与批准版本不符，已停止提供。',409);return bytes;}
 publish(p:Principal,r:ShareRow,v:number,hash:string,checked:string){
  this.scope(p,r.workspace_id,'publishing.publish');this.version(r,v);const plan=this.plan(p,r);
  if(!plan.canPublish||plan.hash!==hash||hash!==checked)throw new AppError('SHARE_PLAN_CHANGED','核对期间内容、权限或来源已变化，请重新审阅发布计划。',409);
  if(this.repo.get('SELECT id FROM studio_share_releases WHERE share_id=? AND share_version=?',r.id,v))throw new AppError('SHARE_ALREADY_PUBLISHED','这个草稿版本已有固定发布版，请使用已有发布版或保存新草稿。',409);
  const source=this.prepare(p,r.workspace_id,r.variant_id,this.definition(r)),snapshot:ShareSnapshot={...source.snapshot,definition:this.definition(r)},id=randomUUID();
  this.repo.run('INSERT INTO studio_share_releases(id,share_id,tenant_id,workspace_id,actor_id,share_version,name,snapshot,release_hash,environment,app_env,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',id,r.id,p.tenantId,r.workspace_id,p.userId,r.version,r.name,JSON.stringify(snapshot),shareDigest(snapshot),this.config.providerMode,this.config.appEnv,now());return id;
 }
 release(p:Principal,id:string){const r=this.repo.get<ShareReleaseRow>('SELECT * FROM studio_share_releases WHERE id=? AND tenant_id=? AND environment=? AND app_env=?',id,p.tenantId,this.config.providerMode,this.config.appEnv);if(!r)throw new AppError('NOT_FOUND','分享发布版不存在。',404);this.scope(p,r.workspace_id);return r;}
 snapshot(r:ShareReleaseRow){const s=JSON.parse(r.snapshot) as ShareSnapshot;if(shareDigest(s)!==r.release_hash)throw new AppError('SHARE_RELEASE_CHANGED','固定发布版摘要不符，请联系管理员。',409);shareDefinition.parse(s.definition);return s;}
 current(p:Principal,r:ShareReleaseRow){
  if(r.withdrawn_at)throw new AppError('SHARE_WITHDRAWN','固定发布版已撤回，不能继续提供视频。',409);
  const s=this.snapshot(r),source=this.prepare(p,r.workspace_id,s.variantId,s.definition);
  if(shareDigest({...source.snapshot,definition:s.definition})!==r.release_hash)throw new AppError('SHARE_SOURCE_CHANGED','成片、传播审核、素材或用途期限已变化，请建立新的固定发布版。',409);
  return{s,files:source.files};
 }
 releaseView(p:Principal,r:ShareReleaseRow):ShareRelease{let reason:string|null=null;try{this.current(p,r);}catch(e){if(!(e instanceof AppError))throw e;reason=e.message;}return{id:r.id,shareId:r.share_id,shareVersion:r.share_version,workspaceId:r.workspace_id,name:r.name,hash:r.release_hash,version:r.version,available:!reason,unavailableReason:reason,withdrawnAt:r.withdrawn_at,createdAt:r.created_at};}
 view(p:Principal,r:ShareRow):ShareDraft{return{id:r.id,workspaceId:r.workspace_id,name:r.name,variantId:r.variant_id,definition:this.definition(r),version:r.version,plan:this.plan(p,r),releases:this.repo.all<ShareReleaseRow>('SELECT * FROM studio_share_releases WHERE share_id=? ORDER BY share_version DESC',r.id).map(x=>this.releaseView(p,x)),canEdit:hasPermission(p,'studio.write'),canPublish:hasPermission(p,'publishing.publish'),updatedAt:r.updated_at};}
 withdraw(p:Principal,r:ShareReleaseRow,v:number){this.scope(p,r.workspace_id,'publishing.publish');this.version(r,v);this.repo.run('UPDATE studio_share_releases SET withdrawn_at=COALESCE(withdrawn_at,?),version=version+1 WHERE id=?',now(),r.id);return r.id;}
 publisher(actorId:string,tenantId:string,workspaceId:string){const p={...this.repo.principal(actorId),environment:this.config.providerMode,appEnv:this.config.appEnv};if(p.tenantId!==tenantId)throw new AppError('FORBIDDEN','发布人已离开原组织。',403);this.scope(p,workspaceId,'publishing.publish');return p;}
 derive(kind:'link'|'session'|'csrf',id:string,salt:string){return createHmac('sha256',this.config.sessionSecret).update('digitalguide-share-'+kind+'-v1|'+id+'|'+salt).digest('hex');}
 link(p:Principal,id:string){const l=this.repo.get<ShareLinkRow>('SELECT * FROM studio_share_links WHERE id=? AND tenant_id=? AND environment=? AND app_env=?',id,p.tenantId,this.config.providerMode,this.config.appEnv);if(!l)throw new AppError('NOT_FOUND','分享链接不存在。',404);this.scope(p,l.workspace_id);return l;}
 publicLink(id:string){const l=this.repo.get<ShareLinkRow>('SELECT * FROM studio_share_links WHERE id=? AND environment=? AND app_env=?',id,this.config.providerMode,this.config.appEnv);if(!l)throw new AppError('SHARE_UNAVAILABLE','分享不可用，请联系分享人。',404);return l;}
 linkCurrent(l:ShareLinkRow){
  l=this.publicLink(l.id);if(l.revoked_at||l.expires_at<=now())throw new AppError('SHARE_UNAVAILABLE','分享已到期或撤回。',409);
  if(tokenHash(this.derive('link',l.id,l.nonce))!==l.token_hash)throw new AppError('SHARE_KEY_CHANGED','服务密钥变化，请由发布人轮换链接。',409);
  const p=this.publisher(l.actor_id,l.tenant_id,l.workspace_id),r=this.release(p,l.release_id);this.publisher(r.actor_id,r.tenant_id,r.workspace_id);return{link:l,release:r,p,...this.current(p,r)};
 }
 external(l:ShareLinkRow){try{return this.linkCurrent(l);}catch{throw new AppError('SHARE_UNAVAILABLE','分享已到期、撤回或原内容不可用，请联系分享人。',409);}}
 linkView(p:Principal,l:ShareLinkRow):ShareLink{
  this.scope(p,l.workspace_id);let reason:string|null=null;try{this.linkCurrent(l);}catch(e){if(!(e instanceof AppError))throw e;reason=e.message;}
  return{id:l.id,releaseId:l.release_id,title:l.title,access:l.access,version:l.version,expiresAt:l.expires_at,embedOrigins:JSON.parse(l.embed_origins),recordingEnabled:!!l.recording_enabled,retentionDays:l.retention_days,revokedAt:l.revoked_at,available:!reason,unavailableReason:reason,sessionCount:this.repo.get<{n:number}>('SELECT count(*) n FROM studio_share_sessions WHERE link_id=?',l.id)!.n,createdAt:l.created_at};
 }
 createLink(p:Principal,r:ShareReleaseRow,input:z.infer<typeof shareLinkCreate>){
  this.scope(p,r.workspace_id,'publishing.publish');this.version(r,input.version);const {s}=this.current(p,r);input.embedOrigins.forEach(o=>shareOrigin(o,this.config.appEnv!=='production'));
  if(new Set(input.embedOrigins).size!==input.embedOrigins.length)throw new AppError('SHARE_ORIGIN_DUPLICATE','嵌入来源不能重复。',422);
  if(this.repo.get<{n:number}>('SELECT count(*) n FROM studio_share_links WHERE release_id=?',r.id)!.n>=50)throw new AppError('SHARE_LINK_LIMIT','该发布版已有五十个链接，请保存新版本后另建链接。',429);
  const expires=new Date(Math.min(Date.parse(input.expiresAt),s.expiresAt?Date.parse(s.expiresAt):Infinity)).toISOString();
  if(Date.parse(expires)<Date.now()+60000||Date.parse(input.expiresAt)>Date.now()+30*86400000)throw new AppError('SHARE_LINK_EXPIRY','链接需至少有效一分钟、最多三十天，且不能超过原素材用途期限。',422);
  const id=randomUUID(),salt=nonce();this.repo.run('INSERT INTO studio_share_links(id,release_id,tenant_id,workspace_id,actor_id,title,access,nonce,token_hash,embed_origins,recording_enabled,retention_days,expires_at,environment,app_env,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,r.id,p.tenantId,r.workspace_id,p.userId,input.title,input.access,salt,tokenHash(this.derive('link',id,salt)),JSON.stringify(input.embedOrigins),input.recordingEnabled?1:0,input.retentionDays,expires,this.config.providerMode,this.config.appEnv,now());return id;
 }
 issued(p:Principal,l:ShareLinkRow):ShareIssued{
  this.scope(p,l.workspace_id,'publishing.publish');this.linkCurrent(l);const url=this.config.webOrigin+'/api/v1/external/shares/'+l.id+'/player'+(l.access==='unlisted'?'#access='+this.derive('link',l.id,l.nonce):'');
  const attr=url.replace(/&/g,'&amp;').replace(/"/g,'&quot;');return{link:this.linkView(p,l),url,embedCode:'<iframe src="'+attr+'" title="DigitalGuide 互动视频" width="960" height="720" allow="fullscreen" referrerpolicy="no-referrer" allowfullscreen></iframe>'};
 }
 controlLink(p:Principal,l:ShareLinkRow,v:number,action:'rotate'|'revoke'){
  this.scope(p,l.workspace_id,'publishing.publish');this.version(l,v);
  if(action==='rotate'){
   if(l.revoked_at||l.expires_at<=now())throw new AppError('SHARE_LINK_REVOKED','已撤回或到期的链接不能恢复，请新建链接。',409);
   const r=this.release(p,l.release_id);this.current(p,r);const salt=nonce();this.repo.run('UPDATE studio_share_links SET nonce=?,token_hash=?,version=version+1 WHERE id=?',salt,tokenHash(this.derive('link',l.id,salt)),l.id);
  }else this.repo.run('UPDATE studio_share_links SET revoked_at=COALESCE(revoked_at,?),version=version+1 WHERE id=?',now(),l.id);
  return l.id;
 }
 access(l:ShareLinkRow,value:string|undefined){const current=this.external(l);if(current.link.access==='unlisted'&&(!value||!timingSafeEqual(Buffer.from(tokenHash(value)),Buffer.from(current.link.token_hash))))throw new AppError('SHARE_ACCESS_REQUIRED','请使用分享人提供的完整链接进入观看。',401);return current;}
 join(l:ShareLinkRow,value:string|undefined,key:string,existingToken?:string){
  l=this.access(l,value).link;const kh=tokenHash(key),body=shareDigest({access:value||null}),old=this.repo.get<{request_hash:string;session_id:string}>('SELECT request_hash,session_id FROM studio_share_join_requests WHERE link_id=? AND link_version=? AND key_hash=?',l.id,l.version,kh);
  if(old){if(old.request_hash!==body)throw new AppError('IDEMPOTENCY_CONFLICT','加入请求编号已被其他内容使用。',409);const s=this.repo.get<ShareSessionRow>('SELECT * FROM studio_share_sessions WHERE id=?',old.session_id)!;this.session(l,this.derive('session',s.id,s.nonce));return s;}
  if(existingToken){try{return this.session(l,existingToken);}catch(e){if(!(e instanceof AppError)||e.code!=='SHARE_SESSION_REQUIRED')throw e;}}
  if(this.repo.get<{n:number}>('SELECT count(*) n FROM studio_share_sessions WHERE link_id=?',l.id)!.n>=2000)throw new AppError('SHARE_SESSION_LIMIT','该链接已达到本地观看会话上限，请联系发布人。',429);
  const id=randomUUID(),salt=nonce(),at=now(),expires=new Date(Math.min(Date.parse(l.expires_at),Date.now()+24*3600000)).toISOString();
  this.repo.run('INSERT INTO studio_share_sessions(id,link_id,link_version,nonce,token_hash,expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',id,l.id,l.version,salt,tokenHash(this.derive('session',id,salt)),expires,at,at);
  this.repo.run('INSERT INTO studio_share_join_requests VALUES (?,?,?,?,?)',l.id,l.version,kh,body,id);return this.repo.get<ShareSessionRow>('SELECT * FROM studio_share_sessions WHERE id=?',id)!;
 }
 session(l:ShareLinkRow,token:string|undefined){
  l=this.external(l).link;const s=token?this.repo.get<ShareSessionRow>('SELECT * FROM studio_share_sessions WHERE token_hash=? AND link_id=?',tokenHash(token),l.id):undefined;
  if(!s||s.link_version!==l.version||s.expires_at<=now())throw new AppError('SHARE_SESSION_REQUIRED','观看会话已失效，请重新打开完整分享链接。',401);return s;
 }
 state(l:ShareLinkRow,s:ShareSessionRow):ShareViewerState{const consent=!!s.consent&&!!s.records_expires_at&&s.records_expires_at>now()&&!!l.recording_enabled;return{version:s.version,recordingEnabled:!!l.recording_enabled,consent,positionMs:consent?s.position_ms:0,eventCount:consent?s.event_count:0,expiresAt:s.expires_at,retentionDays:l.retention_days,csrfToken:this.derive('csrf',s.id,s.nonce)};}
 player(l:ShareLinkRow,s:ShareSessionRow):SharePlayer{const {s:snapshot}=this.external(l),base='/api/v1/external/shares/'+l.id;return{title:snapshot.title,description:snapshot.description,aiDisclosure:snapshot.aiDisclosure,definition:snapshot.definition,media:snapshot.media,videoUrl:base+'/video',captionUrl:base+'/captions',posterUrl:base+'/poster',state:this.state(l,s),...(snapshot.provenance?{provenance:snapshot.provenance,provenanceUrl:base+'/provenance'}:{}),notice:'观看无需登记身份。互动记录与断点仅在你主动同意后保存；记录为浏览器提交，不能用作考试成绩或真实注意力证明。撤回分享只限制后续请求，已取得的视频无法远程删除。'};}
 consent(l:ShareLinkRow,s:ShareSessionRow,v:number,enabled:boolean){
  this.version(s,v);if(enabled&&!l.recording_enabled)throw new AppError('SHARE_RECORDING_DISABLED','分享人没有开启互动记录，仍可直接观看和跳转。',409);
  if(!enabled)this.forgetRecords(s.id);const at=now();this.repo.run('UPDATE studio_share_sessions SET consent=?,records_expires_at=?,version=version+1,updated_at=? WHERE id=?',enabled?1:0,enabled?new Date(Date.now()+l.retention_days*86400000).toISOString():null,at,s.id);
  return this.repo.get<ShareSessionRow>('SELECT * FROM studio_share_sessions WHERE id=?',s.id)!;
 }
 forgetRecords(sessionId:string){this.repo.run('DELETE FROM studio_share_events WHERE session_id=?',sessionId);this.repo.run('UPDATE studio_share_sessions SET position_ms=0,event_count=0 WHERE id=?',sessionId);}
 event(l:ShareLinkRow,s:ShareSessionRow,input:z.infer<typeof shareEvent>,key:string){
  if(!this.state(l,s).consent)throw new AppError('SHARE_CONSENT_REQUIRED','尚未同意保存互动记录；可以继续直接观看。',403);
  const {s:snapshot}=this.external(l);if(input.timeMs>snapshot.media.durationMs)throw new AppError('SHARE_TIME_INVALID','观看位置不能超过视频时长。',422);
  if(input.type==='interaction')shareInteraction(snapshot.definition,input.widgetId,input.optionId,input.timeMs);
  else if(input.widgetId!==undefined||input.optionId!==undefined)throw new AppError('SHARE_EVENT_INVALID','这个记录类型不接受组件或选项编号。',422);
  const kh=tokenHash(key),body=shareDigest(input),old=this.repo.get<{request_hash:string}>('SELECT request_hash FROM studio_share_event_requests WHERE session_id=? AND key_hash=?',s.id,kh);
  if(old){if(old.request_hash!==body)throw new AppError('IDEMPOTENCY_CONFLICT','同一互动请求的内容已变化，请刷新后重新操作。',409);return s;}
  this.version(s,input.version);if(s.event_count>=10000)throw new AppError('SHARE_EVENT_LIMIT','本次观看已达到互动记录上限；可关闭记录继续观看。',429);
  const id=randomUUID(),at=now();this.repo.run('INSERT INTO studio_share_events VALUES (?,?,?,?,?,?,?,?)',id,s.id,input.type,input.timeMs,input.widgetId||null,input.optionId||null,at,s.records_expires_at!);
  this.repo.run('INSERT INTO studio_share_event_requests VALUES (?,?,?,?)',s.id,kh,body,id);
  this.repo.run('UPDATE studio_share_sessions SET position_ms=?,event_count=event_count+1,version=version+1,updated_at=? WHERE id=?',input.timeMs,at,s.id);return this.repo.get<ShareSessionRow>('SELECT * FROM studio_share_sessions WHERE id=?',s.id)!;
 }
 stats(p:Principal,r:ShareReleaseRow):ShareStats{
  this.scope(p,r.workspace_id,'publishing.publish');const at=now(),condition=' FROM studio_share_events e JOIN studio_share_sessions s ON s.id=e.session_id JOIN studio_share_links l ON l.id=s.link_id WHERE l.release_id=? AND s.consent=1 AND s.records_expires_at>? AND e.expires_at>?';
  const total=this.repo.get<{n:number;plays:number;completions:number}>('SELECT count(*) n,COALESCE(sum(e.type=\'play\'),0) plays,COALESCE(sum(e.type=\'ended\'),0) completions'+condition,r.id,at,at)!;
  return{notice:'仅汇总主动同意且未过保留期限的浏览器记录；不代表独立自然人数、真实注意力或成交。',consentingSessions:this.repo.get<{n:number}>('SELECT count(*) n FROM studio_share_sessions s JOIN studio_share_links l ON l.id=s.link_id WHERE l.release_id=? AND s.consent=1 AND s.records_expires_at>?',r.id,at)!.n,events:total.n,plays:total.plays,completions:total.completions,interactions:this.repo.all<{widgetId:string;optionId:string|null;count:number}>('SELECT e.widget_id widgetId,e.option_id optionId,count(*) count'+condition+' AND e.type=\'interaction\' GROUP BY e.widget_id,e.option_id ORDER BY e.widget_id,e.option_id',r.id,at,at)};
 }
}

export function sweepShares(repo:Repository,config:Config){
 const at=now(),sessions=repo.all<{id:string}>('SELECT s.id FROM studio_share_sessions s JOIN studio_share_links l ON l.id=s.link_id WHERE l.environment=? AND l.app_env=? AND s.records_expires_at<=? LIMIT 500',config.providerMode,config.appEnv,at);
 for(const s of sessions){repo.run('DELETE FROM studio_share_events WHERE session_id=?',s.id);repo.run('UPDATE studio_share_sessions SET consent=0,position_ms=0,event_count=0,records_expires_at=NULL,version=version+1,updated_at=? WHERE id=?',at,s.id);}return sessions.length;
}
