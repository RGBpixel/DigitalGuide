import fs from 'node:fs';
import assert from 'node:assert/strict';
function edit(file,a,b){const s=fs.readFileSync(file,'utf8');if(s.includes(b))return;assert.ok(s.includes(a),file);fs.writeFileSync(file,s.replace(a,()=>b));}
edit('packages/contracts/src/index.ts','export interface Me { enterpriseIdentityAvailable?','export interface Me { enterpriseMembersAvailable?:boolean;enterpriseIdentityAvailable?');
edit('apps/api/src/app.ts','enterpriseIdentityAvailable:!config.recoveryValidationOnly','enterpriseMembersAvailable:!config.recoveryValidationOnly,enterpriseIdentityAvailable:!config.recoveryValidationOnly');
edit('apps/api/src/postgres-core-app.ts','enterpriseIdentityAvailable:true','enterpriseMembersAvailable:true,enterpriseIdentityAvailable:true');
edit('apps/web/src/App.tsx','const EnterpriseIdentityPage=lazy(',"const EnterpriseMembersPage=lazy(()=>import('./operations/EnterpriseMembersPage.js').then(m=>({default:m.EnterpriseMembersPage})));\nconst EnterpriseIdentityPage=lazy(");
edit('apps/web/src/App.tsx',"{user.role==='admin'&&user.enterpriseIdentityAvailable&&<NavLink", "{user.role==='admin'&&user.enterpriseMembersAvailable&&<NavLink to=\"/enterprise/members\"><Icon icon={UsersRound}/>组织成员</NavLink>}{user.role==='admin'&&user.enterpriseIdentityAvailable&&<NavLink");
edit('apps/web/src/App.tsx','<Route path="/enterprise/identity"', '<Route path="/enterprise/members" element={<EnterpriseMembersPage user={user} workspaceId={workspaceId}/>}/><Route path="/enterprise/identity"');
console.log('Member management page and explicit API capability flag connected.');
