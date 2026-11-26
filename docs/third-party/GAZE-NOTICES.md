# 本机眼部几何纠偏依赖

本批使用合法取得的模型和现有Chrome，仅在本机处理虚构测试图；不复制竞品代码、真人素材或NVIDIA专有模型。此页是本批依赖来源和边界记录，不宣称完整操作系统SBOM或所有未来分发场景均已审查。

| 依赖 | 固定版本及用途 | 许可/记录 |
| --- | --- | --- |
| MediaPipe FaceLandmarker task | Google `float16/1`，3,758,596字节，SHA-256 `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`；实际478点/姿态检测 | 官方文档关联的[模型卡](https://huggingface.co/litert-community/MediaPipe-FaceLandmarker) revision `cfb66f449dc5cb9f8dada3d52174d4cdae1c9ef1` 声明Apache-2.0；原卡和3份模型PDF在[evidence](../evidence/T24/gaze/upstream-model-card.md) |
| MediaPipe Tasks Vision | `@mediapipe/tasks-vision@1.2.3`，5份批准的JS/WASM逐文件SHA；CPU执行 | [Apache-2.0原文](MEDIAPIPE-APACHE-2.0.txt)，[上游源码](https://github.com/google-ai-edge/mediapipe)；保留包内原版权信息 |
| Playwright Core | `playwright-core@1.65.1`，服务端私有浏览器驱动；lib内JS/JSON摘要进入任务引擎标识 | [Apache-2.0原文](PLAYWRIGHT-APACHE-2.0.txt)、[NOTICE](PLAYWRIGHT-NOTICE.txt)；原文件从已安装包复制 |
| Google Chrome | 已安装的158.0.8127.36，核对启动文件/核心DLL摘要与实际版本；私有headless上下文 | 按现有安装许可使用，未下载或打包Chrome、未将Chrome视为MediaPipe Apache许可的一部分 |
| FFmpeg / pngjs | 沿用项目已锁定依赖，解码、RGBA和有声/透明输出 | 原媒体工具及依赖声明继续适用 |

MediaPipe 1.2.3有厂商遥测请求尝试。运行上下文offline，并中止非批准路由，实际0外部响应，不能称0请求尝试。任务不调用物理设备、不建立身份库。Google模型只检测关键点，自有几何算法不生成眼睛，也不测量真实视线方向。

NVIDIA MAXINE / NGC资源仅作公开文档研究，本机没有安装或使用其SDK/权重。未采用研究项目中许可不明的训练模型。后续真正接入神经重定向时须按取得的组件与许可另行记录，不能用本批Apache许可覆盖专有SDK。

两张虚构人像通过内置imagegen生成及编辑，固定文件、SHA和完整提示词见[功能文档](../42-gaze-geometry.md)。它们仅用于合成测试，不是第三方真人照片、身份凭证或真实效果验收。
