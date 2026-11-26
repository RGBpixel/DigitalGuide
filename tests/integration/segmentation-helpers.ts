import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {Asset,MediaProcessingConfiguration,MediaProcessingPlan,MediaProcessingJob} from '@digitalguide/contracts';
import {expect} from 'vitest';
import {fixtureIds as f,syntheticWav} from '../../packages/test-fixtures/src/seed.js';
import {segmentationFixture} from '../../packages/test-fixtures/src/segmentation.js';
import {inspectMedia} from '../../packages/media/src/index.js';
import {mediaTools,runMediaTool} from '../../packages/media/src/media-tools.js';
import {inspectVideoSource} from '../../packages/media/src/video-source.js';
import {runMediaProcessingJob} from '../../apps/worker/src/media-processing.js';
import {shareApi,type ShareHarness} from './share-helpers.js';
export const segmentationConfig=(durationMs:number|null=null):MediaProcessingConfiguration=>({provider:'local-media',operation:'segmentation',startMs:0,durationMs,strength:.5,instruction:''});
export const segmentationRights=()=>({subject:'原创虚构人形作者',proof:'程序生成的虚构人形及测试音，不含真实人员。',expiresAt:new Date(Date.now()+86400000).toISOString(),confirmed:true});
export async function segmentationSource(h:ShareHarness,video=false,frames=6){
 const directory=path.join(h.config.dataDir,'segmentation-fixture-'+randomUUID());fs.mkdirSync(directory,{recursive:true});let bytes:Buffer,specs:Record<string,number>,mediaType:string,posterFile:string|undefined;
 if(video){for(let i=0;i<frames;i++)fs.writeFileSync(path.join(directory,`frame-${i}.png`),segmentationFixture((i%6-2)*6).image);const audio=path.join(directory,'audio.wav'),file=path.join(directory,'original.mp4');fs.writeFileSync(audio,syntheticWav());await runMediaTool(mediaTools(h.config.root).ffmpeg,['-v','error','-framerate','6','-i',path.join(directory,'frame-%d.png'),'-i',audio,'-t',String(frames/6),'-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-af','aloop=loop=-1:size=8000','-movflags','+faststart',file],undefined,30000);const result=await inspectVideoSource(file,directory,h.config.root,new AbortController().signal,()=>{});bytes=fs.readFileSync(file);specs=result.specs;mediaType='video/mp4';posterFile=result.posterFile;}
 else{bytes=segmentationFixture().image;specs=inspectMedia(bytes).specs;mediaType='image/png';}
 const id=randomUUID(),upload=randomUUID(),key=randomUUID()+(video?'.mp4':'.png'),time=new Date().toISOString(),sha=createHash('sha256').update(bytes).digest('hex');fs.writeFileSync(path.join(h.config.dataDir,'objects',key),bytes);h.repo.run('INSERT INTO uploads VALUES (?,?,?,?,?,?,?,?,?,?)',upload,f.tenantA,f.workspaceA,f.adminA,key,sha,bytes.length,mediaType,JSON.stringify(specs),time);h.repo.run("INSERT INTO assets(id,tenant_id,workspace_id,upload_id,name,category,synthetic,created_at) VALUES (?,?,?,?,?,'reference',1,?)",id,f.tenantA,f.workspaceA,upload,'原创虚构人形与非纯色背景',time);if(posterFile){const poster=randomUUID()+'.png',posterBytes=fs.readFileSync(posterFile);fs.writeFileSync(path.join(h.config.dataDir,'objects',poster),posterBytes);h.repo.run('INSERT INTO video_sources VALUES (?,?,?,?,?)',id,poster,createHash('sha256').update(posterBytes).digest('hex'),posterBytes.length,time);}return{asset:h.repo.asset(h.repo.principal(f.adminA),id) as Asset,original:bytes};
}
export async function segmentationPlan(h:ShareHarness,asset:Asset,configuration=segmentationConfig()){return shareApi(h).good<MediaProcessingPlan>('/studio/media-processing/plans',{workspaceId:f.workspaceA,name:'真实神经前景方案',sourceAssetId:asset.id,sourceVersion:asset.version,configuration,rights:segmentationRights()});}
export async function segmentationRun(h:ShareHarness,p:MediaProcessingPlan){const api=shareApi(h),job=await api.good<MediaProcessingJob>('/studio/media-processing/plans/'+p.id+'/run',{version:p.version,planHash:p.planHash,confirmed:true});await runMediaProcessingJob(h.repo,h.config);const ready=(await api.get('/studio/media-processing/jobs/'+job.id)).json().data as MediaProcessingJob;expect(ready.status,ready.errorMessage||'').toBe('succeeded');return ready;}
