import { PNG } from 'pngjs';
import { AppError } from '@digitalguide/domain';
import {storedPngMaximumBytes,storedWavMaximumBytes} from '@digitalguide/contracts';
export function inspectStoredWav(buffer:Buffer):{mediaType:'audio/wav';specs:Record<string,number>}{
 const invalid=()=>new AppError('INVALID_MEDIA','已生成或包内PCM WAV内容无效或超过64MB，请核对音频格式或拆分。');
 if(buffer.length<44||buffer.length>storedWavMaximumBytes||buffer.toString('ascii',0,4)!=='RIFF'||buffer.toString('ascii',8,12)!=='WAVE'||buffer.readUInt32LE(4)+8!==buffer.length)throw invalid();
 let offset=12,channels=0,sampleRate=0,byteRate=0,blockAlign=0,dataSize=0,hasFormat=false,hasData=false;
 while(offset+8<=buffer.length){const tag=buffer.toString('ascii',offset,offset+4),size=buffer.readUInt32LE(offset+4),start=offset+8;if(start+size>buffer.length)throw invalid();if(tag==='fmt '){if(hasFormat||hasData||size<16||buffer.readUInt16LE(start)!==1||buffer.readUInt16LE(start+14)!==16)throw invalid();hasFormat=true;channels=buffer.readUInt16LE(start+2);sampleRate=buffer.readUInt32LE(start+4);byteRate=buffer.readUInt32LE(start+8);blockAlign=buffer.readUInt16LE(start+12);}if(tag==='data'){if(!hasFormat||hasData)throw invalid();hasData=true;dataSize=size;}offset=start+size+(size%2);}
 if(offset!==buffer.length||![1,2].includes(channels)||sampleRate<8000||sampleRate>96000||byteRate!==sampleRate*channels*2||blockAlign!==channels*2||!dataSize||dataSize%blockAlign)throw invalid();return{mediaType:'audio/wav',specs:{channels,sampleRate,durationMs:Math.round(dataSize/byteRate*1000)}};
}
export function inspectStoredPng(buffer:Buffer):{mediaType:'image/png';specs:Record<string,number>}{
 const invalid=()=>new AppError('INVALID_MEDIA','PNG内容无效或超出64MB封装/16777216像素限制，请降低尺寸后重试。');
 if(buffer.length<32||buffer.length>storedPngMaximumBytes||!buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw invalid();const width=buffer.readUInt32BE(16),height=buffer.readUInt32BE(20);if(!width||!height||width*height>16777216)throw invalid();try{const png=PNG.sync.read(buffer,{checkCRC:true});return{mediaType:'image/png',specs:{width:png.width,height:png.height}};}catch{throw invalid();}
}
export function inspectMedia(buffer: Buffer): { mediaType: string; specs: Record<string, number> } {
  const invalid = () => new AppError('INVALID_MEDIA', '文件内容无效。首版支持 PNG 图片和 PCM WAV 音频，请转换格式后重试。');
  if (buffer.length < 32 || buffer.length > 8 * 1024 * 1024) throw invalid();
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    const width = buffer.readUInt32BE(16), height = buffer.readUInt32BE(20);
    if (!width || !height || width * height > 16_777_216) throw invalid();
    try { const png = PNG.sync.read(buffer, { checkCRC: true }); return { mediaType: 'image/png', specs: { width: png.width, height: png.height } }; } catch { throw invalid(); }
  }
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE' && buffer.readUInt32LE(4) + 8 === buffer.length) {
    let offset = 12, channels = 0, sampleRate = 0, byteRate = 0, blockAlign = 0, dataSize = 0;
    while (offset + 8 <= buffer.length) {
      const tag = buffer.toString('ascii', offset, offset + 4), size = buffer.readUInt32LE(offset + 4), start = offset + 8;
      if (start + size > buffer.length) throw invalid();
      if (tag === 'fmt ') {
        if (size < 16 || buffer.readUInt16LE(start) !== 1 || buffer.readUInt16LE(start + 14) !== 16) throw invalid();
        channels = buffer.readUInt16LE(start + 2); sampleRate = buffer.readUInt32LE(start + 4); byteRate = buffer.readUInt32LE(start + 8); blockAlign = buffer.readUInt16LE(start + 12);
      }
      if (tag === 'data') dataSize += size;
      offset = start + size + (size % 2);
    }
    if (offset !== buffer.length || ![1, 2].includes(channels) || sampleRate < 8000 || sampleRate > 96000 || byteRate !== sampleRate * channels * 2 || blockAlign !== channels * 2 || !dataSize || dataSize % blockAlign) throw invalid();
    return { mediaType: 'audio/wav', specs: { channels, sampleRate, durationMs: Math.round(dataSize / byteRate * 1000) } };
  }
  throw invalid();
}
export function syntheticPng(color: [number, number, number] = [28, 97, 96]) {
  const png = new PNG({ width: 360, height: 240 });
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    const i = (y * png.width + x) * 4;
    const head = (x - 180) ** 2 + (y - 86) ** 2 < 32 ** 2;
    const body = ((x - 180) / 72) ** 2 + ((y - 206) / 80) ** 2 < 1;
    const grid = x % 40 === 0 || y % 40 === 0;
    png.data[i] = head || body ? 204 : color[0] + (grid ? 9 : 0);
    png.data[i + 1] = head || body ? 226 : color[1] + (grid ? 9 : 0);
    png.data[i + 2] = head || body ? 213 : color[2] + (grid ? 9 : 0);
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}
export function syntheticToneWav(durationMs: number, frequency = 440, quiet = false) {
  if (!Number.isFinite(durationMs) || durationMs < 100 || durationMs > 5000 || frequency < 100 || frequency > 2000) throw new AppError('INVALID_MEDIA', '模拟提示音参数不符合要求。');
  const rate = 16000, samples = Math.round(rate * durationMs / 1000), wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) { const envelope = Math.min(1, i / 400, (samples - i) / 400); wav.writeInt16LE(Math.round(Math.sin(i * frequency * Math.PI * 2 / rate) * (quiet ? 800 : 1500) * envelope), 44 + i * 2); }
  return wav;
}
