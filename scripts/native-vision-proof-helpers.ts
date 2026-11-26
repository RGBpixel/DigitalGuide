import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import type {Asset,Profile,SceneApp,ReceptionTerminal,ReceptionSession,VisualGrant} from '../packages/contracts/src/index.js';
import {syntheticPng} from '../packages/media/src/index.js';
import {NativePostgresDatabase} from '../packages/postgres/src/runtime-database.js';
import {loadNativeRuntimeConfig} from '../packages/postgres/src/runtime-config.js';
import {NativeCoreRepository} from '../packages/postgres/src/runtime-repository.js';
import {NativeVision} from '../packages/postgres/src/runtime-vision.js';
import {MemoryProof,type MemoryProofGuest} from './native-guest-memory-proof-helpers.js';
import {proofHash} from './postgres-content-proof-runtime.js';

export const visionWorkspace='20000000-0000-4000-8000-000000000001';
const tenant='10000000-0000-4000-8000-000000000001';
export const visionHash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export class VisionProof extends MemoryProof {
 async sources(){
  const uploaded=await this.c.good<{uploadId:string}>('/assets/uploads',{workspaceId:visionWorkspace,fileName:'原创视觉接待角色.png',contentBase64:syntheticPng([28,92,124]).toString('base64')}),asset=await this.c.good<Asset>('/assets',{uploadId:uploaded.uploadId,name:'原创视觉接待角色',category:'avatar'}),profile=await this.c.good<Profile>('/profiles',{workspaceId:visionWorkspace,name:'原创合成视觉讲解员',avatarAssetId:asset.id,scenes:['reception']}),scene=await this.c.good<SceneApp>('/scene-apps',{workspaceId:visionWorkspace,profileId:profile.id,name:'原创单帧接待场景',scene:'reception',channelKey:'native-vision-'+randomUUID().slice(0,8),audience:'public',welcomeText:'欢迎来到原创单帧模拟接待区。',tools:['knowledge.search'],speakerProvider:'mock-focus-early',targetSpeechProvider:'mock-target-speech',visionProvider:'mock-vision',allowCamera:true,allowScreen:true});
  const venue=randomUUID();await this.c.owner(db=>db.query('INSERT INTO venues VALUES($1,$2,$3,$4,$5)',[venue,tenant,visionWorkspace,'原创视觉接待验证区','Asia/Shanghai']));return{profile,scene,venue};
 }
 async guest(scene:string,venue:string,name:string):Promise<MemoryProofGuest>{
  const terminal=await this.c.good<ReceptionTerminal>('/terminals',{venueId:venue,name}),session=await this.c.good<ReceptionSession>('/sessions',{terminalId:terminal.id,sceneAppId:scene}),accessKey=randomUUID(),access=await this.c.http('/api/v1/sessions/'+session.id+'/access',{},this.c.apiA,{...this.c.headers,'idempotency-key':accessKey});assert.equal(access.status,200);assert.ok(access.cookie);const cookie=access.cookie.split(';')[0],token=decodeURIComponent(cookie.slice(cookie.indexOf('=')+1)),g={id:session.id,cookie,csrf:'',grantId:token.split('.')[1],accessKey};this.c.secrets.push(cookie,token);await this.current(g);return g;
 }
 async grant(g:MemoryProofGuest,source:'camera'|'screen'='camera'){const s=(await this.current(g)).session;return this.good<VisualGrant>(g,'/vision/grants',{version:s.version,focusVersion:s.focusVersion,source,consent:true,noticeVersion:'vision-v1'});}
 async question(g:MemoryProofGuest,grant:VisualGrant,text='原创合成画面的受限检查'){const s=(await this.current(g)).session;return{version:s.version,focusVersion:s.focusVersion,grantId:grant.id,grantVersion:grant.version,question:text,capturedAt:new Date().toISOString(),frameBase64:syntheticPng([36,128,84]).toString('base64')};}
 async snapshot(g:MemoryProofGuest){return this.c.owner(async db=>({session:(await db.query('SELECT id,status,version,activity_at,expires_at,reply_epoch,focus_version FROM reception_sessions WHERE id=$1',[g.id])).rows[0],requests:(await db.query('SELECT * FROM visual_requests WHERE session_id=$1 ORDER BY id',[g.id])).rows,attempts:(await db.query('SELECT a.* FROM _dg_native_visual_attempts a JOIN visual_requests r ON r.id=a.request_id WHERE r.session_id=$1 ORDER BY a.attempt',[g.id])).rows,results:(await db.query('SELECT v.* FROM _dg_native_visual_results v JOIN visual_requests r ON r.id=v.request_id WHERE r.session_id=$1',[g.id])).rows,questions:(await db.query("SELECT id,input_source,reply_epoch,focus_version FROM reception_messages WHERE session_id=$1 AND role='visitor' ORDER BY native_ordinal",[g.id])).rows}));}
 async stage(g:MemoryProofGuest,body:Awaited<ReturnType<VisionProof['question']>>,key:string){
  const cfg=loadNativeRuntimeConfig(this.c.apiPath),db=await NativePostgresDatabase.open(cfg,'api',this.c.compiledRoot),service=new NativeVision(new NativeCoreRepository(db)),proof=service.reception.credentials(fs.readFileSync(path.join(this.c.nativeDir,'.session-secret'),'utf8').trim(),this.c.runtimeId,g.id,decodeURIComponent(g.cookie.slice(g.cookie.indexOf('=')+1))),frame=Buffer.from(body.frameBase64,'base64');
  try{return await db.transaction(async()=>{await service.authorize(g.id,proof,true);return service.begin(g.id,proof,key,body,{frame,width:360,height:240,imageHash:createHash('sha256').update(frame).digest('hex')});});}finally{frame.fill(0);await db.close();}
 }
 async allTables(forbiddenFrame?:string){return this.c.owner(async db=>{const names=(await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE' AND table_name NOT IN('_dg_native_runtime_control','_dg_postgres_migrations') ORDER BY table_name")).rows.map(r=>r.table_name as string),result:Record<string,{rows:number;sha256:string}>={};for(const table of names){assert.match(table,/^[a-z_][a-z0-9_]*$/);const rows=(await db.query('SELECT to_jsonb(t) value FROM '+table+' t ORDER BY to_jsonb(t)::text')).rows.map(r=>r.value);if(forbiddenFrame)assert.equal(JSON.stringify(rows).includes(forbiddenFrame),false,'Frame must not be stored in '+table);result[table]={rows:rows.length,sha256:visionHash(rows)};}return result;});}
 async end(g:MemoryProofGuest){const s=(await this.current(g)).session;if(['active','human'].includes(s.status))await this.good(g,'/control',{action:'end',version:s.version,focusVersion:s.focusVersion});}
 freeze(){for(const name of ['migration-frozen','audit-correction-frozen','expiry-correction-frozen']){const p='docs/evidence/T20/postgres-vision/'+name+'.json',f=JSON.parse(fs.readFileSync(p,'utf8'));assert.equal(proofHash('migrations/postgres/'+f.migration),f.sha256);}}
}
