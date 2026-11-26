import fs from 'node:fs';
import path from 'node:path';
import {createHash,createHmac,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import * as client from 'openid-client';
import {z} from 'zod';
import {AppError,canonical} from '../../domain/src/index.js';
export interface IdentityHost{root:string;dataDir:string;appEnv:'development'|'sandbox'|'production';providerMode:'mock'|'sandbox'|'live';webOrigin:string;sessionSecret:string;enterpriseIdentityFile?:string;recoveryValidationOnly?:boolean}
const providerInput=z.strictObject({id:z.uuid(),tenantId:z.uuid(),name:z.string().trim().min(1).max(80),mode:z.enum(['oidc','synthetic_oidc']),issuer:z.url(),authorizationEndpoint:z.url(),tokenEndpoint:z.url(),jwksUri:z.url(),clientId:z.string().min(1).max(255),clientSecretFile:z.string().min(1)});
const fileInput=z.strictObject({version:z.literal(1),environment:z.enum(['mock','sandbox','live']),appEnv:z.enum(['development','sandbox','production']),providers:z.array(providerInput).max(20)});
export interface IdentityProvider{ id:string;tenantId:string;name:string;mode:'oidc'|'synthetic_oidc';issuer:string;issuerHash:string;fingerprint:string;redirectUri:string;configuration:client.Configuration }
export const identityHash=(value:string)=>createHash('sha256').update(value).digest('hex');
const failure=()=>new AppError('SSO_AUTHENTICATION_FAILED','企业登录未完成，请重新登录或联系管理员核对账户绑定。',401);
export class IdentityRuntime{
 readonly providers=new Map<string,IdentityProvider>();readonly fingerprints=new Map<string,string>();
 constructor(readonly host:IdentityHost){
  if(!host.enterpriseIdentityFile)return;if(host.recoveryValidationOnly)throw new AppError('SSO_RECOVERY_FORBIDDEN','恢复隔离副本不能启用企业登录。',503);
  let contents:unknown;try{const file=path.resolve(host.root,host.enterpriseIdentityFile);if(fs.statSync(file).size>65_536)throw new Error();contents=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw new AppError('SSO_CONFIG_INVALID','无法读取企业登录私有配置，请核对文件和权限。',503);}
  const parsed=fileInput.safeParse(contents);if(!parsed.success||parsed.data.environment!==host.providerMode||parsed.data.appEnv!==host.appEnv)throw new AppError('SSO_CONFIG_INVALID','企业登录配置的结构或环境不匹配，请核对私有配置。',503);
  for(const source of parsed.data.providers){
   if(this.providers.has(source.id))throw new AppError('SSO_CONFIG_INVALID','企业登录提供方编号重复。',503);
   const urls=[source.issuer,source.authorizationEndpoint,source.tokenEndpoint,source.jwksUri].map(value=>new URL(value)),synthetic=source.mode==='synthetic_oidc';
   if(synthetic&&(host.appEnv==='production'||host.providerMode!=='mock'))throw new AppError('SSO_CONFIG_INVALID','合成身份源仅限开发/沙箱与mock。',503);
   if(urls.some(url=>url.username||url.password||url.hash||url.search||(synthetic?url.protocol!=='http:'||url.hostname!=='127.0.0.1':url.protocol!=='https:')))throw new AppError('SSO_CONFIG_INVALID','企业登录地址必须是固定的HTTPS地址；合成模式仅允许本机127.0.0.1。',503);
   if(!synthetic&&!host.webOrigin.startsWith('https:'))throw new AppError('SSO_CONFIG_INVALID','企业登录的工作台回调需要HTTPS。',503);
   let secret:string;try{if(!path.isAbsolute(source.clientSecretFile)||fs.statSync(source.clientSecretFile).size>4096)throw new Error();secret=fs.readFileSync(source.clientSecretFile,'utf8').trim();if(secret.length<16||secret.length>2048)throw new Error();}catch{throw new AppError('SSO_CONFIG_INVALID','企业登录客户端密钥需使用有效的私有绝对文件路径。',503);}
   const metadata:client.ServerMetadata={issuer:source.issuer,authorization_endpoint:source.authorizationEndpoint,token_endpoint:source.tokenEndpoint,jwks_uri:source.jwksUri,response_types_supported:['code'],grant_types_supported:['authorization_code'],code_challenge_methods_supported:['S256'],id_token_signing_alg_values_supported:['RS256'],authorization_response_iss_parameter_supported:true};
   const configuration=new client.Configuration(metadata,source.clientId,{client_secret:secret,id_token_signed_response_alg:'RS256',[client.clockTolerance]:0},client.ClientSecretPost(secret));if(synthetic)client.allowInsecureRequests(configuration);client.enableNonRepudiationChecks(configuration);configuration.timeout=10;
   const targets=new Set([source.tokenEndpoint,source.jwksUri]);configuration[client.customFetch]=async(input,init)=>{
    if(!targets.has(String(input)))throw failure();const signal=init?.signal?AbortSignal.any([init.signal,AbortSignal.timeout(10_000)]):AbortSignal.timeout(10_000),body=init.body instanceof Uint8Array?new Uint8Array(init.body).buffer:init.body,response=await fetch(input,{...init,body,signal,redirect:'manual'});
    if(response.status>=300&&response.status<400)throw failure();const length=Number(response.headers.get('content-length')??0);if(length>524_288)throw failure();const reader=response.body?.getReader(),parts:Buffer[]=[];let size=0;try{if(reader)for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>524_288){await reader.cancel();throw failure();}parts.push(Buffer.from(part.value));}}finally{reader?.releaseLock();}return new Response(Buffer.concat(parts),{status:response.status,headers:response.headers});
   };
   const redirectUri=host.webOrigin+'/api/v1/auth/oidc/callback',fingerprint=identityHash(canonical({...source,clientSecretFile:'',clientSecretSHA256:identityHash(secret),redirectUri})),provider={id:source.id,tenantId:source.tenantId,name:source.name,mode:source.mode,issuer:source.issuer,issuerHash:identityHash(source.issuer),fingerprint,redirectUri,configuration};this.providers.set(source.id,provider);this.fingerprints.set(source.id,fingerprint);
  }
 }
 provider(id:string){const provider=this.providers.get(id);if(!provider)throw new AppError('SSO_PROVIDER_UNAVAILABLE','企业登录提供方尚未配置，请联系管理员。',409);return provider;}
 reviewToken(provider:IdentityProvider){return createHmac('sha256',this.host.sessionSecret).update(canonical(['enterprise-provider-review-v1',provider.fingerprint])).digest('hex');}
 subjectHash(provider:IdentityProvider,subject:string){if(!subject||subject.length>255)throw failure();return createHmac('sha256',this.host.sessionSecret).update(canonical(['enterprise-subject-v1',provider.tenantId,this.host.providerMode,this.host.appEnv,provider.id,provider.issuer,subject])).digest('hex');}
 async intent(provider:IdentityProvider){const state=client.randomState(),nonce=client.randomNonce(),verifier=client.randomPKCECodeVerifier(),challenge=await client.calculatePKCECodeChallenge(verifier),url=client.buildAuthorizationUrl(provider.configuration,{response_type:'code',scope:'openid',redirect_uri:provider.redirectUri,state,nonce,code_challenge:challenge,code_challenge_method:'S256',max_age:'300'});return{state,nonce,verifier,authorizationUrl:url.href};}
 seal(id:string,provider:IdentityProvider,secret:{nonce:string;verifier:string}){const iv=randomBytes(12),key=createHash('sha256').update(this.host.sessionSecret+'\0enterprise-oidc-flow-v1').digest(),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(canonical([id,provider.fingerprint])));const encrypted=Buffer.concat([cipher.update(JSON.stringify(secret),'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');}
 open(id:string,provider:IdentityProvider,sealed:string){try{const value=Buffer.from(sealed,'base64url');if(value.length<30||value.length>2048)throw failure();const key=createHash('sha256').update(this.host.sessionSecret+'\0enterprise-oidc-flow-v1').digest(),decipher=createDecipheriv('aes-256-gcm',key,value.subarray(0,12));decipher.setAAD(Buffer.from(canonical([id,provider.fingerprint])));decipher.setAuthTag(value.subarray(12,28));return z.strictObject({nonce:z.string().min(16).max(128),verifier:z.string().min(43).max(128)}).parse(JSON.parse(Buffer.concat([decipher.update(value.subarray(28)),decipher.final()]).toString('utf8')));}catch{throw failure();}}
 async verify(provider:IdentityProvider,url:URL,secrets:{nonce:string;verifier:string},state:string){try{const tokens=await client.authorizationCodeGrant(provider.configuration,url,{expectedState:state,expectedNonce:secrets.nonce,pkceCodeVerifier:secrets.verifier,idTokenExpected:true,maxAge:300}),claims=tokens.claims();if(!claims||typeof claims.sub!=='string'||!claims.sub||claims.sub.length>255||!Number.isSafeInteger(claims.exp))throw failure();return{subject:claims.sub,expiresAt:new Date(claims.exp*1000).toISOString()};}catch{throw failure();}}
}
