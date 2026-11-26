import {useState} from 'react';
import {useInfiniteQuery,useMutation,useQueryClient} from '@tanstack/react-query';
import type {Page,ReceptionHost,ReceptionHostCandidate} from '@digitalguide/contracts';
import {api} from '../api.js';
import './reception-hosts.css';

export function ReceptionHostsPanel({workspaceId}:{workspaceId:string}){
 const client=useQueryClient(),[editing,setEditing]=useState<ReceptionHost|null>(null),[alias,setAlias]=useState(''),[recipientId,setRecipientId]=useState(''),[enabled,setEnabled]=useState(true),[notice,setNotice]=useState('');
 const hosts=useInfiniteQuery({queryKey:['reception-hosts',workspaceId],initialPageParam:'',queryFn:({pageParam})=>api<Page<ReceptionHost>>('/reception-hosts?workspaceId='+workspaceId+'&limit=30'+(pageParam?'&cursor='+pageParam:'')),getNextPageParam:p=>p.nextCursor??undefined,refetchInterval:q=>q.state.error?false:5000,retry:false});
 const candidates=useInfiniteQuery({queryKey:['reception-host-candidates',workspaceId],initialPageParam:'',queryFn:({pageParam})=>api<Page<ReceptionHostCandidate>>('/reception-hosts/candidates?workspaceId='+workspaceId+'&limit=30'+(pageParam?'&cursor='+pageParam:'')),getNextPageParam:p=>p.nextCursor??undefined,retry:false});
 const rows=hosts.error?[]:hosts.data?.pages.flatMap(p=>p.items)??[],members=candidates.error?[]:candidates.data?.pages.flatMap(p=>p.items)??[];
 const unavailable=!!hosts.error||!!candidates.error,loading=hosts.isPending||candidates.isPending;
 function reset(){setEditing(null);setAlias('');setRecipientId('');setEnabled(true);}
 const save=useMutation({mutationFn:()=>api<ReceptionHost>(editing?'/reception-hosts/'+editing.id+'/update':'/reception-hosts',{...(editing?{version:editing.version}:{workspaceId}),alias,recipientId,enabled}),onSuccess:async row=>{setNotice('已保存“'+row.alias+'”，'+(row.enabled?'可用于后续来访匹配。':'当前已停用。'));reset();await client.invalidateQueries({queryKey:['reception-hosts',workspaceId]});},onError:()=>{void hosts.refetch();void candidates.refetch();}});
 function edit(row:ReceptionHost){setEditing(row);setAlias(row.alias);setRecipientId(row.recipientId);setEnabled(row.enabled);setNotice('');save.reset();}
 return <section className="panel reception-hosts" aria-label="受访人配置"><div className="section-heading"><div><h2>受访人配置</h2><span>配置可填写的称呼和实际接待账号，账号列表仅管理员可见。</span></div><button className="text-button" type="button" disabled={save.isPending} onClick={()=>{void hosts.refetch();void candidates.refetch();}}>刷新配置</button></div>
  {loading?<p className="host-help" role="status">正在载入受访人配置…</p>:unavailable?<p className="error" role="alert">{hosts.error?.message??candidates.error?.message} 请刷新配置；权限恢复前不能继续保存。</p>:<>
   {rows.length?<div className="table-scroll"><table><thead><tr><th>访客填写的称呼</th><th>接待账号</th><th>状态</th><th>操作</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td>{row.alias}</td><td>{row.recipientName}</td><td>{row.enabled?'已启用':row.disabledReason==='member_scope_withdrawn'?'账号权限变化，已停用':'已停用'}</td><td><button className="text-button" type="button" disabled={save.isPending} onClick={()=>edit(row)}>修改 {row.alias}</button></td></tr>)}</tbody></table></div>:<p className="host-help">还没有受访人配置。先选择接待账号并保存一个称呼。</p>}
   {hosts.hasNextPage&&<button className="button secondary host-more" disabled={hosts.isFetchingNextPage} onClick={()=>void hosts.fetchNextPage()}>加载更多受访人</button>}
   <form className="host-form" onSubmit={e=>{e.preventDefault();setNotice('');save.mutate();}} aria-label={editing?'修改受访人':'新增受访人'}><h3>{editing?'修改受访人':'新增受访人'}</h3><div className="host-fields"><label>访客填写的称呼<input required maxLength={40} value={alias} onChange={e=>setAlias(e.target.value)} disabled={save.isPending}/></label><label>实际接待账号<select required value={recipientId} onChange={e=>setRecipientId(e.target.value)} disabled={save.isPending}><option value="">请选择有接待权限的成员</option>{recipientId&&!members.some(m=>m.id===recipientId)&&<option value={recipientId} disabled>原接待账号不可用，请重新选择</option>}{members.map(member=><option key={member.id} value={member.id}>{member.name}</option>)}</select></label></div>
    {candidates.hasNextPage&&<button className="text-button" type="button" disabled={candidates.isFetchingNextPage} onClick={()=>void candidates.fetchNextPage()}>加载更多可选账号</button>}
    {!members.length&&<p className="host-help">当前空间没有可选接待账号，请先由管理员配置成员权限。</p>}
    <label className="host-enabled"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)} disabled={save.isPending}/>启用此受访人称呼</label><p className="host-help">更改称呼、账号或启用状态会使旧配置授权失效。成员离开工作空间或失去接待权限后会自动停用，重新加入后需明确保存新配置。</p>
    <div className="host-buttons"><button className="button primary" disabled={save.isPending||!alias.trim()||!members.some(m=>m.id===recipientId)}>{save.isPending?'正在保存…':editing?'保存受访人修改':'保存受访人'}</button>{editing&&<button type="button" className="button secondary" disabled={save.isPending} onClick={()=>{reset();save.reset();}}>取消修改</button>}</div>
   </form>
  </>}
  {save.error&&<p className="error" role="alert">{save.error.message}</p>}{notice&&<p className="host-notice" role="status">{notice}</p>}
 </section>;
}
