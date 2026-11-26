import {AppError,type Principal} from '../../domain/src/index.js';
import type {ShelfKind,StudioTemplate} from '../../contracts/src/index.js';
import {shelfHash,type ShelfResolved} from '../../enterprise/src/shelf-policy.js';
import type {NativeCoreRepository} from './runtime-repository.js';
import {NativeCharacters} from './runtime-characters.js';
import {NativeVoiceAuthoring} from './runtime-voice-authoring.js';
import {NativeStudio} from './runtime-studio.js';
const representation={photo:'photo_reference',video:'video_reference',illustration2d:'illustration2d',model3d:'static3d'} as const;
const minimum=(times:(string|null|undefined)[])=>times.filter((value):value is string=>!!value).sort()[0]??null;
export async function nativeTemplateShelfSource(studio:NativeStudio,p:Principal,w:string,template:StudioTemplate):Promise<ShelfResolved>{const source=await studio.sources.inspect(p,w,template.purpose,template.document);return{view:{kind:'template',sourceId:template.id,sourceVersion:template.version,name:template.name,representation:'native_template',available:true,unavailableReason:null,expiresAt:source.notAfter,previewUrl:null,realModelVerified:false},hash:shelfHash({kind:'template',template,source:source.hash})};}
export class NativeShelfSources{
 readonly characters:NativeCharacters;readonly voice:NativeVoiceAuthoring;readonly studio:NativeStudio;
 constructor(readonly core:NativeCoreRepository){this.characters=new NativeCharacters(core);this.voice=new NativeVoiceAuthoring(core);this.studio=new NativeStudio(core);}
 async resolve(p:Principal,w:string,kind:ShelfKind,id:string,strict=false):Promise<ShelfResolved>{
  if(kind==='character'){const row=await this.characters.row(p,id);if(row.workspace_id!==w)throw new AppError('NOT_FOUND','来源不在当前工作空间。',404);const source=strict?await this.characters.sourceFile(p,row):await this.characters.source(p,row);return{view:{kind,sourceId:id,sourceVersion:row.version,name:row.name,representation:representation[row.kind],available:true,unavailableReason:null,expiresAt:minimum([row.expires_at,source.asset.expiresAt,source.consent.expires_at]),previewUrl:'/api/v1/studio/characters/'+id+'/preview',realModelVerified:false},hash:shelfHash({kind,version:row.version,characterKind:row.kind,sourceAssetId:source.asset.id,sourceVersion:source.asset.version,sourceHash:source.asset.sha256,consentId:row.consent_id,expiresAt:row.expires_at,consentExpiresAt:source.consent.expires_at})};}
  if(kind==='voice'){const row=await this.voice.style(p,id);if(row.workspace_id!==w)throw new AppError('NOT_FOUND','来源不在当前工作空间。',404);const style=await this.voice.styleView(p,row);await this.voice.reference(p,w,style.reference);const asset=style.reference?(strict?(await this.core.assets.checked(p,style.reference.assetId)).asset:await this.core.assets.asset(p,style.reference.assetId)):null,consent=style.reference?await this.core.assets.consent(p,style.reference.consentId):null;return{view:{kind,sourceId:id,sourceVersion:row.version,name:row.name,representation:'voice_style',available:true,unavailableReason:null,expiresAt:minimum([asset?.expiresAt,consent?.expires_at]),previewUrl:null,realModelVerified:false},hash:shelfHash({kind,style,asset:asset?{id:asset.id,version:asset.version,sha256:asset.sha256}:null,consentExpiresAt:consent?.expires_at??null})};}
  return nativeTemplateShelfSource(this.studio,p,w,await this.studio.template(p,w,id));
 }
}
