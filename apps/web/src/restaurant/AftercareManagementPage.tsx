import {useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {aftercareManagementInput,aftercareManagementResult} from '@digitalguide/contracts';
import {api} from '../api.js';
import {Note} from './DiningShared.js';
import './billing.css';
import './restaurant.css';
import './aftercare.css';

export function AftercareManagementPage(){
 const [code,setCode]=useState(''),[confirmedFor,setConfirmedFor]=useState<string|null>(null),[pending,setPending]=useState(false),[error,setError]=useState<unknown>(null),[message,setMessage]=useState(''),controller=useRef<AbortController|null>(null);
 useEffect(()=>()=>controller.current?.abort(),[]);
 const value=code.trim(),valid=aftercareManagementInput.safeParse({code:value,confirmed:true}).success,checked=confirmedFor===value&&!!value;
 async function submit(){
  if(!valid||!checked||pending)return;
  const request=new AbortController();controller.current=request;setPending(true);setError(null);setMessage('');
  try{const result=aftercareManagementResult.parse(await api('/restaurant/aftercare/manage',{code:value,confirmed:true},'POST','',request.signal));if(controller.current!==request||request.signal.aborted)return;setMessage((result.kind==='feedback'?'本次评价':'本次回访授权')+(result.status==='expired'?'已到期，内容已清除。':'已撤回，内容已清除。'));setCode('');setConfirmedFor(null);}
  catch(failure){if(!request.signal.aborted){setError(failure);setConfirmedFor(null);}}
  finally{if(!request.signal.aborted){setPending(false);controller.current=null;}}
 }
 return <main className="aftercare-management"><section className="panel"><span className="eyebrow">DIGITALGUIDE · 本人离店管理</span><h1>撤回本次餐后记录</h1><p>粘贴本人保存的评价或回访撤回凭证，核对后清除对应一项内容。无需原接待终端保持在线。</p><p className="form-help">评价和回访分别管理。此入口不会展示联系方式或评价正文，不会登录、下单、付款或向外联系。</p>
  <form className="dining-form" aria-label="本人离店撤回管理" autoComplete="off" onSubmit={e=>{e.preventDefault();void submit();}}><fieldset disabled={pending}>
   <label>本人保存的撤回凭证<textarea value={code} rows={4} maxLength={240} autoComplete="off" autoCapitalize="off" spellCheck={false} onChange={e=>{setCode(e.target.value);setConfirmedFor(null);setMessage('');setError(null);}}/></label>
   {!!value&&!valid&&<p className="form-help">请粘贴完整的当前凭证，包含开头的DA1；不要粘贴就餐恢复码。</p>}
   <label className="dining-check"><input type="checkbox" checked={checked} disabled={!valid} onChange={e=>setConfirmedFor(e.target.checked?value:null)}/>我持有本人的当前凭证，确认撤回并清除对应这一项内容</label>
   <button className="button primary" disabled={!valid||!checked||pending}>{pending?'正在核对并清除…':'确认撤回并清除本项内容'}</button>
  </fieldset></form><Note error={error}/>{message&&<p className="aftercare-success" role="status">{message}</p>}<p className="form-help">凭证不会保存到此页面的本地存储。若凭证已更新或无法核对，请联系门店；操作失败不会显示为清除成功。</p><Link to="/">返回工作空间入口</Link>
 </section></main>;
}
