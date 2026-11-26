import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PNG} from 'pngjs';
import {resumeRecoveryCluster,observeRecoveryClusters} from './native-recovery-owned.js';
import {loadNativeRuntimeConfig} from '../packages/postgres/src/runtime-config.js';
import {NativePostgresDatabase} from '../packages/postgres/src/runtime-database.js';
import {createPostgresClient} from '../packages/postgres/src/config.js';
import {createApp} from '../apps/api/src/app.js';
const evidence='docs/evidence/T35/member-runtime-access',file=evidence+'/native-initialized-cluster-KcnBpm.json',initialized=JSON.parse(fs.readFileSync(file,'utf8')),root=initialized.root as string,nativeDir=path.join(root,'native-data'),native=loadNativeRuntimeConfig(path.join(nativeDir,'api.json')),state=JSON.parse(fs.readFileSync(path.join(root,'access-fixture-state.private.json'),'utf8')),checks:string[]=[],cluster=await resumeRecoveryCluster(root,evidence+'/access-before-retained-tail-process-audit.json');
let app:Awaited<ReturnType<typeof createApp>>|undefined;
async function owner<T>(work:(client:ReturnType<typeof createPostgresClient>)=>Promise<T>){const client=createPostgresClient(cluster.connection);await client.connect();try{await client.query('SET search_path TO "'+native.schema+'",pg_catalog,pg_temp');return await work(client);}finally{await client.end();}}
try{
 app=await createApp({root:process.cwd(),dataDir:nativeDir,appEnv:'development',providerMode:'mock',apiPort:4309,webOrigin:'http://127.0.0.1:5179',sessionSecret:fs.readFileSync(path.join(nativeDir,'.session-secret'),'utf8').trim(),nativePostgres:native});
 const jobs=await owner(async c=>(await c.query("SELECT id,status,attempts,outputs,result FROM character_jobs WHERE actor_id=$1 AND operation='reference' ORDER BY id",[state.p.user])).rows);assert.equal(jobs.length,1);const job=jobs[0];assert.equal(job.status,'succeeded');assert.equal(Number(job.attempts),1);assert.equal(JSON.parse(job.result).localActualFile,true);assert.equal(JSON.parse(job.result).realModelCreated,false);
 const response=await app.inject({url:'/api/v1/studio/character-jobs/'+job.id+'/file',headers:state.admin});assert.equal(response.statusCode,200);const png=PNG.sync.read(response.rawPayload),sha256=createHash('sha256').update(response.rawPayload).digest('hex'),outputs=JSON.parse(job.outputs);assert.equal(outputs.length,1);assert.equal(sha256,outputs[0].sha256);assert.ok(png.width>0&&png.height>0);checks.push('original_single_attempt_PNG_was_downloaded_and_decoded_with_exact_hash_and_private_result_without_repeating_the_job');
 const definition=await owner(async c=>(await c.query("SELECT pg_get_viewdef('_dg_native_effective_memberships'::regclass,true) definition")).rows[0].definition as string);let denied=false;
 try{await owner(c=>c.query('CREATE OR REPLACE VIEW _dg_native_effective_memberships AS SELECT * FROM memberships'));try{const unexpected=await NativePostgresDatabase.open(native,'api');await unexpected.close();}catch(error){assert.equal((error as {code:string}).code,'PG_RUNTIME_CATALOG_CHANGED');denied=true;}assert.equal(denied,true);}finally{await owner(c=>c.query('CREATE OR REPLACE VIEW _dg_native_effective_memberships AS '+definition));}
 const restored=await NativePostgresDatabase.open(native,'api');await restored.close();assert.equal((await app.inject({url:'/api/v1/me',headers:state.admin})).statusCode,200);checks.push('a_new_native_connection_rejects_same_columns_with_changed_view_conditions_and_accepts_the_exact_restored_definition');
 fs.writeFileSync(evidence+'/native-retained-supplement.json',JSON.stringify({result:'PASS_RETAINED_MEMBER_BUSINESS_ACCESS_SUPPLEMENT',checkedAt:new Date().toISOString(),root,checks,checksPassed:checks.length,originalBusinessCasesRepeated:false,originalActualPngJobId:job.id,actualPngSha256:sha256,width:png.width,height:png.height,existingAttemptCount:1,existingAdminCookieUsed:true,freshLoginIssued:false,catalogCheckedAtConnectionOpen:true,continuousPerRequestCatalogCheckClaimed:false,originalSixSuccessfulNativeCasesNotRepeated:true,originalTwoNativeFailuresPreserved:true,mainRestarted:false},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({result:'PASS_RETAINED_MEMBER_BUSINESS_ACCESS_SUPPLEMENT',checks:checks.length}));
}finally{await app?.close();try{await observeRecoveryClusters(evidence+'/observed-access-retained-'+path.basename(root)+'-'+process.pid+'.json',[process.pid,cluster.child.pid!],cluster.connection.port);}finally{await cluster.stop();}}

