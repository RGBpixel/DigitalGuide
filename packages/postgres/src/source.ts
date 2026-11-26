import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {decryptArchive,inspectZip,readRecoveryKey} from '../../recovery/src/codec.js';
import {assertNoLinks,limits,checkCancelled,removeOwnedTree,type RecoveryLimits} from '../../recovery/src/files.js';
import {snapshot} from '../../recovery/src/snapshot.js';
import {PostgresMigrationError} from './config.js';

export const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v)).digest('hex');
export interface TableDefinition {name:string;columns:{name:string;type:'TEXT'|'INTEGER'|'REAL';nullable:boolean}[];primaryKey:string[];identity:string|null}
export interface Baseline {version:1;sqliteSchemaSHA256:string;sqliteMigrations:{name:string;sha256:string}[];tables:TableDefinition[];counts:{tables:number;columns:number;explicitIndexes:number;triggers:number;foreignKeys:number;uniqueConstraints:number;checkConstraints:number};postgresMigrations:{name:string;sha256:string}[];minimumPostgresMajor:number;activation:'staging-only'}
export function loadBaseline(root:string){
  const file=path.join(root,'migrations/postgres/baseline.json');assertNoLinks(file);const baseline=JSON.parse(fs.readFileSync(file,'utf8')) as Baseline;
  if(baseline.version!==1||baseline.activation!=='staging-only'||baseline.counts.tables!==301||baseline.tables.length!==301||baseline.postgresMigrations.length!==3||baseline.sqliteMigrations.at(-1)?.name!=='052-practice.sql')throw new PostgresMigrationError('PG_BASELINE_INVALID','独立PostgreSQL基线不匹配。');
  const sql=baseline.postgresMigrations.map(m=>{if(!/^\d{3}-[a-z-]+\.sql$/.test(m.name))throw new PostgresMigrationError('PG_BASELINE_INVALID','迁移文件名不符合版本规则。');const f=path.join(root,'migrations/postgres',m.name);assertNoLinks(f);const contents=fs.readFileSync(f,'utf8');if(createHash('sha256').update(contents).digest('hex')!==m.sha256)throw new PostgresMigrationError('PG_BASELINE_CHANGED','PostgreSQL迁移文件摘要不符，请恢复经过审查的基线。');return contents;});
  return{baseline,baselineSHA256:createHash('sha256').update(fs.readFileSync(file)).digest('hex'),sql};
}
export interface ArchiveOptions {archive:string;keyFile:string;workDir:string;root?:string;limits?:Partial<RecoveryLimits>;signal?:AbortSignal;onPhase?:(phase:string)=>void}
export async function withArchive<T>(input:ArchiveOptions,work:(source:{db:DatabaseSync;baseline:Baseline;baselineSHA256:string;sql:string[];archiveSHA256:string;backupId:string;files:number;fileBytes:number;sequences:Record<string,string>;sourceRows:number})=>Promise<T>):Promise<T>{
  const root=path.resolve(input.root??process.cwd()),cap=limits(input.limits),loaded=loadBaseline(root),parent=path.resolve(input.workDir);assertNoLinks(parent);if(!fs.statSync(parent).isDirectory())throw new PostgresMigrationError('PG_WORKDIR_INVALID','请选择已有的私有迁移工作目录。');
  const scratch=fs.mkdtempSync(path.join(parent,'.dg-pg-import-')),data=path.join(scratch,'data');fs.mkdirSync(data,{mode:0o700});let db:DatabaseSync|undefined,key:Buffer|undefined;
  try{
    input.onPhase?.('authenticating_archive');checkCancelled(input.signal);key=readRecoveryKey(input.keyFile);const archive=await decryptArchive(input.archive,path.join(scratch,'archive.zip'),key,cap,input.signal);key.fill(0);key=undefined;
    const manifest=await inspectZip(path.join(scratch,'archive.zip'),data,cap,false,input.signal);input.onPhase?.('validating_source');checkCancelled(input.signal);
    db=new DatabaseSync(path.join(data,'digitalguide.sqlite'),{readOnly:true});db.exec('BEGIN');const actual=snapshot(db,root,cap);
    if(JSON.stringify(actual)!==JSON.stringify(manifest.database)||actual.schemaSHA256!==loaded.baseline.sqliteSchemaSHA256||JSON.stringify(actual.migrations)!==JSON.stringify(loaded.baseline.sqliteMigrations))throw new PostgresMigrationError('PG_SOURCE_INCOMPATIBLE','归档数据库、迁移历史或结构与已审查的052基线不一致，不能导入。');
    const sequences:Record<string,string>={};for(const t of loaded.baseline.tables)if(t.identity){const s=db.prepare('SELECT seq FROM sqlite_sequence WHERE name=?');s.setReadBigInts(true);const row=s.get(t.name);sequences[t.name]=String(row?.seq??0n);if(!/^\d+$/.test(sequences[t.name])||BigInt(sequences[t.name])>9223372036854775807n)throw new PostgresMigrationError('PG_SEQUENCE_INVALID','源自增序列越界，不能改写或截断。');}
    return await work({db,...loaded,...archive,backupId:manifest.backupId,files:manifest.files.length,fileBytes:manifest.files.reduce((n,f)=>n+f.bytes,0),sequences,sourceRows:actual.rows});
  }finally{key?.fill(0);if(db){if(db.isTransaction)db.exec('ROLLBACK');db.close();}removeOwnedTree(scratch,parent,'.dg-pg-import-');}
}
export function normalizedRow(table:TableDefinition,row:Record<string,unknown>,native=false){
  return table.columns.map((c,i)=>{
    let value=row[c.name];if(value===null){if(!c.nullable)throw new PostgresMigrationError('PG_ROW_UNSUPPORTED','源数据含原生主键或必填列不支持的空值，不能迁移。');return null;}
    if(c.type==='TEXT'){
      if(value instanceof Uint8Array&&!native){
        if(row['__dg_type_'+i]!=='text')throw new PostgresMigrationError('PG_ROW_UNSUPPORTED','文本列含BLOB或其他存储类型，不能伪称无损转换。');
        try{value=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(value);}catch{throw new PostgresMigrationError('PG_ROW_UNSUPPORTED','文本原始字节不是有效UTF-8，不能替换字符。');}
      }
      if(typeof value!=='string'||value.includes('\0'))throw new PostgresMigrationError('PG_ROW_UNSUPPORTED','文本包含PostgreSQL不支持的类型或零字节，不能替换或截断。');return value;
    }
    if(c.type==='INTEGER'){if(!(native?typeof value==='string'&&/^-?\d+$/.test(value):typeof value==='bigint'))throw new PostgresMigrationError('PG_ROW_UNSUPPORTED','整数列包含非整数类型，不能静默强制转换。');const n=BigInt(value as string|bigint);if(n< -9223372036854775808n||n>9223372036854775807n)throw new PostgresMigrationError('PG_ROW_UNSUPPORTED','整数超出64位范围。');return n.toString();}
    if(typeof value!=='number'||!Number.isFinite(value))throw new PostgresMigrationError('PG_ROW_UNSUPPORTED','浮点列包含不支持的数据，不能替换。');return Object.is(value,-0)?0:value;
  });
}
