import {useEffect,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {Link} from 'react-router-dom';
import {RefreshCw,ShieldCheck,UsersRound,Timer,Check} from 'lucide-react';
import {enterprisePlanViewSchema,type EnterprisePlanView,type Me} from '@digitalguide/contracts';
import {api,ApiError} from '../api.js';
import './enterprise-plans.css';

const when=(value:string)=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
export function EnterprisePlansPage({user,workspaceId}:{user:Me;workspaceId:string}){
 if(user.role!=='admin')return <section className="panel"><h1>套餐与席位</h1><p role="alert">当前账号没有套餐管理权限，请联系企业管理员。</p><Link to="/">返回工作空间</Link></section>;
 if(!user.enterprisePlansAvailable)return <section className="panel"><h1>套餐与席位</h1><p role="status">当前服务尚未开放套餐管理，请使用已更新的服务实例。</p></section>;
 return <PlanDashboard key={user.id+':'+user.tenantId+':'+workspaceId} user={user} workspaceId={workspaceId}/>;
}
function PlanDashboard({user,workspaceId}:{user:Me;workspaceId:string}){
 const client=useQueryClient(),queryKey=['enterprise-plans',user.id,user.tenantId,workspaceId],validate=(raw:unknown)=>{const view=enterprisePlanViewSchema.parse(raw);if(view.tenantId!==user.tenantId||view.workspaceId!==workspaceId)throw new Error('套餐状态的工作空间不符，请刷新核对。');return view;};
 const query=useQuery({queryKey,enabled:!!workspaceId,queryFn:async({signal})=>validate(await api<unknown>('/enterprise/plans?'+new URLSearchParams({workspaceId}),undefined,'GET',undefined,signal)),retry:false,refetchOnWindowFocus:'always',refetchInterval:30000});
 const[selected,setSelected]=useState<EnterprisePlanView['catalog'][number]['id']>('sandbox_team'),[days,setDays]=useState<7|30|90>(30),[confirmed,setConfirmed]=useState(false),[notice,setNotice]=useState('');
 const mutation=useMutation({mutationFn:async(input:{action:'assign'|'seats';body:object})=>{const result=await api<{receiptId:string;view:unknown}>('/enterprise/plans/'+input.action,input.body);return validate(result.view);},onSuccess:view=>{client.setQueryData(queryKey,view);setConfirmed(false);setNotice('变更已保存，当前套餐与席位状态已更新。');void client.invalidateQueries({queryKey:['operations-metrics']});},onError:()=>{setConfirmed(false);void query.refetch();}});
 useEffect(()=>{const error=query.error??mutation.error;if(error instanceof ApiError&&[401,403,404].includes(error.status))void client.invalidateQueries({queryKey:['me']});},[query.error,mutation.error,client]);
 const view=!query.isError&&!(mutation.error instanceof ApiError&&[401,403,404].includes(mutation.error.status))?query.data:undefined,plan=view?.catalog.find(plan=>plan.id===view.assignment?.planId),choice=view?.catalog.find(plan=>plan.id===selected),busy=mutation.isPending||query.isFetching,canWrite=!!view?.writesAvailable&&!busy;
 const submit=()=>{if(!view||!confirmed||!canWrite)return;setNotice('');mutation.mutate({action:'assign',body:{workspaceId,planId:selected,expectedRevision:view.revision,termDays:days,confirmSandboxPolicy:true}});};
 const seat=(member:EnterprisePlanView['members'][number])=>{if(!view||!canWrite)return;setNotice('');mutation.mutate({action:'seats',body:{workspaceId,userId:member.userId,expectedRevision:view.revision,action:member.allocated?'release':'assign'}});};
 return <div className="enterprise-page">
  <div className="page-heading"><div><span className="eyebrow">ENTERPRISE CAPACITY</span><h1>套餐与席位</h1><p>为团队分配制作席位，核对核心任务权益与每日额度。</p></div><div className="heading-actions"><button onClick={()=>void query.refetch()} disabled={busy}><RefreshCw size={16}/>刷新状态</button></div></div>
  <div className="enterprise-notice"><ShieldCheck size={20}/><div><strong>沙箱策略 · 不产生费用</strong><p>仅影响新提交的核心供应商任务。席位不会授予登录、工作空间或管理权限，历史任务仍可查看和取消。正式订阅尚未接入。</p></div></div>
  {notice&&<p role="status" className="enterprise-success">{notice}</p>}
  {mutation.error&&<p role="alert" className="enterprise-failure">{mutation.error instanceof Error?mutation.error.message:'变更未确认，请刷新核对当前状态。'}</p>}
  {query.isPending&&<p role="status">正在读取套餐与席位…</p>}
  {query.error&&<section className="panel enterprise-failure"><h2>暂时无法读取套餐</h2><p role="alert">{query.error instanceof Error?query.error.message:'请刷新后重试。'}</p></section>}
  {view&&<>
   <section className="enterprise-stats" aria-label="当前套餐状态">
    <article className="panel"><ShieldCheck size={18}/><span>当前套餐</span><strong>{plan?.name??'尚未分配'}</strong><p>{view.status==='expired'?'已到期，新的核心任务暂停接收':view.assignment?'有效至 '+when(view.assignment.expiresAt):'沿用原有任务安全上限，尚未启用席位限制'}</p></article>
    <article className="panel"><UsersRound size={18}/><span>组织制作席位</span><strong>{view.seats.allocated}<small> / {view.seats.limit??'未设置'}</small></strong><p>组织共享；成员列表只显示本空间可管理人员。</p></article>
    <article className="panel"><Timer size={18}/><span>今日核心任务</span><strong>{view.quota.coreJobsToday}<small> / {view.quota.effectiveDailyLimit}</small></strong><p>UTC自然日；组织安全上限 {view.quota.legacySafetyDailyLimit}。<Link to="/operations">查看运营记录</Link></p></article>
   </section>
   <section className="panel enterprise-policy"><div className="section-heading"><div><h2>分配或续期沙箱套餐</h2><p>变更前核对席位与权益；已分配席位不会自动释放。</p></div><span className="enterprise-revision">版本 {view.revision}</span></div>
    <fieldset className="enterprise-catalog" disabled={!canWrite}><legend>选择沙箱套餐</legend>{view.catalog.map(item=><label key={item.id} className={selected===item.id?'selected':''}><input type="radio" name="enterprise-plan" value={item.id} checked={selected===item.id} onChange={()=>{setSelected(item.id);setConfirmed(false);mutation.reset();}}/><strong>{item.name}</strong><span>{item.seatLimit} 个制作席位</span><b>{item.dailyCoreTaskLimit} 次 / 日<small>仍受组织安全上限约束</small></b><span><Check size={14}/>供应商检查</span><span>{item.avatarTraining?'包含模拟形象训练':'未含形象训练权益'}</span><span>{item.voiceTraining?'包含模拟声音训练':'未含声音训练权益'}</span></label>)}</fieldset>
    <div className="enterprise-confirmation"><label>有效时长<select aria-label="套餐有效时长" value={days} disabled={!canWrite} onChange={event=>{setDays(Number(event.target.value) as 7|30|90);setConfirmed(false);}}>{[7,30,90].map(day=><option key={day} value={day}>{day} 天</option>)}</select></label><p>{choice?.name}：组织最多 {choice?.seatLimit} 个席位。当前管理员将保有或获得一个制作席位；有效期从本次保存起计算。</p><label className="enterprise-checkbox"><input type="checkbox" checked={confirmed} disabled={!canWrite} onChange={event=>setConfirmed(event.target.checked)}/>我已核对沙箱套餐与席位，确认影响新提交的核心任务。</label><button className="primary" disabled={!canWrite||!confirmed} onClick={submit}>{mutation.isPending?'正在保存…':'确认分配 / 续期'}</button></div>
    {!view.writesAvailable&&<p role="status">当前环境未开放沙箱套餐变更，请联系管理员配置正式接入。</p>}
   </section>
   <section className="panel enterprise-members"><div className="section-heading"><div><h2>本空间制作席位</h2><p>编辑和管理员可分配席位；只读与审核成员沿用原有权限。</p></div></div><table aria-label="制作席位成员"><thead><tr><th>成员</th><th>角色</th><th>席位</th><th>操作</th></tr></thead><tbody>{view.members.map(member=><tr key={member.userId}><td>{member.name}{member.userId===user.id&&<small> 当前账号</small>}</td><td>{member.role?{admin:'管理员',editor:'内容编辑',viewer:'只读成员',reviewer:'审核成员'}[member.role]:'已离开本空间'}</td><td>{member.allocated?'已分配':'未分配'}</td><td>{member.allocated?<button disabled={!canWrite} aria-label={'为'+member.name+'释放席位'} onClick={()=>seat(member)}>释放席位</button>:member.eligible?<button disabled={!canWrite||view.status!=='active'} aria-label={'为'+member.name+'分配席位'} onClick={()=>seat(member)}>分配席位</button>:<span className="muted">无需制作席位</span>}</td></tr>)}</tbody></table>{view.membersTruncated&&<p role="status">当前仅显示前200名成员，请联系管理员核对完整成员清单。</p>}</section>
   <section className="panel enterprise-history"><h2>本空间最近变更</h2>{!view.recentChanges.length?<p>暂无套餐或席位变更。</p>:<ol>{view.recentChanges.map(change=><li key={change.id}><strong>{{'plan.assign':'分配 / 续期套餐','seat.assign':'分配制作席位','seat.release':'释放制作席位'}[change.action]}</strong><span>版本 {change.revision} · {when(change.createdAt)}</span></li>)}</ol>}<p className="enterprise-caption">状态采集于 {when(view.capturedAt)}。这里显示沙箱授权记录，不是已购买席位或正式账单。</p></section>
  </>}
 </div>;
}
