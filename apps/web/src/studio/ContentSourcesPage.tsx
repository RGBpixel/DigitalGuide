import { useEffect, useState } from 'react';
import {useSearchParams} from 'react-router-dom';
import {isVideoMediaType} from '@digitalguide/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { Asset, ContentSource, ContentBrief } from '@digitalguide/contracts';
import { api } from '../api.js';
import { Box, ListState, Note, useStudioList } from './shared.js';
import './content.css';
const kinds:Record<ContentSource['kind'],string>={text:'文字',docx:'Word文档',web:'网页',video:'视频人工转写'};
const sourceKind=(s:ContentSource)=>s.origin.mode==='reviewed_video_asr'?'视频离线转写（已校对）':kinds[s.kind];
const future=()=>new Date(Date.now()+30*86400000).toISOString().slice(0,16);
function SourceForm({workspaceId,done}:{workspaceId:string;done:(id:string)=>void}) {
  const [name,setName]=useState(''),[kind,setKind]=useState<ContentSource['kind']>('text'),[text,setText]=useState(''),[url,setUrl]=useState(''),[capture,setCapture]=useState<'fetch'|'snapshot'>('fetch'),[file,setFile]=useState<File|null>(null),[assetId,setAssetId]=useState(''),[subject,setSubject]=useState(''),[proof,setProof]=useState(''),[expires,setExpires]=useState(future),[confirmed,setConfirmed]=useState(false);
  const assets=useStudioList<Asset>('assets',workspaceId),videos=assets.data?.pages.flatMap(p=>p.items).filter(a=>isVideoMediaType(a.mediaType)&&!a.archived&&!a.unavailableReason)||[];
  const save=useMutation({mutationFn:async()=>{
    const rights={subject,proof,expiresAt:new Date(expires).toISOString(),confirmed:true as const},common={workspaceId,name,rights};
    if(kind==='docx'){
      if(!file||file.size>8388608)throw new Error('请选择8MB以内的无宏DOCX。');
      const base64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('文件读取失败，请重新选择。'));reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(file);});
      return api<ContentSource>('/studio/content/sources',{...common,kind,fileName:file.name,contentBase64:base64});
    }
    if(kind==='web')return api<ContentSource>('/studio/content/sources',{...common,kind,url,capture,html:capture==='snapshot'?text:''});
    if(kind==='video'){
      const a=videos.find(a=>a.id===assetId);if(!a)throw new Error('请选择本空间已导入的MP4/MOV。');
      return api<ContentSource>('/studio/content/sources',{...common,kind,assetId:a.id,assetVersion:a.version,transcript:text,transcriptOrigin:'manual'});
    }
    return api<ContentSource>('/studio/content/sources',{...common,kind,text});
  },onSuccess:source=>{setConfirmed(false);done(source.id);}});
  return <form className="content-form" onSubmit={e=>{e.preventDefault();save.mutate();}}>
    <fieldset disabled={save.isPending}>
      <label>来源名称<input value={name} maxLength={100} required onChange={e=>setName(e.target.value)}/></label>
      <label>来源类型<select aria-label="来源类型" value={kind} onChange={e=>{setKind(e.target.value as ContentSource['kind']);setConfirmed(false);}}>{Object.entries(kinds).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      {kind==='docx'?<><label>Word文件<input type="file" accept=".docx" required onChange={e=>{setFile(e.target.files?.[0]||null);setConfirmed(false);}}/></label><p className="form-help">提取正文与表格文字；图片、版式、页眉、批注和脚注需要对照原稿核对。</p></>:<>
        {kind==='web'&&<><label>公开网页地址<input type="url" required maxLength={2048} value={url} placeholder="https://…" onChange={e=>setUrl(e.target.value)}/></label><label>网页读取方式<select aria-label="网页读取方式" value={capture} onChange={e=>setCapture(e.target.value as 'fetch'|'snapshot')}><option value="fetch">读取公开HTTPS静态正文</option><option value="snapshot">粘贴网页HTML快照</option></select></label><p className="form-help">不登录、不执行网页脚本。读取失败时可以粘贴HTML，或改为文字来源复制正文；快照仍保留网页出处。</p></>}
        {kind==='video'&&<><label>原视频<select aria-label="原视频" required value={assetId} onChange={e=>setAssetId(e.target.value)}><option value="">请选择已检查MP4/MOV</option>{videos.map(a=><option value={a.id} key={a.id}>{a.name} · v{a.version}</option>)}</select></label><ListState query={assets}/><p className="form-help">此处登记人工文字；也可前往视频转写工作台识别原声并校对。没有自动理解画面。<a href="/studio/media">先导入视频</a></p></>}
        {(kind!=='web'||capture==='snapshot')&&<label>{kind==='web'?'网页HTML快照':kind==='video'?'已核对的人工转写稿':'来源正文'}<textarea rows={7} required value={text} maxLength={kind==='web'?1000000:60000} onChange={e=>setText(e.target.value)}/></label>}
      </>}
      <label>内容授权主体<input value={subject} maxLength={80} required onChange={e=>setSubject(e.target.value)}/></label>
      <label>来源与使用依据<textarea value={proof} minLength={8} maxLength={300} required rows={2} onChange={e=>setProof(e.target.value)}/></label>
      <label>来源使用期限<input type="datetime-local" required value={expires} onChange={e=>setExpires(e.target.value)}/></label>
      <label className="checkbox-line"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>我已核对内容来源、授权及本次创作用途</label>
      <button className="button primary" disabled={!confirmed||save.isPending}>{save.isPending?'正在读取并保存…':'读取并保存来源'}</button>
    </fieldset><Note error={save.error}/>
  </form>;
}
function SourceDetail({id,workspaceId,writable,refresh}:{id:string;workspaceId:string;writable:boolean;refresh:()=>void}) {
  const source=useQuery({queryKey:['content-source',id,workspaceId],queryFn:async()=>{const s=await api<ContentSource>('/studio/content/sources/'+id);if(s.workspaceId!==workspaceId)throw new Error('来源不在当前工作空间，请切换空间后查看。');return s;},refetchInterval:4000});
  const versions=useQuery({queryKey:['content-source-versions',id,source.data?.version],queryFn:()=>api<{version:number;action:string;createdAt:string}[]>('/studio/content/sources/'+id+'/versions')});
  const withdraw=useMutation({mutationFn:()=>api<ContentSource>('/studio/content/sources/'+id+'/withdraw',{version:source.data!.version,confirmed:true}),onSuccess:()=>{void source.refetch();refresh();}});
  if(!source.data)return <Note error={source.error}/>;
  const s=source.data;
  return <div className="content-source-detail"><div className="content-summary"><strong>{s.name} · v{s.version}</strong><span>{sourceKind(s)} · {s.available?'可供审阅':'当前不可用'}</span></div>
    <p>授权主体：{s.subject} · 至{new Date(s.expiresAt).toLocaleString('zh-CN')}</p><p className="studio-preserve">{s.proof}</p>
    {s.unavailableReason&&<p className="error" role="status">{s.unavailableReason}</p>}
    {s.warnings.map((w,i)=><p className="form-help" key={i}>{w}</p>)}
    {typeof s.origin.url==='string'&&<p>出处：<a href={s.origin.url} target="_blank" rel="noreferrer">{s.origin.url}</a></p>}
    {typeof s.origin.fileName==='string'&&<p>原文件：{s.origin.fileName}</p>}
    {s.available&&<><p>共{s.paragraphs.length}段、{s.text?.length}字符。正文仅作为待审阅材料；不会自动写入工程或对外发布。</p><pre className="content-text" aria-label="已提取来源正文">{s.text}</pre></>}
    {s.available&&<a href={'/studio/drafts?source='+s.id}>从此来源建立可编辑脚本草稿</a>}
    <details><summary>来源校验与修订记录</summary><p className="content-hash">原材料SHA256：{s.materialSHA256}<br/>正文SHA256：{s.textSHA256}</p>{versions.data?.map(v=><p key={v.version}>v{v.version} · {v.action==='captured'?'读取入库':'撤回'} · {new Date(v.createdAt).toLocaleString('zh-CN')}</p>)}<Note error={versions.error}/></details>
    {writable&&!s.withdrawn&&<button disabled={withdraw.isPending} onClick={()=>{if(window.confirm('撤回后不能再读取此正文或用于新草稿。已有输入请自行核对，确定撤回吗？'))withdraw.mutate();}}>撤回此来源</button>}<Note error={withdraw.error||source.error}/>
  </div>;
}
const emptyBrief={name:'',position:'',audience:'',objective:'',channel:'',tone:'',topics:[] as string[]};
function BriefEditor({workspaceId,writable}:{workspaceId:string;writable:boolean}) {
  const list=useStudioList<ContentBrief>('studio/content/briefs',workspaceId),rows=list.data?.pages.flatMap(p=>p.items)||[];
  const [selected,setSelected]=useState<ContentBrief|null>(null),[draft,setDraft]=useState(emptyBrief),[topicText,setTopicText]=useState(''),[dirty,setDirty]=useState(false);
  const live=useQuery({queryKey:['content-brief',selected?.id],enabled:!!selected,queryFn:()=>api<ContentBrief>('/studio/content/briefs/'+selected!.id),refetchInterval:4000});
  const conflict=!!selected&&!!live.data&&selected.version!==live.data.version;
  const versions=useQuery({queryKey:['content-brief-history',selected?.id,live.data?.version],enabled:!!selected,queryFn:()=>api<{version:number;configuration:typeof emptyBrief;createdAt:string}[]>('/studio/content/briefs/'+selected!.id+'/versions')});
  function load(b:ContentBrief|null) {setSelected(b);setDraft(b?{name:b.name,position:b.position,audience:b.audience,objective:b.objective,channel:b.channel,tone:b.tone,topics:b.topics}:{...emptyBrief});setTopicText(b?.topics.join('\n')||'');setDirty(false);}
  const save=useMutation({mutationFn:()=>api<ContentBrief>(selected?'/studio/content/briefs/'+selected.id+'/save':'/studio/content/briefs',{...draft,topics:topicText.split(/\r?\n/).map(t=>t.trim()).filter(Boolean),...(selected?{version:selected.version}:{workspaceId})}),onSuccess:b=>{load(b);void list.refetch();void live.refetch();}});
  useEffect(()=>{const before=(e:BeforeUnloadEvent)=>{if(dirty){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',before);return()=>window.removeEventListener('beforeunload',before);},[dirty]);
  return <Box title="账号定位与选题"><div className="content-form"><label>选择定位<select aria-label="选择定位" value={selected?.id||''} disabled={save.isPending} onChange={e=>{if(dirty&&!window.confirm('有未保存定位，确定放弃当前输入后切换吗？'))return;load(rows.find(b=>b.id===e.target.value)||null);}}><option value="">新建定位</option>{rows.map(b=><option key={b.id} value={b.id}>{b.name} · v{b.version}</option>)}</select></label><ListState query={list}/>
    {conflict&&<p className="error">另一窗口已保存新版本，当前输入保留。<button onClick={()=>load(live.data!)}>放弃输入并载入当前定位</button></p>}
    <form onSubmit={e=>{e.preventDefault();save.mutate();}}><fieldset disabled={!writable||save.isPending||conflict}>{(['name','position','audience','objective','channel','tone'] as const).map((key,i)=><label key={key}>{['定位名称','账号定位','目标受众','内容目标','传播渠道','表达方式'][i]}<input value={draft[key]} required maxLength={key==='position'||key==='objective'?500:key==='audience'?300:100} onChange={e=>{setDraft({...draft,[key]:e.target.value});setDirty(true);}}/></label>)}<label>待制作选题（每行一条，最多20条）<textarea rows={5} required value={topicText} onChange={e=>{setTopicText(e.target.value);setDirty(true);}}/></label><button className="button primary">保存定位与选题</button></fieldset></form><Note error={save.error||live.error}/>{dirty&&<p className="form-help">有未保存输入。</p>}
    {selected&&<details><summary>定位修订历史</summary>{versions.data?.map(v=><div key={v.version} className="content-history"><strong>v{v.version} · {v.configuration.name}</strong><p>{v.configuration.position}</p><p>选题：{v.configuration.topics.join('；')}</p></div>)}<Note error={versions.error}/></details>}
  </div><p className="form-help">这里保存人工定位和选题。<a href={'/studio/drafts'+(selected?'?brief='+selected.id:'')}>前往脚本草稿与审阅计划</a>，真实内容模型尚未接入。</p></Box>;
}
export function ContentSourcesPage({workspaceId,writable}:{workspaceId:string;writable:boolean}) {
  const [params]=useSearchParams(),list=useStudioList<ContentSource>('studio/content/sources',workspaceId,'',true),rows=list.data?.pages.flatMap(p=>p.items)||[],[selected,setSelected]=useState(params.get('source')||'');
  return <><div className="studio-heading"><h1>内容来源与定位</h1><p>把素材整理成可核对的正文，保存面向受众的定位和选题。</p></div><div className="content-grid"><div>{writable&&<Box title="添加内容来源"><SourceForm workspaceId={workspaceId} done={id=>{setSelected(id);void list.refetch();}}/></Box>}<Box title="已保存来源"><label>选择来源<select aria-label="选择来源" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">请选择来源</option>{selected&&!rows.some(s=>s.id===selected)&&<option value={selected}>当前链接来源</option>}{rows.map(s=><option key={s.id} value={s.id}>{s.name} · {sourceKind(s)}{s.available?'':' · 不可用'}</option>)}</select></label><ListState query={list}/>{selected&&<SourceDetail key={selected} id={selected} workspaceId={workspaceId} writable={writable} refresh={()=>void list.refetch()}/>}</Box></div><BriefEditor workspaceId={workspaceId} writable={writable}/></div><p className="form-help"><a href="/studio/recordings">前往录屏、摄像头与提词录制</a>，核对原片后可实际入库。<a href="/studio/processing">前往媒体加工</a>使用本地滤镜，或<a href="/studio/transcriptions">前往视频转写与校对</a>登记文字来源。模型能力按接入状态单独核验。</p></>;
}
