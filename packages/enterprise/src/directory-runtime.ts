import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,randomUUID,createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {AppError,canonical} from '../../domain/src/index.js';
import {assertNoLinks} from '../../recovery/src/files.js';
import type {IdentityHost} from './identity-runtime.js';
const id=z.uuid(),text=z.string().trim().min(1).max(80),role=z.enum(['editor','reviewer','viewer']);
const definition=z.strictObject({id,tenantId:id,ownerUserId:id,workspaceId:id,name:text,mode:z.enum(['scim','synthetic_directory']),memberRole:role,workspaceIds:z.array(id).max(1000).refine(values=>new Set(values).size===values.length),tokenFile:z.string().min(1)});
const fileInput=z.strictObject({version:z.literal(1),environment:z.enum(['mock','sandbox','live']),appEnv:z.enum(['development','sandbox','production']),providers:z.array(definition).max(20)});
type Definition=z.infer<typeof definition>;
export interface DirectoryProvider extends Definition{fingerprint:string;tokenHash:string;reviewToken:string;baseUrl:string}
export type DirectoryHost=IdentityHost&{enterpriseDirectoryFile?:string};
const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export class DirectoryRuntime {
 private readonly definitions=new Map<string,Definition>();
 constructor(readonly host:DirectoryHost){
  if(!host.enterpriseDirectoryFile)return;
  if(host.recoveryValidationOnly)throw new AppError('DIRECTORY_CONFIG_INVALID','恢复副本不能启用目录供应。',503);
  let input:unknown;try{const file=path.resolve(host.enterpriseDirectoryFile);assertNoLinks(file);if(fs.statSync(file).size>65536)throw new Error();input=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw new AppError('DIRECTORY_CONFIG_INVALID','企业目录私有配置无法读取，请核对服务端文件。',503);}
  const parsed=fileInput.safeParse(input);if(!parsed.success||parsed.data.environment!==host.providerMode||parsed.data.appEnv!==host.appEnv)throw new AppError('DIRECTORY_CONFIG_INVALID','目录配置的结构或环境不符。',503);
  for(const source of parsed.data.providers){if(this.definitions.has(source.id)||!path.isAbsolute(source.tokenFile))throw new AppError('DIRECTORY_CONFIG_INVALID','目录编号重复或凭据不是绝对路径。',503);const relative=path.relative(path.resolve(host.dataDir),path.resolve(source.tokenFile));if(!relative||!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative))throw new AppError('DIRECTORY_CONFIG_INVALID','目录凭据必须在DATA_DIR之外，不能随业务备份恢复。',503);if(source.mode==='synthetic_directory'&&(host.appEnv==='production'||host.providerMode!=='mock'))throw new AppError('DIRECTORY_CONFIG_INVALID','合成目录仅限开发或沙箱的mock环境。',503);if(source.mode==='scim'&&!host.webOrigin.startsWith('https:'))throw new AppError('DIRECTORY_CONFIG_INVALID','真实企业目录入口需要HTTPS。',503);this.definitions.set(source.id,source);this.current(source.id);}
 }
 ids(){return[...this.definitions.keys()];}
 metadata(id:string){const source=this.definitions.get(id);if(!source)return;return{id:source.id,tenantId:source.tenantId,ownerUserId:source.ownerUserId,workspaceId:source.workspaceId,name:source.name,mode:source.mode,memberRole:source.memberRole,workspaceIds:[...source.workspaceIds],baseUrl:this.host.webOrigin+'/api/v1/scim/v2/'+source.id};}
 private token(file:string){try{assertNoLinks(file);if(fs.statSync(file).size>512)throw new Error();const value=fs.readFileSync(file,'utf8').trim();if(!/^[A-Za-z0-9_-]{43,256}$/.test(value))throw new Error();return value;}catch{throw new AppError('DIRECTORY_CREDENTIAL_UNAVAILABLE','目录凭据不可读取或格式不符，请由部署管理员核对私有文件。',503);}}
 current(id:string):DirectoryProvider{const source=this.definitions.get(id);if(!source)throw new AppError('DIRECTORY_NOT_CONFIGURED','目录连接未配置。',404);const tokenHash=digest(this.token(source.tokenFile)),baseUrl=this.host.webOrigin+'/api/v1/scim/v2/'+id,fingerprint=digest(canonical({...source,tokenFile:'',tokenHash,baseUrl,environment:this.host.providerMode,appEnv:this.host.appEnv})),reviewToken=createHmac('sha256',this.host.sessionSecret).update(canonical(['directory-review-v1',source.tenantId,id,fingerprint])).digest('hex');return{...source,tokenHash,fingerprint,reviewToken,baseUrl};}
 authenticate(id:string,authorization:unknown):DirectoryProvider|undefined{if(typeof authorization!=='string'||!/^Bearer [A-Za-z0-9_-]{43,256}$/i.test(authorization))return undefined;try{const provider=this.current(id),supplied=Buffer.from(digest(authorization.slice(7)),'hex'),expected=Buffer.from(provider.tokenHash,'hex');return timingSafeEqual(supplied,expected)?provider:undefined;}catch{return undefined;}}
 rotate(id:string){const provider=this.current(id),temporary=provider.tokenFile+'.rotate-'+randomUUID();try{const descriptor=fs.openSync(temporary,'wx',0o600);try{fs.writeFileSync(descriptor,randomBytes(48).toString('base64url'));fs.fsyncSync(descriptor);}finally{fs.closeSync(descriptor);}assertNoLinks(provider.tokenFile);fs.renameSync(temporary,provider.tokenFile);return this.current(id);}catch{try{fs.unlinkSync(temporary);}catch{/* A missing temporary file is already unpublished. */}throw new AppError('DIRECTORY_REVOCATION_FAILED','未能撤销目录凭据，请由部署管理员核对私有文件后重试。',503);}}
}
