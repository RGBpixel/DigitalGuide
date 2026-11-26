import {useState} from 'react';
import {useMutation} from '@tanstack/react-query';
import type {DiningParty,DiningServiceRequest} from '@digitalguide/contracts';
import {api} from '../api.js';
import {Box,Note,diningTime} from './DiningShared.js';
import {useDiningResource} from './useDiningResource.js';

export const serviceNames:Record<DiningServiceRequest['kind'],string>={water:'加水',napkins:'餐巾纸',staff_help:'店员帮助',dish_progress:'核对菜品进度',billing_help:'结账协助'};
const states={requested:'等待店员接收',acknowledged:'店员已接收',resolved:'已处理',cancelled:'已取消或随就餐结束关闭'};
type Action='acknowledge'|'resolve'|'cancel';
const actionNames:Record<Action,string>={acknowledge:'店员接收请求',resolve:'确认已处理',cancel:'取消本次请求'};
type Scope={guestBase?:string;csrfToken?:string;focusVersion?:number;selectionVersion?:number;automatic?:boolean;native?:boolean};
type Props=Scope&{party:DiningParty;refresh():void};

export function DiningServicePanel(props:Props){
 const {party:p,guestBase,focusVersion=0,selectionVersion,native=false,refresh}=props,base=guestBase?guestBase+'/dining':'/restaurant';
 const query=useDiningResource<DiningServiceRequest[]>({key:['dining-services',base,p.id,p.version,p.accessVersion,focusVersion,selectionVersion],url:base+'/parties/'+p.id+'/services'});
 const reload=(error?:unknown)=>{query.reload(error);refresh();},ended=['completed','cancelled','no_show'].includes(p.status);
 return <Box title="本次服务"><div className="hospitality-panel" aria-label="本次服务">
  {!ended&&!query.error&&<ServiceDraft {...props} base={base} readReady={!!query.data} reload={reload}/>}
  {query.data&&<>{query.data.map(r=><ServiceCard key={r.id} request={r} base={base} csrfToken={props.csrfToken} focusVersion={guestBase?focusVersion:undefined} selectionVersion={guestBase?selectionVersion:undefined} automatic={props.automatic} native={native} refresh={reload}/>)}{!query.data.length&&<p className="form-help">当前没有服务请求。处理状态会保存，刷新后可继续查看。</p>}</>}
  {!query.data&&!query.error&&<p role="status">正在读取本次服务…</p>}
  <Note error={query.error}/>{query.error&&<button onClick={()=>query.reload()}>重新读取本次服务</button>}
  <p className="form-help">请求不会自动改变订单或付款。当前通过本地工作台交接，不发送真实外部通知。</p>
 </div></Box>;
}

function ServiceDraft({party:p,guestBase,base,csrfToken,focusVersion=0,selectionVersion,automatic=true,native=false,readReady,reload}:Props&{base:string;readReady:boolean;reload(error?:unknown):void}){
 const [kind,setKind]=useState<DiningServiceRequest['kind']>('water'),[note,setNote]=useState(''),[confirmedFor,setConfirmedFor]=useState<string|null>(null);
 const scope=JSON.stringify([base,p.id,p.version,p.accessVersion,focusVersion,selectionVersion,automatic,kind,note]),ready=readReady&&automatic&&(!native||!guestBase||selectionVersion!==undefined),checked=confirmedFor===scope&&ready;
 const create=useMutation({mutationFn:()=>api<DiningServiceRequest>(base+'/parties/'+p.id+'/services',{kind,note,confirmed:true,...(native?{partyVersion:p.version}:{}),...(guestBase?{focusVersion,...(selectionVersion!==undefined?{selectionVersion}:{})}:{})},'POST',csrfToken),onSuccess:()=>{setConfirmedFor(null);setNote('');reload();},onError:error=>{setConfirmedFor(null);reload(error);}});
 return <form className="dining-form" aria-label="本次服务请求" onSubmit={e=>{e.preventDefault();if(checked&&ready&&!create.isPending)create.mutate();}}><fieldset disabled={!ready||create.isPending}>
  <label>需要的帮助<select value={kind} onChange={e=>{setKind(e.target.value as typeof kind);setConfirmedFor(null);}}>{Object.entries(serviceNames).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
  <label>本次服务说明<textarea value={note} maxLength={200} onChange={e=>{setNote(e.target.value);setConfirmedFor(null);}}/></label>
  {confirmedFor&&!checked&&<p className="dining-warning">本组安排已变化，请重新核对本次请求。</p>}
  <label className="dining-check"><input type="checkbox" checked={checked} onChange={e=>setConfirmedFor(e.target.checked?scope:null)}/>确认将本次请求交给店员</label>
  <button disabled={!checked||!ready||create.isPending}>{create.isPending?'正在保存请求…':'提交本次服务请求'}</button>
 </fieldset><Note error={create.error}/>{!automatic&&<p className="form-help">当前已转人工，请联系店员；恢复自动后需重新核对本次请求。</p>}</form>;
}

type CardProps=Scope&{request:DiningServiceRequest;base?:string;refresh(error?:unknown):void};
export function ServiceCard({request:r,base='/restaurant',csrfToken,focusVersion,selectionVersion,automatic=true,native=r.partyVersion!==undefined,refresh}:CardProps){
 const [selected,setSelected]=useState<Action|''>(''),[confirmedFor,setConfirmedFor]=useState<string|null>(null);
 const allowed:Record<Action,boolean>={acknowledge:r.canAcknowledge,resolve:r.canResolve,cancel:r.canCancel},active=selected&&allowed[selected]?selected:'',scope=JSON.stringify([base,r.id,r.version,r.status,r.partyVersion,r.partyAccessVersion,focusVersion,selectionVersion,automatic,active]),checked=confirmedFor===scope,ready=automatic&&!!active&&(!native||focusVersion===undefined||selectionVersion!==undefined);
 const action=useMutation({mutationFn:(kind:Action)=>api<DiningServiceRequest>(base+'/services/'+r.id+'/actions',{version:r.version,action:kind,confirmed:true,...(native?{partyVersion:r.partyVersion}:{}),...(focusVersion!==undefined?{focusVersion,...(selectionVersion!==undefined?{selectionVersion}:{})}:{})},'POST',csrfToken),onSuccess:()=>{setConfirmedFor(null);setSelected('');refresh();},onError:error=>{setConfirmedFor(null);refresh(error);}});
 return <article className={'service-card '+r.status} data-service-id={r.id} data-service-version={r.version} data-party-version={r.partyVersion} aria-label={r.partyName+' · '+serviceNames[r.kind]}>
  <div><strong>{serviceNames[r.kind]}</strong><span>{states[r.status]}</span></div><p>{r.partyName} · {r.tableName||'迎宾处，尚未入座'}</p>{r.note&&<p>{r.note}</p>}<small className="muted">{diningTime(r.createdAt)}</small>
  {Object.values(allowed).some(Boolean)&&<form className="dining-form" aria-label="处理本次服务" onSubmit={e=>{e.preventDefault();if(checked&&ready&&active&&!action.isPending)action.mutate(active);}}><fieldset disabled={!automatic||action.isPending}>
   <label>本次服务处理方式<select value={active} onChange={e=>{setSelected(e.target.value as Action|'');setConfirmedFor(null);}}><option value="">请选择处理方式</option>{(Object.keys(actionNames) as Action[]).filter(kind=>allowed[kind]).map(kind=><option key={kind} value={kind}>{actionNames[kind]}</option>)}</select></label>
   {confirmedFor&&!checked&&<p className="dining-warning">请求或本组安排已变化，请重新核对处理方式。</p>}
   <label className="dining-check"><input type="checkbox" checked={checked} disabled={!ready} onChange={e=>setConfirmedFor(e.target.checked?scope:null)}/>已核对本组和本次服务处理</label>
   <button disabled={!checked||!ready||action.isPending}>{action.isPending?'正在保存处理…':active?actionNames[active]:'先选择处理方式'}</button>
  </fieldset></form>}
  <Note error={action.error}/>
 </article>;
}

export function DiningServiceBoard({restaurantId}:{restaurantId:string}){
 const [all,setAll]=useState(false),query=useDiningResource<DiningServiceRequest[]>({key:['restaurant-service-board',restaurantId],url:'/restaurants/'+restaurantId+'/services',enabled:!!restaurantId}),list=query.data?.filter(r=>all||['requested','acknowledged'].includes(r.status))||[];
 return <Box title="店员服务队列"><label className="dining-check"><input type="checkbox" checked={all} onChange={e=>setAll(e.target.checked)}/>显示已处理和已关闭请求</label><div className="service-grid">{list.map(r=><ServiceCard key={r.id} request={r} refresh={query.reload}/>)}</div>{query.data&&!list.length&&<p className="empty-text">{all?'当前没有服务请求记录。':'当前没有待处理服务请求。'}</p>}{!query.data&&!query.error&&<p role="status">正在读取当前门店服务…</p>}<Note error={query.error}/>{query.error&&<button onClick={()=>query.reload()}>重新读取已授权服务队列</button>}</Box>;
}
