import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { SQLInputValue } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../apps/api/src/config.js';
import { createApp } from '../apps/api/src/app.js';
import { Repository } from '../packages/database/src/index.js';
import { fixtureIds as F } from '../packages/test-fixtures/src/seed.js';
import { createPostgresClient } from '../packages/postgres/src/config.js';
import { NativePostgresDatabase } from '../packages/postgres/src/runtime-database.js';
import { NativeCoreRepository } from '../packages/postgres/src/runtime-repository.js';
import { NativeMediaWorker } from '../packages/postgres/src/runtime-media-worker.js';
import { observeRecoveryClusters, resumeRecoveryCluster } from './native-recovery-owned.js';
import type { DeveloperStudioView } from '../packages/contracts/src/developer-studio.js';

const evidence='docs/evidence/T35/developer-studio',label=process.argv[2]??'studio-retained',audit=process.argv[3];assert.match(label,/^[a-z][a-z0-9-]+$/);
const read=(file:string)=>JSON.parse(fs.readFileSync(file,'utf8'));
assert.equal(read(evidence+'/studio-business-sqlite.json').success,false);assert.equal(read(evidence+'/studio-business-native.json').success,false);
type Query=(sql:string,...args:SQLInputValue[])=>Promise<Record<string,unknown>[]>;
const checks:{dialect:string;name:string;details:object}[]=[];
async function supplementary(app:FastifyInstance,query:Query,root:string,dialect:'sqlite'|'postgres',render?:()=>Promise<unknown>){
 const states=read(path.join(root,'studio-case-state.private.json')),caseName=Object.keys(states).find(name=>name.includes(dialect==='sqlite'?'租户、空间':'应用停用'))!;assert.ok(caseName);const state=states[caseName];assert.equal(state.result,'fail');
 const originalProjects=await query('SELECT * FROM studio_projects ORDER BY id'),originalExports=await query('SELECT * FROM studio_exports ORDER BY id');
 const rollback=states[Object.keys(states).find(name=>name.startsWith('业务失败回滚'))!];assert.ok(rollback);const rate=(await query('SELECT request_count FROM developer_rate_windows WHERE credential_id=?',rollback.credentialId))[0];assert.equal(Number(rate.request_count),2,'Failed business request and successful original-key recovery both consume quota');
 if(dialect==='sqlite'){
  const login=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{accountId:F.adminA}});assert.equal(login.statusCode,200);const cookie=login.headers['set-cookie']!.toString().split(';')[0],me=await app.inject({url:'/api/v1/me',headers:{cookie}});assert.equal(me.statusCode,200);const headers={cookie,'x-csrf-token':me.json().data.csrfToken as string};
  async function view(){const r=await app.inject({url:'/api/v1/enterprise/developer-studio?workspaceId='+F.workspaceA,headers});assert.equal(r.statusCode,200);return r.json().data as DeveloperStudioView;}
  async function post(url:string,payload:object){const r=await app.inject({method:'POST',url:'/api/v1'+url,headers:{...headers,'idempotency-key':randomUUID()},payload});assert.equal(r.statusCode,200,url);return r.json().data;}
  let v=await view(),a=v.apps.find(a=>a.id===state.appId)!;assert.ok(a.enabled);assert.ok(a.grant);assert.equal(a.grant.responsibleAuthorityCurrent,false,'Later original role-roundtrip invalidated this original fixture grant');
  await post('/enterprise/developer-studio/configure',{workspaceId:F.workspaceA,appId:a.id,expectedAppVersion:a.version,expectedVersion:a.grant.version,responsibleUserId:F.editorA,responsibleConfigurationToken:v.members.find(m=>m.id===F.editorA)!.configurationToken,actions:a.grant.actions,enabled:true,termDays:30,confirmed:true});
  v=await view();a=v.apps.find(a=>a.id===state.appId)!;const issued=await post('/enterprise/developers/issue',{workspaceId:F.workspaceA,appId:a.id,expectedVersion:a.version,termDays:30,confirmed:true}),token=issued.issuedCredential.oneTimeToken as string;
  const privateRows=await query('SELECT id,document FROM studio_projects WHERE workspace_id=? AND name=?',F.workspacePrivate,'合成其他空间'),foreignRows=await query('SELECT id FROM studio_projects WHERE workspace_id=? AND name=?',F.workspaceB,'合成其他组织');assert.equal(privateRows.length,1);assert.equal(foreignRows.length,1);
  const machineHeaders={authorization:'Bearer '+token},privateResponse=await app.inject({url:'/api/open/v1/studio/projects/'+privateRows[0].id,headers:machineHeaders}),foreignResponse=await app.inject({url:'/api/open/v1/studio/projects/'+foreignRows[0].id,headers:machineHeaders});assert.ok([403,404].includes(privateResponse.statusCode));assert.equal(foreignResponse.statusCode,404);
  const document=JSON.parse(String(privateRows[0].document));document.brand.logoAssetId=F.privateAsset;const asset=await app.inject({method:'POST',url:'/api/open/v1/studio/projects',headers:{...machineHeaders,'idempotency-key':randomUUID()},payload:{name:'越界素材',purpose:'video',document,confirmed:true}});assert.ok(asset.statusCode>=400&&asset.statusCode<500);
  const injection=await app.inject({url:'/api/open/v1/studio/context?workspaceId='+F.workspacePrivate,headers:machineHeaders});assert.equal(injection.statusCode,400);
  checks.push({dialect,name:caseName,details:{privateStatus:privateResponse.statusCode,foreignStatus:foreignResponse.statusCode,assetStatus:asset.statusCode,scopeInjectionStatus:injection.statusCode,originalProjectIds:[privateRows[0].id,foreignRows[0].id],freshGrantReviewRequiredAfterLaterOriginalRoleRoundtrip:true,originalProducersRepeated:false}});
  v=await view();a=v.apps.find(a=>a.id===state.appId)!;await post('/enterprise/developers/control',{workspaceId:F.workspaceA,appId:a.id,expectedVersion:a.version,name:a.name,scopes:a.readScopes,enabled:false,confirmed:true});
 }else{
  const grant=(await query('SELECT enabled FROM developer_studio_grants WHERE app_id=?',state.appId))[0],job=(await query('SELECT status FROM studio_exports WHERE id=?',state.exportId))[0];assert.equal(Number(grant.enabled),0);assert.equal(job.status,'cancelled');
  assert.equal(Number((await query("SELECT count(*) n FROM studio_exports WHERE status IN('queued','rendering')"))[0].n),0);assert.equal(await render!(),false);
  checks.push({dialect,name:caseName,details:{enabled:Number(grant.enabled),exportId:state.exportId,status:job.status,workerFoundNoQueuedJob:true,rendererExecuted:false,originalProducersRepeated:false}});
 }
 assert.deepEqual(await query('SELECT * FROM studio_projects ORDER BY id'),originalProjects);assert.deepEqual(await query('SELECT * FROM studio_exports ORDER BY id'),originalExports);
 checks.push({dialect,name:'failed_business_consumed_quota_and_original_projects_exports_unchanged',details:{originalProjects:originalProjects.length,originalExports:originalExports.length,failedAndRecoveredRequestCount:Number(rate.request_count),producerRepeated:false}});
}
let failure:unknown;
try{
 const sqlite=read(evidence+'/062-first-committed.json'),sqliteConfig=read(path.join(sqlite.root,'studio-fixture-config.private.json')).config as Config,repo=new Repository(sqlite.root,process.cwd(),{environment:'mock',appEnv:'development'}),app=await createApp(sqliteConfig,repo);
 try{await supplementary(app,async(sql,...args)=>{if(/^SELECT\b/i.test(sql))return repo.all<Record<string,unknown>>(sql,...args);repo.run(sql,...args);return[];},sqlite.root,'sqlite');}finally{await app.close();repo.close();}
 const native=read(evidence+'/141-first-committed.json'),owned=await resumeRecoveryCluster(native.root,audit);
 try{
  await observeRecoveryClusters(evidence+'/observed-'+label+'.json',[owned.child.pid!,Number(fs.readFileSync(path.join(owned.root,'data/postmaster.pid'),'utf8').split('\n')[0])],owned.connection.port);
  const privateConfig=read(path.join(owned.root,'studio-fixture-config.private.json')),config=privateConfig.config as Config,worker=await NativePostgresDatabase.open(privateConfig.worker,'worker'),app=await createApp(config),core=new NativeCoreRepository(worker);
  const query:Query=async(sql,...args)=>{const db=createPostgresClient(owned.connection);await db.connect();try{await db.query('SET search_path TO "'+config.nativePostgres!.schema+'",pg_catalog,pg_temp');let i=0;return(await db.query(sql.replace(/\?/g,()=>'$'+(++i)),args)).rows;}finally{await db.end();}};
  try{await supplementary(app,query,owned.root,'postgres',()=>new NativeMediaWorker(core,process.cwd()).runOne());}finally{await app.close();await worker.close();}
 }finally{await owned.stop();}
}catch(error){failure=error;}
fs.writeFileSync(evidence+'/'+label+'.json',JSON.stringify({result:failure?'FAIL':'PASS_RETAINED_STUDIO_ASSERTIONS',checkedAt:new Date().toISOString(),checks,distinctRecoveredCases:checks.filter(c=>!c.name.startsWith('failed_business')).length,additionalQuotaObservations:checks.filter(c=>c.name.startsWith('failed_business')).length,originalFailuresRetained:true,successfulProducersRepeated:false,contentModelsRead:false,mainRestarted:false,...(failure?{error:failure instanceof Error?failure.message:'unknown failure'}:{})},null,2)+'\n',{flag:'wx'});if(failure)throw failure;console.log(JSON.stringify({result:'PASS_RETAINED_STUDIO_ASSERTIONS',recoveredCases:2,additionalQuotaObservations:2}));
