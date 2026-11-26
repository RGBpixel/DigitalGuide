import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {aeManifest,aeRuntimeConfig,type AeManifest,type AeRuntimeConfig} from '@digitalguide/contracts';
import {AppError,canonical} from '@digitalguide/domain';
import {normalizeParameterValues} from '../../domain/src/template-controls.js';
import {fileDigest} from '../../media/src/files.js';
export interface AeHost{aeConfigFile?:string;appEnv:'development'|'sandbox'|'production';providerMode:'mock'|'sandbox'|'live'}
export interface AeCatalogEntry{reference:AeRuntimeConfig['catalog'][number];manifest:AeManifest;manifestSHA256:string;directory:string}
export interface AeRuntime{definition:AeRuntimeConfig;runtimeId:string;file:string;simulated:boolean}
const fail=(message:string):never=>{throw new AppError('AE_NOT_AVAILABLE',message,503);};
export const aeHash=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
export function aeManifestRules(m:AeManifest){
 normalizeParameterValues(m.parameters,{});if(m.files.some(f=>/\.(?:exe|dll|js|jsx|jsxbin|bat|cmd|ps1|mjs|cjs|vbs|scr|com)$/i.test(f.path)))fail('AE工程包不能包含可执行程序或脚本，请只登记受信任的工程及媒体。');
 const names=m.files.map(f=>f.path.toLowerCase()),has=(name:string)=>m.files.some(f=>f.path===name);if(new Set(names).size!==names.length||!has(m.projectFile)||!has(m.dataFile)||m.projectFile===m.dataFile||!m.projectFile.toLowerCase().endsWith('.aep')||!m.dataFile.endsWith('.json'))fail('AE工程包需要独立AEP、JSON数据文件及无重复的完整文件清单。');
 if(m.files.reduce((n,f)=>n+f.size,0)>536870912)fail('单个AE工程包最多512 MB，请精简素材。');const duration=m.output.frameCount*1000*m.output.fpsDenominator/m.output.fpsNumerator;if(duration<100||duration>600000||m.output.fpsNumerator/m.output.fpsDenominator>120)fail('AE模板时长需要在0.1秒至10分钟内，帧率最多120。');
 const media=m.parameters.flatMap(p=>p.kind==='asset'?[p.mediaFile]:[]);if(new Set(media.map(p=>p.toLowerCase())).size!==media.length||media.some(p=>!has(p)||p.toLowerCase()===m.projectFile.toLowerCase()||p.toLowerCase()===m.dataFile.toLowerCase()))fail('素材参数需要指向工程包清单中的独立占位素材。');
 const extensions={'image/png':['.png'],'audio/wav':['.wav'],'video/mp4':['.mp4'],'video/quicktime':['.mov']};for(const p of m.parameters)if(p.kind==='asset'&&!extensions[p.mediaType].includes(path.extname(p.mediaFile).toLowerCase()))fail('素材参数格式与占位素材扩展名不一致。');if(m.license.expiresAt&&Date.parse(m.license.expiresAt)<=Date.now())fail('AE工程授权已到期，请管理员更新授权。');return m;
}
export function aeOwnedPath(directory:string,relative:string){const base=path.resolve(directory),file=path.resolve(base,...relative.split('/'));if(!file.startsWith(base+path.sep)||file===base)fail('AE工程包文件路径不在受控目录内。');let current=base;for(const part of relative.split('/')){current=path.join(current,part);if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())fail('AE工程包不允许链接、联接点或跨目录素材。');}return file;}
const executableChecks=new Map<string,string>();
async function pinned(file:string,sha:string,size?:number,cacheExecutable=false){if(!path.isAbsolute(file)||!fs.existsSync(file)||fs.lstatSync(file).isSymbolicLink()||!fs.statSync(file).isFile())fail('受控AE引擎或工程文件缺失，请管理员检查本机配置。');const stat=fs.statSync(file),stamp=[stat.size,stat.mtimeMs,stat.ctimeMs,sha,size].join(':');if(cacheExecutable&&executableChecks.get(file)===stamp)return;const actual=await fileDigest(file);if(actual.sha256!==sha||size!==undefined&&actual.size!==size)fail('AE引擎或工程文件指纹已变化，请重新核对并登记。');if(cacheExecutable)executableChecks.set(file,stamp);}
export async function loadAeRuntime(host:AeHost,verifyEngine=true):Promise<AeRuntime>{
 const configFile=host.aeConfigFile;if(!configFile)return fail('AE适配器已实现；尚未配置本机引擎和授权工程目录，请管理员按接入说明登记。');try{
  if(!path.isAbsolute(configFile)||!fs.existsSync(configFile)||fs.lstatSync(configFile).isSymbolicLink()||fs.statSync(configFile).size>1048576)fail('AE服务端配置缺失或不符合受控文件要求。');const definition=aeRuntimeConfig.parse(JSON.parse(fs.readFileSync(configFile,'utf8').replace(/^\uFEFF/,'')));
  const keys=definition.catalog.map(c=>[c.tenantId,c.workspaceId,c.environment,c.appEnv,c.catalogId,c.catalogRevision].join(':'));if(new Set(keys).size!==keys.length)fail('AE配置中存在重复的授权目录版本。');
  if(definition.mode==='contract_test'&&(host.appEnv==='production'||host.providerMode==='live'))fail('契约测试模式不允许用于生产或真实提供商环境。');
  if(definition.mode==='local_aerender'&&(path.basename(definition.command.file).toLowerCase()!=='aerender.exe'||definition.command.prefixArgs.length||definition.command.prefixFiles.length))fail('真实AE模式只接受固定指纹的aerender.exe，不接受额外脚本或启动参数。');
  if(definition.mode==='contract_test'&&(definition.command.prefixArgs.length!==1||definition.command.prefixFiles.length!==1||definition.command.prefixArgs[0]!==definition.command.prefixFiles[0].file))fail('契约模式需要明确固定指纹的单一测试入口。');if(verifyEngine){await pinned(definition.command.file,definition.command.sha256,undefined,true);for(const file of definition.command.prefixFiles)await pinned(file.file,file.sha256,undefined,true);}
  return{definition,file:definition.command.file,simulated:definition.mode==='contract_test',runtimeId:aeHash({mode:definition.mode,command:definition.command})};
 }catch(e){if(e instanceof AppError)throw e;return fail('AE服务端配置无效，请管理员核对格式、引擎指纹及授权目录。');}
}
export async function loadAeEntry(runtime:AeRuntime,host:AeHost,scope:{tenantId:string;workspaceId:string},catalogId:string,revision:number,verifyFiles=true):Promise<AeCatalogEntry>{
 for(const reference of runtime.definition.catalog){if(reference.catalogId!==catalogId||reference.catalogRevision!==revision||reference.tenantId!==scope.tenantId||reference.workspaceId!==scope.workspaceId||reference.environment!==host.providerMode||reference.appEnv!==host.appEnv)continue;try{
  if(!path.isAbsolute(reference.directory)||!fs.existsSync(reference.directory)||fs.lstatSync(reference.directory).isSymbolicLink()||!fs.statSync(reference.directory).isDirectory())fail('授权AE工程目录不可用，请管理员检查目录。');const directory=fs.realpathSync(reference.directory),file=aeOwnedPath(directory,reference.manifestFile);if(!fs.existsSync(file)||fs.statSync(file).size>1048576)fail('AE工程清单不可用。');const bytes=fs.readFileSync(file),manifest=aeManifest.parse(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')));if(manifest.catalogId!==catalogId||manifest.revision!==revision)fail("AE清单与登记的目录编号/修订不符。");if(createHash('sha256').update(bytes).digest('hex')!==reference.manifestSHA256)fail('AE工程清单指纹已变化，请重新核对配置。');aeManifestRules(manifest);
  if(manifest.files.some(f=>f.path.toLowerCase()===reference.manifestFile.toLowerCase()))fail('AE工程清单不能将自身登记为渲染素材。');if(verifyFiles)for(const f of manifest.files)await pinned(aeOwnedPath(directory,f.path),f.sha256,f.size);return{reference,manifest,manifestSHA256:reference.manifestSHA256,directory};
 }catch(e){if(e instanceof AppError)throw e;return fail('授权AE工程包清单无效，请管理员核对文件、规格和参数。');}}
 return fail('当前组织、空间或运行环境没有此版本AE工程的授权配置。');
}
export async function aeCapability(host:AeHost){try{const runtime=await loadAeRuntime(host);return{available:true,mode:runtime.definition.mode,simulated:runtime.simulated,reason:runtime.simulated?'仅契约测试引擎；结果不代表Adobe渲染。':null};}catch(e){return{available:false,mode:null,simulated:false,reason:e instanceof AppError?e.message:'AE配置暂不可用，请联系管理员。'};}}
