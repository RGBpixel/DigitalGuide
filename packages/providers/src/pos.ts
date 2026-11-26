import { createHash } from 'node:crypto';
import { AppError,canonical } from '@digitalguide/domain';
import type { POSMutation,POSReceipt,POSScenario } from '@digitalguide/contracts';
export interface POSProvider {
 id:string;simulated:boolean;
 submit(input:POSMutation,scenario:POSScenario):Promise<POSReceipt>;
 lookup(requestId:string):Promise<POSReceipt|null>;
}
export interface MockPOSOperation {requestId:string;restaurantId:string;requestHash:string;payload:POSMutation;remoteRequestId:string;remoteOrderId:string;outcome:'accepted'|'rejected';sequence:number}
export interface POSReceiptStore {get(id:string):MockPOSOperation|undefined;put(row:MockPOSOperation):void}
export class POSFailure extends Error {constructor(public code:string,public unknown:boolean){super(code);}}
export function selectPOSProvider(providerId:string,environment:string,appEnv:string,store:POSReceiptStore):POSProvider {
 if(providerId!=='mock-pos'||environment!=='mock'||appEnv==='production')throw new AppError('POS_NOT_CONFIGURED','当前后厨/POS服务尚未接通，请由店员核对连接；不会返回模拟成功。',409);
 const result=(op:MockPOSOperation,status:POSReceipt['status']):POSReceipt=>({requestId:op.requestId,requestHash:op.requestHash,restaurantId:op.restaurantId,remoteRequestId:op.remoteRequestId,remoteOrderId:op.remoteOrderId,status,sequence:status==='submitted'?1:op.sequence,simulated:true,reasonCode:status==='rejected'?'MOCK_REJECTED':null});
 return {id:'mock-pos',simulated:true,
  async submit(input,scenario){
   const requestHash=createHash('sha256').update(canonical(input)).digest('hex'),old=store.get(input.requestId);
   if(old){if(old.requestHash!==requestHash||old.restaurantId!==input.restaurantId)throw new POSFailure('POS_REQUEST_CONFLICT',true);return result(old,'submitted');}
   await new Promise(resolve=>setTimeout(resolve,80));
   if(scenario==='unresolved')throw new POSFailure('MOCK_RESULT_UNRESOLVED',true);
   const op:MockPOSOperation={requestId:input.requestId,restaurantId:input.restaurantId,requestHash,payload:input,remoteRequestId:'mock-pos:'+input.requestId,remoteOrderId:input.remoteOrderId||'mock-order:'+input.orderId,outcome:scenario==='rejected'?'rejected':'accepted',sequence:2};
   store.put(op);
   if(scenario==='response_lost')throw new POSFailure('MOCK_RESPONSE_LOST',true);
   return result(op,'submitted');
  },
  async lookup(requestId){const op=store.get(requestId);return op?result(op,op.outcome):null;}
 };
}
