import fs from 'node:fs';
import assert from 'node:assert/strict';
const file='apps/web/src/App.tsx';let s=fs.readFileSync(file,'utf8');for(const[from,to]of [
 ["const OperationsPage=lazy(","const EnterprisePlansPage=lazy(()=>import('./operations/EnterprisePlansPage.js').then(m=>({default:m.EnterprisePlansPage})));\nconst OperationsPage=lazy("],
 ["{user.role==='admin'&&user.operationsMetricsAvailable&&", "{user.role==='admin'&&user.enterprisePlansAvailable&&<NavLink to=\"/enterprise\"><Icon icon={UsersRound}/>套餐与席位</NavLink>}{user.role==='admin'&&user.operationsMetricsAvailable&&"],
 ['<Route path="/operations"', '<Route path="/enterprise" element={<EnterprisePlansPage user={user} workspaceId={workspaceId}/>}/><Route path="/operations"']
 ]){assert.equal(s.split(from).length,2);s=s.replace(from,()=>to);}if(!/import[^\n]*UsersRound/.test(s))s=s.replace("import {",()=>"import {UsersRound,");fs.writeFileSync(file,s);console.log('PASS enterprise route and feature-advertised admin navigation connected');
