import {createHash} from 'node:crypto';
import type pg from 'pg';
import {RecoveryError} from '../../recovery/src/guard.js';
import {checkCancelled,type RecoveryLimits} from '../../recovery/src/files.js';
import {identifier,type PostgresConnectionConfig} from './config.js';
import {nativeRuntimeCatalog} from './runtime-database.js';
import type {NativeRecoverySnapshot} from './recovery-manifest.js';
import {recoveryCheckDefinition} from './recovery-catalog.js';
import {nativeRecoveryJournalCheckpoint} from './recovery-journal-checkpoint.js';

export const recoveryConnectionHash=(c:PostgresConnectionConfig)=>createHash('sha256').update(JSON.stringify([c.host.toLowerCase(),c.port,c.database,c.user])).digest('hex');
export async function nativeRecoverySnapshot(client:pg.Client,schema:string,metadata:Pick<NativeRecoverySnapshot,'runtimeId'|'appEnv'|'ownerRole'|'apiRole'|'workerRole'|'sourceConnectionSHA256'>&Partial<Pick<NativeRecoverySnapshot,'recoveryCatalogAlgorithm'>>,cap:RecoveryLimits,signal?:AbortSignal):Promise<NativeRecoverySnapshot>{
 await client.query('SET LOCAL search_path TO '+identifier(schema)+",pg_catalog,pg_temp; SET LOCAL TimeZone='UTC'; SET LOCAL DateStyle='ISO,YMD'");
 const names=(await client.query<{tablename:string}>('SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename COLLATE "C"',[schema])).rows;if(names.length>2048)throw new RecoveryError('PG_RECOVERY_LIMIT_EXCEEDED','原生数据库表数超过限制。');
 const tables:NativeRecoverySnapshot['tables']=[],sequences:NativeRecoverySnapshot['sequences']=[];let rows=0,bytes=0;
 for(const {tablename:name}of names){
  checkCancelled(signal);const hash=createHash('sha256');let count=0;
  await client.query('DECLARE dg_recovery_rows NO SCROLL CURSOR FOR SELECT h,bytes FROM (SELECT encode(sha256(convert_to(to_jsonb(r)::text,\'UTF8\')),\'hex\') h,octet_length(to_jsonb(r)::text)::text bytes FROM '+identifier(schema)+'.'+identifier(name)+' r) payload ORDER BY h COLLATE "C"');
  try{for(;;){const page=await client.query<{h:string;bytes:string}>('FETCH FORWARD 256 FROM dg_recovery_rows');if(!page.rows.length)break;for(const row of page.rows){if(++rows>cap.maxRows||(bytes+=Number(row.bytes))>cap.maxBytes)throw new RecoveryError('PG_RECOVERY_LIMIT_EXCEEDED','原生数据库行数或内容量超过备份限制。');count++;hash.update(row.h+'\n');}checkCancelled(signal);}}finally{await client.query('CLOSE dg_recovery_rows');}
  tables.push({name,rows:count,sha256:hash.digest('hex')});
 }
 const seq=(await client.query<{sequencename:string}>('SELECT sequencename FROM pg_sequences WHERE schemaname=$1 ORDER BY sequencename COLLATE "C"',[schema])).rows;if(seq.length>1024)throw new RecoveryError('PG_RECOVERY_LIMIT_EXCEEDED','序列数量超过限制。');
 for(const {sequencename:name}of seq){const row=(await client.query<{last_value:string;is_called:boolean}>('SELECT last_value::text,is_called FROM '+identifier(schema)+'.'+identifier(name))).rows[0];sequences.push({name,lastValue:row.last_value,isCalled:row.is_called});}
 const migrations=(await client.query<{name:string;sha256:string}>('SELECT name,sha256 FROM '+identifier(schema)+'._dg_postgres_migrations ORDER BY name')).rows;
 const recoveryJournal=await nativeRecoveryJournalCheckpoint(client,schema,cap,signal);
 const recoveryCatalogAlgorithm=metadata.recoveryCatalogAlgorithm??'check-bool-function-identity-v2';return{schema,runtimeId:metadata.runtimeId,appEnv:metadata.appEnv,ownerRole:metadata.ownerRole,apiRole:metadata.apiRole,workerRole:metadata.workerRole,sourceConnectionSHA256:metadata.sourceConnectionSHA256,catalogSHA256:await nativeRuntimeCatalog(client,schema),recoveryCatalogAlgorithm,recoveryCatalogSHA256:await nativeRuntimeCatalog(client,schema,recoveryCheckDefinition,recoveryCatalogAlgorithm==='check-bool-function-identity-v2'),...(recoveryJournal?{recoveryJournal}:{}),tables,sequences,rows,migrations};
}
