import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Repository} from '@digitalguide/database';
import {AppError} from '@digitalguide/domain';
import type {Config} from '../../api/src/config.js';
import {AeSourceExports,type AeSourceRow,type SourceAuthority} from '../../api/src/ae-source-exports.js';
import {writeAeSourcePackage,inspectAeSourcePackage} from '../../../packages/media/src/ae-source-package.js';
import {fileDigest,ownedFile} from '../../../packages/media/src/files.js';
export const aeSourceLeaseMs=30000;
const now=()=>new Date().toISOString();
export async function runAeSourceExport(repo:Repository,config:Config,stopSignal?:AbortSignal){
 if(stopSignal?.aborted)return false;const service=new AeSourceExports(repo,config),token=randomUUID();
 const row=repo.transaction(()=>{
  const at=now();for(const r of repo.all<AeSourceRow>("SELECT * FROM ae_source_exports WHERE environment=? AND app_env=? AND status='processing' AND lease_until<=? AND attempts>=3",config.providerMode,config.appEnv,at)){
   repo.run("UPDATE ae_source_exports SET status='failed',stage='finished',version=version+1,control_version=control_version+1,lease_token=NULL,lease_until=NULL,error_code='AE_SOURCE_RECOVERY_LIMIT',error_message='恢复次数已用完，请检查环境后新建导出。',updated_at=? WHERE id=?",at,r.id);
   repo.run("UPDATE ae_source_attempts SET status='interrupted',error_code='AE_SOURCE_RECOVERY_LIMIT',error_message='原租约中断且恢复次数已用完。',finished_at=? WHERE job_id=? AND status='processing'",at,r.id);
  }
  if(repo.get("SELECT id FROM ae_source_exports WHERE status='processing' AND lease_until>? LIMIT 1",at))return null;
  const r=repo.get<AeSourceRow>("SELECT * FROM ae_source_exports WHERE environment=? AND app_env=? AND (status='queued' OR (status='processing' AND lease_until<=? AND attempts<3)) ORDER BY created_at,id LIMIT 1",config.providerMode,config.appEnv,at);if(!r)return null;
  repo.run("UPDATE ae_source_attempts SET status='interrupted',error_code='AE_SOURCE_INTERRUPTED',error_message='原租约中断，使用独立目录恢复固定源包。',finished_at=? WHERE job_id=? AND status='processing'",at,r.id);
  repo.run("UPDATE ae_source_exports SET status='processing',stage='preparing',progress=0,attempts=attempts+1,version=version+1,lease_token=?,lease_until=?,error_code=NULL,error_message=NULL,updated_at=? WHERE id=?",token,new Date(Date.now()+aeSourceLeaseMs).toISOString(),at,r.id);
  repo.run('INSERT INTO ae_source_attempts(job_id,attempt,status,created_at) VALUES (?,?,?,?)',r.id,r.attempts+1,'processing',at);return repo.get<AeSourceRow>('SELECT * FROM ae_source_exports WHERE id=?',r.id)!;
 });if(!row)return false;
 const abort=new AbortController(),directory=ownedFile(path.resolve(config.dataDir,'ae-source-work'),row.id+'-'+token),zip=path.join(directory,'source.zip');let authority:SourceAuthority|undefined,failure:AppError|undefined,committed=false,object:string|undefined,lastHeartbeat=Date.now(),progress=-1;
 const stop=()=>abort.abort();stopSignal?.addEventListener('abort',stop,{once:true});if(stopSignal?.aborted)stop();
 function live(){const current=repo.get<AeSourceRow>('SELECT * FROM ae_source_exports WHERE id=?',row!.id);return current?.status==='processing'&&current.lease_token===token&&current.control_version===row!.control_version&&current.lease_until!>now();}
 function guard(){if(!live())throw new AppError('AE_SOURCE_LEASE_LOST','此导出已取消、撤回或租约失效，没有登记迟到结果。',409);service.owner(row!);if(authority)service.validateRow(row!,authority);abort.signal.throwIfAborted();}
 const timer=setInterval(()=>{try{guard();if(Date.now()-lastHeartbeat>=1000){repo.run("UPDATE ae_source_exports SET lease_until=? WHERE id=? AND lease_token=? AND status='processing'",new Date(Date.now()+aeSourceLeaseMs).toISOString(),row.id,token);lastHeartbeat=Date.now();}}catch(e){if(e instanceof AppError)failure=e;abort.abort();}},250);
 function update(stage:AeSourceRow['stage'],value:number){guard();const next=Math.min(99,Math.floor(value));if(progress===next&&repo.get<{stage:string}>('SELECT stage FROM ae_source_exports WHERE id=?',row!.id)?.stage===stage)return;progress=next;repo.run('UPDATE ae_source_exports SET stage=?,progress=?,version=version+1,updated_at=? WHERE id=? AND lease_token=?',stage,next,now(),row!.id,token);}
 try{
  const owner=service.owner(row);authority=await service.authority(owner,row);guard();fs.mkdirSync(directory,{recursive:true,mode:0o700});
  update('packing',1);await writeAeSourcePackage({bundle:service.bundle(row,authority),rawManifest:authority.rawManifest,directory:authority.directory,file:zip},abort.signal,p=>update('packing',1+p*54));
  update('verifying',55);await inspectAeSourcePackage(zip,abort.signal,p=>update('verifying',55+p*35));const actual=await fileDigest(zip,abort.signal);guard();
  const key=randomUUID()+'.zip';object=ownedFile(path.resolve(config.dataDir,'objects'),key);await fs.promises.copyFile(zip,object,fs.constants.COPYFILE_EXCL);const copied=await fileDigest(object,abort.signal);if(copied.sha256!==actual.sha256||copied.size!==actual.size)throw new AppError('AE_SOURCE_COPY_CHANGED','私有源文件包存储校验失败，请重试。',409);
  repo.transaction(()=>{guard();const at=now();repo.run("UPDATE ae_source_exports SET status='succeeded',stage='finished',progress=100,version=version+1,control_version=control_version+1,lease_token=NULL,lease_until=NULL,storage_key=?,size=?,sha256=?,updated_at=? WHERE id=? AND lease_token=?",key,actual.size,actual.sha256,at,row.id,token);repo.run("UPDATE ae_source_attempts SET status='succeeded',finished_at=? WHERE job_id=? AND attempt=? AND status='processing'",at,row.id,row.attempts);repo.audit(service.owner(row),row.workspace_id,'studio.ae.source.completed',row.id,'worker-ae-source');committed=true;});
 }catch(e){
  if(!stopSignal?.aborted&&live())repo.transaction(()=>{if(!live())return;const error=failure||(e instanceof AppError?e:new AppError('AE_SOURCE_EXPORT_FAILED','源文件打包失败，请核对固定工程文件、存储空间及授权后重试。',409)),at=now();repo.run("UPDATE ae_source_exports SET status='failed',stage='finished',version=version+1,control_version=control_version+1,lease_token=NULL,lease_until=NULL,error_code=?,error_message=?,updated_at=? WHERE id=? AND lease_token=?",error.code,error.message,at,row.id,token);repo.run("UPDATE ae_source_attempts SET status='failed',error_code=?,error_message=?,finished_at=? WHERE job_id=? AND attempt=? AND status='processing'",error.code,error.message,at,row.id,row.attempts);});
 }finally{
  clearInterval(timer);stopSignal?.removeEventListener('abort',stop);abort.abort();if(object&&!committed)await fs.promises.unlink(object).catch(()=>{});
  // Only this attempt's generated ZIP is removed; a killed process may leave its private work directory.
  await fs.promises.unlink(zip).catch(()=>{});
 }
 return true;
}
