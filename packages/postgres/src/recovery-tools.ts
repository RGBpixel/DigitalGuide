import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {RecoveryError} from '../../recovery/src/guard.js';
import {assertNoLinks,hashFile,checkCancelled} from '../../recovery/src/files.js';
import {parseConnectionConfig,readPrivateFile,type PostgresConnectionConfig} from './config.js';

export interface NativeRecoveryTools {root:string;pgDump:string;pgRestore:string;major:18;pgDumpSHA256:string;pgRestoreSHA256:string}
export async function nativeRecoveryTools(dir=path.resolve('storage/tools/postgresql/18.7-2')):Promise<NativeRecoveryTools>{
 if(process.platform!=='win32')throw new RecoveryError('PG_RECOVERY_TOOLS_UNAVAILABLE','当前原生恢复工具需要已固定的Windows PostgreSQL18工具集；不会自动下载或安装服务。');
 const root=path.resolve(dir);assertNoLinks(root);const verified=JSON.parse(readPrivateFile(path.join(root,'verified.json'))),pin=JSON.parse(readPrivateFile(path.join(root,'pinned-files.json'),4*1024**2)) as {archiveSHA256:string;files:{file:string;sha256:string}[]};
 if(verified.result!=='PASS'||verified.observedSHA256!==pin.archiveSHA256||pin.archiveSHA256!=='74f3740a2e7844118857f297c2067d226f8f2b0652de96022ce54bb27cd60a79')throw new RecoveryError('PG_RECOVERY_TOOLS_CHANGED','工具集与已固定分发清单不匹配。');
 const files=pin.files.filter(f=>/^pgsql\/bin\/[^/]+\.dll$/i.test(f.file)||['pgsql/bin/pg_dump.exe','pgsql/bin/pg_restore.exe'].includes(f.file));if(!files.some(f=>f.file==='pgsql/bin/pg_dump.exe')||!files.some(f=>f.file==='pgsql/bin/pg_restore.exe'))throw new RecoveryError('PG_RECOVERY_TOOLS_CHANGED','工具清单缺少备份或恢复程序。');
 for(const f of files){const file=path.join(root,...f.file.split('/'));assertNoLinks(file);if(await hashFile(file)!==f.sha256)throw new RecoveryError('PG_RECOVERY_TOOLS_CHANGED','备份工具或动态库摘要变化，请保留现场并核对固定工具集。');}
 return{root,pgDump:path.join(root,'pgsql/bin/pg_dump.exe'),pgRestore:path.join(root,'pgsql/bin/pg_restore.exe'),major:18,pgDumpSHA256:files.find(f=>f.file==='pgsql/bin/pg_dump.exe')!.sha256,pgRestoreSHA256:files.find(f=>f.file==='pgsql/bin/pg_restore.exe')!.sha256};
}
export function nativeRecoveryToolEnvironment(base:NodeJS.ProcessEnv,connection?:PostgresConnectionConfig,passFile?:string){
 const env=Object.fromEntries(Object.entries(base).filter(([key])=>!key.toUpperCase().startsWith('PG')));
 Object.assign(env,{PGCLIENTENCODING:'UTF8',PGCONNECT_TIMEOUT:'5',PGAPPNAME:'digitalguide-native-recovery',PGOPTIONS:'-c search_path=pg_catalog',PGSSLCERTMODE:'disable',PGGSSENCMODE:'disable'});
 if(connection){const c=parseConnectionConfig(connection);Object.assign(env,{PGHOST:c.host,PGPORT:String(c.port),PGDATABASE:c.database,PGUSER:c.user,PGPASSFILE:passFile!,PGSSLMODE:c.tls.mode==='verify-full'?'verify-full':'disable',PGREQUIREAUTH:'scram-sha-256'});if(c.tls.mode==='verify-full'){assertNoLinks(c.tls.caFile);env.PGSSLROOTCERT=c.tls.caFile;}}
 return env;
}
export function nativeRecoveryPassLine(connection:PostgresConnectionConfig,password:string){
 if(!password||/[\r\n\0]/.test(password))throw new RecoveryError('PG_RECOVERY_PASSWORD_INVALID','数据库密码不能在备份工具中安全传递；请使用有效的独立单行密码文件。');
 const escape=(s:string)=>s.replaceAll('\\','\\\\').replaceAll(':','\\:');return[connection.host,String(connection.port),connection.database,connection.user,password].map(escape).join(':')+'\n';
}
export async function runNativeRecoveryTool(tools:NativeRecoveryTools,kind:'dump'|'restore',args:string[],workDir:string,connection?:PostgresConnectionConfig,signal?:AbortSignal){
 checkCancelled(signal);const passFile=connection?path.join(workDir,'pgpass-'+randomUUID()):undefined;
 try{
  if(connection)fs.writeFileSync(passFile!,nativeRecoveryPassLine(connection,readPrivateFile(connection.passwordFile,4096).replace(/\r?\n$/,'')),{flag:'wx',mode:0o600});
  const env=nativeRecoveryToolEnvironment(process.env,connection,passFile),child=spawn(kind==='dump'?tools.pgDump:tools.pgRestore,args,{cwd:workDir,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='',size=0,overflow=false,aborted=false;
  child.stdout.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size<=2*1024**2)output+=chunk.toString('utf8');else{overflow=true;child.kill();}});
  // Raw stderr may contain SQL, source data or private filenames. Never return or log it.
  child.stderr.resume();const abort=()=>{aborted=true;child.kill();},timer=setTimeout(abort,600000);signal?.addEventListener('abort',abort,{once:true});
  try{const code=await new Promise<number|null>((resolve,reject)=>{child.once('error',()=>reject(new RecoveryError('PG_RECOVERY_TOOL_FAILED','无法运行固定备份工具，请检查私有运行环境。')));child.once('close',resolve);});checkCancelled(signal);if(code!==0||overflow||aborted)throw new RecoveryError('PG_RECOVERY_TOOL_FAILED','数据库备份或恢复工具失败、超时或输出超过限制；未启用副本，不返回原始SQL或凭据。');return output;}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
 }finally{if(passFile&&fs.existsSync(passFile))fs.unlinkSync(passFile);}
}
