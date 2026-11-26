import {nativeFoodUiVerified} from './native-food-ui-state.js';
import {nativeOrderUiVerified} from './native-order-ui-state.js';
import {nativeServiceUiVerified} from './native-service-ui-state.js';
import {nativeAftercareUiVerified} from './native-aftercare-ui-state.js';
import {AppError,type Principal} from '../../domain/src/index.js';
import type {Restaurant,RestaurantTable,RestaurantGrant,StaffMenu,RestaurantStockAdjustment,Profile} from '../../contracts/src/index.js';
import {NativeScenes} from './runtime-scenes.js';
import {nativeDiningUiVerified} from './native-dining-ui-state.js';
import type {NativeCoreRepository} from './runtime-repository.js';
const errors:Record<string,[number,string]>={AUTH_REQUIRED:[401,'请重新登录当前工作空间。'],FORBIDDEN:[403,'当前账号没有建立门店的权限。'],NOT_FOUND:[404,'门店或记录不存在，或当前账号没有此门店职责。'],VALIDATION_FAILED:[400,'门店、桌位或菜单输入无效，请核对数量、范围和必填项。'],VERSION_CONFLICT:[409,'当前版本已经变化，请载入最新内容后重新核对。'],SOURCE_UNAVAILABLE:[409,'餐厅角色或公开场景不可用，请选择本空间可用的餐厅角色。'],RESTAURANT_EXISTS:[409,'此场所在当前环境已有门店，请打开原门店设置。'],DUPLICATE_TABLE_CODE:[409,'本店已有相同桌号，请使用不同桌号。'],TABLE_BUSY:[409,'桌位仍在预留或就餐，不能覆盖占用；请先核对当前顾客安排。'],RESERVATION_CONFLICT:[409,'修改会影响已有预约的人数或可用性，请先处理预约。'],TABLE_LIMIT:[409,'本店已达到200个桌位上限。'],MENU_LIMIT:[409,'本店已达到500项菜品上限。'],DUPLICATE_SKU:[409,'规格编号重复，请重新载入当前菜品。'],DUPLICATE_SKU_NAME:[409,'规格名称重复，请使用可区分的名称。'],SKU_NOT_FOUND:[409,'规格不属于当前菜品，请载入最新菜单。'],STOCK_UNTRACKED:[409,'此规格未启用库存计数，请先核对菜品设置。'],INVENTORY_BUSY:[409,'规格仍有预占库存，不能关闭计数或使可售加预占超过上限；请核对原订单并调整盘点数量。'],GRANT_EXPIRED:[409,'权限到期时间须在未来。'],SELF_GRANT_LOCKED:[409,'请由其他经理或组织管理员核对本人的门店权限。'],AUTHORIZATION_CHANGED:[409,'原操作的成员或门店授权已变化，请重新核对并发起新操作。']};
export type RestaurantResource='venue'|'restaurant'|'table'|'item'|'sku';
export class NativeRestaurant {
 readonly scenes:NativeScenes;
 constructor(readonly core:NativeCoreRepository){this.scenes=new NativeScenes(core);}
 get db(){return this.core.db;}
 async call<T>(name:string,args:unknown[]=[]):Promise<T>{try{return(await this.db.query<{value:T}>('SELECT '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') value',args)).rows[0].value;}catch(error){const text=error instanceof Error?error.message:'',code=text.startsWith('DGRESTAURANT:')?text.slice(13):text.startsWith('DGRECEPTION:')?text.slice(12):text.startsWith('DGPEOPLE:')?text.slice(9):'',known=errors[code];if(known)throw new AppError(code,known[1],known[0]);const sessionErrors:Record<string,[number,string]>={SESSION_ENDED:[410,'本次顾客接待已结束或超时，请重新打开当前终端。'],STATE_CONFLICT:[409,'终端或访问凭证已变化，请重新打开当前接待。'],RESTAURANT_PAUSED:[409,'当前不在营业时段或已暂停迎宾；已有顾客可继续咨询，请联系店员。'],QUOTA_EXCEEDED:[409,'此工作空间的接待终端已达到100个上限。']};if(sessionErrors[code])throw new AppError(code,sessionErrors[code][1],sessionErrors[code][0]);throw error;}}
 async prepare(p:Principal,kind:RestaurantResource,id:string,manager=false,write=false,recipient?:string){const meta=await this.call<{workspaceId:string;restaurantId:string|null}>('dg_native_restaurant_prepare',[kind,id,manager,write,recipient??null]);await this.core.workspaceLock(p,meta.workspaceId,write);return meta;}
 async bindings(p:Principal,workspace:string,input:{profileId?:string|null;sceneAppId?:string|null}){
  if(input.profileId){const profile=await this.core.assets.profile(p,input.profileId);if(profile.workspaceId!==workspace||!profile.scenes.includes('restaurant'))throw new AppError('SOURCE_UNAVAILABLE',errors.SOURCE_UNAVAILABLE[1],409);for(const id of [profile.avatarAssetId,profile.voiceAssetId].filter((v):v is string=>!!v))await this.core.assets.checked(p,id);}
  if(input.sceneAppId){const snapshot=this.scenes.snapshot(await this.scenes.app(p,input.sceneAppId));if(snapshot.workspaceId!==workspace||snapshot.scene!=='restaurant'||snapshot.audience!=='public'||input.profileId&&snapshot.profileId!==input.profileId)throw new AppError('SOURCE_UNAVAILABLE',errors.SOURCE_UNAVAILABLE[1],409);this.scenes.ready(snapshot);await this.scenes.active(p,snapshot);}
 }
 present<T>(value:T):T{if(value&&typeof value==='object'&&!Array.isArray(value)&&'capabilities'in value){const r=value as T&Restaurant,orders=nativeOrderUiVerified||this.core.orderUiPreview;return{...r,capabilities:{...r.capabilities!,terminals:true,terminalControl:true,seating:nativeDiningUiVerified||this.core.diningUiPreview,preferences:nativeFoodUiVerified||this.core.foodUiPreview,ordering:orders,payments:orders,orderHistory:orders,serviceRequests:nativeServiceUiVerified||this.core.hospitalityUiPreview,aftercare:nativeAftercareUiVerified||this.core.aftercareUiPreview}};}return value;}
 async view(id:string){return this.present(await this.call<Restaurant>('dg_native_restaurant_view',[id]));}
 async list(workspaces:string[],cursor:string,limit:number){return(await this.call<Restaurant[]>('dg_native_restaurant_list',[workspaces,cursor,limit])).map(r=>this.present(r));}
 tables(id:string){return this.call<RestaurantTable[]>('dg_native_restaurant_tables',[id]);}
 menu(id:string){return this.call<StaffMenu>('dg_native_restaurant_menu',[id]);}
 staff(id:string,members=false){return this.call<RestaurantGrant[]|{id:string;name:string}[]>('dg_native_restaurant_staff',[id,members]);}
 stockHistory(id:string){return this.call<RestaurantStockAdjustment[]>('dg_native_restaurant_stock_history',[id]);}
 apply(id:string,action:string,input:unknown){return this.call<string>('dg_native_restaurant_apply',[id,action,input]);}
 async result(id:string){return this.present(await this.call<unknown>('dg_native_restaurant_result',[id]));}
 async sources(p:Principal,id:string){const{workspaceId}=await this.prepare(p,'restaurant',id,true),profiles=(await this.db.query<{id:string;name:string;scenes:string}>("SELECT id,name,scenes FROM profiles WHERE tenant_id=$1 AND workspace_id=$2 AND scenes::jsonb ? 'restaurant' ORDER BY name,id LIMIT 100",[p.tenantId,workspaceId])).rows.map(r=>({...r,scenes:JSON.parse(r.scenes) as Profile['scenes']})),apps=(await this.db.query<{id:string;name:string;profileId:string;scene:'restaurant';audience:'public'}>("SELECT id,name,profile_id AS \"profileId\",scene,'public' AS audience FROM scene_apps WHERE tenant_id=$1 AND workspace_id=$2 AND scene='restaurant' AND enabled=1 AND environment='mock' AND app_env=$3 AND config::jsonb->>'audience'='public' ORDER BY name,id LIMIT 100",[p.tenantId,workspaceId,this.db.config.appEnv])).rows;return{profiles,apps};}
}
