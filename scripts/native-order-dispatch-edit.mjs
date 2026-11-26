import fs from 'node:fs';
import assert from 'node:assert/strict';
const replace=(value,before,after)=>{assert.equal(value.split(before).length,2,before);return value.replace(before,after);},edit=(file,changes)=>{let value=fs.readFileSync(file,'utf8');for(const[a,b]of changes)value=replace(value,a,b);fs.writeFileSync(file,value);};
edit('packages/postgres/src/runtime-orders.ts',[
 [" VALIDATION_FAILED:[400", " ORDER_WORKER_LEASE:[409,'原派单租约已到期或已有更新结果，旧回调不能提交。'],ORDER_SOURCE_EXPIRED:[409,'发送前原期限、顾客或授权已变化，保留请求交由店员核对。'],POS_RECEIPT_MISMATCH:[409,'回执与固定的原门店、请求摘要、环境或远端编号不一致。'],POS_REQUEST_NOT_SENT:[409,'原请求尚未发送，不能接受远端确认回执。'],POS_EVENT_CONFLICT:[409,'同一回执事件的内容发生变化，请核对原事件。'],POS_QUERY_UNAVAILABLE:[409,'只有已发送且待核实的原请求可查询，矛盾回执须人工核对。'],POS_FIXTURE_UNAVAILABLE:[409,'仅可为明确的本地未决模拟请求建立一次远端事实。'],\n VALIDATION_FAILED:[400"],
 ["action:'config'|'draft'|'update'|'review'|'confirm'|'submit'|'withdraw'", "action:'config'|'draft'|'update'|'review'|'confirm'|'submit'|'withdraw'|'query'"],
 ["  let body={...input};", "  if(action==='query')return this.call<string>('dg_native_order_query',[id,input,...this.proofArgs(proof,true)]);\n  let body={...input};"],
 [" async orderRead("," mockResult(id:string,input:Record<string,unknown>){return this.call<string>('dg_native_order_mock_fixture',[id,input]);}\n async orderRead("]
]);
edit('packages/postgres/src/runtime-bootstrap.ts',[["  await client.query('GRANT EXECUTE ON FUNCTION dg_native_order_sweep(text) TO '+identifier(input.worker.user));", "  await client.query('GRANT EXECUTE ON FUNCTION dg_native_order_sweep(text) TO '+identifier(input.worker.user));\n  for(const fn of ['dg_native_order_query(text,jsonb,text,text,text,bigint)','dg_native_order_mock_fixture(text,jsonb)','dg_native_order_receipt_apply(text,jsonb,text)'])await client.query('GRANT EXECUTE ON FUNCTION '+fn+' TO '+apiRole);\n  for(const fn of ['dg_native_order_worker_claim()','dg_native_order_worker_context(text,text,boolean)','dg_native_order_mock_io(text,text)','dg_native_order_worker_complete(text,text,jsonb)'])await client.query('GRANT EXECUTE ON FUNCTION '+fn+' TO '+identifier(input.worker.user));"]]);
edit('apps/api/src/postgres-order-routes.ts',[
 ["import {timingSafeEqual}","import {createHmac,timingSafeEqual}"],
 ["import {AppError}","import {AppError,canonical}"],
 ["orderVersionInput,posConfigInput}","orderVersionInput,orderQueryInput,posConfigInput,posFixtureInput,posCallbackInput}"],
 ["export function registerNativeOrderRoutes(","export function nativePOSSignature(config:Config,timestamp:string,body:unknown){return createHmac('sha256',config.sessionSecret).update(canonical({purpose:'native-pos-callback-v1',runtimeId:config.nativePostgres!.runtimeId,providerId:'mock-pos',appEnv:config.appEnv,timestamp,body})).digest('hex');}\n\nexport function registerNativeOrderRoutes("],
 ["'draft'|'update'|'review'|'confirm'|'submit'|'withdraw'];","'draft'|'update'|'review'|'confirm'|'submit'|'withdraw'|'query'];"],
 ["['withdraw',orderVersionInput]].map", "['withdraw',orderVersionInput],['query',orderQueryInput]].map"],
 [" const{app,repo,authenticated}=context,orders=", " const{app,repo,authenticated}=context,orders="],
 [" app.get(base+'/restaurants/:id/pos'", ` app.post(base+'/restaurant/order-changes/:changeId/mock-result',async(req,reply)=>{const input=posFixtureInput.parse(req.body),target=id(req,'changeId');await staffSweep(req,'change',target);return send(req,reply,await authenticated(req,async({principal:p})=>{await orders.prepareOrder(p,'change',target,true);const operation=await repo.idempotentResource(p,{action:req.method+' '+req.url.split('?')[0],key:key(req),body:input,code:200},()=>orders.mockResult(target,input));return orders.orderResult(operation);}));});
 app.post(base+'/webhooks/mock-pos',async(req,reply)=>{const body=posCallbackInput.parse(req.body),timestamp=z.iso.datetime().parse(req.headers['x-pos-timestamp']),signature=z.string().regex(/^[a-f0-9]{64}$/).parse(req.headers['x-pos-signature']),expected=nativePOSSignature(config,timestamp,body);if(Math.abs(Date.now()-Date.parse(timestamp))>300000||!timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(signature,'hex')))throw new AppError('POS_CALLBACK_AUTH','POS回执签名或时间窗口无效，请核对原回调配置。',401);return send(req,reply,await repo.db.transaction(()=>orders.call('dg_native_order_receipt_apply',[body.eventId,body.receipt,'callback'])));});
 app.get(base+'/restaurants/:id/pos'`]
]);
edit('tests/integration/postgres-order-helpers.ts',[
 ["export async function nativeOrderFixture(){", "export async function nativeOrderFixture(options:{evidenceRoot?:string}={}){\n const activeEvidence=options.evidenceRoot??orderEvidence;"],
 ["file=orderEvidence+(migration.startsWith('098-')", "file=(parseInt(migration)>=104?activeEvidence:orderEvidence)+(migration.startsWith('098-')"],
 ["fs.mkdirSync(orderEvidence+'/instances'", "fs.mkdirSync(activeEvidence+'/instances'"],
 ["fs.writeFileSync(orderEvidence+'/instances/'", "fs.writeFileSync(activeEvidence+'/instances/'"]
]);
edit('apps/worker/src/postgres-core.ts',[
 ["import {NativeOrders} from '../../../packages/postgres/src/runtime-orders.js';", "import {NativeOrders} from '../../../packages/postgres/src/runtime-orders.js';\nimport {NativeOrderWorker} from '../../../packages/postgres/src/runtime-order-worker.js';"],
 ["dining=new NativeOrders(repo,config.sessionSecret),people=", "dining=new NativeOrders(repo,config.sessionSecret),orderDispatch=new NativeOrderWorker(repo,config.sessionSecret),people="],
 ["let visitPending:Promise<unknown>|undefined,", "let orderPending:Promise<unknown>|undefined,visitPending:Promise<unknown>|undefined,"],
 ["officePending??=", "orderPending??=polling.run('orderDispatch',()=>orderDispatch.runOne(mediaStop.signal)).catch(failure).finally(()=>{orderPending=undefined;});officePending??="],
 ["...(visitPending?[visitPending]:[])", "...(orderPending?[orderPending]:[]),...(visitPending?[visitPending]:[])"]
]);
console.log(JSON.stringify({result:'NATIVE_ORDER_DISPATCH_SOURCE_WIRING_UPDATED',realExternalProviderEnabled:false,orderingUI:false}));
