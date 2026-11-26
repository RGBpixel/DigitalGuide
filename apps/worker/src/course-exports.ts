import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Repository} from '@digitalguide/database';
import {AppError} from '@digitalguide/domain';
import type {Config} from '../../api/src/config.js';
import {Courses,type CourseExportRow} from '../../api/src/courses.js';
import {createCoursePackage} from '../../../packages/media/src/course-package.js';
import {fileDigest,ownedFile} from '../../../packages/media/src/files.js';
const now=()=>new Date().toISOString();
export async function runCourseExport(repo:Repository,config:Config,stopSignal?:AbortSignal){
 if(stopSignal?.aborted)return false;const s=new Courses(repo,config),token=randomUUID();let jobId:string|null=null;
 repo.transaction(()=>{
  for(const r of repo.all<CourseExportRow>("SELECT * FROM studio_course_exports WHERE environment=? AND app_env=? AND status='packaging' AND lease_until<?",config.providerMode,config.appEnv,now()))repo.run('UPDATE studio_course_exports SET status=?,lease_token=NULL,lease_until=NULL,error_message=?,updated_at=? WHERE id=?',r.attempts>=3?'failed':'queued',r.attempts>=3?'课程包处理已达三次上限，请核对后新建导出。':'进程中断，等待恢复同一课程导出。',now(),r.id);
  for(const r of repo.all<CourseExportRow>("SELECT * FROM studio_course_exports WHERE environment=? AND app_env=? AND status='queued' ORDER BY created_at,id LIMIT 20",config.providerMode,config.appEnv)){
   try{s.exportCurrent(s.workerPrincipal(r),r);}catch(e){repo.run("UPDATE studio_course_exports SET status='failed',error_message=?,updated_at=? WHERE id=?",e instanceof AppError?e.message:'原发起人权限或课程来源已变化。',now(),r.id);continue;}
   if(r.attempts>=3){repo.run("UPDATE studio_course_exports SET status='failed',error_message=?,updated_at=? WHERE id=?",'课程包处理已达三次上限。',now(),r.id);continue;}jobId=r.id;repo.run("UPDATE studio_course_exports SET status='packaging',attempts=attempts+1,progress=0,lease_token=?,lease_until=?,error_message=NULL,updated_at=? WHERE id=?",token,new Date(Date.now()+45000).toISOString(),now(),r.id);break;
  }
 });if(!jobId)return false;
 const parent=path.resolve(config.dataDir,'course-packages'),directory=path.join(parent,randomUUID()),objects=path.resolve(config.dataDir,'objects'),abort=new AbortController();let written:string|null=null,committed=false,progress=0;
 const current=()=>{const r=repo.get<CourseExportRow>('SELECT * FROM studio_course_exports WHERE id=?',jobId!);if(!r||r.status!=='packaging'||r.lease_token!==token||!r.lease_until||r.lease_until<=now())throw new AppError('COURSE_EXPORT_LEASE_LOST','课程包任务已取消或被其他进程接手，迟到文件不会登记。',409);const p=s.workerPrincipal(r);return{r,p,...s.exportCurrent(p,r)};},stop=()=>abort.abort();stopSignal?.addEventListener('abort',stop,{once:true});if(stopSignal?.aborted)stop();
 const heartbeat=setInterval(()=>{try{repo.transaction(()=>{current();repo.run('UPDATE studio_course_exports SET lease_until=?,progress=?,updated_at=? WHERE id=? AND lease_token=?',new Date(Date.now()+45000).toISOString(),progress,now(),jobId!,token);});}catch{abort.abort();}},1000);
 try{
  const {r,release,s:snapshot,media}=current();await fs.mkdir(directory,{recursive:true});const destination=path.join(directory,'course.zip'),output=await createCoursePackage({root:config.root,directory,destination,name:release.name,releaseHash:release.release_hash,standard:r.standard,definition:snapshot.definition,media,signal:abort.signal,onProgress:value=>{progress=value;}});
  for(const m of media){const actual=await fileDigest(m.file,abort.signal);if(actual.sha256!==m.snapshot.sha256||actual.size!==m.snapshot.size)throw new AppError('COURSE_EXPORT_SOURCE_CHANGED','打包期间原素材字节变化，迟到结果未登记。',409);}current();const key=randomUUID()+'.zip',target=ownedFile(objects,key);await fs.copyFile(destination,target,fs.constants.COPYFILE_EXCL);written=target;const saved=await fileDigest(target,abort.signal);if(saved.sha256!==output.sha256||saved.size!==output.size)throw new AppError('COURSE_EXPORT_BYTES','课程包保存字节校验失败。',409);
  repo.transaction(()=>{current();repo.run("UPDATE studio_course_exports SET status='succeeded',progress=100,storage_key=?,size=?,sha256=?,lease_token=NULL,lease_until=NULL,error_message=NULL,updated_at=? WHERE id=? AND lease_token=?",key,output.size,output.sha256,now(),jobId!,token);committed=true;});
 }catch(error){repo.transaction(()=>{const r=repo.get<CourseExportRow>('SELECT * FROM studio_course_exports WHERE id=?',jobId!);if(!r||r.lease_token!==token||!r.lease_until||r.lease_until<=now())return;let reason:string|null=null;try{s.exportCurrent(s.workerPrincipal(r),r);}catch(e){reason=e instanceof AppError?e.message:'课程或原发起人权限已变化。';}const interrupted=stopSignal?.aborted;repo.run('UPDATE studio_course_exports SET status=?,lease_token=NULL,lease_until=NULL,error_message=?,updated_at=? WHERE id=?',interrupted&&!reason&&r.attempts<3?'queued':'failed',reason||(interrupted?'服务停止，保留同一课程任务等待恢复。':error instanceof AppError?error.message:'课程包处理失败，请核对源文件后重新导出。'),now(),r.id);});
 }finally{clearInterval(heartbeat);stopSignal?.removeEventListener('abort',stop);if(written&&!committed)await fs.unlink(written).catch(()=>{});if(path.dirname(directory)===parent&&directory.startsWith(parent+path.sep))await fs.rm(directory,{recursive:true,force:true}).catch(()=>{});}return true;
}
