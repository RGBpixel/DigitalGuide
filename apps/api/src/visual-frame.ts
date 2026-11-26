import {createHash} from 'node:crypto';
import {AppError} from '@digitalguide/domain';
import {inspectMedia} from '@digitalguide/media';
const sha=(value:Buffer)=>createHash('sha256').update(value).digest('hex');
export function visualFrame(value: string) {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) throw new AppError('INVALID_MEDIA', '画面编码无效，请重新截取当前画面。');
  const frame = Buffer.from(value, 'base64');
  if (frame.length < 32 || frame.length > 1_048_576 || !frame.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new AppError('INVALID_MEDIA', '请发送不超过 1 MB 的 PNG 单帧。');
  const width = frame.readUInt32BE(16), height = frame.readUInt32BE(20);
  if (!width || !height || width > 1024 || height > 1024 || width * height > 786432) throw new AppError('INVALID_MEDIA', '画面分辨率过大，请缩小选中区域后重试。');
  inspectMedia(frame); return { frame, width, height, imageHash: sha(frame) };
}
