import {useEffect,useRef,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import type {ProactiveView,ProactiveSettingsInput,ReceptionSession} from '@digitalguide/contracts';
import {api,ApiError} from '../api.js';
import './proactive.css';
type Settings=NonNullable<ProactiveView['settings']>;
type Intent={scope:string;identity:string;selection:number;body:ProactiveSettingsInput};
const defaults:Settings={enabled:false,doNotDisturb:false,quietStart:'22:00',quietEnd:'08:00',cooldownMinutes:60,usePublicNickname:false};
const reasons:Record<NonNullable<ProactiveView['blockedReason']>,string>={no_consent:'尚未同意本次主动问候。',session_unavailable:'本次接待已结束或暂不可用。',context_changed:'服务对象或本组安排已变化，请重新核对本次用途。',access_changed:'本次访问凭证已变化，请重新打开当前终端。',settings_changed:'交流设置已更新，请载入当前设置。',disabled:'本次主动问候已关闭。',expired:'本次问候授权已到期。',do_not_disturb:'免打扰已开启，当前不会主动问候。',restaurant_paused:'门店当前暂停迎宾或不在营业时段。',quiet_hours:'当前处于静默时段，不会主动问候。',party_changed:'本组安排已变化，请重新核对。',memory_unavailable:'公开称呼的本人资料暂不可用；可关闭公开称呼后重新核对。',cooldown:'正在交流冷却期间，暂不重复问候。',busy:'当前有交流或待确认事项，暂不主动打扰。',message_limit:'本次交流已达到上限，请联系店员。'};
const time=(value:string)=>new Date(value).toLocaleString('zh-CN',{hour12:false});
function newer(a:ProactiveView|undefined,b:ProactiveView){return a&&a.sessionId===b.sessionId&&a.focusVersion===b.focusVersion&&(a.sessionVersion>b.sessionVersion||a.version>b.version||a.selectionVersion>b.selectionVersion)?a:b;}

export function GuestProactivePanel({session,csrfToken}:{session:ReceptionSession;csrfToken:string}){
 const client=useQueryClient(),active=session.status==='active',base='/guest/sessions/'+session.id+'/proactive',key=['guest-proactive',session.id,session.focusVersion,session.status];
 const query=useQuery({queryKey:key,queryFn:async({signal})=>{const v=await api<ProactiveView>(base,undefined,'GET',undefined,signal);if(v.sessionId!==session.id||v.focusVersion!==session.focusVersion)throw new ApiError('VERSION_CONFLICT','当前服务对象已经变化，请重新核对。',409);return newer(client.getQueryData<ProactiveView>(key),v);},enabled:active,retry:false,gcTime:0,refetchInterval:q=>q.state.error?false:1000});
 const value=active&&!query.error?query.data:undefined;
 function refresh(error?:unknown){
  if(error instanceof ApiError&&[401,403,404].includes(error.status)){
   void client.cancelQueries({queryKey:key,exact:true}).then(()=>client.resetQueries({queryKey:key,exact:true}));
   const parent=['guest-session',session.id];void client.cancelQueries({queryKey:parent,exact:true}).then(()=>client.resetQueries({queryKey:parent,exact:true}));
  }else{void query.refetch();void client.invalidateQueries({queryKey:['guest-session',session.id],exact:true});}
 }
 return <section className="panel proactive-panel" aria-label="本次主动问候" data-proactive-session={session.id}>
  <div className="section-heading"><div><h2>本次主动问候</h2><span>由您决定是否交流，随时可以撤回</span></div><span className="badge amber">模拟</span></div>
  <p>仅在本次到店期间适度问候。普通问候无需登记长期资料；保存偏好不会自动开启本次交流。</p>
  {!active?<p role="status">{session.status==='human'?'当前已转人工，主动问候暂停。恢复后请重新核对本次用途。':'本次接待已结束，主动问候不再生效。'}</p>:query.error?<><div className="error" role="alert">{query.error instanceof Error?query.error.message:'未能核对本次交流设置。'}</div><button className="button secondary" onClick={()=>refresh()}>重新核对本次交流设置</button></>:!value?<p role="status">正在核对本次交流设置…</p>:<ProactiveForm key={session.id+':'+session.focusVersion+':'+value.selectionVersion} data={value} session={session} csrfToken={csrfToken} base={base} queryKey={key} refresh={refresh}/>}
 </section>;
}

function ProactiveForm({data,session,csrfToken,base,queryKey,refresh}:{data:ProactiveView;session:ReceptionSession;csrfToken:string;base:string;queryKey:readonly unknown[];refresh(error?:unknown):void}){
 const client=useQueryClient(),[form,setForm]=useState<Settings>(()=>({...data.settings||defaults})),[version,setVersion]=useState(data.version),[confirmedFor,setConfirmedFor]=useState<string|null>(null),[saved,setSaved]=useState(''),[,tick]=useState(0),controller=useRef<AbortController|null>(null);
 const expired=!!data.expiresAt&&Date.parse(data.expiresAt)<=Date.now(),ready=session.status==='active'&&data.focusVersion===session.focusVersion&&data.sessionVersion===session.version&&!expired,stale=version!==data.version;
 const identity=JSON.stringify([session.id,session.focusVersion,session.status,data.selectionVersion]),scope=JSON.stringify([identity,session.version,session.replyEpoch,data.version,version,form,ready]),live=useRef({identity,scope,selection:data.selectionVersion,version:session.version,mounted:true});Object.assign(live.current,{identity,scope,selection:data.selectionVersion,version:session.version});
 useEffect(()=>{live.current.mounted=true;return()=>{live.current.mounted=false;controller.current?.abort();};},[]);
 useEffect(()=>{if(!data.expiresAt)return;const t=setTimeout(()=>tick(n=>n+1),Math.max(0,Date.parse(data.expiresAt)-Date.now())+1);return()=>clearTimeout(t);},[data.expiresAt]);
 const checked=confirmedFor===scope&&ready&&!stale;
 function update(values:Partial<Settings>){setForm(v=>({...v,...values}));setConfirmedFor(null);setSaved('');}
 function load(){setForm({...data.settings||defaults});setVersion(data.version);setConfirmedFor(null);setSaved('');}
 const mutation=useMutation({gcTime:0,mutationFn:async(intent:Intent)=>{
  const abort=new AbortController();controller.current=abort;
  try{
   const fresh=await api<ProactiveView>(base,undefined,'GET',undefined,abort.signal),now=live.current;
   if(!now.mounted||now.scope!==intent.scope||now.identity!==intent.identity||abort.signal.aborted)throw new ApiError('VERSION_CONFLICT','当前接待或输入已经变化，请重新核对。',409);
   if(fresh.sessionId!==session.id||fresh.version!==intent.body.version||fresh.sessionVersion!==intent.body.sessionVersion||fresh.focusVersion!==intent.body.focusVersion||fresh.selectionVersion!==intent.body.selectionVersion){client.setQueryData<ProactiveView>(queryKey,old=>newer(old,fresh));refresh();throw new ApiError('VERSION_CONFLICT','本次交流或设置已更新，输入已保留；请载入当前设置后重新核对。',409);}
   controller.current=null;return{intent,value:await api<ProactiveView>(base,intent.body,'POST',csrfToken,abort.signal)};
  }finally{if(controller.current===abort)controller.current=null;}
 },onSuccess:({intent,value})=>{
  const now=live.current;if(!now.mounted||now.identity!==intent.identity||now.selection!==intent.selection||now.version>value.sessionVersion)return;
  client.setQueryData<ProactiveView>(queryKey,old=>newer(old,value));setForm({...value.settings||defaults});setVersion(value.version);setConfirmedFor(null);setSaved(intent.body.enabled?'已保存本次交流设置。':'本次主动问候已撤回。');refresh();
 },onError:(error,intent)=>{if(!live.current.mounted||live.current.identity!==intent.identity||live.current.scope!==intent.scope)return;setConfirmedFor(null);refresh(error);}});
 function submit(withdraw=false){
  if(!ready||mutation.isPending||!withdraw&&(!checked||stale))return;
  const settings=withdraw?{...data.settings||defaults,enabled:false,usePublicNickname:false}:form;
  mutation.mutate({scope,identity,selection:data.selectionVersion,body:{...settings,version:withdraw?data.version:version,sessionVersion:session.version,focusVersion:session.focusVersion,selectionVersion:data.selectionVersion,purpose:'onsite_greeting',noticeVersion:'proactive-v1',consent:!withdraw&&settings.enabled,confirmed:true}});
 }
 const error=mutation.error&&mutation.variables?.identity===identity&&mutation.variables.scope===scope?mutation.error:null;
 return <div data-proactive-version={data.version} data-proactive-session-version={data.sessionVersion} data-proactive-ready={ready}>
  <div className="proactive-status" aria-label="当前主动问候状态"><strong>{data.consented&&!expired?'本次用途已同意':'本次用途尚未开启或已失效'}</strong><p role="status">{expired?'本次问候授权已到期。':data.blockedReason?reasons[data.blockedReason]:'本次允许适度问候；仍会等待合适的交流时机。'}</p>{data.expiresAt&&<p>本次有效至 {time(data.expiresAt)}</p>}{data.lastGreetingAt&&<p>最近一次问候：{time(data.lastGreetingAt)}</p>}</div>
  <form className="proactive-form" aria-label="本次交流设置" onSubmit={e=>{e.preventDefault();submit();}}>
   <fieldset disabled={!ready||mutation.isPending}>
    <label className="checkbox-line"><input type="checkbox" checked={form.enabled} onChange={e=>update({enabled:e.target.checked})}/>开启本次主动问候</label>
    <label className="checkbox-line"><input type="checkbox" checked={form.doNotDisturb} onChange={e=>update({doNotDisturb:e.target.checked})}/>本次免打扰</label>
    <div className="proactive-fields"><label>本次静默开始<input type="time" required value={form.quietStart} onChange={e=>update({quietStart:e.target.value})}/></label><label>本次静默结束<input type="time" required value={form.quietEnd} onChange={e=>update({quietEnd:e.target.value})}/></label><label>本次交流冷却（分钟）<input type="number" required min={5} max={1440} value={form.cooldownMinutes} onChange={e=>update({cooldownMinutes:Number(e.target.value)})}/></label></div>
    <p className="form-help">静默时段使用门店时区；开始与结束相同表示全天静默。重新同意不会重置已经开始的冷却。</p>
    <label className="checkbox-line"><input type="checkbox" checked={form.usePublicNickname} onChange={e=>update({usePublicNickname:e.target.checked})}/>允许使用本人已确认的公开称呼</label>
    <p className="form-help">公开称呼需先在“我的接待偏好”中另行授权并确认。私人内容不用于公开问候。</p>
    {stale&&<p className="proactive-warning" role="status">设置已更新，输入已保留；请载入当前交流设置后重新核对。</p>}
    {confirmedFor&&!checked&&!stale&&<p className="proactive-warning" role="status">接待或设置已变化，请重新核对本次交流。</p>}
    <label className="checkbox-line"><input type="checkbox" checked={checked} disabled={stale} onChange={e=>setConfirmedFor(e.target.checked?scope:null)}/>我已核对并同意本次交流设置</label>
    <div className="proactive-actions"><button className="button secondary" type="button" onClick={load}>载入当前交流设置</button><button className="button primary" disabled={!checked||stale||mutation.isPending}>{mutation.isPending?'正在核对本次设置…':'保存本次交流设置'}</button></div>
   </fieldset>
  </form>
  {data.consented&&<button className="button secondary danger" disabled={!ready||mutation.isPending} onClick={()=>submit(true)}>撤回本次主动问候</button>}
  {saved&&<p role="status">{saved}</p>}{error&&<div className="error" role="alert">{error instanceof Error?error.message:'本次设置未完成，请重新核对。'}</div>}
 </div>;
}
