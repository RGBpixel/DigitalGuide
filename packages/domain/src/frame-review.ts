import type {FrameAnchor,FrameReviewMedia} from '@digitalguide/contracts';
import {AppError} from './index.js';
export function frameTime(anchor:FrameAnchor,media:Pick<FrameReviewMedia,'fps'|'frames'|'timelineStartMs'>){
  if(!Number.isInteger(anchor.frameIndex)||anchor.frameIndex<0||anchor.frameIndex>=media.frames)throw new AppError('REVIEW_FRAME_RANGE','批注帧号超出这份成片，请重新定位。',422);
  const timeMs=Math.round(anchor.frameIndex*1000/media.fps);return{timeMs,timelineMs:media.timelineStartMs+timeMs};
}
