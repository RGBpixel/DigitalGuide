# 本机眼部几何纠偏

继续 T24 / R-076。平台现在提供真实本机人脸关键点检测与眼眶内小幅像素纠偏，可处理PNG、有声MP4和透明ProRes 4444 MOV，查看原件/成片与逐帧眼部对照，再明确应用到工程。本路径是实验性几何处理，R-076的神经视线重定向和真人自然度仍在最终范围内；134项需求、38项任务、65条验收及22项本地已验证任务保持，完整G1/G2未完成。

## 使用和启动

已安装Google Chrome的Windows x64环境执行：

~~~powershell
pnpm install --frozen-lockfile
pnpm setup:media
pnpm setup:gaze
$env:API_PORT='4301'
$env:WEB_PORT='5174'
$env:WEB_ORIGIN='http://127.0.0.1:5174'
$env:DATA_DIR='storage'
$env:APP_ENV='development'
$env:PROVIDER_MODE='mock'
if (Test-Path -LiteralPath 'storage/ae-preview-state.json') {
  $aeState=Get-Content -LiteralPath 'storage/ae-preview-state.json' -Raw | ConvertFrom-Json
  $env:AE_RUNTIME_CONFIG=$aeState.configFile
}
pnpm dev
~~~

打开[媒体加工](http://127.0.0.1:5174/studio/processing)，使用本地开发账号“林知 · 管理员”和“品牌与接待”空间。此处`mock`是外部业务环境，本机关键点、像素处理及FFmpeg实际运行；模拟提供商仍只生成可识别的审阅报告。

PNG通过素材上传。视频从[视频素材](http://127.0.0.1:5174/studio/media)导入：128MiB内的H.264/AAC MP4，或直立ProRes 4444/4444 XQ MOV和至多一条AAC/PCM16双声道。文件按原SHA分片续传、完整解码；MOV保留原件和Alpha，另存私有浅色背景播放代理。改扩展名的H.264不能作为透明MOV入库。上传授权沿用素材制作权限，不能据此发起克隆训练。

选择原素材和“视线修正 · 几何纠偏（实验）”，填写眼眶内水平/垂直目标、最大水平移动、平滑和强度。保存后核对固定模型、源版本、输出规格及用途，再开始实际处理。视频起点须对齐原片帧，可使用“对齐到原片帧”。文字提示不参与几何路径，旧方案需要明确填写几何设置后重新保存，不自动更改旧JSON或旧模拟任务。

完成后可播放、下载、拖动“纠偏帧记录”，查看两幅眼部放大图及移动箭头。闭眼/无法采用的位置显示具体状态并保留该帧；没有改变的帧明确标记。明确选择结果并确认后，沿用已有新建工程、追加或替换片段流程；刷新和重启保留原任务、文件与单次应用记录。来源或用途撤回会隐藏眼部记录、报告与成果链接，并限制引用该结果的工程，原件仍按自己的权限提供。

编译运行先`pnpm build`，API/worker分别`pnpm start`与`pnpm start:worker`，使用同一数据库、环境和服务端配置。`GAZE_CHROME_PATH`只在服务端指定现有Chrome可执行文件；不会下载其他浏览器或静默切换到模拟。

## 模型、算法和真实边界

| 项目 | 本批实现 |
| --- | --- |
| 模型 | Google MediaPipe FaceLandmarker float16/v1 task，3,758,596字节，SHA-256 `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff` |
| 执行 | 固定`@mediapipe/tasks-vision@1.2.3`、`playwright-core@1.65.1`；当前Google Chrome 158.0.8127.36；CPU/XNNPACK推理，软件图形预处理 |
| 固定范围 | 模型与5份MediaPipe JS/WASM精确SHA，Playwright lib内JS/JSON摘要；Chrome启动文件和核心DLL摘要及实际版本；不是整个浏览器/操作系统的供应链认证 |
| 关键点 | 实际478点及人脸姿态矩阵，最多检测2张脸；多人不挑其中一个人纠偏，不进行身份识别或权限授予 |
| 几何策略 | `iris-aperture-inverse-warp-v1`：眼眶内逆向采样、边缘羽化、位移梯度衰减及时间平滑，只移动已有眼部纹理，不生成或补画眼睛 |
| 限制 | 32—4096像素单边；视频不超过60fps；每任务最多1200帧和268,435,456累计像素，按实际尺寸计费式计算工作量，不截断超限任务 |
| 保持 | 原尺寸/帧率，PNG全部原Alpha及眼眶外RGBA；视频逐帧8位RGBA处理，保留透明通道后重编码，原声通道/采样率不变 |

目标0.5表示眼眶范围中部，范围0.35—0.65；水平移动最多眼宽1%—12%，垂直最多眼高15%，强度0—1，平滑0—1000毫秒。模型处理缩至最长960像素的分析图，纠偏使用原尺寸。闭眼、检测丢失、多脸、姿态超范围及不可靠几何会清除旧平滑状态；恢复后使用当前帧，不能拿旧眼部位置继续移动。

仅适合清晰、单人、正面和小幅变化；头部姿态阈值只是跳过不适用画面的策略。虹膜位置不等于真实注视方向、眼球光轴或“看向镜头”的证明，眼眶中部也未必自然。全片都没有可用眼部会明确失败，不登记替代成片；全闭眼可以完成检测并保持原像素，报告说明没有纠偏。PNG透明值逐像素保留；ProRes/颜色转换、8位中间帧和AAC重编码可能改变原高位深透明值、色彩或音频字节，不宣称无损或原生高位深处理。真人长片、眼镜/遮挡、多人切换、快速动作和生成式视线质量尚待独立验收。

## 离线运行和数据

模型在服务端辅助浏览器中读取受控文件，使用独立私有profile。上下文设为offline，路由只提供固定HTML、批准的JS/WASM和模型文件，其他请求中止；WebSocket关闭、Service Worker禁用、摄像头/麦克风/屏幕捕获禁用。没有启动41765端口的HTTP服务器；该本地地址仅用于浏览器文件路由。

MediaPipe 1.2.3实际尝试请求`https://odml.pa.googleapis.com/v1/log`。本批保留首个观测失败和后续阻断记录：通常有1次被阻断的厂商请求、0个外部响应、0次设备采集。不能声称“没有遥测尝试”或据此声称完成全机网络抓包。浏览器前端没有外网请求，与后端模型进程的被阻断尝试分开报告。

业务库仅保存眼部范围、输入/目标位置、状态及像素计数等纠偏记录；不保存真人478点档案、不建立陌生人人脸库、不推断人格。方案/任务固定模型、处理策略、源版本、哈希及用途；缺失或变化时明确失败，不能静默回退。鉴权、租户、当前角色、撤回、租约、取消和工程CAS均沿用服务端检查。模型关闭后才提交结果；进程断联会终止模型浏览器与FFmpeg，恢复继续使用原任务和原租约规则。

没有新增SQL迁移。当前043迁移冻结，后续从044开始，旧任务JSON不填新默认字段，旧样例及原素材保持。

## 来源、许可和素材

模型从[Google固定版本地址](https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task)取得。Google官方任务文档链接的[维护者模型卡](https://huggingface.co/litert-community/MediaPipe-FaceLandmarker)在固定revision `cfb66f449dc5cb9f8dada3d52174d4cdae1c9ef1`声明Apache-2.0；3份原模型卡、版本元数据和精确字节记录保存在本批证据中。MediaPipe和Playwright许可证及NOTICE见[依赖说明](third-party/GAZE-NOTICES.md)。

本机没有NVIDIA AR SDK。当前[NVIDIA安装说明](https://docs.nvidia.com/maxine/ar/latest/WindowsARSDK/InstalltheARSDK.html)、[SDK Core](https://catalog.ngc.nvidia.com/orgs/nvidia/maxine/resources/ar_sdk_core/-)及[Eye Contact资源](https://catalog.ngc.nvidia.com/orgs/nvidia/maxine/collections/nvargazeredirection/-)需要适用NGC访问资格及运行组件，尚未接入。没有购买、注册、绕过授权或复制许可未明确的研究权重。神经重定向仍保留为独立接入和验收项。

两张测试图由内置imagegen生成/编辑，内容为虚构成年人，未使用真人照片：

- [睁眼透明原件](../packages/test-fixtures/assets/gaze-portrait.png)，SHA `98965798684f4c003980513d9dff692dd6346c38f68389a6fe22d496dfbd2132`；[完整提示词、内置模式与保存路径](evidence/T24/gaze/fixture-generation.json)。
- [闭眼透明原件](../packages/test-fixtures/assets/gaze-blink.png)，SHA `5737b76d10440cad6e7d405a2df03cda37042ff338f93904409f6efee0e99177`；[编辑提示词、内置模式与保存路径](evidence/T24/gaze/fixture-blink-generation.json)。

视频由这两张图及合成测试音实际编码。生成编辑并非两图逐像素身份一致的证明；测试不使用摄像头、真实访客或真实人物身份信息。

## 验证记录与未完成条件

实际模型输出478点，虚构睁眼PNG发生4984像素变化，眼眶外和全部Alpha变化为0。独立重新检测同一合成对照中，两眼相对中点偏差分别从0.1303降到0.0898、0.2055降到0.1697；这是该素材的关键点指标，不能外推为真实视线角度、通用质量或人工自然度认可。[像素与重检测报告](evidence/T24/gaze/pixels-current/proof.json)保留原始指标和结果。

首个像素验证因原图眼部Alpha为252/253而没有移动，已改为对半透明值进行预乘颜色插值，保留原Alpha。首个单元失败是JSON键顺序断言；编译首轮因MOV上传入口缺失而失败；透明MOV伪装格式的首轮错误诊断过于笼统，已显示ProRes要求。失败记录保留，最终实际检查、恢复、主库样例及数据保全结果汇总到[本批验证](evidence/T24/gaze/verification.json)与[当前计划](../PLAN.md)。

真人自然度、眼球重建/生成式重定向、长片/实时吞吐、其他硬件与系统、实际4K人像效果、完整T24/T25/T28和G1/G2仍未验收。形象、声音、语气复刻及真实直播/发布/支付/通知也不能使用本组合成素材代替验收。

原全量运行795/796，失败的是取消后立即检查浏览器退出：当时仍有该任务的Chrome主进程和Crashpad进程。固定Playwright 1.65.1会把正在关闭的context视为已关闭，重复调用`close()`可以提前返回。现在取消、错误和finally路径共享并等待首次关闭Promise；原8项测试文件字节和全部断言保持，整文件8/8复验通过，当前编译强杀/自然租约恢复与OS清理也通过。原全量失败及独立诊断保留，未复跑整个796项，不能称一次全量796/796。

眼部放大图按原素材宽高建立坐标，横屏/4K不再被当成方图拉伸。新增Chrome用例实际使用1536×864虚构透明PNG，编译版实际上传、处理和解码3840×2160 PNG；两侧眼部图像的显示宽高比与解码图片一致。原视频第2帧/第3帧的精确读取、非空纹理、眨眼保留和手机布局继续验证。

本批最终检查为首次全量795/796、取消文件8/8复验后跨运行覆盖796个后端用例（101文件）、新增3项和关联10项Chrome、编译10项/12根进程及实际3840×2160透明PNG，主63483/schema043的同一图片/透明视频/工程重启6项和10项浏览器通过。最终图像对照同时核对HTTP200、实际解码的眼部可见像素与纹理；早期仅检查SVG可见的结果不能替代此项。大IPC报告丢失已通过等待发送回调修正。独立1254像素探测4984变化与正常最长960像素分析管线的4688变化分别保留，不混作同一运行。实际4K夹具为按比例放大并透明填充的虚构图，不证明原生4K人物细节。原272业务表2219行、20组旧模块/32媒体和9组旧浏览器保持；认证到期差异见独立保全报告。
