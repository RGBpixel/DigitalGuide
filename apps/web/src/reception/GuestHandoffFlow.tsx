import {useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {useMutation,useQuery,useQueryClient,type QueryClient} from '@tanstack/react-query';
import type {GuestSessionView} from '@digitalguide/contracts';
import {api,ApiError} from '../api.js';

interface HandoffInput {version:number;focusVersion:number;confirmed:true;nextVisitorConfirmed:true}
interface Recovery {intentId:string;state:'prepared'|'committed';input:HandoffInput;expiresAt:string;operationKey:string;csrfToken:string}
interface Result {sessionId:string;terminalUrl:string}
const marker=(id:string)=>'dg_handoff_pending.v1:'+id;
function remembered(id:string){try{return sessionStorage.getItem(marker(id))==='1';}catch{return false;}}
function remember(id:string,on:boolean){try{if(on)sessionStorage.setItem(marker(id),'1');else sessionStorage.removeItem(marker(id));}catch{/* The current page still has its in-memory state. No credential is stored. */}}
async function clearGuestQueries(client:QueryClient,id:string){const predicate=(q:{queryKey:readonly unknown[]})=>q.queryKey[1]===id&&typeof q.queryKey[0]==='string'&&(q.queryKey[0].startsWith('guest-')||q.queryKey[0]==='speaker-focus'||q.queryKey[0]==='visual-state');await client.cancelQueries({predicate});client.removeQueries({predicate});}
export function useGuestHandoff(sessionId:string){
 const client=useQueryClient(),navigate=useNavigate(),[pendingId,setPendingId]=useState<string|null>(()=>remembered(sessionId)?sessionId:null),pending=pendingId===sessionId||remembered(sessionId),base='/guest/sessions/'+sessionId+'/speaker-focus';
 const status=useQuery({queryKey:['guest-handoff',sessionId],queryFn:({signal})=>api<Recovery>(base+'/handoff-intent',undefined,'GET',undefined,signal),enabled:pending,retry:false,refetchOnWindowFocus:false});
 async function finish(result:Result,id:string){
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(result.sessionId))throw new Error('新会话地址无法核对，请使用交接恢复入口。');
  remember(id,false);setPendingId(v=>v===id?null:v);await clearGuestQueries(client,id);
  if(window.location.pathname==='/terminal/'+id)navigate('/terminal/'+result.sessionId,{replace:true});
 }
 const start=useMutation({mutationKey:['guest-handoff-start',sessionId],gcTime:0,mutationFn:async(v:{id:string;native:boolean;csrf:string;input:HandoffInput})=>{
  const route='/guest/sessions/'+v.id+'/speaker-focus';
  if(v.native){remember(v.id,true);setPendingId(v.id);await clearGuestQueries(client,v.id);const prepared=await api<{operationKey:string}>(route+'/handoff-intent',v.input,'POST',v.csrf);return api<Result>(route+'/handoff',v.input,'POST',v.csrf,undefined,prepared.operationKey);}
  return api<Result>(route+'/handoff',v.input,'POST',v.csrf);
 },onSuccess:(result,v)=>finish(result,v.id),onError:(_error,v)=>{if(v.native)void client.invalidateQueries({queryKey:['guest-handoff',v.id]});}});
 const recover=useMutation({mutationKey:['guest-handoff-recover',sessionId],gcTime:0,mutationFn:async(id:string)=>{const route='/guest/sessions/'+id+'/speaker-focus',d=await api<Recovery>(route+'/handoff-intent');return api<Result>(route+'/handoff',d.input,'POST',d.csrfToken,undefined,d.operationKey);},onSuccess:(result,id)=>finish(result,id)});
 const restore=useMutation({mutationKey:['guest-handoff-return',sessionId],gcTime:0,mutationFn:async(id:string)=>{const view=await api<GuestSessionView>('/guest/sessions/'+id);if(!['active','human'].includes(view.session.status))throw new Error('原接待已结束，请继续恢复交接或联系前台。');return view;},onSuccess:async(view,id)=>{remember(id,false);setPendingId(v=>v===id?null:v);client.removeQueries({queryKey:['guest-handoff',id]});client.setQueryData(['guest-session',id],view);start.reset();recover.reset();}});
 return{pending,blocked:pending||start.isPending||recover.isPending,startBusy:start.isPending,recoverBusy:recover.isPending,restoreBusy:restore.isPending,status,startError:start.error,recoverError:recover.error,restoreError:restore.error,begin:(input:HandoffInput,csrf:string,native:boolean)=>start.mutate({id:sessionId,input,csrf,native}),resume:()=>recover.mutate(sessionId),restore:()=>restore.mutate(sessionId)};
}
export function GuestHandoffRecovery({flow}:{flow:ReturnType<typeof useGuestHandoff>}){
 const busy=flow.startBusy||flow.recoverBusy||flow.restoreBusy,errors=[flow.startError,flow.recoverError,flow.restoreError].filter(Boolean);
 return <section className="panel guest-handoff-recovery" aria-label="接待交接恢复"><h1>{flow.startBusy?'正在为下一位准备独立接待':flow.recoverBusy?'正在恢复原交接':'交接状态待核对'}</h1><p>本次交接会停止旧设备预览和播放。请等待新接待页面；下一位需要重新确认本人声音参考。</p>{busy?<p role="status">正在核对本次操作，请稍候…</p>:<>{flow.status.data&&<p role="status">{flow.status.data.state==='committed'?'原交接已保存，尚未领取新访问。可继续打开同一个新会话。':'原准备尚未结束本次接待。可继续交接，或先核对原接待。'}</p>}{flow.status.data&&<p className="form-help">恢复期限：{new Date(flow.status.data.expiresAt).toLocaleTimeString('zh-CN')}，核对状态不会延长期限。</p>}{flow.status.error&&<div className="info-note">交接准备可能未完成、已领取或过期。可先重新载入原接待；若无法载入，请联系前台重新打开。</div>}<div className="speaker-actions"><button className="button primary" onClick={flow.resume}>恢复原交接并打开新会话</button><button className="button secondary" onClick={flow.restore}>重新载入本次接待</button></div></>}{errors.map((e,i)=><div className="error" role="alert" key={i}>{e instanceof ApiError?e.message:'网络暂时中断，交接状态尚未核对。请恢复原交接，或重新载入本次接待。'}</div>)}</section>;
}
