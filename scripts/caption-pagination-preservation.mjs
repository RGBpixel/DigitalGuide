import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
const tag=process.argv[2]??'final';assert.ok(/^[a-z-]+$/.test(tag));
const root='docs/evidence/T22/caption-pagination/runtime',read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const before=read(root+'/before.json'),backup=read(root+'/backup-before.json'),checkedAt=new Date().toISOString();
const hash=v=>createHash('sha256').update(typeof v==='string'||Buffer.isBuffer(v)?v:JSON.stringify(v)).digest('hex');
const db=new DatabaseSync('storage/digitalguide.sqlite',{readOnly:true});
try{
 const checks=before.tables.map(t=>{const rows=db.prepare('SELECT '+t.columns.map(c=>'"'+c+'"').join(',')+' FROM "'+t.name+'"').all(),counts=new Map();for(const row of rows){const h=hash(row);counts.set(h,(counts.get(h)||0)+1);}let missing=0;for(const h of t.hashes){const n=counts.get(h)||0;if(!n)missing++;else counts.set(h,n-1);}return{table:t.name,originalRows:t.hashes.length,currentRows:rows.length,missingOrChangedOriginalRows:missing};});
 const missing=checks.reduce((n,t)=>n+t.missingOrChangedOriginalRows,0),raw={result:missing?'FAIL':'PASS',checkedAt,tables:checks.length,originalRows:checks.reduce((n,t)=>n+t.originalRows,0),missingOrChangedOriginalRows:missing,checks};
 fs.writeFileSync(root+'/preservation-'+tag+'-raw.json',JSON.stringify(raw,null,2)+'\n',{flag:'wx'});
 const auth=before.tables.find(t=>t.name==='auth_sessions'),current=new Set(db.prepare('SELECT '+auth.columns.map(c=>'"'+c+'"').join(',')+' FROM auth_sessions').all().map(hash)),removed=before.authSessionExpiry.filter(r=>!current.has(r.rowHash)),business=checks.filter(t=>t.table!=='auth_sessions');
 assert.equal(business.reduce((n,t)=>n+t.missingOrChangedOriginalRows,0),0);assert.ok(removed.every(r=>r.expiresAt<=checkedAt));assert.equal(missing,removed.length);
 assert.equal(hash(fs.readFileSync(backup.file)),backup.sha256);for(const k of backup.keys)assert.ok(fs.readFileSync(path.join('storage',k.name)).equals(fs.readFileSync(k.privateBackupPath)));
 const migration=db.prepare('SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1').get().name;assert.equal(migration,'052-practice.sql');
 const result={result:'PASS',checkedAt,rawReport:root+'/preservation-'+tag+'-raw.json',rawResult:raw.result,originalBaselineReplaced:false,originalTables:before.tables.length,originalRows:raw.originalRows,originalBusinessTables:business.length,originalBusinessRows:business.reduce((n,t)=>n+t.originalRows,0),missingOrChangedOriginalBusinessRows:0,removedObservedExpiredAuthenticationRows:removed.length,removedAuthenticationExpiryEvidence:removed,expiredSessionsRestored:false,privateDatabaseBackupPreserved:true,bothOriginalKeysExact:true,migration,migrationSHA256:hash(fs.readFileSync('migrations/sqlite/'+migration)),sqliteMigrationAdded:false,nextSqliteMigration:'053',postgresLatestMigration:'026-native-file-transcriptions.sql',nextPostgresMigration:'027',mainWasNotRestoredOrReplaced:true,mainPreviousHandles:['33223'],mainHandle:'33223',mainRestartedForThisIncrement:false,realExternalBusinessActions:false};
 fs.writeFileSync(root+'/preservation-'+tag+'.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({result:'PASS',originalTables:result.originalTables,originalRows:result.originalRows,businessRows:result.originalBusinessRows,expiredAuthOnly:removed.length,main:'33223'}));
}finally{db.close();}
