import {randomUUID,createHash,createHmac,timingSafeEqual} from 'node:crypto';
import type {z} from 'zod';
import {AppError,canonical,requirePermission,requireWorkspace,type Principal} from '@digitalguide/domain';
import type {Repository} from '@digitalguide/database';
import {type peerInviteCreate,type peerConsent,type PeerInvite,type PeerGuestContext,type PeerAttempt} from '@digitalguide/contracts';
import type {Config} from './config.js';
import {LiveService} from './live-service.js';
import {LiveOutputs} from './live-output-service.js';
const now=()=>new Date().toISOString();
export const peerHash=(v:unknown)=>createHash('sha256').update(typeof v==='string'?v:canonical(v)).digest('hex');
export const samePeerSecret=(a:string,b:string)=>a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export interface PeerInviteRow{id:string;session_id:string;tenant_id:string;workspace_id:string;actor_id:string;public_title:string;expires_at:string;access_nonce:string;access_hash:string|null;consumed_access_hash:string|null;status:PeerInvite['status'];version:number;reason:string|null;environment:string;app_env:string;created_at:string;updated_at:string}
export interface PeerGuestRow{id:string;invite_id:string;nickname:string;cookie_hash:string|null;join_key_hash:string;status:PeerGuestContext['status'];version:number;consent_version:number;camera:number;microphone:number;client_id:string|null;consent_expires_at:string|null;seen_at:string;created_at:string;updated_at:string}
export interface PeerAttemptRow{id:string;invite_id:string;guest_id:string;consent_version:number;host_id:string;host_client_id:string;guest_client_id:string;status:PeerAttempt['status'];version:number;host_lease_until:string;guest_lease_until:string;host_sequence:number;guest_sequence:number;host_connection:string;guest_connection:string;host_received_bytes:number;guest_received_bytes:number;host_decoded_frames:number;guest_decoded_frames:number;host_program_version:number;host_program_ready:number;reason:string|null;created_at:string;updated_at:string}
export class LivePeers {
 live:LiveService;outputs:LiveOutputs;
 constructor(public repo:Repository,public config:Config){this.live=new LiveService(repo,config);this.outputs=new LiveOutputs(this.live);}
 version(r:{version:number},version:number){if(r.version!==version)throw new AppError('VERSION_CONFLICT','连麦状态已被另一窗口修改，请载入当前状态。',409);}
 invite(id:string){const i=this.repo.get<PeerInviteRow>('SELECT * FROM live_peer_invites WHERE id=? AND environment=? AND app_env=?',id,this.config.providerMode,this.config.appEnv);if(!i)throw new AppError('NOT_FOUND','邀请不存在或不在当前环境。',404);return i;}
 host(p:Principal,i:PeerInviteRow,permission:'live.start'|'live.moderate'='live.moderate'){if(i.tenant_id!==p.tenantId)throw new AppError('NOT_FOUND','本空间没有此连麦邀请。',404);requireWorkspace(p,i.workspace_id);requirePermission(p,permission);}
 issuer(i:PeerInviteRow){const p={...this.repo.principal(i.actor_id),environment:this.config.providerMode,appEnv:this.config.appEnv};this.host(p,i,'live.start');return p;}
 program(i:PeerInviteRow,running=false){
  this.live.runtime();const p=this.issuer(i),session=this.live.session(p,i.session_id),snapshot=this.live.current(p,session),ref=this.repo.get<{id:string}>('SELECT id FROM live_outputs WHERE session_id=?',session.id);
  if(!ref)throw new AppError('PEER_CONTINUOUS_OUTPUT_REQUIRED','请先为本场准备连续媒体，再创建连麦邀请。',409);
  const output=this.outputs.row(p,ref.id);this.outputs.current(p,output);
  if(['ended','failed'].includes(session.status)||['completed','cancelled','withdrawn','failed'].includes(output.status))throw new AppError('PEER_PROGRAM_STOPPED','本场节目或连续媒体已停止，请新建场次。',409);
  if(running&&(!['live','preview'].includes(session.status)||output.status!=='running'||output.published_frames<1))throw new AppError('PEER_PROGRAM_NOT_READY','请先试播并等待实际连续画面，再接通来宾。',409);
  return{p,session,output,snapshot};
 }
 activeInvite(i:PeerInviteRow){if(!['issued','used'].includes(i.status)||i.expires_at<=now())throw new AppError('PEER_INVITE_ENDED','邀请已到期或结束，请向主持人重新领取。',410);this.program(i);}
 guest(i:PeerInviteRow){return this.repo.get<PeerGuestRow>('SELECT * FROM live_peer_guests WHERE invite_id=?',i.id);}
 guestById(id:string){const g=this.repo.get<PeerGuestRow>('SELECT * FROM live_peer_guests WHERE id=?',id);if(!g)throw new AppError('NOT_FOUND','当前邀请没有此来宾。',404);return g;}
 access(i:PeerInviteRow){return createHmac('sha256',this.config.sessionSecret).update('digitalguide-live-peer-link-v1:'+i.id+':'+i.access_nonce).digest('hex');}
 cookie(i:PeerInviteRow,access:string,key:string){return createHmac('sha256',this.config.sessionSecret).update('digitalguide-live-peer-cookie-v1:'+i.id+':'+access+':'+key).digest('hex');}
 csrf(g:PeerGuestRow,cookie:string){return createHmac('sha256',this.config.sessionSecret).update('digitalguide-live-peer-csrf-v1:'+g.id+':'+cookie).digest('hex');}
 authenticate(id:string,cookie:string|undefined,csrf?:string,write=false){
  const i=this.invite(id),g=this.guest(i);if(!cookie||!g?.cookie_hash||g.status==='withdrawn'||!samePeerSecret(peerHash(cookie),g.cookie_hash))throw new AppError('PEER_GUEST_AUTH','本次连麦登录已结束，请重新领取邀请。',401);
  if(write&&(!csrf||!samePeerSecret(this.csrf(g,cookie),csrf)))throw new AppError('FORBIDDEN','连麦安全凭证已变化，请刷新邀请页面。',403);
  try{this.activeInvite(i);}catch{throw new AppError('PEER_INVITE_ENDED','邀请已到期、节目来源不可用或主持人已结束本次连麦。',410);}
  return{i,g,cookie};
 }
 issue(p:Principal,input:z.infer<typeof peerInviteCreate>){
  const session=this.live.session(p,input.sessionId);this.live.scope(p,session.workspace_id,'live.start');this.live.current(p,session);
  const expiresAt=new Date(input.expiresAt).toISOString(),at=now();if(expiresAt<=at||Date.parse(expiresAt)>Date.now()+86400000)throw new AppError('PEER_INVITE_EXPIRY','邀请需要在未来24小时内到期。',409);
  if(this.repo.get<{n:number}>('SELECT count(*) n FROM live_peer_invites WHERE session_id=?',session.id)!.n>=30||this.repo.get<{n:number}>("SELECT count(*) n FROM live_peer_invites WHERE tenant_id=? AND environment=? AND app_env=? AND status IN ('issued','used') AND expires_at>?",p.tenantId,this.config.providerMode,this.config.appEnv,at)!.n>=50)throw new AppError('PEER_INVITE_LIMIT','本场或本组织有效邀请已达上限，请结束旧邀请。',429);
  const id=randomUUID(),i:PeerInviteRow={id,session_id:session.id,tenant_id:p.tenantId,workspace_id:session.workspace_id,actor_id:p.userId,public_title:input.publicTitle,expires_at:expiresAt,access_nonce:randomUUID(),access_hash:null,consumed_access_hash:null,status:'issued',version:1,reason:null,environment:this.config.providerMode,app_env:this.config.appEnv,created_at:at,updated_at:at};
  const source=this.program(i),outputSnapshot=this.outputs.snapshot(source.output),expiry=[...source.snapshot.sources.flatMap(s=>[s.expiresAt,...s.assets.map(a=>a.expiresAt)]),...outputSnapshot.assets.map(a=>a.expiresAt),outputSnapshot.puppet?.binding.expiresAt].filter((v):v is string=>!!v).sort()[0];if(expiry&&expiry<expiresAt)throw new AppError('PEER_INVITE_RIGHTS','邀请不能晚于已固定节目及素材的最早授权期限 '+expiry+'。',409);
  this.repo.run('INSERT INTO live_peer_invites(id,session_id,tenant_id,workspace_id,actor_id,public_title,expires_at,access_nonce,access_hash,environment,app_env,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',id,i.session_id,i.tenant_id,i.workspace_id,i.actor_id,i.public_title,i.expires_at,i.access_nonce,peerHash(this.access(i)),i.environment,i.app_env,at,at);return id;
 }
 issued(p:Principal,i:PeerInviteRow){this.host(p,i,'live.start');this.activeInvite(i);if(i.status==='issued'&&peerHash(this.access(i))!==i.access_hash)throw new AppError('PEER_INVITE_KEY_CHANGED','邀请签名配置已变化，请撤销此邀请后重新创建。',409);return{invite:this.view(p,i),url:i.status==='issued'?this.config.webOrigin+'/live-guest/'+i.id+'#access='+this.access(i):null};}
 join(i:PeerInviteRow,access:string,key:string){
  this.activeInvite(i);const old=this.guest(i),digest=peerHash(access),keyHash=peerHash(key);
  if(old){if(i.status!=='used'||old.status==='withdrawn'||old.join_key_hash!==keyHash||i.consumed_access_hash!==digest)throw new AppError('PEER_INVITE_USED','邀请已经由一个浏览器领取，请向主持人获取新邀请。',409);const cookie=this.cookie(i,access,key);if(peerHash(cookie)!==old.cookie_hash)throw new AppError('PEER_INVITE_ENDED','原连麦登录已失效。',410);return{guest:old,cookie};}
  if(i.status!=='issued'||!i.access_hash||!samePeerSecret(i.access_hash,digest))throw new AppError('PEER_INVITE_CODE','邀请凭证不正确或已失效。',403);
  const id=randomUUID(),at=now(),cookie=this.cookie(i,access,key);
  this.repo.run('INSERT INTO live_peer_guests(id,invite_id,cookie_hash,join_key_hash,seen_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',id,i.id,peerHash(cookie),keyHash,at,at,at);
  this.repo.run("UPDATE live_peer_invites SET status='used',consumed_access_hash=access_hash,access_hash=NULL,version=version+1,updated_at=? WHERE id=?",at,i.id);return{guest:this.guestById(id),cookie};
 }
 request(i:PeerInviteRow,g:PeerGuestRow,input:z.infer<typeof peerConsent>){
  this.activeInvite(i);if(g.status==='withdrawn'||g.consent_version>=5)throw new AppError('PEER_CONSENT_LIMIT','本邀请已结束或已达五次授权上限，请领取新邀请。',409);
  const v=g.consent_version+1,at=now(),expires=[i.expires_at,new Date(Date.now()+3600000).toISOString()].sort()[0];
  this.closeGuestAttempts(g.id,'来宾重新确认设备与授权');this.repo.run('UPDATE live_peer_consents SET withdrawn_at=COALESCE(withdrawn_at,?) WHERE guest_id=?',at,g.id);
  this.repo.run('INSERT INTO live_peer_consents VALUES (?,?,?,?,?,?,?,?,?,NULL)',g.id,v,input.media.camera?1:0,input.media.microphone?1:0,input.statementVersion,'backstage_call',input.clientId,expires,at);
  this.repo.run("UPDATE live_peer_guests SET status='requested',nickname=?,camera=?,microphone=?,client_id=?,consent_version=?,consent_expires_at=?,version=version+1,seen_at=?,updated_at=? WHERE id=?",input.nickname,input.media.camera?1:0,input.media.microphone?1:0,input.clientId,v,expires,at,at,g.id);
 }
 decide(p:Principal,i:PeerInviteRow,g:PeerGuestRow,version:number,decision:'approve'|'reject'){
  this.host(p,i);this.activeInvite(i);this.version(g,version);if(g.status!=='requested'||!g.consent_expires_at||g.consent_expires_at<=now())throw new AppError('PEER_CONSENT_REQUIRED','来宾需要先主动打开设备并提交当前授权申请。',409);
  this.repo.run('UPDATE live_peer_guests SET status=?,version=version+1,updated_at=? WHERE id=?',decision==='approve'?'approved':'rejected',now(),g.id);if(decision==='reject')this.closeGuestAttempts(g.id,'主持人未批准本次申请');
 }
 connect(p:Principal,i:PeerInviteRow,g:PeerGuestRow,version:number,clientId:string){
  this.host(p,i,'live.start');this.activeInvite(i);this.program(i,true);this.version(g,version);
  if(g.status!=='approved'||!g.client_id||!g.consent_expires_at||g.consent_expires_at<=now())throw new AppError('PEER_APPROVAL_REQUIRED','请先取得来宾当前设备授权并批准申请。',409);
  if(this.repo.get("SELECT id FROM live_peer_attempts WHERE guest_id=? AND status='active'",g.id))throw new AppError('PEER_ALREADY_ACTIVE','此来宾已有主持设备连接，请先结束原连接后重新接通。',409);
  if(this.repo.get<{n:number}>("SELECT count(*) n FROM live_peer_attempts a JOIN live_peer_invites i ON i.id=a.invite_id WHERE i.session_id=? AND a.status='active'",i.session_id)!.n>=3)throw new AppError('PEER_CONNECTION_LIMIT','本场最多同时接通三位来宾，请先结束其他连接。',429);
  if(this.repo.get<{n:number}>('SELECT count(*) n FROM live_peer_attempts WHERE guest_id=?',g.id)!.n>=20)throw new AppError('PEER_ATTEMPT_LIMIT','本邀请已达二十次连接上限，请领取新邀请。',429);
  const id=randomUUID(),at=now(),lease=new Date(Date.now()+15000).toISOString();this.repo.run('INSERT INTO live_peer_attempts(id,invite_id,guest_id,consent_version,host_id,host_client_id,guest_client_id,host_lease_until,guest_lease_until,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',id,i.id,g.id,g.consent_version,p.userId,clientId,g.client_id,lease,lease,at,at);return id;
 }
 attempt(id:string){const a=this.repo.get<PeerAttemptRow>('SELECT * FROM live_peer_attempts WHERE id=?',id);if(!a)throw new AppError('NOT_FOUND','连麦连接不存在。',404);return a;}
 assertAttempt(a:PeerAttemptRow,side:'host'|'guest',clientId:string){
  const i=this.invite(a.invite_id),g=this.guestById(a.guest_id);this.activeInvite(i);const source=this.program(i,true),at=now();
  if(a.status!=='active'||a.host_lease_until<=at||a.guest_lease_until<=at)throw new AppError('PEER_CONNECTION_ENDED','原连麦已结束或心跳到期，请重新确认后接通。',410);
  if(g.status!=='approved'||g.consent_version!==a.consent_version||g.client_id!==a.guest_client_id||!g.consent_expires_at||g.consent_expires_at<=at)throw new AppError('PEER_CONSENT_CHANGED','来宾设备或授权已变化，旧连接已失效。',409);
  const host={...this.repo.principal(a.host_id),environment:this.config.providerMode,appEnv:this.config.appEnv};this.host(host,i,'live.start');
  if(clientId!==(side==='host'?a.host_client_id:a.guest_client_id))throw new AppError('PEER_DEVICE_CHANGED','请求不属于当前连麦设备，请重新确认连接。',409);
  return{i,g,source};
 }
 end(a:PeerAttemptRow,reason:string,status:'ended'|'expired'|'failed'='ended'){if(a.status==='active'){const at=now();this.repo.run('UPDATE live_peer_attempts SET status=?,reason=?,version=version+1,updated_at=? WHERE id=?',status,reason,at,a.id);this.repo.run('UPDATE live_peer_consents SET withdrawn_at=COALESCE(withdrawn_at,?) WHERE guest_id=? AND version=?',at,a.guest_id,a.consent_version);this.repo.run("UPDATE live_peer_guests SET status='joined',camera=0,microphone=0,client_id=NULL,consent_expires_at=NULL,version=version+1,updated_at=? WHERE id=? AND consent_version=? AND status='approved'",at,a.guest_id,a.consent_version);}this.repo.run('DELETE FROM live_peer_signals WHERE attempt_id=?',a.id);}
 closeGuestAttempts(guestId:string,reason:string){for(const a of this.repo.all<PeerAttemptRow>("SELECT * FROM live_peer_attempts WHERE guest_id=? AND status='active'",guestId))this.end(a,reason);}
 close(i:PeerInviteRow,reason:string,status:'revoked'|'expired'|'closed'='revoked'){if(['issued','used'].includes(i.status))this.repo.run('UPDATE live_peer_invites SET status=?,access_hash=NULL,consumed_access_hash=NULL,reason=?,version=version+1,updated_at=? WHERE id=?',status,reason,now(),i.id);}
 attemptView(a:PeerAttemptRow):PeerAttempt {
  const consent=this.repo.get<{camera:number;microphone:number;expires_at:string}>('SELECT camera,microphone,expires_at FROM live_peer_consents WHERE guest_id=? AND version=?',a.guest_id,a.consent_version)!;
  const i=this.invite(a.invite_id),s=this.repo.get<{version:number;state:string}>('SELECT version,state FROM live_sessions WHERE id=?',i.session_id)!,clock=JSON.parse(s.state) as {muted:boolean},output=this.repo.get<{status:string;published_frames:number}>('SELECT status,published_frames FROM live_outputs WHERE session_id=?',i.session_id);
  return{id:a.id,guestId:a.guest_id,inviteId:a.invite_id,version:a.version,status:a.status,consentVersion:a.consent_version,media:{camera:!!consent.camera,microphone:!!consent.microphone},leaseExpiresAt:[a.host_lease_until,a.guest_lease_until,i.expires_at,consent.expires_at].sort()[0],reason:a.reason,program:{version:s.version,muted:clock.muted,ready:!!a.host_program_ready&&a.host_program_version===s.version&&output?.status==='running'&&output.published_frames>0}};
 }
 view(p:Principal,i:PeerInviteRow):PeerInvite {
  this.host(p,i);let reason=i.reason;try{this.activeInvite(i);}catch(error){reason=error instanceof AppError?error.message:'节目来源暂不可用。';}
  const g=this.guest(i),a=g?this.repo.get<PeerAttemptRow>('SELECT * FROM live_peer_attempts WHERE guest_id=? ORDER BY created_at DESC,id DESC LIMIT 1',g.id):undefined;
  return{id:i.id,sessionId:i.session_id,publicTitle:i.public_title,version:i.version,status:i.status,expiresAt:i.expires_at,unavailableReason:reason,guest:g?{id:g.id,nickname:g.nickname,version:g.version,status:g.status,consentVersion:g.consent_version,camera:!!g.camera,microphone:!!g.microphone,consentExpiresAt:g.consent_expires_at,attempt:a?this.attemptView(a):null}:null};
 }
 context(i:PeerInviteRow,g:PeerGuestRow,cookie:string):PeerGuestContext {const a=this.repo.get<PeerAttemptRow>("SELECT * FROM live_peer_attempts WHERE guest_id=? AND status='active'",g.id);return{inviteId:i.id,guestId:g.id,publicTitle:i.public_title,nickname:g.nickname,status:g.status,version:g.version,consentVersion:g.consent_version,camera:!!g.camera,microphone:!!g.microphone,consentExpiresAt:g.consent_expires_at,expiresAt:i.expires_at,csrfToken:this.csrf(g,cookie),attempt:a?this.attemptView(a):null,purpose:'backstage_call',recordingEnabled:false,automaticTranscriptionEnabled:false};}
 limit(key:string,max:number){const at=now(),start=new Date(Date.now()-60000).toISOString(),old=this.repo.get<{window_at:string;count:number}>('SELECT * FROM live_peer_limits WHERE key=?',key);if(old&&old.window_at>start&&old.count>=max)throw new AppError('PEER_RATE_LIMIT','请求过于频繁，请稍后重试。',429);this.repo.run('INSERT INTO live_peer_limits VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET window_at=CASE WHEN window_at<=? THEN excluded.window_at ELSE window_at END,count=CASE WHEN window_at<=? THEN 1 ELSE count+1 END',key,at,start,start);}
 sweep(){const at=now();this.repo.transaction(()=>{for(const i of this.repo.all<PeerInviteRow>("SELECT * FROM live_peer_invites WHERE status IN ('issued','used') AND environment=? AND app_env=? LIMIT 500",this.config.providerMode,this.config.appEnv)){if(i.expires_at<=at)this.close(i,'邀请已经到期','expired');else try{this.program(i);}catch{this.close(i,'节目来源或主持权限已经失效','closed');}}for(const a of this.repo.all<PeerAttemptRow>("SELECT a.* FROM live_peer_attempts a JOIN live_peer_invites i ON i.id=a.invite_id WHERE a.status='active' AND i.environment=? AND i.app_env=? AND (a.host_lease_until<=? OR a.guest_lease_until<=?) LIMIT 500",this.config.providerMode,this.config.appEnv,at,at))this.end(a,'连接心跳到期，请重新接通','expired');for(const a of this.repo.all<PeerAttemptRow>("SELECT a.* FROM live_peer_attempts a JOIN live_peer_guests g ON g.id=a.guest_id JOIN live_peer_invites i ON i.id=a.invite_id WHERE a.status='active' AND i.environment=? AND i.app_env=? AND (g.consent_expires_at<=? OR g.status!='approved' OR g.consent_version!=a.consent_version) LIMIT 500",this.config.providerMode,this.config.appEnv,at))this.end(a,'来宾授权已经变化','expired');this.repo.run('DELETE FROM live_peer_limits WHERE window_at<=?',new Date(Date.now()-3600000).toISOString());});}
}
