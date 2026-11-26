import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {AppError,canonical,requirePermission,type Principal} from '../../domain/src/index.js';
import {validateTranscriptionReview,transcriptionReviewHash} from '../../domain/src/transcriptions.js';
import {transcriptionSnapshot,transcriptionAnalysis,transcriptionReview,transcriptionRecognizerSchema,transcriptionJobSchema,contentSourceInput,type TranscriptionSnapshot,type TranscriptionRecognizer,type TranscriptionJob,type transcriptionCreateInput,type transcriptionSaveInput,type transcriptionConfirmInput} from '../../contracts/src/index.js';
import {capturePlainText} from '../../media/src/content-text.js';
import {systemAsrRecognizers} from '../../providers/src/system-asr.js';
import {semanticSourceSnapshot,type SemanticSourceSnapshot} from '../../contracts/src/semantic-clips.js';
import {NativeContentSources,type NativeContentSource} from './runtime-content-sources.js';
import {nativeBusinessInteger as integer,type NativeCoreRepository} from './runtime-repository.js';

export const nativeTranscriptionHash=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
export interface NativeTranscriptionRow {
 id:string;tenant_id:string;workspace_id:string;actor_id:string;name:string;snapshot:string;input_hash:string;
 status:TranscriptionJob['status'];version:number;progress:number;attempts:number;lease_token:string|null;lease_until:string|null;
 analysis:string|null;analysis_hash:string|null;audio_key:string|null;audio_sha256:string|null;audio_size:number|null;
 review:string|null;review_version:number|null;review_hash:string|null;source_id:string|null;withdrawn_at:string|null;
 error_code:string|null;error_message:string|null;environment:string;app_env:string;created_at:string;updated_at:string;
}
export function nativeTranscriptionRow(r:NativeTranscriptionRow):NativeTranscriptionRow{return{...r,version:integer(r.version),attempts:integer(r.attempts),review_version:r.review_version===null?null:integer(r.review_version),audio_size:r.audio_size===null?null:integer(r.audio_size)};}
interface NativeTranscriptionInput {job_id:string;recognizer:string|null;input_hash:string}
interface NativeTranscriptionOutput {analysis:string;analysis_hash:string;audio_key:string|null;audio_sha256:string|null;audio_size:string|null;review:string;review_hash:string}
export class NativeTranscriptions {
 readonly sources:NativeContentSources;
 constructor(readonly core:NativeCoreRepository,readonly root=process.cwd()){this.sources=new NativeContentSources(core);}
 get db(){return this.core.db;}
 async scope(p:Principal,workspaceId:string,write=false){await this.sources.scope(p,workspaceId,write);}
 async capabilities(){let recognizers:TranscriptionRecognizer[]=[],reason:string|null=null;try{recognizers=await systemAsrRecognizers(this.root,AbortSignal.timeout(20000));if(!recognizers.length)reason='本机尚未安装离线识别器，请继续人工转写或配置真实ASR。';}catch(e){reason=e instanceof AppError?e.message:'识别器清单暂不可用，请继续人工转写。';}return{localProvider:'windows-offline-asr' as const,recognizers,available:recognizers.length>0,unavailableReason:reason,externalConfigured:false as const,mockReports:true,maxDurationMs:600000 as const,fileOnly:true as const,targetSpeakerIsolation:false as const,reviewRequired:true as const,notice:'仅处理已授权视频文件原声；可能错词漏词，须听原声校对。没有启用麦克风、身份识别或目标说话人隔离。'};}
 async row(p:Principal,id:string,write=false,sharedSource=false){
  const initial=(await this.db.query<NativeTranscriptionRow>("SELECT * FROM studio_transcriptions WHERE id=$1 AND tenant_id=$2 AND environment='mock' AND app_env=$3",[id,p.tenantId,this.db.config.appEnv])).rows[0];
  if(!initial||!sharedSource&&initial.actor_id!==p.userId)throw new AppError('NOT_FOUND','转写任务不存在或不属于当前账号。',404);
  await this.db.query('SELECT user_id FROM dg_native_locked_membership($1)',[initial.actor_id]);await this.scope(p,initial.workspace_id,write);
  // Worker keeps its membership/workspace lock; row mutation is confined to the fenced SQL functions.
  const lock=this.db.role==='worker'?'':write?' FOR UPDATE':' FOR SHARE';
  return nativeTranscriptionRow((await this.db.query<NativeTranscriptionRow>('SELECT * FROM studio_transcriptions WHERE id=$1'+lock,[id])).rows[0]);
 }
 version(r:NativeTranscriptionRow,version:number){if(r.version!==version)throw new AppError('VERSION_CONFLICT','转写任务已变化，请载入当前状态；输入保留。',409);}
 async fixed(r:NativeTranscriptionRow){
  try{const snapshot=transcriptionSnapshot.parse(JSON.parse(r.snapshot)),input=(await this.db.query<NativeTranscriptionInput>('SELECT * FROM _dg_native_transcription_inputs WHERE job_id=$1',[r.id])).rows[0];
   if(!input||input.input_hash!==r.input_hash||nativeTranscriptionHash(snapshot)!==r.input_hash||snapshot.name!==r.name)throw new Error('input');
   const recognizer=input.recognizer?transcriptionRecognizerSchema.parse(JSON.parse(input.recognizer)):null;
   if(snapshot.configuration.provider==='external-file-asr'||snapshot.configuration.provider==='windows-offline-asr'&&(!recognizer||recognizer.id!==snapshot.configuration.recognizerId||recognizer.locale!==snapshot.configuration.locale)||snapshot.configuration.provider==='mock-file-asr'&&recognizer)throw new Error('recognizer');
   return{snapshot,recognizer};
  }catch(e){if(e instanceof AppError)throw e;throw new AppError('TRANSCRIPTION_SOURCE_CHANGED','固定视频、识别器或输入摘要不一致，请新建转写。',409);}
 }
 async current(p:Principal,r:NativeTranscriptionRow){
  await this.scope(p,r.workspace_id);if(r.withdrawn_at)throw new AppError('TRANSCRIPTION_WITHDRAWN','转写已永久撤回，原声和正文不可再使用。',409);
  const owner=await this.core.principal(r.actor_id);requirePermission(owner,'studio.write');if(owner.tenantId!==p.tenantId)throw new AppError('TRANSCRIPTION_ACTOR_CHANGED','原创建人的组织或编辑权限已变化。',409);await this.scope(owner,r.workspace_id);
  const fixed=await this.fixed(r),{snapshot}=fixed,now=await this.db.now();if(snapshot.expiresAt<=now||snapshot.rights.expiresAt<=now)throw new AppError('TRANSCRIPTION_RIGHTS_EXPIRED','转写使用期限已到期，请重新核对授权。',409);
  const checked=await this.core.assets.checked(p,snapshot.source.id),{asset,video}=checked;
  if(!video||asset.workspaceId!==r.workspace_id||asset.version!==snapshot.source.version||asset.sha256!==snapshot.source.sha256||asset.size!==snapshot.source.size||asset.mediaType!==snapshot.source.mediaType||canonical(asset.specs)!==canonical(snapshot.source.specs)||snapshot.expiresAt>snapshot.rights.expiresAt||asset.expiresAt&&snapshot.expiresAt>asset.expiresAt)throw new AppError('TRANSCRIPTION_SOURCE_CHANGED','视频版本、字节、解码信息或最短期限已变化，请新建转写。',409);
  if(snapshot.expiresAt<=await this.db.now())throw new AppError('TRANSCRIPTION_RIGHTS_EXPIRED','核验期间转写已到期，请重新核对授权。',409);return{...fixed,owner,...checked};
 }
 async reason(p:Principal,r:NativeTranscriptionRow){try{await this.current(p,r);if(r.analysis)await this.completed(r);return null;}catch(e){if(!(e instanceof AppError))throw e;return e.message;}}
 async prepare(p:Principal,input:z.infer<typeof transcriptionCreateInput>,recognizers:TranscriptionRecognizer[]){
  await this.scope(p,input.workspaceId,true);const {asset,video}=await this.core.assets.checked(p,input.assetId),c=input.configuration,now=await this.db.now();
  if(!video||asset.workspaceId!==input.workspaceId||asset.version!==input.assetVersion||asset.specs.hasAudio!==1||c.startMs+c.durationMs>asset.specs.durationMs)throw new AppError('TRANSCRIPTION_SOURCE_INVALID','请选择当前空间有原声的视频及有效区间。',409);
  if(input.rights.expiresAt<=now)throw new AppError('TRANSCRIPTION_RIGHTS_EXPIRED','转写使用期限已到期，请核对授权。',409);
  if(c.provider==='external-file-asr')throw new AppError('TRANSCRIPTION_PROVIDER_NOT_CONFIGURED','外部ASR尚未配置，不会返回模拟成功。',409);
  const recognizer=c.provider==='windows-offline-asr'?recognizers.find(r=>r.id===c.recognizerId&&r.locale===c.locale)??null:null;
  if(c.provider==='windows-offline-asr'&&!recognizer)throw new AppError('SYSTEM_ASR_RECOGNIZER_UNAVAILABLE','所选识别器或语言当前不可用，请重新载入实际清单。',409);
  const expiresAt=[new Date(input.rights.expiresAt).toISOString(),asset.expiresAt].filter((s):s is string=>!!s).sort()[0];
  return{snapshot:transcriptionSnapshot.parse({name:input.name,source:{id:asset.id,version:asset.version,sha256:asset.sha256,size:asset.size,mediaType:asset.mediaType,name:asset.name,specs:asset.specs,expiresAt:asset.expiresAt,synthetic:asset.synthetic},configuration:c,rights:input.rights,expiresAt}),recognizer};
 }
 async create(p:Principal,input:z.infer<typeof transcriptionCreateInput>,recognizers:TranscriptionRecognizer[]){
  await this.db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[canonical(['native-transcription-quota',p.tenantId])]);
  const {snapshot,recognizer}=await this.prepare(p,input,recognizers),digest=nativeTranscriptionHash(snapshot);
  const old=(await this.db.query<{id:string}>("SELECT id FROM studio_transcriptions WHERE tenant_id=$1 AND workspace_id=$2 AND actor_id=$3 AND environment='mock' AND app_env=$4 AND input_hash=$5 AND status IN('queued','transcribing') ORDER BY created_at LIMIT 1",[p.tenantId,input.workspaceId,p.userId,this.db.config.appEnv,digest])).rows[0];if(old)return old.id;
  const quota=(await this.db.query<{total:string;active:string}>("SELECT count(*) FILTER(WHERE workspace_id=$2 AND actor_id=$3) AS total,count(*) FILTER(WHERE status IN('queued','transcribing')) AS active FROM studio_transcriptions WHERE tenant_id=$1 AND environment='mock' AND app_env=$4",[p.tenantId,input.workspaceId,p.userId,this.db.config.appEnv])).rows[0];if(integer(quota.total)>=200||integer(quota.active)>=10)throw new AppError('TRANSCRIPTION_QUOTA','已达到个人200项或组织10项排队限制，请先处理已有任务。',409);
  const id=randomUUID();await this.db.query("INSERT INTO studio_transcriptions(id,tenant_id,workspace_id,actor_id,name,snapshot,input_hash,environment,app_env,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,'mock',$8,dg_utc_now(),dg_utc_now())",[id,p.tenantId,input.workspaceId,p.userId,input.name,JSON.stringify(snapshot),digest,this.db.config.appEnv]);await this.db.query('INSERT INTO _dg_native_transcription_inputs VALUES($1,$2,$3,dg_utc_now())',[id,recognizer?JSON.stringify(recognizer):null,digest]);return id;
 }
 validateAnalysis(_r:NativeTranscriptionRow,snapshot:TranscriptionSnapshot,recognizer:TranscriptionRecognizer|null,value:unknown){
  const a=transcriptionAnalysis.parse(value),c=snapshot.configuration,end=c.startMs+c.durationMs;
  if(a.provider!==c.provider||a.simulated!==(c.provider==='mock-file-asr')||a.provider==='windows-offline-asr'&&canonical(a.recognizer)!==canonical(recognizer)||a.audioDurationMs>c.durationMs+50||a.segments.reduce((n,s)=>n+s.text.length,0)>60000||a.segments.reduce((n,s)=>n+s.words.length,0)>20000)throw new AppError('TRANSCRIPTION_OUTPUT_INVALID','识别结果与固定引擎、范围或容量不符，未保存。',409);
  let previous=c.startMs;const ids=new Set<string>();for(const s of a.segments){if(ids.has(s.id)||s.startMs<previous||s.endMs>end||s.endMs>c.startMs+a.audioDurationMs+50||s.endMs-s.startMs<20)throw new AppError('TRANSCRIPTION_OUTPUT_RANGE','识别时间必须唯一、有序、无重叠并在实际原声范围内。',409);ids.add(s.id);previous=s.endMs;}
  if(a.simulated&&(a.recognizer!==null||a.audioSHA256!==null||a.segments.length))throw new AppError('TRANSCRIPTION_MOCK_REPORT','模拟转写仅提供明确报告，不生成可采用的正文或原声。',409);
  return a;
 }
 async completed(r:NativeTranscriptionRow){
  try{const{snapshot,recognizer}=await this.fixed(r),o=(await this.db.query<NativeTranscriptionOutput>('SELECT * FROM _dg_native_transcription_outputs WHERE job_id=$1',[r.id])).rows[0];if(!o||r.analysis!==o.analysis||r.analysis_hash!==o.analysis_hash||r.audio_key!==o.audio_key||r.audio_sha256!==o.audio_sha256||r.audio_size!==(o.audio_size===null?null:integer(o.audio_size)))throw new Error('output');
   const analysis=this.validateAnalysis(r,snapshot,recognizer,JSON.parse(o.analysis));if(nativeTranscriptionHash(analysis)!==o.analysis_hash)throw new Error('analysis hash');
   const first=validateTranscriptionReview(transcriptionReview.parse(JSON.parse(o.review)),snapshot).review;if(transcriptionReviewHash(r.input_hash,first)!==o.review_hash)throw new Error('first review');
   const revision=(await this.db.query<{review:string;review_hash:string}>('SELECT review,review_hash FROM studio_transcription_revisions WHERE transcription_id=$1 AND version=$2',[r.id,r.review_version])).rows[0];if(!revision||revision.review!==r.review||revision.review_hash!==r.review_hash)throw new Error('review');const {review,text}=validateTranscriptionReview(transcriptionReview.parse(JSON.parse(r.review!)),snapshot);if(transcriptionReviewHash(r.input_hash,review)!==r.review_hash)throw new Error('review hash');
   if(analysis.simulated&&(r.audio_key||r.audio_sha256||r.audio_size)||!analysis.simulated&&(!r.audio_key||r.audio_sha256!==analysis.audioSHA256||!r.audio_size))throw new Error('audio');
   if(r.audio_key)await this.sources.objects.verify({storage_key:r.audio_key,size:r.audio_size!,sha256:r.audio_sha256!},19201024);
   return{analysis,review,text,snapshot};
  }catch(e){if(e instanceof AppError)throw e;throw new AppError('TRANSCRIPTION_OUTPUT_CHANGED','识别结果、原声或校对历史与固定凭据不符，正文未提供。',409);}
 }
 async view(p:Principal,r:NativeTranscriptionRow):Promise<TranscriptionJob>{const reason=await this.reason(p,r),fixed=reason?null:await this.fixed(r),complete=!reason&&r.analysis?await this.completed(r):null;return transcriptionJobSchema.parse({id:r.id,workspaceId:r.workspace_id,name:r.name,version:r.version,status:r.status,progress:r.progress,attempts:r.attempts,snapshot:fixed?.snapshot??null,available:!reason,unavailableReason:reason,withdrawn:!!r.withdrawn_at,simulated:fixed?.snapshot.configuration.provider==='mock-file-asr',analysis:complete?.analysis??null,review:complete?.review??null,reviewVersion:r.review_version,reviewHash:r.review_hash,sourceId:reason?null:r.source_id,audioUrl:!reason&&r.audio_key?'/api/v1/studio/transcriptions/'+r.id+'/audio':null,errorCode:r.error_code,errorMessage:r.error_message,updatedAt:r.updated_at});}
 async save(p:Principal,r:NativeTranscriptionRow,input:z.infer<typeof transcriptionSaveInput>){
  await this.scope(p,r.workspace_id,true);const{snapshot}=await this.current(p,r);this.version(r,input.version);if(!['review','applied'].includes(r.status)||r.review_version!==input.reviewVersion)throw new AppError('TRANSCRIPTION_REVIEW_CONFLICT','校对版本或状态已变化，请载入当前记录。',409);await this.completed(r);const{review}=validateTranscriptionReview({segments:input.segments,note:input.note},snapshot),digest=transcriptionReviewHash(r.input_hash,review),json=JSON.stringify(review);
  await this.db.query("UPDATE studio_transcriptions SET status='review',version=version+1,review=$1,review_version=review_version+1,review_hash=$2,source_id=NULL,updated_at=dg_utc_now() WHERE id=$3",[json,digest,r.id]);await this.db.query('INSERT INTO studio_transcription_revisions VALUES($1,$2,$3,$4,$5,dg_utc_now())',[r.id,r.review_version+1,json,digest,p.userId]);return r.id;
 }
 async control(p:Principal,r:NativeTranscriptionRow,version:number,action:'cancel'|'retry'){
  await this.scope(p,r.workspace_id,true);this.version(r,version);if(r.withdrawn_at)throw new AppError('TRANSCRIPTION_WITHDRAWN','已撤回转写不能恢复，请新建任务。',409);
  if(action==='cancel'){if(!['queued','transcribing'].includes(r.status))throw new AppError('TRANSCRIPTION_STATE','只能取消排队或正在转写的任务。',409);await this.db.query("UPDATE studio_transcriptions SET status='cancelled',version=version+1,lease_token=NULL,lease_until=NULL,updated_at=dg_utc_now() WHERE id=$1",[r.id]);}
  else{await this.current(p,r);if(!['failed','cancelled','stale'].includes(r.status)||r.analysis||r.attempts>=3)throw new AppError('TRANSCRIPTION_RETRY_LIMIT','当前状态不能重试，或三次执行机会已用完，请新建任务。',409);if((await this.db.query("SELECT 1 FROM studio_transcriptions WHERE tenant_id=$1 AND workspace_id=$2 AND actor_id=$3 AND input_hash=$4 AND app_env=$5 AND id<>$6 AND status IN('queued','transcribing')",[r.tenant_id,r.workspace_id,r.actor_id,r.input_hash,r.app_env,r.id])).rowCount)throw new AppError('TRANSCRIPTION_ACTIVE_EXISTS','相同视频和配置已有活动任务。',409);await this.db.query("UPDATE studio_transcriptions SET status='queued',version=version+1,progress=0,error_code=NULL,error_message=NULL,lease_token=NULL,lease_until=NULL,updated_at=dg_utc_now() WHERE id=$1",[r.id]);}return r.id;
 }
 async withdraw(p:Principal,r:NativeTranscriptionRow,version:number){await this.scope(p,r.workspace_id,true);this.version(r,version);if(r.withdrawn_at)throw new AppError('TRANSCRIPTION_WITHDRAWN','转写已经撤回。',409);await this.db.query("UPDATE studio_transcriptions SET withdrawn_at=dg_utc_now(),status=CASE WHEN status IN('queued','transcribing') THEN 'cancelled' ELSE status END,lease_token=NULL,lease_until=NULL,version=version+1,updated_at=dg_utc_now() WHERE id=$1",[r.id]);return r.id;}
 async confirm(p:Principal,r:NativeTranscriptionRow,input:z.infer<typeof transcriptionConfirmInput>){
  await this.scope(p,r.workspace_id,true);const{snapshot}=await this.current(p,r);await this.sources.rights(p,r.workspace_id,input.rights);const complete=await this.completed(r);
  if(complete.analysis.simulated||complete.analysis.provider!=='windows-offline-asr')throw new AppError('TRANSCRIPTION_REAL_REQUIRED','模拟转写不能登记为真实视频内容来源。',409);
  if(r.review_version!==input.reviewVersion||r.review_hash!==input.reviewHash||!['review','applied'].includes(r.status)||!complete.text.trim())throw new AppError('TRANSCRIPTION_REVIEW_CONFLICT','校对版本、摘要或内容已变化，请载入并听原声校对。',409);
  const confirmationHash=nativeTranscriptionHash({reviewVersion:input.reviewVersion,reviewHash:input.reviewHash,name:input.name,rights:input.rights,listeningReviewed:input.listeningReviewed}),old=(await this.db.query<{source_id:string;confirmation_hash:string}>('SELECT source_id,confirmation_hash FROM studio_transcription_sources WHERE transcription_id=$1 AND review_version=$2',[r.id,r.review_version])).rows[0];
  if(old){if(old.confirmation_hash!==confirmationHash)throw new AppError('TRANSCRIPTION_CONFIRM_CONFLICT','该校对版本已经按其他名称或授权登记，请新建校对版本。',409);await this.sources.validate(p,await this.sources.source(p,old.source_id));return old.source_id;}this.version(r,input.version);
  const recognizer=complete.analysis.recognizer!,origin={mode:'reviewed_video_asr',assetId:snapshot.source.id,assetVersion:snapshot.source.version,assetSHA256:snapshot.source.sha256,videoDurationMs:snapshot.source.specs.durationMs,transcriptionId:r.id,reviewVersion:r.review_version,reviewSHA256:r.review_hash!,analysisSHA256:r.analysis_hash!,provider:'windows-offline-asr',recognizerId:recognizer.id,recognizerName:recognizer.name,locale:recognizer.locale,sourceStartMs:snapshot.configuration.startMs,sourceDurationMs:snapshot.configuration.durationMs,sourceSynthetic:snapshot.source.synthetic,recognizedSegments:complete.analysis.segments.length,recognizedCharacters:complete.analysis.segments.reduce((n,s)=>n+s.text.length,0),humanChangedText:canonical(complete.review.segments)!==canonical(complete.analysis.segments.map(({id,startMs,endMs,text})=>({id,startMs,endMs,text}))),transcriptOrigin:'asr_human_reviewed',listeningReviewed:true};
  const raw=Buffer.from(canonical({inputHash:r.input_hash,analysisSHA256:r.analysis_hash,reviewSHA256:r.review_hash,review:complete.review,text:complete.text})),capture=capturePlainText(complete.text,raw,['离线ASR可能错词或漏词；正文由当前账号听原声校对确认。']),material=await this.sources.objects.write(raw),expiresAt=[new Date(input.rights.expiresAt).toISOString(),snapshot.expiresAt].sort()[0],body=contentSourceInput.parse({workspaceId:r.workspace_id,name:input.name,kind:'video',assetId:snapshot.source.id,assetVersion:snapshot.source.version,transcript:complete.text,transcriptOrigin:'manual',rights:input.rights} satisfies z.infer<typeof contentSourceInput>);
  const sourceId=await this.sources.create(p,body,{...capture,origin,material,expiresAt});await this.db.query('INSERT INTO studio_transcription_sources VALUES($1,$2,$3,$4,$5,$6,dg_utc_now())',[sourceId,r.id,r.review_version,r.review_hash,confirmationHash,p.userId]);await this.db.query("UPDATE studio_transcriptions SET source_id=$1,status='applied',version=version+1,updated_at=dg_utc_now() WHERE id=$2",[sourceId,r.id]);await this.sources.validate(p,await this.sources.source(p,sourceId));return sourceId;
 }
 async verifySource(p:Principal,s:NativeContentSource){
  const binding=(await this.db.query<{transcription_id:string;review_version:string;review_hash:string}>('SELECT * FROM studio_transcription_sources WHERE source_id=$1',[s.id])).rows[0];if(!binding)throw new AppError('TRANSCRIPTION_SOURCE_CHANGED','校对稿缺少已确认来源凭据。',409);
  const r=await this.row(p,binding.transcription_id,false,true),{snapshot}=await this.current(p,r),complete=await this.completed(r),o=JSON.parse(s.origin) as Record<string,unknown>;
  if(r.status!=='applied'||r.source_id!==s.id||r.workspace_id!==s.workspace_id||r.review_version!==integer(binding.review_version)||r.review_hash!==binding.review_hash||complete.analysis.simulated||complete.analysis.provider!=='windows-offline-asr'||o.mode!=='reviewed_video_asr'||o.transcriptOrigin!=='asr_human_reviewed'||o.listeningReviewed!==true||o.transcriptionId!==r.id||o.reviewVersion!==r.review_version||o.reviewSHA256!==r.review_hash||o.analysisSHA256!==r.analysis_hash||o.assetId!==snapshot.source.id||o.assetVersion!==snapshot.source.version||o.assetSHA256!==snapshot.source.sha256||o.sourceStartMs!==snapshot.configuration.startMs||o.sourceDurationMs!==snapshot.configuration.durationMs||s.text!==complete.text||s.expires_at>snapshot.expiresAt)throw new AppError('TRANSCRIPTION_SOURCE_CHANGED','转写已撤回、重新校对，或来源凭据与当前校对版本不一致；请采用新来源。',409);
  return{row:r,snapshot,analysis:complete.analysis,review:complete.review};
 }
 async workerContext(lease:NativeTranscriptionRow,completed=false){
  const p=await this.core.principal(lease.actor_id);requirePermission(p,'studio.write');const r=await this.row(p,lease.id,true);if(r.input_hash!==lease.input_hash||r.actor_id!==lease.actor_id||r.tenant_id!==lease.tenant_id||!(await this.db.query<{ok:boolean}>('SELECT dg_native_transcription_valid($1,$2,$3) AS ok',[lease.id,lease.lease_token,completed])).rows[0].ok)throw new AppError('TRANSCRIPTION_LEASE_CHANGED','转写任务租约或固定输入已变化，旧结果未保存。',409);return{row:r,...await this.current(p,r)};
 }
 async semanticSource(p:Principal,sourceId:string,assetId:string):Promise<SemanticSourceSnapshot>{
  const source=await this.sources.source(p,sourceId);await this.sources.validate(p,source);
  if(source.kind!=='video'||JSON.parse(source.origin).mode!=='reviewed_video_asr')throw new AppError('SEMANTIC_SOURCE_REQUIRED','语义拆条需要这份原视频已确认的带时间校对稿；无时间正文不可替代。',409);
  const c=await this.verifySource(p,source);if(c.snapshot.source.id!==assetId||!c.review.segments.length)throw new AppError('SEMANTIC_SOURCE_REQUIRED','校对稿不属于这份视频或没有有效时间片段。',409);
  return semanticSourceSnapshot.parse({contentSourceId:source.id,contentSourceVersion:source.version,textSha256:source.text_sha256,transcriptionId:c.row.id,reviewVersion:c.row.review_version,reviewSha256:c.row.review_hash,analysisSha256:c.row.analysis_hash,sourceStartMs:c.snapshot.configuration.startMs,sourceDurationMs:c.snapshot.configuration.durationMs,timing:'phrase',synthetic:c.snapshot.source.synthetic,segments:c.review.segments});
 }
}
