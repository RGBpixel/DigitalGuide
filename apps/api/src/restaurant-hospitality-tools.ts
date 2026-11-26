import { randomUUID } from 'node:crypto';
import type { Repository } from '@digitalguide/database';
import type { SceneAppSnapshot,DiningServiceRequest } from '@digitalguide/contracts';
import { AppError } from '@digitalguide/domain';
import type { Config } from './config.js';
import type { SessionRow } from './reception-service.js';
import type { ToolRow } from './conversation-tools.js';
import { SceneService } from './knowledge-service.js';
import { RestaurantService } from './restaurant-service.js';
import { selectedDiningParty } from './restaurant-order-tools.js';
import { DiningHospitalityService } from './dining-hospitality.js';
interface ServiceSuggestion {partyId:string;partyVersion:number;accessVersion:number;kind:DiningServiceRequest['kind']}
export const serviceNames:Record<DiningServiceRequest['kind'],string>={water:'加水',napkins:'餐巾纸',staff_help:'店员帮助',dish_progress:'核对菜品进度',billing_help:'结账协助'};
export function restaurantHospitalitySuggestion(repo:Repository,row:SessionRow,text:string,snapshot?:SceneAppSnapshot){
 if(row.service_scene!=='restaurant')return null;
 const normalized=text.trim().replace(/[。！!]$/,'').replace(/^(?:请|麻烦)?(?:帮我|我要|我想|给我)?/,''),patterns:Array<[RegExp,DiningServiceRequest['kind']]>= [[/^(?:加水|添水|要水)$/,'water'],[/^(?:拿餐巾纸|要餐巾纸|送餐巾纸)$/,'napkins'],[/^(?:找店员|找服务员|需要店员帮助)$/,'staff_help'],[/^(?:催菜|核对菜品进度|看看出菜进度)$/,'dish_progress'],[/^(?:协助结账|请店员结账|需要结账协助)$/,'billing_help']],kind=patterns.find(([pattern])=>pattern.test(normalized))?.[1];if(!kind)return null;
 const core=new RestaurantService(repo,{providerMode:row.environment,appEnv:row.app_env}),r=core.guest(row),p=selectedDiningParty(repo,row,r.id),context={restaurantId:r.id,menuVersion:r.menu_version,partyId:p?.id||null,partyVersion:p?.version||null,preferenceId:null},scenes=new SceneService(repo,row.environment,row.app_env);
 if(!p)return {text:'【本地餐厅】请先确认当前就餐记录，再提交服务请求，也可直接联系店员。',context,parameters:null,preview:null};
 if(!snapshot||!scenes.toolAllowed(snapshot,'restaurant.service_request'))return {text:'【本地餐厅】本频道未启用对话服务请求，请在“本次服务”选择'+serviceNames[kind]+'，明确确认后交店员处理。',context,parameters:null,preview:null};
 const parameters:ServiceSuggestion={partyId:p.id,partyVersion:p.version,accessVersion:p.access_version,kind};return {text:'【本地餐厅】可以为本组提出“'+serviceNames[kind]+'”请求，请在下方明确确认。店员接收和处理后会更新状态；当前尚未提交，也不会改变订单或付款。',context,parameters,preview:'本组 · '+serviceNames[kind]+'；仅保存店员服务请求，不执行下单、收款或退款。'};
}
export function proposeHospitalityRequest(repo:Repository,row:SessionRow,snapshot:SceneAppSnapshot,replyId:string,visitorId:string,epoch:number,suggestion:NonNullable<ReturnType<typeof restaurantHospitalitySuggestion>>){if(!suggestion.parameters)return;repo.run('INSERT INTO conversation_tool_requests(id,session_id,reply_id,app_id,tool_name,focus_version,reply_epoch,expires_at,created_at,parameters,preview,source_message_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',randomUUID(),row.id,replyId,snapshot.id,'restaurant.service_request',row.focus_version,epoch,new Date(Math.min(Date.now()+60000,Date.parse(row.expires_at))).toISOString(),new Date().toISOString(),JSON.stringify(suggestion.parameters),suggestion.preview,visitorId);}
export function applyHospitalityRequest(repo:Repository,config:Config,row:SessionRow,request:ToolRow){
 if(row.service_scene!=='restaurant'||!request.parameters||!request.source_message_id)throw new AppError('TOOL_FORBIDDEN','服务建议不在当前餐厅范围。',403);
 const source=repo.get<{input_source:string;speaker_decision_id:string|null}>('SELECT * FROM reception_messages WHERE id=? AND session_id=? AND role=\'visitor\' AND focus_version=? AND reply_epoch=?',request.source_message_id,row.id,row.focus_version,row.reply_epoch);
 if(!source||source.input_source!=='typed'&&!(source.input_source==='verified_mock_audio'&&repo.get("SELECT id FROM speaker_segment_decisions WHERE id=? AND session_id=? AND focus_version=? AND attribution='target' AND final=1 AND accepted=1",source.speaker_decision_id,row.id,row.focus_version)))throw new AppError('TOOL_SOURCE_CHANGED','缺少当前发问人的有效来源，请重新提出服务请求。',409);
 const input=JSON.parse(request.parameters) as ServiceSuggestion,s=new DiningHospitalityService(repo,config),a={session:row,p:{userId:'guest:'+row.id,tenantId:row.tenant_id,workspaceIds:[row.workspace_id],role:'viewer' as const}},p=s.dining.party(a,input.partyId);if(p.version!==input.partyVersion||p.access_version!==input.accessVersion||row.dining_party_id!==p.id)throw new AppError('SERVICE_SUGGESTION_STALE','就餐状态或本次归属已变化，请重新核对服务请求。',409);return s.create(a,p.id,{kind:input.kind,confirmed:true,focusVersion:row.focus_version},request.id);
}
