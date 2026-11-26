import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {blankStudioDocument} from '@digitalguide/contracts';
import {AppError,type Principal} from '@digitalguide/domain';
import type {Repository} from '@digitalguide/database';
import {type AeMediaRow} from '../../../packages/database/src/ae-media-origin.js';
import {enableTimeline,newTimelineClip} from '../../../packages/domain/src/timeline.js';
import {fileDigest,ownedFile} from '../../../packages/media/src/files.js';
import {runOwnedCollectionInspection} from '../../../packages/media/src/run-owned-collection-inspection.js';
import {AeMediaAdoptions} from '../../api/src/ae-media-adoptions.js';
import {StudioService} from '../../api/src/studio-service.js';
import type {Config} from '../../api/src/config.js';
const now=()=>new Date().toISOString();
export async function runAeMediaAdoption(repo:Repository,config:Config,stopSignal?:AbortSignal){
 const s=new AeMediaAdoptions(repo,config),token=randomUUID();
 const claimed=repo.transaction(()=>{
  const exhausted=repo.all<AeMediaRow>("SELECT * FROM ae_media_adoptions WHERE environment=? AND app_env=? AND status='processing' AND lease_until<=? AND attempts>=3",config.providerMode,config.appEnv,now());
  for(const r of exhausted){repo.run("UPDATE ae_media_adoptions SET status='failed',stage='finished',version=version+1,lease_token=NULL,lease_until=NULL,error_code='AE_MEDIA_ATTEMPTS_EXHAUSTED',error_message='三次检查尝试均中断，请保留记录并联系管理员。',updated_at=? WHERE id=?",now(),r.id);repo.run("UPDATE ae_media_attempts SET status='interrupted',error_code='AE_MEDIA_INTERRUPTED',finished_at=? WHERE adoption_id=? AND status='processing'",now(),r.id);}
  const r=repo.get<AeMediaRow>("SELECT * FROM ae_media_adoptions WHERE environment=? AND app_env=? AND (status='queued' OR (status='processing' AND lease_until<=? AND attempts<3)) ORDER BY created_at,id LIMIT 1",config.providerMode,config.appEnv,now());
  if(!r)return null;
  repo.run("UPDATE ae_media_attempts SET status='interrupted',error_code='AE_MEDIA_INTERRUPTED',finished_at=? WHERE adoption_id=? AND status='processing'",now(),r.id);
  repo.run("UPDATE ae_media_adoptions SET status='processing',stage='copying',progress=0,attempts=attempts+1,version=version+1,lease_token=?,lease_until=?,updated_at=? WHERE id=?",token,new Date(Date.now()+30000).toISOString(),now(),r.id);
  repo.run('INSERT INTO ae_media_attempts VALUES (?,?,?,?,?,?,?)',r.id,r.attempts+1,'processing',null,null,now(),null);
  return repo.get<AeMediaRow>('SELECT * FROM ae_media_adoptions WHERE id=?',r.id)!;
 });
 if(!claimed)return false;
 const r=claimed,workRoot=path.resolve(config.dataDir,'ae-media-work'),directory=ownedFile(workRoot,r.id+'-'+token),objects=path.resolve(config.dataDir,'objects'),abort=new AbortController(),written:string[]=[];
 let committed=false,lastHeartbeat=Date.now();
 function live(){const current=repo.get<AeMediaRow>('SELECT * FROM ae_media_adoptions WHERE id=?',r.id);return current?.status==='processing'&&current.lease_token===token&&current.lease_until!>now()&&current.control_version===r.control_version;}
 function guard():Principal {if(abort.signal.aborted||!live())throw new AppError('AE_MEDIA_CANCELLED','AE采用任务已停止或租约已变化，未登记结果。',409);const p=repo.principal(r.actor_id);s.scope(p,r.workspace_id,true);s.current(p,r);return p;}
 function progress(stage:AeMediaRow['stage'],value:number){guard();repo.run('UPDATE ae_media_adoptions SET stage=?,progress=?,updated_at=? WHERE id=? AND lease_token=?',stage,Math.min(99,Math.max(0,Math.floor(value))),now(),r.id,token);}
 const stop=()=>abort.abort();stopSignal?.addEventListener('abort',stop,{once:true});if(stopSignal?.aborted)stop();
 const timer=setInterval(()=>{try{guard();if(Date.now()-lastHeartbeat>=10000){repo.run('UPDATE ae_media_adoptions SET lease_until=? WHERE id=? AND lease_token=?',new Date(Date.now()+30000).toISOString(),r.id,token);lastHeartbeat=Date.now();}}catch{abort.abort();}},400);
 async function save(file:string,extension:string){guard();const key=randomUUID()+extension,destination=ownedFile(objects,key),output=fs.createWriteStream(destination,{flags:'wx'});output.once('open',()=>written.push(destination));await pipeline(fs.createReadStream(file),output,{signal:abort.signal});return{key,...await fileDigest(destination,abort.signal)};}
 try {
  const p=guard(),origin=s.current(p,r);await fs.promises.mkdir(directory,{recursive:true});
  const local=path.join(directory,origin.video.mediaType==='video/mp4'?'source.mp4':'source.mov');
  await pipeline(fs.createReadStream(s.file(r)),fs.createWriteStream(local,{flags:'wx'}),{signal:abort.signal});
  const digest=await fileDigest(local,abort.signal);if(digest.sha256!==origin.video.sha256||digest.size!==origin.video.size)throw new AppError('AE_MEDIA_BYTES_CHANGED','实际AE成片与固定摘要不符，没有入库或建立工程。',409);
  progress('inspecting',15);
  const inspected=await runOwnedCollectionInspection({root:config.root,file:local,directory:path.join(directory,'inspection'),mediaType:origin.video.mediaType},abort.signal,v=>progress('inspecting',15+v*70));
  const expected=origin.manifest.output,duration=expected.frameCount*1000*expected.fpsDenominator/expected.fpsNumerator;
  if(inspected.specs.width!==expected.width||inspected.specs.height!==expected.height||Math.abs(inspected.specs.durationMs-duration)>Math.max(120,2000/inspected.specs.fps)||Math.abs(inspected.specs.fps-expected.fpsNumerator/expected.fpsDenominator)>.02||!!inspected.specs.hasAudio!==expected.audio||(origin.video.mediaType==='video/quicktime'&&!inspected.specs.alpha))throw new AppError('AE_MEDIA_SPEC_CHANGED','实际成片规格与原AE固定输出不一致，未创建替代视频。',409);
  if(!inspected.posterFile)throw new AppError('AE_MEDIA_POSTER_REQUIRED','实际解码未得到检查帧，请重新检查原输出。',409);
  const original=await save(local,origin.video.mediaType==='video/mp4'?'.mp4':'.mov'),poster=await save(inspected.posterFile,'.png'),preview=inspected.previewFile?await save(inspected.previewFile,'.mp4'):null;
  if(original.sha256!==origin.video.sha256||original.size!==origin.video.size)throw new AppError('AE_MEDIA_COPY_CHANGED','已保存的原件摘要不符，未登记结果。',409);
  // Rehash the original artifact after inspection as well as our private copy.
  const after=await fileDigest(s.file(r),abort.signal);if(after.sha256!==origin.video.sha256||after.size!==origin.video.size)throw new AppError('AE_MEDIA_BYTES_CHANGED','检查期间原AE成片已变化，没有入库。',409);
  progress('committing',95);
  repo.transaction(()=>{
   const actor=guard(),assetId=randomUUID(),uploadId=randomUUID(),at=now(),studio=new StudioService(repo,config.providerMode,config.appEnv,config.dataDir);
   repo.run('INSERT INTO uploads VALUES (?,?,?,?,?,?,?,?,?,?)',uploadId,actor.tenantId,r.workspace_id,actor.userId,original.key,original.sha256,original.size,origin.video.mediaType,JSON.stringify(inspected.specs),at);
   const synthetic=origin.mode==='contract_test'||origin.references.some(ref=>repo.asset(actor,ref.id).synthetic);
   repo.run('INSERT INTO assets(id,tenant_id,workspace_id,upload_id,name,category,synthetic,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)',assetId,actor.tenantId,r.workspace_id,uploadId,(origin.mode==='contract_test'?'契约AE成片（非Adobe） · ':'AE成片 · ')+r.name,'background',synthetic?1:0,r.expires_at,at);
   repo.run('INSERT INTO video_sources VALUES (?,?,?,?,?)',assetId,poster.key,poster.sha256,poster.size,at);
   if(preview)repo.run('INSERT INTO alpha_video_previews VALUES (?,?,?,?,?)',assetId,preview.key,preview.sha256,preview.size,at);
   const document=blankStudioDocument(),segment=document.segments[0];document.canvas.width=expected.width;document.canvas.height=expected.height;document.canvas.transparent=origin.video.mediaType==='video/quicktime';
   const frameRate=expected.fpsNumerator/expected.fpsDenominator;document.canvas.fps=([24,25,30,60].includes(frameRate)?frameRate:30) as 24|25|30|60;
   segment.title=origin.mode==='contract_test'?'契约AE成片（非Adobe）':r.name;segment.text='';segment.speakerId=null;segment.elements=[];segment.durationMs=Math.max(1000,Math.round(duration));
   enableTimeline(document);document.timeline!.tracks.forEach(t=>{t.clips=[];});document.timeline!.tracks.find(t=>t.type===(origin.video.mediaType==='video/quicktime'?'overlay':'background'))!.clips.push(newTimelineClip({type:'asset',assetId},{name:segment.title,segmentId:segment.id,startMs:0,durationMs:Math.round(inspected.specs.durationMs),voiceRole:'narration'}));
   const projectId=studio.create(actor,{workspaceId:r.workspace_id,name:((origin.mode==='contract_test'?'非Adobe · ':'')+r.name).slice(0,80),purpose:'video',document,variables:{}});
   repo.run("UPDATE ae_media_adoptions SET status='succeeded',stage='finished',progress=100,asset_id=?,project_id=?,inspection_runtime=?,version=version+1,lease_token=NULL,lease_until=NULL,error_code=NULL,error_message=NULL,updated_at=? WHERE id=? AND lease_token=?",assetId,projectId,JSON.stringify(inspected.runtime),at,r.id,token);
   studio.validate(actor,r.workspace_id,'video',document);
   repo.run('INSERT INTO asset_versions VALUES (?,?,?,?)',assetId,1,JSON.stringify(repo.asset(actor,assetId)),at);
   repo.run("UPDATE ae_media_attempts SET status='succeeded',finished_at=? WHERE adoption_id=? AND attempt=?",at,r.id,r.attempts);
   repo.audit(actor,r.workspace_id,'studio.ae_media_adopted',r.id,'worker');committed=true;
  });
 }catch(error){
  repo.transaction(()=>{if(!live())return;if(stopSignal?.aborted)return;const code=error instanceof AppError?error.code:'AE_MEDIA_INSPECTION_FAILED',message=error instanceof AppError?error.message:'AE成片检查被中断或格式不支持；原件保留，请核对后明确重试。';repo.run("UPDATE ae_media_adoptions SET status='failed',stage='finished',version=version+1,error_code=?,error_message=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?",code,message,now(),r.id);repo.run("UPDATE ae_media_attempts SET status='failed',error_code=?,error_message=?,finished_at=? WHERE adoption_id=? AND attempt=?",code,message,now(),r.id,r.attempts);});
 }finally{
  clearInterval(timer);stopSignal?.removeEventListener('abort',stop);
  if(!committed)await Promise.all(written.map(file=>fs.promises.unlink(file).catch(()=>{})));
  if(path.dirname(directory)===workRoot&&directory.startsWith(workRoot+path.sep))await fs.promises.rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100}).catch(()=>{});
 }
 return true;
}
