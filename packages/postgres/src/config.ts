import fs from 'node:fs';
import path from 'node:path';
import {isIP} from 'node:net';
import {checkServerIdentity} from 'node:tls';
import {z} from 'zod';
import pg from 'pg';
import {assertNoLinks} from '../../recovery/src/files.js';
import {RecoveryError} from '../../recovery/src/guard.js';

export class PostgresMigrationError extends Error {constructor(public code:string,message:string){super(message);this.name='PostgresMigrationError';}}
const configSchema=z.object({
  purpose:z.literal('offline-staging-only'),host:z.string().min(1).max(253),port:z.number().int().min(1).max(65535),
  database:z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/),user:z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/),passwordFile:z.string().min(1),
  tls:z.discriminatedUnion('mode',[z.object({mode:z.literal('verify-full'),caFile:z.string().min(1)}).strict(),z.object({mode:z.literal('loopback-test-only')}).strict()])
}).strict();
export type PostgresConnectionConfig=z.infer<typeof configSchema>;
export function readPrivateFile(file:string,maxBytes=1024*1024){assertNoLinks(file);const s=fs.lstatSync(file);if(!s.isFile()||s.size>maxBytes)throw new PostgresMigrationError('PG_CONFIG_INVALID','配置、凭据或证书必须是有界普通文件。');return fs.readFileSync(file,'utf8');}
export function parseConnectionConfig(raw:unknown,base=process.cwd()):PostgresConnectionConfig{
  const result=configSchema.safeParse(raw);if(!result.success)throw new PostgresMigrationError('PG_CONFIG_INVALID','请使用显式数据库连接配置；不接受连接串、未知字段或明文密码字段。');const c=result.data;
  if(!isIP(c.host)&&!/^([a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(c.host))throw new PostgresMigrationError('PG_CONFIG_INVALID','数据库主机必须是显式IP或主机名，不能包含连接串或路径。');
  if(c.tls.mode==='loopback-test-only'&&!['127.0.0.1','::1'].includes(c.host))throw new PostgresMigrationError('PG_TLS_REQUIRED','远程PostgreSQL连接必须校验证书及主机名。');
  return{...c,passwordFile:path.resolve(base,c.passwordFile),tls:c.tls.mode==='verify-full'?{...c.tls,caFile:path.resolve(base,c.tls.caFile)}:c.tls};
}
export function loadConnectionConfig(file:string){return parseConnectionConfig(JSON.parse(readPrivateFile(path.resolve(file))),path.dirname(path.resolve(file)));}
export function postgresConnectionOptions(input:PostgresConnectionConfig):pg.ClientConfig{
  const c=parseConnectionConfig(input);
  // All connection parameters are explicit; PGHOST/PGDATABASE/PGPASSWORD and libpq defaults are ignored.
  const password=readPrivateFile(c.passwordFile,4096).replace(/\r?\n$/,'');if(!password||password.includes('\0'))throw new PostgresMigrationError('PG_CONFIG_INVALID','数据库密码文件为空或格式错误。');
  return {host:c.host,port:c.port,database:c.database,user:c.user,password,
    ssl:c.tls.mode==='verify-full'?{rejectUnauthorized:true,ca:readPrivateFile(c.tls.caFile),checkServerIdentity:(_hostname,cert)=>checkServerIdentity(c.host,cert)}:false,
    connectionTimeoutMillis:5000,query_timeout:30000,statement_timeout:25000,lock_timeout:3000,idle_in_transaction_session_timeout:30000,
    keepAlive:true,application_name:'digitalguide-offline-staging',options:'-c search_path=pg_catalog',client_encoding:'UTF8',sslnegotiation:'postgres',
    types:{getTypeParser:(oid,format)=>oid===20?(value:string)=>value:pg.types.getTypeParser(oid,format)}
  };
}
export function createPostgresClient(input:PostgresConnectionConfig){return new pg.Client(postgresConnectionOptions(input));}
export const identifier=(value:string)=>{if(!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(value))throw new PostgresMigrationError('PG_IDENTIFIER_INVALID','数据库标识符不符合离线迁移约定。');return'"'+value+'"';};
export function targetSchema(value:string){if(!/^dg_import_[a-f0-9]{32}$/.test(value))throw new PostgresMigrationError('PG_SCHEMA_INVALID','目标必须是全新的 dg_import_<32位十六进制编号> 隔离schema。');return identifier(value);}
export function safePostgresError(error:unknown):never{
  if(error instanceof PostgresMigrationError)throw error;
  if(error instanceof RecoveryError)throw new PostgresMigrationError(error.code,error.message);
  const state=error instanceof Error&&'code'in error&&typeof error.code==='string'&&/^[A-Z0-9]{5}$/.test(error.code)?'（SQLSTATE '+error.code+'）':'';
  throw new PostgresMigrationError('PG_OPERATION_FAILED','数据库迁移或校验失败'+state+'。未启用正式业务；请检查私有运维环境，不会打印原始SQL、数据或凭据。');
}
