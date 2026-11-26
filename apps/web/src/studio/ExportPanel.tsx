import { useEffect,useRef,useState } from 'react';
import { useMutation,useQuery } from '@tanstack/react-query';
import type { DeliverySettings,ExportPlan,StudioExport } from '@digitalguide/contracts';
import { api } from '../api.js';
import { Box,Note } from './shared.js';
import './export.css';
interface Props { projectId: string;version: number;durationMs: number;editable: boolean;dirty: boolean }
const statusNames = { queued: '排队中',rendering: '正在导出',succeeded: '导出完成',failed: '导出失败',cancelled: '已取消' };
const fileNames = { video: '视频',audio: '混音 WAV',srt: 'SRT 字幕',vtt: 'VTT 字幕',manifest: '规格清单',project: '工程文件',package: '工程包' };
const mb = (n: number) => n < 1024 ? n+' B' : n < 1048576 ? (n/1024).toFixed(1)+' KB' : (n/1048576).toFixed(1)+' MB';
export function ExportPanel({ projectId,version,durationMs,editable,dirty }: Props) {
  const [kind,setKind] = useState<'video'|'audio'|'package'>('video'),[settings,setSettings] = useState<DeliverySettings>({ preset: 'hd',fps: 30,transparent: false,omitBackground: false,burnSubtitles: true });
  const [full,setFull] = useState(true),[start,setStart] = useState(0),[length,setLength] = useState(Math.min(3000,durationMs)),[plan,setPlan] = useState<ExportPlan|null>(null),[confirmed,setConfirmed] = useState(false),[rights,setRights] = useState(false);
  const input = { version,kind,settings,startMs: kind === 'package' || full ? 0 : start,durationMs: kind === 'package' || full ? null : length },signature = JSON.stringify(input),latest = useRef(signature);latest.current = signature;
  useEffect(() => { setPlan(null);setConfirmed(false);setRights(false); },[signature,dirty]);
  const jobs = useQuery({ queryKey: ['studio-exports',projectId],queryFn: () => api<StudioExport[]>('/studio/projects/'+projectId+'/exports'),refetchInterval: 1500 });
  const active = jobs.data?.some(j => ['queued','rendering'].includes(j.status));
  const review = useMutation({ mutationFn: (request: { signature: string;input: typeof input }) => api<ExportPlan>('/studio/projects/'+projectId+'/export-plan',request.input),onSuccess: (result,request) => { if (request.signature === latest.current) { setPlan(result);setConfirmed(false);setRights(false); } } });
  const render = useMutation({ mutationFn: () => api<StudioExport>('/studio/projects/'+projectId+'/exports',{ version: plan!.version,kind: plan!.kind,settings: plan!.settings,startMs: plan!.startMs,durationMs: plan!.durationMs,planHash: plan!.hash,confirmed,rightsConfirmed: rights }),onSuccess: () => { setPlan(null);setConfirmed(false);setRights(false);void jobs.refetch(); } });
  const cancel = useMutation({ mutationFn: (job: StudioExport) => api('/studio/exports/'+job.id+'/cancel',{ version: job.version }),onSuccess: () => void jobs.refetch() });
  const setting = <K extends keyof DeliverySettings>(key: K,value: DeliverySettings[K]) => setSettings(s => ({ ...s,[key]: value }));
  return <Box title="成片与音频导出">
    <p>按当前保存版本合成实际文件。图片、视频、原始录音和多轨编辑会进入输出；真人动作、口型与克隆语音需使用已接通的生成服务。</p>
    {dirty && <p role="status">请等待工程保存后审阅导出计划。</p>}
    <div className="studio-inline">
      <label>导出内容<select aria-label="导出内容" value={kind} disabled={!editable || render.isPending} onChange={e => setKind(e.target.value as 'video'|'audio'|'package')}><option value="video">视频和混音</option><option value="audio">仅混音音频</option><option value="package">开放工程与源素材 ZIP</option></select></label>
      {kind === 'video' && <><label>输出分辨率<select aria-label="输出分辨率" value={settings.preset} disabled={!editable} onChange={e => setting('preset',e.target.value as 'hd'|'uhd')}><option value="hd">1080p</option><option value="uhd">4K UHD</option></select></label>
        <label>输出帧率<select aria-label="输出帧率" value={settings.fps} disabled={!editable} onChange={e => setting('fps',+e.target.value as DeliverySettings['fps'])}>{[24,25,30,60].map(fps => <option key={fps} value={fps}>{fps} 帧/秒</option>)}</select></label></>}
    </div>
    {kind === 'video' && <div className="studio-export-options">
      <label className="studio-check"><input type="checkbox" checked={settings.transparent} disabled={!editable} onChange={e => setting('transparent',e.target.checked)}/>透明视频（ProRes 4444 MOV）</label>
      <label className="studio-check"><input type="checkbox" checked={settings.omitBackground} disabled={!editable} onChange={e => setting('omitBackground',e.target.checked)}/>本次输出移除背景轨道</label>
      <label className="studio-check"><input type="checkbox" checked={settings.burnSubtitles} disabled={!editable} onChange={e => setting('burnSubtitles',e.target.checked)}/>字幕烧录到视频</label>
    </div>}
    {kind !== 'package' && <><label className="studio-check"><input type="checkbox" checked={full} disabled={!editable} onChange={e => setFull(e.target.checked)}/>导出完整工程（{(durationMs/1000).toFixed(1)} 秒）</label>
    {!full && <div className="studio-inline"><label>导出起点（秒）<input type="number" min={0} max={durationMs/1000} step={0.1} value={start/1000} disabled={!editable} onChange={e => setStart(Math.round(+e.target.value*1000))}/></label><label>导出时长（秒）<input type="number" min={0.1} max={Math.max(0.1,(durationMs-start)/1000)} step={0.1} value={length/1000} disabled={!editable} onChange={e => setLength(Math.round(+e.target.value*1000))}/></label></div>}</>}
    {kind === 'package' && <p>导出完整开放工程、清单和已授权源素材；不包含账号、供应商模型、克隆记录或原PPT/PDF处理绑定。目标空间可从“工程迁移”导入ZIP。</p>}
    <button disabled={!editable || dirty || review.isPending || render.isPending} onClick={() => review.mutate({ signature,input })}>{review.isPending ? '正在核对输出计划…' : '审阅成片导出计划'}</button>
    <Note error={review.error || render.error || cancel.error || jobs.error}/>
    {plan && <div className="studio-export-plan">
      <p>{plan.kind === 'video' ? `${plan.width} × ${plan.height} · ${plan.fps} 帧/秒 · ${plan.alpha ? 'ProRes 4444 / Alpha' : 'H.264 / MP4'}` : plan.kind === 'package' ? '开放工程 ZIP · 脚本 / 多轨 / 源素材' : '48 kHz · 双声道 · 16 位 PCM WAV'} · {(plan.durationMs/1000).toFixed(1)} 秒</p>
      <p>预估主文件 {mb(plan.estimatedBytes)}，{plan.kind === 'package' ? 'ZIP及展开内容上限1 GB，最多1000项源素材。另提供工程JSON和素材清单。' : '实际大小取决于内容；本地单文件上限32 GB。另提供 WAV、SRT/VTT 和规格清单。'}</p>
      {plan.warnings.map((w,i) => <p className="studio-warning" key={i}>{w}</p>)}
      <details><summary>查看源素材规格（{plan.sourceSpecs.length} 项）</summary><ul>{plan.sourceSpecs.map(a => <li key={a.id}>{a.name} · {a.mediaType} · {a.specs.width ? `${a.specs.width} × ${a.specs.height}` : `${a.specs.sampleRate || 0} Hz`}</li>)}</ul></details>
      <label className="studio-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/>已审阅输出规格、保存版本与素材限制</label>
      <label className="studio-check"><input type="checkbox" checked={rights} onChange={e => setRights(e.target.checked)}/>确认拥有本次导出所需的素材使用权限</label>
      <button className="primary" disabled={!editable || dirty || !plan.canExport || !confirmed || !rights || active || render.isPending} onClick={() => render.mutate()}>确认并开始本地导出</button>
    </div>}
    {jobs.data?.length === 0 && <p>尚无成片导出。生成后可在这里查看进度和下载文件。</p>}
    {jobs.data?.map(job => <article className="studio-export-job" key={job.id}><p>{statusNames[job.status]} · 工程版本 {job.version} · {Math.round(job.progress*100)}%</p>
      {['queued','rendering'].includes(job.status) && <progress aria-label="成片导出进度" value={job.progress} max={1}/>}
      {job.errorMessage && <p role="alert" className="error">{job.errorMessage}</p>}
      {job.warnings.length > 0 && <details><summary>输出说明</summary>{job.warnings.map((w,i) => <p className="studio-warning" key={i}>{w}</p>)}</details>}
      <div className="studio-export-files">{job.artifacts.map(file => file.url ? <a key={file.id} href={file.url} download={file.name}>下载{fileNames[file.kind]}（{mb(file.size)}）</a> : <span key={file.id}>{fileNames[file.kind]} · 当前不可下载</span>)}</div>
      {editable && ['queued','rendering'].includes(job.status) && <button disabled={cancel.isPending} onClick={() => cancel.mutate(job)}>取消成片导出</button>}
    </article>)}
  </Box>;
}
