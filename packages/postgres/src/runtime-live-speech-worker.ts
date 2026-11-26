import {liveSpeechHash} from '../../domain/src/live-speech.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {AppError,canonical} from '../../domain/src/index.js';
import {speechTextInput,systemVoiceSchema} from '../../contracts/src/index.js';
import {synthesizeSystemSpeech,inspectSystemWav} from '../../providers/src/system-speech.js';
import {mediaTools,runMediaTool} from '../../media/src/media-tools.js';
import {fileDigest} from '../../media/src/files.js';
import {assertNoLinks} from '../../recovery/src/files.js';
import {NativeLiveSpeech} from './runtime-live-speech.js';
import {NativePrivateObjects} from './runtime-objects.js';
import {nativeLiveSpeechReceipt,nativeLiveSpeechJobRow,nativeLiveSpeechPlanRow,type NativeLiveSpeechPlanRow,type NativeLiveSpeechJobRow,type NativeLiveSpeechReceipt} from './runtime-live-speech-sources.js';
import type {NativeCoreRepository} from './runtime-repository.js';

export class NativeLiveSpeechWorker{
 readonly service:NativeLiveSpeech;readonly objects:NativePrivateObjects;
 constructor(readonly core:NativeCoreRepository,readonly root=process.cwd(),readonly engine=synthesizeSystemSpeech){this.service=new NativeLiveSpeech(core,root);this.objects=new NativePrivateObjects(core.db.config);}
 get db(){return this.core.db;}
 async claim(){return this.db.transaction(async()=>{
  const row=(await this.db.query<{value:NativeLiveSpeechJobRow|null}>('SELECT dg_native_live_speech_claim() AS value')).rows[0].value;
  const unfinished=(await this.db.query<NativeLiveSpeechPlanRow>("SELECT p.* FROM live_speech_plans p WHERE p.environment='mock' AND p.app_env=$1 AND p.status='building' AND p.result_hash IS NULL AND EXISTS(SELECT 1 FROM live_speech_jobs j WHERE j.plan_id=p.id AND j.source::jsonb->>'kind'='cue' AND(j.status IN('failed','cancelled','stale') OR j.withdrawn_at IS NOT NULL OR j.invalidated_at IS NOT NULL))",[this.db.config.appEnv])).rows;
  for(const plan of unfinished)await this.service.refresh(nativeLiveSpeechPlanRow(plan));return row?nativeLiveSpeechJobRow(row):null;
 });}
 async current(lease:NativeLiveSpeechJobRow,complete=false){
  if(!(await this.db.query<{valid:boolean}>('SELECT dg_native_live_speech_valid($1,$2,$3) AS valid',[lease.id,lease.lease_token,complete])).rows[0].valid)throw new AppError('LIVE_SPEECH_LEASE','系统播音任务来源或原租约已变化，旧语音未保存。',409);
  const row=nativeLiveSpeechJobRow((await this.db.query<NativeLiveSpeechJobRow>('SELECT * FROM live_speech_jobs WHERE id=$1',[lease.id])).rows[0]);if(complete){const p=await this.core.principal(row.actor_id);return{row,p,...await this.service.speech.current(p,row,true)};}return{row,...await this.service.workCurrent(row)};
 }
 async complete(lease:NativeLiveSpeechJobRow,receipt:NativeLiveSpeechReceipt,onStaged?:(value:{jobId:string;receipt:NativeLiveSpeechReceipt})=>Promise<void>){return this.db.transaction(async()=>{
  const context=await this.current(lease);for(const f of this.service.speech.files(receipt))await this.objects.verify(f,115200000);
  await this.db.query('SELECT dg_native_commit_live_speech($1,$2,$3,$4,$5)',[lease.id,lease.lease_token,lease.input_hash,canonical(receipt),liveSpeechHash(receipt)]);
  await this.service.refresh(context.plan);await this.core.event(context.p.tenantId,context.session.workspace_id,lease.id,'live.speech.ready');await onStaged?.({jobId:lease.id,receipt});
  await this.current(lease,true);for(const f of this.service.speech.files(receipt))await this.objects.verify(f,115200000);await this.current(lease,true);
 });}
 async runOne(stopSignal:AbortSignal=new AbortController().signal,onClaim?:(lease:NativeLiveSpeechJobRow)=>void,onStaged?:Parameters<NativeLiveSpeechWorker['complete']>[2]){
  if(stopSignal.aborted)return false;const lease=await this.claim();if(!lease)return false;onClaim?.(lease);
  const abort=new AbortController(),signal=AbortSignal.any([stopSignal,abort.signal]),workRoot=path.resolve(this.db.config.dataDir,'live-speech-work'),directory=path.join(workRoot,lease.id+'-'+lease.lease_token);let timer:ReturnType<typeof setInterval>|undefined,pending:Promise<void>|undefined;
  try{
   const initial=await this.db.transaction(()=>this.current(lease)),voice=systemVoiceSchema.parse(JSON.parse(initial.plan.voice));await fs.mkdir(directory,{recursive:true,mode:0o700});assertNoLinks(directory);
   timer=setInterval(()=>{if(pending)return;pending=this.db.transaction(async()=>{await this.current(lease);if(!(await this.db.query<{valid:boolean}>('SELECT dg_native_live_speech_renew($1,$2) AS valid',[lease.id,lease.lease_token])).rows[0].valid)throw new AppError('LIVE_SPEECH_LEASE','原播音执行槽位已变化。',409);}).catch(()=>abort.abort()).finally(()=>{pending=undefined;});},1000);
   const generated=await this.engine({root:this.root,dataDir:this.db.config.dataDir,workDir:directory,voiceId:voice.id,speech:speechTextInput.parse({text:initial.source.text,locale:voice.locale}),signal});await this.db.transaction(()=>this.current(lease));
   const wav=inspectSystemWav(await fs.readFile(generated.audioFile));if(generated.voice.id!==voice.id||generated.voice.name!==voice.name||generated.voice.locale!==voice.locale||wav.sha256!==generated.format.sha256||wav.pcmSHA256!==generated.format.pcmSHA256||wav.size!==generated.format.size||wav.durationMs!==generated.format.durationMs||wav.durationMs>600000)throw new AppError('LIVE_SPEECH_WAV_INVALID','实际系统声音、WAV或PCM回执不符，未保存。',409);
   const pcmFile=path.join(directory,'broadcast.pcm');await runMediaTool(mediaTools(this.root).ffmpeg,['-v','error','-nostdin','-n','-protocol_whitelist','file,pipe','-i',generated.audioFile,'-map','0:a:0','-vn','-ac','2','-ar','48000','-c:a','pcm_s16le','-f','s16le',pcmFile],signal,60000);
   const bytes=await fileDigest(pcmFile,signal);if(!bytes.size||bytes.size%4||bytes.size>115200000)throw new AppError('LIVE_SPEECH_PCM_INVALID','直播PCM不符合48kHz双声道16位规格。',409);
   const frames=Math.ceil(bytes.size/8000);if(initial.source.kind==='cue'&&frames*1000/24>initial.source.durationMs+1)throw new AppError('LIVE_SPEECH_CUE_TOO_SHORT','实际配音长于固定节目段，请延长节目并新建场次；不会截掉后半句。',409);if(initial.source.kind!=='cue'&&frames>1440)throw new AppError('LIVE_SPEECH_REPLY_TOO_LONG','实际插播语音超过一分钟，请缩短并重新准备。',409);
   const object=await this.objects.install(generated.audioFile,67108864,signal),pcmObject=await this.objects.install(pcmFile,115200000,signal),receipt=nativeLiveSpeechReceipt.parse({schemaVersion:1,pipeline:'native-live-system-speech-v1',jobId:lease.id,inputHash:lease.input_hash,voice,wav:{object,format:generated.format},pcm:{object:pcmObject,format:{sampleRate:48000,channels:2,bitsPerSample:16,samples:bytes.size/4,frames,size:bytes.size,sha256:bytes.sha256}}});
   if(object.sha256!==wav.sha256||Number(object.size)!==wav.size||pcmObject.sha256!==bytes.sha256||Number(pcmObject.size)!==bytes.size)throw new AppError('LIVE_SPEECH_COPY_CHANGED','保存后的实际语音摘要不符。',409);
   clearInterval(timer);timer=undefined;await pending;signal.throwIfAborted();await this.complete(lease,receipt,onStaged);
  }catch(e){if(timer)clearInterval(timer);timer=undefined;await pending;await this.db.transaction(async()=>{let stale=false;try{await this.service.workCurrent(lease);}catch(error){if(!(error instanceof AppError))throw error;stale=true;}await this.db.query('SELECT dg_native_live_speech_fail($1,$2,$3,$4,$5,$6)',[lease.id,lease.lease_token,stale?'LIVE_SPEECH_SOURCE_CHANGED':stopSignal.aborted?'LIVE_SPEECH_INTERRUPTED':e instanceof AppError?e.code:'LIVE_SPEECH_FAILED',stale?'权限、节目、答复或场控已变化，旧语音未保存。':stopSignal.aborted?'服务停止，保留原任务等待有界恢复。':e instanceof AppError?e.message:'本机系统播音失败，请核对声音或缩短文字后重试；没有返回模拟语音。',stopSignal.aborted,stale]);const plan=(await this.db.query<NativeLiveSpeechPlanRow>('SELECT * FROM live_speech_plans WHERE id=$1',[lease.plan_id])).rows[0];if(plan)await this.service.refresh(nativeLiveSpeechPlanRow(plan));});
  }finally{if(timer)clearInterval(timer);await pending;await this.db.transaction(async()=>{await this.db.query('SELECT dg_native_live_speech_release($1,$2)',[lease.id,lease.lease_token]);});if(directory.startsWith(workRoot+path.sep)&&path.dirname(directory)===workRoot){assertNoLinks(directory,true);await fs.rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:150});}}
  return true;
 }
}
