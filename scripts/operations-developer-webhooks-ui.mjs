import fs from 'node:fs';
import assert from 'node:assert/strict';
const replace=(file,from,to)=>{const source=fs.readFileSync(file,'utf8');assert.ok(source.includes(from),file+' expected UI fragment missing');fs.writeFileSync(file,source.replace(from,to));};
replace('apps/web/src/App.tsx',"const DeveloperAccessPage=lazy(","const DeveloperWebhooksPage=lazy(()=>import('./operations/DeveloperWebhooksPage.js').then(m=>({default:m.DeveloperWebhooksPage})));\nconst DeveloperAccessPage=lazy(");
replace('apps/web/src/App.tsx','<div className="sidebar-bottom" onClick={()=>setMenuOpen(false)}>','<div className="sidebar-bottom" onClick={()=>setMenuOpen(false)}>{user.role===\'admin\'&&user.developerWebhooksAvailable&&<NavLink to="/enterprise/webhooks"><Icon icon={Code2}/>事件回调</NavLink>}');
replace('apps/web/src/App.tsx','<Route path="/enterprise/developers"','<Route path="/enterprise/webhooks" element={<DeveloperWebhooksPage user={user} workspaceId={workspaceId}/>}/><Route path="/enterprise/developers"');
replace('apps/web/src/operations/DeveloperAccessPage.tsx','<p>当前开放工程信息和制作导出状态读取。任务提交、Webhook与品牌嵌入仍在建设。</p>','<p>当前开放工程信息和制作导出状态读取。{view?.webhooksSupported&&user.developerWebhooksAvailable?<>事件回调已开放配置。<Link to="/enterprise/webhooks">管理事件回调</Link>；任务提交与品牌嵌入仍在建设。</>:<>任务提交、Webhook与品牌嵌入仍在建设。</>}</p>');
console.log(JSON.stringify({result:'WEBHOOK_MANAGEMENT_UI_WIRED_NOT_YET_VISUALLY_VERIFIED'}));
