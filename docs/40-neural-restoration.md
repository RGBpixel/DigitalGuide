# T24 / R-080 本机神经修复与超分

媒体加工已接入实际 Real-ESRGAN 全精度模型。图片和视频逐帧执行本机神经推理，输出可选择原尺寸、2倍或4倍；保留原素材、透明度及视频原声，结果可单独下载或明确应用到工程。它是口播、PPT成片、直播回放和其他内容场景共用的制作能力。T24、R-080、完整AC-37及G1/G2仍在进行，老片损伤、划痕、人脸细节、时序和真实素材质量另行验收。

原真人形象克隆、音色与语气复刻、多轨与模板、多人同屏、批量协作、透明/4K、资产迁移、实时交互、发布投放和接待声纹目标均保留；本批不自动执行外部业务。

## 使用

1. 导入有权使用的MP4，或上传PNG。已生成的透明MOV资产也可作为加工来源。常规上传仍为8MiB；视频通过既有分片导入，目前该入口接收MP4，不直接导入MOV。
2. “媒体加工”选择原件，选择“神经修复与超分 · 本机模型”。设置1/2/4倍输出和0至1模型融合。融合0为同一尺寸策略的插值基线，融合1使用模型纹理；需要回看文字、面部和边缘。
3. 视频选择完整原片或区间；用“对齐到原片帧”核对边界。保存并审阅原片版本、输出尺寸、用途、模型和边界，再确认开始。
4. 对照原片与实际结果，PNG显示棋盘背景。透明视频原件是ProRes 4444，浏览器使用合成底色的播放代理；工程仍读取透明原件。普通视频生成H.264。原声保留通道和采样率，经AAC重新编码，不承诺压缩音频字节不变。
5. 下载，或勾选结果并明确应用到新工程、追加或替换片段；不会因处理完成而自动改写原工程。来源或用途撤回后，报告、引擎、来源详情和下载链接按当前权限隐藏，派生工程继续受限，原素材与历史保留。

[本机入口](http://127.0.0.1:5174/studio/processing)。当前原始样例断点在私有 `storage/restoration-preview-state.json`；只读重验使用 `--verify-only`，不得生成替代任务或覆盖原文件。

## 模型来源与可复核身份

| 内容 | 固定身份 |
|---|---|
| 原模型 | [xinntao/Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN)，`realesr-general-x4v3`、SRVGGNetCompact、32个中间卷积块、64通道、原生4倍 |
| 官方权重 | [v0.2.5.0发布文件](https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth)，4,885,111字节，SHA-256 `8dc7edb9ac80ccdc30c3a5dca6616509367f05fbc184ad95b731f05bece96292` |
| 实际ONNX | [vlad-grig/realesr-general-x4v3-onnx](https://huggingface.co/vlad-grig/realesr-general-x4v3-onnx)，修订 `0e95d93e454cf6b5de9bdf5a1c9e7ec340d38231` 的 `onnx/model.onnx`，本机命名 `realesr-general-x4v3-fp32.onnx` |
| ONNX摘要 | 4,866,420字节，SHA-256 `7b10e80021ec3e0ff35017ae5022791879d93a799b2e201e1010a37510202266` |
| 参数核对 | 官方checkpoint的101组参数、1,213,296个FP32数值，与实际ONNX逐项完全相同 |
| 运行时 | 锁定ONNX Runtime Web 1.31.1，独立媒体helper，CPU单线程WASM，V8堆上限256MB；WASM及原生内存额外占用系统内存 |

原始权重由受限读取器解析，禁止任意pickle代码执行；只允许固定描述对象，先校验摘要、ZIP容量、张量类型、形状和连续性，再比较全部参数。独立NumPy卷积/PReLU/像素重排参考与WASM在三组非方形输入比对，最大绝对误差约0.0000018，低于预先固定的0.0005；关闭fetch时推理网络请求为0。运行服务不需要Python或Torch。

曾检查另一个ONNX文件，其中参数先舍入为FP16再扩成FP32，不能通过原始参数一致性检查，未用于当前引擎。其来源、失败和后续全精度验证均保留，不能用“输入输出类型float32”代替参数精度证明。

原模型、原始权重及该转换模型采用BSD-3-Clause，运行时为MIT。[来源与许可说明](third-party/RESTORATION-NOTICES.md)及[原BSD文本](third-party/REALESRGAN-BSD-3-Clause.txt)随安装保存。竞品研究不提供竞品代码、模型或素材的使用许可。

## 像素、音频与资源约束

- 输入为RGB `[0,1]`、动态NCHW；每块核心256像素，外围反射36像素，保留固定裁切区，避免分块边缘失去卷积上下文。源宽270像素的两块实际结果与独立全图参考逐字节一致，边界最大差0。
- 原生4倍结果按面积平均得到1倍或2倍。透明度单独双线性缩放，融合基线使用预乘Alpha；透明隐藏RGB先用最近可见边缘填充，输出Alpha为0时RGB归零，不把隐藏颜色扩散到边缘。完全透明帧明确跳过模型并记录计数，不假报神经推理。
- 输出单边16至4096像素，视频要求偶数尺寸；超过限制明确失败，不悄悄调整倍率。整个区间最多4096次分块推理，越限提示缩短或分批，不截掉后半段。既有本地视频上限10分钟，实际可处理区间也受此推理次数限制。
- 视频按固定fps整数帧网格处理；333ms/30fps完整原片实际保留10帧。独立解码、推理和编码逐帧传递，不把整段未压缩视频放进内存；取消、超时与错误清理拥有的子进程，不登记部分结果。
- PNG工作像素为8位RGBA，ProRes采用透明封装，不承诺原生16位图像精度。生成/已入库PNG限制为64MiB加64KiB封装余量、最多16,777,216像素并检查CRC；常规上传继续8MiB。开放项目包支持这类已入库大PNG，迁移后新资产ID与原始文件SHA分别核对。PNG解码受像素上限约束，不能借大封装大小放大内存。

真实编译helper已把960×540透明合成图经12次推理输出为3840×2160，实际解码并检查透明、半透明和不透明像素、原文件摘要，耗时约81秒，仅为本机单个样例观察。这证明4K像素输出经过模型处理，不证明原片拥有4K细节、模型恢复了真实丢失内容或长片能实时处理。

## 质量对照与仍需验收的范围

以同一原创192×128图形为已知真值，退化至48×32后，比较实际模型4倍结果与Lanczos。全部三组结果均保留，未按好坏筛选。

| 退化 | 模型PSNR | Lanczos PSNR | 模型变化 |
|---|---:|---:|---:|
| 单纯缩小 | 28.276dB | 28.864dB | -0.588dB |
| 缩小并加噪 | 27.374dB | 26.873dB | +0.501dB |
| 缩小并压缩 | 27.226dB | 25.100dB | +2.126dB |

模型会推测纹理，某些输入的像素保真度反而降低；本批不声称通用画质提升。PSNR也不是完整感知质量、可读文字或身份一致性指标。需要使用融合强度、原件对照和人工审核；实际人像、发丝、低照度、旧胶片、划痕、模糊、面部细节、色彩恢复、视频闪烁、长片/GPU及目标硬件仍待验证。没有身份识别、真人克隆或声音复刻验收。

## 数据与接口

无新SQL迁移，042及以前冻结，后续从043新增。复用既有加工方案、不可覆写修订、队列/租约、输出和应用事实。`configuration.restoration`对旧JSON为可选，本机restore必须明确填写；旧模拟/分割/语义快照不自动插入默认字段，历史哈希保持。

| 接口/字段 | 行为 |
|---|---|
| `GET /studio/media-processing/capabilities` | `restoration.available/engine/reason/notice`；实际安装时 `localOperations` 含 `restore` |
| `POST /studio/media-processing/plans` | `provider=local-media`、`operation=restore`、`restoration.scale=1/2/4`、`strength=0..1`；本机不接受文字修复指令 |
| 服务端 `engine` | 固定原权重/ONNX/运行时摘要和反射、分块、缩放、Alpha及融合策略；客户端不能自行注入 |
| 保存、运行、任务控制、读取 | 沿用本人/租户/空间/环境、用途、版本、幂等与租约；模型不符明确失败，不回退成模拟成功 |
| 任务 `restorationSource` 与报告 | 当前来源可用才返回；报告包括实际帧数、推理次数、倍率、融合和资源观察 |
| 下载与工程 `apply` | 提交前和读取时复核来源；并发应用只有同一工程事实，撤回限制派生用途 |

前缀 `/api/v1`，写操作需要会话、CSRF及幂等键。共享契约生成[OpenAPI](api/openapi.json)。模型推理在事务外，结果写入使用新鲜来源检查和租约CAS；没有把人脸/声纹候选当作登录或操作授权。

## 启动与检查

```powershell
pnpm install --frozen-lockfile
pnpm setup:media
pnpm setup:restoration
$env:API_PORT='4301'
$env:WEB_PORT='5174'
$env:WEB_ORIGIN='http://127.0.0.1:5174'
$env:DATA_DIR='storage'
$env:APP_ENV='development'
$env:PROVIDER_MODE='mock'
pnpm dev
```

既有环境保留主库、私有密钥和原AE配置，不重新初始化；有配置时继续设置原 `AE_RUNTIME_CONFIG`。只有新空环境才运行 `pnpm setup:local`。安装脚本固定修订/大小/摘要并真实执行非均匀输入，不以下载成功冒充推理成功。主环境为mock，当前本机修复仍实际运行模型；支付、发布、通知和广告模拟不能当成真实业务验证。

专项可运行 `pnpm exec vitest run tests/unit/restoration.test.ts tests/integration/neural-restoration.test.ts tests/integration/large-png-package.test.ts`。当前18项通过，覆盖真实PNG/有声及无声视频/ProRes Alpha、迟到撤回、在途取消、角色/租户、倍率/边界、透明RGB、大PNG项目包迁移和单次应用。10项关联Chrome流程通过。编译双API/worker的9项检查包括真实处理中SIGKILL、原30秒租约自然恢复、同一任务及文件重启、并发单次应用、实际built页面和撤回；12根进程和拥有的媒体/FFmpeg子进程退出由独立OS检查核对。

[本批汇总](evidence/T24/restoration/verification.json)记录最终全量检查、质量对照、来源/许可证、失败与修正、主库保留和原业务断点。合成图形和测试音只验证本批技术链路，不替代真实素材质量、真人形象/声音/语气、现场设备、真实渠道与完整G1/G2。
