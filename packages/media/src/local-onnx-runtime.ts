import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {canonical,AppError} from '@digitalguide/domain';
const require=createRequire(import.meta.url),hashes=new Map<string,{stamp:string;hash:string}>();
export const sha256=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
export function localFileHash(file:string,force=false){const s=fs.statSync(file),stamp=s.size+':'+s.mtimeMs+':'+s.ctimeMs,prior=hashes.get(file);if(!force&&prior?.stamp===stamp)return prior.hash;const hash=sha256(fs.readFileSync(file));hashes.set(file,{stamp,hash});return hash;}
export function localOnnxRuntime(force=false){const entry=require.resolve('onnxruntime-web'),directory=path.dirname(entry),metadata=JSON.parse(fs.readFileSync(path.join(directory,'../package.json'),'utf8')) as {version:string};if(metadata.version!=='1.31.1')throw new AppError('MEDIA_RUNTIME_CHANGED','本机推理运行时版本与批准配置不同，请按锁文件恢复依赖后重新审阅。',409);const files=['ort.node.min.mjs','ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm'];return{runtime:'onnxruntime-web-wasm' as const,runtimeVersion:'1.31.1' as const,runtimeSha256:sha256(canonical(files.map(name=>({name,sha256:localFileHash(path.join(directory,name),force)}))))};}
