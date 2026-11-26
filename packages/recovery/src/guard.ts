import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

export const recoveryPolicyFile='.dg-recovery-policy.json';
export class RecoveryError extends Error {
  constructor(public code:string,message:string){super(message);this.name='RecoveryError';}
}
export function recoveryLockPath(dataDir:string){
  const resolved=path.resolve(dataDir),key=createHash('sha256').update(process.platform==='win32'?resolved.toLowerCase():resolved).digest('hex').slice(0,24);
  return path.join(path.dirname(resolved),'.digitalguide-recovery-'+key+'.lock');
}
export function recoveryEntryExists(file:string){try{fs.lstatSync(file);return true;}catch(e){if(e instanceof Error&&'code'in e&&e.code==='ENOENT')return false;throw e;}}
export function assertRecoveryAccess(dataDir:string,mode?:{appEnv?:string;environment?:string;recoveryValidationOnly?:boolean}){
  const lock=recoveryLockPath(dataDir);
  if(recoveryEntryExists(lock))throw new RecoveryError('RECOVERY_MAINTENANCE','数据目录正在备份或恢复，或上次操作未清理。请先检查运维锁；不要启动新的服务进程。');
  const file=path.join(dataDir,recoveryPolicyFile);
  if(!recoveryEntryExists(file))return;
  let valid=false;
  try{const stat=fs.lstatSync(file);if(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=8192){const policy=JSON.parse(fs.readFileSync(file,'utf8'));valid=policy.version===1&&policy.complete===true&&policy.activation==='isolated-validation-only'&&typeof policy.backupId==='string'&&/^[a-f0-9]{64}$/.test(policy.archiveSHA256);}}catch{/* Damaged recovery policy always keeps the instance closed. */}
  if(!valid)throw new RecoveryError('RECOVERY_POLICY_INVALID','恢复隔离标记损坏或类型不符。请核对原加密备份，不能直接启用服务。');
  if(!mode?.recoveryValidationOnly||!['development','sandbox'].includes(mode.appEnv||'')||mode.environment!=='mock')throw new RecoveryError('RECOVERY_ISOLATED','这是尚未完成业务核对的恢复副本。仅可显式启用 RECOVERY_VALIDATION_ONLY=1、development/sandbox 和 mock 进行隔离验证；正式恢复启用仍待验收。');
}
export function assertRecoveryWorkerDisabled(dataDir:string){
  if(recoveryEntryExists(path.join(dataDir,recoveryPolicyFile)))throw new RecoveryError('RECOVERY_WORKER_DISABLED','恢复副本的worker保持关闭，防止历史任务重复执行。正式启用需要完成业务核对。');
}
export function recoveryReadAllowed(method:string,pathname:string){
  if(method==='POST'&&['/api/v1/auth/login','/api/v1/auth/logout'].includes(pathname))return true;
  return ['GET','HEAD'].includes(method)&&/^\/api\/v1\/(?:health|readiness|auth\/demo-accounts|me|workspaces|assets(?:\/[a-f0-9-]{36}(?:\/content)?)?|profiles(?:\/[a-f0-9-]{36})?|jobs(?:\/[a-f0-9-]{36})?)$/.test(pathname);
}
