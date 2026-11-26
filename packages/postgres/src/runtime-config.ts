import fs from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import {createHash} from 'node:crypto';
import {parseConnectionConfig,readPrivateFile,identifier,PostgresMigrationError,type PostgresConnectionConfig} from './config.js';
import {assertNoLinks} from '../../recovery/src/files.js';
import {assertRecoveryAccess,RecoveryError} from '../../recovery/src/guard.js';

export const nativeRuntimeMarker='.dg-native-postgres.json';
export const nativeJournalSignerPath=(dataDir:string,runtimeId:string)=>path.join(path.dirname(path.resolve(dataDir)),'.dg-native-journal-'+runtimeId+'.pem');
export const nativeRuntimeCookieName=(runtimeId:string)=>'dg_native_session_'+runtimeId.replaceAll('-','');
const schema=z.object({version:z.literal(1),purpose:z.literal('native-application-validation-only'),schema:z.string().regex(/^dg_validation_[a-f0-9]{32}$/),runtimeId:z.uuid(),dataDir:z.string().min(1),appEnv:z.enum(['development','sandbox']),connection:z.unknown()}).strict();
export interface NativeRuntimeConfig {version:1;purpose:'native-application-validation-only';schema:string;runtimeId:string;dataDir:string;appEnv:'development'|'sandbox';connection:PostgresConnectionConfig}
export function parseNativeRuntimeConfig(raw:unknown,base=process.cwd()):NativeRuntimeConfig{
 const r=schema.safeParse(raw);if(!r.success)throw new PostgresMigrationError('PG_RUNTIME_CONFIG_INVALID','原生验证实例配置无效；不接受归档schema、生产环境、真实供应商或未知字段。');const c=r.data;return{...c,dataDir:path.resolve(base,c.dataDir),connection:parseConnectionConfig(c.connection,base)};
}
export function loadNativeRuntimeConfig(file:string){let raw:unknown;try{raw=JSON.parse(readPrivateFile(file));}catch{throw new PostgresMigrationError('PG_RUNTIME_CONFIG_INVALID','原生实例配置无法读取或JSON无效，请核对私有文件；不会打印原文。');}return parseNativeRuntimeConfig(raw,path.dirname(path.resolve(file)));}
export const runtimeDataHash=(dir:string)=>{const p=path.resolve(dir).replaceAll('\\','/');return createHash('sha256').update(process.platform==='win32'?p.toLowerCase():p).digest('hex');};
export function nativeRuntimeSchema(value:string){if(!/^dg_validation_[a-f0-9]{32}$/.test(value))throw new PostgresMigrationError('PG_RUNTIME_SCHEMA_INVALID','原生应用验证只能连接全新dg_validation schema，不能启用迁移归档。');return identifier(value);}
export function assertNativeRecoveryAccess(dataDir:string){
 try{assertRecoveryAccess(dataDir);}catch(error){
  if(error instanceof RecoveryError){
   if(error.code==='RECOVERY_MAINTENANCE')throw new PostgresMigrationError('PG_RUNTIME_MAINTENANCE','原生数据目录有备份或恢复运维锁。请先停止业务并检查原操作，不能绕过锁启动或继续提交事务。');
   throw new PostgresMigrationError('PG_RUNTIME_RECOVERY_ISOLATED','原生数据目录带有恢复隔离标记或标记无效。原生恢复验证与业务核对尚未实现，不能启用API、worker或直接数据库工具。');
  }
  throw error;
 }
}
export function assertNativeRuntimeDirectory(c:NativeRuntimeConfig){
 assertNativeRecoveryAccess(c.dataDir);
 assertNoLinks(c.dataDir);let m;try{m=JSON.parse(readPrivateFile(path.join(c.dataDir,nativeRuntimeMarker),16384));}catch{throw new PostgresMigrationError('PG_RUNTIME_DIRECTORY_MISMATCH','原生目录标记缺失、损坏或类型错误，不会启用或回退SQLite。');}if(m.version!==1||m.complete!==true||m.purpose!==c.purpose||m.schema!==c.schema||m.runtimeId!==c.runtimeId||m.dataDirSHA256!==runtimeDataHash(c.dataDir)||m.appEnv!==c.appEnv)throw new PostgresMigrationError('PG_RUNTIME_DIRECTORY_MISMATCH','数据目录与原生验证实例不匹配或初始化未完成；请核对配置，不会回退到SQLite。');
 for(const n of ['.session-secret','.provenance-secret'])assertNoLinks(path.join(c.dataDir,n));
 if(fs.existsSync(path.join(c.dataDir,'digitalguide.sqlite')))throw new PostgresMigrationError('PG_RUNTIME_MIXED_STORE','原生验证目录不能同时包含SQLite数据库，请使用独立目录。');
}
