import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach,beforeEach,describe,expect,it } from 'vitest';
import { systemSpeechVoices,synthesizeSystemSpeech,inspectSystemWav } from '@digitalguide/providers';
import { speechTextInput } from '@digitalguide/contracts';
let dataDir:string;
beforeEach(async()=>{dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'digitalguide-system-speech-'));});
afterEach(async()=>{const target=path.resolve(dataDir);expect(path.dirname(target)).toBe(path.resolve(os.tmpdir()));expect(path.basename(target)).toMatch(/^digitalguide-system-speech-/);await fs.rm(target,{recursive:true,force:true});});
describe.runIf(process.platform==='win32')('T22实际Windows系统声音文件输出',()=>{
 it('可用声音真实列举，停顿改变PCM时长且别名声音与替换文本一致，不冒充克隆',async()=>{
  const voices=await systemSpeechVoices(process.cwd()),voice=voices.find(v=>v.locale==='en-US');expect(voice,'Native English voice is required for this machine-specific proof.').toBeTruthy();expect(voices.every(v=>v.local&&!v.cloned&&!v.id.includes('HKEY'))).toBe(true);
  const render=(text:string,extra:Record<string,unknown>={})=>synthesizeSystemSpeech({root:process.cwd(),dataDir,workDir:path.join(dataDir,'owned samples'),voiceId:voice!.id,speech:speechTextInput.parse({text,locale:'en-US',...extra})});
  const original=await render('API'),alias=await render('API',{dictionary:[{locale:'en-US',term:'API',alias:'application interface'}]}),plain=await render('application interface'),pause=await render('application interface',{controls:{trailingPauseMs:1000}});expect(alias.format.pcmSHA256).toBe(plain.format.pcmSHA256);expect(alias.format.pcmSHA256).not.toBe(original.format.pcmSHA256);expect(pause.format.durationMs-plain.format.durationMs).toBeCloseTo(1000,-1);expect(alias).toMatchObject({provider:'windows-sapi',clonedVoice:false,referenceStyleTransferred:false});expect(inspectSystemWav(await fs.readFile(alias.audioFile)).durationMs).toBeGreaterThan(100);expect((await fs.readdir(path.join(dataDir,'owned samples'))).every(f=>f.endsWith('.wav'))).toBe(true);
 },30000);
 it('缺失声音、错误语言、路径越界和预先取消不返回其他声音或模拟成功',async()=>{
  const voices=await systemSpeechVoices(process.cwd()),speech=speechTextInput.parse({text:'合成测试',locale:'zh-CN'}),input={root:process.cwd(),dataDir,workDir:path.join(dataDir,'owned'),voiceId:'sapi-missing',speech};await expect(synthesizeSystemSpeech(input)).rejects.toThrow('系统声音不可用');const en=voices.find(v=>v.locale==='en-US')!;await expect(synthesizeSystemSpeech({...input,voiceId:en.id})).rejects.toThrow('系统声音不可用');await expect(synthesizeSystemSpeech({...input,workDir:dataDir+'-outside'})).rejects.toThrow('数据目录');const controller=new AbortController();controller.abort();await expect(synthesizeSystemSpeech({...input,signal:controller.signal})).rejects.toThrow('已取消');
 },20000);
});
