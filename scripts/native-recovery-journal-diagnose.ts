import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {resumeRecoveryCluster,observeRecoveryClusters,type OwnedRecoveryServer} from './native-recovery-owned.js';
import {readRecoveryKey,decryptArchive,inspectArchiveZip} from '../packages/recovery/src/codec.js';
import {defaultLimits,removeOwnedTree} from '../packages/recovery/src/files.js';
import {validateNativeRecoveryManifest} from '../packages/postgres/src/recovery-manifest.js';
import {nativeRecoverySnapshot} from '../packages/postgres/src/recovery-snapshot.js';
import {createPostgresClient} from '../packages/postgres/src/config.js';
import {nativeRecoverySnapshotsEqual,recoveryCheckDefinition} from '../packages/postgres/src/recovery-catalog.js';
const base='docs/evidence/T20/postgres-recovery-journal',audit=base+'/journal-before-diagnosis-process-audit.json',source=path.resolve('storage/postgres-native-tests/cluster-qfUots'),target=path.resolve('storage/postgres-native-tests/cluster-Y5GnRL'),servers:OwnedRecoveryServer[]=[],work=fs.mkdtempSync(path.join(source,'journal-diagnosis-')),key=readRecoveryKey(path.join(source,'journal-backup-key'));
try{
 const zip=path.join(work,'archive.zip');await decryptArchive(path.join(source,'baseline.dgr'),zip,key,defaultLimits);const manifest=await inspectArchiveZip(zip,path.join(work,'unused'),defaultLimits,false,validateNativeRecoveryManifest);
 for(const root of [source,target])servers.push(await resumeRecoveryCluster(root,audit));await observeRecoveryClusters(base+'/observed-journal-diagnosis.json',servers.map(s=>s.child.pid!),servers[0].connection.port);
 const clients=servers.map(s=>createPostgresClient(s.connection));try{for(const c of clients){await c.connect();await c.query('BEGIN READ ONLY');await c.query('SET search_path TO "'+manifest.database.schema+'",pg_catalog,pg_temp');}
 const actual=await nativeRecoverySnapshot(clients[1],manifest.database.schema,manifest.database,defaultLimits),keys=Object.keys(manifest.database) as (keyof typeof actual)[],differences=keys.filter(k=>!isDeepStrictEqual(actual[k],manifest.database[k])).map(k=>({field:k,expected:manifest.database[k],actual:actual[k]}));
 const catalog=fs.readFileSync('packages/postgres/src/catalog.ts','utf8'),queries=[...catalog.matchAll(/^\s+"(.+)"[,]?$/gm)].map(m=>JSON.parse('"'+m[1]+'"') as string),groups=[];
 for(let n=0;n<queries.length;n++){const rows=await Promise.all(clients.map(async c=>(await c.query(queries[n],[manifest.database.schema])).rows));if(n===1)for(const list of rows)for(const r of list)if(r.contype==='c')r.definition=recoveryCheckDefinition(r.definition);if(!isDeepStrictEqual(rows[0],rows[1])){const diffs=[];for(let i=0;i<Math.max(...rows.map(r=>r.length));i++)if(!isDeepStrictEqual(rows[0][i],rows[1][i]))diffs.push({index:i,source:rows[0][i],target:rows[1][i]});groups.push({query:n,differences:diffs});}}
 const value={result:'PASS_RETAINED_JOURNAL_RESTORE_DIAGNOSIS',checkedAt:new Date().toISOString(),source,target,sourceAlreadyChangedAfterBackup:true,targetSnapshotMatches:nativeRecoverySnapshotsEqual(actual,manifest.database),differences,groups};fs.writeFileSync(base+'/restore-diagnosis.json',JSON.stringify(value,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({result:value.result,targetSnapshotMatches:value.targetSnapshotMatches,differingFields:differences.map(d=>d.field),groups:groups.map(g=>({query:g.query,rows:g.differences.length}))}));for(const c of clients)await c.query('COMMIT');
 }finally{for(const c of clients)await c.end();}assert.equal(fs.existsSync(manifest.dataRoot),false);
}finally{key.fill(0);for(const s of servers.reverse())await s.stop();removeOwnedTree(work,source,'journal-diagnosis-');}
