import { randomUUID } from 'node:crypto';
import type { Repository } from '@digitalguide/database';
import type { SceneAppSnapshot } from '@digitalguide/contracts';
import { AppError } from '@digitalguide/domain';
import { parseOrderSentence } from '../../../packages/domain/src/order-language.js';
import type { Config } from './config.js';
import type { SessionRow } from './reception-service.js';
import { RestaurantService } from './restaurant-service.js';
import type { PartyRow } from './dining-service.js';
import { diningPreference } from './dining-preference.js';
import { SceneService } from './knowledge-service.js';
import { OrderService } from './order-service.js';
import type { ToolRow } from './conversation-tools.js';
import { orderHash } from './order-common.js';
interface Parameters {partyId:string;partyVersion:number;accessVersion:number;menuVersion:number;preferenceHash:string;orderVersion:number;kind:'initial'|'amend';newLines:Array<{skuId:string;quantity:number;preparationNote:string}>}
export function selectedDiningParty(repo:Repository,row:SessionRow,restaurantId:string){return repo.get<PartyRow>("SELECT * FROM dining_parties WHERE restaurant_id=? AND owner_session_id=? AND status IN ('waiting','held','seated','reserved') AND id=COALESCE(?,(SELECT CASE WHEN count(*)=1 THEN min(id) END FROM dining_parties WHERE restaurant_id=? AND owner_session_id=? AND status IN ('waiting','held','seated','reserved'))) LIMIT 1",restaurantId,row.id,row.dining_party_id,restaurantId,row.id);}
export function restaurantDraftSuggestion(repo:Repository,row:SessionRow,text:string,snapshot?:SceneAppSnapshot){
 if(row.service_scene!=='restaurant')return null;const core=new RestaurantService(repo,{providerMode:row.environment,appEnv:row.app_env}),r=core.guest(row),menu=core.menu(r),parsed=parseOrderSentence(text,menu);if(!parsed)return null;
 const p=selectedDiningParty(repo,row,r.id),pref=p?diningPreference(repo,p):null,context={restaurantId:r.id,menuVersion:menu.version,partyId:p?.id||null,partyVersion:p?.version||null,preferenceId:pref?.usable?pref.id:null},scenes=new SceneService(repo,row.environment,row.app_env);
 const none=(message:string)=>({text:'【本地餐厅】'+message,context,parameters:null,preview:null});
 if(!snapshot||!scenes.toolAllowed(snapshot,'restaurant.order_draft'))return none('本频道未启用对话点单草稿，请在“本次点单”中手动选择菜品。');
 if(!p)return none('请先在本次就餐页建立并选择当前就餐记录，再提出点单草稿。');if(parsed.reason)return none(parsed.reason);
 const existing=repo.get<{version:number;pending_change_id:string|null;control_mode:string;status:string}>("SELECT * FROM restaurant_orders WHERE party_id=? AND status NOT IN ('closed','cancelled')",p.id);
 if(existing?.pending_change_id||existing?.control_mode==='human')return none('已有待处理草稿、未核实派单或人工接管，请先在“本次点单”核对，不能另建重复请求。');
 const preview=parsed.lines.map(l=>{const i=menu.items.find(i=>i.skus.some(s=>s.id===l.skuId))!,sku=i.skus.find(s=>s.id===l.skuId)!;return i.name+' · '+sku.name+' × '+l.quantity;}).join('；');
 const parameters:Parameters={partyId:p.id,partyVersion:p.version,accessVersion:p.access_version,menuVersion:menu.version,preferenceHash:orderHash(pref),orderVersion:existing?.version||0,kind:existing&&repo.get('SELECT id FROM restaurant_order_lines WHERE order_id=(SELECT id FROM restaurant_orders WHERE party_id=? AND status NOT IN (\'closed\',\'cancelled\')) AND quantity>cancelled_quantity',p.id)?'amend':'initial',newLines:parsed.lines};
 return {text:'【本地餐厅】已识别草稿建议：'+preview+'。请明确应用后到“本次点单”核对价格、口味和桌位，再审阅、确认并提交；当前没有下单或扣库存。',context,parameters,preview};
}
export function proposeRestaurantDraft(repo:Repository,row:SessionRow,snapshot:SceneAppSnapshot,replyId:string,visitorId:string,epoch:number,suggestion:NonNullable<ReturnType<typeof restaurantDraftSuggestion>>){
 if(!suggestion.parameters)return;
 repo.run('INSERT INTO conversation_tool_requests(id,session_id,reply_id,app_id,tool_name,focus_version,reply_epoch,expires_at,created_at,parameters,preview,source_message_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',randomUUID(),row.id,replyId,snapshot.id,'restaurant.order_draft',row.focus_version,epoch,new Date(Math.min(Date.now()+60000,Date.parse(row.expires_at))).toISOString(),new Date().toISOString(),JSON.stringify(suggestion.parameters),suggestion.preview,visitorId);
}
export function applyRestaurantDraft(repo:Repository,config:Config,row:SessionRow,request:ToolRow){
 if(row.service_scene!=='restaurant'||!request.parameters||!request.source_message_id)throw new AppError('TOOL_FORBIDDEN','此草稿建议不属于当前餐厅。',403);
 const source=repo.get<{input_source:string;speaker_decision_id:string|null}>('SELECT * FROM reception_messages WHERE id=? AND session_id=? AND role=\'visitor\' AND focus_version=? AND reply_epoch=?',request.source_message_id,row.id,row.focus_version,row.reply_epoch);
 if(!source||source.input_source!=='typed'&&!(source.input_source==='verified_mock_audio'&&repo.get("SELECT id FROM speaker_segment_decisions WHERE id=? AND session_id=? AND focus_version=? AND attribution='target' AND final=1 AND accepted=1",source.speaker_decision_id,row.id,row.focus_version)))throw new AppError('TOOL_SOURCE_CHANGED','此建议缺少当前发问人的有效输入来源，请重新提出。',409);
 const input=JSON.parse(request.parameters) as Parameters,s=new OrderService(repo,config),a={session:row,p:{userId:'guest:'+row.id,tenantId:row.tenant_id,workspaceIds:[row.workspace_id],role:'viewer' as const}},p=s.dining.party(a,input.partyId),r=s.core.guest(row),pref=diningPreference(repo,p);
 if(p.version!==input.partyVersion||p.access_version!==input.accessVersion||r.menu_version!==input.menuVersion||orderHash(pref)!==input.preferenceHash||row.dining_party_id!==p.id)throw new AppError('ORDER_SUGGESTION_STALE','菜单、偏好、就餐记录或归属已变化，请重新提出并核对草稿建议。',409);
 return s.createChange(a,p.id,{orderVersion:input.orderVersion,kind:input.kind,newLines:input.newLines,focusVersion:row.focus_version},request.id);
}
