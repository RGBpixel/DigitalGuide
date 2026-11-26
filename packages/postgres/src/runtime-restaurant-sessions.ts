import {randomUUID} from 'node:crypto';
import {AppError,type Principal} from '../../domain/src/index.js';
import type {Profile,SceneAppSnapshot,Restaurant,RestaurantTerminal,ReceptionSession,NativeRestaurantOpenRequest,RestaurantTerminalControlRequest} from '../../contracts/src/index.js';
import {NativeRestaurant} from './runtime-restaurant.js';
import {NativeReception,receptionHash} from './runtime-reception.js';
import {nativeBusinessInteger,type NativeCoreRepository} from './runtime-repository.js';

/** Store duties authorize staff. Guest cookies only authorize one anonymous visit. */
export class NativeRestaurantSessions {
 readonly restaurant;readonly reception;
 constructor(readonly core:NativeCoreRepository){this.restaurant=new NativeRestaurant(core);this.reception=new NativeReception(core);}
 async prepare(p:Principal,id:string,manager=false,write=false){const meta=await this.restaurant.call<{workspaceId:string;restaurantId:string;terminalId:string}>('dg_native_dining_terminal_prepare',[id,manager,write]);await this.core.workspaceLock(p,meta.workspaceId,write);return meta;}
 terminals(id:string){return this.restaurant.call<RestaurantTerminal[]>('dg_native_dining_terminals',[id]);}
 create(id:string,input:{name:string}){return this.restaurant.call<string>('dg_native_dining_create_terminal',[id,input]);}
 async sources(p:Principal,r:Restaurant){
  let profile:Profile|null=null,scene:SceneAppSnapshot|null=null;
  if(r.sceneAppId){scene=this.reception.scenes.snapshot(await this.reception.scenes.app(p,r.sceneAppId));this.reception.scenes.ready(scene);if(scene.scene!=='restaurant'||scene.audience!=='public'||scene.workspaceId!==r.workspaceId||r.profileId&&scene.profileId!==r.profileId)throw new AppError('SOURCE_UNAVAILABLE','餐厅角色或公开餐厅场景已不可用，请核对门店设置。',409);await this.reception.scenes.active(p,scene);profile=scene.profile;}
  else if(r.profileId)profile=await this.core.assets.profile(p,r.profileId);
  if(profile&&(profile.workspaceId!==r.workspaceId||!profile.scenes.includes('restaurant')))throw new AppError('SOURCE_UNAVAILABLE','当前角色未启用本店的餐厅场景，请重新选择。',409);
  const assets=[];for(const id of profile?[profile.avatarAssetId,profile.voiceAssetId].filter((v):v is string=>!!v):[]){const value=await this.core.assets.checked(p,id);assets.push({id,version:value.asset.version,sha256:value.object.sha256,size:nativeBusinessInteger(value.object.size),storageKey:value.object.storage_key});}
  return{profile,scene,assets};
 }
 async open(p:Principal,id:string,input:NativeRestaurantOpenRequest){const meta=await this.prepare(p,id,false,true),r=await this.restaurant.view(meta.restaurantId),sources=await this.sources(p,r);return this.restaurant.call<string>('dg_native_dining_open',[id,input,sources]);}
 control(id:string,input:RestaurantTerminalControlRequest){return this.reception.call<string>('dg_native_dining_control',[id,input]);}
 async controlledSession(terminalId:string,sessionId:string){const session=await this.reception.call<ReceptionSession>('dg_native_dining_control_view',[terminalId,sessionId]);return{...session,features:this.reception.featuresFor('restaurant')};}
 async issue(p:Principal,id:string,secret:string,runtimeId:string){
  const meta=await this.prepare(p,id,false,true),terminal=(await this.terminals(meta.restaurantId)).find(t=>t.id===id);
  if(!terminal?.currentSessionId)throw new AppError('SESSION_ENDED','此终端没有当前顾客，请先开启接待。',410);
  const sessionId=terminal.currentSessionId,grantId=randomUUID(),cookie='RG1.'+grantId+'.'+this.reception.token(secret,runtimeId,sessionId,grantId,'access'),csrf=this.reception.token(secret,runtimeId,sessionId,grantId,'csrf');
  return this.restaurant.call<string>('dg_native_dining_issue',[id,grantId,receptionHash(cookie),receptionHash(csrf)]);
 }
 async result(id:string){return this.restaurant.call<RestaurantTerminal|ReceptionSession|{sessionId:string;accessId:string}>('dg_native_dining_result',[id]);}
 async sessionResult(id:string){const session=await this.result(id) as ReceptionSession;return{...session,features:this.reception.featuresFor('restaurant')};}
 async access(p:Principal,id:string,secret:string,runtimeId:string){const result=await this.result(id) as{sessionId:string;accessId:string},access=await this.restaurant.call<{sessionId:string;expiresAt:string}>('dg_native_reception_access',[result.accessId]);await this.prepare(p,(await this.restaurant.call<{terminalId:string}>('dg_native_reception_meta',[access.sessionId,null])).terminalId);return{...access,cookie:'RG1.'+result.accessId+'.'+this.reception.token(secret,runtimeId,access.sessionId,result.accessId,'access'),terminalUrl:'/terminal/'+access.sessionId};}
}
