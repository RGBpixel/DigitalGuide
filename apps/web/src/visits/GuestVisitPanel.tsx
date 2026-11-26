import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ClipboardCheck, MapPin, Send } from 'lucide-react';
import type { GuestVisitView, ReceptionSession } from '@digitalguide/contracts';
import { api } from '../api.js';
import { deliveryLabel, visitLabels, visitTone } from './labels.js';
import './visits.css';

export function GuestVisitPanel({ session, csrfToken }: { session: ReceptionSession; csrfToken: string }) {
  const client = useQueryClient(), key = ['guest-visit', session.id,session.focusVersion], mutationKey=['guest-visit-actions',session.id],base = '/guest/sessions/' + session.id + '/visit';
  const [form, setForm] = useState({ guestName: '', company: '', hostName: '', purpose: '', appointmentRef: '' });
  const [editing, setEditing] = useState<boolean | null>(null), [notice, setNotice] = useState(false);
  const [channel,setChannel]=useState<'local'|'mock'>('local'),[eraseConfirmed,setEraseConfirmed]=useState(false);
  const open = ['active', 'human'].includes(session.status);
  const query = useQuery({ queryKey: key, queryFn: () => api<GuestVisitView>(base), enabled: open, refetchInterval: q=>open&&!q.state.error?1500:false, retry: false });
  const visit = query.error?null:query.data?.visit,native=!!query.data?.notificationChannels;
  useEffect(() => { if (visit) {setForm({ guestName: visit.guestName, company: visit.company, hostName: visit.hostName, purpose: visit.purpose, appointmentRef: visit.appointmentRef });setChannel(visit.notificationChannel??'mock');} }, [visit?.id]); // Preserve unsaved typing while polling.
  useEffect(() => { setNotice(false); }, [visit?.version]);
  useEffect(()=>{void client.invalidateQueries({queryKey:['guest-visit',session.id,session.focusVersion]});},[session.version]);
  function update(data: GuestVisitView) { client.setQueryData(key, data);void client.invalidateQueries({queryKey:['guest-session',session.id]}); }
  const channelFields=(value=visit?.notificationChannel??channel)=>native?{channel:value}:{};
  const save = useMutation({mutationKey, mutationFn: () => api<GuestVisitView>(base, { ...form,...channelFields(channel), version: visit?.version ?? null, focusVersion: session.focusVersion }, 'POST', csrfToken), onSuccess: data => { update(data);setChannel(data.visit?.notificationChannel??'mock');setEditing(false); } });
  const confirm = useMutation({mutationKey, mutationFn: async () => {
    if (!query.data?.confirmation || !visit || !notice) throw new Error('请先核对并确认当前登记内容。');
    const confirmed = await api<GuestVisitView>(base + '/confirm', { version: visit.version, focusVersion: session.focusVersion, confirmationToken: query.data.confirmation.token, expiresAt: query.data.confirmation.expiresAt, noticeVersion: 'visit-v1', confirmed: true,...channelFields() }, 'POST', csrfToken);
    update(confirmed);
    return api<GuestVisitView>(base + '/notify', { version: confirmed.visit!.version, focusVersion: session.focusVersion,...channelFields(confirmed.visit!.notificationChannel??'mock') }, 'POST', csrfToken);
  }, onSuccess: update, onError: () => { void query.refetch(); } });
  const notify = useMutation({mutationKey, mutationFn: () => api<GuestVisitView>(base + '/notify', { version: visit?.version, focusVersion: session.focusVersion,...channelFields() }, 'POST', csrfToken), onSuccess: update });
  const control = useMutation({mutationKey, mutationFn: (action: 'complete' | 'cancel') => api<GuestVisitView>(base + '/control', { version: visit?.version, focusVersion: session.focusVersion, action }, 'POST', csrfToken), onSuccess: update });
  const erase=useMutation({mutationKey,mutationFn:()=>{if(!eraseConfirmed)throw new Error('请先确认删除本次登记资料。');return api<GuestVisitView>(base+'/erase',{version:visit!.version,focusVersion:session.focusVersion,confirmed:true},'POST',csrfToken);},onSuccess:data=>{for(const q of client.getQueryCache().findAll({queryKey:['guest-visit',session.id]}))if(JSON.stringify(q.queryKey)!==JSON.stringify(key))client.removeQueries({queryKey:q.queryKey,exact:true});for(const m of client.getMutationCache().findAll({mutationKey}))if(m.state.status!=='pending')client.getMutationCache().remove(m);save.reset();confirm.reset();notify.reset();control.reset();setForm({guestName:'',company:'',hostName:'',purpose:'',appointmentRef:''});setEraseConfirmed(false);setEditing(false);update(data);}});
  const download=useMutation({mutationKey,mutationFn:async()=>{const value=await api<unknown>(base+'/export'),blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');try{link.href=url;link.download='DigitalGuide-本人来访登记-'+session.id+'.json';link.click();}finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}}});
  // Whole-profile erasure can arrive through the adjacent memory panel.
  useEffect(()=>{if(visit?.dataErased){setForm({guestName:'',company:'',hostName:'',purpose:'',appointmentRef:''});setNotice(false);setEditing(false);save.reset();confirm.reset();notify.reset();control.reset();for(const m of client.getMutationCache().findAll({mutationKey}))if(m.state.status!=='pending')client.getMutationCache().remove(m);}},[visit?.dataErased]);
  const errors = [query.error, save.error, confirm.error, notify.error, control.error,erase.error,download.error].filter(Boolean);
  const canEdit = session.status==='active'&&(!visit || !visit.dataErased&&['draft', 'awaiting_confirmation'].includes(visit.status)), showForm = (editing ?? !visit) && canEdit;
  const pending = save.isPending || confirm.isPending || notify.isPending || control.isPending||erase.isPending||download.isPending;
  const sameFocus = !visit || visit.focusVersion === session.focusVersion;
  return <section className="panel guest-visit-panel" aria-label="来访登记"><div className="section-heading"><div><h2><ClipboardCheck size={18}/>来访登记</h2><span>自愿提供资料，仅用于本次接待，不核验或升级登录身份</span></div><span className={'badge ' + (visit ? visitTone(visit.status) : '')}>{visit ? visitLabels[visit.status] : '本人自述'}</span></div>
    {!open ? <p className="visit-help">本次会话已结束。已确认的来访记录仍由前台保存处理。</p> : query.isPending ? <p className="visit-help" role="status">正在载入本次登记…</p> : query.error?<div className="visit-help"><p>暂时无法读取本次登记，恢复访问前不显示旧资料。</p><button className="button secondary" onClick={()=>void query.refetch()}>重新读取登记</button></div>:showForm ? <form className="visit-form" onSubmit={event => { event.preventDefault(); save.mutate(); }}><div className="visit-form-grid">
      <label>姓名或昵称<input required maxLength={40} value={form.guestName} onChange={event => setForm({ ...form, guestName: event.target.value })}/></label>
      <label>单位（可选）<input maxLength={80} value={form.company} onChange={event => setForm({ ...form, company: event.target.value })}/></label>
      <label>受访人姓名<input required maxLength={40} value={form.hostName} onChange={event => setForm({ ...form, hostName: event.target.value })} placeholder="填写您要拜访的人，不提供员工名录"/></label>
      <label>预约引用（可选）<input maxLength={80} value={form.appointmentRef} onChange={event => setForm({ ...form, appointmentRef: event.target.value })}/></label>
      <label className="wide">来访事由<textarea required maxLength={200} value={form.purpose} onChange={event => setForm({ ...form, purpose: event.target.value })}/></label>
      {native&&<label>接待渠道<select aria-label="接待渠道" value={channel} onChange={event=>setChannel(event.target.value as 'local'|'mock')}>{query.data!.notificationChannels!.map(value=><option key={value} value={value}>{value==='local'?'本地接待请求':'明确模拟通知'}</option>)}</select></label>}
    </div><div className="visit-form-footer"><p>{native?'受访人称呼由前台配置；本地请求和模拟通知均不会发到外部通讯工具。':'演示可填写受访人“林知”或“陈墨”；均为虚构账号。当前不发送真实消息。'}</p><button className="button primary" disabled={pending}><CheckCircle2 size={15}/>保存并核对登记</button></div></form> : visit && <div className="visit-review">
      {!visit.dataErased&&sameFocus&&<dl className="visit-facts"><div><dt>姓名 / 昵称</dt><dd>{visit.guestName}</dd></div><div><dt>单位</dt><dd>{visit.company || '未填写'}</dd></div><div><dt>受访人</dt><dd>{visit.hostName}</dd></div><div><dt>来访事由</dt><dd>{visit.purpose}</dd></div>{native&&<div><dt>接待渠道</dt><dd>{visit.notificationChannel==='local'?'本地接待请求':'明确模拟通知'}</dd></div>}</dl>}<p className="visit-public-message" role="status">{visit.publicMessage}</p>
      {visit.delivery && <p className="visit-delivery">{visit.delivery.channel==='local'?'本地请求状态':'通知状态'}：<strong>{deliveryLabel(visit.delivery)}</strong>{visit.delivery.availability==='withdrawn'&&<strong> · 后续自动处理已停止</strong>}<span>送达、已读与员工同意分别记录。</span></p>}
      {visit.guidance && <div className="visit-guidance"><MapPin size={19}/><div><strong>接待指引</strong><p>{visit.guidance}</p></div></div>}
      {visit.status === 'awaiting_confirmation' && sameFocus&&!visit.dataErased&&<><label className="checkbox-line visit-notice"><input type="checkbox" checked={notice} onChange={event => setNotice(event.target.checked)}/>资料仅用于本次来访接待，我已核对内容、接待人和渠道，同意建立本次接待请求。</label><div className="visit-actions"><button className="button secondary" disabled={pending||session.status!=='active'} onClick={() => setEditing(true)}>修改登记资料</button><button className="button primary" disabled={!notice || pending || session.status !== 'active' || !query.data?.confirmation} onClick={() => confirm.mutate()}><Send size={14}/>{visit.notificationChannel==='local'?'确认登记并建立本地请求':'确认登记并发送模拟通知'}</button></div></>}
      {visit.status === 'notifying' && !visit.delivery && !visit.dataErased&&<button className="button primary" disabled={pending || session.status !== 'active'} onClick={() => notify.mutate()}>{visit.notificationChannel==='local'?'提交本次本地请求':'提交本次模拟通知'}</button>}
      {visit.status === 'accepted' && sameFocus && <button className="button primary" disabled={pending} onClick={() => control.mutate('complete')}>已到达，结束本次来访</button>}
      {!['completed', 'cancelled'].includes(visit.status) && sameFocus&&!visit.dataErased&&session.status==='active'&&<button className="text-button danger visit-cancel" disabled={pending} onClick={() => control.mutate('cancel')}>取消本次来访</button>}
      {!sameFocus && !['completed', 'cancelled'].includes(visit.status) && <p className="form-help">本次已转入人工流程，旧的确认操作不可继续使用，请由前台处理后续事项。</p>}
      <p className="form-help">取消来访不会撤回已提交的渠道消息；前台可查看处理记录。模拟通知不会发送到真实通讯工具。</p>
      {native&&sameFocus&&<div className="visit-self-data"><button className="button secondary" disabled={pending} onClick={()=>download.mutate()}>下载本人登记</button>{!visit.dataErased&&session.status==='active'&&<><p>删除仅清理本次登记字段；聊天和本人偏好可在“本人资料与记忆”中一并删除。前台保留必要的处理回执。</p><label><input type="checkbox" checked={eraseConfirmed} onChange={e=>setEraseConfirmed(e.target.checked)}/>我确认删除本次登记资料</label><button className="button secondary" disabled={pending||!eraseConfirmed} onClick={()=>erase.mutate()}>删除本人登记资料</button></>}{query.data?.privacyReceipt&&<p role="status">登记资料已清理。处理回执：{query.data.privacyReceipt.requestId}</p>}</div>}
    </div>}
    {errors.map((error, index) => <div className="error" role="alert" key={index}>{error instanceof Error ? error.message : '登记处理失败，请重试或联系前台。'}</div>)}
  </section>;
}
