import type {MediaProcessingPayload,MediaProcessingOutput} from '@digitalguide/contracts';
import {isVideoMediaType} from '@digitalguide/contracts';
import {AppError} from './index.js';
import type {StudioDocument} from '@digitalguide/contracts';
import {semanticWindows} from './semantic-clips.js';
import {restorationRange,restorationWork} from './restoration.js';
import {gazeWork} from './gaze.js';
const invalid=(message:string)=>new AppError('MEDIA_CONFIGURATION_INVALID',message,409);
export const modelMediaOperations=['gaze','segmentation','subject_tracking','semantic_split','restore','neural_denoise'];
export function mediaProcessingPlan(payload:MediaProcessingPayload){
  const {source:s,configuration:c}=payload,video=isVideoMediaType(s.mediaType),image=s.mediaType==='image/png',audio=s.mediaType==='audio/wav',duration=s.specs.durationMs||0;
  if(!['image/png','audio/wav','video/mp4','video/quicktime'].includes(s.mediaType))throw invalid('此素材格式还不能用于媒体加工。');
  if(!image&&(!Number.isFinite(duration)||duration<100||duration>600000))throw invalid('原素材时长无效或超过10分钟，请先转换和检查。');
  if(['denoise','neural_denoise'].includes(c.operation)&&!(audio||video&&s.specs.hasAudio))throw invalid('离线降噪需要WAV或带原声的视频。');
  if(['key','reframe','enhance','gaze','segmentation','subject_tracking','restore'].includes(c.operation)&&!(image||video))throw invalid('此画面处理需要图片或视频。');
  if(['split','scene_suggest','semantic_split'].includes(c.operation)&&!video&&!audio)throw invalid('分段处理需要视频或音频。');
  if(c.operation==='scene_suggest'&&!video)throw invalid('镜头变化建议需要视频画面。');
  if(c.provider==='local-media'&&modelMediaOperations.includes(c.operation)&&!(['gaze','segmentation','subject_tracking','semantic_split','restore','neural_denoise'].includes(c.operation)&&payload.engine))throw new AppError('MEDIA_MODEL_NOT_CONFIGURED','当前没有接入此模型；可选择明确模拟来审阅流程，或接入真实模型后重试。',409);
  if(payload.engine&&!(c.provider==='local-media'&&['gaze','segmentation','subject_tracking','semantic_split','restore','neural_denoise'].includes(c.operation)))throw invalid('此操作不能附带模型引擎快照。');
  if(payload.engine&&['segmentation','subject_tracking'].includes(c.operation)&&payload.engine.modelId!=='u2netp-rembg-v0')throw invalid('前景操作需要已批准的前景模型。');
  if(c.operation==='restore'&&c.provider==='local-media'){if(payload.engine?.modelId!=='realesr-general-x4v3-fp32')throw invalid('本机修复需要已批准的全精度模型。');if(c.instruction.trim())throw invalid('本机修复不读取文字指令，请清空提示词后重新保存；可调整倍率和融合强度。');restorationWork(payload);}
  if(c.operation==='gaze'&&c.provider==='local-media')gazeWork(payload);
  if(c.operation==='neural_denoise'&&c.provider==='local-media'&&(payload.engine?.modelId!=='deepfilternet3-onnx-v0.5.6'||![1,2].includes(s.specs.channels)||!Number.isSafeInteger(s.specs.sampleRate)||s.specs.sampleRate<8000||s.specs.sampleRate>96000))throw invalid('神经降噪需要已批准模型、8—96kHz单声道或双声道原声。');
  if(payload.semanticSource&&!(c.operation==='semantic_split'&&c.provider==='local-media'))throw invalid('仅本机语义分析可以附带带时间校对稿快照。');
  if(payload.semanticBasis&&!(c.operation==='split'&&c.provider==='local-media'))throw invalid('语义候选采用后保留为实际分段方案，请另建其他操作。');
  if(c.operation==='semantic_split'&&c.provider==='local-media'){if(!video||!payload.semanticSource||!c.semantic||c.semantic.contentSourceId!==payload.semanticSource.contentSourceId||payload.engine?.modelId!=='multilingual-e5-small-quantized')throw invalid('本机语义切片需要已确认的视频短语时间及语义模型，请重新保存并审阅。');semanticWindows(payload.semanticSource,c);}
  if(c.operation==='segmentation'&&payload.engine&&'trackingPolicy'in payload.engine)throw invalid('分割方案不能使用主体跟踪策略。');
  if(c.operation==='subject_tracking'&&c.provider==='local-media'&&(!c.tracking||!payload.engine||!('trackingPolicy'in payload.engine)))throw invalid('本机主体跟踪需要起始点、输出构图与已批准跟踪引擎，请重新保存并审阅。');
  if(c.operation==='subject_tracking'&&c.provider==='local-media'&&c.instruction.trim())throw invalid('本机跟踪使用起始画面点选，不读取人物姓名或文字提示；请清空提示词后重新保存。');
  if(c.provider==='local-media'&&c.operation==='segmentation'&&c.instruction.trim())throw invalid('本机通用前景模型不读取文字提示，请清空指令后重新保存；它不按名字选择某个人。');
  let width=s.specs.width||null,height=s.specs.height||null;
  if(width&&height){if(width<16||height<16||width>4096||height>4096)throw invalid('画面必须在16至4096像素单边内，请先转换。');
    if(c.operation==='subject_tracking'&&c.provider==='local-media'&&c.tracking){const ratio={landscape:16/9,portrait:9/16,square:1}[c.tracking.aspect];width=ratio>=1?c.tracking.longestSide:Math.round(c.tracking.longestSide*ratio);height=ratio>=1?Math.round(c.tracking.longestSide/ratio):c.tracking.longestSide;
    }else if(c.operation==='restore'&&c.provider==='local-media'&&c.restoration){width*=c.restoration.scale;height*=c.restoration.scale;
    }else if(c.operation==='reframe'){
      const ratios={landscape:16/9,portrait:9/16,square:1,source:width*c.crop.width/(height*c.crop.height)},ratio=ratios[c.aspect];width=ratio>=1?c.longestSide:Math.round(c.longestSide*ratio);height=ratio>=1?Math.round(c.longestSide/ratio):c.longestSide;
    }else if(c.operation==='enhance'&&c.scale!=='source'){const factor=c.scale==='double'?2:3840/Math.max(width,height);width=Math.round(width*factor);height=Math.round(height*factor);}
    if(video){width=Math.floor(width/2)*2;height=Math.floor(height/2)*2;}
    if(width<16||height<16||width>4096||height>4096||width*height>16777216)throw invalid('输出尺寸超出16至4096像素限制，请降低尺寸。');
  }
  const alpha=image||c.operation==='key'||c.operation==='segmentation'||s.mediaType==='video/quicktime',mediaType=image?'image/png':video?(alpha?'video/quicktime':'video/mp4'):'audio/wav';
  const make=(name:string,startMs:number,durationMs:number|null)=>({name:name.slice(0,80),mediaType,width,height,startMs,durationMs,alpha:image||video?alpha:false});
  let outputs:ReturnType<typeof make>[]=[];
  if(c.operation==='semantic_split'&&c.provider==='local-media'){/* 先生成候选报告，明确选择后才编码成片。 */}
  else if(c.operation==='scene_suggest'){if(c.minClipMs>c.maxClipMs)throw invalid('最短片段不能超过最长片段。');}
  else if(c.operation==='split'){
    if(c.ranges.reduce((n,r)=>n+r.durationMs,0)>1200000)throw invalid('一次分段总输出最多20分钟，请拆成多项任务。');
    for(const r of c.ranges){if(r.startMs+r.durationMs>duration)throw invalid('分段超出原素材时长，请重新核对起点和长度。');outputs.push(make(r.name,r.startMs,r.durationMs));}
  }else{
    if(image&&(c.startMs||c.durationMs!==null))throw invalid('图片不支持音视频时间范围，请保留起点0和完整图片。');
    const length=image?null:c.durationMs??duration-c.startMs;if(!image&&(length!<100||c.startMs+length!>duration))throw invalid('加工区间超出原素材或不足100毫秒。');
    if(video&&c.operation==='gaze'&&c.provider==='local-media'){const range=gazeWork(payload);outputs=[make(payload.name,range.startMs,range.durationMs)];
    }else if(video&&c.operation==='restore'&&c.provider==='local-media'){const range=restorationRange(payload);outputs=[make(payload.name,range.startMs,range.durationMs)];
    }else if(video&&c.operation==='subject_tracking'&&c.provider==='local-media'){
      const fps=s.specs.fps;if(!Number.isFinite(fps)||fps<=0||fps>60)throw invalid('跟踪原片帧率无效，请重新检查视频。');const first=Math.round(c.startMs*fps/1000),aligned=Math.round(first*1000/fps);if(Math.abs(aligned-c.startMs)>1)throw invalid(`跟踪起点需要按原片帧对齐，最近起点为${aligned}毫秒；请使用“对齐到原片帧”后重新核对。`);const frames=c.durationMs===null?Math.floor((duration-first*1000/fps)*fps/1000+fps/1000+1e-6):Math.round(c.durationMs*fps/1000),alignedDuration=Math.round(frames*1000/fps);if(frames<1||alignedDuration<100||(first+frames)*1000/fps>duration+1)throw invalid('对齐后的跟踪区间不足100毫秒或超出原片，请缩短范围。');if(c.durationMs!==null&&Math.abs(alignedDuration-c.durationMs)>1)throw invalid(`跟踪时长需要按原片帧对齐，最近时长为${alignedDuration}毫秒；请使用“对齐到原片帧”。`);outputs=[make(payload.name,aligned,alignedDuration)];
    }else outputs=[make(payload.name,c.startMs,length)];
  }
  if(audio&&outputs.some(o=>(o.durationMs||0)/1000*s.specs.sampleRate*s.specs.channels*2+4096>8388608))throw invalid('WAV输出预计超过8 MB，请缩短每段时长。');
  const warnings=['原素材保持不变；处理结果需明确应用到工程，或单独下载。','输出仍受原素材版本、上游用途及本方案期限约束。'];
  if(c.operation==='neural_denoise'&&c.provider==='local-media')warnings.push('实际本机DeepFilterNet3人声降噪，处理所有人声与噪声，不锁定某个人、不授予身份权限，也不是目标说话人分离。','固定48k模型时延补偿并补足输入尾部，输出保留原采样率/声道和视频尺寸/Alpha；可能改变语音音色、尾音及音乐，请逐段听审。','这是离线文件处理，不代表实时抗噪/回声消除、语音识别准确率或真实现场效果。');
  if(c.operation==='denoise')warnings.push('频谱降噪处理整段原声，不识别说话人，也不提供接待场景的目标声纹锁定。');
  if(c.operation==='key')warnings.push('纯色键控需要可分离的单色背景；不是自动人像分割，可能影响相近颜色和边缘。');
  if(c.operation==='segmentation'&&c.provider==='local-media')warnings.push('实际U²-Net-P模型在本机CPU逐帧计算通用显著前景，输入遮罩320×320再映射到原画面；不识别人脸/身份，不保证复杂发丝、透明物体或视频时序稳定。','边缘收紧0.5保留模型原遮罩，较大值收紧、较小值放松；请对照原片逐段检查，不能当作真人克隆或4K细节重建。','长视频的本机逐帧处理可能耗时较长，可选择范围、随时取消；流式解码/编码不保存整段原始帧。');
  if(c.operation==='reframe')warnings.push('按手工裁切和固定比例重构画面，不执行人物跟踪。');
  if(c.operation==='subject_tracking'&&c.provider==='local-media')warnings.push('起始帧点选显著前景，使用本机320×320遮罩、外观及运动连续性跟随；不识别人脸、姓名或身份，也不保证多人交叉/遮挡后仍是同一人。','目标短时失锁保持上一个构图，超过允许时间或场景切换时明确失败，不静默换到其他主体；请逐段核对轨迹和原片。','自动跟随输出比例并保留原声，主体较宽时可能留边；结果是已编码裁切，可在独立工程继续编辑，原片不变。','本机CPU逐帧处理可能耗时较长，支持范围与取消；320遮罩不代表原生4K细节或实时性能。');
  if(c.operation==='enhance')warnings.push('执行常规缩放、去噪、锐化、色彩和去隔行滤镜；不声称恢复已经丢失的细节。');
  if(c.operation==='restore'&&c.provider==='local-media')warnings.push('实际Real-ESRGAN对RGB推理并提供1/2/4倍输出，1/2倍由原生4倍结果面积缩回；融合强度控制模型结果与原画面缩放的混合。','模型会推测纹理，不能保证还原已经丢失的内容；没有专门的人脸、划痕、色彩修复或跨帧稳定模型，请逐段对照原片。','透明度独立按原图插值，完全透明RGB清零，原视频声音通道/采样率保留。输出尺寸不代表原生同等细节。','本机CPU逐帧可能耗时较长，最多4096次分块推理，支持短区间、取消和同一任务恢复；不作为实时或真实老片质量验收。');
  if(c.operation==='gaze'&&c.provider==='local-media')warnings.push('本机关键点辅助几何纠偏，只在当前眼眶内小幅移动已有纹理；不估计真实视线角度，不生成或补画眼睛，不等于神经视线重定向。','仅适合单人正面、小幅纠偏。闭眼保持闭合，多人/检测不稳/姿态超范围的帧保持原画面；缺失时不沿用旧眼部位置。','输出保留原尺寸、逐帧Alpha与原声。请逐帧核对眼睑、眨眼与抖动；真实人物及其他硬件效果需独立验收。');
  if(c.operation==='scene_suggest')warnings.push('仅根据画面变化提供镜头候选；不会理解台词、生成爆款片段或自动发布。');
  if(c.operation==='semantic_split'&&c.provider==='local-media')warnings.push('使用本机多语言语义向量按主题检索整段短语，分数是相对余弦相似度，不是准确率或传播效果预测。','候选边界来自已确认的短语时间；超出最长时长或跨越分析边界的短语不硬切，需先调整校对稿。完整保留原话，人工选择候选后再输出视频。','候选及派生成片继承校对稿、原视频和分析用途限制；撤回任一上游后停止预览、下载和工程复用。');
  if(payload.semanticBasis)warnings.push('这是明确采用语义候选的实际分段方案；校对稿和原分析用途撤回会限制本方案、成片及其工程。');
  if(alpha&&video)warnings.push('透明原件输出ProRes 4444 MOV，体积较大；网页播放代理使用浅色背景，工程渲染保留透明通道。');
  if(c.provider==='mock-media')warnings.push('明确模拟只返回流程报告，不生成或登记处理后的媒体，不能用作真实算法验收。');
  return{outputs:c.provider==='mock-media'?[]:outputs,warnings,simulated:c.provider==='mock-media'};
}
export function replaceProcessedClip(document:StudioDocument,clipId:string,sourceId:string,sourceDurationMs:number,output:MediaProcessingOutput){
  const track=document.timeline?.tracks.find(t=>t.clips.some(c=>c.id===clipId)),clip=track?.clips.find(c=>c.id===clipId);
  if(!track||!clip||clip.source.type!=='asset'||clip.source.assetId!==sourceId)throw invalid('请选择直接引用本次原素材的时间线片段。');
  if(track.locked)throw new AppError('TRACK_LOCKED','目标轨道已锁定，请解锁后重试。',409);
  if(output.mediaType==='audio/wav'&&!['voice','music'].includes(track.type)||output.mediaType==='image/png'&&['voice','music'].includes(track.type))throw invalid('结果格式不适用于此轨道。');
  const from=output.sourceStartMs,to=from+(output.sourceDurationMs??sourceDurationMs);
  if(output.sourceDurationMs!==null&&(clip.sourceInMs<from||clip.sourceInMs+clip.durationMs*clip.playbackRate>to+1||clip.loop&&(from!==0||to<sourceDurationMs)))throw invalid('加工结果没有覆盖当前片段的完整取材范围；请加工完整区间或另行插入。');
  clip.source={type:'asset',assetId:output.assetId};clip.sourceInMs-=from;clip.linked=false;return document;
}

