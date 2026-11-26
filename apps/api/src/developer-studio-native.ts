import { AppError, canonical } from '@digitalguide/domain';
import type { NativeCoreRepository } from '../../../packages/postgres/src/runtime-repository.js';
import { NativeStudioMedia } from '../../../packages/postgres/src/runtime-studio-media.js';
import { NativeIdentityStore } from '../../../packages/postgres/src/runtime-identity-store.js';
import type { IdentityWorkflow } from '../../../packages/enterprise/src/identity-workflows.js';
import type { DeveloperStudioAuthority, DeveloperStudioWorkflows } from '../../../packages/enterprise/src/developer-studio-workflows.js';
import type { DeveloperStudioAdapter, DeveloperStudioCommand, DeveloperStudioFile, DeveloperStudioResult } from './developer-studio-ports.js';
import { applicationExport, applicationProject, assertStudioCommand, studioOperationKind } from './developer-studio-common.js';
import { recordStudioJobOrigin, recordStudioOperation, studioIdempotencyHash, studioPrior, studioRequestHash } from './developer-studio-records.js';
import { developerStudioFileFingerprint } from './developer-studio-files.js';
export class NativeDeveloperStudioAdapter implements DeveloperStudioAdapter{
  readonly store:NativeIdentityStore;readonly media:NativeStudioMedia;
  constructor(readonly repo:NativeCoreRepository,root:string,readonly workflow:DeveloperStudioWorkflows){this.store=new NativeIdentityStore(repo);this.media=new NativeStudioMedia(repo,root);}
  get dataDir(){return this.repo.db.config.dataDir;}
  async execute(authorize:IdentityWorkflow<DeveloperStudioAuthority>,command:DeveloperStudioCommand):Promise<DeveloperStudioResult>{
    return this.repo.db.transaction(async()=>{
      const authority=await this.store.run(authorize),p=authority.responsible;assertStudioCommand(authority,command);
      if(command.kind==='context')return{kind:'json',data:this.workflow.context(authority)};
      if(command.kind==='project.get')return{kind:'json',data:applicationProject(await this.media.studio.get(p,command.id))};
      if(command.kind==='export.plan'){await this.media.studio.scope(p,command.id);return{kind:'json',data:await this.media.exportPlan(p,await this.media.studio.project(p,command.id),command.input)};}
      if(command.kind==='export.get')return{kind:'json',data:applicationExport(authority,await this.media.exportView(p,await this.media.row(p,'export',command.id)))};
      if(command.kind==='export.file'){
        const row=await this.media.row(p,'export',command.id);if(row.status!=='succeeded'||!await this.media.current(p,row))throw new AppError('EXPORT_UNAVAILABLE','输出尚未完成，或工程、来源、授权已变化，请重新生成。',409);
        const artifact=(await this.media.artifacts(row.id)).find(item=>item.id===command.artifactId);if(!artifact)throw new AppError('NOT_FOUND','输出文件不属于当前任务。',404);
        const file:DeveloperStudioFile={exportId:row.id,artifactId:artifact.id,projectId:row.project_id,projectVersion:row.project_version,storageKey:artifact.storage_key,size:Number(artifact.size),sha256:artifact.sha256,name:artifact.name,mediaType:artifact.media_type},fingerprint=developerStudioFileFingerprint(file);
        if(command.verifiedFingerprint){if(command.verifiedFingerprint!==fingerprint)throw new AppError('EXPORT_UNAVAILABLE','文件核对期间输出发生变化，请重新请求。',409);if(!command.head)await this.store.run(recordStudioOperation(authority,'file.download_started',studioRequestHash(authority,command.kind,row.id,{artifactId:artifact.id,range:command.range??null}),null,artifact.id,row.project_id,row.project_version,command.requestId));}
        return{kind:'file',file,fingerprint};
      }
      const kind=studioOperationKind(command.kind),requestHash=studioRequestHash(authority,command.kind,'id' in command?command.id:undefined,command.input);
      await this.repo.db.advisoryLock(canonical(['application-studio-idempotency',authority.appId,kind,studioIdempotencyHash(command.key)]),true);
      const prior=await this.store.run(studioPrior(authority,kind,command.key,requestHash));
      if(prior){const id=String(prior.resource_id);return{kind:'json',data:kind.startsWith('project.')?{operationId:String(prior.id),project:applicationProject(await this.media.studio.get(p,id))}:{operationId:String(prior.id),export:applicationExport(authority,await this.media.exportView(p,await this.media.row(p,'export',id)))}};}
      let id:string,projectId:string,version:number;
      if(command.kind==='project.create'){id=await this.media.studio.create(p,{...command.input,workspaceId:authority.workspaceId},command.requestId);projectId=id;version=(await this.media.studio.project(p,id)).version;}
      else if(command.kind==='project.save'){id=await this.media.studio.save(p,command.id,command.input.version,command.input.name,command.input.document,command.requestId);projectId=id;version=(await this.media.studio.project(p,id)).version;}
      else if(command.kind==='export.create'){id=await this.media.create(p,command.id,{...command.input,mode:'export'},command.requestId);projectId=command.id;version=command.input.version;}
      else{const row=await this.media.row(p,'export',command.id);id=await this.media.cancel(p,'export',command.id,command.input.version,command.requestId);projectId=row.project_id;version=row.project_version;}
      const operationId=await this.store.run(recordStudioOperation(authority,kind,requestHash,command.key,id,projectId,version,command.requestId));if(command.kind==='export.create')await this.store.run(recordStudioJobOrigin(authority,id,operationId));
      await this.repo.audit(p,authority.workspaceId,'application.studio.'+kind,operationId,command.requestId);
      return{kind:'json',data:kind.startsWith('project.')?{operationId,project:applicationProject(await this.media.studio.get(p,id))}:{operationId,export:applicationExport(authority,await this.media.exportView(p,await this.media.row(p,'export',id)))}};
    });
  }
}
