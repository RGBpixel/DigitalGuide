import {randomUUID,createHash} from 'node:crypto';
import type {z} from 'zod';
import type {Repository} from '@digitalguide/database';
import {AppError,requirePermission,requireWorkspace,assertUsableAsset,type Principal} from '@digitalguide/domain';
import {blankStudioDocument,recordingSnapshot,transferCreateInput,type Recording,type RecordingSnapshot,type RecordingConfiguration,type recordingCreateInput,type recordingSaveInput,type recordingUploadInput,type recordingApplyInput,type StudioDocument} from '@digitalguide/contracts';
import {enableTimeline,newTimelineClip,timelineDuration} from '../../../packages/domain/src/timeline.js';
import type {Config} from './config.js';
import {ContentDrafts} from './content-drafts.js';
import {MediaTransfers} from './media-transfer-service.js';
export interface RecordingRow {id:string;tenant_id:string;workspace_id:string;actor_id:string;name:string;version:number;snapshot:string;subject:string;proof:string;expires_at:string;withdrawn_at:string|null;transfer_id:string|null;environment:string;app_env:string;updated_at:string}
export interface RecordingOutputRow {recording_id:string;transfer_id:string;raw_key:string;raw_sha256:string;raw_size:number;input_container:'webm'|'mp4';asset_id:string;output_sha256:string;output_size:number;source_specs:string;specs:string}
const now=()=>new Date().toISOString();
export class Recordings {
  drafts:ContentDrafts;transfers:MediaTransfers;
  constructor(public repo:Repository,public config:Config){this.drafts=new ContentDrafts(repo,config);this.transfers=new MediaTransfers(repo,config.providerMode,config.appEnv,config.dataDir);}
  scope(p:Principal,workspaceId:string,write=false){requireWorkspace(p,workspaceId);requirePermission(p,'asset.read');if(write){requirePermission(p,'studio.write');requirePermission(p,'asset.write');}}
  row(p:Principal,id:string,write=false){const r=this.repo.get<RecordingRow>('SELECT * FROM studio_recordings WHERE id=? AND tenant_id=? AND actor_id=? AND environment=? AND app_env=?',id,p.tenantId,p.userId,this.config.providerMode,this.config.appEnv);if(!r)throw new AppError('NOT_FOUND','本人录制方案不存在或不在当前环境。',404);this.scope(p,r.workspace_id,write);return r;}
  current(p:Principal,r:RecordingRow){return this.repo.recordingSource(p,r.workspace_id,this.config.providerMode,this.config.appEnv,r.id);}
  reason(p:Principal,r:RecordingRow){try{this.current(p,r);return null;}catch(e){if(e instanceof AppError)return e.message;throw e;}}
  prepare(p:Principal,workspaceId:string,configuration:RecordingConfiguration,expiresAt:string):RecordingSnapshot{
    this.scope(p,workspaceId,true);if(expiresAt<=now())throw new AppError('RECORDING_RIGHTS_EXPIRED','录制用途期限必须在未来。',409);
    const script=configuration.script;let text='',refs:RecordingSnapshot['sourceRefs']=[],inherited:string|null=null,notice='人工提词稿；不是实际录音转写或字幕对齐。';
    if(script.kind==='manual')text=script.text;
    else if(script.kind==='draft'){
      const r=this.drafts.row(p,script.id);this.drafts.studio.version(r,script.version);if(r.workspace_id!==workspaceId)throw new AppError('RECORDING_SCRIPT_SCOPE','脚本不在当前工作空间。',409);
      const payload=this.drafts.current(p,r);if(new Set(script.sectionIds).size!==script.sectionIds.length||script.sectionIds.some(id=>!payload.sections.some(s=>s.id===id)))throw new AppError('RECORDING_SCRIPT_CHANGED','所选提词段落重复或已经移除。',409);
      text=payload.sections.filter(s=>script.sectionIds.includes(s.id)).map(s=>s.text).join('\n\n');refs=payload.sourceRefs;inherited=payload.inheritedExpiresAt;notice='固定脚本v'+r.version+'的已选台词；实际朗读仍需人工核对。';
    }else{
      const prepared=this.drafts.projectDraftPayload(p,script.id,{projectVersion:script.version,name:'录制提词稿',segmentIds:script.segmentIds,confirmed:true});
      if(prepared.workspaceId!==workspaceId)throw new AppError('RECORDING_SCRIPT_SCOPE','原工程不在当前空间。',409);
      text=prepared.payload.sections.map(s=>s.text).join('\n\n');refs=prepared.payload.sourceRefs;inherited=prepared.payload.inheritedExpiresAt;notice='固定工程v'+script.version+'的已选台词；不代表自动字幕或语音识别。';
    }
    this.repo.contentReferences(p,workspaceId,this.config.providerMode,this.config.appEnv,refs);
    const dates=[expiresAt,...(inherited?[inherited]:[]),...refs.map(ref=>this.repo.get<{expires_at:string}>('SELECT expires_at FROM studio_content_sources WHERE id=?',ref.id)!.expires_at)].sort();
    if(dates[0]<=now())throw new AppError('RECORDING_SOURCE_EXPIRED','提词稿继承的使用期限已到期。',409);
    return recordingSnapshot.parse({configuration,scriptText:text,sourceRefs:refs,expiresAt:dates[0],scriptNotice:notice});
  }
  revision(p:Principal,r:RecordingRow,action:'created'|'saved'|'upload_started'|'withdrawn'){this.repo.run('INSERT INTO studio_recording_versions VALUES (?,?,?,?,?,?)',r.id,r.version,action,r.snapshot,p.userId,now());}
  create(p:Principal,input:z.infer<typeof recordingCreateInput>){
    const snapshot=this.prepare(p,input.workspaceId,input.configuration,input.rights.expiresAt);
    if(this.repo.get<{n:number}>('SELECT count(*) n FROM studio_recordings WHERE tenant_id=? AND workspace_id=? AND actor_id=? AND environment=? AND app_env=?',p.tenantId,input.workspaceId,p.userId,this.config.providerMode,this.config.appEnv)!.n>=200)throw new AppError('RECORDING_QUOTA','本人每空间最多200份录制方案，请整理后继续。',409);
    const id=randomUUID(),time=now();this.repo.run('INSERT INTO studio_recordings(id,tenant_id,workspace_id,actor_id,name,snapshot,subject,proof,expires_at,environment,app_env,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',id,p.tenantId,input.workspaceId,p.userId,input.name,JSON.stringify(snapshot),input.rights.subject,input.rights.proof,input.rights.expiresAt,this.config.providerMode,this.config.appEnv,time,time);this.revision(p,this.row(p,id),'created');return id;
  }
  save(p:Principal,r:RecordingRow,input:z.infer<typeof recordingSaveInput>){
    this.current(p,r);this.drafts.studio.version(r,input.version);if(r.transfer_id)throw new AppError('RECORDING_ALREADY_UPLOADED','已经绑定原始录制文件；请新建方案录制另一条。',409);
    const snapshot=this.prepare(p,r.workspace_id,input.configuration,input.rights.expiresAt);this.repo.run('UPDATE studio_recordings SET name=?,snapshot=?,subject=?,proof=?,expires_at=?,version=version+1,updated_at=? WHERE id=?',input.name,JSON.stringify(snapshot),input.rights.subject,input.rights.proof,input.rights.expiresAt,now(),r.id);this.revision(p,this.row(p,r.id),'saved');return r.id;
  }
  upload(p:Principal,r:RecordingRow,input:z.infer<typeof recordingUploadInput>){
    this.current(p,r);this.drafts.studio.version(r,input.version);
    const parsed=transferCreateInput.parse({workspaceId:r.workspace_id,kind:'video',name:r.name,fileName:input.fileName,size:input.size,sha256:input.sha256,partHashes:input.partHashes,rightsNote:r.proof,rightsConfirmed:true});
    const transfer=this.transfers.create(p,parsed,r.id);this.repo.run('UPDATE studio_recordings SET transfer_id=?,duration_hint_ms=?,version=version+1,updated_at=? WHERE id=?',transfer,input.recordedDurationMs,now(),r.id);this.revision(p,this.row(p,r.id),'upload_started');return r.id;
  }
  withdraw(p:Principal,r:RecordingRow,version:number){
    this.drafts.studio.version(r,version);if(r.withdrawn_at)throw new AppError('RECORDING_ALREADY_WITHDRAWN','录制用途已经撤回。',409);
    if(r.transfer_id){const transfer=this.transfers.row(p,r.transfer_id);if(['uploading','queued','processing'].includes(transfer.status))this.transfers.cancel(transfer,transfer.version);}
    this.repo.run('UPDATE studio_recordings SET withdrawn_at=?,version=version+1,updated_at=? WHERE id=?',now(),now(),r.id);this.revision(p,this.row(p,r.id),'withdrawn');return r.id;
  }
  output(r:RecordingRow){return this.repo.get<RecordingOutputRow>('SELECT * FROM studio_recording_outputs WHERE recording_id=?',r.id);}
  view(p:Principal,r:RecordingRow):Recording{
    this.scope(p,r.workspace_id);const reason=this.reason(p,r),output=this.output(r);
    return {id:r.id,workspaceId:r.workspace_id,name:r.name,version:r.version,snapshot:reason?null:recordingSnapshot.parse(JSON.parse(r.snapshot)),rights:reason?null:{subject:r.subject,proof:r.proof,expiresAt:r.expires_at},available:!reason,unavailableReason:reason,withdrawn:!!r.withdrawn_at,transfer:r.transfer_id?this.transfers.view(this.transfers.row(p,r.transfer_id)):null,output:output?{assetId:output.asset_id,inputSHA256:output.raw_sha256,inputBytes:output.raw_size,inputContainer:output.input_container,outputSHA256:output.output_sha256,outputBytes:output.output_size,sourceSpecs:JSON.parse(output.source_specs),specs:JSON.parse(output.specs),rawUrl:reason?null:'/api/v1/studio/recordings/'+r.id+'/source'}:null,updatedAt:r.updated_at};
  }
  apply(p:Principal,r:RecordingRow,input:z.infer<typeof recordingApplyInput>){
    this.current(p,r);this.drafts.studio.version(r,input.version);const output=this.output(r);if(!output)throw new AppError('RECORDING_NOT_READY','录制尚未转换和检查完成，请等待素材就绪。',409);
    const asset=this.repo.asset(p,output.asset_id);assertUsableAsset(asset);const studio=this.drafts.studio,segment=blankStudioDocument().segments[0];segment.title=r.name;segment.text='';segment.speakerId=null;segment.elements=[];segment.durationMs=Math.max(1000,asset.specs.durationMs);
    const requestHash=createHash('sha256').update(JSON.stringify(input)).digest('hex'),existing=this.repo.get<{project_id:string}>('SELECT project_id FROM studio_recording_applications WHERE recording_id=? AND actor_id=? AND request_hash=?',r.id,p.userId,requestHash);
    if(existing)return studio.view(p,studio.project(p,existing.project_id));
    let document:StudioDocument,start=0,project:ReturnType<typeof studio.project>|undefined;
    if(input.kind==='append'){project=studio.project(p,input.projectId);if(project.workspace_id!==r.workspace_id)throw new AppError('RECORDING_PROJECT_SCOPE','目标工程不在当前空间。',409);studio.version(project,input.projectVersion);studio.editable(project);document=JSON.parse(project.document);enableTimeline(document);start=timelineDuration(document);document.segments.push(segment);}
    else {document=blankStudioDocument();document.segments=[segment];if(asset.specs.width>=320&&asset.specs.height>=320){document.canvas.width=asset.specs.width;document.canvas.height=asset.specs.height;}enableTimeline(document);document.timeline!.tracks.forEach(t=>{t.clips=[];});}
    const track=document.timeline!.tracks.find(t=>t.type==='background')!;if(track.locked)throw new AppError('TRACK_LOCKED','背景轨已锁定，请在工程中解锁后重试。',409);
    track.clips.push(newTimelineClip({type:'asset',assetId:asset.id},{name:r.name,segmentId:segment.id,startMs:start,durationMs:asset.specs.durationMs,voiceRole:'narration'}));
    const id=project?studio.save(p,project,project.version,project.name,document):studio.create(p,{workspaceId:r.workspace_id,name:input.kind==='new_project'?input.name:r.name,purpose:'video',document,variables:{}}),result=studio.view(p,studio.project(p,id));
    this.repo.run('INSERT INTO studio_recording_applications VALUES (?,?,?,?,?,?,?)',randomUUID(),r.id,requestHash,p.userId,id,result.version,now());return result;
  }
}
