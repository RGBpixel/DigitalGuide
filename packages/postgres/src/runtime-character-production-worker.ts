import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {AppError,canonical} from '../../domain/src/index.js';
import {puppetConfiguration,type CharacterOutput,type CharacterQuality} from '../../contracts/src/index.js';
import {PUPPET_MEDIA_TYPE,drawPuppetThumbnail} from '../../media/src/character-puppet.js';
import {inspectStaticGlb,renderStaticGlb} from '../../media/src/character-glb.js';
import {inspectCharacterSource,pngStatistics} from '../../media/src/character-quality.js';
import {renderPuppetVideo,renderReferenceVideo} from '../../media/src/character-video.js';
import {inspectVideoSource} from '../../media/src/video-source.js';
import {inspectMedia} from '../../media/src/index.js';
import {assertNoLinks} from '../../recovery/src/files.js';
import {NativeCharacterProduction,nativeCharacterJob} from './runtime-character-production.js';
import {nativeCharacterDigest as digest,type NativeCharacterJobRow,type NativeCharacterSnapshot,type NativeCharacterReceipt} from './runtime-character-production-shapes.js';
import type {NativePrivateObjects} from './runtime-objects.js';
import type {NativeCoreRepository} from './runtime-repository.js';

type ExecutionInput={root:string;directory:string;objects:NativePrivateObjects;job:NativeCharacterJobRow;snapshot:NativeCharacterSnapshot;signal:AbortSignal};
export async function executeNativeCharacter(input:ExecutionInput):Promise<Pick<NativeCharacterReceipt,'status'|'outputs'|'result'>>{
 const {job,snapshot,objects,signal,directory,root}=input,source=await objects.read({storage_key:snapshot.source.storageKey,size:snapshot.source.size,sha256:snapshot.source.sha256},134217728),voice=snapshot.voice?await objects.read({storage_key:snapshot.voice.storageKey,size:snapshot.voice.size,sha256:snapshot.voice.sha256},8388608):undefined;
 signal.throwIfAborted();
 if(job.operation==='mock_training'){
  const scenario=snapshot.training!.simulate;
  if(scenario==='permanent_failure')throw new AppError('MOCK_PERMANENT_FAILURE','显式模拟永久失败，请核对来源或提供商后建立新任务。',409);
  if(scenario==='transient_failure'&&job.attempts===1)throw new AppError('MOCK_TRANSIENT_FAILURE','显式模拟临时失败，可在剩余次数内重试原任务。',409);
  return{status:scenario==='unknown'?'unknown':'awaiting_review',outputs:[],result:{simulated:true,provider:'mock-character',mockOperationId:job.id,mockOutcome:'succeeded',realModelCreated:false}};
 }
 let sourceFile:string|undefined;
 if(snapshot.source.mediaType==='video/mp4'){sourceFile=path.join(directory,'source.mp4');await fs.writeFile(sourceFile,source,{flag:'wx'});}
 if(job.operation==='quality'){
  const quality:CharacterQuality=inspectCharacterSource(source,snapshot.source.mediaType);
  if(sourceFile){const inspected=await inspectVideoSource(sourceFile,path.join(directory,'source-validation'),root,signal,()=>{}),frame=pngStatistics(await fs.readFile(inspected.posterFile));quality.metrics={...inspected.specs,...Object.fromEntries(Object.entries(frame).map(([key,value])=>['poster_'+key,value]))};quality.findings.push({code:'VIDEO_FULL_DECODE',level:'info',message:'实际视频已完整解码并检查一帧统计；没有检测真人身份、人数或口型。'});}
  if(voice){const audio=inspectCharacterSource(voice,'audio/wav');Object.assign(quality.metrics,Object.fromEntries(Object.entries(audio.metrics).map(([key,value])=>['voice_'+key,value])));quality.findings.push(...audio.findings.map(f=>({...f,code:'VOICE_'+f.code})));}
  return{status:'succeeded',outputs:[],result:{quality}};
 }
 const video=job.operation==='motion'||!!sourceFile,filename=path.join(directory,video?'render.mp4':'render.png');
 if(job.operation==='motion'){
  if(!snapshot.motion||snapshot.source.mediaType!==PUPPET_MEDIA_TYPE)throw new AppError('CHARACTER_MOTION_UNSUPPORTED','此来源不支持原创二维动作。',409);
  await renderPuppetVideo({root,filename,configuration:puppetConfiguration.parse(JSON.parse(source.toString('utf8'))),events:snapshot.motion.content.events,durationMs:snapshot.motion.content.durationMs,backgroundColor:snapshot.motion.content.backgroundColor,voice,signal});
 }else if(sourceFile)await renderReferenceVideo({root,source:sourceFile,filename,durationMs:snapshot.project!.durationMs,signal});
 else{const png=snapshot.source.mediaType==='image/png'?source:snapshot.source.mediaType==='model/gltf-binary'?renderStaticGlb(inspectStaticGlb(source)):drawPuppetThumbnail(puppetConfiguration.parse(JSON.parse(source.toString('utf8'))));await fs.writeFile(filename,png,{flag:'wx'});}
 let specs:Record<string,number>,poster:CharacterOutput['poster'];
 if(video){const inspected=await inspectVideoSource(filename,path.join(directory,'validation'),root,signal,()=>{});specs=inspected.specs;const p=await objects.install(inspected.posterFile,8388608,signal);poster={storageKey:p.storage_key,sha256:p.sha256,size:Number(p.size)};}
 else specs=inspectMedia(await fs.readFile(filename)).specs;
 const object=await objects.install(filename,134217728,signal),output:CharacterOutput={storageKey:object.storage_key,name:job.operation==='motion'?'原创二维动作.mp4':video?'视频原片片段.mp4':'静态形象参考.png',mediaType:video?'video/mp4':'image/png',size:Number(object.size),sha256:object.sha256,specs,width:specs.width,height:specs.height,durationMs:video?specs.durationMs:null,assetId:null,...(poster?{poster}:{})};
 return{status:'succeeded',outputs:[output],result:{localActualFile:true,phonemeLipSync:false,realModelCreated:false}};
}

export class NativeCharacterProductionWorker{
 readonly service:NativeCharacterProduction;
 constructor(readonly core:NativeCoreRepository,readonly root=process.cwd(),readonly execute=executeNativeCharacter){this.service=new NativeCharacterProduction(core,root);}
 get db(){return this.core.db;}
 async claim(){return this.db.transaction(async()=>{const j=(await this.db.query<{value:NativeCharacterJobRow|null}>('SELECT to_jsonb(dg_native_character_claim()) AS value')).rows[0].value;return j?nativeCharacterJob(j):null;});}
 async context(lease:NativeCharacterJobRow,completed=false){if(!(await this.db.query<{valid:boolean}>('SELECT dg_native_character_valid($1,$2,$3) AS valid',[lease.id,lease.lease_token,completed])).rows[0].valid)throw new AppError('CHARACTER_LEASE_LOST','任务已取消、失去租约或固定来源变化，旧结果未提交。',409);const p=await this.core.principal(lease.actor_id),row=await this.service.row(p,lease.id),c=await this.service.current(p,row,true);return{...c,row};}
 async complete(lease:NativeCharacterJobRow,receipt:NativeCharacterReceipt,onStaged?:(lease:NativeCharacterJobRow)=>Promise<void>){return this.db.transaction(async()=>{await this.context(lease);if(receipt.inputHash!==lease.input_hash||receipt.operation!==lease.operation||receipt.attempt!==lease.attempts||receipt.outputs.length>1)throw new AppError('CHARACTER_OUTPUT_MISMATCH','实际处理结果不匹配固定输入或尝试。',409);for(const output of receipt.outputs){await this.service.objects.verify({storage_key:output.storageKey,sha256:output.sha256,size:output.size},134217728);if(output.poster)await this.service.objects.verify({storage_key:output.poster.storageKey,sha256:output.poster.sha256,size:output.poster.size},8388608);}await this.context(lease);await this.db.query('SELECT dg_native_commit_character($1,$2,$3,$4)',[lease.id,lease.lease_token,lease.input_hash,canonical(receipt)]);await onStaged?.(lease);await this.context(lease,true);});}
 async runOne(stopSignal?:AbortSignal,onClaimed?:(lease:NativeCharacterJobRow)=>Promise<void>|void,onStaged?:(lease:NativeCharacterJobRow)=>Promise<void>){
  if(stopSignal?.aborted)return false;const lease=await this.claim();if(!lease)return false;
  const workRoot=path.resolve(this.db.config.dataDir,'character-work'),directory=path.join(workRoot,lease.id+'-'+randomUUID()),abort=new AbortController(),stop=()=>abort.abort();
  let timer:ReturnType<typeof setInterval>|undefined,pending:Promise<void>|undefined;
  stopSignal?.addEventListener('abort',stop,{once:true});if(stopSignal?.aborted)stop();
  try{
   assertNoLinks(workRoot,true);await fs.mkdir(workRoot,{recursive:true});assertNoLinks(workRoot);if(path.dirname(directory)!==workRoot)throw new AppError('CHARACTER_WORK_SCOPE','处理目录不在当前实例范围。',409);assertNoLinks(directory,true);await fs.mkdir(directory);
   timer=setInterval(()=>{if(pending)return;pending=this.db.transaction(async()=>{if(!(await this.db.query<{valid:boolean}>('SELECT dg_native_character_hold($1,$2) AS valid',[lease.id,lease.lease_token])).rows[0].valid)throw new AppError('CHARACTER_LEASE_LOST','原任务不再运行。',409);await this.context(lease);}).catch(()=>abort.abort()).finally(()=>{pending=undefined;});},1000);
   await onClaimed?.(lease);const c=await this.db.transaction(()=>this.context(lease));abort.signal.throwIfAborted();
   const result=await this.execute({root:this.root,directory,objects:this.service.objects,job:lease,snapshot:c.snapshot,signal:abort.signal});
   clearInterval(timer);timer=undefined;await pending;abort.signal.throwIfAborted();
   const quality=result.result.quality as CharacterQuality|undefined;
   await this.complete(lease,{inputHash:lease.input_hash,operation:lease.operation,attempt:lease.attempts,qualityHash:quality?digest(quality):null,...result},onStaged);
  }catch(e){
   if(timer)clearInterval(timer);timer=undefined;await pending;
   await this.db.transaction(async()=>{let stale=false;try{const p=await this.core.principal(lease.actor_id);await this.service.current(p,await this.service.row(p,lease.id));}catch(error){if(!(error instanceof AppError))throw error;stale=true;}const stopped=stopSignal?.aborted??false;await this.db.query('SELECT dg_native_character_fail($1,$2,$3,$4,$5,$6)',[lease.id,lease.lease_token,stale?'CHARACTER_SOURCE_CHANGED':stopped?'CHARACTER_INTERRUPTED':e instanceof AppError?e.code:'CHARACTER_PROCESS_FAILED',stale?'原素材、用途、工程或发起人权限已变化，旧结果没有保存。':stopped?'服务停止，保留固定任务按剩余次数恢复。':e instanceof AppError?e.message:'本地形象处理未完成，请检查格式和工具；没有返回模拟成功。',stopped,stale]);});
  }finally{
   if(timer)clearInterval(timer);await pending;stopSignal?.removeEventListener('abort',stop);
   try{await this.db.transaction(async()=>{await this.db.query('SELECT dg_native_character_release($1,$2)',[lease.id,lease.lease_token]);});}
   finally{assertNoLinks(workRoot);if(path.dirname(directory)===workRoot){assertNoLinks(directory,true);await fs.rm(directory,{recursive:true,force:true});}}
  }
  return true;
 }
}
