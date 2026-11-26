import type { Repository } from '@digitalguide/database';
import type { SessionRow } from './reception-service.js';
import type { PartyRow } from './dining-service.js';
import { RestaurantService } from './restaurant-service.js';
import { selectedDiningParty } from './restaurant-order-tools.js';
export function restaurantFinancialAnswer(repo:Repository,row:SessionRow,text:string){
 if(row.service_scene!=='restaurant'||!/(账单|结账|买单|付款|支付|退款|收据|再见|离店|下次见)/.test(text))return null;
 const core=new RestaurantService(repo,{providerMode:row.environment,appEnv:row.app_env}),r=core.guest(row),p=row.dining_party_id?repo.get<PartyRow>('SELECT * FROM dining_parties WHERE id=? AND restaurant_id=? AND owner_session_id=?',row.dining_party_id,r.id,row.id):selectedDiningParty(repo,row,r.id),context={restaurantId:r.id,menuVersion:r.menu_version,partyId:p?.id||null,partyVersion:p?.version||null,preferenceId:null};
 if(/再见|离店|下次见/.test(text)&&!/(账单|支付|付款|退款)/.test(text)){const farewell=p&&p.status==='completed'?repo.get<{message:string}>('SELECT message FROM dining_farewells WHERE party_id=?',p.id):undefined;return {text:'【本地餐厅】'+(farewell?.message||'如准备离店，请先在本次账单核对支付结果，并让店员确认服务完成及结束就餐；不会凭口头告别释放桌位。'),context};}
 const bills=p?repo.all<{id:string;number:string;amount_minor:number;status:string;attention_reason:string|null}>('SELECT * FROM restaurant_bills WHERE party_id=? ORDER BY created_at DESC,rowid DESC LIMIT 10',p.id):[],names:Record<string,string>={open:'待结算',payment_pending:'支付待核实',paid:'模拟收款已核实',partially_refunded:'模拟部分退款已核实',refunded:'模拟全额退款已核实',needs_attention:'需要经理核对',void:'零金额账单已核对'},amount=(n:number)=>'¥'+(n/100).toFixed(2);
 const summary=bills.map(b=>{const t=repo.get<{paid:number;refunded:number}>("SELECT COALESCE(sum(CASE WHEN kind='payment' THEN amount_minor ELSE 0 END),0) paid,COALESCE(sum(CASE WHEN kind='refund' THEN amount_minor ELSE 0 END),0) refunded FROM restaurant_financial_postings WHERE bill_id=?",b.id)!;return b.number+'：'+(names[b.status]||'请店员核对')+'，账单'+amount(b.amount_minor)+'，已核实收款'+amount(t.paid)+'、退款'+amount(t.refunded)+(b.attention_reason?'。'+b.attention_reason:'');}).join('；');
 return {text:'【本地餐厅 · 模拟资金】'+(summary||'本组尚未生成可查询账单，请在“本次账单”核对已接单明细，或请店员协助。')+'。口头说明、截图和客户端提示不能作为支付成功凭据；结果未知请查询原请求。这里不会发起收款、退款或重复支付。',context};
}
