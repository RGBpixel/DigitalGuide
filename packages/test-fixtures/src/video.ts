import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mediaTools,runMediaTool } from '../../media/src/media-tools.js';
export async function originalVideoFixture(directory: string,root = process.cwd(),options: { audio?: boolean;padding?: number;portrait?: boolean;width?: number;height?: number;fps?: number;durationMs?: number } = {}) {
  fs.mkdirSync(directory,{ recursive: true });const file = path.join(directory,randomUUID()+'.mp4'),width = options.width || (options.portrait ? 360 : 640),height = options.height || (options.portrait ? 640 : 360),duration = (options.durationMs || 4000)/1000;
  const video = `color=c=0xC02020:s=${width}x${height}:r=${options.fps || 25}:d=${duration},drawbox=x=0:y=0:w=iw:h=ih:color=0x2244CC:t=fill:enable='gte(t,1)',drawbox=x=0:y=0:w=iw:h=ih:color=0x22AA44:t=fill:enable='gte(t,2)',drawbox=x=0:y=0:w=iw:h=ih:color=0xDDCC22:t=fill:enable='gte(t,3)',drawbox=x=iw/2:y=0:w=iw/2:h=ih:color=white:t=fill`;
  const audio = "aevalsrc=0.05*sin(2*PI*if(lt(t\\,1)\\,400\\,if(lt(t\\,2)\\,700\\,if(lt(t\\,3)\\,1000\\,1400)))*t):s=48000:d=4";
  await runMediaTool(mediaTools(root).ffmpeg,['-v','error','-nostdin','-n','-f','lavfi','-i',video,...(options.audio !== false ? ['-f','lavfi','-i',audio] : []),'-c:v','libx264','-preset','ultrafast','-crf','18','-threads','2','-pix_fmt','yuv420p',...(options.audio !== false ? ['-c:a','aac','-b:a','128k'] : ['-an']),'-t',String(duration),'-movflags','+faststart',file],undefined,30000);
  if (options.padding) { const block = Buffer.alloc(options.padding);if (block.length < 8) throw new Error('MP4 free box must be at least 8 bytes');block.writeUInt32BE(block.length,0);block.write('free',4);fs.appendFileSync(file,block); }
  return file;
}
