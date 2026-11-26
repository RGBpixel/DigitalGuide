import fs from 'node:fs';
import assert from 'node:assert/strict';
const replace=(value,before,after)=>{assert.equal(value.split(before).length,2,before);return value.replace(before,after);},edit=(file,changes)=>{let value=fs.readFileSync(file,'utf8');for(const[a,b]of changes)value=replace(value,a,b);fs.writeFileSync(file,value);};
edit('packages/postgres/src/runtime-orders.ts',[
 [" ORDER_WORKER_LEASE:[409", " POS_RECONCILIATION_REQUIRED:[409,'本单回执存在矛盾或本地投影失败，请经理核实POS与实际制作；本地操作不能把它标为已解决。'],\n ORDER_WORKER_LEASE:[409"],
 ["|'withdraw'|'query',input", "|'withdraw'|'query'|'control',input"],
 ["  if(action==='query')", "  if(action==='control')return this.call<string>('dg_native_order_control',[id,input,...this.proofArgs(proof,true)]);\n  if(action==='query')"]
]);
edit('apps/api/src/postgres-order-routes.ts',[
 ['orderQueryInput,posConfigInput','orderQueryInput,orderControlInput,posConfigInput'],
 ["|'withdraw'|'query'];", "|'withdraw'|'query'|'control'];"],
 ["'party','partyId','draft'],...", "'party','partyId','draft'],[order+'/control',orderControlInput,'order','orderId','control'],..."]
]);
edit('apps/api/src/postgres-core-app.ts',[
 ["import {registerNativeOrderRoutes} from './postgres-order-routes.js';", "import {registerNativeOrderRoutes} from './postgres-order-routes.js';\nimport {registerNativeKitchenRoutes} from './postgres-kitchen-routes.js';"],
 ["  registerNativeOrderRoutes({app,repo,authenticated,send,scope},config);", "  registerNativeOrderRoutes({app,repo,authenticated,send,scope},config);\n  registerNativeKitchenRoutes({app,repo,authenticated,send,scope},config);"]
]);
edit('packages/postgres/src/runtime-bootstrap.ts',[
 ["  for(const fn of ['dg_native_order_worker_claim()'", "  for(const fn of ['dg_native_order_control(text,jsonb,text,text,text,bigint)','dg_native_order_kitchen_context(text,text,boolean,text)','dg_native_order_kitchen_directory()','dg_native_order_kitchen_read(text)','dg_native_order_kitchen_apply(text,jsonb)','dg_native_order_kitchen_result(text)'])await client.query('GRANT EXECUTE ON FUNCTION '+fn+' TO '+apiRole);\n  for(const fn of ['dg_native_order_worker_claim()'"]
]);
edit('tests/integration/postgres-order-helpers.ts',[
 ["options:{evidenceRoot?:string}={}", "options:{evidenceRoot?:string;firstMigration?:number}={}"],
 ["parseInt(migration)>=104?activeEvidence:orderEvidence", "parseInt(migration)>=(options.firstMigration??104)?activeEvidence:parseInt(migration)>=104?orderEvidence+'/dispatch':orderEvidence"]
]);
edit('apps/web/src/restaurant/KitchenPage.tsx',[
 ["import { useEffect,useState }", "import { useState }"],
 ["list=restaurants.data?.filter(r=>r.workspaceId===workspaceId)||[]", "list=restaurants.isError?[]:restaurants.data?.filter(r=>r.workspaceId===workspaceId)||[]"],
 ["queryKey:['kitchen-tickets',r?.id]", "queryKey:['kitchen-tickets',workspaceId,r?.id]"],
 ["enabled:!!r,refetchInterval:1000,retry:false}),tickets=query.data||[]", "enabled:!!r&&restaurants.isSuccess,refetchInterval:1000,retry:false,gcTime:0}),tickets=query.isError?[]:query.data||[]"],
 ["!r&&!restaurants.isPending", "!r&&restaurants.isSuccess"],
 ["r&&!query.isPending", "r&&query.isSuccess"],
 ["[checked,setChecked]=useState(false)", "[checkedVersion,setCheckedVersion]=useState<number|null>(null),checked=checkedVersion===t.version"],
 ["onSuccess:()=>{setChecked(false);", "onSuccess:()=>{setCheckedVersion(null);"],
 [" useEffect(()=>{setChecked(false);},[t.version]);\n", ""],
 ["setQuantity(Number(e.target.value));setChecked(false);", "setQuantity(Number(e.target.value));setCheckedVersion(null);"],
 ["onChange={e=>setChecked(e.target.checked)}", "onChange={e=>setCheckedVersion(e.target.checked?t.version:null)}"]
]);
console.log(JSON.stringify({result:'NATIVE_KITCHEN_AND_CONTROL_WIRED',orderingUI:false,paymentsUI:false,realKitchenNotifications:false}));
