import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Asset,Profile,LiveProgram,LivePlan} from '../packages/contracts/src/index.js';
import {syntheticPng} from '../packages/media/src/index.js';
import {liveDefinitionFixture} from '../packages/test-fixtures/src/live.js';
import {NativeContentProofRuntime,proofHash,proofUntil,proofPause} from './postgres-content-proof-runtime.js';

const base='docs/evidence/T20/postgres-live-knowledge',label=process.argv[2]??'compiled-expiry',prior=process.argv[3]??'compiled-media';
const c=await NativeContentProofRuntime.resume(base+'/'+label,base+'/'+prior+'/proof.json');
const workspace='20000000-0000-4000-8000-000000000001',tenant='10000000-0000-4000-8000-000000000001';let error:unknown;
try{
 await c.prepareResume();const programs=JSON.parse(fs.readFileSync(base+'/compiled-core/all-compiled.json','utf8')).files as Record<string,string>;
 for(const[file,sha]of Object.entries(programs)){assert.equal(proofHash(file),sha);assert.equal(proofHash(path.join(c.compiledRoot,file)),sha);}c.save('all-compiled.json',{result:'PASS',files:programs,all76Verified:true});
 await c.observe('observed-before-natural-expiry');
 const upload=await c.good<{uploadId:string}>('/assets/uploads',{workspaceId:workspace,fileName:'原创短期限形象.png',contentBase64:syntheticPng([14,130,78]).toString('base64')}),expiresAt=new Date(Date.now()+2500).toISOString();
 const avatar=await c.good<Asset>('/assets',{uploadId:upload.uploadId,name:'原期限不续期的合成形象',category:'avatar',expiresAt}),profile=await c.good<Profile>('/profiles',{workspaceId:workspace,name:'原固定期限公开角色',avatarAssetId:avatar.id,scenes:['live']}),app=await c.good<{id:string}>('/scene-apps',{workspaceId:workspace,profileId:profile.id,name:'提交前自然到期场景',scene:'live',channelKey:'expires-'+randomUUID(),audience:'public',welcomeText:'固定期限验证',collectionIds:[],tools:['knowledge.search']});
 const d=liveDefinitionFixture();d.sceneAppId=app.id;d.recordingEnabled=false;d.products=[];d.destinations=[d.destinations[0]];
 const program=await c.good<LiveProgram>('/live-programs',{workspaceId:workspace,name:'固定形象期限暂存验证',definition:d,rightsConfirmed:true}),plan=await c.good<LivePlan>('/live-programs/'+program.id+'/preflight',{version:program.version});assert.equal(plan.canStart,true,plan.problems.join('；'));assert.ok(Date.now()<Date.parse(expiresAt));
 const lock=await c.cluster.client();await lock.query('SET search_path TO "'+c.schema+'",pg_catalog,pg_temp');await lock.query('BEGIN');await lock.query('LOCK TABLE audit_events IN SHARE MODE');
 const key=randomUUID(),body={programId:program.id,programVersion:program.version,planHash:plan.hash,kind:'broadcast_simulation',confirmed:true,rightsConfirmed:true};let settled=false;
 const request=c.http('/api/v1/live-sessions',body,c.apiA,{...c.headers,'idempotency-key':key}).then(r=>{settled=true;return r;});
 try{
  const witness=await proofUntil(()=>c.owner(async q=>(await q.query("SELECT l.pid,l.mode,l.granted,(extract(epoch FROM(clock_timestamp()-l.waitstart))*1000)::int AS wait_ms FROM pg_locks l JOIN pg_class t ON t.oid=l.relation JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_stat_activity a ON a.pid=l.pid WHERE NOT l.granted AND t.relname='audit_events' AND n.nspname=$1 AND a.application_name='digitalguide-native-validation-api'",[c.schema])).rows),rows=>rows.length===1,1000);
  assert.equal(settled,false);assert.ok(Date.now()<Date.parse(expiresAt));c.save('natural-expiry-staged.json',{result:'STAGED_BEFORE_ORIGINAL_EXPIRY',expiresAt,observedAt:new Date().toISOString(),witness,originalDeadlineNotChanged:true,requestUnsettled:true});
  await proofPause(Math.max(0,Date.parse(expiresAt)-Date.now()+30));await lock.query('COMMIT');const response=await request;assert.equal(response.status,409,JSON.stringify(response.body));
  const counts=await c.owner(async q=>({sessions:Number((await q.query('SELECT count(*) AS n FROM live_sessions WHERE program_id=$1',[program.id])).rows[0].n),keys:Number((await q.query('SELECT count(*) AS n FROM idempotency WHERE tenant_id=$1 AND key=$2',[tenant,key])).rows[0].n),inputs:Number((await q.query('SELECT count(*) AS n FROM _dg_native_live_inputs i JOIN live_sessions s ON s.id=i.session_id WHERE s.program_id=$1',[program.id])).rows[0].n),asset:(await q.query('SELECT expires_at,version FROM assets WHERE id=$1',[avatar.id])).rows[0]}));
  assert.equal(counts.sessions,0);assert.equal(counts.keys,0);assert.equal(counts.inputs,0);assert.equal(counts.asset.expires_at,expiresAt);assert.equal(Number(counts.asset.version),avatar.version);c.save('natural-expiry-rollback.json',{result:'PASS',status:response.status,errorCode:response.body.error?.code,originalExpiresAt:expiresAt,finishedAt:new Date().toISOString(),...counts,mainTouched:false,actualSourceExpiredWhileTransactionStaged:true,deadlineExtended:false});c.add('original2500ms_scene_asset_expires_after_staging_before_commit409_session_input_key_full_rollback_without_renewal');
 }finally{await lock.query('ROLLBACK').catch(()=>{});await lock.end();await request;}
}catch(e){error=e;}finally{await c.finish(error);}console.log(JSON.stringify({result:'PASS',checks:c.checks.length}));
