import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {AppError} from '../../domain/src/index.js';
import {type TranscriptionAnalysis,type TranscriptionReview} from '../../contracts/src/index.js';
import {transcriptionReviewHash} from '../../domain/src/transcriptions.js';
import {extractTranscriptionAudio,inspectTranscriptionAudio} from '../../media/src/transcription-audio.js';
import {recognizeSystemAudio} from '../../providers/src/system-asr.js';
import {NativeMediaFiles} from './runtime-media-files.js';
import {NativeTranscriptions,nativeTranscriptionHash,nativeTranscriptionRow,type NativeTranscriptionRow} from './runtime-transcriptions.js';
import type {NativeObject} from './runtime-objects.js';
import type {NativeCoreRepository} from './runtime-repository.js';

export class NativeTranscriptionWorker {
 readonly service:NativeTranscriptions;
 constructor(readonly core:NativeCoreRepository,readonly root=process.cwd(),readonly engine=recognizeSystemAudio){this.service=new NativeTranscriptions(core,root);}
 get db(){return this.core.db;}
 async claim(){return this.db.transaction(async()=>{const value=(await this.db.query<{value:NativeTranscriptionRow|null}>('SELECT dg_native_transcription_claim() AS value')).rows[0].value;return value?nativeTranscriptionRow(value):null;});}
 async audio(value:NativeObject|null,analysis:TranscriptionAnalysis){
  if(analysis.simulated){if(value)throw new AppError('TRANSCRIPTION_MOCK_REPORT','模拟报告不得包含原声文件。',409);return;}
  if(!value)throw new AppError('TRANSCRIPTION_AUDIO_MISSING','真实转写缺少实际解码原声。',409);
  await this.service.sources.objects.verify(value,19201024);const actual=await inspectTranscriptionAudio(new NativeMediaFiles(this.db.config).file(value.storage_key));
  if(actual.sha256!==value.sha256||actual.size!==Number(value.size)||actual.sha256!==analysis.audioSHA256||actual.durationMs!==analysis.audioDurationMs)throw new AppError('TRANSCRIPTION_AUDIO_CHANGED','实际PCM原声与转写摘要或时长不一致，未保存。',409);
 }
 async complete(lease:NativeTranscriptionRow,value:TranscriptionAnalysis,audio:NativeObject|null,onStaged?:(data:{jobId:string;analysis:TranscriptionAnalysis;audio:NativeObject|null})=>Promise<void>){
  return this.db.transaction(async()=>{const c=await this.service.workerContext(lease),analysis=this.service.validateAnalysis(c.row,c.snapshot,c.recognizer,value);await this.audio(audio,analysis);
   const review:TranscriptionReview={segments:analysis.segments.map(({id,startMs,endMs,text})=>({id,startMs,endMs,text})),note:analysis.simulated?'明确模拟报告，没有识别正文，不能确认真实来源。':'请听解码原声逐段核对词句与时间；确认前不用于脚本或语义拆条。'},reviewHash=transcriptionReviewHash(lease.input_hash,review);
   await this.db.query('SELECT dg_native_commit_transcription($1,$2,$3,$4,$5,$6,$7,$8)',[lease.id,lease.lease_token,lease.input_hash,JSON.stringify(analysis),nativeTranscriptionHash(analysis),audio?{storageKey:audio.storage_key,sha256:audio.sha256,size:Number(audio.size)}:null,JSON.stringify(review),reviewHash]);await this.core.event(lease.tenant_id,lease.workspace_id,lease.id,'transcription.ready');await onStaged?.({jobId:lease.id,analysis,audio});await this.service.workerContext(lease,true);await this.audio(audio,analysis);await this.service.workerContext(lease,true);
  });
 }
 async runOne(stopSignal?:AbortSignal,onClaim?:(lease:NativeTranscriptionRow)=>void,onStaged?:Parameters<NativeTranscriptionWorker['complete']>[3]){
  if(stopSignal?.aborted)return false;const lease=await this.claim();if(!lease)return false;onClaim?.(lease);const abort=new AbortController(),stop=()=>abort.abort();stopSignal?.addEventListener('abort',stop,{once:true});if(stopSignal?.aborted)stop();let timer:ReturnType<typeof setInterval>|undefined,pendingTick:Promise<void>|undefined,progress=0;
  const tick=async()=>{await this.db.transaction(async()=>{if(!(await this.db.query<{ok:boolean}>('SELECT dg_native_transcription_hold($1,$2) AS ok',[lease.id,lease.lease_token])).rows[0].ok)throw new AppError('TRANSCRIPTION_LEASE_CHANGED','转写执行槽位已变化。',409);});await this.db.transaction(async()=>{await this.service.workerContext(lease);if(!(await this.db.query<{ok:boolean}>('SELECT dg_native_transcription_renew($1,$2,$3) AS ok',[lease.id,lease.lease_token,Math.min(.95,progress)])).rows[0].ok)throw new AppError('TRANSCRIPTION_LEASE_CHANGED','旧转写租约未续约。',409);});};
  try{const c=await this.db.transaction(()=>this.service.workerContext(lease));timer=setInterval(()=>{if(pendingTick)return;pendingTick=tick().catch(()=>abort.abort()).finally(()=>{pendingTick=undefined;});},500);const configuration=c.snapshot.configuration;let analysis:TranscriptionAnalysis,audio:NativeObject|null=null;
   if(configuration.provider==='mock-file-asr')analysis={provider:'mock-file-asr',recognizer:null,simulated:true,timing:'phrase',inputStreamEnded:false,rejectedCount:0,audioDurationMs:configuration.durationMs,audioSHA256:null,segments:[],warnings:['明确模拟报告，没有真实执行解码或ASR，不能用于真实来源。']};
   else{
    const directory=path.join(this.db.config.dataDir,'transcription-work',lease.id+'-'+lease.lease_token);await fs.mkdir(directory,{recursive:true,mode:0o700});const source=path.join(directory,'source'+(c.asset.mediaType==='video/quicktime'?'.mov':'.mp4')),audioFile=path.join(directory,randomUUID()+'.wav');await this.service.sources.objects.materialize(c.object,source,c.maximum,abort.signal);const decoded=await extractTranscriptionAudio({root:this.root,file:source,destination:audioFile,startMs:configuration.startMs,durationMs:configuration.durationMs,signal:abort.signal});progress=.15;
    const recognized=await this.engine({root:this.root,directory,audioFile,recognizerId:configuration.recognizerId,locale:configuration.locale,signal:abort.signal,onProgress:ms=>{if(Number.isFinite(ms)&&ms>=0&&ms<=configuration.durationMs+1000)progress=Math.max(progress,.15+.7*Math.min(1,ms/configuration.durationMs));}});abort.signal.throwIfAborted();
    const segments=recognized.result.segments.map(s=>({id:randomUUID(),startMs:configuration.startMs+Math.round(s.startMs),endMs:configuration.startMs+Math.round(s.startMs+s.durationMs),text:s.text,confidence:s.confidence,words:s.words}));
    analysis={provider:'windows-offline-asr',recognizer:recognized.recognizer,simulated:false,timing:'phrase',inputStreamEnded:recognized.result.inputStreamEnded,rejectedCount:recognized.result.rejectedCount,audioDurationMs:decoded.durationMs,audioSHA256:decoded.sha256,segments,warnings:['实际Windows离线文件识别，词句和分句时间可能有误，请听原声人工校对。','未执行目标说话人提取、身份识别或准确率验收。',...(segments.length?[]:['本次没有识别到可用正文；可人工添加区间内的校对片段。'])]};
    this.service.validateAnalysis(c.row,c.snapshot,c.recognizer,analysis);audio=await this.service.sources.objects.install(audioFile,19201024,abort.signal);if(audio.sha256!==decoded.sha256||Number(audio.size)!==decoded.size)throw new AppError('TRANSCRIPTION_AUDIO_CHANGED','保存后的原声与实际识别输入不一致。',409);
   }
   if(timer)clearInterval(timer);timer=undefined;await pendingTick;abort.signal.throwIfAborted();await this.complete(lease,analysis,audio,onStaged);
  }catch(e){if(timer)clearInterval(timer);timer=undefined;await pendingTick;await this.db.transaction(async()=>{let stale=false;try{const p=await this.core.principal(lease.actor_id);await this.service.current(p,lease);}catch(error){if(!(error instanceof AppError))throw error;stale=true;}const stopped=stopSignal?.aborted??false;await this.db.query('SELECT dg_native_transcription_fail($1,$2,$3,$4,$5,$6)',[lease.id,lease.lease_token,stale?'TRANSCRIPTION_SOURCE_CHANGED':stopped?'TRANSCRIPTION_INTERRUPTED':e instanceof AppError?e.code:'SYSTEM_ASR_FAILED',stale?'视频、授权或原创建人权限已变化，旧转写没有保存。':stopped?'服务停止，同一任务按剩余次数恢复。':e instanceof AppError?e.message:'本机离线转写未完成，请检查识别器后重试；没有返回模拟成功。',stopped,stale]);});}
  finally{if(timer)clearInterval(timer);await pendingTick;stopSignal?.removeEventListener('abort',stop);await this.db.transaction(async()=>{await this.db.query('SELECT dg_native_transcription_release($1,$2)',[lease.id,lease.lease_token]);});}return true;
 }
}
