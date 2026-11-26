import { AppError } from '@digitalguide/domain';
import type { Repository } from '@digitalguide/database';
import type { Config } from './config.js';
import type { IdentityWorkflow } from '../../../packages/enterprise/src/identity-workflows.js';
import type { DeveloperStudioAuthority, DeveloperStudioWorkflows } from '../../../packages/enterprise/src/developer-studio-workflows.js';
import { StudioExports, type ArtifactRow } from './studio-export-service.js';
import { SqliteIdentityStore } from './identity-store.js';
import type { DeveloperStudioAdapter, DeveloperStudioCommand, DeveloperStudioFile, DeveloperStudioResult } from './developer-studio-ports.js';
import { applicationExport, applicationProject, assertStudioCommand, studioOperationKind } from './developer-studio-common.js';
import { recordStudioJobOrigin, recordStudioOperation, studioPrior, studioRequestHash } from './developer-studio-records.js';
import { developerStudioFileFingerprint } from './developer-studio-files.js';
export class SqliteDeveloperStudioAdapter implements DeveloperStudioAdapter{
  readonly store:SqliteIdentityStore;readonly exports:StudioExports;
  constructor(readonly repo:Repository,readonly config:Config,readonly workflow:DeveloperStudioWorkflows){this.store=new SqliteIdentityStore(repo);this.exports=new StudioExports(repo,config.providerMode,config.appEnv,config.dataDir,config.root);}
  get dataDir(){return this.config.dataDir;}
  execute(authorize:IdentityWorkflow<DeveloperStudioAuthority>,command:DeveloperStudioCommand):DeveloperStudioResult{
    return this.repo.transaction(()=>{
      const authority=this.store.runInTransaction(authorize),p=authority.responsible;assertStudioCommand(authority,command);
      if(command.kind==='context')return{kind:'json',data:this.workflow.context(authority)};
      if(command.kind==='project.get')return{kind:'json',data:applicationProject(this.exports.studio.view(p,this.exports.studio.project(p,command.id)))};
      if(command.kind==='export.plan')return{kind:'json',data:this.exports.plan(p,this.exports.studio.project(p,command.id),command.input)};
      if(command.kind==='export.get')return{kind:'json',data:applicationExport(authority,this.exports.view(p,this.exports.row(p,command.id)))};
      if(command.kind==='export.file'){
        const row=this.exports.row(p,command.id),project=this.exports.studio.project(p,row.project_id);if(project.archived||row.status!=='succeeded'||!this.exports.current(p,row))throw new AppError('EXPORT_UNAVAILABLE','输出尚未完成，或工程、来源、授权已变化，请重新生成。',409);
        const artifact=this.repo.get<ArtifactRow>('SELECT * FROM studio_export_artifacts WHERE id=? AND export_id=?',command.artifactId,row.id);if(!artifact)throw new AppError('NOT_FOUND','输出文件不属于当前任务。',404);
        const file:DeveloperStudioFile={exportId:row.id,artifactId:artifact.id,projectId:row.project_id,projectVersion:row.project_version,storageKey:artifact.storage_key,size:artifact.size,sha256:artifact.sha256,name:artifact.name,mediaType:artifact.media_type},fingerprint=developerStudioFileFingerprint(file);
        if(command.verifiedFingerprint){if(command.verifiedFingerprint!==fingerprint)throw new AppError('EXPORT_UNAVAILABLE','文件核对期间输出发生变化，请重新请求。',409);if(!command.head)this.store.runInTransaction(recordStudioOperation(authority,'file.download_started',studioRequestHash(authority,command.kind,row.id,{artifactId:artifact.id,range:command.range??null}),null,artifact.id,row.project_id,row.project_version,command.requestId));}
        return{kind:'file',file,fingerprint};
      }
      const kind=studioOperationKind(command.kind),requestHash=studioRequestHash(authority,command.kind,'id' in command?command.id:undefined,command.input),prior=this.store.runInTransaction(studioPrior(authority,kind,command.key,requestHash));
      if(prior){const id=String(prior.resource_id);return{kind:'json',data:kind.startsWith('project.')?{operationId:String(prior.id),project:applicationProject(this.exports.studio.view(p,this.exports.studio.project(p,id)))}:{operationId:String(prior.id),export:applicationExport(authority,this.exports.view(p,this.exports.row(p,id)))}};}
      let id:string,projectId:string,version:number;
      if(command.kind==='project.create'){id=this.exports.studio.create(p,{...command.input,workspaceId:authority.workspaceId});projectId=id;version=this.exports.studio.project(p,id).version;}
      else if(command.kind==='project.save'){const project=this.exports.studio.project(p,command.id);id=this.exports.studio.save(p,project,command.input.version,command.input.name,command.input.document);projectId=id;version=this.exports.studio.project(p,id).version;}
      else if(command.kind==='export.create'){const project=this.exports.studio.project(p,command.id);this.exports.studio.editable(project);id=this.exports.create(p,project,command.input);projectId=project.id;version=command.input.version;}
      else{const row=this.exports.row(p,command.id);this.exports.studio.version({version:row.project_version},command.input.version);if(!['queued','rendering'].includes(row.status))throw new AppError('STATE_CONFLICT','导出任务已经结束，请刷新状态。',409);this.repo.run("UPDATE studio_exports SET status='cancelled',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?",new Date().toISOString(),row.id);id=row.id;projectId=row.project_id;version=row.project_version;}
      const operationId=this.store.runInTransaction(recordStudioOperation(authority,kind,requestHash,command.key,id,projectId,version,command.requestId));if(command.kind==='export.create')this.store.runInTransaction(recordStudioJobOrigin(authority,id,operationId));
      this.repo.audit(p,authority.workspaceId,'application.studio.'+kind,operationId,command.requestId,'application_delegated');
      return{kind:'json',data:kind.startsWith('project.')?{operationId,project:applicationProject(this.exports.studio.view(p,this.exports.studio.project(p,id)))}:{operationId,export:applicationExport(authority,this.exports.view(p,this.exports.row(p,id)))}};
    });
  }
}
