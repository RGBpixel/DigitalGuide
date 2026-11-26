import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {createPostgresClient,loadConnectionConfig} from '../packages/postgres/src/config.js';
import {defaultLimits,removeOwnedTree,within} from '../packages/recovery/src/files.js';
import {readRecoveryKey,decryptArchive,inspectArchiveZip} from '../packages/recovery/src/codec.js';
import {validateNativeRecoveryManifest} from '../packages/postgres/src/recovery-manifest.js';
import {nativeRecoverySnapshot} from '../packages/postgres/src/recovery-snapshot.js';
import {proofBounded,proofPause} from './postgres-content-proof-runtime.js';

const base='docs/evidence/T20/postgres-recovery',detail=process.argv[2]==='constraints',auditLabel=process.argv[3]||'recovery-pre-diagnostic';assert.match(auditLabel,/^[a-z][a-z0-9-]+$/);
const read=(f:string)=>JSON.parse(fs.readFileSync(f,'utf8')),hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex'),checkpoint=read(base+'/progress-checkpoint.json'),audit=read(base+'/'+auditLabel+'-process-audit.json');
assert.equal(checkpoint.phaseStillOpen,true);assert.equal(fs.existsSync(base+'/verification.json'),false);assert.equal(audit.result,'PASS_STRICT_NATIVE_RECOVERY_PROCESS_CLOSURE');assert.equal(audit.privateProcesses,0);assert.equal(audit.privateListeners,0);assert.ok(Date.now()-Date.parse(audit.checkedAt)<120000,'Fresh independent closure audit required');
const roots=checkpoint.failedUnsealedRoots as string[],owned=path.resolve('storage/postgres-native-tests'),bin=path.resolve('storage/tools/postgresql/18.7-2/pgsql/bin');assert.equal(roots.length,2);for(const root of roots){assert.ok(within(root,owned));assert.match(path.basename(root),/^cluster-[a-zA-Z0-9]+$/);assert.equal(fs.existsSync(path.join(root,'data/postmaster.pid')),false,'Retain and inspect any unexpected stale marker');}
async function launch(root:string){
 const id=randomUUID(),input=path.join(root,'recovery-diagnostic-job-'+id+'.json'),marker=path.join(root,'recovery-diagnostic-native-'+id+'.json');fs.writeFileSync(input,JSON.stringify({executable:path.join(bin,'postgres.exe'),arguments:['-D',path.join(root,'data')],directory:root,marker,cancelFile:path.join(root,'recovery-diagnostic-cancel-'+id)}),{flag:'wx'});
 const child=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.resolve('scripts/native-process-job.ps1'),'-ParentProcessId',String(process.pid),'-InputPath',input],{windowsHide:true,stdio:['ignore','ignore','ignore']}),closed=new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);}),connection=loadConnectionConfig(path.join(root,'connection.json'));
 async function stop(){if(child.exitCode===null){const ctl=spawn(path.join(bin,'pg_ctl.exe'),['-D',path.join(root,'data'),'stop','-m','fast','-w','-t','30'],{windowsHide:true,stdio:'ignore'});assert.equal(await proofBounded(new Promise<number|null>((resolve,reject)=>{ctl.once('error',reject);ctl.once('close',resolve);}),40000,'Diagnostic PostgreSQL stop timeout'),0);}await proofBounded(closed,15000,'Diagnostic supervisor did not close');}
 try{const until=Date.now()+45000;for(;;){assert.equal(child.exitCode,null,'Owned diagnostic supervisor exited');const c=createPostgresClient(connection);try{await c.connect();await c.end();break;}catch{await c.end();if(Date.now()>until)throw new Error('Diagnostic PostgreSQL not ready');await proofPause(100);}}assert.equal(read(marker).jobObject,true);return{root,connection,child,stop,marker};}catch(error){await stop();throw error;}
}
const launched:Awaited<ReturnType<typeof launch>>[]=[],temp=fs.mkdtempSync(path.join(roots[0],'recovery-diagnostic-')),key=readRecoveryKey(path.join(roots[0],'backup-key'));
try{
 const zip=path.join(temp,'archive.zip');await decryptArchive(checkpoint.originalArchive.file,zip,key,defaultLimits);const m=await inspectArchiveZip(zip,path.join(temp,'unused'),defaultLimits,false,validateNativeRecoveryManifest);
 for(const root of roots)launched.push(await launch(root));
 const clients=launched.map(s=>createPostgresClient(s.connection));
 try{
  for(const c of clients){await c.connect();await c.query('BEGIN READ ONLY');}
  for(const c of clients)await c.query('SET LOCAL search_path TO "'+m.database.schema+'",pg_catalog,pg_temp');
  const snapshots=detail?undefined:await Promise.all(clients.map(c=>nativeRecoverySnapshot(c,m.database.schema,m.database,defaultLimits)));
  const sql=fs.readFileSync('packages/postgres/src/catalog.ts','utf8'),queries=[...sql.matchAll(/^\s+"(.+)"[,]?$/gm)].map(m=>JSON.parse('"'+m[1]+'"') as string);assert.equal(queries.length,9);
  queries.push("SELECT p.proname,p.proacl::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 ORDER BY p.proname");queries.push("SELECT c.relname,a.attname,coalesce(a.attacl::text,'{}') AS acl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped WHERE n.nspname=$1 AND c.relkind='r' ORDER BY c.relname,a.attnum");
  const names=['columns','constraints','indexes','triggers','functions','relations','sequences','policies','namespaceACL','functionACL','columnACL'],groups=[];
  for(let i=0;i<queries.length;i++){
   if(detail&&i!==1)continue;
   const data=await Promise.all(clients.map(async c=>(await c.query(queries[i],[m.database.schema])).rows));if(hash(data[0])===hash(data[1]))continue;
   const rowKey=(r:Record<string,unknown>)=>JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k])=>['table_name','column_name','relname','conname','index_name','tgname','proname','attname','polname','sequencename'].includes(k)))),maps=data.map(rows=>new Map(rows.map(r=>[rowKey(r),r]))),fields=[];
   for(const[k,a]of maps[0]){const b=maps[1].get(k);if(!b){fields.push({identity:JSON.parse(k),missingInTarget:true});continue;}for(const field of Object.keys(a))if(hash(a[field])!==hash(b[field]))fields.push({identity:JSON.parse(k),field,sourceSHA256:hash(a[field]),targetSHA256:hash(b[field]),...(['relacl','nspacl','proacl','acl','attnum','polroles','reloptions'].includes(field)||detail&&field==='definition'?{source:a[field],target:b[field]}:{})});}
   groups.push({group:names[i],sourceRows:data[0].length,targetRows:data[1].length,sourceSHA256:hash(data[0]),targetSHA256:hash(data[1]),onlyRowOrderingDiffers:hash(data[0].map(r=>JSON.stringify(r)).sort())===hash(data[1].map(r=>JSON.stringify(r)).sort()),fieldDifferences:fields});
  }
  const access=(await clients[1].query("SELECT status,has_database_privilege($1,current_database(),'CONNECT') api_connect,has_database_privilege($2,current_database(),'CONNECT') worker_connect FROM public._dg_native_recovery_control WHERE id=1",[m.database.apiRole,m.database.workerRole])).rows[0],differingTables=snapshots?.[1].tables.filter(t=>hash(t)!==hash(m.database.tables.find(v=>v.name===t.name))).map(t=>t.name);
  const result={result:'PASS_DIAGNOSED_RETAINED_UNSEALED_RECOVERY',checkedAt:new Date().toISOString(),sourceRoot:roots[0],targetRoot:roots[1],schema:m.database.schema,archiveSHA256:checkpoint.originalArchive.sha256,snapshotChecksExecuted:!detail,sourceSnapshotMatchesArchive:snapshots?hash(snapshots[0])===hash(m.database):null,targetSnapshotMatchesArchive:snapshots?hash(snapshots[1])===hash(m.database):null,targetTableRowsMatch:differingTables?differingTables.length===0:null,differingTables,targetSequencesMatch:snapshots?hash(snapshots[1].sequences)===hash(m.database.sequences):null,targetCatalogMatches:snapshots?snapshots[1].catalogSHA256===m.database.catalogSHA256:null,groups,targetRecoveryControl:access,originalDirectoryRemainsAbsent:!fs.existsSync(m.dataRoot),readOnlyTransactions:true,oldBusinessActionsRepeated:false,mainRestarted:false};
  fs.writeFileSync(base+'/'+(detail?'constraint-details':'catalog-diagnosis')+'.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({result:result.result,snapshotChecksExecuted:!detail,sourceSnapshotMatchesArchive:result.sourceSnapshotMatchesArchive,targetTableRowsMatch:result.targetTableRowsMatch,differingTables,changedGroups:groups.map(g=>({group:g.group,orderOnly:g.onlyRowOrderingDiffers,fields:g.fieldDifferences.length})),targetRecoveryControl:access}));
  for(const c of clients)await c.query('COMMIT');
 }finally{for(const c of clients)await c.end();}
}finally{key.fill(0);for(const s of launched.reverse())await s.stop();removeOwnedTree(temp,roots[0],'recovery-diagnostic-');}
