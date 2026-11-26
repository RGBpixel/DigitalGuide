import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {z} from 'zod';
import {aeMediaOrigin,aeMediaInput,type AeMediaJob,type AeMediaPlan} from '@digitalguide/contracts';
import {AppError,requirePermission,requireWorkspace,type Principal} from '@digitalguide/domain';
import type {Repository} from '@digitalguide/database';
import {aeOriginHash,assertAeMediaSource,type AeMediaRow} from '../../../packages/database/src/ae-media-origin.js';
import {ownedFile} from '../../../packages/media/src/files.js';
import {AeTemplates} from './ae-templates.js';
import type {Config} from './config.js';
const now=()=>new Date().toISOString();
export class AeMediaAdoptions {
 ae:AeTemplates;
 constructor(public repo:Repository,public config:Config){this.ae=new AeTemplates(repo,config);repo.aeCatalogHost=config;}
 scope(p:Principal,workspaceId:string,write=false){requireWorkspace(p,workspaceId);requirePermission(p,'asset.read');if(write){requirePermission(p,'asset.write');requirePermission(p,'studio.write');}}
 row(p:Principal,id:string){const r=this.repo.get<AeMediaRow>('SELECT * FROM ae_media_adoptions WHERE id=? AND tenant_id=? AND environment=? AND app_env=?',id,p.tenantId,this.config.providerMode,this.config.appEnv);if(!r)throw new AppError('NOT_FOUND','此空间/环境没有该AE采用记录。',404);this.scope(p,r.workspace_id);return r;}
 version(r:AeMediaRow,v:number){if(r.control_version!==v)throw new AppError('VERSION_CONFLICT','AE采用控制状态已变化，请刷新后重试。',409);}
 current(p:Principal,r:AeMediaRow){return assertAeMediaSource(this.repo,p,r);}
 capacity(p:Principal){if(this.repo.get<{n:number}>("SELECT count(*) n FROM ae_media_adoptions WHERE tenant_id=? AND environment=? AND app_env=? AND status IN ('queued','processing')",p.tenantId,this.config.providerMode,this.config.appEnv)!.n>=3)throw new AppError('AE_MEDIA_QUEUE_LIMIT','当前环境最多同时三项AE采用任务，请等待或取消已有任务。',429);}
 view(p:Principal,r:AeMediaRow):AeMediaJob {
  let reason:string|null=null;try{this.current(p,r);}catch(error){reason=error instanceof AppError?error.message:'AE来源暂时无法核对。';}
  const o=aeMediaOrigin.parse(JSON.parse(r.snapshot)),available=!reason&&r.status==='succeeded';
  return{id:r.id,artifactId:r.artifact_id,workspaceId:r.workspace_id,name:r.name,version:r.control_version,status:r.status,stage:r.stage,progress:r.progress,attempts:r.attempts,mode:o.mode,simulated:o.mode==='contract_test',available,unavailableReason:reason,assetId:r.asset_id,projectId:r.project_id,errorCode:r.error_code,errorMessage:r.error_message,expiresAt:r.expires_at,createdAt:r.created_at};
 }
 async prepare(p:Principal,artifactId:string,input:z.infer<typeof aeMediaInput>){
  const found=await this.ae.artifact(p,artifactId),{artifact:a,batch:b,job:j}=found;
  this.scope(p,b.workspace_id,true);this.ae.version(j,input.version);
  if(a.kind!=='video'||!['video/mp4','video/quicktime'].includes(a.media_type))throw new AppError('AE_MEDIA_FORMAT','仅已完成的MP4或透明MOV成片可以采用为媒体工程。',409);
  const source=await this.ae.source(p,b,true,undefined,false),values=await this.ae.parameters(p,b.workspace_id,source.entry.manifest,JSON.parse(j.parameters));
  const origin=aeMediaOrigin.parse({schemaVersion:1,batchId:b.id,jobId:j.id,artifactId:a.id,jobVersion:j.version,manifest:source.entry.manifest,manifestSHA256:b.manifest_sha256,runtimeId:b.runtime_id,mode:b.mode,parameters:values.parameters,sourceHash:j.source_hash,references:values.references,video:{sha256:a.sha256,size:a.size,mediaType:a.media_type}});
  const expiresAt=new Date(input.expiresAt).toISOString(),limit=[source.entry.manifest.license.expiresAt,...values.references.map(r=>r.expiresAt)].filter((v):v is string=>!!v).sort()[0];
  if(expiresAt<=now()||limit&&expiresAt>limit)throw new AppError('AE_MEDIA_RIGHTS','采用期限需要尚未到期'+(limit?'，且不晚于原模板及素材的最早授权期限 '+limit:'')+'。',409);
  const o=origin.manifest.output;
  if(o.width<320||o.height<320||o.width%2||o.height%2||o.fpsNumerator/o.fpsDenominator>60)throw new AppError('AE_MEDIA_STUDIO_LIMIT','此AE输出规格不能直接进入当前多轨工程：需要至少320像素、偶数尺寸及不超过60帧。原件仍可下载。',409);
  const plan:AeMediaPlan={hash:aeOriginHash({pipeline:'ae-media-adoption-v1',workspaceId:b.workspace_id,input,origin}),artifactId:a.id,workspaceId:b.workspace_id,name:input.name,templateName:origin.manifest.name,mode:b.mode,simulated:b.mode==='contract_test',width:o.width,height:o.height,durationMs:o.frameCount*1000*o.fpsDenominator/o.fpsNumerator,mediaType:origin.video.mediaType,sha256:a.sha256,size:a.size,expiresAt,warnings:[b.mode==='contract_test'?'原创契约测试成片，非Adobe渲染；进入工程后仍保留此来源标识。':'采用固定AE成片，不重新运行Adobe；真实画面质量仍须审阅。','新建独立媒体工程，可剪辑、加字幕和继续审核发布；成片中的AE图层已合成，不能还原AE图层或模型。','原结果保留；继承原模板、替换素材和本次用途，来源撤回或到期后派生工程、导出及分享会被阻止。',...(![24,25,30,60].includes(o.fpsNumerator/o.fpsDenominator)?['原片帧率为'+(o.fpsNumerator/o.fpsDenominator).toFixed(3)+'；新工程使用30帧时间线，原件不改写，可在工程中调整。']:[]),...(b.kind==='mov_alpha'?['保留透明MOV原件与透明工程画布；网页浅底代理不是透明交付。']:[])]};
  return{plan,origin,file:found.file};
 }
 create(p:Principal,input:z.infer<typeof aeMediaInput>,prepared:Awaited<ReturnType<AeMediaAdoptions['prepare']>>){
  const {origin,plan}=prepared;this.scope(p,plan.workspaceId,true);
  const existing=this.repo.get<AeMediaRow>('SELECT * FROM ae_media_adoptions WHERE artifact_id=?',plan.artifactId);
  if(existing){this.row(p,existing.id);this.current(p,existing);if(existing.plan_hash!==plan.hash)throw new AppError('AE_MEDIA_ALREADY_ADOPTED','该成片已有固定采用记录，请打开原记录；修改工程请另存版本，不能重复建立来源。',409);return existing.id;}
  this.capacity(p);
  const id=randomUUID(),at=now();
  this.repo.run('INSERT INTO ae_media_adoptions(id,tenant_id,workspace_id,actor_id,artifact_id,batch_id,job_id,name,rights_note,expires_at,snapshot,snapshot_hash,plan_hash,environment,app_env,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,p.tenantId,plan.workspaceId,p.userId,origin.artifactId,origin.batchId,origin.jobId,input.name,input.rightsNote,plan.expiresAt,JSON.stringify(origin),aeOriginHash(origin),plan.hash,this.config.providerMode,this.config.appEnv,at,at);
  this.current(p,this.row(p,id));return id;
 }
 file(r:AeMediaRow){const a=this.repo.get<{storage_key:string}>('SELECT storage_key FROM ae_render_artifacts WHERE id=?',r.artifact_id);if(!a)throw new AppError('AE_MEDIA_FILE_MISSING','原AE成片记录缺失，请核对原批次。',409);return ownedFile(path.resolve(this.config.dataDir,'objects'),a.storage_key);}
 cancel(p:Principal,r:AeMediaRow,v:number){this.scope(p,r.workspace_id,true);this.version(r,v);if(!['queued','processing'].includes(r.status))throw new AppError('STATE_CONFLICT','此任务已结束；已采用结果请使用撤回用途。',409);this.repo.run("UPDATE ae_media_adoptions SET status='cancelled',stage='finished',control_version=control_version+1,version=version+1,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?",now(),r.id);this.repo.run("UPDATE ae_media_attempts SET status='cancelled',finished_at=? WHERE adoption_id=? AND status='processing'",now(),r.id);}
 retry(p:Principal,r:AeMediaRow,v:number){this.scope(p,r.workspace_id,true);this.version(r,v);if(!['failed','cancelled'].includes(r.status)||r.attempts>=3||r.asset_id)throw new AppError('STATE_CONFLICT','只有未入库且不足三次尝试的失败/取消任务可明确重试。',409);this.current(p,r);this.capacity(p);this.repo.run("UPDATE ae_media_adoptions SET status='queued',stage='queued',progress=0,error_code=NULL,error_message=NULL,control_version=control_version+1,version=version+1,updated_at=? WHERE id=?",now(),r.id);}
 withdraw(p:Principal,r:AeMediaRow,v:number){this.scope(p,r.workspace_id,true);this.version(r,v);if(r.status==='withdrawn')return;this.repo.run("UPDATE ae_media_adoptions SET status='withdrawn',stage='finished',withdrawn_at=?,control_version=control_version+1,version=version+1,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?",now(),now(),r.id);this.repo.run("UPDATE ae_media_attempts SET status='withdrawn',finished_at=? WHERE adoption_id=? AND status='processing'",now(),r.id);}
}
