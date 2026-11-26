import {randomUUID} from 'node:crypto';
import type {z} from 'zod';
import {AppError,canonical,requirePermission,type Principal} from '../../domain/src/index.js';
import {assertUsableAsset} from '../../domain/src/index.js';
import type {sceneAppInput,sceneAppUpdateInput,SceneApp,SceneAppSnapshot,KnowledgeAnswer} from '../../contracts/src/index.js';
import {selectLanguageProvider,selectAsrProvider,selectTtsProvider} from '../../providers/src/index.js';
import {nativeSceneSnapshot,nativeLiveScene,type NativeLiveScene} from './runtime-scenes-state.js';
import {NativeKnowledge,nativeKnowledgeTextHash} from './runtime-knowledge.js';
import {nativeBusinessInteger as integer,type NativeCoreRepository} from './runtime-repository.js';

export interface NativeSceneRow{id:string;tenant_id:string;workspace_id:string;profile_id:string;name:string;scene:SceneApp['scene'];channel_key:string;config:string;version:number;enabled:number;created_at:string}
export class NativeScenes {
 readonly knowledge:NativeKnowledge;
 readonly environment='mock';
 constructor(public readonly core:NativeCoreRepository){this.knowledge=new NativeKnowledge(core);}
 get db(){return this.core.db;}
 get appEnv(){return this.db.config.appEnv;}
 async app(p:Principal,id:string,write=false){const r=(await this.db.query<NativeSceneRow>("SELECT * FROM scene_apps WHERE id=$1 AND tenant_id=$2 AND environment='mock' AND app_env=$3",[id,p.tenantId,this.appEnv])).rows[0];if(!r)throw new AppError('NOT_FOUND','场景应用不存在或不在当前空间与环境。',404);await this.knowledge.scope(p,r.workspace_id,write);return{...r,version:integer(r.version),enabled:integer(r.enabled)};}
 snapshot(r:NativeSceneRow):SceneAppSnapshot{return nativeSceneSnapshot.parse({...JSON.parse(r.config),id:r.id,workspaceId:r.workspace_id,version:r.version,enabled:!!r.enabled,createdAt:r.created_at});}
 view(r:NativeSceneRow):SceneApp{const{profile,...view}=this.snapshot(r);return{...view,profileVersion:profile.version};}
 async list(p:Principal,input:{workspaceId?:string;cursor?:string;limit:number}){requirePermission(p,'knowledge.manage');const spaces=input.workspaceId?[input.workspaceId]:[...p.workspaceIds].sort();for(const w of spaces)await this.knowledge.scope(p,w);const rows=(await this.db.query<NativeSceneRow>("SELECT * FROM scene_apps WHERE tenant_id=$1 AND workspace_id=ANY($2::text[]) AND environment='mock' AND app_env=$3 AND id>$4 ORDER BY id LIMIT $5",[p.tenantId,spaces,this.appEnv,input.cursor??'',input.limit+1])).rows.map(r=>({...r,version:integer(r.version),enabled:integer(r.enabled)}));return{items:rows.slice(0,input.limit).map(r=>this.view(r)),nextCursor:rows.length>input.limit?rows[input.limit-1].id:null};}
 async save(p:Principal,input:z.infer<typeof sceneAppInput>,requestId:string,existing?:NativeSceneRow){
  await this.knowledge.scope(p,input.workspaceId,true);
  if((input.speakerProvider==='disabled')!==(input.targetSpeechProvider==='disabled'))throw new AppError('VALIDATION_FAILED','专注对话与目标语音提取需配套选择，或一并关闭。',400);
  if(input.visionProvider==='disabled'&&(input.allowCamera||input.allowScreen))throw new AppError('VALIDATION_FAILED','启用画面来源前请选择视觉服务。',400);
  const disabling=!!existing&&!input.enabled&&input.profileId===existing.profile_id&&canonical([...input.collectionIds].sort())===canonical([...this.snapshot(existing).collectionIds].sort()),profile=disabling?this.snapshot(existing!).profile:await this.core.assets.profile(p,input.profileId);
  if(profile.workspaceId!==input.workspaceId||!profile.scenes.includes(input.scene))throw new AppError('CAPABILITY_UNAVAILABLE','角色必须属于当前空间并启用所选场景。',409);
  if(!disabling){for(const id of[profile.avatarAssetId,profile.voiceAssetId].filter((s):s is string=>!!s)){const a=(await this.core.assets.checked(p,id)).asset;assertUsableAsset(a,await this.db.now());if(a.workspaceId!==input.workspaceId)throw new AppError('SCOPE_CONFLICT','角色素材不属于当前空间。',409);}
   for(const id of input.collectionIds){const c=await this.knowledge.collection(p,id);if(c.workspace_id!==input.workspaceId||!JSON.parse(c.scenes).includes(input.scene)||input.audience==='public'&&c.audience!=='public')throw new AppError('SCOPE_CONFLICT','知识库必须匹配空间、场景和受众；公开应用不能绑定内部知识。',409);}
  }
  const presets={custom:input.scene,office:'reception',exhibition:'exhibition',restaurant:'restaurant'};if(presets[input.preset]!==input.scene)throw new AppError('VALIDATION_FAILED','场景模板与运行场景不匹配。',400);
  if(input.tools.some(t=>t!=='knowledge.search'&&(['restaurant.order_draft','restaurant.service_request'].includes(t)?input.scene!=='restaurant'||input.audience!=='public':input.scene!=='reception')))throw new AppError('SCOPE_CONFLICT','业务工具必须匹配场景与受众。',409);
  if(existing&&existing.version>=200)throw new AppError('QUOTA_EXCEEDED','场景已达200次修订，请按治理流程创建新应用。',409);
  const duplicate=(await this.db.query<{id:string}>("SELECT id FROM scene_apps WHERE tenant_id=$1 AND workspace_id=$2 AND channel_key=$3 AND environment='mock' AND app_env=$4",[p.tenantId,input.workspaceId,input.channelKey,this.appEnv])).rows[0];if(duplicate&&duplicate.id!==existing?.id)throw new AppError('CHANNEL_CONFLICT','此频道标识已使用，请选择独立标识。',409);
  if(!existing&&Number((await this.db.query<{n:string}>('SELECT count(*) AS n FROM scene_apps WHERE tenant_id=$1 AND workspace_id=$2',[p.tenantId,input.workspaceId])).rows[0].n)>=100)throw new AppError('QUOTA_EXCEEDED','空间已有100个场景应用，请整理后创建。',409);
  const id=existing?.id??randomUUID(),version=existing?existing.version+1:1,config=canonical({...input,collectionIds:[...new Set(input.collectionIds)],profile,profileVersion:profile.version});
  if(existing)await this.db.query('UPDATE scene_apps SET profile_id=$1,name=$2,scene=$3,channel_key=$4,config=$5,version=$6,enabled=$7,updated_at=dg_utc_now() WHERE id=$8',[profile.id,input.name,input.scene,input.channelKey,config,version,Number(input.enabled),id]);
  else await this.db.query("INSERT INTO scene_apps VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,$9,'mock',$10,dg_utc_now(),dg_utc_now())",[id,p.tenantId,input.workspaceId,profile.id,input.name,input.scene,input.channelKey,config,Number(input.enabled),this.appEnv]);
  const r=await this.app(p,id),body=canonical(this.snapshot(r));await this.db.query('INSERT INTO scene_app_versions(app_id,version,snapshot,created_at,snapshot_hash) VALUES($1,$2,$3,dg_utc_now(),$4)',[id,version,body,nativeKnowledgeTextHash(body)]);await this.core.audit(p,r.workspace_id,existing?'scene.updated':'scene.created',id,requestId);return id;
 }
 async update(p:Principal,r:NativeSceneRow,input:z.infer<typeof sceneAppUpdateInput>,requestId:string){await this.knowledge.scope(p,r.workspace_id,true);this.knowledge.version(r,input.version);return this.save(p,{...input,workspaceId:r.workspace_id},requestId,r);}
 ready(snapshot:SceneAppSnapshot,mode:'text'|'voice'='text'){
  if(!snapshot.enabled)throw new AppError('CAPABILITY_UNAVAILABLE','场景已停用，请选择其他应用。',409);selectLanguageProvider(snapshot.llmProvider,'mock',this.appEnv);
  if(snapshot.tools.some(t=>t!=='knowledge.search'&&!(t==='restaurant.service_request'&&snapshot.scene==='restaurant'&&snapshot.audience==='public')))throw new AppError('SCENE_BUSINESS_TOOLS_NOT_MIGRATED','此应用包含尚未接通原生业务的工具，请使用已接通的公开知识或餐厅店员服务配置；其他工具不会模拟执行。',503);
  if(mode==='voice'){selectAsrProvider(snapshot.asrProvider,'mock',this.appEnv);selectTtsProvider(snapshot.ttsProvider,'mock',this.appEnv);throw new AppError('CAPABILITY_UNAVAILABLE','可单独检查模拟语音契约；实时麦克风对话仍需目标归属与真实ASR/TTS。',409);}
 }
 async active(p:Principal,snapshot:SceneAppSnapshot){const r=await this.app(p,snapshot.id),current=this.snapshot(r);if(canonical(current)!==canonical(snapshot))throw new AppError('SCENE_CHANGED','场景配置或受众已变化，请采用当前版本重新开始。',409);this.ready(current);const profile=await this.core.assets.profile(p,current.profileId);if(canonical(profile)!==canonical(current.profile))throw new AppError('SCENE_PROFILE_CHANGED','角色配置已变化，请更新场景后重新开始。',409);for(const id of[profile.avatarAssetId,profile.voiceAssetId].filter((s):s is string=>!!s))await this.core.assets.checked(p,id);return current;}
 async answer(p:Principal,snapshot:SceneAppSnapshot,query:string):Promise<KnowledgeAnswer>{const current=await this.active(p,snapshot),found=current.tools.includes('knowledge.search')?await this.knowledge.search(p,{workspaceId:current.workspaceId,collectionIds:current.collectionIds,scene:current.scene,query,publicOnly:current.audience==='public'}):{citations:[]};const response=selectLanguageProvider(current.llmProvider,'mock',this.appEnv).respond({question:query,citations:found.citations,tools:current.tools,hostNames:[]});return{...response,citations:found.citations,simulated:true,provider:current.llmProvider};}
 async publicLive(p:Principal,workspaceId:string,id:string,fixed?:NativeLiveScene,sessionId?:string){
  if(this.db.role==='worker'){
   if(!fixed||!sessionId||fixed.app.id!==id||fixed.app.workspaceId!==workspaceId||!(await this.db.query<{valid:boolean}>('SELECT dg_native_live_scene_valid($1) AS valid',[sessionId])).rows[0].valid)throw new AppError('LIVE_SCENE_CHANGED','原公开直播场景、角色或权限已变化，请新建场次。',409);
   await this.fixedAssets(p,fixed);return fixed;
  }
  const r=await this.app(p,id),app=this.snapshot(r);if(r.workspace_id!==workspaceId||app.scene!=='live'||app.audience!=='public')throw new AppError('LIVE_SCENE_SCOPE','直播只能采用本空间公开的直播场景，不能使用内部接待资料。',409);await this.active(p,app);for(const id of app.collectionIds){const c=await this.knowledge.collection(p,id);if(c.workspace_id!==workspaceId||c.audience!=='public'||!JSON.parse(c.scenes).includes('live'))throw new AppError('LIVE_SCENE_SCOPE','原场景知识库已改为内部或其他用途，请更新公开配置。',409);}
  const assets=[];for(const id of[app.profile.avatarAssetId,app.profile.voiceAssetId].filter((s):s is string=>!!s)){const{asset,object}=await this.core.assets.checked(p,id);if(!['image/png','audio/wav'].includes(asset.mediaType))throw new AppError('LIVE_SCENE_MEDIA','此公开场景请采用PNG形象和PCM WAV音色，其他实时资产仍需独立接入。',409);assets.push({id:asset.id,version:asset.version,...object,size:integer(object.size),media_type:asset.mediaType,expiresAt:asset.expiresAt});}
  const value=nativeLiveScene.parse({app,assets:assets.sort((a,b)=>a.id.localeCompare(b.id))});if(fixed&&canonical(value)!==canonical(fixed))throw new AppError('LIVE_SCENE_CHANGED','固定公开场景、角色或素材已变化，请新建场次。',409);return value;
 }
 async fixedAssets(p:Principal,scene:NativeLiveScene){for(const fixed of scene.assets){const{asset,object}=await this.core.assets.checked(p,fixed.id);if(asset.workspaceId!==scene.app.workspaceId||asset.version!==fixed.version||object.storage_key!==fixed.storage_key||object.sha256!==fixed.sha256||integer(object.size)!==fixed.size||asset.mediaType!==fixed.media_type||asset.expiresAt!==fixed.expiresAt)throw new AppError('LIVE_SCENE_ASSET_CHANGED','原公开场景素材的版本、来源或期限已变化。',409);}}
}
