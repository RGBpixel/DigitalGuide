import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Monitor, MonitorOff, Send, ShieldCheck } from 'lucide-react';
import type { ReceptionSession, GuestSessionView, VisualState, VisualGrant } from '@digitalguide/contracts';
import { api,ApiError } from '../api.js';
import type { useDevices } from './useDevices.js';
export function GuestVisionPanel({ session, csrfToken, devices,onBusyChange }: { session: ReceptionSession; csrfToken: string; devices: ReturnType<typeof useDevices>;onBusyChange?:(busy:boolean)=>void }) {
  const active = session.status === 'active', client = useQueryClient(), base = '/guest/sessions/' + session.id + '/vision', key = ['guest-visual', session.id, session.focusVersion];
  const state = useQuery({ queryKey: key, queryFn: ({signal}) => api<VisualState>(base,undefined,'GET',undefined,signal), enabled: active, refetchInterval: active ? 1000 : false });
  const [source, setSource] = useState<'camera' | 'screen'>('camera'), [consent, setConsent] = useState(false), [question, setQuestion] = useState(''), current = useRef({id:session.id,focus:session.focusVersion,active,mounted:true,grantId:null as string|null,ready:false});
  const requestAbort=useRef<AbortController|null>(null);
  Object.assign(current.current,{id:session.id,focus:session.focusVersion,active});
  useEffect(()=>{current.current.mounted=true;return()=>{current.current.mounted=false;requestAbort.current?.abort();};},[]);
  const grant = active ? state.data?.grant : null;
  Object.assign(current.current,{grantId:grant?.id??null,ready:!!grant&&devices.states[grant.source]==='on'});
  const live=()=>current.current.mounted&&current.current.active&&current.current.id===session.id&&current.current.focus===session.focusVersion;
  const issuing = useMutation({ mutationFn: () => api<VisualGrant>(base + '/grants', { source, consent, noticeVersion: 'vision-v1', version: session.version, focusVersion: session.focusVersion }, 'POST', csrfToken), onSuccess: async () => {if(!live())return;setConsent(false); await Promise.all([state.refetch(), client.invalidateQueries({ queryKey: ['guest-session', session.id] })]); } });
  const revoking = useMutation({ mutationFn: (g: VisualGrant) => api(base + '/revoke', { grantId: g.id, grantVersion: g.version, focusVersion: session.focusVersion }, 'POST', csrfToken), onSuccess: async () => { if(!live())return;await Promise.all([state.refetch(), client.invalidateQueries({ queryKey: ['guest-session', session.id] })]); } });
  const revocation = useRef(revoking.mutate); revocation.current = revoking.mutate;
  const sending = useMutation({mutationKey:['guest-visual-question',session.id,session.focusVersion],gcTime:0, mutationFn: async () => {
    if (!grant || devices.states[grant.source] !== 'on') throw new Error('请先预览并明确允许本次画面。');
    const focus=session.focusVersion,id=session.id,grantId=grant.id,frame=devices.capture(grant.source),controller=new AbortController();
    if(!live())throw new Error('服务对象已变化，请重新选择画面。');requestAbort.current=controller;
    try{return{view:await api<GuestSessionView>(base+'/questions',{...frame,question,version:session.version,focusVersion:focus,grantId,grantVersion:grant.version},'POST',csrfToken,controller.signal),id,focus,grantId};}finally{if(requestAbort.current===controller)requestAbort.current=null;}
  },onSuccess:({view,id,focus,grantId})=>{const now=current.current,cached=client.getQueryData<GuestSessionView>(['guest-session',id]);if(now.mounted&&now.active&&now.id===id&&view.session.id===id&&now.focus===focus&&view.session.focusVersion===focus&&now.grantId===grantId&&now.ready&&(!cached||cached.session.version<=view.session.version)){setQuestion('');client.setQueryData(['guest-session',id],view);}}});
  useEffect(()=>{onBusyChange?.(issuing.isPending||revoking.isPending);return()=>onBusyChange?.(false);},[issuing.isPending,revoking.isPending,onBusyChange]);
  const grantSourceState = grant ? devices.states[grant.source] : undefined;
  useEffect(() => { if (active && grant && grantSourceState !== 'on' && grantSourceState !== 'requesting') revocation.current(grant); }, [active, grant?.id, grant?.version, grantSourceState]);
  useEffect(() => { if (!active) { setConsent(false); setQuestion(''); } }, [active]);
  const allowed = !!state.data?.policy[source] && !!state.data.policy.configured;
  const errors = [state.error, issuing.error, revoking.error, sending.error].filter(e=>!!e&&!(e instanceof DOMException&&e.name==='AbortError'));
  function closeSharedSource() { if (grant) { if (devices.states[grant.source] === 'on' || devices.states[grant.source] === 'requesting') devices.close(grant.source); else revoking.mutate(grant); } }
  return <section className="guest-vision" aria-label="本次画面问答"><div className="section-heading"><div><h3>本次画面问答</h3><span>先在本机预览，再明确允许发送；每次只截取当前一帧。</span></div><ShieldCheck size={18}/></div>
    <div className="device-buttons"><button className="button secondary" disabled={!active} onClick={() => devices.states.screen === 'on' || devices.states.screen === 'requesting' ? devices.close('screen') : void devices.open('screen')}>{devices.states.screen === 'on' ? <MonitorOff size={16}/> : <Monitor size={16}/>}{devices.states.screen === 'requesting' ? '取消屏幕共享请求' : devices.states.screen === 'on' ? '关闭屏幕预览' : '共享屏幕预览'}</button><span className="badge amber">{state.data?.policy.provider === 'mock-vision' ? '模拟画面检查 · 无视觉识别' : state.data?.policy.configured ? '已配置视觉服务' : '画面问答未启用或未接通'}</span></div>
    <video ref={devices.screenVideo} autoPlay playsInline muted className={'camera-preview ' + (devices.states.screen !== 'on' ? 'hidden' : '')} aria-label="本机共享屏幕预览"/>
    {!grant ? <form onSubmit={e => { e.preventDefault(); if (allowed && consent) issuing.mutate(); }}><label>选择本次发送来源<select aria-label="选择本次发送来源" value={source} onChange={e => { setSource(e.target.value as typeof source); setConsent(false); }}><option value="camera">相机预览</option><option value="screen">选定屏幕或窗口</option></select></label><label className="checkbox-line"><input type="checkbox" checked={consent} disabled={!active || !allowed || devices.states[source] !== 'on'} onChange={e => setConsent(e.target.checked)}/>我允许将选中的画面发送给当前视觉服务用于本次问答，授权最长五分钟</label><button className="button secondary" disabled={!active || !allowed || !consent || devices.states[source] !== 'on' || issuing.isPending}>允许本次画面问答</button>{!allowed && <p className="form-help">请由工作人员在场景应用中启用此来源并选择可用视觉服务；本机预览不会因此上传。</p>}</form> : <><div className="info-note" role="status">已允许{grant.source === 'camera' ? '相机' : '选定屏幕'}单帧提问 · 有效至 {new Date(grant.expiresAt).toLocaleTimeString('zh-CN')}。关闭来源、换人、转人工或结束后授权失效。</div><form onSubmit={e => { e.preventDefault(); if (question.trim()) sending.mutate(); }}><label>针对当前画面提问<textarea value={question} onChange={e => setQuestion(e.target.value)} required maxLength={500} disabled={!active || issuing.isPending || sending.isPending} placeholder="例如：请介绍我选中的画面。"/></label><div className="device-buttons"><button className="button primary" disabled={!active || devices.states[grant.source] !== 'on' || issuing.isPending || sending.isPending || revoking.isPending || !question.trim()}><Send size={14}/>{sending.isPending ? '正在处理本次画面…' : '发送当前画面并提问'}</button><button className="button secondary" type="button" disabled={revoking.isPending} onClick={closeSharedSource}>{revoking.isError ? '重试撤回画面授权' : '关闭来源并撤回授权'}</button></div></form></>}
    <p className="form-help">原始帧仅在本次处理内存中使用，不写入素材库；服务端保留授权和请求元数据。模拟检查不会识别人脸、文字或物品，也不会建立人员档案。</p>
    {errors.map((error, i) => <div className="error" role="alert" key={i}>{error instanceof ApiError ? error.message : error instanceof TypeError ? '画面操作未能连接，画面回复已在本机隐藏；请检查网络后重试撤回，或继续文字接待。' : error instanceof Error ? error.message : '画面操作失败，请刷新或继续文字接待。'}</div>)}
  </section>;
}
