import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import type {Asset,MediaTransfer,MediaProcessingPlan} from '@digitalguide/contracts';
import {fixtureIds as f} from '../packages/test-fixtures/src/seed.js';
import {segmentationFixture} from '../packages/test-fixtures/src/segmentation.js';
import {trackingVideoFixture} from '../packages/test-fixtures/src/tracking.js';
import type {SegmentationFixtureApi} from './segmentation-fixture.js';
export async function makeTrackingSource(api:SegmentationFixtureApi,directory:string,video=true,frames=6){
 const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');let bytes:Buffer,asset:Asset;
 if(video){const file=path.join(directory,'original.mp4');if(!fs.existsSync(file))await trackingVideoFixture(directory,process.cwd(),frames);bytes=fs.readFileSync(file);let transfer=await api.post<MediaTransfer>('/studio/transfers',{workspaceId:f.workspaceA,kind:'video',name:'原创横向移动虚构人形与原声',fileName:'original-tracking.mp4',size:bytes.length,sha256:sha(bytes),rightsNote:'程序绘制虚构人形、非纯色背景和合成测试音，用于实际本机主体跟随，不含真实人员。',rightsConfirmed:true});if(transfer.status==='uploading'){for(let index=0;index<transfer.chunkCount;index++){const chunk=bytes.subarray(index*transfer.chunkSize,(index+1)*transfer.chunkSize);transfer=await api.post('/studio/transfers/'+transfer.id+'/parts',{index,sha256:sha(chunk),contentBase64:chunk.toString('base64')});}transfer=await api.post('/studio/transfers/'+transfer.id+'/finalize',{version:transfer.version});}const end=Date.now()+90000;while(transfer.status!=='ready'&&Date.now()<end){if(transfer.status==='failed'||transfer.status==='cancelled')throw new Error('Original tracking source import did not complete; retain its original transfer.');await delay(100);transfer=await api.get('/studio/transfers/'+transfer.id);}if(transfer.status!=='ready'||!transfer.assetId)throw new Error('Original tracking transfer is still active; keep its checkpoint and re-observe it.');asset=await api.get('/assets/'+transfer.assetId);}
 else{bytes=segmentationFixture().image;const upload=await api.post<{uploadId:string}>('/assets/uploads',{workspaceId:f.workspaceA,fileName:'original-tracking.png',contentBase64:bytes.toString('base64')});asset=await api.post('/assets',{uploadId:upload.uploadId,name:'原创虚构人形与主体构图',category:'reference',expiresAt:null});}
 return{asset,sourceSHA256:sha(bytes),sourceBytes:bytes.length};
}
export async function makeTrackingPlan(api:SegmentationFixtureApi,asset:Asset,name='原创点选与主体跟随',durationMs:number|null=null){return api.post<MediaProcessingPlan>('/studio/media-processing/plans',{workspaceId:f.workspaceA,name,sourceAssetId:asset.id,sourceVersion:asset.version,configuration:{provider:'local-media',operation:'subject_tracking',startMs:0,durationMs,strength:.5,instruction:'',tracking:{aspect:'portrait',longestSide:720,seed:{x:asset.mediaType==='image/png'?.5:105/320,y:.55},responseMs:0,maxLostMs:300,padding:.05}},rights:{subject:'本项目原创合成素材作者',proof:'原创虚构人形与合成测试音，用于实际本机跟踪与构图验证，不含真实人员。',expiresAt:new Date(Date.now()+7*86400000).toISOString(),confirmed:true}});}
