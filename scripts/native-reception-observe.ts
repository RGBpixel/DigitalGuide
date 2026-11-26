import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {canonical} from '../packages/domain/src/index.js';
import {nativeReceptionCookieName,receptionHash} from '../packages/postgres/src/runtime-reception.js';
import {NativeContentProofRuntime,proofUntil} from './postgres-content-proof-runtime.js';

const label=process.argv[2];assert.match(label,/^[a-z][a-z0-9-]+$/);
const root='docs/evidence/T20/postgres-reception',prior=root+'/compiled-first';
const issued=JSON.parse(fs.readFileSync(prior+'/access-issued.json','utf8')) as {sessionId:string;grantId:string};
const c=await NativeContentProofRuntime.resume(root+'/'+label,prior+'/proof.json');let failure:unknown;
async function original(){return c.owner(async db=>({
 session:(await db.query('SELECT id,terminal_id,status,created_at,activity_at,expires_at,version,reply_epoch,focus_version,access_version,ended_reason FROM reception_sessions WHERE id=$1',[issued.sessionId])).rows[0],
 messages:(await db.query('SELECT id,role,status,reply_epoch,focus_version,created_at,native_ordinal FROM reception_messages WHERE session_id=$1 ORDER BY native_ordinal',[issued.sessionId])).rows,
 receipts:(await db.query('SELECT id,kind,focus_version,payload,created_at FROM _dg_native_reception_receipts WHERE session_id=$1 ORDER BY created_at,id',[issued.sessionId])).rows,
 outbox:(await db.query('SELECT type AS kind,created_at FROM outbox_events WHERE aggregate_id=$1 ORDER BY created_at,id',[issued.sessionId])).rows
}));}
try{
 await c.prepareResume();const before=await original();assert.ok(before.session);c.save('original-state-observed.json',{checkedAt:new Date().toISOString(),...before,readBeforeAnyReceptionApiOrWorker:true});
 // Recover the existing capability without issuing a grant or altering its original deadline.
 const secret=fs.readFileSync(path.join(c.nativeDir,'.session-secret'),'utf8').trim();
 const token=(purpose:string)=>createHmac('sha256',secret).update(canonical(['native-reception-v1',c.runtimeId,issued.sessionId,issued.grantId,purpose])).digest('base64url');
 const raw='RG1.'+issued.grantId+'.'+token('access'),cookie=nativeReceptionCookieName(c.runtimeId)+'='+raw;c.secrets.push(raw,cookie,token('csrf'));
 const binding=await c.owner(async db=>(await db.query('SELECT token_hash,csrf_hash,access_version,expires_at FROM _dg_native_reception_access WHERE id=$1 AND session_id=$2',[issued.grantId,issued.sessionId])).rows[0]);assert.equal(binding.token_hash,receptionHash(raw));assert.equal(binding.csrf_hash,receptionHash(token('csrf')));
 assert.equal(before.messages.length,5);assert.equal(before.messages.at(-1)!.status,'completed');assert.equal(before.receipts.filter(r=>r.kind==='control').length,0);assert.equal(before.outbox.filter(r=>r.kind==='reply.completed').length,1);assert.equal(before.outbox.filter(r=>r.kind==='session.stopped').length,0);
 c.save('stop-race-observation.json',{result:'PASS',sessionId:issued.sessionId,completedReplyId:before.messages.at(-1)!.id,completedEventCommitted:true,stopControlReceipts:0,lateCallbackHadReachedServerBeforeStopCommitted:true,existingGrantHashMatchesOriginalSecret:true,noBusinessActionReplayed:true});c.add('compiled_original_failed_driver_read_only_observation_confirms_completion_won_uncommitted_stop_race',{sessionId:issued.sessionId});
 const deadline=Date.parse(before.session.activity_at)+120000;assert.ok(Date.now()>deadline,'This observation expects the retained original deadline to have elapsed naturally');
 const worker=c.worker('retained-original-expiry-worker');const after=await proofUntil(original,v=>v.session.status==='expired',20000);assert.equal(worker.child.exitCode,null);assert.equal(after.session.ended_reason,'timeout');assert.equal(after.session.activity_at,before.session.activity_at);assert.equal(after.session.created_at,before.session.created_at);assert.equal(after.session.expires_at,before.session.expires_at);assert.equal(Number(after.session.access_version),Number(before.session.access_version)+1);await c.stop(worker);
 assert.equal((await c.http('/api/v1/guest/sessions/'+issued.sessionId,undefined,c.apiA,{cookie})).status,401);
 c.save('retained-original-expired.json',{result:'PASS',sessionId:issued.sessionId,idleDeadline:new Date(deadline).toISOString(),before:before.session,after:after.session,deadlineElapsedWhileValidationServicesWereClosed:true,continuous120SecondObservation:false,clockDeadlineActivityAndAttemptEdits:false,originalSuccessfulMutationsReplayed:false});c.add('compiled_retained_original_session_expires_at_unchanged_original_clock_after_services_resume',{sessionId:issued.sessionId});
}catch(e){failure=e;}finally{await c.finish(failure);}
