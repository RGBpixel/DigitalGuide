import fs from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {nativeCluster} from '../tests/integration/postgres-native-cluster.js';
import {nativeRuntimeMigrations} from '../packages/postgres/src/runtime-database.js';
const cluster=await nativeCluster(),client=await cluster.client(),loaded=nativeRuntimeMigrations(process.cwd()),schema='dg_draft_'+randomUUID().replaceAll('-',''),root='docs/evidence/T20/postgres-speech',label=process.argv[2]??'migration-draft-first';
const before=(await client.query("SELECT nspname FROM pg_namespace WHERE nspname LIKE 'dg_%' ORDER BY nspname")).rows;
let error:unknown,at=-1,passed=false;
try{await client.query('BEGIN');await client.query('CREATE SCHEMA "'+schema+'"');await client.query('SET LOCAL search_path TO "'+schema+'",pg_catalog,pg_temp');for(let i=0;i<loaded.sql.length;i++){at=i;await client.query(loaded.sql[i]);}passed=true;}catch(e){const pg=e as {message:string;code?:string;position?:string;internalPosition?:string;internalQuery?:string;where?:string};error={message:pg.message,code:pg.code,position:pg.position,internalPosition:pg.internalPosition,internalQuery:pg.internalQuery,where:pg.where,migration:loaded.migrations[at]?.name};}finally{await client.query('ROLLBACK');const after=(await client.query("SELECT nspname FROM pg_namespace WHERE nspname LIKE 'dg_%' ORDER BY nspname")).rows;assert.deepEqual(after,before);await client.end();await cluster.stop();fs.writeFileSync(root+'/'+label+'.json',JSON.stringify({result:passed?'PASS':'FAIL',checkedAt:new Date().toISOString(),committed:false,schemasBefore:before,schemasAfter:after,error,migrations:loaded.migrations,sqlSHA256:createHash('sha256').update(fs.readFileSync('migrations/postgres/021-native-speech-authoring.sql')).digest('hex'),closedObservedPids:cluster.observedPids},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({result:passed?'PASS':'FAIL',error,rolledBack:true}));}
process.exitCode=passed?0:1;
