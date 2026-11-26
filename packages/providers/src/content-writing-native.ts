import type {ContentWritingNativeResult} from '@digitalguide/contracts';
import {runContentWritingNativeV1,type ContentWritingRunInput} from './content-writing-native-v1.js';
import {runContentWritingReviewed} from './content-writing-reviewed.js';
export type {ContentWritingRunInput} from './content-writing-native-v1.js';
export async function runContentWritingNative(input:ContentWritingRunInput,signal:AbortSignal,onProgress:(fraction:number)=>void):Promise<ContentWritingNativeResult>{return input.engine.policy==='source-script-variants-v1'?runContentWritingNativeV1(input,signal,onProgress):runContentWritingReviewed(input,signal,onProgress);}
