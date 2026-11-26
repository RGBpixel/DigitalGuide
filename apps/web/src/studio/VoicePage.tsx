import { useState } from 'react';
import { Link,useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { StudioProject } from '@digitalguide/contracts';
import { api } from '../api.js';
import { Note,ListState,useStudioList } from './shared.js';
import type { StudioProps } from './LibraryPages.js';
import { VoiceLibrary } from './VoiceLibrary.js';
import { SpeechComposer } from './SpeechComposer.js';
import { VoiceLanguagePanel } from './VoiceLanguagePanel.js';
import { VoiceSubtitlePanel } from './VoiceSubtitlePanel.js';
import './voice.css';
export function VoicePage(props:StudioProps){
 const [params,setParams]=useSearchParams(),selected=params.get('project')||'',[tab,setTab]=useState<'project'|'library'>('project'),projects=useStudioList<StudioProject>('studio/projects',props.workspaceId),rows=projects.data?.pages.flatMap(p=>p.items)||[],query=useQuery({queryKey:['voice-project',props.workspaceId,selected],queryFn:()=>api<StudioProject>('/studio/projects/'+selected),enabled:!!selected,refetchInterval:2000,retry:false});
 return <><div className="studio-heading"><div><span className="eyebrow">VOICE & LANGUAGES</span><h1>语气与多语言</h1><p className="form-help">表达控制、系统配音、术语、语言版本与逐词字幕。</p></div></div><div className="tabs"><button className={tab==='project'?'active':''} onClick={()=>setTab('project')}>工程配音与语言</button><button className={tab==='library'?'active':''} onClick={()=>setTab('library')}>语气与词典库</button></div><div hidden={tab!=='library'}><VoiceLibrary {...props}/></div><div hidden={tab!=='project'}><div className="voice-toolbar"><label>选择声音与语言工程<select value={selected} onChange={e=>{const next=new URLSearchParams(params);if(e.target.value)next.set('project',e.target.value);else next.delete('project');setParams(next);}}><option value="">选择已保存的创作工程</option>{rows.map(p=><option key={p.id} value={p.id}>{p.name} · v{p.version}</option>)}{selected&&query.data&&!rows.some(p=>p.id===selected)&&<option value={selected}>{query.data.name}</option>}</select></label><Link className="button secondary" to="/studio">打开创作工作台</Link></div><ListState query={projects}/><Note error={query.error}/>{selected&&query.isPending&&<p role="status">正在读取声音工程…</p>}{query.data&&query.data.workspaceId===props.workspaceId&&!query.error&&<VoiceProject key={selected} {...props} live={query.data} refresh={()=>{void query.refetch();}}/>}{query.data&&query.data.workspaceId!==props.workspaceId&&<p className="error">此工程属于另一个工作空间，请先切换空间。</p>}{!selected&&<div className="panel studio-box"><h2>先选择已保存工程</h2><p className="form-help">可先在语气与词典库准备配置，再选择工程制作系统配音、人工译文或逐词字幕。</p></div>}</div><p className="form-help voice-page-note">本地系统配音和人工译文可用；真人声音/语气复刻、翻译模型、真实跨语言口型与声纹抗噪按各自任务继续接入。</p></>;
}
function VoiceProject({live,workspaceId,writable,refresh}:StudioProps&{live:StudioProject;refresh():void}){
 const [base,setBase]=useState(live),changed=live.version!==base.version,locked=changed||live.archived;
 return <div className="voice-workbench">{changed&&<div className="voice-warning"><p>工程已更新到v{live.version}；当前制作基于v{base.version}，未提交输入保留。载入新版本会清空未提交的配音设置，人工译文和字幕草稿保留供复核。</p><button onClick={()=>setBase(live)}>载入工程新版本</button></div>}{live.archived&&<p className="voice-warning">工程已归档，请先从创作工作台恢复；已有制作记录保留。</p>}<div className="studio-actions"><span className="form-help">当前原稿：{base.name} · v{base.version}</span><Link className="text-link" to={'/studio/projects/'+base.id}>打开原工程与时间线</Link></div><SpeechComposer key={base.version} project={base} workspaceId={workspaceId} writable={writable} locked={locked} refresh={refresh}/><div className="voice-grid"><VoiceLanguagePanel project={base} workspaceId={workspaceId} writable={writable} locked={locked}/><VoiceSubtitlePanel project={base} workspaceId={workspaceId} writable={writable} locked={locked} refresh={refresh}/></div></div>;
}
