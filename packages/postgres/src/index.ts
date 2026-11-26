import {postgresCatalogFingerprint as catalog} from './catalog.js';
import type pg from 'pg';
import type {DatabaseSync} from 'node:sqlite';
import {createPostgresClient,PostgresMigrationError,identifier,targetSchema,safePostgresError,type PostgresConnectionConfig} from './config.js';
import {withArchive,digest,normalizedRow,type ArchiveOptions,type TableDefinition} from './source.js';
import {checkCancelled} from '../../recovery/src/files.js';
export {PostgresMigrationError,loadConnectionConfig,parseConnectionConfig} from './config.js';
export type {PostgresConnectionConfig} from './config.js';

type Client=pg.Client;
export interface PostgresImportOptions extends ArchiveOptions {connection:PostgresConnectionConfig;schema:string}
export interface TableReceipt {name:string;rows:number;sha256:string}
export interface ImportReceipt {version:1;result:'PASS';schema:string;backupId:string;archiveSHA256:string;baselineSHA256:string;sqliteSchemaSHA256:string;postgresMajor:number;tables:TableReceipt[];rows:number;sequences:Record<string,string>;verifiedFiles:number;verifiedFileBytes:number;catalogSHA256:string;activation:'quarantined';applicationCutover:false;mediaMigrated:false;secretsImported:false;productionAccepted:false}

async function connect(client:Client,minimum:number){
  await client.connect();const r=await client.query("SELECT current_setting('server_version_num') AS version, current_setting('server_encoding') AS encoding, (SELECT usesuper FROM pg_user WHERE usename=current_user) AS superuser");
  const major=Math.floor(Number(r.rows[0].version)/10000);if(major<minimum||r.rows[0].encoding!=='UTF8')throw new PostgresMigrationError('PG_SERVER_UNSUPPORTED','目标需要PostgreSQL 18或更新版本及UTF8编码。');
  if(r.rows[0].superuser)throw new PostgresMigrationError('PG_ROLE_TOO_PRIVILEGED','请使用专用非超级用户离线导入账号，不能使用集群管理员执行导入。');return major;
}

function sourceRows(db:DatabaseSync,table:TableDefinition){
  // node:sqlite string decoding truncates embedded NUL. Read TEXT as original bytes, and retain its storage type.
  const fields=table.columns.flatMap((c,i)=>c.type==='TEXT'?['CAST('+identifier(c.name)+' AS BLOB) AS '+identifier(c.name),'typeof('+identifier(c.name)+') AS '+identifier('__dg_type_'+i)]:[identifier(c.name)]);
  const s=db.prepare('SELECT '+fields.join(',')+' FROM '+identifier(table.name));s.setReadBigInts(true);return s.iterate();
}
function rowHash(values:unknown[]){return digest(values);}
async function copyTable(client:Client,db:DatabaseSync,table:TableDefinition,signal?:AbortSignal){
  const columns=table.columns.map(c=>identifier(c.name)).join(','),hashes:string[]=[];let batch:(string|number|null)[][]=[],batchBytes=0;
  const flush=async()=>{if(!batch.length)return;checkCancelled(signal);const values=batch.flat(),tuples=batch.map((row,i)=>'('+row.map((_,j)=>'$'+(i*table.columns.length+j+1)).join(',')+')').join(',');await client.query('INSERT INTO '+identifier(table.name)+' ('+columns+') VALUES '+tuples,values);batch=[];batchBytes=0;};
  for(const row of sourceRows(db,table)){
    checkCancelled(signal);const values=normalizedRow(table,row),bytes=Buffer.byteLength(JSON.stringify(values));if(bytes>16*1024**2)throw new PostgresMigrationError('PG_ROW_LIMIT','单行超过16MiB迁移限制，请先评估内存与存储，不能截断。');
    if(batch.length&&(batchBytes+bytes>4*1024**2||(batch.length+1)*table.columns.length>60000))await flush();batch.push(values);batchBytes+=bytes;hashes.push(rowHash(values));if(batch.length>=100)await flush();
  }await flush();return{name:table.name,rows:hashes.length,sha256:digest(hashes.sort())};
}
async function verifyTable(client:Client,db:DatabaseSync,table:TableDefinition,signal?:AbortSignal):Promise<TableReceipt>{
  const expected=[];for(const row of sourceRows(db,table)){checkCancelled(signal);expected.push(rowHash(normalizedRow(table,row)));}
  const actual:string[]=[];await client.query('DECLARE dg_verify_cursor NO SCROLL CURSOR FOR SELECT * FROM '+identifier(table.name));
  try{for(;;){checkCancelled(signal);const result=await client.query('FETCH FORWARD 100 FROM dg_verify_cursor');if(!result.rows.length)break;for(const row of result.rows)actual.push(rowHash(normalizedRow(table,row,true)));}}finally{await client.query('CLOSE dg_verify_cursor');}
  const a=digest(actual.sort()),e=digest(expected.sort());if(a!==e||actual.length!==expected.length)throw new PostgresMigrationError('PG_ROW_MISMATCH','原生PostgreSQL回读与源数据逐表摘要不符，不能验收。');return{name:table.name,rows:actual.length,sha256:a};
}
async function setSequences(client:Client,schema:string,tables:TableDefinition[],sequences:Record<string,string>){
  for(const t of tables)if(t.identity){const seq=BigInt(sequences[t.name]);const max=await client.query('SELECT max('+identifier(t.identity)+')::text AS maximum FROM '+identifier(t.name));if(BigInt(max.rows[0].maximum??0)>seq)throw new PostgresMigrationError('PG_SEQUENCE_INVALID','源自增序列小于现有行，拒绝修改高水位。');await client.query('SELECT setval(pg_get_serial_sequence($1,$2),$3::bigint,$4)',[identifier(schema)+'.'+identifier(t.name),t.identity,seq>0n?seq.toString():'1',seq>0n]);}
}
async function verifySequences(client:Client,schema:string,tables:TableDefinition[],sequences:Record<string,string>){
  for(const t of tables)if(t.identity){const r=await client.query('SELECT pg_get_serial_sequence($1,$2) AS name',[identifier(schema)+'.'+identifier(t.name),t.identity]);const name=r.rows[0].name as string;const parsed=name.split('.').map(v=>v.replace(/^"|"$/g,''));if(parsed.length!==2||parsed[0]!==schema)throw new PostgresMigrationError('PG_SEQUENCE_INVALID','目标自增序列不属于本次隔离schema。');const s=await client.query('SELECT last_value::text AS value,is_called FROM '+identifier(parsed[0])+'.'+identifier(parsed[1]));const expected=BigInt(sequences[t.name]);if(s.rows[0].value!==(expected>0n?expected.toString():'1')||s.rows[0].is_called!==(expected>0n))throw new PostgresMigrationError('PG_SEQUENCE_MISMATCH','目标自增高水位与原SQLite归档不符。');}
}
async function assertNativeGuards(client:Client,schema:string,expected:{foreignKeys:number;triggers:number;checkConstraints:number;explicitIndexes:number}){
  const r=await client.query("SELECT (SELECT count(*)::int FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=$1 AND c.contype='f' AND c.convalidated) AS fks,(SELECT count(*)::int FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND NOT t.tgisinternal AND t.tgenabled='O') AS triggers",[schema]);
  const extra=await client.query("SELECT (SELECT count(*)::int FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=$1 AND c.contype='c') AS checks,(SELECT count(*)::int FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND NOT EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conindid=i.indexrelid)) AS indexes",[schema]);
  if(r.rows[0].fks!==expected.foreignKeys||r.rows[0].triggers!==expected.triggers||extra.rows[0].checks!==expected.checkConstraints+2||extra.rows[0].indexes!==expected.explicitIndexes)throw new PostgresMigrationError('PG_GUARDS_MISMATCH','目标外键、CHECK、索引或启用触发器数量不符，不能验收。');
}
export async function importPostgresArchive(input:PostgresImportOptions):Promise<ImportReceipt>{
  const schema=targetSchema(input.schema);try{return await withArchive(input,async source=>{
    const client=createPostgresClient(input.connection);client.on('error',()=>{});let transaction=false;
    try{
      checkCancelled(input.signal);input.onPhase?.('connecting_native_postgres');const major=await connect(client,source.baseline.minimumPostgresMajor);await client.query('BEGIN');transaction=true;
      const lock=await client.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked',['digitalguide-offline-import:'+input.schema]);if(!lock.rows[0].locked)throw new PostgresMigrationError('PG_IMPORT_BUSY','目标schema已有离线迁移事务，不能并行覆盖。');
      if((await client.query('SELECT 1 FROM pg_namespace WHERE nspname=$1',[input.schema])).rowCount)throw new PostgresMigrationError('PG_TARGET_EXISTS','目标schema已存在；请校验既有导入，或选择全新编号，不能覆盖。');
      await client.query('CREATE SCHEMA '+schema);await client.query('SET LOCAL search_path TO '+schema+',pg_catalog');
      await client.query("CREATE TABLE _dg_postgres_migrations(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT statement_timestamp());CREATE TABLE _dg_import_control(id integer PRIMARY KEY CHECK(id=1),activation text NOT NULL CHECK(activation='quarantined'),receipt jsonb NOT NULL)");
      input.onPhase?.('creating_native_tables');checkCancelled(input.signal);await client.query(source.sql[0]);
      input.onPhase?.('copying_rows');const expected:TableReceipt[]=[];let firstCopied=false;for(const table of source.baseline.tables){const copied=await copyTable(client,source.db,table,input.signal);expected.push(copied);if(copied.rows&&!firstCopied){firstCopied=true;input.onPhase?.('copied_first_nonempty_table');}}
      input.onPhase?.('validating_native_relations');checkCancelled(input.signal);await client.query(source.sql[1]);await client.query(source.sql[2]);await setSequences(client,input.schema,source.baseline.tables,source.sequences);await assertNativeGuards(client,input.schema,source.baseline.counts);
      for(const m of source.baseline.postgresMigrations)await client.query('INSERT INTO _dg_postgres_migrations(name,sha256) VALUES ($1,$2)',[m.name,m.sha256]);
      input.onPhase?.('verifying_native_rows');const tables=[];for(const t of source.baseline.tables)tables.push(await verifyTable(client,source.db,t,input.signal));if(digest(tables)!==digest(expected))throw new PostgresMigrationError('PG_ROW_MISMATCH','写入与回读摘要不一致。');await verifySequences(client,input.schema,source.baseline.tables,source.sequences);
      const receipt:ImportReceipt={version:1,result:'PASS',schema:input.schema,backupId:source.backupId,archiveSHA256:source.archiveSHA256,baselineSHA256:source.baselineSHA256,sqliteSchemaSHA256:source.baseline.sqliteSchemaSHA256,postgresMajor:major,tables,rows:tables.reduce((n,t)=>n+t.rows,0),sequences:source.sequences,verifiedFiles:source.files,verifiedFileBytes:source.fileBytes,catalogSHA256:await catalog(client,input.schema),activation:'quarantined',applicationCutover:false,mediaMigrated:false,secretsImported:false,productionAccepted:false};
      await client.query("INSERT INTO _dg_import_control VALUES (1,'quarantined',$1::jsonb)",[JSON.stringify(receipt)]);input.onPhase?.('committing_quarantined_schema');checkCancelled(input.signal);await client.query('COMMIT');transaction=false;return receipt;
    }finally{if(transaction)try{await client.query('ROLLBACK');}catch{/* A disconnected native session rolls its transaction back. */}await client.end();}
  });}catch(e){safePostgresError(e);}
}
export async function verifyPostgresArchive(input:PostgresImportOptions):Promise<ImportReceipt>{
  const schema=targetSchema(input.schema);try{return await withArchive(input,async source=>{
    const client=createPostgresClient(input.connection);client.on('error',()=>{});let transaction=false;
    try{
      await connect(client,source.baseline.minimumPostgresMajor);await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');transaction=true;await client.query('SET LOCAL search_path TO '+schema+',pg_catalog');
      const r=await client.query('SELECT activation,receipt FROM _dg_import_control WHERE id=1');const receipt=r.rows[0]?.receipt as ImportReceipt|undefined;
      if(r.rows[0]?.activation!=='quarantined'||!receipt||receipt.activation!=='quarantined'||receipt.schema!==input.schema||receipt.archiveSHA256!==source.archiveSHA256||receipt.backupId!==source.backupId||receipt.baselineSHA256!==source.baselineSHA256||receipt.applicationCutover!==false||receipt.productionAccepted!==false)throw new PostgresMigrationError('PG_RECEIPT_MISMATCH','目标不属于当前归档或不再保持隔离，不能校验为通过。');
      const migrations=(await client.query('SELECT name,sha256 FROM _dg_postgres_migrations ORDER BY name')).rows;if(digest(migrations)!==digest(source.baseline.postgresMigrations)||await catalog(client,input.schema)!==receipt.catalogSHA256)throw new PostgresMigrationError('PG_CATALOG_CHANGED','迁移历史、约束、触发器或原生对象已改变，不能使用旧回执。');
      await assertNativeGuards(client,input.schema,source.baseline.counts);const tables=[];for(const t of source.baseline.tables)tables.push(await verifyTable(client,source.db,t,input.signal));await verifySequences(client,input.schema,source.baseline.tables,source.sequences);
      if(digest(tables)!==digest(receipt.tables)||digest(source.sequences)!==digest(receipt.sequences)||receipt.rows!==source.sourceRows)throw new PostgresMigrationError('PG_RECEIPT_MISMATCH','回执的行数、摘要或自增高水位与归档不一致。');await client.query('COMMIT');transaction=false;return receipt;
    }finally{if(transaction)try{await client.query('ROLLBACK');}catch{/* no writes */}await client.end();}
  });}catch(e){safePostgresError(e);}
}
