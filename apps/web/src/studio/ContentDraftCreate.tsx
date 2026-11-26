import { useEffect,useState } from 'react';
import { useMutation,useQuery } from '@tanstack/react-query';
import type { ContentSource,ContentBrief,ContentDraft,StudioProject } from '@digitalguide/contracts';
import { api } from '../api.js';
import { Box,ListState,Note,useStudioList } from './shared.js';
export function useContentProject(workspaceId:string,initialId=''){
  const list=useStudioList<StudioProject>('studio/projects',workspaceId),rows=list.data?.pages.flatMap(p=>p.items)||[];
  const [id,setId]=useState(initialId),[snapshot,setSnapshot]=useState<StudioProject|null>(null);
  const live=useQuery({queryKey:['content-target-project',workspaceId,id],enabled:!!id,queryFn:()=>api<StudioProject>('/studio/projects/'+id),refetchInterval:4000});
  useEffect(()=>{if(!snapshot&&live.data&&live.data.id===id)setSnapshot(live.data);},[id,snapshot,live.data]);
  const changed=!!snapshot&&!!live.data&&snapshot.version!==live.data.version;
  function choose(value:string){setId(value);setSnapshot(null);}
  const control=<><label>选择工程<select aria-label="选择工程" value={id} onChange={e=>choose(e.target.value)}><option value="">请选择已保存工程</option>{id&&!rows.some(r=>r.id===id)&&<option value={id}>{snapshot?.name||'正在读取指定工程'}</option>}{rows.map(r=><option key={r.id} value={r.id}>{r.name} · v{r.version}</option>)}</select></label><ListState query={list}/><Note error={live.error}/>{snapshot&&<p>已载入{snapshot.name} · v{snapshot.version}</p>}{changed&&<p className="error">工程已有新版本，当前选择保留。<button type="button" onClick={()=>setSnapshot(live.data!)}>载入工程当前版本</button></p>}</>;
  return {snapshot,changed,control,id};
}
export function ContentDraftCreate({workspaceId,writable,sourceId='',briefId='',projectId='',onCreated}:{workspaceId:string;writable:boolean;sourceId?:string;briefId?:string;projectId?:string;onCreated:(draft:ContentDraft)=>void}){
  const sources=useStudioList<ContentSource>('studio/content/sources',workspaceId,'',true),briefs=useStudioList<ContentBrief>('studio/content/briefs',workspaceId),listedSources=sources.data?.pages.flatMap(p=>p.items)||[],briefRows=briefs.data?.pages.flatMap(p=>p.items)||[];
  const source=useQuery({queryKey:['content-create-source',workspaceId,sourceId],enabled:!!sourceId&&!listedSources.some(s=>s.id===sourceId),queryFn:()=>api<ContentSource>('/studio/content/sources/'+sourceId)});
  const sourceRows=source.data&&!listedSources.some(s=>s.id===source.data!.id)?[source.data,...listedSources]:listedSources;
  const [mode,setMode]=useState(projectId?'project':'sources'),[name,setName]=useState('新的脚本草稿'),[selected,setSelected]=useState<string[]>(sourceId?[sourceId]:[]),[brief,setBrief]=useState(briefId),[topic,setTopic]=useState(''),[provider,setProvider]=useState('local-rules'),[chunk,setChunk]=useState(1000),[segmentIds,setSegmentIds]=useState<string[]>([]),[confirmed,setConfirmed]=useState(false);
  const target=useContentProject(workspaceId,projectId),[book,setBook]=useState<ContentBrief|null>(null);
  const currentBook=useQuery({queryKey:['content-create-brief',workspaceId,brief],enabled:!!brief,queryFn:()=>api<ContentBrief>('/studio/content/briefs/'+brief),refetchInterval:4000});
  useEffect(()=>{if(!book&&currentBook.data&&currentBook.data.id===brief)setBook(currentBook.data);},[book,brief,currentBook.data]);
  const bookChanged=!!book&&!!currentBook.data&&currentBook.data.version>book.version;
  const create=useMutation({mutationFn:async()=>{
    if(mode==='project'){if(!target.snapshot)throw new Error('请先载入工程。');return api<ContentDraft>('/studio/projects/'+target.snapshot.id+'/content-draft',{projectVersion:target.snapshot.version,name,segmentIds,confirmed:true});}
    if(brief&&!book)throw new Error('所选定位尚未载入，请稍候或重新选择。');
    const refs=selected.map(id=>{const s=sourceRows.find(s=>s.id===id);if(!s||!s.available)throw new Error('所选来源不可用，请核对当前来源。');return{id:s.id,version:s.version};});
    return api<ContentDraft>('/studio/content/drafts',{workspaceId,name,sources:refs,briefId:book?.id||null,briefVersion:book?.version||null,topic,provider,chunkCharacters:chunk,confirmed:true});
  },onSuccess:d=>{setConfirmed(false);onCreated(d);}});
  return <Box title="建立脚本草稿"><form className="content-form" onSubmit={e=>{e.preventDefault();create.mutate();}}><fieldset disabled={!writable||create.isPending}>
    <label>建立方式<select aria-label="建立方式" value={mode} onChange={e=>{setMode(e.target.value);setConfirmed(false);}}><option value="sources">从内容来源或选题整理</option><option value="project">从已有工程选择分镜</option></select></label>
    <label>草稿名称<input value={name} maxLength={100} required onChange={e=>setName(e.target.value)}/></label>
    {mode==='project'?<>{target.control}{target.snapshot&&<div className="draft-selection">{target.snapshot.document.segments.map(s=><label className="checkbox-line" key={s.id}><input type="checkbox" checked={segmentIds.includes(s.id)} onChange={e=>setSegmentIds(ids=>e.target.checked?[...ids,s.id]:ids.filter(id=>id!==s.id))}/>{s.title}</label>)}</div>}<p className="form-help">复制已保存台词形成独立草稿，原工程不改变。应用回工程前还需建立映射与审阅计划。</p></>:<>
      <div className="draft-selection" aria-label="草稿内容来源">{sourceRows.map(s=><label className="checkbox-line" key={s.id}><input type="checkbox" disabled={!s.available&&!selected.includes(s.id)} checked={selected.includes(s.id)} onChange={e=>{setSelected(ids=>e.target.checked?[...ids,s.id]:ids.filter(id=>id!==s.id));setConfirmed(false);}}/>{s.name}{s.available?'':' · 来源失效'}</label>)}</div><ListState query={sources}/><Note error={source.error}/>
      <label>账号定位<select aria-label="草稿账号定位" value={brief} onChange={e=>{setBrief(e.target.value);setBook(null);setTopic('');setConfirmed(false);}}><option value="">不绑定定位</option>{brief&&!briefRows.some(b=>b.id===brief)&&<option value={brief}>{book?.name||'正在读取指定定位'}</option>}{briefRows.map(b=><option key={b.id} value={b.id}>{b.name} · v{b.version}</option>)}</select></label><ListState query={briefs}/><Note error={currentBook.error}/>
      {bookChanged&&<p className="error">账号定位已有新修订。<button type="button" onClick={()=>{setBook(currentBook.data!);setTopic('');setConfirmed(false);}}>载入当前定位并重新核对</button></p>}
      {book&&<><p className="form-help">{book.position} · 面向{book.audience}</p><label>制作选题<select aria-label="制作选题" value={topic} onChange={e=>setTopic(e.target.value)}><option value="">主要整理所选来源</option>{book.topics.map(t=><option key={t} value={t}>{t}</option>)}</select></label></>}
      <label>整理方式<select aria-label="草稿整理方式" value={provider} onChange={e=>{setProvider(e.target.value);setConfirmed(false);}}><option value="local-rules">本地规则：保留原文、按段落分块</option><option value="mock-content">明确模拟写作建议</option><option value="external-content">真实内容模型（尚未配置）</option></select></label>
      <label>每段字符上限<input type="number" min={200} max={4000} step={100} value={chunk} onChange={e=>setChunk(Number(e.target.value))}/></label>
      <p className="form-help">规则整理不做语义改写。模拟结果单独标识；无来源的选题只形成待补事实的提纲，不能视为核实内容。</p>
    </>}
    <label className="checkbox-line"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>我已核对来源、定位版本和所选方式，先建立可编辑草稿</label>
    <button className="button primary" disabled={!confirmed||create.isPending||(mode==='sources'&&(bookChanged||!!brief&&!book))||(mode==='project'&&(!segmentIds.length||target.changed))}>{create.isPending?'正在建立草稿…':'建立可编辑草稿'}</button>
  </fieldset><Note error={create.error}/></form></Box>;
}
