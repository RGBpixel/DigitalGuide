import type { Repository } from '@digitalguide/database';
import type { SessionRow } from './reception-service.js';
import { RestaurantService } from './restaurant-service.js';
import type { PartyRow } from './dining-service.js';
import { diningPreference } from './dining-preference.js';
import { recommendDining } from '../../../packages/domain/src/restaurant.js';
export function restaurantAnswer(repo:Repository,session:SessionRow,text:string){
 if(session.service_scene!=='restaurant'||!/(订单|点单|下单|菜单|推荐|菜|口味|吃|座位|排队|预约|几号桌|偏好|喜欢什么)/.test(text))return null;
 const core=new RestaurantService(repo,{providerMode:session.environment,appEnv:session.app_env}),r=core.guest(session),p=repo.get<PartyRow>("SELECT * FROM dining_parties WHERE restaurant_id=? AND owner_session_id=? AND status IN ('waiting','held','seated','reserved') AND id=COALESCE(?,(SELECT CASE WHEN count(*)=1 THEN min(id) END FROM dining_parties WHERE restaurant_id=? AND owner_session_id=? AND status IN ('waiting','held','seated','reserved'))) LIMIT 1",r.id,session.id,session.dining_party_id,r.id,session.id),menu=core.menu(r),preference=p?diningPreference(repo,p):null,context={restaurantId:r.id,menuVersion:menu.version,partyId:p?.id||null,partyVersion:p?.version||null,preferenceId:preference?.usable?preference.id:null};let answer:string;
 if(/订单|点了|菜.*(好了|好了吗|进度|出餐|上了)|下单.*(结果|状态)|催菜/.test(text)){
  const o=p?repo.get<{id:string;number:string;status:string;attention_reason:string|null}>("SELECT * FROM restaurant_orders WHERE party_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1",p.id):undefined;
  const names:Record<string,string>={draft:'草稿，尚未下单',awaiting_confirmation:'待您确认，尚未发送',confirmed:'已确认，尚未发送',queued:'等待发送',submitting:'正在发送',submitted:'渠道接收，仍待后厨接单',accepted:'后厨已接单',preparing:'制作中',ready:'已备好',served:'已上菜，尚未结算',needs_attention:'需要店员核对',cancelled:'已核实取消',closed:'已结束'};
  const lines=o?repo.all<{item_name:string;quantity:number;cancelled_quantity:number;started_quantity:number;ready_quantity:number;served_quantity:number}>('SELECT l.*,t.started_quantity,t.ready_quantity,t.served_quantity FROM restaurant_order_lines l JOIN restaurant_kitchen_tickets t ON t.line_id=l.id WHERE l.order_id=?',o.id):[];
  answer=o?'本组订单'+o.number+'：'+(names[o.status]||'请店员核对')+'。'+lines.filter(l=>l.quantity>l.cancelled_quantity).map(l=>l.item_name+'有效'+(l.quantity-l.cancelled_quantity)+'份，开做'+l.started_quantity+'、备好'+l.ready_quantity+'、上菜'+l.served_quantity).join('；')+(o.attention_reason?'。'+o.attention_reason:'')+'。这里仅查询本人状态，不会另发新单或推断已付款。':'本组还没有可查询订单，请先建立并提交点单；旁人的订单不会展示。';
 }
 else if(/座位|几号桌/.test(text)&&p){const o=repo.get<{table_id:string;state:string}>("SELECT * FROM dining_occupancies WHERE party_id=? AND state IN ('held','seated')",p.id),table=o?repo.get<{name:string;zone:string}>('SELECT name,zone FROM restaurant_tables WHERE id=?',o.table_id):undefined;answer=table?(o?.state==='held'?'当前为您预留':'本组已确认入座')+table.zone+'的'+table.name+'。'+r.public_guide:'本组尚未分配桌位，请在本次就餐页审阅可用桌位或联系店员。';}
 else if(/排队|预约/.test(text)){answer=p?p.status==='reserved'?'本组有已保存预约，请在签到窗口内核对到店；入座仍需检查当时桌位。':p.queue_number?'本组排队号为'+p.queue_number+'。请在本次就餐页查看当前状态，不会因旁人讲话变更本组安排。':'请在本次就餐页核对当前桌位。':'请在本次就餐页确认人数、预约时段或排队，文字咨询不会自动建立预约。';}
 else {const candidates=preference?.usable?recommendDining(menu,preference.preferences).items:menu.items.flatMap(i=>i.skus.filter(s=>s.available).map(s=>({name:i.name,skuName:s.name,priceMinor:s.priceMinor}))).slice(0,6);answer=(preference?.usable?'依据本次已确认口味，当前候选为：':'本次口味尚未明确确认，先列出当前可供菜单：')+(candidates.length?candidates.map(s=>s.name+'（'+s.skuName+'，¥'+(s.priceMinor/100).toFixed(2)+'）').join('；'):'暂时没有符合当前条件的可供菜品，请联系店员。')+'。菜单版本'+menu.version+'，仅代表当前本地菜单；需要避开的成分请让店员核对。不会自动下单。';}
 return {text:'【本地餐厅】'+answer,context};
}
