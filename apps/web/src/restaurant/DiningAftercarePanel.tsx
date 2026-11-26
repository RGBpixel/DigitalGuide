import {useEffect,useRef,useState} from 'react';
import {useMutation} from '@tanstack/react-query';
import {Link} from 'react-router-dom';
import type {DiningAftercare,DiningParty} from '@digitalguide/contracts';
import {api} from '../api.js';
import {Box,Note,diningTime} from './DiningShared.js';
import {useDiningResource} from './useDiningResource.js';
import './aftercare.css';

type Props={party:DiningParty;guestBase?:string;csrfToken?:string;focusVersion?:number;selectionVersion?:number;automatic?:boolean;native?:boolean;refresh():void};
type FormProps={data?:DiningAftercare;base:string;csrfToken?:string;focusVersion:number;selectionVersion?:number;party:DiningParty;native:boolean;ready:boolean;context:string;updated(error?:unknown):void};
type Operation='save'|'revoke';

function useLiveContext(context:string){
 const ref=useRef<string|null>(context);ref.current=context;
 useEffect(()=>{ref.current=context;return()=>{ref.current=null;};},[context]);
 return ref;
}

export function DiningAftercarePanel({party:p,guestBase,csrfToken,focusVersion=0,selectionVersion,automatic=true,native=false,refresh}:Props){
 const base=(guestBase?guestBase+'/dining':'/restaurant')+'/parties/'+p.id,enabled=p.status==='completed'&&(!guestBase||automatic);
 const query=useDiningResource<DiningAftercare>({key:['dining-aftercare',base,p.version,p.accessVersion,focusVersion,selectionVersion,automatic],url:base+'/aftercare',enabled});
 const context=JSON.stringify([base,p.version,p.accessVersion,focusVersion,selectionVersion,automatic]),matches=!native||query.data?.partyVersion===p.version&&query.data.partyAccessVersion===p.accessVersion;
 const ready=!!query.data&&matches&&automatic&&(!native||selectionVersion!==undefined),updated=(error?:unknown)=>{query.reload(error);refresh();};
 if(p.status!=='completed')return null;
 const forms={data:query.data,base,csrfToken,focusVersion,selectionVersion,party:p,native,ready,context,updated};
 return <Box title="感谢光临"><div className="aftercare-panel" aria-label="餐后送别">
  <p className="farewell-message">{query.data?.farewell||'本次就餐已结束，感谢光临。'}</p>
  <p className="form-help">评价与回访分别自愿选择，均可跳过，不影响本次服务和账单。</p>
  {query.data&&<><p className="form-help">{query.data.notice}</p><CurrentAftercare data={query.data}/></>}
  {enabled&&!query.data&&!query.error&&<p role="status">正在核对本次餐后记录…</p>}
  {query.data&&!matches&&<p role="status">本组安排已变化，正在读取当前餐后记录；请重新核对。</p>}
  {guestBase&&automatic&&!query.error&&<><FeedbackForm {...forms}/><FollowupForm {...forms}/></>}
  {guestBase&&!automatic&&<p className="form-help">当前已转人工，请联系店员。已保存的本人撤回凭证仍可在离店管理入口使用。</p>}
  <Note error={query.error}/>{query.error&&<button onClick={()=>query.reload()}>重新核对本人餐后记录</button>}
  {guestBase&&native&&<p className="form-help"><Link to="/aftercare/manage" target="_blank" rel="noopener noreferrer">打开本人离店撤回管理</Link>。请自行保存对应凭证，换人或离店后本终端不保留凭证。</p>}
 </div></Box>;
}

function CurrentAftercare({data}:{data:DiningAftercare}){
 return <div className="aftercare-current" aria-label="当前餐后记录" data-feedback-version={data.feedback?.version||0} data-followup-version={data.followup?.version||0}>
  {data.feedback&&<p>{data.feedback.status==='active'?<>已保存的自愿评价：{data.feedback.rating?data.feedback.rating+' / 5 · ':''}{data.feedback.comment} · 保留至 {diningTime(data.feedback.expiresAt)}</>:data.feedback.status==='withdrawn'?'本次评价已撤回并清除':'本次评价已到期清除'}</p>}
  {data.followup&&<p>{data.followup.status==='active'?<>已授权本次回访：{data.followup.contactMask} · 至 {diningTime(data.followup.expiresAt)}，尚未向外联系</>:data.followup.status==='withdrawn'?'回访授权已撤回，联系方式已清除':'回访授权已到期清除'}</p>}
  {data.feedback?.managementCode&&<ManagementReceipt name="本次评价撤回凭证" code={data.feedback.managementCode}/>}
  {data.followup?.managementCode&&<ManagementReceipt name="本次回访撤回凭证" code={data.followup.managementCode}/>}
 </div>;
}

function ManagementReceipt({name,code}:{name:string;code:string}){
 const [message,setMessage]=useState('');
 return <details className="aftercare-section"><summary>自行保存{name}</summary><p className="form-help">仅用于清除对应这一项记录；不能登录、付款或读取联系方式。请私下保管，重新授权后旧凭证失效。</p><label className="aftercare-code-label">{name}<textarea readOnly rows={3} value={code} autoComplete="off" spellCheck={false}/></label><button type="button" onClick={()=>{if(!navigator.clipboard){setMessage('请选中上方凭证手动复制。');return;}void navigator.clipboard.writeText(code).then(()=>setMessage('已复制，请自行妥善保存。'),()=>setMessage('未能复制，请选中上方凭证手动复制。'));}}>复制{name}</button>{message&&<p role="status">{message}</p>}</details>;
}

function FeedbackForm({data,base,csrfToken,focusVersion,selectionVersion,party:p,native,ready,context,updated}:FormProps){
 const [loaded,setLoaded]=useState(false),[version,setVersion]=useState(0),[rating,setRating]=useState(''),[comment,setComment]=useState(''),[operation,setOperation]=useState<Operation>('save'),[confirmedFor,setConfirmedFor]=useState<string|null>(null),live=useLiveContext(context);
 function load(){if(!data)return;setVersion(data.feedback?.version||0);setRating(data.feedback?.rating?.toString()||'');setComment(data.feedback?.comment||'');setOperation('save');setConfirmedFor(null);setLoaded(true);}
 useEffect(()=>{if(data&&!loaded){setVersion(data.feedback?.version||0);setRating(data.feedback?.rating?.toString()||'');setComment(data.feedback?.comment||'');setLoaded(true);}},[data,loaded]);
 const stale=version!==(data?.feedback?.version||0),allowed=ready&&!!data?.canGiveFeedback&&!stale,scope=JSON.stringify([context,version,operation,rating,comment,allowed]),checked=confirmedFor===scope&&allowed;
 const save=useMutation({gcTime:0,mutationFn:async(request:{context:string;operation:Operation})=>({context:request.context,value:await api<DiningAftercare>(base+'/feedback'+(request.operation==='revoke'?'/revoke':''),{version,...(request.operation==='save'?{rating:rating?Number(rating):null,comment}:{}),confirmed:true,focusVersion,...(selectionVersion!==undefined?{selectionVersion}:{}),...(native?{partyVersion:p.version}:{})},'POST',csrfToken)}),onSuccess:result=>{if(live.current!==result.context)return;setVersion(result.value.feedback?.version||0);setRating(result.value.feedback?.rating?.toString()||'');setComment(result.value.feedback?.comment||'');setOperation('save');setConfirmedFor(null);updated();},onError:(error,request)=>{if(live.current!==request.context)return;setConfirmedFor(null);updated(error);}});
 return <details className="aftercare-section"><summary>自愿留下本次评价</summary><form className="dining-form" aria-label="本人自愿评价" onSubmit={e=>{e.preventDefault();if(checked&&allowed&&!save.isPending&&(operation==='revoke'||!!rating||!!comment.trim()))save.mutate({context,operation});}}>
  <fieldset disabled={!ready||save.isPending}>
   <label>本次评分（可不选）<select value={rating} onChange={e=>{setRating(e.target.value);setOperation('save');setConfirmedFor(null);}}><option value="">可选择评分</option>{[5,4,3,2,1].map(n=><option key={n} value={n}>{n} / 5</option>)}</select></label>
   <label>本次评价或建议<textarea value={comment} maxLength={800} onChange={e=>{setComment(e.target.value);setOperation('save');setConfirmedFor(null);}}/></label>
   {stale&&<p className="dining-warning">评价已更新，本地输入保留。请载入当前评价后重新核对。</p>}
   <div className="dining-actions"><button type="button" onClick={load}>载入当前评价</button>{data?.feedback?.status==='active'&&<button type="button" onClick={()=>{setVersion(data.feedback!.version);setOperation('revoke');setConfirmedFor(null);}}>选择撤回本次评价</button>}</div>
   {operation==='revoke'&&<p className="dining-warning">将撤回并清除已保存的本次评价，不影响独立回访授权。</p>}
   <label className="dining-check"><input type="checkbox" checked={checked} disabled={!allowed} onChange={e=>setConfirmedFor(e.target.checked?scope:null)}/>{operation==='revoke'?'我确认撤回并清除本次评价':'我自愿将本次评价交给门店，不启用回访'}</label>
   <button disabled={!checked||!allowed||save.isPending||operation==='save'&&!rating&&!comment.trim()}>{save.isPending?'正在保存评价操作…':operation==='revoke'?'撤回并清除本次评价':'保存自愿评价'}</button>
  </fieldset><Note error={save.error}/>
 </form></details>;
}

function FollowupForm({data,base,csrfToken,focusVersion,selectionVersion,party:p,native,ready,context,updated}:FormProps){
 const [loaded,setLoaded]=useState(false),[version,setVersion]=useState(0),[kind,setKind]=useState<'email'|'phone'>('email'),[contact,setContact]=useState(''),[days,setDays]=useState(7),[operation,setOperation]=useState<Operation>('save'),[confirmedFor,setConfirmedFor]=useState<string|null>(null),live=useLiveContext(context);
 function load(){if(!data)return;setVersion(data.followup?.version||0);setKind(data.followup?.contactKind||'email');setContact('');setOperation('save');setConfirmedFor(null);setLoaded(true);}
 useEffect(()=>{if(data&&!loaded){setVersion(data.followup?.version||0);setKind(data.followup?.contactKind||'email');setLoaded(true);}},[data,loaded]);
 const stale=version!==(data?.followup?.version||0),allowed=ready&&!!data?.canGiveFollowup&&!stale,scope=JSON.stringify([context,version,operation,kind,contact,days,allowed]),checked=confirmedFor===scope&&allowed;
 const save=useMutation({gcTime:0,mutationFn:async(request:{context:string;operation:Operation})=>({context:request.context,value:await api<DiningAftercare>(base+'/followup'+(request.operation==='revoke'?'/revoke':''),{version,...(request.operation==='save'?{contactKind:kind,contact,purpose:'visit_followup',validDays:days,consent:true}:{}),confirmed:true,focusVersion,...(selectionVersion!==undefined?{selectionVersion}:{}),...(native?{partyVersion:p.version}:{})},'POST',csrfToken)}),onSuccess:result=>{if(live.current!==result.context)return;setVersion(result.value.followup?.version||0);setContact('');setOperation('save');setConfirmedFor(null);updated();},onError:(error,request)=>{if(live.current!==request.context)return;setConfirmedFor(null);updated(error);}});
 return <details className="aftercare-section"><summary>单独授权本次回访（可跳过）</summary><form className="dining-form" aria-label="本人独立回访授权" onSubmit={e=>{e.preventDefault();if(checked&&allowed&&!save.isPending&&(operation==='revoke'||!!contact.trim()))save.mutate({context,operation});}}>
  <p className="form-help">仅为本次回访保存授权。当前不会向外联系，不订阅营销；到期或撤回后清除联系方式。</p>
  <fieldset disabled={!ready||save.isPending}>
   <label>回访联系方式类型<select value={kind} onChange={e=>{setKind(e.target.value as typeof kind);setContact('');setOperation('save');setConfirmedFor(null);}}><option value="email">邮箱</option><option value="phone">电话</option></select></label>
   <label>自愿提供的回访联系方式<input required={operation==='save'} type={kind==='email'?'email':'tel'} autoComplete="off" value={contact} maxLength={160} onChange={e=>{setContact(e.target.value);setOperation('save');setConfirmedFor(null);}}/></label>
   <label>本次授权有效期<select value={days} onChange={e=>{setDays(Number(e.target.value));setOperation('save');setConfirmedFor(null);}}><option value={1}>1天</option><option value={7}>7天</option><option value={14}>14天</option><option value={30}>30天</option></select></label>
   {stale&&<p className="dining-warning">授权已更新，请载入当前版本后重新核对。</p>}
   <div className="dining-actions"><button type="button" onClick={load}>载入当前回访状态</button>{data?.followup?.status==='active'&&<button type="button" onClick={()=>{setVersion(data.followup!.version);setContact('');setOperation('revoke');setConfirmedFor(null);}}>选择撤回本次回访</button>}</div>
   {operation==='revoke'&&<p className="dining-warning">将撤回本次回访并清除联系方式，不影响独立评价。</p>}
   <label className="dining-check"><input type="checkbox" checked={checked} disabled={!allowed} onChange={e=>setConfirmedFor(e.target.checked?scope:null)}/>{operation==='revoke'?'我确认撤回本次回访并清除联系方式':'我单独同意仅为本次回访使用以上联系方式，到期清除'}</label>
   <button disabled={!checked||!allowed||save.isPending||operation==='save'&&!contact.trim()}>{save.isPending?'正在保存回访操作…':operation==='revoke'?'撤回回访并清除联系方式':'确认本次回访授权'}</button>
  </fieldset><Note error={save.error}/>
 </form></details>;
}

export function DiningAftercareBoard({restaurantId}:{restaurantId:string}){
 const query=useDiningResource<Array<DiningAftercare&{partyName:string}>>({key:['restaurant-aftercare-board',restaurantId],url:'/restaurants/'+restaurantId+'/aftercare',enabled:!!restaurantId});
 return <Box title="自愿评价与回访授权"><div className="service-grid">{query.data?.map(p=><article className="service-card" key={p.partyId} data-aftercare-party={p.partyId}><strong>{p.partyName}</strong>{p.feedback?.status==='active'?<p>评价：{p.feedback.rating?p.feedback.rating+' / 5 · ':''}{p.feedback.comment}</p>:<p className="form-help">未保留可用评价</p>}{p.followup?.status==='active'?<p>仅本次回访 · {p.followup.contactMask}<br/><small>有效至 {diningTime(p.followup.expiresAt)}；尚未向外联系</small></p>:<p className="form-help">没有有效回访授权，不向外联系</p>}</article>)}</div>{query.data&&!query.data.length&&<p className="empty-text">就餐结束后，顾客可自行选择是否留下评价或回访授权。</p>}{!query.data&&!query.error&&<p role="status">正在读取当前门店餐后记录…</p>}<Note error={query.error}/><button onClick={()=>query.reload()}>核对当前门店餐后记录</button></Box>;
}
