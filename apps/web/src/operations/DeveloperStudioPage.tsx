import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Code2, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { developerStudioGrantResult, developerStudioViewSchema, type DeveloperStudioAction, type DeveloperStudioView, type Me } from '@digitalguide/contracts';
import { api, ApiError } from '../api.js';
import './developer-access.css';
import './developer-studio.css';

type Application=DeveloperStudioView['apps'][number];
type Draft={app:Application;view:DeveloperStudioView;ticket:number;key:string};
const labels:Record<DeveloperStudioAction,string>={'projects.write':'读取正文、创建和编辑工程','exports.submit':'核对计划并提交导出','exports.cancel':'取消未完成的导出','exports.download':'下载当前有效的导出文件'};
const operationLabels={'project.created':'创建工程','project.saved':'编辑工程','export.created':'提交导出','export.cancelled':'取消导出','file.download_started':'开始下载文件'};
const when=(value:string)=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
export function DeveloperStudioPage({user,workspaceId}:{user:Me;workspaceId:string}){
 if(user.role!=='admin')return <section className="panel"><h1>应用制作授权</h1><p role="alert">此页面需要企业管理员权限。</p><Link to="/">返回工作空间</Link></section>;
 if(!user.developerStudioAvailable)return <section className="panel"><h1>应用制作授权</h1><p role="status">当前服务尚未开放应用制作，请使用已更新的独立服务实例。</p></section>;
 return <StudioDashboard key={[user.id,user.tenantId,user.environment,workspaceId].join(':')} user={user} workspaceId={workspaceId}/>;
}
function StudioDashboard({user,workspaceId}:{user:Me;workspaceId:string}){
 const client=useQueryClient(),queryKey=['developer-studio',user.id,user.tenantId,user.environment,workspaceId],mounted=useRef(true),blocked=useRef(false),ticket=useRef(0);
 const [draft,setDraft]=useState<Draft|null>(null),[notice,setNotice]=useState('');
 const cancel=()=>{ticket.current++;setDraft(null);};
 const denied=(error:unknown)=>{if(error instanceof ApiError&&[401,403,404].includes(error.status)){blocked.current=true;cancel();void client.invalidateQueries({queryKey:['me']});}};
 const validate=(raw:unknown)=>{const v=developerStudioViewSchema.parse(raw);if(v.tenantId!==user.tenantId||v.workspaceId!==workspaceId||v.environment!==user.environment)throw new Error('制作授权的空间或环境不符，请刷新。');return v;};
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;ticket.current++;};},[]);
 const query=useQuery({queryKey,retry:false,refetchOnWindowFocus:'always',refetchInterval:10000,queryFn:async({signal})=>{try{const v=validate(await api('/enterprise/developer-studio?'+new URLSearchParams({workspaceId}),undefined,'GET',undefined,signal));if(blocked.current)throw new Error('权限状态已变化，请重新进入工作空间。');return v;}catch(error){denied(error);throw error;}}});
 const view=!query.isError&&!blocked.current?query.data:undefined;
 const mutation=useMutation({mutationFn:async(input:{body:object;draft:Draft})=>{try{const result=developerStudioGrantResult.parse(await api('/enterprise/developer-studio/configure',input.body,'POST',undefined,undefined,input.draft.key));return{...result,view:validate(result.view),ticket:input.draft.ticket};}catch(error){denied(error);throw error;}},onSuccess:result=>{if(!mounted.current||blocked.current)return;client.setQueryData(queryKey,result.view);void client.invalidateQueries({queryKey:['developer-access']});if(result.ticket!==ticket.current)return;setDraft(null);setNotice('制作授权已保存。旧凭证已撤销，旧代次未完成的应用导出已取消；使用应用前请签发新凭证。');},onError:error=>{if(!blocked.current){void query.refetch();if(error instanceof ApiError&&[400,409].includes(error.status))cancel();}}});
 const open=(app:Application)=>{if(!view)return;mutation.reset();setNotice('');setDraft({app,view,ticket:++ticket.current,key:crypto.randomUUID()});};
 return <div className="developer-page studio-delegation-page">
  <div className="page-heading"><div><span className="eyebrow">APPLICATION STUDIO</span><h1>应用制作授权</h1><p>为服务端应用选择制作责任人、具体动作和有效期限。</p></div><div className="heading-actions"><Link to="/enterprise/developers">开发者接入与凭证</Link><button disabled={mutation.isPending||query.isFetching} onClick={()=>{cancel();void query.refetch();}}><RefreshCw size={16}/>刷新状态</button></div></div>
  <div className="developer-notice"><ShieldCheck size={21}/><div><strong>覆盖当前应用所在空间 · 每次执行检查当前权限</strong><p>正文读写、导出和下载按所选动作授权。应用以指定责任人的当前制作权限执行，所有操作同时记录应用来源；应用凭证不等于员工登录。</p><p>保存或停用委托会撤销旧凭证，并取消旧代次未完成的应用导出。重新启用或责任人恢复权限后，需要重新确认委托并签发新凭证。</p></div></div>
  {notice&&<p role="status" className="developer-success">{notice} <Link to="/enterprise/developers">去签发新凭证</Link></p>}
  {mutation.error&&<p role="alert" className="developer-error">{mutation.error instanceof Error?mutation.error.message:'结果暂未确认，请刷新核对后重试。'}</p>}
  {query.isPending&&<p role="status">正在读取应用制作授权…</p>}
  {query.error&&<section className="panel"><h2>暂时无法读取制作授权</h2><p role="alert">{query.error instanceof Error?query.error.message:'请刷新后重试。'}</p></section>}
  {view&&<>
   {!view.canManageOrganization&&<p role="status">你可以核对当前空间记录；变更需要具有全部组织空间权限的管理员。</p>}
   {!view.apps.length&&<section className="panel developer-empty"><Code2 size={28}/><h2>先创建服务端应用</h2><p>为应用授权工程或导出读取范围，再明确制作责任人和动作。</p><Link to="/enterprise/developers">前往开发者接入</Link></section>}
   <section className="developer-grid" aria-label="当前空间应用制作授权">{view.apps.map(app=>{const g=app.grant;return <article className="panel studio-delegation-app" key={app.id} data-studio-application-id={app.id}><div className="developer-row"><h2>{app.name}</h2><span className={'developer-tag'+(g?.usable?'':' muted')}>{g?.usable?'可使用':!g?'尚未授权':!g.enabled?'已停用':!app.enabled?'应用停用':!g.responsibleAuthorityCurrent?'需重新确认':Date.parse(g.expiresAt)<=Date.now()?'已到期':'当前不可用'}</span></div><code className="developer-id">应用编号 {app.id}</code>
    {g?<><p>制作责任人：<strong>{g.responsibleName}</strong></p><ul className="studio-action-list">{g.actions.map(action=><li key={action}>{labels[action]}</li>)}</ul><p className="muted">有效至 {when(g.expiresAt)} · 授权修订 {g.version}</p>{!g.responsibleAuthorityCurrent&&<p>责任人的当前权限或修订已变化，请重新核对授权。</p>}</>:<p>此应用还没有制作委托。</p>}
    {!app.enabled&&<p>应用已停用。请先在开发者接入中启用，再核对制作授权。</p>}
    {view.canManageOrganization&&<div className="developer-actions"><button disabled={mutation.isPending} onClick={()=>open(app)}>{g?'调整制作授权':'配置制作授权'}</button></div>}
   </article>;})}</section>
   <section className="panel developer-reference"><h2>制作 API</h2><p>使用独立应用 Bearer 凭证调用 <code>/api/open/v1/studio</code> 下的工程、导出计划、任务和文件接口。写入请求需要操作编号及明确确认；读取工程正文需要单独授予正文读写动作。</p><p>文件下载会重新核对当前授权、工程修订、来源和文件摘要，支持单段断点下载。旧工程修订或失效素材对应的文件不能继续下载。</p><p>当前不开放分镜预览文件、克隆训练或其他业务任务的机器接口。完整字段与约束见 <a href="/api/v1/openapi.json" target="_blank" rel="noreferrer">接口文档</a>。</p></section>
   <section className="panel"><h2>近期制作操作</h2>{!view.recentOperations.length&&<p className="muted">暂无应用制作操作。</p>}<div className="studio-operation-list">{view.recentOperations.map(op=><div key={op.id}><strong>{operationLabels[op.kind]}</strong><span>{view.apps.find(a=>a.id===op.appId)?.name??'原应用'} · {op.responsibleName}</span><small>{when(op.createdAt)}</small></div>)}</div></section>
   <section className="panel"><h2>近期授权变更</h2>{!view.recentChanges.length&&<p className="muted">暂无授权变更。</p>}{view.recentChanges.map(change=><p key={change.id}>{({created:'首次制作授权',configured:'调整制作授权',policy_disabled:'应用策略变更后停用'})[change.action]} · {view.apps.find(a=>a.id===change.appId)?.name??'原应用'} · 修订 {change.version} · {when(change.createdAt)}</p>)}</section>
  </>}
  {view&&draft&&<GrantDialog key={draft.ticket} draft={draft} current={view} busy={mutation.isPending} cancel={cancel} submit={body=>mutation.mutate({body,draft})}/>}
 </div>;
}
function GrantDialog({draft,current,busy,cancel,submit}:{draft:Draft;current:DeveloperStudioView;busy:boolean;cancel:()=>void;submit:(body:object)=>void}){
 const dialog=useRef<HTMLDialogElement>(null),g=draft.app.grant;
 const [responsible,setResponsible]=useState(g?.responsibleUserId??''),[selected,setSelected]=useState<DeveloperStudioAction[]>(g?.actions??[]),[enabled,setEnabled]=useState(g?.enabled??true),[days,setDays]=useState<7|30|90>(30),[confirmed,setConfirmed]=useState(false);
 useEffect(()=>{dialog.current?.showModal();},[]);
 const member=draft.view.members.find(m=>m.id===responsible),liveMember=current.members.find(m=>m.id===responsible),liveApp=current.apps.find(a=>a.id===draft.app.id),stale=liveApp?.version!==draft.app.version||liveApp?.grant?.version!==g?.version||(enabled&&member?.configurationToken!==liveMember?.configurationToken);
 const readDependencies=(!selected.some(a=>a==='projects.write'||a==='exports.submit')||draft.app.readScopes.includes('projects.read'))&&(!selected.some(a=>a.startsWith('exports.'))||draft.app.readScopes.includes('exports.read'));
 const valid=confirmed&&!busy&&!stale&&selected.length>0&&!!responsible&&(!enabled||!!member&&draft.app.enabled&&readDependencies);
 const save=(event:FormEvent)=>{event.preventDefault();if(!valid)return;submit({workspaceId:draft.view.workspaceId,appId:draft.app.id,expectedAppVersion:draft.app.version,expectedVersion:g?.version??0,responsibleUserId:responsible,...(member?{responsibleConfigurationToken:member.configurationToken}:{}),actions:selected,enabled,termDays:days,confirmed:true});};
 return <dialog ref={dialog} className="developer-dialog studio-grant-dialog" aria-label="配置应用制作授权" onCancel={event=>{event.preventDefault();cancel();}}><form onSubmit={save}><div className="developer-row"><h2>配置应用制作授权</h2><button type="button" aria-label="关闭制作授权配置" onClick={cancel}><X size={18}/></button></div><p><strong>{draft.app.name}</strong> · 当前空间全部工程与任务</p>
  <fieldset disabled={busy}><label>制作责任人<select aria-label="制作责任人" value={responsible} onChange={event=>{setResponsible(event.target.value);setConfirmed(false);}}><option value="">请选择责任人</option>{g&&!draft.view.members.some(m=>m.id===g.responsibleUserId)&&<option value={g.responsibleUserId}>{g.responsibleName}（当前不可用，仅可停用）</option>}{draft.view.members.map(m=><option key={m.id} value={m.id}>{m.name} · {m.role==='admin'?'管理员':'内容编辑'}</option>)}</select></label>
   <div className="studio-grant-actions" role="group" aria-label="允许的制作动作">{(Object.keys(labels) as DeveloperStudioAction[]).map(action=><label className="studio-checkbox" key={action}><input type="checkbox" checked={selected.includes(action)} onChange={event=>{setSelected(event.target.checked?[...selected,action]:selected.filter(a=>a!==action));setConfirmed(false);}}/>{labels[action]}</label>)}</div>
   <label>本次委托期限<select aria-label="本次委托期限" value={days} onChange={event=>{setDays(Number(event.target.value) as 7|30|90);setConfirmed(false);}}><option value={7}>7 天</option><option value={30}>30 天</option><option value={90}>90 天</option></select></label><label className="studio-checkbox"><input type="checkbox" checked={enabled} onChange={event=>{setEnabled(event.target.checked);setConfirmed(false);}}/>启用此制作委托</label>
   {enabled&&!readDependencies&&<p role="alert">所选动作缺少工程或导出读取范围，请先在开发者接入中配置应用。</p>}{enabled&&!draft.app.enabled&&<p role="alert">应用当前已停用，请先启用应用。</p>}{stale&&<p role="alert">应用或责任人权限已变化，请关闭后刷新，重新核对并确认。</p>}
   <p className="studio-grant-warning">保存会撤销全部旧应用凭证，并取消旧代次未完成的应用导出。委托期限从本次保存起计算；使用应用前须重新签发凭证。</p><label className="studio-checkbox"><input type="checkbox" aria-label="确认制作责任人、动作及撤销旧凭证" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>我已核对责任人、制作动作和期限，确认撤销旧凭证及旧代次未完成的导出。</label>
  </fieldset><div className="developer-actions"><button type="button" onClick={cancel}>取消</button><button className="primary" disabled={!valid} type="submit">{busy?'正在保存…':'保存制作授权'}</button></div></form></dialog>;
}
