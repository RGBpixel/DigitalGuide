import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Repository } from '@digitalguide/database';
import { AppError,requirePermission } from '@digitalguide/domain';
import type { Config } from '../../api/src/config.js';
import { PublishingService,type PublishRow,type PackageRow } from '../../api/src/publishing-service.js';
import { fileDigest,ownedFile } from '../../../packages/media/src/files.js';
import { writePublishingPackage } from '../../../packages/media/src/publishing-package.js';
const now=()=>new Date().toISOString(),until=()=>new Date(Date.now()+60000).toISOString();
export async function runPublishingJob(repo:Repository,config:Config,signal:AbortSignal=new AbortController().signal){
 const service=new PublishingService(repo,config),token=randomUUID();const row=repo.transaction(()=>{
  repo.run("UPDATE publishing_jobs SET status='reconciling',error_message='提交进程中断，远端结果需核对；不会自动重发。',lease_token=NULL,lease_until=NULL,version=version+1,updated_at=? WHERE environment=? AND app_env=? AND status='submitting' AND lease_until<?",now(),config.providerMode,config.appEnv,now());
  const r=repo.get<PublishRow>("SELECT * FROM publishing_jobs WHERE environment=? AND app_env=? AND status='scheduled' AND scheduled_at<=? ORDER BY scheduled_at,created_at LIMIT 1",config.providerMode,config.appEnv,now());if(!r||signal.aborted)return null;
  try{service.guard(repo.principal(r.actor_id),r);}catch(e){repo.run("UPDATE publishing_jobs SET status='stale',error_message=?,version=version+1,updated_at=? WHERE id=?",e instanceof AppError?e.message:'原发布人权限或来源无法核对，请重新建立计划。',now(),r.id);return null;}
  repo.run("UPDATE publishing_jobs SET status='submitting',lease_token=?,lease_until=?,version=version+1,updated_at=? WHERE id=?",token,until(),now(),r.id);return r;
 });if(!row)return false;
 let started=false;const heartbeat=setInterval(()=>repo.run("UPDATE publishing_jobs SET lease_until=? WHERE id=? AND lease_token=? AND status='submitting'",until(),row.id,token),10000);
 try{
  const m=service.guard(repo.principal(row.actor_id),row).material;
  for(const f of m.files){signal.throwIfAborted();const actual=await fileDigest(f.file,signal);if(actual.sha256!==f.sha256||actual.size!==f.size)throw new AppError('PUBLISH_FILE_CHANGED','视频、封面或字幕校验失败，请重新生成和审核。',409);}
  signal.throwIfAborted();const fresh=repo.transaction(()=>{const p=repo.principal(row.actor_id),r=service.job(p,row.id);if(r.lease_token!==token||r.status!=='submitting')throw new AppError('PUBLISH_LEASE_LOST','发布任务已由其他处理接管。',409);return service.guard(p,r);});
  started=true;const result=await service.provider().submit({jobId:row.id,creativeHash:row.creative_hash,accountId:fresh.account.id,accountVersion:fresh.account.version,scenario:fresh.account.scenario});
  repo.transaction(()=>{service.receipt(row,result,token);repo.audit({userId:row.actor_id,tenantId:row.tenant_id,workspaceIds:[row.workspace_id],role:'admin'},row.workspace_id,'publishing.mock_submission',row.id,token);});
 }catch(e){repo.transaction(()=>{repo.run("UPDATE publishing_jobs SET status=?,error_message=?,lease_token=NULL,lease_until=NULL,version=version+1,updated_at=? WHERE id=? AND lease_token=? AND status='submitting'",started?'reconciling':signal.aborted?'scheduled':'failed',started?'提交结果未知，请查询同一远端请求；不会自动重发。':signal.aborted?'本地工作进程已停止，重启后继续未提交排期。':e instanceof AppError?e.message:'视频或来源读取失败，请核对文件后重新建立计划。',now(),row.id,token);});}
 finally{clearInterval(heartbeat);}return true;
}
export async function runPublishingPackage(repo:Repository,config:Config,signal:AbortSignal=new AbortController().signal){
 const service=new PublishingService(repo,config),token=randomUUID(),row=repo.transaction(()=>{const r=repo.get<PackageRow>("SELECT * FROM publishing_packages WHERE environment=? AND app_env=? AND (status='queued' OR (status='building' AND lease_until<?)) ORDER BY created_at LIMIT 1",config.providerMode,config.appEnv,now());if(!r||signal.aborted)return null;repo.run("UPDATE publishing_packages SET status='building',lease_token=?,lease_until=?,version=version+1,updated_at=? WHERE id=?",token,until(),now(),r.id);return r;});if(!row)return false;
 const heartbeat=setInterval(()=>repo.run("UPDATE publishing_packages SET lease_until=? WHERE id=? AND lease_token=? AND status='building'",until(),row.id,token),10000);
 try{const p=repo.principal(row.actor_id);requirePermission(p,'studio.write');const reason=service.packageReason(p,row);if(reason)throw new AppError('PACKAGE_STALE',reason,409);const v=service.distribution.row(p,row.variant_id),m=service.distribution.released(p,v),key=randomUUID()+'.zip',file=ownedFile(path.join(config.dataDir,'objects'),key);
  await writePublishingPackage(m.files,{...m.metadata,creativeReviewId:m.reviewId,automaticPublication:false},file,signal);const actual=await fileDigest(file,signal);
  repo.transaction(()=>{const owner=repo.principal(row.actor_id);requirePermission(owner,'studio.write');const reason=service.packageReason(owner,row);if(reason)throw new AppError('PACKAGE_STALE',reason,409);repo.run("UPDATE publishing_packages SET status='ready',storage_key=?,size=?,sha256=?,error_message=NULL,lease_token=NULL,lease_until=NULL,version=version+1,updated_at=? WHERE id=? AND lease_token=? AND status='building'",key,actual.size,actual.sha256,now(),row.id,token);repo.audit(owner,v.workspace_id,'publishing.manual_package_ready',row.id,token);});
 }catch(e){repo.run("UPDATE publishing_packages SET status=?,error_message=?,lease_token=NULL,lease_until=NULL,version=version+1,updated_at=? WHERE id=? AND lease_token=? AND status='building'",signal.aborted?'queued':e instanceof AppError&&e.code==='PACKAGE_STALE'?'stale':'failed',signal.aborted?'发布包生成已停止，重启后继续。':e instanceof AppError?e.message:'发布包文件读取或保存失败，请检查本地存储后重试。',now(),row.id,token);}
 finally{clearInterval(heartbeat);}return true;
}
