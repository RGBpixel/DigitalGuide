import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {Repository} from '@digitalguide/database';
import {aeManifest,type AeSourceInput,type AeSourcePlan,type AeSourceJob,type AeSourceBundle} from '@digitalguide/contracts';
import {AppError,requirePermission,requireWorkspace,hasPermission,type Principal} from '@digitalguide/domain';
import {loadAeRuntime,loadAeEntry,aeOwnedPath,aeHash} from '../../../packages/providers/src/ae-catalog.js';
import {fileDigest,ownedFile} from '../../../packages/media/src/files.js';
import {AeTemplates,type AeTemplateRow} from './ae-templates.js';
import type {Config} from './config.js';
export interface AeSourceRow{
 id:string;tenant_id:string;workspace_id:string;actor_id:string;name:string;template_id:string;template_version:number;catalog_id:string;catalog_revision:number;
 manifest:string;manifest_file:string;manifest_sha256:string;manifest_size:number;mode:'local_aerender'|'contract_test';plan_hash:string;environment:string;app_env:string;
 status:AeSourceJob['status'];stage:AeSourceJob['stage'];version:number;control_version:number;progress:number;attempts:number;lease_token:string|null;lease_until:string|null;
 storage_key:string|null;size:number|null;sha256:string|null;error_code:string|null;error_message:string|null;created_at:string;updated_at:string;
}
type Fixed=Pick<AeSourceRow,'tenant_id'|'workspace_id'|'catalog_id'|'catalog_revision'|'manifest_sha256'|'manifest'>;
export interface SourceAuthority{configFile:string;configSHA:string;manifestFile:string;directory:string;rawManifest:Buffer;mode:AeSourceRow['mode'];manifest:ReturnType<typeof aeManifest.parse>}
const now=()=>new Date().toISOString(),digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
function bounded(file:string){try{const s=fs.lstatSync(file);if(s.isSymbolicLink()||!s.isFile()||s.size<1||s.size>1048576)throw new Error('file');return fs.readFileSync(file);}catch{throw new AppError('AE_SOURCE_AUTHORITY_UNAVAILABLE','源文件导出所需的服务端授权清单不可用，请管理员恢复固定版本。',409);}}
export class AeSourceExports{
 templates:AeTemplates;
 constructor(public repo:Repository,public config:Config){this.templates=new AeTemplates(repo,config);}
 permit(p:Principal,workspaceId:string){requireWorkspace(p,workspaceId);requirePermission(p,'studio.source.export');}
 permission(p:Principal,workspaceId:string){requireWorkspace(p,workspaceId);requirePermission(p,'asset.read');return{allowed:hasPermission(p,'studio.source.export'),reason:hasPermission(p,'studio.source.export')?null:'当前账号仅有制作或查看权限；源工程下载需要独立的源文件导出权限，请联系管理员。'};}
 fixed(p:Principal,id:string,version:number):AeTemplateRow{
  const t=this.templates.template(p,id);this.permit(p,t.workspace_id);const r=this.repo.get<{catalog_revision:number;manifest_sha256:string;manifest:string}>('SELECT * FROM ae_template_versions WHERE template_id=? AND version=?',id,version);
  if(!r)throw new AppError('NOT_FOUND','此模板没有该登记修订。',404);return{...t,...r,version};
 }
 row(p:Principal,id:string){const row=this.repo.get<AeSourceRow>('SELECT * FROM ae_source_exports WHERE id=?',id);if(!row)throw new AppError('NOT_FOUND','此空间没有该源文件导出任务。',404);this.templates.scope(p,row);this.permit(p,row.workspace_id);return row;}
 owner(row:AeSourceRow){try{const p=this.repo.principal(row.actor_id);this.templates.scope(p,row);this.permit(p,row.workspace_id);return p;}catch{throw new AppError('AE_SOURCE_OWNER_UNAVAILABLE','原导出者的成员、空间或源文件权限已变化；请当前获授权成员重新核对并建立导出。',409);}}
 async authority(p:Principal,f:Fixed,verifyFiles=false):Promise<SourceAuthority>{
  this.permit(p,f.workspace_id);if(p.tenantId!==f.tenant_id)throw new AppError('NOT_FOUND','此空间没有该源工程授权。',404);
  if(!this.config.aeConfigFile)throw new AppError('AE_SOURCE_AUTHORITY_UNAVAILABLE','尚未接入授权AE工程目录，请管理员先配置目录。',409);
  const configFile=this.config.aeConfigFile,configSHA=digest(bounded(configFile)),runtime=await loadAeRuntime(this.config,false),entry=await loadAeEntry(runtime,this.config,{tenantId:p.tenantId,workspaceId:f.workspace_id},f.catalog_id,f.catalog_revision,verifyFiles);
  if(entry.manifestSHA256!==f.manifest_sha256||aeHash(entry.manifest)!==aeHash(JSON.parse(f.manifest)))throw new AppError('AE_SOURCE_CHANGED','固定登记的源工程清单已有变化，请管理员恢复原修订或重新登记。',409);
  if(!entry.manifest.license.sourceExportAllowed)throw new AppError('AE_SOURCE_EXPORT_DENIED','此工程许可允许制作，但未允许下载源工程及依赖素材；请联系权利人。',409);
  const manifestFile=entry.reference.manifestFile,rawManifest=bounded(aeOwnedPath(entry.directory,manifestFile)),result={configFile,configSHA,manifestFile,directory:entry.directory,rawManifest,mode:runtime.definition.mode,manifest:entry.manifest};this.assertAuthority(f,result);return result;
 }
 assertAuthority(f:Fixed,a:SourceAuthority){
  const m=a.manifest;if(this.config.aeConfigFile!==a.configFile||digest(bounded(a.configFile))!==a.configSHA||digest(bounded(aeOwnedPath(a.directory,a.manifestFile)))!==f.manifest_sha256||fs.lstatSync(a.directory).isSymbolicLink()||!fs.statSync(a.directory).isDirectory())throw new AppError('AE_SOURCE_AUTHORITY_CHANGED','导出期间工程授权配置发生变化，请重新核对；本次没有确认成功。',409);
  if(!m.license.sourceExportAllowed||m.license.expiresAt&&m.license.expiresAt<=now())throw new AppError('AE_SOURCE_LICENSE_EXPIRED','源工程下载授权已撤回或到期，请联系管理员核对。',409);
 }
 async capability(p:Principal,id:string,version:number){
  const f=this.fixed(p,id,version),m=aeManifest.parse(JSON.parse(f.manifest));let reason:string|null=null,mode:AeSourceRow['mode']|null=null;try{mode=(await this.authority(p,f)).mode;}catch(e){reason=e instanceof AppError?e.message:'源工程授权暂不可用，请联系管理员。';}
  return{templateId:id,templateVersion:version,catalogRevision:f.catalog_revision,name:m.name,sourceExportAllowed:m.license.sourceExportAllowed,licenseNote:m.license.note,licenseExpiresAt:m.license.expiresAt,available:!reason,reason,mode,simulated:mode==='contract_test'};
 }
 async prepare(p:Principal,input:AeSourceInput){
  this.permit(p,input.workspaceId);const fixed=this.fixed(p,input.templateId,input.templateVersion);if(fixed.workspace_id!==input.workspaceId)throw new AppError('NOT_FOUND','当前空间没有此AE工程。',404);const authority=await this.authority(p,fixed,true),m=authority.manifest;
  const hash=aeHash({pipeline:'ae-source-v1',input,catalogId:fixed.catalog_id,catalogRevision:fixed.catalog_revision,manifestSHA256:fixed.manifest_sha256,manifestFile:authority.manifestFile,mode:authority.mode});
  const plan:AeSourcePlan={hash,templateId:fixed.id,templateVersion:fixed.version,catalogRevision:fixed.catalog_revision,templateName:m.name,manifestSHA256:fixed.manifest_sha256,mode:authority.mode,simulated:authority.mode==='contract_test',realAeVerified:false,fileCount:m.files.length+1,sourceBytes:m.files.reduce((n,f)=>n+f.size,0)+authority.rawManifest.length,licenseNote:m.license.note,licenseExpiresAt:m.license.expiresAt,files:m.files,warnings:[authority.mode==='contract_test'?'此包包含原创契约假AEP，不是有效Adobe工程，不能作为真实AE迁移证据。':'只导出清单登记的原始AEP和文件，未证明Adobe版本、字体、插件或外部依赖兼容。','不包含服务器配置、引擎、账号和密钥；许可与下载权限独立于制作权限。','包内元数据不授予其他空间权限；异地使用须另行授权、登记目录及核对依赖。','已下载字节无法远程收回；平台撤回仅阻止后续下载。']};
  return{input,fixed,authority,plan};
 }
 validatePrepared(p:Principal,prepared:Awaited<ReturnType<AeSourceExports['prepare']>>){const f=this.fixed(p,prepared.input.templateId,prepared.input.templateVersion);if(f.workspace_id!==prepared.input.workspaceId||f.manifest_sha256!==prepared.fixed.manifest_sha256)throw new AppError('AE_SOURCE_CHANGED','登记修订变化，请重新核对。',409);this.assertAuthority(f,prepared.authority);}
 create(p:Principal,prepared:Awaited<ReturnType<AeSourceExports['prepare']>>){
  this.validatePrepared(p,prepared);const {input,fixed:f,authority:a,plan}=prepared;
  if(this.repo.get<{n:number}>("SELECT count(*) n FROM ae_source_exports WHERE tenant_id=? AND environment=? AND app_env=? AND status IN ('queued','processing')",p.tenantId,this.config.providerMode,this.config.appEnv)!.n>=3)throw new AppError('AE_SOURCE_QUEUE_LIMIT','当前组织最多三项未结束的源工程导出，请等待或取消。',409);
  const id=randomUUID(),at=now();this.repo.run('INSERT INTO ae_source_exports(id,tenant_id,workspace_id,actor_id,name,template_id,template_version,catalog_id,catalog_revision,manifest,manifest_file,manifest_sha256,manifest_size,mode,plan_hash,environment,app_env,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,p.tenantId,input.workspaceId,p.userId,input.name,f.id,f.version,f.catalog_id,f.catalog_revision,f.manifest,a.manifestFile,f.manifest_sha256,a.rawManifest.length,a.mode,plan.hash,this.config.providerMode,this.config.appEnv,at,at);return id;
 }
 validateRow(row:AeSourceRow,a:SourceAuthority){this.assertAuthority(row,a);if(row.mode!==a.mode||row.manifest_file!==a.manifestFile||row.manifest_size!==a.rawManifest.length)throw new AppError('AE_SOURCE_PLAN_CHANGED','固定源包的模式或清单已变化，请恢复原授权配置或新建任务。',409);this.owner(row);}
 bundle(row:AeSourceRow,a:SourceAuthority):AeSourceBundle{return{format:'digitalguide-ae-source',version:1,templateName:a.manifest.name,registrationVersion:row.template_version,catalogId:row.catalog_id,catalogRevision:row.catalog_revision,mode:row.mode,simulated:row.mode==='contract_test',realAeVerified:false,sourceRoot:'source',manifestFile:row.manifest_file,manifestSHA256:row.manifest_sha256,manifestSize:row.manifest_size,files:a.manifest.files,createdAt:row.created_at,accessGranted:false,requirements:['重新登记须由目标空间管理员另行获得工程和素材许可。','真实AE工程需要适用的Adobe运行时、授权、字体、插件及外部依赖；本包不保证这些依赖完整或可用。',...(row.mode==='contract_test'?['原创契约假AEP，不是有效Adobe工程。']:[])]};}
 fileName(row:AeSourceRow){return row.name+(row.mode==='contract_test'?'-契约源文件（非Adobe）':'-AE源文件')+'.zip';}
 async view(p:Principal,row:AeSourceRow):Promise<AeSourceJob>{
  this.row(p,row.id);const m=aeManifest.parse(JSON.parse(row.manifest));let sourceReason:string|null=null;
  if(row.status==='withdrawn')sourceReason='此源工程导出已永久撤回，不能重试或继续下载。';else try{const a=await this.authority(p,row);this.validateRow(row,a);}catch(e){sourceReason=e instanceof AppError?e.message:'当前源文件授权不可用，请联系管理员。';}
  return{id:row.id,workspaceId:row.workspace_id,name:row.name,templateId:row.template_id,templateVersion:row.template_version,catalogRevision:row.catalog_revision,templateName:m.name,manifestSHA256:row.manifest_sha256,planHash:row.plan_hash,mode:row.mode,simulated:row.mode==='contract_test',realAeVerified:false,version:row.version,controlVersion:row.control_version,status:row.status,stage:row.stage,progress:row.progress,attempts:row.attempts,sourceBytes:m.files.reduce((n,f)=>n+f.size,0)+row.manifest_size,fileCount:m.files.length+1,sourceReason,errorCode:row.error_code,errorMessage:row.error_message,canRetry:row.status==='failed'&&row.attempts<3&&!sourceReason,artifact:row.storage_key?{name:this.fileName(row),mediaType:'application/zip',size:row.size!,sha256:row.sha256!,url:row.status==='succeeded'&&!sourceReason?'/api/v1/studio/ae-source-exports/'+row.id+'/file':null}:null,attemptHistory:this.repo.all<{attempt:number;status:string;error_code:string|null;error_message:string|null;created_at:string;finished_at:string|null}>('SELECT * FROM ae_source_attempts WHERE job_id=? ORDER BY attempt',row.id).map(a=>({attempt:a.attempt,status:a.status,errorCode:a.error_code,errorMessage:a.error_message,createdAt:a.created_at,finishedAt:a.finished_at})),createdAt:row.created_at,updatedAt:row.updated_at};
 }
 control(p:Principal,row:AeSourceRow,controlVersion:number,action:'cancel'|'withdraw'|'retry'){
  this.row(p,row.id);if(row.control_version!==controlVersion)throw new AppError('VERSION_CONFLICT','源文件任务已有新控制代次，请重新载入当前状态。',409);
  if(action==='withdraw'&&row.status==='withdrawn')return;
  if(action==='retry'&&(row.status!=='failed'||row.attempts>=3)||action==='cancel'&&!['queued','processing'].includes(row.status)||action!=='withdraw'&&row.status==='withdrawn')throw new AppError('AE_SOURCE_CONTROL_UNAVAILABLE','此任务当前不能执行该操作，请核对状态或新建导出。',409);
  const at=now(),status=action==='retry'?'queued':action==='cancel'?'cancelled':'withdrawn';
  this.repo.run('UPDATE ae_source_exports SET status=?,stage=?,progress=?,version=version+1,control_version=control_version+1,lease_token=NULL,lease_until=NULL,error_code=NULL,error_message=NULL,updated_at=? WHERE id=?',status,action==='retry'?'queued':'finished',action==='retry'?0:row.progress,at,row.id);
  this.repo.run("UPDATE ae_source_attempts SET status=?,finished_at=? WHERE job_id=? AND status='processing'",status,at,row.id);
 }
 async file(p:Principal,id:string){
  const row=this.row(p,id);if(row.status!=='succeeded'||!row.storage_key)throw new AppError('AE_SOURCE_FILE_UNAVAILABLE','此源文件包未完成或已撤回，请核对当前任务。',409);
  const authority=await this.authority(p,row);this.validateRow(row,authority);const file=ownedFile(path.resolve(this.config.dataDir,'objects'),row.storage_key);let actual;
  try{actual=await fileDigest(file);}catch{throw new AppError('AE_SOURCE_FILE_UNAVAILABLE','源文件包缺失，请管理员检查私有存储。',409);}
  if(actual.sha256!==row.sha256||actual.size!==row.size)throw new AppError('AE_SOURCE_FILE_CHANGED','源文件包实际字节校验失败，已停止下载，请新建导出。',409);return{row,authority,file};
 }
}
