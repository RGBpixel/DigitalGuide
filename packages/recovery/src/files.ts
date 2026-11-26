import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {RecoveryError,recoveryPolicyFile} from './guard.js';

export const defaultLimits={maxBytes:100*1024**3,maxFiles:100_000,maxRows:1_000_000};
export type RecoveryLimits=typeof defaultLimits;
export function limits(input?:Partial<RecoveryLimits>):RecoveryLimits{
  const value={...defaultLimits,...input};
  if(Object.values(value).some(v=>!Number.isSafeInteger(v)||v<1))throw new RecoveryError('RECOVERY_LIMIT_INVALID','备份限制必须是正整数。');
  return value;
}
export function checkCancelled(signal?:AbortSignal){if(signal?.aborted)throw new RecoveryError('RECOVERY_CANCELLED','操作已取消，未发布的文件会清理。');}
export function within(file:string,dir:string){const rel=path.relative(dir,file);return rel===''||(!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep));}
export function assertNoLinks(file:string,allowMissing=false){
  let current=path.resolve(file);
  while(true){try{if(fs.lstatSync(current).isSymbolicLink())throw new RecoveryError('RECOVERY_LINK_FORBIDDEN','备份、密钥和恢复位置不能使用符号链接或目录联接。');}catch(e){if(!(allowMissing&&e instanceof Error&&'code'in e&&e.code==='ENOENT'))throw e;}
    const parent=path.dirname(current);if(parent===current)break;current=parent;
  }
}
export function dataRoot(input:string,mustExist:boolean){
  const value=path.resolve(input);if(path.dirname(value)===value)throw new RecoveryError('RECOVERY_ROOT_INVALID','不能把磁盘根目录用作数据目录。');assertNoLinks(value,!mustExist);
  if(mustExist&&!fs.statSync(value).isDirectory())throw new RecoveryError('RECOVERY_ROOT_INVALID','请选择已有的专用数据目录。');
  return value;
}
export function safeRelative(value:string){
  const parts=value.split('/');
  if(!value||value.length>1024||parts.length>40||parts.some(p=>!p||p==='.'||p==='..'||/[\\:<>"|?*]/.test(p)||[...p].some(c=>c.charCodeAt(0)<32)||/[ .]$/.test(p)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))throw new RecoveryError('RECOVERY_PATH_INVALID','备份含有不安全、冲突或不支持的文件路径。');
  return value;
}
export function pathKey(value:string){return value.normalize('NFC').toLowerCase();}
export interface Inventory {files:{relative:string;absolute:string;bytes:number;stamp:string}[];directories:string[]}
function stamp(s:fs.Stats){return[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':');}
export function inventory(root:string,cap:RecoveryLimits):Inventory{
  const files:Inventory['files']=[],directories:string[]=[],names=new Set<string>();let bytes=0;
  function visit(dir:string,relative=''){
    for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
      const rel=relative?relative+'/'+entry.name:entry.name;
      if(!relative&&['digitalguide.sqlite-wal','digitalguide.sqlite-shm',recoveryPolicyFile].includes(entry.name))continue;
      safeRelative(rel);const key=pathKey(rel);if(names.has(key))throw new RecoveryError('RECOVERY_PATH_INVALID','目录含有大小写或规范化冲突路径。');names.add(key);if(names.size>cap.maxFiles)throw new RecoveryError('RECOVERY_LIMIT_EXCEEDED','文件与目录总数超过备份限制。');
      const full=path.join(root,...rel.split('/')),s=fs.lstatSync(full);
      if(s.isSymbolicLink())throw new RecoveryError('RECOVERY_LINK_FORBIDDEN','数据目录含有符号链接或目录联接，请先核对存储边界。');
      if(s.isDirectory()){directories.push(rel);visit(full,rel);}else if(s.isFile()){if(!Number.isSafeInteger(s.size)||(bytes+=s.size)>cap.maxBytes)throw new RecoveryError('RECOVERY_LIMIT_EXCEEDED','私有文件超过备份容量限制。');files.push({relative:rel,absolute:full,bytes:s.size,stamp:stamp(s)});}else throw new RecoveryError('RECOVERY_FILE_TYPE','数据目录含有不支持的特殊文件。');
    }
  }
  visit(root);return{files,directories:directories.sort()};
}
export async function hashFile(file:string,signal?:AbortSignal){const h=createHash('sha256');for await(const chunk of fs.createReadStream(file)){checkCancelled(signal);h.update(chunk);}return h.digest('hex');}
export async function copyChecked(file:Inventory['files'][number],target:string,signal?:AbortSignal){
  assertNoLinks(file.absolute);if(stamp(fs.statSync(file.absolute))!==file.stamp)throw new RecoveryError('RECOVERY_SOURCE_CHANGED','备份期间原文件发生变化，请停止相关写入后重新备份。');
  fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});const h=createHash('sha256');let bytes=0;
  const meter=new Transform({transform(chunk,_,done){bytes+=chunk.length;h.update(chunk);done(null,chunk);}});
  await pipeline(fs.createReadStream(file.absolute),meter,fs.createWriteStream(target,{flags:'wx',mode:0o600,flush:true}),{signal});
  if(bytes!==file.bytes||stamp(fs.statSync(file.absolute))!==file.stamp)throw new RecoveryError('RECOVERY_SOURCE_CHANGED','备份期间原文件发生变化，请停止相关写入后重新备份。');
  return{path:file.relative,bytes,sha256:h.digest('hex')};
}
export function removeOwnedTree(directory:string,parent:string,prefix:string){
  const full=path.resolve(directory),base=path.resolve(parent);if(path.dirname(full)!==base||!path.basename(full).startsWith(prefix)||full===base)throw new RecoveryError('RECOVERY_CLEANUP_SCOPE','临时目录范围校验失败，保留现场供运维检查。');
  assertNoLinks(full);fs.rmSync(full,{recursive:true,force:true});
}
