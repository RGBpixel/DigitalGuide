import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {aeMediaOrigin,aeManifest,aeRuntimeConfig,type AeMediaOrigin} from '@digitalguide/contracts';
import {AppError,assertUsableAsset,canonical,requireWorkspace,type Principal} from '@digitalguide/domain';
import type {Repository} from './index.js';
export const aeOriginHash=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
export interface AeMediaRow {
 id:string;tenant_id:string;workspace_id:string;actor_id:string;artifact_id:string;batch_id:string;job_id:string;
 name:string;rights_note:string;expires_at:string;snapshot:string;snapshot_hash:string;plan_hash:string;environment:string;app_env:string;
 status:'queued'|'processing'|'succeeded'|'failed'|'cancelled'|'withdrawn';stage:'queued'|'copying'|'inspecting'|'committing'|'finished';
 version:number;control_version:number;progress:number;attempts:number;lease_token:string|null;lease_until:string|null;
 asset_id:string|null;project_id:string|null;inspection_runtime:string|null;error_code:string|null;error_message:string|null;withdrawn_at:string|null;created_at:string;updated_at:string;
}
function unavailable(message:string):never {throw new AppError('AE_MEDIA_SOURCE_UNAVAILABLE',message,409);}
// Synchronous and deliberately small: Repository.asset is also used in transactions and workers.
// It checks current catalog grants and the small manifest, without loading an AE executable or hashing large binaries.
export function assertAeCatalog(repo:Repository,p:Principal,workspaceId:string,origin:AeMediaOrigin){
 const host=repo.aeCatalogHost;
 if(!host?.aeConfigFile||!path.isAbsolute(host.aeConfigFile))unavailable('AE来源目录未配置，请管理员恢复原授权目录；不会退回普通素材。');
 try {
  const file=host.aeConfigFile;
  if(fs.lstatSync(file).isSymbolicLink()||!fs.statSync(file).isFile()||fs.statSync(file).size>1048576)unavailable('AE来源配置文件不可用。');
  const runtime=aeRuntimeConfig.parse(JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')));
  if(runtime.mode==='contract_test'&&(p.appEnv==='production'||p.environment==='live'))unavailable('契约AE来源不能进入真实运行环境。');
  const refs=runtime.catalog.filter(c=>c.tenantId===p.tenantId&&c.workspaceId===workspaceId&&c.environment===p.environment&&c.appEnv===p.appEnv&&c.catalogId===origin.manifest.catalogId&&c.catalogRevision===origin.manifest.revision);
  if(refs.length!==1)unavailable('原AE工程修订的当前空间/环境授权已撤销或重复，请管理员核对。');
  const ref=refs[0];
  if(ref.manifestSHA256!==origin.manifestSHA256||!path.isAbsolute(ref.directory)||fs.lstatSync(ref.directory).isSymbolicLink()||!fs.statSync(ref.directory).isDirectory())unavailable('原AE工程目录或清单授权已变化。');
  let current=ref.directory;
  for(const part of ref.manifestFile.split('/')){current=path.join(current,part);if(fs.lstatSync(current).isSymbolicLink())unavailable('AE来源清单不允许链接或联接点。');}
  if(!fs.statSync(current).isFile()||fs.statSync(current).size>1048576)unavailable('AE来源清单不可用。');
  const bytes=fs.readFileSync(current),manifest=aeManifest.parse(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')));
  if(createHash('sha256').update(bytes).digest('hex')!==origin.manifestSHA256||canonical(manifest)!==canonical(origin.manifest))unavailable('原AE清单内容或摘要已变化，请重新核对原工程。');
 }catch(error){if(error instanceof AppError)throw error;unavailable('原AE授权配置或清单无法核对，请管理员恢复当前授权。');}
}
export function assertAeMediaSource(repo:Repository,p:Principal,r:AeMediaRow,seen=new Set<string>()){
 if(r.tenant_id!==p.tenantId)unavailable('AE采用来源不在当前组织。');
 requireWorkspace(p,r.workspace_id);repo.environment(p,r.environment,r.app_env);
 if(!p.environment||!p.appEnv)unavailable('AE采用来源需要明确的运行环境。');
 const origin=aeMediaOrigin.parse(JSON.parse(r.snapshot)),at=new Date().toISOString();
 if(r.withdrawn_at||r.status==='withdrawn'||r.expires_at<=at||origin.manifest.license.expiresAt&&origin.manifest.license.expiresAt<=at||aeOriginHash(origin)!==r.snapshot_hash)unavailable('AE采用用途已撤回、到期或固定来源无效。');
 if(origin.artifactId!==r.artifact_id||origin.jobId!==r.job_id||origin.batchId!==r.batch_id)unavailable('AE采用来源编号不一致。');
 const b=repo.get<{tenant_id:string;workspace_id:string;environment:string;app_env:string;manifest:string;manifest_sha256:string;runtime_id:string;mode:string}>('SELECT * FROM ae_batches WHERE id=?',r.batch_id);
 const j=repo.get<{batch_id:string;version:number;status:string;parameters:string;source_hash:string}>('SELECT * FROM ae_render_jobs WHERE id=?',r.job_id);
 const a=repo.get<{job_id:string;kind:string;sha256:string;size:number;media_type:string}>('SELECT * FROM ae_render_artifacts WHERE id=?',r.artifact_id);
 if(!b||b.tenant_id!==r.tenant_id||b.workspace_id!==r.workspace_id||b.environment!==r.environment||b.app_env!==r.app_env||b.manifest_sha256!==origin.manifestSHA256||canonical(JSON.parse(b.manifest))!==canonical(origin.manifest)||b.runtime_id!==origin.runtimeId||b.mode!==origin.mode||!j||j.batch_id!==r.batch_id||j.status!=='succeeded'||j.version!==origin.jobVersion||j.source_hash!==origin.sourceHash||canonical(JSON.parse(j.parameters))!==canonical(origin.parameters)||!a||a.job_id!==r.job_id||a.kind!=='video'||a.sha256!==origin.video.sha256||a.size!==origin.video.size||a.media_type!==origin.video.mediaType)unavailable('原AE结果、参数或固定版本已变化，派生工程不可继续使用。');
 assertAeCatalog(repo,p,r.workspace_id,origin);
 const keys=origin.manifest.parameters.filter(c=>c.kind==='asset'&&origin.parameters[c.key]!==null).map(c=>c.key);
 if(new Set(origin.references.map(v=>v.key)).size!==origin.references.length||canonical(keys)!==canonical(origin.references.map(v=>v.key)))unavailable('AE替换素材的来源清单无效。');
 for(const ref of origin.references){
  const asset=repo.asset(p,ref.id,seen);assertUsableAsset(asset);
  const control=origin.manifest.parameters.find(c=>c.key===ref.key);
  if(control?.kind!=='asset'||asset.workspaceId!==r.workspace_id||origin.parameters[ref.key]!==asset.id||asset.mediaType!==control.mediaType||asset.version!==ref.version||asset.sha256!==ref.sha256||asset.size!==ref.size||asset.expiresAt!==ref.expiresAt)unavailable('AE替换素材的范围、版本或授权已变化。');
 }
 if(aeOriginHash({manifest:origin.manifestSHA256,runtimeId:origin.runtimeId,parameters:origin.parameters,references:origin.references})!==origin.sourceHash)unavailable('AE固定来源摘要无法核对。');
 return origin;
}
