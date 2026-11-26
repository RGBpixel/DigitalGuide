import { createHash } from 'node:crypto';
import { AppError,canonical } from '@digitalguide/domain';
export interface PublishingRequest {jobId:string;creativeHash:string;accountId:string;accountVersion:number;scenario:'published'|'accepted'|'failed'|'unknown'}
export interface PublishingReceipt {state:'published'|'submitted'|'failed'|'unknown';remoteId:string|null;simulated:true}
export interface PublishingReceiptStore {get(jobId:string):{hash:string;remoteId:string;status:'published'|'submitted'|'failed'}|undefined;put(jobId:string,hash:string,remoteId:string,status:'published'|'submitted'):void}
export interface PublishingProvider {id:string;submit(input:PublishingRequest):Promise<PublishingReceipt>;lookup(jobId:string):Promise<PublishingReceipt|null>;metrics(jobId:string):Promise<{views:number;likes:number;comments:number;eventTime:string}>}
export function selectPublishingProvider(mode:string,store:PublishingReceiptStore):PublishingProvider {
 if(mode!=='mock')throw new AppError('PROVIDER_NOT_CONFIGURED','真实发布渠道尚未接通，请使用人工发布包；不会切换为模拟成功。',409);
 return {id:'mock-publishing',async submit(input){
  const hash=createHash('sha256').update(canonical(input)).digest('hex'),old=store.get(input.jobId);
  if(old){if(old.hash!==hash)throw new AppError('PUBLISH_INPUT_CONFLICT','同一发布编号的内容不同，请核对任务。',409);return {state:old.status,remoteId:old.remoteId,simulated:true};}
  if(input.scenario==='failed')return {state:'failed',remoteId:null,simulated:true};
  const remoteId='mock-publish:'+input.jobId,status=input.scenario==='accepted'?'submitted':'published';store.put(input.jobId,hash,remoteId,status);
  return input.scenario==='unknown'?{state:'unknown',remoteId:null,simulated:true}:{state:status,remoteId,simulated:true};
 },async lookup(jobId){const old=store.get(jobId);return old?{state:old.status,remoteId:old.remoteId,simulated:true}:null;},async metrics(jobId){if(store.get(jobId)?.status!=='published')throw new AppError('METRICS_UNAVAILABLE','渠道尚未确认发布，无法收集数据。',409);const n=createHash('sha256').update(jobId).digest().readUInt16LE(0);return {views:n,likes:Math.floor(n/20),comments:Math.floor(n/100),eventTime:new Date().toISOString()};}};
}
