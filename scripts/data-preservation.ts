import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
interface TableSnapshot {name:string;columns:string[];hashes:string[]}
interface Snapshot {database:string;capturedAt:string;tables:TableSnapshot[]}
const mode=process.argv[2],file=path.resolve(process.argv[3]||'docs/evidence/T13/runtime/before.json'),database=path.resolve(process.argv[4]||'storage/digitalguide.sqlite');
const quote=(name:string)=>{if(!/^[a-zA-Z0-9_]+$/.test(name))throw new Error('Unexpected database identifier.');return '"'+name+'"';};
const hash=(row:unknown)=>createHash('sha256').update(JSON.stringify(row)).digest('hex');
if(mode!=='snapshot'&&mode!=='check')throw new Error('Usage: data-preservation.ts snapshot|check snapshot.json [database.sqlite] [report.json]');
const db=new DatabaseSync(database,{readOnly:true});
try{
 if(mode==='snapshot'){
  const tables=(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as {name:string}[]).map(({name})=>{const columns=(db.prepare('PRAGMA table_info('+quote(name)+')').all() as {name:string}[]).map(c=>c.name),hashes=db.prepare('SELECT '+columns.map(quote).join(',')+' FROM '+quote(name)).all().map(hash).sort();return {name,columns,hashes};});
  if(!tables.length)throw new Error('No existing tables found; refusing an empty preservation baseline.');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({database,capturedAt:new Date().toISOString(),tables,authSessionExpiry:tables.some(t=>t.name==='auth_sessions')?db.prepare('SELECT * FROM auth_sessions').all().map(row=>({rowHash:hash(row),expiresAt:String(row.expires_at)})):[]},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({result:'SNAPSHOT_SAVED',tables:tables.length,rows:tables.reduce((n,t)=>n+t.hashes.length,0),file:path.relative(process.cwd(),file)}));
 }else{
  const before=JSON.parse(fs.readFileSync(file,'utf8')) as Snapshot;if(before.database!==database)throw new Error('Preservation database differs from the original baseline.');
  const checks=before.tables.map(t=>{const current=db.prepare('SELECT '+t.columns.map(quote).join(',')+' FROM '+quote(t.name)).all(),counts=new Map<string,number>();for(const row of current){const key=hash(row);counts.set(key,(counts.get(key)||0)+1);}let missing=0;for(const key of t.hashes){const n=counts.get(key)||0;if(!n)missing++;else counts.set(key,n-1);}return {table:t.name,originalRows:t.hashes.length,currentRows:current.length,missingOrChangedOriginalRows:missing};}),missing=checks.reduce((n,t)=>n+t.missingOrChangedOriginalRows,0),report={result:missing?'FAIL':'PASS',checkedAt:new Date().toISOString(),scope:'All original table rows compared on their original columns; newly added columns and rows allowed. Hashes only, no raw values.',tables:checks.length,originalRows:checks.reduce((n,t)=>n+t.originalRows,0),missingOrChangedOriginalRows:missing,checks},reportFile=path.resolve(process.argv[5]||path.join(path.dirname(file),'preservation.json'));fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:report.result,tables:report.tables,originalRows:report.originalRows,missingOrChangedOriginalRows:missing,report:path.relative(process.cwd(),reportFile)}));if(missing)process.exitCode=1;
 }
}finally{db.close();}
