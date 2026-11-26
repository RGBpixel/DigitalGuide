import {useEffect,useRef,useState} from 'react';
import type {ProgrammeGuestContext} from '@digitalguide/contracts';
import {peerRequests} from './peer-requests.js';
import './live-peers.css';
export function ProgrammePrivacyPage({grantId}:{grantId:string}){
 const csrf=useRef(''),request=useRef(peerRequests('/api/v1/external/live-programme/'+grantId,()=>csrf.current)).current,[context,setContext]=useState<ProgrammeGuestContext|null>(null),[error,setError]=useState(''),[message,setMessage]=useState('正在核对本次独立授权。'),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false);
 useEffect(()=>{const abort=new AbortController();void request<ProgrammeGuestContext>('/context',undefined,abort.signal).then(value=>{csrf.current=value.csrfToken;setContext(value);setMessage('本页只管理本次节目和录制用途，不打开摄像头或麦克风。');}).catch(e=>{if(!abort.signal.aborted)setError(e instanceof Error?e.message:'本次授权不可用，请使用原来宾浏览器打开。');});return()=>abort.abort();},[request]);
 async function withdraw(){if(!context||!confirmed)return;setBusy(true);setError('');try{await request('/withdraw',{version:context.version,confirmed:true});setContext(null);setMessage('本次节目及录制用途已永久撤回，原录制与派生素材不再由本平台提供访问。');}catch(e){setError(e instanceof Error?e.message:'无法确认撤回结果，请重新载入核对。');}finally{setBusy(false);}}
 return <main className="live-guest-page"><h1>节目与录制授权管理</h1><p role="status">{message}</p>{error&&<p role="alert">{error}</p>}{context&&<><h2>{context.publicTitle}</h2><p>节目显示名称：{context.publicName}</p><p>本次{context.recordingAllowed?'节目和录制':'节目'}授权有效至{new Date(context.expiresAt).toLocaleString('zh-CN')}。正常通话结束后仍可在此撤回；不同邀请和组织的资料不会在此展示。</p><p>撤回会停止本次节目媒体，并限制本平台保存的相关片段、录制与派生素材。已经被他人观看或下载的内容无法远程收回。</p><label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>确认撤回本次节目及录制用途</label><button disabled={!confirmed||busy} onClick={()=>void withdraw()}>永久撤回本次节目与录制用途</button></>}</main>;
}
