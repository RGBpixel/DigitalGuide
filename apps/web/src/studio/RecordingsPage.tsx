import {useState} from 'react';
import {Link,useSearchParams} from 'react-router-dom';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import type {Recording,StudioProject,recordingVersionSchema} from '@digitalguide/contracts';
import type {z} from 'zod';
import {api} from '../api.js';
import {Box,Note,ListState,useStudioList} from './shared.js';
import type {StudioProps} from './LibraryPages.js';
import {RecordingForm} from './RecordingForm.js';
import {RecordingCapture} from './RecordingCapture.js';
import './recording.css';
const status={uploading:'等待继续上传原片',queued:'等待转换检查',processing:'实际转换与完整检查中',ready:'录像素材已就绪',failed:'录制导入失败',cancelled:'录制导入已取消'};
function RecordingDetail({initial,writable,onChanged,onCopy}:{initial:Recording;writable:boolean;onChanged:()=>void;onCopy:(r:Recording)=>void}){
  const [loaded,setLoaded]=useState(initial),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),live=useQuery({queryKey:['recording',initial.id],queryFn:()=>api<Recording>('/studio/recordings/'+initial.id),refetchInterval:1500}),current=live.data&&live.data.version>=loaded.version?live.data:loaded,stale=current.version!==loaded.version;
  const history=useQuery({queryKey:['recording-history',initial.id],queryFn:()=>api<z.infer<typeof recordingVersionSchema>[]>('/studio/recordings/'+initial.id+'/versions'),refetchInterval:2000}),projects=useStudioList<StudioProject>('studio/projects',initial.workspaceId),[projectId,setProjectId]=useState(''),[projectName,setProjectName]=useState(initial.name+' · 剪辑'),[confirmed,setConfirmed]=useState(false),[applied,setApplied]=useState<StudioProject|null>(null);
  const target=useQuery({queryKey:['recording-target-project',projectId],enabled:!!projectId,queryFn:()=>api<StudioProject>('/studio/projects/'+projectId),refetchInterval:2000});
  function refresh(){void live.refetch();void history.refetch();onChanged();}
  function saved(r:Recording){setLoaded(r);setDirty(false);refresh();}
  const cancel=useMutation({mutationFn:()=>api('/studio/transfers/'+current.transfer!.id+'/cancel',{version:current.transfer!.version}),onSuccess:refresh});
  const withdraw=useMutation({mutationFn:()=>api<Recording>('/studio/recordings/'+current.id+'/withdraw',{version:current.version,confirmed:true}),onSuccess:saved});
  const apply=useMutation({mutationFn:(kind:'new_project'|'append')=>api<StudioProject>('/studio/recordings/'+current.id+'/apply',kind==='new_project'?{kind,version:current.version,name:projectName,confirmed:true}:{kind,version:current.version,projectId,projectVersion:target.data!.version,confirmed:true}),onSuccess:p=>{setApplied(p);setConfirmed(false);if(projectId)void target.refetch();}});
  return <>
    <Box title="已保存录制方案"><p>{current.name} · v{current.version}{current.transfer?' · 已固定原片，不再修改方案':' · 尚未绑定原片'}</p>{stale&&<p role="alert" className="studio-warning">已有新方案v{current.version}；保留本地输入。<button disabled={busy} onClick={()=>{if(dirty&&!window.confirm('放弃当前未保存方案输入并载入服务器当前版本吗？'))return;setLoaded(current);setDirty(false);}}>载入当前录制方案</button></p>}{dirty&&<p role="status">方案有未保存输入，先保存或明确载入当前版本，再开启录制/上传。</p>}
      {current.available&&<RecordingForm key={loaded.version} workspaceId={current.workspaceId} row={loaded} locked={!writable||!!current.transfer||busy||stale} onSaved={saved} onDirty={setDirty}/>}{!current.available&&<p className="error" role="alert">{current.unavailableReason}</p>}
      {writable&&current.available&&<button disabled={busy||dirty} onClick={()=>onCopy(current)}>以当前配置新建另一条录制</button>}<Note error={live.error}/>
    </Box>
    <RecordingCapture row={current} writable={writable} disabled={dirty||stale||!writable} onBound={saved} onRefresh={refresh} onBusyChange={setBusy}/>
    <Box title="后台原片与录像素材">{!current.transfer&&<p>尚未上传，不会自动采集或提交设备内容。</p>}{current.transfer&&<article aria-label="录制后台任务"><p>{status[current.transfer.status]} · {Math.round(current.transfer.progress*100)}%{current.transfer.status==='uploading'?' · '+current.transfer.receivedParts.length+'/'+current.transfer.chunkCount+'片':''}</p>{current.transfer.errorMessage&&<p className="error" role="alert">{current.transfer.errorMessage}</p>}{current.transfer.warnings.map((w,i)=><p className="form-help" key={i}>{w}</p>)}{writable&&['uploading','queued','processing'].includes(current.transfer.status)&&<button disabled={cancel.isPending} onClick={()=>cancel.mutate()}>取消原片上传或处理</button>}</article>}
      {current.output&&current.available&&<><video className="recording-result" controls preload="metadata" poster={'/api/v1/assets/'+current.output.assetId+'/poster'} src={'/api/v1/assets/'+current.output.assetId+'/content'} aria-label="入库录像实际播放"/><p>{current.output.specs.width} × {current.output.specs.height} · {(current.output.specs.durationMs/1000).toFixed(2)}秒 · {current.output.specs.hasAudio?'包含原声':'原片无声'} · MP4</p><p><a href={current.output.rawUrl!}>下载保留的原始{current.output.inputContainer.toUpperCase()}</a> · <Link to="/studio/media">在视频素材库查看</Link></p>
      {writable&&<div className="recording-apply"><h3>将实际录像加入工程</h3><p>创建独立工程或在已有工程末尾追加分镜，保留原分镜与剪辑。提词稿不自动变成已校对字幕。</p><label className="studio-check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>我确认使用此录像创建工程或追加独立分镜</label><label>录像新工程名称<input maxLength={100} value={projectName} onChange={e=>setProjectName(e.target.value)}/></label><button disabled={!confirmed||!projectName.trim()||apply.isPending} onClick={()=>apply.mutate('new_project')}>以录像建立可编辑工程</button><label>追加到已有工程<select aria-label="追加录像目标工程" value={projectId} onChange={e=>{setProjectId(e.target.value);setConfirmed(false);}}><option value="">请选择目标工程</option>{projects.data?.pages.flatMap(p=>p.items).filter(p=>!p.archived).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>{target.data&&<p>将追加到已读取v{target.data.version}的工程末尾；并发变化会拒绝旧版本。</p>}<button disabled={!confirmed||!target.data||apply.isPending} onClick={()=>apply.mutate('append')}>向目标工程追加录像分镜</button><Note error={apply.error||target.error}/>{applied&&<p role="status">已写入工程v{applied.version}：<Link to={'/studio/projects/'+applied.id}>打开录像工程</Link></p>}</div>}</>}
      <Note error={cancel.error||withdraw.error}/>{writable&&!current.withdrawn&&<button disabled={withdraw.isPending||busy} onClick={()=>{if(window.confirm('撤回此录制的制作用途吗？原片和后续派生/导出将受限，未完成处理会停止。'))withdraw.mutate();}}>撤回此录制用途</button>}
    </Box>
    <details className="recording-history"><summary>方案修订与原片规格</summary>{current.available?history.data?.map(v=><article key={v.version}><strong>v{v.version} · {v.action==='created'?'建立':v.action==='saved'?'保存':v.action==='upload_started'?'固定原片':'撤回'}</strong>{v.snapshot&&<p className="studio-preserve">{v.snapshot.scriptText}</p>}{v.unavailableReason&&<p>{v.unavailableReason}</p>}</article>):<p>{current.unavailableReason} 历史提词正文受限。</p>}{current.output&&<><p>原片SHA：<code>{current.output.inputSHA256}</code></p><p>MP4 SHA：<code>{current.output.outputSHA256}</code></p></>}<Note error={history.error}/></details>
  </>;
}
export function RecordingsPage({workspaceId,writable}:StudioProps){
  const [params,setParams]=useSearchParams(),selected=params.get('recording')||'',list=useStudioList<Recording>('studio/recordings',workspaceId,'',true),rows=list.data?.pages.flatMap(p=>p.items)||[],item=useQuery({queryKey:['recording',selected],enabled:!!selected,queryFn:()=>api<Recording>('/studio/recordings/'+selected)}),[template,setTemplate]=useState<Recording|undefined>(),[createOpen,setCreateOpen]=useState(!selected),client=useQueryClient();
  function refresh(){void list.refetch();void client.invalidateQueries({queryKey:['recording',selected]});}
  function choose(id:string){const next=new URLSearchParams(params);if(id)next.set('recording',id);else next.delete('recording');setParams(next);}
  return <div className="recordings"><div className="studio-heading"><h1>录屏、摄像头与提词器</h1><p>先保存方案，明确开启本机设备，核对原片后再上传转换为可编辑录像。</p><Link to="/studio/drafts">前往脚本与审阅计划</Link></div>
    {writable&&<details open={createOpen} onToggle={e=>setCreateOpen(e.currentTarget.open)} className="recording-create"><summary>建立新的录制方案</summary><RecordingForm key={template?template.id+'-'+template.version:'new'} workspaceId={workspaceId} template={template} onSaved={r=>{choose(r.id);setCreateOpen(false);refresh();}}/></details>}
    <Box title="我的录制与恢复"><label>选择录制方案<select aria-label="选择录制方案" value={selected} onChange={e=>choose(e.target.value)}><option value="">请选择已有方案</option>{selected&&!rows.some(r=>r.id===selected)&&<option value={selected}>正在读取指定方案</option>}{rows.map(r=><option key={r.id} value={r.id}>{r.name} · v{r.version}{r.transfer?' · '+status[r.transfer.status]:''}{r.available?'':' · 来源受限'}</option>)}</select></label><ListState query={list}/><Note error={item.error}/></Box>
    {item.data&&<RecordingDetail key={item.data.id} initial={item.data} writable={writable} onChanged={refresh} onCopy={r=>{setTemplate(r);setCreateOpen(true);window.scrollTo({top:0,behavior:'smooth'});}}/>}
  </div>;
}
