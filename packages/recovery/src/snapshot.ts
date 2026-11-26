import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {RecoveryError} from './guard.js';
import type {RecoveryLimits} from './files.js';
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v,(_,x)=>typeof x==='bigint'?{sqliteInt64:x.toString()}:ArrayBuffer.isView(x)?{sqliteBlob:Buffer.from(x.buffer,x.byteOffset,x.byteLength).toString('hex')}:x)).digest('hex');
export interface DatabaseSnapshot {schemaSHA256:string;tables:{name:string;rows:number;sha256:string}[];rows:number;migrations:{name:string;sha256:string}[]}
export function snapshot(db:DatabaseSync,root:string,cap:RecoveryLimits):DatabaseSnapshot{
  if(db.prepare('PRAGMA integrity_check').all().some(r=>r.integrity_check!=='ok')||db.prepare('PRAGMA foreign_key_check').all().length)throw new RecoveryError('RECOVERY_DATABASE_INVALID','数据库完整性或外键检查未通过，不能生成可恢复备份。');
  const tables=[];let rows=0;
  for(const t of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()){
    const name=String(t.name);if(!/^[a-zA-Z0-9_]+$/.test(name))throw new RecoveryError('RECOVERY_DATABASE_INVALID','数据库包含不支持的表名。');
    const statement=db.prepare('SELECT * FROM "'+name+'"');statement.setReadBigInts(true);const hashes=[];
    for(const row of statement.iterate()){if(++rows>cap.maxRows)throw new RecoveryError('RECOVERY_LIMIT_EXCEEDED','数据库行数超过当前备份限制。');hashes.push(digest(row));}
    tables.push({name,rows:hashes.length,sha256:digest(hashes.sort())});
  }
  if(!tables.some(t=>t.name==='schema_migrations'))throw new RecoveryError('RECOVERY_DATABASE_INVALID','所选目录不是具有迁移历史的DigitalGuide数据库。');
  const names=db.prepare('SELECT name FROM schema_migrations ORDER BY name').all().map(r=>String(r.name)),known=fs.readdirSync(path.join(root,'migrations','sqlite')).filter(n=>n.endsWith('.sql')).sort();
  if(!names.length||JSON.stringify(names)!==JSON.stringify(known.slice(0,names.length)))throw new RecoveryError('RECOVERY_MIGRATION_MISMATCH','数据库迁移历史与当前代码不匹配，请选择兼容版本。');
  const migrations=names.map(name=>({name,sha256:createHash('sha256').update(fs.readFileSync(path.join(root,'migrations','sqlite',name))).digest('hex')}));
  return{schemaSHA256:digest(db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all()),tables,rows,migrations};
}
export function openSnapshot(file:string,root:string,cap:RecoveryLimits){const db=new DatabaseSync(file,{readOnly:true});try{return snapshot(db,root,cap);}finally{db.close();}}
