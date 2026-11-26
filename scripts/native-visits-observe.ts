import fs from 'node:fs';
import assert from 'node:assert/strict';
import {NativeContentProofRuntime} from './postgres-content-proof-runtime.js';
import {loadNativeRuntimeConfig} from '../packages/postgres/src/runtime-config.js';
import {createPostgresClient} from '../packages/postgres/src/config.js';
const label=process.argv[2];assert.match(label,/^[a-z][a-z0-9-]+$/);
const c=await NativeContentProofRuntime.resume('docs/evidence/T20/postgres-visits/'+label,process.argv[3]),intent=JSON.parse(fs.readFileSync(process.argv[4],'utf8'));
let failure:unknown;
try{
 await c.prepareResume();
 const state=await c.owner(async db=>({hosts:(await db.query('SELECT id,recipient_id,version,enabled,alias FROM _dg_native_visit_hosts ORDER BY id')).rows,revisions:(await db.query('SELECT host_id,version FROM _dg_native_visit_host_revisions ORDER BY host_id,version')).rows,cached:(await db.query('SELECT request_hash,response,redacted FROM idempotency WHERE key=$1',[intent.key])).rows}));
 const observer=createPostgresClient(loadNativeRuntimeConfig(c.apiPath).connection);let observerResult:unknown;
 try{await observer.connect();observerResult=(await observer.query("SELECT pid,current_user AS observer_role,usename,wait_event_type,state,left(query,120) AS query_prefix FROM pg_stat_activity WHERE usename=current_user ORDER BY pid")).rows;}catch(error){observerResult={errorCode:error&&typeof error==='object'&&'code'in error?String(error.code):null,errorMessage:error instanceof Error?error.message:String(error)};}finally{await observer.end();}
 c.save('original-request-state.json',{result:'PASS_READ_ONLY',originalKey:intent.key,state,observerResult,noBusinessMutationAttempted:true});c.add('same_original_private_instance_read_only_request_and_observer_inspection');
}catch(error){failure=error;}finally{await c.finish(failure);}
