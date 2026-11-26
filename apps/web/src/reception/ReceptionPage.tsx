import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Clock3, LogIn, MessageSquare, Plus, UsersRound } from 'lucide-react';
import type { Page, PresenceResult, Profile, SceneApp, ReceptionSession, ReceptionTerminal, ReceptionFeatures } from '@digitalguide/contracts';
import { api } from '../api.js';
import './reception.css';
import {ReceptionHostsPanel} from '../visits/ReceptionHostsPanel.js';

export function ReceptionPage({ workspaceId, role }: { workspaceId: string; role: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const terminalId = searchParams.get('terminalId') || '';
  function setTerminalId(value: string) { const next = new URLSearchParams(searchParams); next.set('terminalId', value); setSearchParams(next, { replace: true }); }
  const [venueId, setVenueId] = useState(''), [name, setName] = useState('企业前台 · 演示终端'), [profileId, setProfileId] = useState(''), [sceneAppId, setSceneAppId] = useState('');
  const client = useQueryClient(), navigate = useNavigate(), allowed = role === 'admin';
  const terminals = useQuery({ queryKey: ['terminals', workspaceId], queryFn: () => api<Page<ReceptionTerminal> & {features?:ReceptionFeatures}>('/terminals?workspaceId=' + workspaceId), enabled: allowed && !!workspaceId, refetchInterval: 2000 });
  const venues = useQuery({ queryKey: ['venues', workspaceId], queryFn: () => api<{ id: string; name: string }[]>('/venues?workspaceId=' + workspaceId), enabled: allowed && !!workspaceId });
  const profiles = useQuery({ queryKey: ['profiles', workspaceId], queryFn: () => api<Page<Profile>>('/profiles?workspaceId=' + workspaceId), enabled: allowed && !!workspaceId });
  const apps = useQuery({ queryKey: ['scene-apps', workspaceId], queryFn: () => api<Page<SceneApp>>('/scene-apps?workspaceId=' + workspaceId + '&limit=100'), enabled: allowed && !!workspaceId });
  const features=terminals.data?.features;
  const terminal = terminals.data?.items.find(item => item.id === terminalId) || terminals.data?.items[0];
  const session = useQuery({ queryKey: ['reception-session', terminal?.currentSessionId], queryFn: () => api<ReceptionSession>('/sessions/' + terminal!.currentSessionId), enabled: !!terminal?.currentSessionId, refetchInterval: 2000 });
  async function refresh() { await client.invalidateQueries({ queryKey: ['terminals'] }); await client.invalidateQueries({ queryKey: ['reception-session'] }); }
  async function launch(sessionId: string) {
    const access = await api<{ terminalUrl: string }>('/sessions/' + sessionId + '/access', {}); navigate(access.terminalUrl);
  }
  const create = useMutation({ mutationFn: () => api<ReceptionTerminal>('/terminals', { venueId: venueId || venues.data?.[0]?.id, name }), onSuccess: async row => { setTerminalId(row.id); await refresh(); } });
  const start = useMutation({ mutationFn: () => api<ReceptionSession>('/sessions', { terminalId: terminal?.id, ...(sceneAppId ? { sceneAppId } : profileId ? { profileId } : {}) }), onSuccess: async row => { await refresh(); await launch(row.id); } });
  const open = useMutation({ mutationFn: (sessionId: string) => launch(sessionId) });
  const presence = useMutation({ mutationFn: (trackId: string) => api<PresenceResult>('/terminals/' + terminal?.id + '/presence', { type: 'entered', trackId, source: 'mock_presence' }), onSuccess: refresh });
  const next = useMutation({ mutationFn: () => api<ReceptionSession>('/terminals/' + terminal?.id + '/next', {}), onSuccess: refresh });
  const control = useMutation({ mutationFn: (action: string) => api<ReceptionSession>('/sessions/' + session.data?.id + '/control', { action, version: session.data?.version, focusVersion: session.data?.focusVersion }), onSuccess: refresh });
  const errors = [terminals.error, venues.error, profiles.error, apps.error, create.error, start.error, open.error, presence.error, next.error, control.error].filter(Boolean);
  return <>
    <div className="page-heading"><div><span className="eyebrow">RECEPTION WORKSPACE</span><h1>企业接待</h1><p>匿名会话、文字交流与人工交接，从这里开始。</p></div><span className="badge amber">M2 · 终端基础</span></div>
    <div className="info-note"><MessageSquare size={16}/>{terminals.isPending ? '正在读取本终端可用能力。' : features ? features.visitRegistration?'当前提供文字接待、本地接待请求、指定员工回应和公开引导。模拟通知单独标注，真实语音与外部渠道按连接状态开放。':'当前提供匿名文字接待、停止回复和人工交接。来访登记、偏好保存、语音与通知按各项连接状态开放。' : '当前提供匿名文字接待、访客登记、本人偏好与显式模拟通知。真实音视频与业务渠道继续按计划接入。'}</div>
    <div className="reception-links">{allowed && session.data && session.data.features?.speakerFocus!==false && <Link className="button secondary" to={'/speaker-lab/' + session.data.id}>专注对话模拟实验室</Link>}{features?.visitRegistration===false?<span className="badge">来访登记与接待通知暂未连接</span>:<><Link className="button secondary" to="/visits">查看来访记录</Link><Link className="button secondary" to="/visit-inbox">我的接待请求</Link></>}</div>
    {allowed&&!terminals.error&&features?.hostManagement===true&&<ReceptionHostsPanel key={workspaceId} workspaceId={workspaceId}/>}
    {!allowed ? <div className="panel"><div className="empty"><UsersRound size={30}/><strong>当前账号没有接待管理权限</strong><p>请使用演示管理员账号配置终端。访客仅能访问工作人员打开的匿名会话。</p></div></div> : <div className="reception-workspace">
      <section className="panel reception-config"><h2>接待终端</h2>
        {terminals.isPending ? <p role="status">正在加载终端…</p> : terminals.data?.items.length ? <><label>当前终端<select aria-label="当前终端" value={terminal?.id || ''} onChange={event => setTerminalId(event.target.value)}>{terminals.data.items.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><p className="form-help">终端配置已保存，重启后可以继续使用。</p></> : <p className="form-help">此工作空间还没有终端，先为场所创建一个。</p>}
        <details open={!terminals.data?.items.length}><summary><Plus size={14}/>新增终端</summary><form onSubmit={event => { event.preventDefault(); create.mutate(); }}><label>终端名称<input value={name} required maxLength={60} onChange={event => setName(event.target.value)}/></label><label>所属场所<select value={venueId || venues.data?.[0]?.id || ''} required onChange={event => setVenueId(event.target.value)}>{venues.data?.map(venue => <option value={venue.id} key={venue.id}>{venue.name}</option>)}</select></label><button className="button secondary full" disabled={create.isPending || !venues.data?.length}>保存终端配置</button></form></details>
        <hr/><label>本次场景应用<select value={sceneAppId} onChange={e => setSceneAppId(e.target.value)}><option value="">基础文字接待</option>{apps.data?.items.filter(a => a.scene === 'reception' && a.audience === 'public' && a.enabled).map(a => <option value={a.id} key={a.id}>{a.name} · v{a.version}</option>)}</select></label><label>本次角色配置<select disabled={!!sceneAppId} value={profileId} onChange={event => setProfileId(event.target.value)}><option value="">使用合成示意角色</option>{profiles.data?.items.filter(profile => profile.scenes.includes('reception')).map(profile => <option key={profile.id} value={profile.id}>{profile.name} · v{profile.version}</option>)}</select></label>
        <button className="button primary full" disabled={!terminal || start.isPending} onClick={() => start.mutate()}><LogIn size={16}/>{terminal?.currentSessionId ? '打开当前访客终端' : '开始文字接待'}</button><p className="form-help">选择场景应用会绑定其角色、知识与问候快照。当前不连接真实形象或声音驱动。</p>
      </section>
      <div><section className="panel reception-status"><div className="section-heading"><div><h2>当前接待</h2><span>同一终端同时只接待一个活动会话</span></div><span className={'badge ' + (terminal?.currentSessionId ? 'green' : '')}>{session.data?.status === 'human' ? '人工接管中' : terminal?.currentSessionId ? '接待中' : '等待访客'}</span></div>
        {session.data && terminal?.currentSessionId ? <div className="reception-session-card"><span className="profile-portrait"><UsersRound size={34}/></span><div><h3>匿名访客 · {session.data.id.slice(0, 8)}</h3><p>文字入口 · {session.data.messages.filter(item => item.role === 'visitor').length} 条访客消息</p><small>未进行人脸识别或声纹认证</small></div><button className="button secondary" disabled={open.isPending} onClick={() => open.mutate(session.data!.id)}>进入终端 <ArrowRight size={14}/></button><div className="session-operator-actions"><button className="button secondary" disabled={control.isPending} onClick={() => control.mutate(session.data?.status === 'human' ? 'resume' : 'handoff')}>{session.data.status === 'human' ? '释放人工接管' : '人工接管'}</button><button className="button secondary" disabled={control.isPending} onClick={() => control.mutate('end')}>结束当前接待</button></div></div> : <div className="empty"><MessageSquare size={30}/><strong>接待区已就绪</strong><p>点击「开始文字接待」，或通过下面的模拟接近事件验证问候与排队。</p></div>}</section>
        <section className="panel reception-status"><div className="section-heading"><div><h2>模拟接近与排队</h2><span>显式模拟事件，不读取摄像头识别人脸</span></div><span className="badge amber">模拟</span></div><div className="presence-controls"><button className="button secondary" disabled={!terminal || presence.isPending} onClick={() => presence.mutate('demo-track-a')}>模拟访客 A 接近</button><button className="button secondary" disabled={!terminal || presence.isPending} onClick={() => presence.mutate('demo-track-b')}>模拟访客 B 接近</button><span><Clock3 size={15}/>{terminal?.queued || 0} 位等候</span><button className="button secondary" disabled={!terminal || !!terminal.currentSessionId || !terminal.queued || next.isPending} onClick={() => next.mutate()}>接待下一位</button></div>{presence.data && <p className="presence-result" role="status">{({ started: '已创建匿名会话，仅问候一次。', active: '当前访客仍在接待中，没有重复问候。', queued: '另一位访客已进入等候队列。', cooldown: '问候冷却期内，本次未重复打扰。', left: '访客离开事件已处理。' })[presence.data.disposition]}</p>}<p className="form-help padded">问候冷却 60 秒；等候记录在 30 秒无接近事件后清理；会话空闲 2 分钟或最长 15 分钟后结束。</p></section>
      </div>
    </div>}
    {errors.map((error, index) => <div className="error" role="alert" key={index}>{error instanceof Error ? error.message : '操作失败，请重试。'}</div>)}
    <Link to="/roadmap" className="text-link">查看完整平台开发计划 <ArrowRight size={14}/></Link>
  </>;
}
