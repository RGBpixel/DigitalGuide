import {describe,it,expect} from 'vitest';
import {frameAnchor} from '@digitalguide/contracts';
import {frameTime} from '../../packages/domain/src/frame-review.js';
describe('固定成片帧定位',()=>{
  it('24帧率的最后一帧使用0起点并映射回原工程区间，坐标不依赖代理分辨率',()=>{const anchor=frameAnchor.parse({frameIndex:35,x:1,y:0});expect(frameTime(anchor,{fps:24,frames:36,timelineStartMs:4500})).toEqual({timeMs:1458,timelineMs:5958});expect(()=>frameTime({...anchor,frameIndex:36},{fps:24,frames:36,timelineStartMs:0})).toThrow('超出');expect(()=>frameAnchor.parse({frameIndex:0,x:.5})).toThrow();expect(()=>frameAnchor.parse({frameIndex:0,x:1.01,y:.5})).toThrow();});
});
