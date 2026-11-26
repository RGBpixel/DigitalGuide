import { useEffect,useState } from 'react';
import { useMutation,useQuery } from '@tanstack/react-query';
import type { ContentDraft,ContentPlan,ContentPlanPatch } from '@digitalguide/contracts';
import { api } from '../api.js';
import { Box,Note } from './shared.js';
import { useContentProject } from './ContentDraftCreate.js';
const kinds={draft_edit:'局部修改草稿',new_project:'建立新工程',project_patch:'替换工程所选台词'};
const statuses={review:'待审阅',applied:'已应用',cancelled:'已取消'};
export function ContentPlanComposer({workspaceId,draft,selectedIds,disabled,onCreated}:{workspaceId:string;draft:ContentDraft;selectedIds:string[];disabled:boolean;onCreated:(plan:ContentPlan)=>void}){
  const [kind,setKind]=useState<ContentPlan['kind']>('draft_edit'),[name,setName]=useState('本次修改计划'),[operation,setOperation]=useState('instruction'),[instruction,setInstruction]=useState('请精简所选段落'),[replacements,setReplacements]=useState<Record<string,string>>({}),[projectName,setProjectName]=useState(draft.name+' · 工程'),[layout,setLayout]=useState('landscape'),[mappings,setMappings]=useState<Record<string,string>>({}),[confirmed,setConfirmed]=useState(false);
  const target=useContentProject(workspaceId,draft.payload?.originProject?.id),sections=draft.payload?.sections.filter(s=>selectedIds.includes(s.id))||[];
  useEffect(()=>setConfirmed(false),[selectedIds,target.snapshot?.id,target.snapshot?.version]);
  const create=useMutation({mutationFn:()=>{
    const common={draftVersion:draft.version,name,kind,confirmed:true};
    if(kind==='new_project')return api<ContentPlan>('/studio/content/drafts/'+draft.id+'/plans',{...common,projectName,layout});
    if(kind==='project_patch'){
      if(!target.snapshot)throw new Error('请先载入当前目标工程。');
      return api<ContentPlan>('/studio/content/drafts/'+draft.id+'/plans',{...common,projectId:target.snapshot.id,projectVersion:target.snapshot.version,mappings:sections.map(s=>({sectionId:s.id,segmentId:mappings[s.id]||''}))});
    }
    return api<ContentPlan>('/studio/content/drafts/'+draft.id+'/plans',{...common,operation,sectionIds:selectedIds,instruction,replacements:operation==='replace'?sections.map(s=>({sectionId:s.id,text:replacements[s.id]??s.text})):[]});
  },onSuccess:p=>{setConfirmed(false);onCreated(p);}});
  return <Box title="先审阅，再应用"><form className="content-form" onSubmit={e=>{e.preventDefault();create.mutate();}}><fieldset disabled={disabled||create.isPending}>
    <label>计划用途<select aria-label="计划用途" value={kind} onChange={e=>{setKind(e.target.value as ContentPlan['kind']);setConfirmed(false);}}>{Object.entries(kinds).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    <label>计划名称<input value={name} maxLength={100} required onChange={e=>setName(e.target.value)}/></label>
    {kind==='new_project'?<><label>新工程名称<input value={projectName} maxLength={100} required onChange={e=>setProjectName(e.target.value)}/></label><label>工程画幅<select aria-label="工程画幅" value={layout} onChange={e=>setLayout(e.target.value)}><option value="landscape">横屏16:9</option><option value="portrait">竖屏9:16</option><option value="square">方形1:1</option></select></label><p className="form-help">采用草稿全部段落建立独立工程，不改已有作品。先核对新稿，再配置形象、声音和画面。</p></>:<>
      <p>已选{sections.length}段，请从左侧勾选要处理的段落。</p>
      {kind==='project_patch'?<>{target.control}{sections.map(s=><label key={s.id}>{s.title} → 目标分镜<select aria-label={'目标分镜：'+s.title} required value={mappings[s.id]||''} onChange={e=>{setMappings({...mappings,[s.id]:e.target.value});setConfirmed(false);}}><option value="">请选择对应分镜</option>{target.snapshot?.document.segments.map(segment=><option key={segment.id} value={segment.id}>{segment.title}</option>)}</select></label>)}<p className="form-help">只替换映射分镜台词，保留其时长和画面。相关旧配音与手工字幕会保留并静音；无关分镜和片段保持。</p></>:<>
        <label>修改方式<select aria-label="修改方式" value={operation} onChange={e=>{setOperation(e.target.value);setConfirmed(false);}}><option value="instruction">文字指令（声明支持的规则）</option><option value="normalize">规范空白（规则）</option><option value="shorten">保留前半句组（规则）</option><option value="replace">逐段填写替换文字</option><option value="mock_rewrite">明确模拟语义改写</option><option value="external_rewrite">真实改写模型（尚未配置）</option></select></label>
        {operation==='replace'?sections.map(s=><label key={s.id}>{s.title}的新文字<textarea aria-label={'替换文字：'+s.title} rows={4} maxLength={4000} value={replacements[s.id]??s.text} onChange={e=>{setReplacements({...replacements,[s.id]:e.target.value});setConfirmed(false);}}/></label>):<label>修改要求<textarea aria-label="修改要求" rows={3} maxLength={1000} value={instruction} onChange={e=>{setInstruction(e.target.value);setConfirmed(false);}}/></label>}
        <p className="form-help">规则指令支持“规范空白”“请精简所选段落”和单段“替换为：新文字”。精简可能删减信息，必须审阅；其他语义要求不会被猜测执行。</p>
      </>}
    </>}
    <label className="checkbox-line"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>我已核对当前已保存草稿与目标范围，只生成待审阅计划</label>
    <button className="button primary" disabled={!confirmed||create.isPending||(kind!=='new_project'&&!sections.length)||(kind==='project_patch'&&(!target.snapshot||target.changed||sections.some(s=>!mappings[s.id])))}>生成前后对照计划</button>
  </fieldset><Note error={create.error}/></form></Box>;
}
export function ContentPlanReview({id,writable,editorDirty,onApplied}:{id:string;writable:boolean;editorDirty:boolean;onApplied:()=>void}){
  const live=useQuery({queryKey:['content-plan',id],queryFn:()=>api<ContentPlan>('/studio/content/plans/'+id),refetchInterval:3000});
  const [loaded,setLoaded]=useState<ContentPlan|null>(null),[patches,setPatches]=useState<ContentPlanPatch[]>([]),[dirty,setDirty]=useState(false),[confirmed,setConfirmed]=useState(false);
  function load(p:ContentPlan){setLoaded(p);setPatches(p.patches||[]);setDirty(false);setConfirmed(false);}
  useEffect(()=>{if(!loaded&&live.data)load(live.data);},[loaded,live.data]);
  const conflict=!!loaded&&!!live.data&&live.data.version>loaded.version,history=useQuery({queryKey:['content-plan-history',id,live.data?.version],queryFn:()=>api<{version:number;planHash:string;patches:ContentPlanPatch[]|null;sourceReason:string|null}[]>('/studio/content/plans/'+id+'/versions')});
  const save=useMutation({mutationFn:()=>api<ContentPlan>('/studio/content/plans/'+id+'/save',{version:loaded!.version,patches:patches.map(p=>({sectionId:p.sectionId,afterText:p.afterText}))}),onSuccess:p=>{load(p);void live.refetch();}});
  const apply=useMutation({mutationFn:()=>api<ContentPlan>('/studio/content/plans/'+id+'/apply',{version:loaded!.version,planHash:loaded!.planHash,acknowledgeMutedMedia:true,confirmed:true}),onSuccess:p=>{load(p);void live.refetch();onApplied();}});
  const cancel=useMutation({mutationFn:()=>api<ContentPlan>('/studio/content/plans/'+id+'/cancel',{version:live.data!.version,confirmed:true}),onSuccess:p=>{load(p);void live.refetch();}});
  if(!loaded)return <><p role="status">正在载入计划…</p><Note error={live.error}/></>;
  const current=live.data&&live.data.version>=loaded.version?live.data:loaded,closed=current.status!=='review',unavailable=!current.sourceAvailable,disabled=!writable||closed||conflict||!!current.staleReason||unavailable||editorDirty||save.isPending||apply.isPending||cancel.isPending;
  return <section className="content-form draft-plan-review" aria-label="内容计划审阅"><div className="content-summary"><strong>{loaded.name} · v{loaded.version}</strong><span>{kinds[loaded.kind]} · {statuses[current.status]}{loaded.simulated?' · 明确模拟内容':''}</span></div>
    {conflict&&<p className="error">计划已有新修订，当前审阅输入保留。<button onClick={()=>load(current)}>放弃审阅输入并载入当前计划</button></p>}
    {current.sourceReason&&<p className="error">{current.sourceReason}</p>}{current.staleReason&&<p className="error">{current.staleReason}</p>}{editorDirty&&<p className="form-help">草稿有未保存输入，先保存或载入当前草稿后再应用计划。</p>}
    {current.warnings.map((w,i)=><p className="form-help" key={i}>{w}</p>)}
    {!unavailable&&patches.map((patch,index)=><article className="draft-diff" key={patch.sectionId}><h3>{patch.title}</h3><p className="form-help">原文字</p><pre className="content-text">{patch.beforeText??'新建内容，无原文字'}</pre><label>审阅后的新文字<textarea aria-label={'计划新文字 '+(index+1)} rows={5} maxLength={4000} disabled={disabled} value={patch.afterText} onChange={e=>{setPatches(items=>items.map(x=>x.sectionId===patch.sectionId?{...x,afterText:e.target.value}:x));setDirty(true);setConfirmed(false);}}/></label></article>)}
    {!unavailable&&<details><summary>计划哈希与修订</summary><p className="content-hash">{loaded.planHash}</p>{history.data?.map(v=><div key={v.version} className="content-history"><strong>v{v.version}</strong>{v.patches?.map(p=><p className="studio-preserve" key={p.sectionId}>{p.afterText}</p>)}{v.sourceReason&&<p>{v.sourceReason}</p>}</div>)}<Note error={history.error}/></details>}
    {!closed&&<><button disabled={disabled||!dirty} onClick={()=>save.mutate()}>保存审阅修改</button><label className="checkbox-line"><input type="checkbox" disabled={disabled||dirty} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>我已核对文字、来源及影响范围，确认应用；相关旧配音需要重新生成</label><button className="button primary" disabled={disabled||dirty||!confirmed} onClick={()=>apply.mutate()}>确认应用当前计划</button><button disabled={!writable||cancel.isPending||apply.isPending} onClick={()=>cancel.mutate()}>取消此计划</button></>}
    {current.status==='applied'&&<p className="draft-success">已写入{current.kind==='draft_edit'?'草稿':'工程'}v{current.appliedResourceVersion}。{current.kind==='draft_edit'?'载入草稿当前版本后继续编辑。':<><a href={'/studio/projects/'+current.appliedResourceId}>打开可编辑工程</a> · <a href={'/studio/voice?project='+current.appliedResourceId}>打开语气与配音，重新生成所选分镜声音</a></>}</p>}
    <Note error={save.error||apply.error||cancel.error||live.error}/>
  </section>;
}
