import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {AppError} from '@digitalguide/domain';
import type {Repository} from '@digitalguide/database';
import {speechTextInput} from '@digitalguide/contracts';
import {runPresentationAnswer} from '../../../packages/providers/src/run-presentation-answer.js';
import {synthesizeSystemSpeech,inspectSystemWav} from '../../../packages/providers/src/system-speech.js';
import {fileDigest} from '../../../packages/media/src/files.js';
import {PresentationAnswers,type PresentationAnswerRow} from '../../api/src/presentation-answers.js';
import {claimNativeModel,renewNativeModel,releaseNativeModel} from './native-model-lease.js';
import type {Config} from '../../api/src/config.js';
const now=()=>new Date().toISOString();
export async function runPresentationAnswerJob(repo:Repository,config:Config,stopSignal=new AbortController().signal){
 if(stopSignal.aborted)return false;const service=new PresentationAnswers(repo,config),token=randomUUID(),claimed=repo.transaction(()=>{
  repo.run("UPDATE studio_presentation_answer_jobs SET status=CASE WHEN attempts>=3 THEN 'failed' ELSE 'queued' END,version=version+1,lease_token=NULL,lease_until=NULL,error_code='PRESENTATION_ANSWER_INTERRUPTED',error_message='上次答疑中断，保留同一问题等待有界恢复。',updated_at=? WHERE environment=? AND app_env=? AND status='processing' AND (lease_until IS NULL OR lease_until<=?)",now(),config.providerMode,config.appEnv,now());
  const row=repo.get<PresentationAnswerRow>("SELECT * FROM studio_presentation_answer_jobs WHERE environment=? AND app_env=? AND status='queued' AND attempts<3 ORDER BY created_at,id LIMIT 1",config.providerMode,config.appEnv);if(!row||!claimNativeModel(repo,'presentation-answer',row.id,token))return null;
  repo.run("UPDATE studio_presentation_answer_jobs SET status='processing',version=version+1,attempts=attempts+1,lease_token=?,lease_until=?,error_code=NULL,error_message=NULL,updated_at=? WHERE id=?",token,new Date(Date.now()+30000).toISOString(),now(),row.id);return repo.get<PresentationAnswerRow>('SELECT * FROM studio_presentation_answer_jobs WHERE id=?',row.id)!;
 });if(!claimed)return false;
 const workRoot=path.resolve(config.dataDir,'presentation-answer-work'),directory=path.join(workRoot,claimed.id+'-'+token),abort=new AbortController(),stop=()=>abort.abort();let savedFile:string|null=null,committed=false;stopSignal.addEventListener('abort',stop,{once:true});if(stopSignal.aborted)stop();
 function current(){const row=repo.get<PresentationAnswerRow>('SELECT * FROM studio_presentation_answer_jobs WHERE id=?',claimed!.id);if(!row||row.status!=='processing'||row.lease_token!==token||!row.lease_until||row.lease_until<=now()||abort.signal.aborted)throw new AppError('PRESENTATION_ANSWER_LEASE','答疑已停止或租约已变化，旧答复未保存。',409);return{row,...service.current(row)};}
 async function verifyMedia(){const before=current(),media=service.presentations.liveSource(before.p,before.session),actual=await fileDigest(media.file).catch(()=>{throw new AppError('PRESENTATION_ANSWER_MEDIA_MISSING','绑定的完整成片文件缺失，自动答疑没有继续，请重新生成并建立新场次。',409);}),after=current(),latest=service.presentations.liveSource(after.p,after.session);if(media.file!==latest.file||actual.sha256!==latest.artifact.sha256||actual.size!==latest.artifact.size)throw new AppError('PRESENTATION_ANSWER_MEDIA_CHANGED','绑定的完整成片实际摘要不符，自动答疑没有继续，请重新生成并建立新场次。',409);}
 const heartbeat=setInterval(()=>{try{if(!repo.transaction(()=>renewNativeModel(repo,token)))throw new Error('Native model lease lost');const {row}=current();repo.run('UPDATE studio_presentation_answer_jobs SET lease_until=? WHERE id=? AND lease_token=?',new Date(Date.now()+30000).toISOString(),row.id,token);}catch{abort.abort();}},1000);
 try{
  const fixed=current();await verifyMedia();await fs.mkdir(directory,{recursive:true});const native=await runPresentationAnswer({root:config.root,directory,request:fixed.request,engine:fixed.configuration.engine},abort.signal,value=>{const {row}=current();repo.run('UPDATE studio_presentation_answer_jobs SET progress=?,updated_at=? WHERE id=? AND lease_token=?',Math.min(.8,value*.8),now(),row.id,token);});service.validateNative(current().row,native);
  const speech=await synthesizeSystemSpeech({root:config.root,dataDir:config.dataDir,workDir:directory,voiceId:fixed.configuration.voice.id,speech:speechTextInput.parse({text:native.result.answer,locale:fixed.configuration.voice.locale}),signal:abort.signal});current();
  await verifyMedia();const actual=inspectSystemWav(await fs.readFile(speech.audioFile));if(actual.sha256!==speech.format.sha256||actual.size!==speech.format.size||actual.durationMs>240000)throw new AppError('PRESENTATION_ANSWER_AUDIO_INVALID','答复语音摘要不符或超过四分钟上限，未采用。',409);
  const key=randomUUID()+'.wav';savedFile=path.resolve(config.dataDir,'objects',key);await fs.rename(speech.audioFile,savedFile);const format={sampleRate:actual.sampleRate,channels:actual.channels,bitsPerSample:actual.bitsPerSample,durationMs:actual.durationMs,size:actual.size,sha256:actual.sha256,pcmSHA256:actual.pcmSHA256};
  repo.transaction(()=>{const {row}=current();service.complete(row,native,{key,format});repo.event(row.tenant_id,row.workspace_id,row.id,'presentation.auto_answered',config.providerMode);});committed=true;
 }catch(error){repo.transaction(()=>{const row=repo.get<PresentationAnswerRow>('SELECT * FROM studio_presentation_answer_jobs WHERE id=?',claimed.id);if(!row||row.lease_token!==token)return;let stale=false;try{service.current(row);}catch{stale=true;}const interrupted=stopSignal.aborted,status=stale?'stale':interrupted&&row.attempts<3?'queued':'failed';repo.run('UPDATE studio_presentation_answer_jobs SET status=?,version=version+1,lease_token=NULL,lease_until=NULL,error_code=?,error_message=?,updated_at=? WHERE id=?',status,stale?'PRESENTATION_ANSWER_STALE':interrupted?'PRESENTATION_ANSWER_INTERRUPTED':error instanceof AppError?error.code:'PRESENTATION_ANSWER_FAILED',stale?'问题、权限或讲稿已变化，旧答复没有保存。':interrupted?'服务停止，保留同一任务等待恢复。':error instanceof AppError?error.message:'自动答疑未完成，请转人工或检查固定模型后重试。',now(),row.id);});}
 finally{clearInterval(heartbeat);stopSignal.removeEventListener('abort',stop);if(!committed&&savedFile&&path.dirname(savedFile)===path.resolve(config.dataDir,'objects'))await fs.unlink(savedFile).catch(()=>{});if(path.dirname(directory)===workRoot)await fs.rm(directory,{recursive:true,force:true}).catch(()=>{});repo.transaction(()=>releaseNativeModel(repo,token));}
 return true;
}
