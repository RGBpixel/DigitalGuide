import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {Repository} from '@digitalguide/database';
import {AppError,assertUsableAsset} from '@digitalguide/domain';
import {inspectMedia} from '@digitalguide/media';
import {mediaInspectionFrameQuery} from '@digitalguide/contracts';
import {fileDigest,ownedFile} from '../../../packages/media/src/files.js';
import {mediaTools,runMediaTool} from '../../../packages/media/src/media-tools.js';
import {mp4InputOptions} from '../../../packages/media/src/video-source.js';
import {authenticatedSession} from './auth-check.js';
import {privateFile} from './private-file.js';
import type {Config} from './config.js';
interface CachedFrame{asset_id:string;asset_version:number;frame_number:number;storage_key:string;sha256:string;size:number}
export function registerAlphaVideoRoutes(app:FastifyInstance,repo:Repository,config:Config){
  const objects=path.resolve(config.dataDir,'objects'),work=path.resolve(config.dataDir,'alpha-frame-work'),active=new Map<string,Promise<void>>();
  function current(req:FastifyRequest){const p=authenticatedSession(repo,req,config).principal,a=repo.asset(p,z.uuid().parse((req.params as {id:string}).id));assertUsableAsset(a);if(a.mediaType!=='video/quicktime'||!a.specs.alpha)throw new AppError('NOT_FOUND','此素材没有透明视频播放资源。',404);return a;}
  async function intact(key:string,sha256:string,size:number){try{const value=await fileDigest(ownedFile(objects,key));return value.sha256===sha256&&value.size===size;}catch{return false;}}
  let inspectionActive=0;
  app.get('/api/v1/assets/:id/inspection-frame',async(req,reply)=>{
    const q=mediaInspectionFrameQuery.parse(req.query),read=()=>{const p=authenticatedSession(repo,req,config).principal,a=repo.asset(p,z.uuid().parse((req.params as {id:string}).id));assertUsableAsset(a);if(!['video/mp4','video/quicktime'].includes(a.mediaType))throw new AppError('MEDIA_FRAME_FORMAT','仅支持已检查的视频原片抽帧。',409);if(a.version!==q.sourceVersion||a.sha256!==q.sourceSHA256)throw new AppError('MEDIA_SOURCE_CHANGED','原片版本或摘要已变化，请重新选择素材并核对跟踪起始点。',409);if(!Number.isFinite(a.specs.fps)||a.specs.fps<=0||a.specs.fps>60||!Number.isFinite(a.specs.durationMs)||q.frame*1000/a.specs.fps>=a.specs.durationMs)throw new AppError('MEDIA_FRAME_RANGE','帧编号超出原片范围，请重新核对起点。',409);return a;},a=read();
    if(inspectionActive+active.size>=2)throw new AppError('MEDIA_INSPECTION_BUSY','原片帧正在解码，请稍后重新选择轨迹帧。',429);inspectionActive++;const file=ownedFile(work,randomUUID()+'.png');
    try{
      await fs.mkdir(work,{recursive:true});const upload=repo.get<{storage_key:string}>('SELECT u.storage_key FROM uploads u JOIN assets a ON a.upload_id=u.id WHERE a.id=?',a.id)!,source=ownedFile(objects,upload.storage_key),signal=AbortSignal.timeout(45000),before=await fileDigest(source,signal);read();if(before.sha256!==a.sha256||before.size!==a.size)throw new AppError('MEDIA_SOURCE_BYTES_CHANGED','原片字节校验失败，请重新导入。',409);
      await runMediaTool(mediaTools(config.root).ffmpeg,['-v','error','-nostdin','-n','-threads','2',...mp4InputOptions,'-i',source,'-map','0:v:0','-an','-frames:v','1','-vf',`fps=${a.specs.fps},trim=start_frame=${q.frame}:end_frame=${q.frame+1},setpts=PTS-STARTPTS,scale=640:640:force_original_aspect_ratio=decrease,format=rgba`,'-update','1',file],signal,40000);const bytes=await fs.readFile(file);if(bytes.length>8388608||inspectMedia(bytes).mediaType!=='image/png')throw new AppError('MEDIA_FRAME_INVALID','实际原片帧检查失败。',409);const after=await fileDigest(source,signal);read();if(before.sha256!==after.sha256||before.size!==after.size)throw new AppError('MEDIA_SOURCE_BYTES_CHANGED','抽帧期间原片已变化，请重新核对。',409);return reply.header('Cache-Control','private, no-store').header('X-Content-Type-Options','nosniff').type('image/png').send(bytes);
    }finally{inspectionActive--;await fs.unlink(file).catch(()=>{});}
  });
  app.get('/api/v1/assets/:id/browser-preview',async(req,reply)=>{const a=current(req),r=repo.get<{storage_key:string;sha256:string;size:number}>('SELECT * FROM alpha_video_previews WHERE asset_id=?',a.id);if(!r||!await intact(r.storage_key,r.sha256,r.size))throw new AppError('ALPHA_PREVIEW_UNAVAILABLE','播放代理缺失或校验失败，请重新加工或导入素材。',409);const latest=current(req);if(latest.version!==a.version||latest.sha256!==a.sha256)throw new AppError('MEDIA_SOURCE_CHANGED','素材已经修改，请刷新。',409);return privateFile(req,reply,ownedFile(objects,r.storage_key),'video/mp4');});
  app.get('/api/v1/assets/:id/frame',async(req,reply)=>{
    const a=current(req),q=z.strictObject({timeMs:z.coerce.number().min(0).max(600000)}).parse(req.query);if(q.timeMs>=a.specs.durationMs)throw new AppError('MEDIA_FRAME_RANGE','帧位置超出素材时长，请调整播放位置。',409);const frame=Math.floor(q.timeMs*a.specs.fps/1000),key=a.id+':'+a.version+':'+frame,lookup=()=>repo.get<CachedFrame>('SELECT * FROM alpha_video_frames WHERE asset_id=? AND asset_version=? AND frame_number=?',a.id,a.version,frame);
    let cached=lookup();if(cached&&!await intact(cached.storage_key,cached.sha256,cached.size)){repo.run('DELETE FROM alpha_video_frames WHERE asset_id=? AND asset_version=? AND frame_number=?',a.id,a.version,frame);await fs.unlink(ownedFile(objects,cached.storage_key)).catch(()=>{});cached=undefined;}
    if(!cached){
      let pending=active.get(key);if(!pending){if(active.size+inspectionActive>=2)throw new AppError('ALPHA_FRAME_BUSY','透明帧正在解码，请稍后重试或暂停播放定位。',429);
        pending=(async()=>{const file=ownedFile(work,randomUUID()+'.png');await fs.mkdir(work,{recursive:true});try{
          const upload=repo.get<{storage_key:string}>('SELECT u.storage_key FROM uploads u JOIN assets a ON a.upload_id=u.id WHERE a.id=?',a.id)!,source=ownedFile(objects,upload.storage_key),signal=AbortSignal.timeout(45000),before=await fileDigest(source,signal);current(req);if(before.sha256!==a.sha256||before.size!==a.size)throw new AppError('MEDIA_SOURCE_BYTES_CHANGED','透明原件校验失败，请重新导入。',409);
          await runMediaTool(mediaTools(config.root).ffmpeg,['-v','error','-nostdin','-n','-threads','2',...mp4InputOptions,'-i',source,'-ss',(frame/a.specs.fps).toFixed(6),'-map','0:v:0','-an','-frames:v','1','-vf','scale=640:640:force_original_aspect_ratio=decrease,format=rgba','-update','1',file],signal,40000);inspectMedia(await fs.readFile(file));const after=await fileDigest(source,signal);if(before.sha256!==after.sha256||before.size!==after.size)throw new AppError('MEDIA_SOURCE_BYTES_CHANGED','解码期间原件已变化，请重试。',409);const latest=current(req);if(latest.version!==a.version||latest.sha256!==a.sha256)throw new AppError('MEDIA_SOURCE_CHANGED','素材已修改，请刷新。',409);
          const hash=await fileDigest(file,signal),storageKey=randomUUID()+'.png',destination=ownedFile(objects,storageKey);await fs.copyFile(file,destination,fs.constants.COPYFILE_EXCL);let inserted=false;try{repo.transaction(()=>{const latest=current(req);if(latest.version!==a.version)throw new AppError('MEDIA_SOURCE_CHANGED','素材已修改，请刷新。',409);inserted=!!repo.run('INSERT OR IGNORE INTO alpha_video_frames VALUES (?,?,?,?,?,?,?)',a.id,a.version,frame,storageKey,hash.sha256,hash.size,new Date().toISOString()).changes;});}finally{if(!inserted)await fs.unlink(destination).catch(()=>{});}
          const old=repo.all<CachedFrame>('SELECT * FROM alpha_video_frames WHERE asset_id=? ORDER BY created_at DESC,frame_number DESC LIMIT -1 OFFSET 64',a.id),global=repo.all<CachedFrame>('SELECT * FROM alpha_video_frames ORDER BY created_at DESC,frame_number DESC LIMIT -1 OFFSET 512');for(const row of [...old,...global]){if(row.storage_key===storageKey)continue;repo.run('DELETE FROM alpha_video_frames WHERE asset_id=? AND asset_version=? AND frame_number=?',row.asset_id,row.asset_version,row.frame_number);await fs.unlink(ownedFile(objects,row.storage_key)).catch(()=>{});}
        }finally{await fs.unlink(file).catch(()=>{});}})();active.set(key,pending);pending.finally(()=>active.delete(key)).catch(()=>{});
      }await pending;cached=lookup();
    }
    const latest=current(req);if(!cached||latest.version!==a.version||latest.sha256!==a.sha256)throw new AppError('ALPHA_FRAME_UNAVAILABLE','透明帧尚未可用，请刷新后重试。',409);return privateFile(req,reply,ownedFile(objects,cached.storage_key),'image/png');
  });
}

