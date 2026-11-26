import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type {Repository} from '@digitalguide/database';
import {AppError,type Principal} from '@digitalguide/domain';
import type {ShelfKind,StudioTemplate} from '@digitalguide/contracts';
import {shelfHash,type ShelfResolved} from '../../../packages/enterprise/src/shelf-policy.js';
import {ownedFile} from '../../../packages/media/src/files.js';
import {Characters} from './character-service.js';
import {VoiceAuthoring} from './voice-authoring.js';
import {StudioService} from './studio-service.js';
import {studioSourceSnapshot} from './studio-source-snapshot.js';
import type {Config} from './config.js';
export const shelfCharacterRepresentation={photo:'photo_reference',video:'video_reference',illustration2d:'illustration2d',model3d:'static3d'} as const;
const minimum=(times:(string|null|undefined)[])=>times.filter((value):value is string=>!!value).sort()[0]??null;
export function checkedShelfAsset(repo:Repository,dataDir:string,p:Principal,id:string){const asset=repo.asset(p,id),upload=repo.get<{storage_key:string}>('SELECT u.storage_key FROM uploads u JOIN assets a ON a.upload_id=u.id WHERE a.id=?',asset.id);if(!upload||asset.size>128*1024*1024)throw new AppError('SHELF_SOURCE_UNAVAILABLE','来源原件不存在或超过本地核对上限。',409);const file=ownedFile(path.resolve(dataDir,'objects'),upload.storage_key);if(!fs.existsSync(file)||fs.statSync(file).size!==asset.size||createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==asset.sha256)throw new AppError('SHELF_SOURCE_UNAVAILABLE','来源原件缺失或字节校验失败，请管理员核对。',409);return asset;}
export function sqliteTemplateShelfSource(studio:StudioService,p:Principal,w:string,template:StudioTemplate,strict=false):ShelfResolved{
 const source=studioSourceSnapshot(studio,p,w,template.purpose,template.document);if(strict)for(const asset of source.snapshot.assets)checkedShelfAsset(studio.repo,studio.dataDir,p,asset.id);
 return{view:{kind:'template',sourceId:template.id,sourceVersion:template.version,name:template.name,representation:'native_template',available:true,unavailableReason:null,expiresAt:minimum([...source.snapshot.assets.map(asset=>asset.expiresAt),...template.document.segments.map(segment=>segment.contentExpiresAt)]),previewUrl:null,realModelVerified:false},hash:shelfHash({kind:'template',template,source:source.hash})};
}
export class SqliteShelfSources{
 readonly characters:Characters;readonly voice:VoiceAuthoring;readonly studio:StudioService;
 constructor(readonly repo:Repository,readonly config:Config){this.characters=new Characters(repo,config);this.voice=new VoiceAuthoring(repo,config);this.studio=new StudioService(repo,config.providerMode,config.appEnv,config.dataDir);}
 resolve(p:Principal,w:string,kind:ShelfKind,id:string,strict=false):ShelfResolved{
  if(kind==='character'){const row=this.characters.row(p,id);if(row.workspace_id!==w)throw new AppError('NOT_FOUND','来源不在当前工作空间。',404);const source=this.characters.source(p,row);if(strict)this.characters.sourceFile(p,row);return{view:{kind,sourceId:id,sourceVersion:row.version,name:row.name,representation:shelfCharacterRepresentation[row.kind],available:true,unavailableReason:null,expiresAt:minimum([row.expires_at,source.asset.expiresAt,source.consent.expires_at]),previewUrl:'/api/v1/studio/characters/'+id+'/preview',realModelVerified:false},hash:shelfHash({kind,version:row.version,characterKind:row.kind,sourceAssetId:source.asset.id,sourceVersion:source.asset.version,sourceHash:source.asset.sha256,consentId:row.consent_id,expiresAt:row.expires_at,consentExpiresAt:source.consent.expires_at})};}
  if(kind==='voice'){const row=this.voice.style(p,id);if(row.workspace_id!==w)throw new AppError('NOT_FOUND','来源不在当前工作空间。',404);const style=this.voice.styleView(p,row);this.voice.reference(p,w,style.reference);const asset=style.reference?(strict?checkedShelfAsset(this.repo,this.config.dataDir,p,style.reference.assetId):this.repo.asset(p,style.reference.assetId)):null,consent=style.reference?this.repo.get<{expires_at:string}>('SELECT expires_at FROM consents WHERE id=?',style.reference.consentId):null;return{view:{kind,sourceId:id,sourceVersion:row.version,name:row.name,representation:'voice_style',available:true,unavailableReason:null,expiresAt:minimum([asset?.expiresAt,consent?.expires_at]),previewUrl:null,realModelVerified:false},hash:shelfHash({kind,style,asset:asset?{id:asset.id,version:asset.version,sha256:asset.sha256}:null,consentExpiresAt:consent?.expires_at??null})};}
  return sqliteTemplateShelfSource(this.studio,p,w,this.studio.template(p,w,id),strict);
 }
}
