export class PeerRequestError extends Error{constructor(message:string,public status:number){super(message);}}
export type PeerRequest=<T>(suffix:string,body?:object,signal?:AbortSignal,key?:string)=>Promise<T>;
export function peerRequests(prefix:string,csrf:()=>string):PeerRequest {
 return async<T>(suffix:string,body?:object,signal?:AbortSignal,key:string=crypto.randomUUID()):Promise<T>=>{
  const response=await fetch(prefix+suffix,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',signal,headers:body?{'Content-Type':'application/json','X-CSRF-Token':csrf(),'Idempotency-Key':key}:{},body:body?JSON.stringify(body):undefined}),data=await response.json();
  if(!response.ok)throw new PeerRequestError(data.error?.message||'连麦请求失败，请重新确认邀请和连接。',response.status);return data.data as T;
 };
}
