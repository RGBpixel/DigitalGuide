import {useEffect,useRef,useState} from 'react';
import {useMutation,useQueryClient} from '@tanstack/react-query';
import type {GuestSessionView,ReceptionSession,ToolRequest} from '@digitalguide/contracts';
import {api,ApiError} from '../api.js';

type Intent={scope:string;sessionId:string;version:number;focusVersion:number;requestId:string;name:ToolRequest['name'];preview:string;expiresAt:string};
export function ToolConfirmation({request,session,csrfToken,update}:{request:ToolRequest;session:ReceptionSession;csrfToken:string;update:(v:GuestSessionView)=>void}){
 const client=useQueryClient(),[confirmedFor,setConfirmedFor]=useState<string|null>(null),[,tick]=useState(0),controller=useRef<AbortController|null>(null);
 const scope=JSON.stringify([session.id,session.status,session.version,session.focusVersion,session.replyEpoch,request.id,request.name,request.status,request.preview,request.expiresAt]),live=useRef<string|null>(scope);live.current=scope;
 useEffect(()=>{live.current=scope;return()=>{live.current=null;controller.current?.abort();};},[scope]);
 useEffect(()=>{const timer=setTimeout(()=>tick(n=>n+1),Math.max(0,Date.parse(request.expiresAt)-Date.now())+1);return()=>clearTimeout(timer);},[request.id,request.expiresAt]);
 const expired=Date.parse(request.expiresAt)<=Date.now(),confirmed=confirmedFor===scope&&!expired&&session.status==='active';
 const confirm=useMutation({gcTime:0,mutationFn:async(intent:Intent)=>{
  const signal=new AbortController();controller.current=signal;
  try{
   const fresh=await api<GuestSessionView>('/guest/sessions/'+intent.sessionId,undefined,'GET',undefined,signal.signal);
   if(live.current!==intent.scope||signal.signal.aborted)throw new ApiError('VERSION_CONFLICT','当前服务对象已经变化，请重新核对。',409);
   const current=fresh.session.messages.flatMap(m=>m.toolRequests||[]).find(r=>r.id===intent.requestId);
   if(fresh.session.id!==intent.sessionId||fresh.session.status!=='active'||fresh.session.version!==intent.version||fresh.session.focusVersion!==intent.focusVersion||!current||current.status!=='proposed'||current.name!==intent.name||(current.preview||'')!==intent.preview||current.expiresAt!==intent.expiresAt){
    update(fresh);throw new ApiError('VERSION_CONFLICT','当前接待或服务建议已经变化，请重新核对。',409);
   }
   if(Date.parse(current.expiresAt)<=Date.now())throw new ApiError('SUGGESTION_EXPIRED','建议已到期，请重新提出本次需求。',409);
   // Let an issued write settle; a late result is discarded by the scope guard.
   controller.current=null;
   const value=await api<GuestSessionView>('/guest/sessions/'+intent.sessionId+'/tools/confirm',{requestId:intent.requestId,version:intent.version,focusVersion:intent.focusVersion,confirmed:true},'POST',fresh.csrfToken||csrfToken,signal.signal);
   return{scope:intent.scope,value};
  }finally{if(controller.current===signal)controller.current=null;}
 },onSuccess:result=>{if(live.current!==result.scope)return;setConfirmedFor(null);update(result.value);},onError:(error,intent)=>{
  if(live.current!==intent.scope)return;setConfirmedFor(null);
  const key=['guest-session',intent.sessionId];
  if(error instanceof ApiError&&[401,403,404].includes(error.status))void client.cancelQueries({queryKey:key,exact:true}).then(()=>client.resetQueries({queryKey:key,exact:true}));
  else void client.invalidateQueries({queryKey:key,exact:true});
 }});
 if(request.status!=='proposed'||session.status!=='active')return null;
 const service=request.name==='restaurant.service_request',order=request.name==='restaurant.order_draft';
 const title=service?'待确认的店员服务请求':order?'待确认的点单草稿':'待确认的接待操作';
 const checkText=service?'确认将本次服务请求交给店员':order?'我确认将这些菜品应用到本次点单草稿':'我确认请求工作人员接待，自动接待将暂停';
 const buttonText=service?'确认提交店员服务请求':order?'应用到点单草稿':'确认请求人工接待';
 const submit=()=>{if(!confirmed||expired||confirm.isPending)return;confirm.mutate({scope,sessionId:session.id,version:session.version,focusVersion:session.focusVersion,requestId:request.id,name:request.name,preview:request.preview||'',expiresAt:request.expiresAt});};
 return <div className="tool-confirmation" aria-label={title} data-tool-request-id={request.id}>
  <strong>{service||order?request.label:'建议操作：'+request.label}</strong>{request.preview&&<p>{request.preview}</p>}
  {order&&<p>应用后仍需审阅、确认和提交；此操作不会下单或扣库存。</p>}
  {expired?<p role="status">建议已到期，请重新提出本次需求。</p>:confirmedFor&&!confirmed&&<p role="status">接待或建议已变化，请重新核对。</p>}
  <label className="checkbox-line"><input type="checkbox" checked={confirmed} disabled={expired||confirm.isPending} onChange={e=>setConfirmedFor(e.target.checked?scope:null)}/>{checkText}</label>
  <button disabled={!confirmed||expired||confirm.isPending} onClick={submit}>{confirm.isPending?'正在核对本次请求…':buttonText}</button>
  {confirm.error&&<div className="error" role="alert">{confirm.error instanceof Error?confirm.error.message:'请求未完成，请重新核对。'}</div>}
 </div>;
}
