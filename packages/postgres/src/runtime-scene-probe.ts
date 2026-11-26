import {createHash} from 'node:crypto';
import {z} from 'zod';
import {AppError,canonical,requirePermission,type Principal} from '../../domain/src/index.js';
import {inspectMedia,syntheticToneWav} from '../../media/src/index.js';
import {selectAsrProvider,selectTtsProvider,type RuntimeAdapters} from '../../providers/src/index.js';
import {runtimeProbeSchema,type SceneAppSnapshot,type RuntimeProbe} from '../../contracts/src/index.js';
import type {NativeScenes} from './runtime-scenes.js';

export async function runNativeSceneProbe(scenes:NativeScenes,snapshot:SceneAppSnapshot,fixture:'reception'|'handoff',p:Principal,adapters:RuntimeAdapters={}):Promise<RuntimeProbe>{
 requirePermission(p,'knowledge.manage');await scenes.active(p,snapshot);
 const asr=selectAsrProvider(snapshot.asrProvider,'mock',scenes.appEnv,adapters),tts=selectTtsProvider(snapshot.ttsProvider,'mock',scenes.appEnv,adapters),controller=new AbortController(),audio=syntheticToneWav(400,440);let produced:Buffer|undefined;
 let rejectTimeout:(e:Error)=>void=()=>{};const timeout=new Promise<never>((_,reject)=>{rejectTimeout=reject;}),timer=setTimeout(()=>{controller.abort();rejectTimeout(new AppError('RUNTIME_TIMEOUT','模拟语音链路检查超时，请核对所选适配器。',504));},8000);
 try{
  const transcript=z.strictObject({text:z.string().trim().min(1).max(500),simulated:z.literal(true)}).parse(await Promise.race([asr.transcribe({audio,fixture,signal:controller.signal}),timeout]));
  const current=await scenes.core.principal(p.userId);requirePermission(current,'knowledge.manage');const answer=await scenes.answer(current,snapshot,transcript.text),synthesis=tts.synthesize({text:answer.text,signal:controller.signal}).then(r=>{if(controller.signal.aborted&&Buffer.isBuffer(r.audio))r.audio.fill(0);return r;}),result=await Promise.race([synthesis,timeout]);produced=result.audio;
  if(!Buffer.isBuffer(result.audio)||result.simulated!==true||result.kind!=='synthetic_tones')throw new AppError('PROVIDER_CONTRACT_INVALID','模拟TTS返回无效，未采用结果。',502);const media=inspectMedia(result.audio);if(media.mediaType!=='audio/wav')throw new AppError('PROVIDER_CONTRACT_INVALID','模拟TTS未返回有效PCM WAV。',502);
  const latest=await scenes.core.principal(p.userId);requirePermission(latest,'knowledge.manage');if(canonical(await scenes.answer(latest,snapshot,transcript.text))!==canonical(answer))throw new AppError('STATE_CONFLICT','检查期间资料或场景已变化，旧结果未采用。',409);
  return runtimeProbeSchema.parse({simulated:true,microphoneUsed:false,fixture,asr:{provider:asr.id,...transcript},model:{provider:answer.provider,text:answer.text,toolProposals:answer.toolProposals,simulated:true},tts:{provider:tts.id,mediaType:'audio/wav',kind:'synthetic_tones',durationMs:media.specs.durationMs,sha256:createHash('sha256').update(result.audio).digest('hex'),contentBase64:result.audio.toString('base64')},businessActionsExecuted:false});
 }catch(e){if(e instanceof AppError)throw e;throw new AppError('PROVIDER_CONTRACT_INVALID','模拟链路返回不符合契约，未采用结果。',502);}finally{clearTimeout(timer);controller.abort();audio.fill(0);produced?.fill(0);}
}
