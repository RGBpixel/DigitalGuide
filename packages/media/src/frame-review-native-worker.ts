import fs from 'node:fs';
import path from 'node:path';
import {createFrameReviewProxy} from './frame-review-proxy.js';
import {frameReviewMedia} from '../../contracts/src/index.js';
import {AppError} from '../../domain/src/index.js';
import type {OwnedFrameReviewInput} from './run-owned-frame-review.js';
const request=JSON.parse(fs.readFileSync(process.argv[2],'utf8')) as {input:OwnedFrameReviewInput;resultFile:string;progressFile:string};
try{const result=await createFrameReviewProxy({...request.input,destination:path.join(request.input.directory,'review.mp4'),signal:new AbortController().signal,onProgress:progress=>fs.writeFileSync(request.progressFile,JSON.stringify({progress})+'\n',{mode:0o600})});fs.writeFileSync(request.resultFile,JSON.stringify(frameReviewMedia.parse(result)),{flag:'wx',mode:0o600});}catch(e){fs.writeFileSync(request.resultFile,JSON.stringify({error:{code:e instanceof AppError?e.code:'REVIEW_PROXY_FAILED',message:e instanceof AppError?e.message:'受控逐帧副本处理失败，请核对原成片。'}}),{flag:'wx',mode:0o600});process.exitCode=1;}
