import fs from 'node:fs';
import {loadNativeRuntimeConfig} from '../packages/postgres/src/runtime-config.js';
import {NativePostgresDatabase} from '../packages/postgres/src/runtime-database.js';
import {NativeCoreRepository} from '../packages/postgres/src/runtime-repository.js';
import {NativeFrameReviewWorker} from '../packages/postgres/src/runtime-frame-review-worker.js';
import {runOwnedFrameReview,type OwnedFrameReviewInput} from '../packages/media/src/run-owned-frame-review.js';
const mode=process.argv[2];
if(mode==='owned-render'){
 const input=JSON.parse(fs.readFileSync(process.argv[3],'utf8')) as OwnedFrameReviewInput;await runOwnedFrameReview(input,new AbortController().signal,progress=>{if(progress>0)console.log(JSON.stringify({phase:'owned_frame_progress',progress}));});
}else if(mode==='complete'){
 const config=loadNativeRuntimeConfig(process.argv[3]),target=process.argv[4],db=await NativePostgresDatabase.open(config,'worker'),repo=new NativeCoreRepository(db);let lease:Parameters<NonNullable<Parameters<NativeFrameReviewWorker['runOne']>[1]>>[0]|undefined;
 try{await new NativeFrameReviewWorker(repo).runOne(undefined,value=>{lease=value;if(lease.id!==target)throw new Error('Unexpected queued frame review');},async receipt=>{console.log(JSON.stringify({phase:'native_frame_complete_staged',reviewId:lease!.id,leaseUntil:lease!.lease_until,attempts:lease!.attempts,receipt}));await new Promise<void>(()=>{setInterval(()=>{},1000);});});}finally{await db.close();}
}else throw new Error('Unknown private frame probe mode');
