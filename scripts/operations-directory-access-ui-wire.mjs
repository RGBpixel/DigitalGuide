import fs from 'node:fs';
import assert from 'node:assert/strict';
const file='apps/web/src/operations/EnterpriseDirectoryPage.tsx';let source=fs.readFileSync(file,'utf8');
function change(from,to){assert.ok(source.includes(from),'Expected directory UI fragment missing');source=source.replace(from,()=>to);}
source="import {DirectoryGroupAccessPanel} from './DirectoryGroupAccessPanel.js';\n"+source;
change("key={user.id+':'+user.tenantId+':'+workspaceId}","key={user.id+':'+user.tenantId+':'+user.role+':'+workspaceId+':'+user.workspaces.map(space=>space.id).sort().join('/')}");
change("[notice,setNotice]=useState(''),live=useRef(true);","[notice,setNotice]=useState(''),[moduleDenied,setModuleDenied]=useState<Error|null>(null),authorityEpoch=useRef(0),live=useRef(true),scopeIdentity=user.workspaces.map(space=>space.id).sort().join('/');");
change("connectorId,'members']","connectorId,'members',scopeIdentity]");change("connectorId,'groups']","connectorId,'groups',scopeIdentity]");change("enabled:!!connectorId&&!query.isError&&!!query.data","enabled:!!connectorId&&!moduleDenied&&!query.isError&&!!query.data");
change("data=query.isError||accessError?undefined:query.data?.pages[0]","candidate=query.data?.pages[0],scopeValid=!candidate||candidate.workspaces.every(space=>user.workspaces.some(known=>known.id===space.id)),data=query.isError||accessError||moduleDenied||!scopeValid?undefined:candidate");
change("if(accessError){setSelection(null);setNotice('');void client.invalidateQueries({queryKey:['me']});}","if(accessError)authorityFailed(accessError);");
change(" function refresh(){setSelection(null);setNotice('');void query.refetch();if(connectorId)void groups.refetch();}",` function authorityFailed(error:Error){authorityEpoch.current++;setModuleDenied(error);setSelection(null);setNotice('');void client.cancelQueries({queryKey:['enterprise-directory']});void client.invalidateQueries({queryKey:['me']});}
 async function refresh(){const epoch=++authorityEpoch.current;setSelection(null);setNotice('');const [current,currentGroups]=await Promise.all([query.refetch(),connectorId?groups.refetch():Promise.resolve(null)]);if(live.current&&epoch===authorityEpoch.current&&!current.isError&&(!currentGroups||!currentGroups.isError))setModuleDenied(null);}`);
change("  {query.isPending&&<p role=\"status\">", "  {moduleDenied&&!query.error&&<p role=\"alert\" className=\"directory-error\">{moduleDenied.message} 请刷新后重新核对当前权限。</p>}\n  {query.isPending&&<p role=\"status\">");
const end="{groups.hasNextPage&&<button disabled={busy} onClick={()=>void groups.fetchNextPage()}>加载更多同步用户组</button>}</section></>}";
change(end,"{groups.hasNextPage&&<button disabled={busy} onClick={()=>void groups.fetchNextPage()}>加载更多同步用户组</button>}</section>{user.enterpriseDirectoryGroupAccessAvailable&&data.groupAccessAvailable&&<DirectoryGroupAccessPanel user={user} view={data} connector={connector} refreshing={busy} saved={message=>setNotice(message)} denied={authorityFailed}/>}</>}");
change('用户组来自企业目录，本页只读；成员计数不代表平台权限。','用户组成员由企业目录维护，成员计数不代表平台权限。');
change('复核后采用下列固定权限。目录期望停用时仍保持停用，已经撤销的登录不会复活。','复核后采用基础与有效组映射的完整权限。目录期望停用时仍保持停用，已经撤销的登录不会复活。');
change("'group.delete':'删除用户组'","'group.delete':'删除用户组','group.access.enable':'启用组空间映射','group.access.update':'调整组空间映射','group.access.disable':'停用组空间映射','group.access.retire':'来源删除后收回映射','member.group_access':'核对成员组权限'");fs.writeFileSync(file,source);
const panel='apps/web/src/operations/DirectoryGroupAccessPanel.tsx';source=fs.readFileSync(panel,'utf8');const key="connector.id,'group-access'];";assert.ok(source.includes(key));source=source.replace(key,"connector.id,'group-access',user.workspaces.map(space=>space.id).sort().join('/')];");fs.writeFileSync(panel,source);
