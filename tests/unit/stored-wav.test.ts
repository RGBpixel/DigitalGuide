import {describe,it,expect} from 'vitest';
import {inspectMedia,inspectStoredWav,syntheticToneWav} from '@digitalguide/media';
function wav(bytes:number){const out=Buffer.alloc(bytes+44);out.write('RIFF');out.writeUInt32LE(out.length-8,4);out.write('WAVEfmt ',8);out.writeUInt32LE(16,16);out.writeUInt16LE(1,20);out.writeUInt16LE(1,22);out.writeUInt32LE(22050,24);out.writeUInt32LE(44100,28);out.writeUInt16LE(2,32);out.writeUInt16LE(16,34);out.write('data',36);out.writeUInt32LE(bytes,40);return out;}
describe('生成和开放包PCM WAV的独立64MB边界',()=>{
 it('较大的合法PCM可读取，普通网页上传的8MB边界保持',()=>{const bytes=wav(9*1024*1024);expect(inspectStoredWav(bytes)).toMatchObject({mediaType:'audio/wav',specs:{channels:1,sampleRate:22050}});expect(()=>inspectMedia(bytes)).toThrow();});
 it('允许恰好64MB的文件并拒绝超限和RIFF长度不符',()=>{expect(inspectStoredWav(wav(64*1024*1024-44)).specs.durationMs).toBeGreaterThan(0);expect(()=>inspectStoredWav(wav(64*1024*1024-42))).toThrow();const b=wav(100);b.writeUInt32LE(1,4);expect(()=>inspectStoredWav(b)).toThrow();});
 it('拒绝重复fmt和data块，避免检查和解码得到不同格式或内容',()=>{const b=syntheticToneWav(250);for(const chunk of [b.subarray(12,36),b.subarray(36)]){const duplicate=Buffer.concat([b,chunk]);duplicate.writeUInt32LE(duplicate.length-8,4);expect(()=>inspectStoredWav(duplicate)).toThrow();}});
 it('拒绝data先于格式、字节率或块对齐错误和截断数据',()=>{const b=wav(100),reordered=Buffer.concat([b.subarray(0,12),b.subarray(36),b.subarray(12,36)]);expect(()=>inspectStoredWav(reordered)).toThrow();for(const offset of [28,32,40]){const broken=Buffer.from(b);broken.writeUInt32LE(3,offset);expect(()=>inspectStoredWav(broken)).toThrow();}});
 it('允许一致的双声道PCM和有填充的未知元数据块',()=>{const b=wav(100),meta=Buffer.from([74,85,78,75,1,0,0,0,7,0]),withMeta=Buffer.concat([b.subarray(0,36),meta,b.subarray(36)]);withMeta.writeUInt32LE(withMeta.length-8,4);withMeta.writeUInt16LE(2,22);withMeta.writeUInt32LE(88200,28);withMeta.writeUInt16LE(4,32);expect(inspectStoredWav(withMeta).specs.channels).toBe(2);});
});
