import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {DatabaseSync,backup} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {RecoveryError,recoveryLockPath,recoveryPolicyFile,recoveryEntryExists} from './guard.js';
import {dataRoot,assertNoLinks,checkCancelled,copyChecked,hashFile,inventory,limits,removeOwnedTree,within,type RecoveryLimits} from './files.js';
import {decryptArchive,encryptArchive,inspectZip,readRecoveryKey} from './codec.js';
import {validateManifest,type RecoveryManifest} from './manifest.js';
import {snapshot,openSnapshot} from './snapshot.js';
export {RecoveryError} from './guard.js';
export {operation as withRecoveryOperation};

export interface RecoveryOptions {keyFile:string;root?:string;limits?:Partial<RecoveryLimits>;signal?:AbortSignal;onPhase?:(event:{operationId:string;phase:string})=>void}
type LockState={version:1;operationId:string;pid:number;kind:'backup'|'verify'|'restore';resource:string;phase:string;startedAt:string;encryptedPartial?:string};
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b),keyOf=(value:string)=>createHash('sha256').update(value).digest('hex');
function writePrivateJSON(file:string,value:unknown){const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function readLock(lock:string):LockState{
  assertNoLinks(lock);const file=path.join(lock,'state.json'),stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16_384)throw new RecoveryError('RECOVERY_LOCK_INVALID','运维锁损坏，请保留现场并由主机管理员检查。');
  const state=JSON.parse(fs.readFileSync(file,'utf8')) as LockState;
  if(state.version!==1||!Number.isSafeInteger(state.pid)||state.pid<1||!/^[a-f0-9-]{36}$/.test(state.operationId)||!['backup','verify','restore'].includes(state.kind)||typeof state.resource!=='string'||path.resolve(recoveryLockPath(state.resource))!==path.resolve(lock))throw new RecoveryError('RECOVERY_LOCK_INVALID','运维锁内容与当前资源不符，请保留现场。');return state;
}
function alive(pid:number){try{process.kill(pid,0);return true;}catch(e){return !(e instanceof Error&&'code'in e&&e.code==='ESRCH');}}
function cleanupEncryptedPartial(state:LockState){
  if(state.encryptedPartial===undefined)return;
  if(typeof state.encryptedPartial!=='string'||state.kind!=='backup')throw new RecoveryError('RECOVERY_LOCK_INVALID','临时密文记录与备份操作不符，保留现场。');
  const file=path.resolve(state.encryptedPartial),name=path.basename(file);if(!name.startsWith('.')||!name.endsWith('.partial-'+state.operationId)||within(file,state.resource))throw new RecoveryError('RECOVERY_LOCK_INVALID','临时密文路径与本操作编号不符，不会删除该文件。');
  assertNoLinks(file,true);if(recoveryEntryExists(file)){if(!fs.lstatSync(file).isFile())throw new RecoveryError('RECOVERY_LOCK_INVALID','临时密文不是普通文件，保留现场。');fs.unlinkSync(file);}
}
function coordinate<T>(resource:string,work:()=>T):T{
  const file=recoveryLockPath(resource)+'.coord.sqlite';assertNoLinks(file,true);const db=new DatabaseSync(file);
  try{db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE;');const result=work();db.exec('COMMIT');return result;}catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e;}finally{db.close();}
}
async function operation<T>(resource:string,kind:LockState['kind'],options:Pick<RecoveryOptions,'signal'|'onPhase'>,work:(lock:string,phase:(phase:string,extra?:{encryptedPartial:string})=>void)=>Promise<T>):Promise<T>{
  assertNoLinks(path.dirname(resource));const lock=recoveryLockPath(resource),state:LockState={version:1,operationId:randomUUID(),pid:process.pid,kind,resource,phase:'locked',startedAt:new Date().toISOString()};
  coordinate(resource,()=>{try{fs.mkdirSync(lock,{mode:0o700});}catch(e){if(e instanceof Error&&'code'in e&&e.code==='EEXIST')throw new RecoveryError('RECOVERY_MAINTENANCE','此资源已有备份、验证或恢复操作。请先检查运维锁，不能覆盖或并行执行。');throw e;}writePrivateJSON(path.join(lock,'state.json'),state);});
  const phase=(value:string,extra?:{encryptedPartial:string})=>{checkCancelled(options.signal);state.phase=value;Object.assign(state,extra);const next=path.join(lock,'state-'+randomUUID()+'.tmp');writePrivateJSON(next,state);fs.renameSync(next,path.join(lock,'state.json'));options.onPhase?.({operationId:state.operationId,phase:value});};
  let outcome:{ok:true;value:T}|{ok:false;error:unknown};
  try{phase('locked');outcome={ok:true,value:await work(lock,phase)};}catch(error){outcome={ok:false,error};}
  try{
    // Remove only this exact owned lock tree; a hard process kill intentionally leaves it for explicit inspection.
    if(fs.existsSync(lock)){const owner=readLock(lock);if(owner.operationId!==state.operationId)throw new RecoveryError('RECOVERY_LOCK_CHANGED','运维锁所有者变化，保留临时文件供检查。');if(kind==='restore'&&state.phase==='publishing'&&fs.existsSync(resource)&&!fs.existsSync(path.join(resource,recoveryPolicyFile)))throw new RecoveryError('RECOVERY_PUBLICATION_INCOMPLETE','恢复发布中断且缺少隔离标记，保留运维锁。请先移开不完整目录再检查锁。');cleanupEncryptedPartial(owner);removeOwnedTree(lock,path.dirname(lock),'.digitalguide-recovery-');}
  }catch(error){if(outcome.ok)throw error;throw new RecoveryError('RECOVERY_CLEANUP_FAILED','操作失败且临时文件清理未完成，请检查运维锁并保留现场；不会自动启用恢复数据。');}
  if(!outcome.ok)throw outcome.error;return outcome.value;
}
function privateKeyOutside(keyFile:string,dir:string){const full=path.resolve(keyFile);assertNoLinks(full);if(within(full,dir))throw new RecoveryError('RECOVERY_KEY_LOCATION','备份密钥必须保存在源数据目录之外，不能随本次数据一起打包。');return full;}
function report(m:RecoveryManifest,archive:{archiveSHA256:string;archiveBytes:number}){return{result:'PASS' as const,backupId:m.backupId,format:m.format,...archive,fileCount:m.files.length,directoryCount:m.directories.length,tableCount:m.database.tables.length,rows:m.database.rows,latestMigration:m.database.migrations.at(-1)!.name,activation:'isolated-validation-only' as const,productionRecoveryAccepted:false};}
function verifyDatabase(data:string,m:RecoveryManifest,root:string,cap:RecoveryLimits){
  const actual=openSnapshot(path.join(data,'digitalguide.sqlite'),root,cap);if(!equal(actual,m.database))throw new RecoveryError('RECOVERY_DATABASE_CHANGED','数据库表、行摘要、结构或迁移文件与原备份不符。');
  for(const name of ['digitalguide.sqlite-wal','digitalguide.sqlite-shm']){const sidecar=path.join(data,name);if(fs.existsSync(sidecar))fs.unlinkSync(sidecar);}
}
export async function createRecoveryBackup(input:RecoveryOptions&{dataDir:string;output:string}){
  const source=dataRoot(input.dataDir,true),output=path.resolve(input.output),cap=limits(input.limits),root=path.resolve(input.root||process.cwd()),keyFile=privateKeyOutside(input.keyFile,source);
  if(within(output,source))throw new RecoveryError('RECOVERY_OUTPUT_LOCATION','加密备份必须写到源数据目录之外。');assertNoLinks(output,true);if(fs.existsSync(output))throw new RecoveryError('RECOVERY_OUTPUT_EXISTS','输出备份已存在，请使用新文件名，不能覆盖既有备份。');fs.mkdirSync(path.dirname(output),{recursive:true,mode:0o700});
  const key=readRecoveryKey(keyFile);let partial:string|undefined;
  try{return await operation(source,'backup',input,async(lock,phase)=>{
    const database=path.join(source,'digitalguide.sqlite');assertNoLinks(database);for(const aux of ['digitalguide.sqlite-wal','digitalguide.sqlite-shm'])if(fs.existsSync(path.join(source,aux)))assertNoLinks(path.join(source,aux));const db=new DatabaseSync(database,{readOnly:false});
    try{
      try{db.exec('PRAGMA busy_timeout=500; PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT;');}catch{throw new RecoveryError('RECOVERY_SOURCE_BUSY','数据目录仍被进程使用。请停止该目录的API、worker及其他数据库连接后重试，不会在线强制停机。');}
      phase('database_snapshot');const sourceSnapshot=snapshot(db,root,cap),databaseCopy=path.join(lock,'snapshot.sqlite');await backup(db,databaseCopy);if(!equal(openSnapshot(databaseCopy,root,cap),sourceSnapshot))throw new RecoveryError('RECOVERY_DATABASE_CHANGED','独立数据库快照与原数据库不一致。');
      const before=inventory(source,cap),data=path.join(lock,'data');fs.mkdirSync(data,{mode:0o700});for(const dir of before.directories)fs.mkdirSync(path.join(data,...dir.split('/')),{recursive:true,mode:0o700});const files:RecoveryManifest['files']=[];phase('private_files_snapshot');
      for(const f of before.files){checkCancelled(input.signal);const target=path.join(data,...f.relative.split('/'));if(f.relative==='digitalguide.sqlite'){fs.copyFileSync(databaseCopy,target,fs.constants.COPYFILE_EXCL);files.push({path:f.relative,bytes:fs.statSync(target).size,sha256:await hashFile(target,input.signal)});}else files.push(await copyChecked(f,target,input.signal));}
      const manifest=validateManifest({version:1,format:'sqlite-full-data-dir-v1',backupId:randomUUID(),createdAt:new Date().toISOString(),dataRoot:source,files,directories:before.directories,database:sourceSnapshot,activation:'isolated-validation-only'},cap);verifyDatabase(data,manifest,root,cap);
      partial=path.join(path.dirname(output),'.'+path.basename(output)+'.partial-'+readLock(lock).operationId);phase('encrypting',{encryptedPartial:partial});await encryptArchive(manifest,data,partial,key,input.signal);
      const after=inventory(source,cap);if(!equal(before.directories,after.directories)||!equal(before.files.filter(f=>f.relative!=='digitalguide.sqlite'),after.files.filter(f=>f.relative!=='digitalguide.sqlite')))throw new RecoveryError('RECOVERY_SOURCE_CHANGED','备份期间文件清单或元数据变化，请停止写入后重试。');
      for(const f of after.files.filter(f=>f.relative!=='digitalguide.sqlite'))if(await hashFile(f.absolute,input.signal)!==files.find(x=>x.path===f.relative)!.sha256)throw new RecoveryError('RECOVERY_SOURCE_CHANGED','备份期间原文件内容变化，未发布备份。');
      phase('validating_encrypted_copy');const validated=path.join(lock,'validated.zip'),archive=await decryptArchive(partial,validated,key,cap,input.signal),checked=path.join(lock,'checked');fs.mkdirSync(checked,{mode:0o700});const decoded=await inspectZip(validated,checked,cap,false,input.signal);if(!equal(decoded,manifest))throw new RecoveryError('RECOVERY_MANIFEST_INVALID','写入的加密备份回读不一致。');verifyDatabase(checked,decoded,root,cap);phase('publishing');
      // A same-directory hard link publishes the complete ciphertext without replacing another writer's file.
      try{fs.linkSync(partial,output);}catch(e){if(e instanceof Error&&'code'in e&&e.code==='EEXIST')throw new RecoveryError('RECOVERY_OUTPUT_EXISTS','输出被其他操作创建，保留既有文件，请使用新备份名。');throw e;}fs.unlinkSync(partial);partial=undefined;return report(manifest,archive);
    }finally{db.close();}
  });}finally{key.fill(0);if(partial&&fs.existsSync(partial)){assertNoLinks(partial);fs.unlinkSync(partial);}}
}
export interface ArchiveOptions extends RecoveryOptions {archive:string;workDir?:string}
function verifyResource(archive:string,workDir?:string){const dir=path.resolve(workDir||os.tmpdir());assertNoLinks(dir);if(!fs.statSync(dir).isDirectory())throw new RecoveryError('RECOVERY_WORKSPACE_INVALID','验证工作目录不存在。');return path.join(dir,'.verify-'+keyOf(path.resolve(archive)).slice(0,24));}
export async function verifyRecoveryBackup(input:ArchiveOptions){
  const archive=path.resolve(input.archive),cap=limits(input.limits),root=path.resolve(input.root||process.cwd()),key=readRecoveryKey(input.keyFile);
  try{return await operation(verifyResource(archive,input.workDir),'verify',input,async(lock,phase)=>{phase('authenticating');const zip=path.join(lock,'archive.zip'),info=await decryptArchive(archive,zip,key,cap,input.signal),data=path.join(lock,'data');fs.mkdirSync(data,{mode:0o700});phase('validating');const manifest=await inspectZip(zip,data,cap,false,input.signal);verifyDatabase(data,manifest,root,cap);return report(manifest,info);});}finally{key.fill(0);}
}
export async function restoreRecoveryBackup(input:ArchiveOptions&{dataDir:string;confirmed:boolean}){
  if(!input.confirmed)throw new RecoveryError('RECOVERY_CONFIRMATION_REQUIRED','恢复需要明确确认；只会发布到原绝对路径的空缺位置，并保持隔离。');
  const target=dataRoot(input.dataDir,false),archive=path.resolve(input.archive),root=path.resolve(input.root||process.cwd()),cap=limits(input.limits);if(fs.existsSync(target))throw new RecoveryError('RECOVERY_TARGET_EXISTS','恢复目标必须不存在，不能覆盖、合并或删除现有数据目录。');privateKeyOutside(input.keyFile,target);const key=readRecoveryKey(input.keyFile);
  try{return await operation(target,'restore',input,async(lock,phase)=>{phase('authenticating');const zip=path.join(lock,'archive.zip'),info=await decryptArchive(archive,zip,key,cap,input.signal),data=path.join(lock,'data');fs.mkdirSync(data,{mode:0o700});phase('validating');const manifest=await inspectZip(zip,data,cap,true,input.signal);
    const sameRoot=process.platform==='win32'?manifest.dataRoot.toLowerCase()===target.toLowerCase():manifest.dataRoot===target;if(!sameRoot)throw new RecoveryError('RECOVERY_ROOT_MISMATCH','此版本保留绝对文件引用，须恢复到备份中的原绝对DATA_DIR。跨目录迁移需后续迁移工具，不能直接改路径。');
    verifyDatabase(data,manifest,root,cap);const policy={version:1,backupId:manifest.backupId,archiveSHA256:info.archiveSHA256,restoredAt:new Date().toISOString(),activation:'isolated-validation-only',productionActivation:'pending-business-reconciliation'};writePrivateJSON(path.join(data,recoveryPolicyFile),{...policy,complete:false});phase('publishing');
    // mkdir is an exclusive claim even on systems where rename can replace an empty directory.
    try{fs.mkdirSync(target,{mode:0o700});}catch(e){if(e instanceof Error&&'code'in e&&e.code==='EEXIST'){phase('publication_refused');throw new RecoveryError('RECOVERY_TARGET_EXISTS','恢复期间目标被创建，保留现有目录且停止发布。');}throw e;}
    fs.renameSync(path.join(data,recoveryPolicyFile),path.join(target,recoveryPolicyFile));
    for(const entry of fs.readdirSync(data))fs.renameSync(path.join(data,entry),path.join(target,entry));
    const next=path.join(target,'.recovery-policy-'+randomUUID()+'.tmp');writePrivateJSON(next,{...policy,complete:true});fs.renameSync(next,path.join(target,recoveryPolicyFile));return{...report(manifest,info),workerEnabled:false,liveActionsEnabled:false};
  });}finally{key.fill(0);}
}
export function inspectRecoveryLock(input:{dataDir?:string;archive?:string;workDir?:string}){
  const resource=input.dataDir?path.resolve(input.dataDir):input.archive?verifyResource(input.archive,input.workDir):'';if(!resource)throw new RecoveryError('RECOVERY_ARGUMENT_INVALID','请选择数据目录或备份文件。');const lock=recoveryLockPath(resource);if(!recoveryEntryExists(lock))return{locked:false as const};const state=readLock(lock);return{locked:true as const,operationId:state.operationId,pid:state.pid,kind:state.kind,phase:state.phase,ownerAlive:alive(state.pid)};
}
export function unlockRecovery(input:{dataDir?:string;archive?:string;workDir?:string;operationId:string}){
  const resource=input.dataDir?path.resolve(input.dataDir):input.archive?verifyResource(input.archive,input.workDir):'';if(!resource)throw new RecoveryError('RECOVERY_ARGUMENT_INVALID','请选择数据目录或备份文件。');
  const lock=recoveryLockPath(resource),claimed=lock+'.cleanup-'+randomUUID();const state=coordinate(resource,()=>{
    const current=inspectRecoveryLock(input);if(!current.locked)throw new RecoveryError('RECOVERY_LOCK_MISSING','没有待清理运维锁。');if(current.operationId!==input.operationId)throw new RecoveryError('RECOVERY_LOCK_CHANGED','操作编号不符，请重新检查当前锁。');if(current.ownerAlive)throw new RecoveryError('RECOVERY_OWNER_ALIVE','原操作进程仍在运行，不能清理其锁或临时文件。');const owner=readLock(lock);
    if(owner.kind==='restore'&&owner.phase==='publishing'&&fs.existsSync(resource)&&!fs.existsSync(path.join(resource,recoveryPolicyFile)))throw new RecoveryError('RECOVERY_PUBLICATION_INCOMPLETE','不完整恢复目录缺少隔离标记。请先移开该目录，不能直接解除启动保护。');
    cleanupEncryptedPartial(owner);fs.renameSync(lock,claimed);return current;
  });removeOwnedTree(claimed,path.dirname(claimed),'.digitalguide-recovery-');return{result:'PASS',operationId:state.operationId,removedOnlyDeadOwnerTemporaryFiles:true,existingDataOrPublishedBackupRemoved:false,recoveryIsolationReleased:false};
}
