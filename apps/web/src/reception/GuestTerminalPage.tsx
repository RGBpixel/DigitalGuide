import {useGuestHandoff,GuestHandoffRecovery} from './GuestHandoffFlow.js';
import { ToolConfirmation } from './ToolConfirmation.js';
import { useCallback,useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Camera, CameraOff, Hand, Layers3, MessageSquare, Mic, MicOff, Play, Send, Square, UsersRound } from 'lucide-react';
import type { GuestSessionView, ReceptionMessage } from '@digitalguide/contracts';
import { api,ApiError } from '../api.js';
import { GuestVisionPanel } from './GuestVisionPanel.js';
import { GuestSpeakerPanel } from './GuestSpeakerPanel.js';
import { GuestProactivePanel } from './GuestProactivePanel.js';
import { useDevices } from './useDevices.js';
import { GuestDiningPanel } from '../restaurant/GuestDiningPanel.js';
import { GuestVisitPanel } from '../visits/GuestVisitPanel.js';
import { GuestMemoryPanel } from '../people/PeoplePage.js';
import { Citations } from '../knowledge/KnowledgePage.js';
import './reception.css';

export function GuestTerminalPage({ sessionId }: { sessionId: string }) {
  const key = ['guest-session', sessionId], client = useQueryClient(),handoff=useGuestHandoff(sessionId);
  const [text, setText] = useState(''), [localPlaying, setLocalPlaying] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const query = useQuery({ queryKey: key, queryFn: async ({signal}) => {const received=await api<GuestSessionView>('/guest/sessions/'+sessionId,undefined,'GET',undefined,signal),cached=client.getQueryData<GuestSessionView>(key);return cached?.session.id===received.session.id&&cached.session.version>received.session.version?cached:received;},enabled:!handoff.blocked,retry: false,
    refetchInterval: query => !query.state.error && query.state.data && ['active', 'human'].includes(query.state.data.session.status) ? 1000 : false });
  const view = query.error ? undefined : query.data, session = view?.session;
  const [speakerOperation,setSpeakerOperation]=useState<{id:string;focus:number;busy:boolean}|null>(null);
  const onSpeakerBusy=useCallback((busy:boolean)=>{const id=sessionId,focus=session?.focusVersion??0;setSpeakerOperation(previous=>previous?.id===id&&previous.focus===focus&&previous.busy===busy?previous:{id,focus,busy});},[sessionId,session?.focusVersion]);
  const speakerBusy=speakerOperation?.id===sessionId&&speakerOperation.focus===session?.focusVersion&&speakerOperation.busy;
  const [visualOperation,setVisualOperation]=useState<{id:string;focus:number;busy:boolean}|null>(null);
  const onVisualBusy=useCallback((busy:boolean)=>{const id=sessionId,focus=session?.focusVersion??0;setVisualOperation(previous=>previous?.id===id&&previous.focus===focus&&previous.busy===busy?previous:{id,focus,busy});},[sessionId,session?.focusVersion]);
  const visualBusy=visualOperation?.id===sessionId&&visualOperation.focus===session?.focusVersion&&visualOperation.busy;
  const restaurant=session?.scene==='restaurant';
  const back=restaurant?'/restaurant':session?'/reception?terminalId='+session.terminalId:'/reception';
  const active = session?.status === 'active', ended = session && ['ended', 'expired'].includes(session.status);
  const context = useRef({sessionId,focusVersion:session?.focusVersion,blocked:handoff.blocked,mounted:true});
  Object.assign(context.current,{sessionId,focusVersion:session?.focusVersion,blocked:handoff.blocked});
  useEffect(()=>{context.current.mounted=true;return()=>{context.current.mounted=false;};},[]);
  const devices = useDevices(!!active&&!handoff.blocked, sessionId + ':' + (session?.focusVersion ?? 0));
  const playingVisualSource=session?.messages.find(item=>item.id===localPlaying)?.visualContext?.source;
  const playingMessageStatus=session?.messages.find(item=>item.id===localPlaying)?.status;
  useEffect(()=>{if(localPlaying&&playingMessageStatus!=='playing'){setLocalPlaying(null);if(timer.current)clearTimeout(timer.current);}},[localPlaying,playingMessageStatus]);
  const playingVisualSourceState=playingVisualSource?devices.states[playingVisualSource]:undefined;
  useEffect(()=>{if(playingVisualSource&&playingVisualSourceState!=='on'){setLocalPlaying(null);if(timer.current)clearTimeout(timer.current);}},[playingVisualSource,playingVisualSourceState]);
  const base = '/guest/sessions/' + sessionId;
  const update = (data: GuestSessionView) => {
    const current=context.current,cached=client.getQueryData<GuestSessionView>(key);
    if(!current.mounted||current.blocked||current.sessionId!==data.session.id||(cached&&cached.session.version>data.session.version))return false;
    client.setQueryData(key,data);return true;
  };
  const message = useMutation({mutationKey:['guest-message',sessionId],gcTime:0, mutationFn: async () => {
    const id=sessionId,focus=session?.focusVersion,input=text;
    const fresh=await api<GuestSessionView>(base),now=context.current;
    if(!now.mounted||now.blocked||now.sessionId!==id||now.focusVersion!==focus||fresh.session.id!==id||fresh.session.focusVersion!==focus)throw new ApiError('VERSION_CONFLICT','服务对象已变化，请在当前接待页面重新核对后发送。',409);
    if(!['active','human'].includes(fresh.session.status))throw new ApiError('SESSION_ENDED','本次接待已结束，请由工作人员开启新的接待。',410);
    return api<GuestSessionView>(base+'/messages',{text:input,version:fresh.session.version,focusVersion:focus,source:'typed'},'POST',fresh.csrfToken);
  }, onSuccess: data => { if(update(data))setText(''); } });
  const control = useMutation({ mutationFn: (action: string) => api<GuestSessionView>(base + '/control', { action, version: session?.version, focusVersion: session?.focusVersion }, 'POST', view?.csrfToken), onSuccess: update });
  const completed = useMutation({ mutationFn: (reply: ReceptionMessage) => api<GuestSessionView>(base + '/events', { type: 'reply.completed', replyId: reply.id, replyEpoch: reply.replyEpoch, focusVersion: reply.focusVersion }, 'POST', view?.csrfToken), onSuccess: update });
  const play = useMutation({ mutationFn: (reply: ReceptionMessage) => api<GuestSessionView>(base + '/events', { type: 'reply.started', replyId: reply.id, replyEpoch: reply.replyEpoch, focusVersion: reply.focusVersion }, 'POST', view?.csrfToken), onSuccess: (data, reply) => {
    if(!update(data))return;setLocalPlaying(reply.id);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { setLocalPlaying(null); completed.mutate(reply); }, 3000);
  } });
  useEffect(() => {
    setLocalPlaying(null);
    if (timer.current) clearTimeout(timer.current);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [sessionId, session?.replyEpoch, session?.focusVersion, session?.status,handoff.blocked]);
  useEffect(()=>{setText('');},[sessionId,handoff.blocked]);
  function stop(action: 'stop' | 'handoff' | 'end') {
    setLocalPlaying(null); if (timer.current) clearTimeout(timer.current);
    if (action !== 'stop') { devices.close('camera'); devices.close('microphone'); devices.close('screen'); }
    control.mutate(action);
  }
  function beginHandoff(input:Parameters<typeof handoff.begin>[0]){
    context.current.blocked=true;setLocalPlaying(null);setText('');if(timer.current)clearTimeout(timer.current);
    devices.close('camera');devices.close('microphone');devices.close('screen');
    handoff.begin(input,view!.csrfToken,view!.features?.speakerHandoffIntent===true);
  }
  const errors = [query.error, message.error, control.error, play.error, completed.error].filter(Boolean);
  return <main className="guest-shell">
    <header className="guest-header"><Link className="brand" to={back}><span className="brand-symbol"><Layers3 size={22}/></span>DigitalGuide</Link><span className="badge amber">{view?.features?.speakerFocusPreview?'匿名访客终端 · 专注预览 · 合成模拟':'匿名访客终端 · 模拟'}</span><Link to={back} className="text-link"><ArrowLeft size={14}/>{restaurant?'返回餐厅服务':'返回接待台'}</Link></header>
    {handoff.blocked ? <GuestHandoffRecovery flow={handoff}/> : query.isPending ? <div className="boot" role="status">正在载入本次接待…</div> : !view ? <section className="panel guest-unavailable"><h1>本次接待暂不可用</h1>{errors.map((error, index) => <div className="error" role="alert" key={index}>{error instanceof Error ? error.message : '无法载入会话。'}</div>)}<Link className="button primary" to={back}>返回接待台重新打开</Link></section> : <>
      <div className="guest-heading"><span className="eyebrow">WELCOME TO YOUR RECEPTION</span><h1>{restaurant?(view.features?.dining===false?'欢迎光临，请输入您的问题':'欢迎光临，请确认本次就餐'):'您好，欢迎来访'}</h1><p>您可以直接输入问题，也可以随时请求人工接待。</p></div>
      <div className="guest-grid"><section className="panel guest-stage"><div className="guest-stage-top"><span><span className="status-dot"/>{ended ? '本次会话已结束' : session?.status === 'human' ? '等待工作人员接待' : '文字接待中'}</span><span>匿名 · {sessionId.slice(0, 8)}</span></div><div className={'synthetic-character ' + (localPlaying ? 'playing' : '')}><div className="character-ring"/><div className="character-body"><UsersRound size={94} strokeWidth={1}/></div><span className="character-orbit one"/><span className="character-orbit two"/></div><h2>{session?.profileName || '合成示意讲解员'}</h2>{session?.sceneAppName && <p>{session.sceneAppName}</p>}<p className="stage-caption">{localPlaying ? '正在演示回复播放状态，未合成声音' : session?.status === 'human' ? '自动回复已暂停' : ended ? '请由前台开启新的接待会话' : '我在这里，您可以输入问题'}</p><span className="badge amber">示意画面 · 未连接真人形象驱动</span><div className="guest-stage-controls"><button className="button secondary" disabled={!active || control.isPending} onClick={() => stop('stop')}><Square size={14}/>停止当前回复</button><button className="button secondary" disabled={!active || control.isPending} onClick={() => stop('handoff')}><Hand size={15}/>请求人工接待</button></div><p className="stage-footnote">当前为匿名会话；查看与操作仅限本人已确认的本次记录，不能获得员工权限。</p></section>
        <section className="panel guest-conversation"><div className="section-heading"><div><h2>本次对话</h2><span>{session?.status === 'human' ? '人工接管期间不自动生成回复' : view.audio.state === 'mock_focus' ? '文字与已确认模拟目标字幕 · 麦克风未转写' : '当前仅接收文字输入'}</span></div><MessageSquare size={19}/></div><div className="conversation-list" aria-label="本次会话消息">{session?.messages.map(item => <article key={item.id} className={'conversation-message ' + item.role + ' ' + item.status}><span>{item.role === 'visitor' ? '访客' : item.role === 'assistant' ? '模拟讲解员' : '系统'}</span>{item.status === 'cancelled' || item.visualContext&&devices.states[item.visualContext.source]!=='on' ? <p>{item.visualContext?'画面来源已关闭，相关回复不再展示。':'此条未完成回复已停止，不会继续播放。'}</p> : <><p>{item.text}</p>{item.inputSource === 'verified_mock_audio' && <small className="badge amber">已确认模拟目标字幕</small>}{item.visualContext && <small className="badge amber">{item.visualContext.simulated ? '模拟画面检查' : '画面回复'} · {item.visualContext.source === 'camera' ? '本次相机' : '本次选定屏幕'} · 不作为身份确认</small>}<Citations items={item.citations || []}/>{item.toolRequests?.map(request => <ToolConfirmation key={request.id} request={request} session={view.session} csrfToken={view.csrfToken} update={update}/>)}{item.role === 'assistant' && item.status === 'ready' && active && <button className="text-button" disabled={play.isPending || !!localPlaying} onClick={() => play.mutate(item)}><Play size={13}/>演示回复播放</button>}{item.status === 'playing' && <small>模拟播放状态中 · 可手动停止</small>}{item.status === 'completed' && <small>模拟播放状态已完成</small>}</>}</article>)}</div><form className="guest-composer" onSubmit={event => { event.preventDefault(); if (text.trim()) { setLocalPlaying(null); if (timer.current) clearTimeout(timer.current); message.mutate(); } }}><label htmlFor="guest-message">{ended ? '会话已结束' : '输入您的问题'}</label><textarea id="guest-message" value={text} maxLength={1000} disabled={!!ended || message.isPending} onChange={event => setText(event.target.value)} placeholder="例如：您好，我想咨询来访接待。"/><div><span>{text.length}/1000 · 内容仅属于当前会话</span><button className="button primary" disabled={!!ended || !text.trim() || message.isPending || control.isPending || speakerBusy || visualBusy}><Send size={14}/>发送文字</button></div></form></section>
      </div>
      {view.features?.speakerFocus===false?<section className="panel" aria-label="专注对话可用状态"><h2>专注对话</h2><p>语音专注对话暂未连接。请继续输入文字，或请求工作人员接待。</p></section>:<GuestSpeakerPanel key={'speaker:'+view.session.id+':'+view.session.focusVersion} session={view.session} csrfToken={view.csrfToken} handoffBusy={handoff.startBusy} handoffError={handoff.startError} onBusyChange={onSpeakerBusy} onHandoff={beginHandoff}/>}
      {restaurant?(view.features?.dining===false?<section className="panel"><h2>餐厅服务</h2><p>本终端的点餐与结账暂未连接，请联系服务员。</p></section>:<GuestDiningPanel key={'dining:'+view.session.id+':'+view.session.focusVersion} session={view.session} csrfToken={view.csrfToken}/>):view.features?.visitRegistration===false?<section className="panel" aria-label="来访登记可用状态"><h2>来访登记</h2><p>本终端暂不能提交来访登记或通知接待人，请联系前台工作人员。</p></section>:<GuestVisitPanel key={'visit:'+view.session.id+':'+view.session.focusVersion} session={view.session} csrfToken={view.csrfToken}/>}
      {restaurant&&view.features?.proactiveGreetings===true&&<GuestProactivePanel key={'proactive:'+view.session.id+':'+view.session.focusVersion+':'+view.session.status} session={view.session} csrfToken={view.csrfToken}/>}
      {view.features?.personalMemory===false?<section className="panel" aria-label="接待偏好可用状态"><h2>我的接待偏好</h2><p>本次匿名接待暂不保存长期偏好，您可以直接告诉工作人员本次需要。</p></section>:<GuestMemoryPanel key={view.session.id} session={view.session} csrfToken={view.csrfToken}/>}
      <section className="panel guest-devices"><div><h2>设备与文字回退</h2><p>设备需要您主动授权；拒绝或不可用时仍可文字接待。</p></div><div className="device-buttons"><button className="button secondary" disabled={!active} onClick={() => devices.states.camera === 'on' || devices.states.camera === 'requesting' ? devices.close('camera') : void devices.open('camera')}>{devices.states.camera === 'on' ? <CameraOff size={16}/> : <Camera size={16}/>}{devices.states.camera === 'requesting' ? '取消摄像头请求' : devices.states.camera === 'on' ? '关闭摄像头' : '开启摄像头预览'}</button><button className="button secondary" disabled={!active} onClick={() => devices.states.microphone === 'on' || devices.states.microphone === 'requesting' ? devices.close('microphone') : void devices.open('microphone')}>{devices.states.microphone === 'on' ? <MicOff size={16}/> : <Mic size={16}/>}{devices.states.microphone === 'requesting' ? '取消麦克风请求' : devices.states.microphone === 'on' ? '关闭麦克风' : '检查麦克风权限'}</button><span className="badge">语音归属服务未连接</span></div><video ref={devices.video} autoPlay playsInline muted className={'camera-preview ' + (devices.states.camera !== 'on' ? 'hidden' : '')} aria-label="本机摄像头预览"/>{devices.error && <div className="error" role="alert">{devices.error}</div>}<p className="form-help">开启设备只提供本机预览或检查；下方画面问答需另行授权并发送单帧，不持续上传，未启用人脸识别、语音转写或抗噪效果。</p>{view.features?.visionQuestions===false?<p role="status">画面问答暂未连接。设备预览只在本机显示，不会自动上传。</p>:<GuestVisionPanel key={view.session.id+':'+view.session.focusVersion} session={view.session} csrfToken={view.csrfToken} devices={devices} onBusyChange={onVisualBusy}/>}</section>
      {errors.map((error, index) => <div className="error" role="alert" key={index}>{error instanceof Error ? error.message : '操作失败，请刷新状态后重试。'}</div>)}
      <footer className="guest-footer"><span>{restaurant?(view.features?.dining===false?'当前可文字咨询和请求店员协助；预约、落座、偏好、点单与结账尚未启用。':'本页服务表单显示当前可用功能；确认后的就餐、订单和结算记录会保存。问答、POS与资金均为本地模拟。'):view.features?.visitRegistration===true?'自动对话为确定性模拟；本地接待请求会保存，外部通知、订单及支付尚未接入。':'自动对话为确定性模拟，不执行通知、订单或支付。'}</span><button className="text-button danger" disabled={!!ended || control.isPending} onClick={() => stop('end')}>结束本次接待</button></footer>
    </>}
  </main>;
}
