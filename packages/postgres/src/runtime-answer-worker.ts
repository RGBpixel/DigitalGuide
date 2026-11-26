import fs from 'node:fs';
import path from 'node:path';
import {AppError} from '../../domain/src/index.js';
import {speechTextInput,type PresentationAnswerNativeResult} from '../../contracts/src/index.js';
import {runPresentationAnswer} from '../../providers/src/run-presentation-answer.js';
import {synthesizeSystemSpeech,inspectSystemWav} from '../../providers/src/system-speech.js';
import {NativePresentationAnswers,nativeAnswerRow,type NativeAnswerRow} from './runtime-presentation-answers.js';
import type {NativeMediaArtifact} from './runtime-media-files.js';
import type {NativeCoreRepository} from './runtime-repository.js';

type AudioFormat={sampleRate:number;channels:number;bitsPerSample:number;durationMs:number;size:number;sha256:string;pcmSHA256:string};
export class NativeAnswerWorker{
 readonly service:NativePresentationAnswers;
 constructor(readonly core:NativeCoreRepository,readonly root=process.cwd(),readonly engines={answer:runPresentationAnswer,speech:synthesizeSystemSpeech}){this.service=new NativePresentationAnswers(core,root);}
 get db(){return this.core.db;}
 async claim(){return this.db.transaction(async()=>{const r=(await this.db.query<{value:NativeAnswerRow|null}>('SELECT dg_native_answer_claim() AS value')).rows[0].value;return r?nativeAnswerRow(r):null;});}
 async complete(lease:NativeAnswerRow,native:PresentationAnswerNativeResult,audio:NativeMediaArtifact,format:AudioFormat,onStaged?:(data:{jobId:string;questionId:string;sessionId:string;audioKey:string;format:AudioFormat})=>Promise<void>){
  return this.db.transaction(async()=>{
   const context=await this.service.workerContext(lease,false,true);this.service.validateNative(context,native);await this.service.files.verify(audio);
   await this.db.query('SELECT dg_native_commit_answer($1,$2,$3,$4,$5,$6,$7)',[lease.id,lease.lease_token,lease.input_hash,JSON.stringify(native.result),JSON.stringify(native.evidence),audio.storage_key,JSON.stringify(format)]);
   await this.core.event(lease.tenant_id,lease.workspace_id,lease.id,'presentation.auto_answered');
   await onStaged?.({jobId:lease.id,questionId:lease.question_id,sessionId:lease.session_id,audioKey:audio.storage_key,format});
   this.service.validateNative(await this.service.workerContext(lease,true,true),native);await this.service.files.verify(audio);await this.service.workerContext(lease,true,true);
  });
 }
 async runOne(stopSignal?:AbortSignal,onClaim?:(lease:NativeAnswerRow)=>void,onStaged?:Parameters<NativeAnswerWorker['complete']>[4]){
  if(stopSignal?.aborted)return false;const lease=await this.claim();if(!lease)return false;onClaim?.(lease);
  const abort=new AbortController(),stop=()=>abort.abort();stopSignal?.addEventListener('abort',stop,{once:true});if(stopSignal?.aborted)stop();let timer:ReturnType<typeof setInterval>|undefined,pendingTick:Promise<void>|undefined,progress=0;
  const tick=async()=>{
   await this.db.transaction(async()=>{const held=(await this.db.query<{ok:boolean}>('SELECT dg_native_answer_hold($1,$2) AS ok',[lease.id,lease.lease_token])).rows[0].ok;if(!held)throw new AppError('PRESENTATION_ANSWER_LEASE','本机CPU租约已变化，停止旧辅助进程。',409);});
   await this.db.transaction(async()=>{await this.service.workerContext(lease);const ok=(await this.db.query<{ok:boolean}>('SELECT dg_native_answer_renew($1,$2,$3) AS ok',[lease.id,lease.lease_token,Math.min(.96,progress)])).rows[0].ok;if(!ok)throw new AppError('PRESENTATION_ANSWER_LEASE','本机答疑已失去当前租约，未续约。',409);});
  };
  try{
   const context=await this.db.transaction(()=>this.service.workerContext(lease));if(context.configuration.engine.policy!=='ppt-question-parts-v2')throw new AppError('PG_PRESENTATION_POLICY_UNSUPPORTED','原生场次仅接受明确配置的逐子问策略，不重新解释旧任务。',409);
   timer=setInterval(()=>{if(pendingTick)return;pendingTick=tick().catch(()=>abort.abort()).finally(()=>{pendingTick=undefined;});},500);
   const directory=path.join(this.db.config.dataDir,'presentation-answer-work',lease.id+'-'+lease.lease_token);await fs.promises.mkdir(directory,{recursive:true,mode:0o700});
   const native=await this.engines.answer({root:this.root,directory,request:context.request,engine:context.configuration.engine},abort.signal,n=>{if(Number.isFinite(n)&&n>=0&&n<=1)progress=Math.max(progress,n*.8);});
   await this.db.transaction(async()=>this.service.validateNative(await this.service.workerContext(lease),native));abort.signal.throwIfAborted();
   const speech=await this.engines.speech({root:this.root,dataDir:this.db.config.dataDir,workDir:directory,voiceId:context.configuration.voice.id,speech:speechTextInput.parse({text:native.result.answer,locale:context.configuration.voice.locale}),signal:abort.signal});
   if(speech.voice.id!==context.configuration.voice.id||speech.voice.locale!==context.configuration.voice.locale||speech.voice.name!==context.configuration.voice.name)throw new AppError('PRESENTATION_ANSWER_VOICE_CHANGED','实际系统声音与已核对配置不符，未采用语音。',409);
   const actual=inspectSystemWav(await fs.promises.readFile(speech.audioFile));if(actual.sha256!==speech.format.sha256||actual.pcmSHA256!==speech.format.pcmSHA256||actual.size!==speech.format.size||actual.durationMs>240000)throw new AppError('PRESENTATION_ANSWER_AUDIO_INVALID','实际语音摘要或时长不符，未采用。',409);
   const format:AudioFormat={sampleRate:actual.sampleRate,channels:actual.channels,bitsPerSample:actual.bitsPerSample,durationMs:actual.durationMs,size:actual.size,sha256:actual.sha256,pcmSHA256:actual.pcmSHA256},audio=await this.service.files.install(speech.audioFile,directory,'audio/wav',abort.signal);progress=.96;
   if(timer)clearInterval(timer);timer=undefined;await pendingTick;abort.signal.throwIfAborted();await this.complete(lease,native,audio,format,onStaged);
  }catch(e){
   if(timer)clearInterval(timer);timer=undefined;await pendingTick;
   await this.db.transaction(async()=>{let stale=false;try{await this.service.workerContext(lease);}catch(error){if(!(error instanceof AppError))throw error;stale=true;}
    const stopped=stopSignal?.aborted??false,code=stale?'PRESENTATION_ANSWER_STALE':stopped?'PRESENTATION_ANSWER_INTERRUPTED':e instanceof AppError?e.code:'PRESENTATION_ANSWER_FAILED',message=stale?'问题、成员权限或讲稿已变化，旧答复没有保存。':stopped?'服务停止，保留同一任务等待有界恢复。':e instanceof AppError?e.message:'本机答疑未完成，请转人工或检查固定模型和系统声音。';
    await this.db.query('SELECT dg_native_answer_fail($1,$2,$3,$4,$5,$6)',[lease.id,lease.lease_token,code,message,stopped,stale]);
   });
  }finally{if(timer)clearInterval(timer);await pendingTick;stopSignal?.removeEventListener('abort',stop);await this.db.transaction(async()=>{await this.db.query('SELECT dg_native_answer_release($1,$2)',[lease.id,lease.lease_token]);});}
  return true;
 }
}
