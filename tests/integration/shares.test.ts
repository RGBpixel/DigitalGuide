import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import fs from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {Repository} from '@digitalguide/database';
import {shareDraftSchema,sharePlayerSchema,shareIssuedSchema,type ShareDraft,type ShareViewerState,type ShareIssued,type ShareStats} from '@digitalguide/contracts';
import {createApp} from '../../apps/api/src/app.js';
import {sweepShares} from '../../apps/api/src/shares.js';
import * as files from '../../packages/media/src/files.js';
import {fixtureIds as f} from '../../packages/test-fixtures/src/seed.js';
import {shareDefinitionFixture} from '../../packages/test-fixtures/src/shares.js';
import {harness} from './helpers.js';
import {shareApi,sharePublished,shareInvite,shareJoinViewer,type ShareHarness} from './share-helpers.js';
let h:ShareHarness;
beforeEach(async()=>{h=await harness();});afterEach(async()=>{vi.restoreAllMocks();await h.close();});
const sha=(v:Buffer)=>createHash('sha256').update(v).digest('hex');
describe('R-085 approved interactive sharing',()=>{
 it('以独立批准的MP4建立固定发布版；外部DTO不暴露成员、草稿名、工程、资产与存储',async()=>{
  const p=await sharePublished(h),issued=await shareInvite(h,p.release),g=await shareJoinViewer(h,issued),{get}=shareApi(h);
  expect(shareDraftSchema.parse(p.draft).plan.media).toEqual({durationMs:6000,width:1920,height:1080});shareIssuedSchema.parse(issued);sharePlayerSchema.parse(g.context);
  expect(g.context.aiDisclosure).toContain('非真人克隆');const json=JSON.stringify(g.context);for(const secret of [p.project.id,p.variant.id,p.output.id,p.draft.id,p.draft.name,'storage_key','actorId','tenantId','workspaceId','snapshot','rightsNote','内部邀请名称'])expect(json).not.toContain(secret);
  const video=await get(g.base+'/video',g.headers);expect(video.statusCode).toBe(200);expect(sha(video.rawPayload)).toBe(p.output.artifacts.find(a=>a.kind==='video')!.sha256);
  const range=await h.app.inject({url:'/api/v1'+g.base+'/video',headers:{...g.headers,range:'bytes=0-63'}});expect(range.statusCode).toBe(206);expect(range.rawPayload).toEqual(video.rawPayload.subarray(0,64));
  for(const url of ['/me','/assets/'+f.voiceA+'/content','/studio/projects/'+p.project.id,'/share-releases/'+p.release.id+'/stats'])expect((await get(url,g.headers)).statusCode).toBe(401);
  expect((await get(g.base+'/captions',g.headers)).body).toContain('WEBVTT');expect((await get(g.base+'/poster',g.headers)).headers['content-type']).toContain('image/png');
 },60000);
 it('默认不记录；同意后跳转与选项可追踪，重复请求只记一次，关闭后删除断点与事件',async()=>{
  const p=await sharePublished(h),i=await shareInvite(h,p.release),g=await shareJoinViewer(h,i),{post,get,good}=shareApi(h);let state=g.context.state;
  expect(state).toMatchObject({consent:false,positionMs:0,eventCount:0});expect((await post(g.base+'/events',{version:1,type:'play',timeMs:0},g.headers)).statusCode).toBe(403);expect(h.repo.get<{n:number}>('SELECT count(*) n FROM studio_share_events')!.n).toBe(0);
  state=await good<ShareViewerState>(g.base+'/consent',{version:state.version,enabled:true},g.headers);const input={version:state.version,type:'interaction',timeMs:2500,widgetId:'interest',optionId:'detail'},key=randomUUID(),a=await post(g.base+'/events',input,g.headers,key);expect(a.statusCode,a.body).toBe(200);state=a.json().data;
  expect(state).toMatchObject({positionMs:2500,eventCount:1});expect((await post(g.base+'/events',input,g.headers,key)).json().data.eventCount).toBe(1);expect((await post(g.base+'/events',{...input,optionId:'stay'},g.headers,key)).statusCode).toBe(409);
  expect((await get(g.base+'/context',g.headers)).json().data.state.positionMs).toBe(2500);const joinedAgain=await post(g.base+'/join',{access:g.access},g.headers);expect(joinedAgain.statusCode).toBe(200);expect(joinedAgain.headers['set-cookie']!.toString().split(';')[0]).toBe(g.headers.cookie);expect(h.repo.all('SELECT * FROM studio_share_sessions')).toHaveLength(1);expect((await get(g.base+'/context',g.headers)).json().data.state.eventCount).toBe(1);const stats=(await get('/share-releases/'+p.release.id+'/stats')).json().data as ShareStats;expect(stats).toMatchObject({consentingSessions:1,events:1,interactions:[{widgetId:'interest',optionId:'detail',count:1}]});expect(JSON.stringify(stats)).not.toContain(g.headers.cookie);
  state=await good<ShareViewerState>(g.base+'/consent',{version:state.version,enabled:false},g.headers);expect(state).toMatchObject({consent:false,positionMs:0,eventCount:0});expect(h.repo.all('SELECT * FROM studio_share_events')).toHaveLength(0);expect(h.repo.all('SELECT * FROM studio_share_event_requests')).toHaveLength(0);
  expect((await post(g.base+'/events',input,g.headers,key)).statusCode).toBe(403);expect((await get('/share-releases/'+p.release.id+'/stats')).json().data.events).toBe(0);
 },60000);
 it('互动需绑定存在且当时可见的组件和选项；跨窗口CAS和CSRF拒绝不改记录',async()=>{
  const p=await sharePublished(h),i=await shareInvite(h,p.release),g=await shareJoinViewer(h,i),{post,good}=shareApi(h),state=await good<ShareViewerState>(g.base+'/consent',{version:1,enabled:true},g.headers);
  for(const body of [{version:state.version,type:'interaction',timeMs:0,widgetId:'interest',optionId:'detail'},{version:state.version,type:'interaction',timeMs:2500,widgetId:'interest',optionId:'foreign'},{version:state.version,type:'progress',timeMs:6001},{version:state.version,type:'play',timeMs:0,widgetId:'interest'}])expect((await post(g.base+'/events',body,g.headers)).statusCode).toBeGreaterThanOrEqual(400);
  expect((await post(g.base+'/events',{version:state.version,type:'play',timeMs:0},{...g.headers,'x-csrf-token':'invalid'})).statusCode).toBe(403);
  expect((await h.app.inject({method:'POST',url:'/api/v1'+g.base+'/events',headers:{...g.headers,origin:'https://evil.example','idempotency-key':randomUUID()},payload:{version:state.version,type:'play',timeMs:0}})).statusCode).toBe(403);
  const pair=await Promise.all([post(g.base+'/events',{version:state.version,type:'seek',timeMs:1200},g.headers),post(g.base+'/events',{version:state.version,type:'seek',timeMs:1600},g.headers)]);expect(pair.map(v=>v.statusCode).sort()).toEqual([200,409]);expect(h.repo.all('SELECT * FROM studio_share_events')).toHaveLength(1);
 },60000);
 it('保存新草稿不会改旧发布版；角色、空间、环境、发布权限和未批准来源均由服务端拦截',async()=>{
  const p=await sharePublished(h),i=await shareInvite(h,p.release),g=await shareJoinViewer(h,i),{post,get,good}=shareApi(h),editor=await h.login(f.editorA),viewer=await h.login(f.viewerA),other=await h.login(f.adminB),d=shareDefinitionFixture();d.chapters[0].title='仅新草稿标题';
  const updated=await good<ShareDraft>('/shares/'+p.draft.id+'/save',{version:1,name:p.draft.name,variantId:p.variant.id,definition:d},editor);expect(updated.version).toBe(2);expect((await get(g.base+'/context',g.headers)).json().data.definition.chapters[0].title).toBe('产品介绍');
  expect((await post('/shares/'+p.draft.id+'/save',{version:1,name:'过期覆盖',variantId:p.variant.id,definition:d},editor)).statusCode).toBe(409);expect((await post('/shares/'+p.draft.id+'/publish',{version:2,planHash:updated.plan.hash,confirmed:true,rightsConfirmed:true},editor)).statusCode).toBe(403);
  expect((await post('/share-releases/'+p.release.id+'/links',{version:1,title:'越权',access:'public',expiresAt:new Date(Date.now()+86400000).toISOString(),embedOrigins:[],recordingEnabled:false,retentionDays:7,confirmed:true},viewer)).statusCode).toBe(403);expect((await get('/shares/'+p.draft.id,other)).statusCode).toBe(404);
  h.repo.run('UPDATE distribution_variants SET platform=\'youtube\' WHERE id=?',p.variant.id);expect((await post('/shares',{workspaceId:f.workspaceA,name:'越过渠道审核',variantId:p.variant.id,definition:d})).statusCode).toBe(409);expect((await get(g.base+'/video',g.headers)).statusCode).toBe(409);
 },60000);
 it('未列出链接需密钥，加入幂等只产生一次会话；轮换、撤回和撤回发布版阻断旧会话与旧回放',async()=>{
  const p=await sharePublished(h),i=await shareInvite(h,p.release),{post,get,good}=shareApi(h),base='/external/shares/'+i.link.id,key=randomUUID(),access=new URL(i.url).hash.slice('#access='.length);
  expect((await post(base+'/join',{},{} as ShareHarness['headers'])).statusCode).toBe(401);expect((await post(base+'/join',{access:'a'.repeat(64)},{} as ShareHarness['headers'])).statusCode).toBe(401);
  const a=await post(base+'/join',{access},{} as ShareHarness['headers'],key),b=await post(base+'/join',{access},{} as ShareHarness['headers'],key);expect(a.statusCode,a.body).toBe(200);expect(b.headers['set-cookie']).toEqual(a.headers['set-cookie']);expect(h.repo.all('SELECT * FROM studio_share_sessions')).toHaveLength(1);
  const g=await shareJoinViewer(h,i),rotated=await good<ShareIssued>('/share-links/'+i.link.id+'/rotate',{version:1,confirmed:true});expect(rotated.url).not.toBe(i.url);expect((await get(g.base+'/context',g.headers)).statusCode).toBe(401);expect((await post(base+'/join',{access},{} as ShareHarness['headers'],key)).statusCode).toBe(401);
  const fresh=await shareJoinViewer(h,rotated);expect((await get(fresh.base+'/video',fresh.headers)).statusCode).toBe(200);await good('/share-links/'+i.link.id+'/revoke',{version:2,confirmed:true});expect((await get(fresh.base+'/video',fresh.headers)).statusCode).toBe(409);
  expect((await post('/share-links/'+i.link.id+'/rotate',{version:3,confirmed:true})).statusCode).toBe(409);const another=await shareInvite(h,p.release),g2=await shareJoinViewer(h,another);await good('/share-releases/'+p.release.id+'/withdraw',{version:1,confirmed:true});expect((await get(g2.base+'/context',g2.headers)).statusCode).toBe(409);
 },60000);
 it('明确公开的页面仍需独立观看会话；HTTPS提供Partitioned Cookie与严格精确来源CSP',async()=>{
  const p=await sharePublished(h),i=await shareInvite(h,p.release,{access:'public',embedOrigins:['https://embed.example:8443']}),{get,post}=shareApi(h);expect(new URL(i.url).hash).toBe('');
  const shell=await get('/external/shares/'+i.link.id+'/player',{} as ShareHarness['headers']);expect(shell.headers['content-security-policy']).toContain("frame-ancestors 'self' https://embed.example:8443;");expect(shell.headers['permissions-policy']).toContain('camera=()');expect(shell.body).not.toContain(p.variant.title);
  expect((await get('/external/shares/'+i.link.id+'/video',{} as ShareHarness['headers'])).statusCode).toBe(401);const g=await shareJoinViewer(h,i);expect((await get(g.base+'/video',g.headers)).statusCode).toBe(200);
  const secure=await createApp({...h.config,webOrigin:'https://player.example'},h.repo);try{const join=await secure.inject({method:'POST',url:'/api/v1/external/shares/'+i.link.id+'/join',headers:{origin:'https://player.example','idempotency-key':randomUUID()},payload:{}});expect(join.statusCode,join.body).toBe(200);const cookie=join.headers['set-cookie']!.toString();for(const s of ['HttpOnly','Secure','SameSite=None','Partitioned','Path=/api/v1/external/shares/'+i.link.id])expect(cookie).toContain(s);}finally{await secure.close();}
  expect((await post('/share-releases/'+p.release.id+'/links',{version:1,title:'通配符',access:'public',expiresAt:new Date(Date.now()+86400000).toISOString(),embedOrigins:['https://*.example.com'],recordingEnabled:false,retentionDays:7,confirmed:true})).statusCode).toBe(422);
 },60000);
 it('记录撤回、到期保留清理与禁用记录不会通过旧幂等请求复活记录',async()=>{
  const p=await sharePublished(h),i=await shareInvite(h,p.release),g=await shareJoinViewer(h,i),{good,post,get}=shareApi(h);const state=await good<ShareViewerState>(g.base+'/consent',{version:1,enabled:true},g.headers);await good<ShareViewerState>(g.base+'/events',{version:state.version,type:'play',timeMs:1000},g.headers);
  h.repo.run('UPDATE studio_share_sessions SET records_expires_at=? WHERE link_id=?',new Date(Date.now()-1000).toISOString(),i.link.id);expect((await get(g.base+'/context',g.headers)).json().data.state).toMatchObject({consent:false,positionMs:0,eventCount:0});expect((await get('/share-releases/'+p.release.id+'/stats')).json().data.events).toBe(0);expect(h.repo.transaction(()=>sweepShares(h.repo,h.config))).toBe(1);expect(h.repo.all('SELECT * FROM studio_share_events')).toHaveLength(0);expect(h.repo.all('SELECT * FROM studio_share_event_requests')).toHaveLength(0);
  const disabled=await shareInvite(h,p.release,{recordingEnabled:false}),g2=await shareJoinViewer(h,disabled);expect((await post(g2.base+'/consent',{version:1,enabled:true},g2.headers)).statusCode).toBe(409);expect((await post(g2.base+'/events',{version:1,type:'play',timeMs:0},g2.headers)).statusCode).toBe(403);
 },60000);
 it('媒体异步摘要后重新校验撤回与当前发布权限；损坏字节不提供视频',async()=>{
  const p=await sharePublished(h),i=await shareInvite(h,p.release),g=await shareJoinViewer(h,i),{get}=shareApi(h),original=files.fileDigest;
  const spy=vi.spyOn(files,'fileDigest').mockImplementation(async(...args)=>{const result=await original(...args);h.repo.run('UPDATE studio_share_links SET revoked_at=? WHERE id=?',new Date().toISOString(),i.link.id);return result;});expect((await get(g.base+'/video',g.headers)).statusCode).toBe(409);spy.mockRestore();
  const another=await shareInvite(h,p.release),g2=await shareJoinViewer(h,another),artifact=h.repo.get<{storage_key:string}>('SELECT storage_key FROM studio_export_artifacts WHERE export_id=? AND kind=\'video\'',p.output.id)!;fs.appendFileSync(files.ownedFile(h.config.dataDir+'/objects',artifact.storage_key),'corrupt');expect((await get(g2.base+'/video',g2.headers)).statusCode).toBe(409);
 },60000);
 it('重启后旧观看Cookie、固定媒体、断点与统计持续存在，其他环境和工作空间不能读取',async()=>{
  const p=await sharePublished(h),i=await shareInvite(h,p.release),g=await shareJoinViewer(h,i),{good}=shareApi(h);let state=await good<ShareViewerState>(g.base+'/consent',{version:1,enabled:true},g.headers);state=await good<ShareViewerState>(g.base+'/events',{version:state.version,type:'seek',timeMs:3100},g.headers);
  const config=h.config;await h.close();const repo=new Repository(config.dataDir,config.root,{environment:config.providerMode,appEnv:config.appEnv}),app=await createApp(config,repo);h={...h,repo,app,async close(){await app.close();repo.close();}};
  expect((await shareApi(h).get(g.base+'/context',g.headers)).json().data.state).toMatchObject({version:state.version,positionMs:3100,eventCount:1});expect((await shareApi(h).get(g.base+'/video',g.headers)).statusCode).toBe(200);
  const sandbox=await createApp({...config,providerMode:'sandbox'},repo);try{expect((await sandbox.inject({url:'/api/v1'+g.base+'/context',headers:g.headers})).statusCode).toBe(404);}finally{await sandbox.close();}
  repo.run('UPDATE memberships SET workspace_ids=? WHERE user_id=?',JSON.stringify([f.workspacePrivate]),f.adminA);expect((await shareApi(h).get(g.base+'/video',g.headers)).statusCode).toBe(409);
  const records=repo.all<{response:string}>('SELECT response FROM idempotency');for(const r of records){expect(r.response).not.toContain(g.access);expect(r.response).not.toContain(g.context.state.csrfToken);}expect(JSON.stringify(repo.all('SELECT * FROM audit_events'))).not.toContain(g.access);
 },60000);
});
