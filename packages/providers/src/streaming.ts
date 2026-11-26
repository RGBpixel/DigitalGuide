import {AppError} from '@digitalguide/domain';
export interface StreamOperation {targetId:string;operationId:string;attempt:number;behavior:'healthy'|'fail_once'|'unknown_once'}
export interface StreamReceipt {operationId:string;status:'connected'|'failed'|'unknown';remoteId:string|null;errorMessage:string|null;simulated:boolean;remotePlaybackVerified:boolean}
export interface StreamingProvider {
 id:string;environment:'mock'|'sandbox'|'live';connect(operation:StreamOperation):StreamReceipt;lookup(operation:StreamOperation):StreamReceipt;
}
export class MockStreamingProvider implements StreamingProvider {
 id='mock-streaming-v1';environment='mock' as const;
 connect(o:StreamOperation):StreamReceipt{const status=o.attempt===1&&o.behavior==='fail_once'?'failed':o.attempt===1&&o.behavior==='unknown_once'?'unknown':'connected';return{operationId:o.operationId,status,remoteId:status==='connected'?'mock-stream:'+o.targetId+':'+o.operationId:null,errorMessage:status==='failed'?'模拟目标首次连接失败，可单独重试。':status==='unknown'?'模拟回执丢失，请核对原操作；不会自动重新连接。':null,simulated:true,remotePlaybackVerified:false};}
 lookup(o:StreamOperation):StreamReceipt{return{operationId:o.operationId,status:'connected',remoteId:'mock-stream:'+o.targetId+':'+o.operationId,errorMessage:null,simulated:true,remotePlaybackVerified:false};}
}
export function selectStreamingProvider(environment:string,appEnv:string):StreamingProvider{if(environment!=='mock'||appEnv==='production')throw new AppError('LIVE_PROVIDER_UNCONFIGURED','未配置经过验证的直播媒体适配器，不会退回模拟推流。',503);return new MockStreamingProvider();}
export interface AudienceEventProvider {id:string;environment:'mock'|'sandbox'|'live';verification:'not_configured'|'contract_verified'|'live_verified';supportsComments:boolean;supportsOptInJoin:boolean;verifyIncoming?(raw:Buffer,headers:Record<string,string>):boolean}
