import {describe,it,expect} from 'vitest';
import {PNG} from 'pngjs';
import {blankStudioDocument} from '@digitalguide/contracts';
import {enableTimeline} from '../../packages/domain/src/timeline.js';
import {renderStoryboard} from '../../packages/media/src/storyboard-preview.js';
import {createTimelineRenderer} from '../../packages/media/src/timeline-frame.js';
const text='您好，欢迎来到数字导览体验中心。这是一段原创的合成测试文案，不包含真实访客资料。展厅每天上午九点开放，下午五点结束，星期三闭馆。团体来访需要提前两天预约，参观免费。如果您需要帮助，请联系现场工作人员。系统会保存校对记录，您可以更正文字和时间，也可以撤回本次用途。感谢您的来访，祝您参观愉快。';
function document(){const doc=blankStudioDocument();doc.segments[0].text=text;doc.segments[0].durationMs=39745;doc.segments[0].elements=[];return doc;}
function bottomInk(png:PNG){let bottom=-1;for(let y=Math.floor(png.height*.855);y<Math.ceil(png.height*.935);y++)for(let x=Math.floor(png.width*.073);x<Math.ceil(png.width*.927);x++){const i=(y*png.width+x)*4;if(png.data[i]<235&&png.data[i+3]>200)bottom=Math.max(bottom,y);}return bottom;}
const completeInkLimit=(png:PNG)=>Math.floor(png.height*.935-Math.max(png.height/1080,png.height*.027*.08))-2;
describe('R-077 与75失败画面相同的长段落字幕完整字形回归',()=>{
 it('静态分镜底部应留完整字形间距，不能把第三行裁到字幕框下沿',async()=>{const doc=document(),result=await renderStoryboard(doc,doc.segments[0].id,()=>{throw Error('No image fixture');}),png=PNG.sync.read(result.bytes),bottom=bottomInk(png);expect(bottom).toBeGreaterThan(0);expect(bottom).toBeLessThanOrEqual(completeInkLimit(png));});
 it('时间线预览不能把长段落第三行切出半行字',async()=>{const doc=document();enableTimeline(doc);const renderer=await createTimelineRenderer(doc,()=>{throw Error('No image fixture');}),frame=renderer.render(500,false),png=PNG.sync.read(await frame.canvas.encode('png')),bottom=bottomInk(png);expect(bottom).toBeGreaterThan(0);expect(bottom).toBeLessThanOrEqual(completeInkLimit(png));});
});
