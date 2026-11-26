import fs from 'node:fs/promises';
import path from 'node:path';
import {AppError} from '../../domain/src/index.js';
import {NativeMediaFiles} from './runtime-media-files.js';
import type {NativeRuntimeConfig} from './runtime-config.js';
import type {NativeObject} from './runtime-objects.js';
// Hash on an open handle while heartbeat is still active; retain file identity across commit.
export async function sealNativeAeObjects(config:NativeRuntimeConfig,objects:NativeObject[]){const opened:Awaited<ReturnType<NativeMediaFiles['open']>>[]=[],stamps:Awaited<ReturnType<fs.FileHandle['stat']>>[]=[];try{for(const object of objects){const file=await new NativeMediaFiles(config).open({...object,media_type:'application/octet-stream'});opened.push(file);stamps.push(await file.handle.stat());}return{async unchanged(){for(let i=0;i<opened.length;i++){const before=stamps[i]!,after=await opened[i].handle.stat(),file=path.join(config.dataDir,'objects',objects[i].storage_key),named=await fs.lstat(file);if(!named.isFile()||named.isSymbolicLink()||[after,named].some(s=>s.size!==before.size||s.ino!==before.ino||s.dev!==before.dev||s.mtimeMs!==before.mtimeMs||s.ctimeMs!==before.ctimeMs))throw new AppError('AE_OUTPUT_CHANGED','AE私有输出在核验后发生变化，未确认提交。',409);}},async close(){await Promise.all(opened.map(v=>v.handle.close()));}};}catch(e){await Promise.allSettled(opened.map(v=>v.handle.close()));throw e;}}
