import {AppError,type Principal} from '@digitalguide/domain';
import {puppetConfiguration,livePuppetSnapshot,type LivePuppetSettings} from '@digitalguide/contracts';
import {assertLivePuppet} from '../../../packages/domain/src/live-puppet.js';
import {PUPPET_MEDIA_TYPE} from '../../../packages/media/src/character-puppet.js';
import {Characters} from './character-service.js';
import type {LiveService,LiveSessionRow} from './live-service.js';
export function resolveLivePuppet(live:LiveService,p:Principal,session:LiveSessionRow,settings:LivePuppetSettings){
 const characters=new Characters(live.repo,live.config),row=characters.row(p,settings.characterId);if(row.workspace_id!==session.workspace_id||row.version!==settings.characterVersion||row.kind!=='illustration2d'||row.visual_style!=='cartoon')throw new AppError('LIVE_PUPPET_CHARACTER','请选择本空间当前版本的原创二维参数形象；照片、视频和三维参考暂不用于此驱动。',409);
 const source=characters.sourceFile(p,row),consent=characters.source(p,row).consent;if(source.asset.mediaType!==PUPPET_MEDIA_TYPE||!source.asset.synthetic||source.bytes.length>4096)throw new AppError('LIVE_PUPPET_SOURCE','直播二维驱动需要平台原创参数形象，请到形象与动作创建后重新选择。',409);let configuration;try{configuration=puppetConfiguration.parse(JSON.parse(source.bytes.toString('utf8')));}catch{throw new AppError('LIVE_PUPPET_CONFIGURATION','二维角色参数不符合固定版本，请核对原始形象后重新准备。',409);}
 const snapshot=livePuppetSnapshot.parse({binding:{renderer:'digitalguide-puppet-rms-v1',characterId:row.id,characterVersion:row.version,name:row.name,sourceAssetId:source.asset.id,sourceVersion:source.asset.version,sourceSHA256:source.asset.sha256,sourceSize:source.asset.size,consentId:row.consent_id,expiresAt:[row.expires_at,consent.expires_at,source.asset.expiresAt].filter((v):v is string=>!!v).sort()[0]},configuration});assertLivePuppet(live.repo,p,snapshot.binding,session.workspace_id,live.config.providerMode,live.config.appEnv);return snapshot;
}
