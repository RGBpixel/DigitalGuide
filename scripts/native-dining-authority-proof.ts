import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPostgresClient} from '../packages/postgres/src/config.js';
import {loadNativeRuntimeConfig} from '../packages/postgres/src/runtime-config.js';
import {NativeContentProofRuntime,proofHash,proofUntil,proofPause} from './postgres-content-proof-runtime.js';

const label=process.argv[2];assert.match(label,/^[a-z][a-z0-9-]+$/);
const previous='docs/evidence/T20/postgres-dining/ui-same-instance-continued',resumeFrom=process.argv[3]??previous,proof=JSON.parse(fs.readFileSync(resumeFrom+'/proof.json','utf8'));
assert.equal(proof.allDirectChildrenClosed,true);
const originalProof=JSON.parse(fs.readFileSync(previous+'/proof.json','utf8'));assert.equal(originalProof.checks.filter((c:{result:string})=>c.result==='PASS').length,3);assert.equal(proof.root,originalProof.root);
const state=JSON.parse(fs.readFileSync(path.join(proof.root,'ui-same-instance-continued-state.private.json'),'utf8'));
assert.equal(state.originalExpiryProducerCompleted,true);assert.equal(state.restartCompleted,true);
const c=await NativeContentProofRuntime.resume('docs/evidence/T20/postgres-dining/'+label,resumeFrom+'/proof.json');
const originalEnv=c.env.bind(c);c.env=(configFile,port)=>({...originalEnv(configFile,port),NATIVE_DINING_UI_PREVIEW:'1'});
let failure:unknown;
try{
 await c.prepareResume();
 const expired=JSON.parse(fs.readFileSync(previous+'/original-worker-expiry.json','utf8'));
 const original=await c.owner(async db=>(await db.query('SELECT state,created_at,expires_at,expected_end_at FROM dining_occupancies WHERE id=$1',[expired.occupancyId])).rows[0]);assert.deepEqual(original,expired.after);
 const staff='30000000-0000-4000-8000-000000000002',previousRestaurant=state.expiryStore.id;
 const originalGrants=await c.owner(async db=>(await db.query('SELECT user_id,version,expires_at FROM restaurant_staff WHERE restaurant_id=$1 ORDER BY user_id',[previousRestaurant])).rows);for(const grant of originalGrants)assert.ok(Date.parse(grant.expires_at)<Date.now());
 // A different explicitly authorized synthetic person gets a new fixed grant.
 // The failed observation's original person, expiry and worker run are retained.
 const venue=randomUUID();await c.owner(db=>db.query('INSERT INTO venues VALUES($1,$2,$3,$4,$5)',[venue,'10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','原创默认锁超时内授权验证场所','Asia/Shanghai']));
 const restaurant=(await c.good<{id:string}>('/restaurant/restaurants',{venueId:venue,name:'原创默认锁超时内授权验证餐厅'})).id;
 const connection=loadNativeRuntimeConfig(c.apiPath).connection,lock=await c.cluster.client(),api=createPostgresClient(connection),observer=createPostgresClient(connection);
 await api.connect();await observer.connect();let pending:Promise<{error?:string;value?:unknown}>|undefined;
 try{
  await lock.query('SET search_path TO "'+c.schema+'",pg_catalog,pg_temp');await api.query('SET search_path TO "'+c.schema+'",pg_catalog,pg_temp');
  const configuredTimeout=(await api.query("SELECT current_setting('lock_timeout') value")).rows[0].value;assert.equal(configuredTimeout,'3s');
  const expiresAt=new Date(Date.now()+1800).toISOString();await c.good('/restaurant/restaurants/'+restaurant+'/staff',{userId:staff,role:'host',enabled:true,expiresAt,version:0});
  await lock.query('BEGIN');await lock.query('SELECT id FROM restaurants WHERE id=$1 FOR UPDATE',[restaurant]);const blocker=Number((await lock.query('SELECT pg_backend_pid() value')).rows[0].value);
  await api.query('BEGIN');await api.query("SELECT set_config('digitalguide.actor_id',$1,true)",[staff]);const pid=Number((await api.query('SELECT pg_backend_pid() value')).rows[0].value);
  pending=api.query("SELECT dg_native_dining_context('restaurant',$1)",[restaurant]).then(value=>({value:value.rows[0]}),error=>({error:error instanceof Error?error.message:String(error)}));
  const witness=await proofUntil<{pid:number;query_start:string;observed_at:string;blockers:number[]}|undefined>(async()=>(await observer.query("SELECT pid,query_start::text query_start,clock_timestamp()::text observed_at,pg_blocking_pids(pid) blockers FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock' AND query LIKE 'SELECT dg_native_dining_context%'",[pid])).rows[0],row=>!!row,3000);assert.ok(witness);assert.ok(witness.blockers.includes(blocker));assert.ok(Date.parse(witness.query_start)<Date.parse(expiresAt));assert.ok(Date.parse(witness.observed_at)<Date.parse(expiresAt));
  c.save('observed-original-lock.json',{result:'PASS',pid,blocker,originalGrantExpiry:expiresAt,witness,observerRole:'same_api_role_as_waiter',newSyntheticStaff:staff,newRestaurant:restaurant,configuredLockTimeout:configuredTimeout,configuredLockTimeoutChanged:false,newGrantLifetimeMs:1800});
  while(Date.now()<=Date.parse(expiresAt))await proofPause(Math.min(100,Date.parse(expiresAt)-Date.now()+1));await lock.query('COMMIT');const outcome=await pending;
  c.save('original-outcome.json',{resumedAt:new Date().toISOString(),originalGrantExpiry:expiresAt,outcome,rawPersonalDataLogged:false});assert.equal(outcome.error,'DGDINING:NOT_FOUND');
  const unchanged=await c.owner(async db=>(await db.query('SELECT user_id,version,expires_at FROM restaurant_staff WHERE restaurant_id=$1 ORDER BY user_id',[previousRestaurant])).rows);assert.deepEqual(unchanged,originalGrants);
  for(const key of c.keys)assert.equal(proofHash(path.join(c.nativeDir,key.name)),key.sha256);
  c.add('same_api_role_observer_proves_original_grant_expires_while_single_native_sql_statement_is_blocked_and_is_rejected_after_release',{originalWorkerProducerRepeated:false,originalFailedGrantReissued:false,firstRawFailureRetained:true,retainedRoot:c.cluster.root,newGrantWasExplicit:true});
 }finally{await lock.query('ROLLBACK').catch(()=>{});await api.query('ROLLBACK').catch(()=>{});await pending?.catch(()=>{});await lock.end();await api.end();await observer.end();}
 c.save('authority-verification.json',{result:'PASS',originalWorkerEvidence:previous+'/original-worker-expiry.json',originalGuiEvidence:previous+'/gui.json',retainedRawProof:previous+'/proof.json',originalWorkerOrRestartReexecuted:false,originalFailedGrantUnchanged:true,actualSingleStatementLockAndExpiryVerified:true,operationId:randomUUID()});
}catch(error){failure=error;c.save('failure-checkpoint.json',{error:error instanceof Error?error.stack:String(error),root:c.cluster.root,originalProducersMustNotBeRepeated:true});}
finally{await c.finish(failure);}
