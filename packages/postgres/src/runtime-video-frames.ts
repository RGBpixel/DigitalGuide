import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {AppError,type Principal} from '../../domain/src/index.js';
import {isVideoMediaType} from '../../contracts/src/index.js';
import {inspectMedia} from '../../media/src/index.js';
import {mp4InputOptions} from '../../media/src/video-source.js';
import {mediaTools,runMediaTool} from '../../media/src/media-tools.js';
import {assertNoLinks} from '../../recovery/src/files.js';
import {NativePrivateObjects} from './runtime-objects.js';
import type {NativeCoreRepository} from './runtime-repository.js';

// Called inside the authenticated transaction. Two database slots cover all API processes.
export async function nativeVideoFrame(core:NativeCoreRepository,p:Principal,id:string,root:string,input:{timeMs:number}|{frame:number;sourceVersion:number;sourceSHA256:string}){
 const source=await core.assets.checked(p,id),a=source.asset,exact='frame'in input;if(!isVideoMediaType(a.mediaType)||!exact&&(a.mediaType!=='video/quicktime'||!a.specs.alpha))throw new AppError('MEDIA_FRAME_FORMAT','此素材没有所需的视频抽帧资源。',409);
 if(exact&&(a.version!==input.sourceVersion||a.sha256!==input.sourceSHA256))throw new AppError('MEDIA_SOURCE_CHANGED','原片版本或摘要已变化，请重新选择素材。',409);
 const frame=exact?input.frame:Math.floor(input.timeMs*a.specs.fps/1000);if(frame*1000/a.specs.fps>=a.specs.durationMs)throw new AppError('MEDIA_FRAME_RANGE','帧编号超出原片范围，请重新核对起点。',409);
 let slot=false;for(let n=0;n<2;n++)if((await core.db.query<{locked:boolean}>('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked',['native-video-frame-'+n])).rows[0].locked){slot=true;break;}if(!slot)throw new AppError('MEDIA_INSPECTION_BUSY','原片帧正在解码，请稍后重试。',429);
 const directory=path.join(core.db.config.dataDir,'frame-work',randomUUID());assertNoLinks(directory,true);await fs.mkdir(directory,{recursive:true,mode:0o700});assertNoLinks(directory);const file=path.join(directory,'source.bin'),output=path.join(directory,'frame.png'),signal=AbortSignal.timeout(45000);
 await new NativePrivateObjects(core.db.config).materialize(source.object,file,source.maximum,signal);
 const filter='fps='+a.specs.fps+',trim=start_frame='+frame+':end_frame='+(frame+1)+',setpts=PTS-STARTPTS,scale=640:640:force_original_aspect_ratio=decrease,format=rgba';
 await runMediaTool(mediaTools(root).ffmpeg,['-v','error','-nostdin','-n','-threads','2',...mp4InputOptions,'-i',file,'-map','0:v:0','-an','-frames:v','1','-vf',filter,'-update','1',output],signal,40000);
 if((await fs.stat(output)).size>8388608)throw new AppError('MEDIA_FRAME_INVALID','抽帧文件超过允许大小。',409);const buffer=await fs.readFile(output),image=inspectMedia(buffer);if(image.mediaType!=='image/png'||image.specs.width>640||image.specs.height>640)throw new AppError('MEDIA_FRAME_INVALID','实际原片帧检查失败。',409);
 const current=await core.assets.checked(p,id);if(current.asset.version!==a.version||current.asset.sha256!==a.sha256)throw new AppError('MEDIA_SOURCE_CHANGED','抽帧期间素材版本或原件变化，请重新核对。',409);
 // Private work bytes are retained for later explicit lifecycle maintenance, never an ambiguous shared-file delete.
 return{asset:{mediaType:'image/png'},buffer};
}
