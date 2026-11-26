# DigitalGuide 前期研究与设计依据

研究整理日期：2026-11-17。范围覆盖本次会话提出的国内平台、海外平台和腾讯生态。公开文档支持“官方声明具备”，不等于本项目已实测或已获得对应套餐；仓库代码入口不等于完整商业产品开源。

## 竞品结论

| 平台 | 重点发现与可借鉴部分 | 约束与项目采用方向 |
| --- | --- | --- |
| 科大讯飞 智作/交互数字人 | 视频播报与实时交互分别有产品入口；适合作为中文形象、声音和企业应用对照 [SRC-01] | 分别测试两条产品线；完整多轨、双人、Alpha、4K 和模型迁移不因官网概述而判定满足 |
| 罗根 LuoGen-agent | 公开仓库展示文案、配音、数字人口播、字幕、封面与发布流程 [SRC-02] | 代码与依赖交付完整度、许可证和当前渠道可用性需独立核验，不直接作为工程底座 |
| 罗根 LuoGen-agen-plus | 增强仓库提供更多数字人/配音与发布操作入口 [SRC-03] | UI 按钮和代码调用不能证明当前平台发布成功 |
| 罗根商业官网 | 强调定位、选题、脚本、声音、出镜、剪辑和封面的一体流程 [SRC-04] | 学习口播制作编排，不把商业版能力视为公开仓库全部具备 |
| 蝉镜 | 视频、交互、克隆与编辑生态；视频接口有 4K 能力判断与透明输出参数 [SRC-05] | 透明、背景/字幕和形象资格有条件；下载成片与迁移模型分别验证 |
| HeyGen / LiveAvatar | Video Agent 的计划审阅和生成后编辑；独立实时产品 [SRC-06] | 视频头像与 LiveAvatar 不直接互用；用平台资产映射隔离供应商限制 |
| Captions / Mirage | AI Twin 与提示词生成口播，自动辅助画面、音效、音乐和剪辑 [SRC-07] | 优先借鉴可编辑口播包装；当前自动发布能力不能仅用历史 Social Studio 信息确认 |
| Synthesia | 企业视频、品牌、团队流程；交互数字人文档标 Beta [SRC-08] | 常规下载仍有 1080p 限制，不把上传 4K 当成输出 4K |
| Colossyan | 多角色台词、模板批量和团队审批；培训分支交互 [SRC-09] | 预设分支/测验与实时自由对话是不同能力 |
| Tavus | 实时视听交互、轮次与打断、可配置模型/语音链路 [SRC-10] | 适合参考实时引擎，延迟和中文效果须现场测试 |
| 日本 AVITA | AVACOM 的 AI/真人接待协同及 Avatar API [SRC-11] | 借鉴人工接管与接待运营，不视为视频多轨工作台 |
| 日本 EmbodyMe DigiSelf | 照片驱动视频与实时对话、自定义角色和声音 [SRC-12] | 候选引擎；效果、延迟、资产复用和商用条件待实测 |
| 日本 NTT DATA | PARSONII 与 Edge-Ghost 企业数字人应用 [SRC-13] | 借鉴导览终端和业务集成；Edge-Ghost 文中为代号，不当作已验证自助 SaaS |
| Epic MetaHuman | DCC/Maya 角色资产流程 [SRC-14] | 适合可控 3D 路线，仍需自建语音、渲染和业务系统 |
| NVIDIA Audio2Face / ACE | 音频驱动面部及本地组件 [SRC-15] | 作为技术组件研究；不把部分开放组件推导为所有模型和 SDK 无限制使用 |
| 腾讯云智能数智人 | 端云渲染、多轨 iPaaS、多人口型、透明输出、形象包下载 [SRC-16—22] | 多种产品、版本和计费分别核验；下载包仍受 SDK 与许可限制 |
| 腾讯智能创作 | 剪辑、AE 模板、审片、多平台审核发布、数据监控 [SRC-23] | 与数字人是相邻产品线；账号资产互通及具体发布平台要验证 |

未研究到足够证据的产品不列为已确认候选。以上不是市场份额、画质或性价比排名。

## 研究到设计的映射

| 观察 | 自有产品决定 |
| --- | --- |
| 不同平台把视频和实时分开 | 统一资产目录，保留多供应商版本和用途映射 |
| 自动口播制作可减少操作 | 计划可审阅，生成结果回写可编辑工程 |
| 双人常被简化为轮流切画面 | 独立定义同屏、说话、聆听、旁白和镜头状态 |
| 透明、4K 与端侧分辨率常混淆 | 能力前置检查，输出探测，真人素材复验 |
| 批量 API 不等于业务生产线 | 自建队列、审批、资产归档、成本与失败处理 |
| API 不意味着模型可迁移 | 导出分层，记录许可、格式、运行时和缺失项 |
| 自动发布依赖账号及平台接口 | 渠道适配器、真实回执、人工发布包并存 |
| 日本接待产品重视服务交接 | 真人接管成为企业前台与餐厅的基础功能 |
| 腾讯支持本地渲染与云端兜底 | 运行时可替换，终端性能不足时明确降级 |
| 人脸检索、对话与业务工具为独立组件 | 身份候选、权限、记忆和业务状态分别管理 |

## 关键能力的证据边界

腾讯 iPaaS 高级版公开列出多轨、模板与运营后台，但版本表中会话配置并非高级版全部包含。端渲染形象包有下载窗口和授权，不能自由推导到其他引擎。多人视频接口针对同一参考视频内最多三个人，4K 输出涉及独享资源。透明 WebM 与交互透明视频流分别验收。

HeyGen 的透明 WebM 文档存在单场景及 4K 质量形象条件；LiveAvatar 另有模型与额度。Synthesia 的常规 MP4 下载文档仍标 1080p。蝉镜 4K 及透明参数需按实际形象能力与当前 API 组合检查。

罗根仓库说明、代码入口与商业官网是三个证据层级，不能合并为“完整开源商业平台”。参考设计不意味着复制其源码或第三方模型。

## 来源目录

所有条目查阅/整理基准为 2026-11-17；实施某接口前再次核对当前版本。编号用于需求追溯，不代表强弱排名。

- SRC-01 科大讯飞：[智作数字人](https://www.xfzhizuo.cn/virtual-broadcasting)、[交互数字人](https://virtual-man.xfyun.cn/interaction)。
- SRC-02 罗根基础仓库：[LuoGen-agent](https://github.com/LuoGen-AI/LuoGen-agent)。
- SRC-03 罗根增强仓库：[LuoGen-agen-plus](https://github.com/LuoGen-AI-Plus/LuoGen-agen-plus)。
- SRC-04 罗根商业产品：[官方网站](https://luogen.youqu-ai.top/)。
- SRC-05 蝉镜：[帮助中心](https://doc.chanjing.cc/help-center/)、[合成接口](https://doc.chanjing.cc/api/video-synthesis/synthesize-digital-person-video.html)、[交互产品](https://www.chanjing.cc/other/interactive.html)。
- SRC-06 HeyGen：[Video Agent](https://help.heygen.com/en/articles/12402907-how-to-get-started-with-video-agent)、[LiveAvatar FAQ](https://help.heygen.com/en/articles/12758866-liveavatar-faq)、[透明 WebM](https://help.heygen.com/en/articles/9518951-converting-webm-avatars-into-adobe-premiere)。
- SRC-07 Captions/Mirage：[AI Twin](https://captions.ai/features/create-ai-twin)、[提示词制作视频](https://captions.ai/help/docs/project/mirage-edit)、[公司介绍](https://mirage.app/about-us)。
- SRC-08 Synthesia：[交互数字人](https://docs.synthesia.io/docs/interactive-avatars)、[下载规格](https://help.synthesia.io/en/articles/9317524-how-do-i-download-my-synthesia-video)、[编辑视图](https://help.synthesia.io/en/articles/13199271-what-s-the-difference-between-canvas-storyboard-and-timeline-view)。
- SRC-09 Colossyan：[功能](https://www.colossyan.com/features/)、[多人和批量制作](https://www.colossyan.com/posts/how-to-use-an-ai-tool-to-create-videos-from-text-step-by-step/)。
- SRC-10 Tavus：[实时交互文档](https://docs.tavus.io/sections/conversational-video-interface/overview-cvi)、[管线模式](https://docs.tavus.io/sections/conversational-video-interface/quickstart/pipeline-modes)。
- SRC-11 AVITA：[AVACOM](https://avita.co.jp/avacom)、[Avatar API](https://avita.co.jp/news/L6JKWJRV)。
- SRC-12 EmbodyMe：[DigiSelf](https://digiself.tech/en/)、[公司](https://embodyme.com/ja/company/)。
- SRC-13 NTT DATA：[数字人接待与业务集成](https://www.nttdata.com/jp/ja/trends/data-insight/2025/1126/)。
- SRC-14 Epic：[MetaHuman for Maya](https://dev.epicgames.com/documentation/en-us/metahuman/metahuman-for-maya)。
- SRC-15 NVIDIA：[ACE 与 Audio2Face](https://developer.nvidia.com/ace-for-games)。
- SRC-16 腾讯：[用户提供的国际站概述](https://intl.cloud.tencent.com/zh/document/product/1211/62139)、[中国站文档目录](https://cloud.tencent.com/document/product/1240)。
- SRC-17 腾讯：[iPaaS 产品介绍](https://cloud.tencent.com/document/product/1240/104659)、[高级版与团队权益](https://cloud.tencent.com/document/product/1240/121048)。
- SRC-18 腾讯：[多人免训练接口与输出规格](https://cloud.tencent.com/document/product/1240/116222)。
- SRC-19 腾讯：[端渲染](https://cloud.tencent.com/document/product/1240/118294)、[端云混合](https://cloud.tencent.com/document/product/1240/126057)。
- SRC-20 腾讯：[形象包下载](https://cloud.tencent.com/document/product/1240/129586)。
- SRC-21 腾讯：[WebM 与视频管理](https://cloud.tencent.com/document/product/1240/102025)、[素材抠像条件](https://cloud.tencent.com/document/product/1240/103864)。
- SRC-22 腾讯：[PPT 合成与并发限制](https://cloud.tencent.com/document/product/1240/130020)、[计费](https://cloud.tencent.com/document/product/1240/101944)。
- SRC-23 腾讯：[智能创作剪辑与发布](https://cloud.tencent.com/document/product/1156/85868)。
- SRC-24 腾讯：[人员搜索](https://cloud.tencent.com/document/product/867/44992)、[实时对话与视觉](https://cloud.tencent.com/document/product/647/140327)。
- SRC-25 腾讯：[自定义 API 工具节点](https://cloud.tencent.com/document/product/1759/112968)。
- SRC-26 中国网信网：[人脸识别技术应用安全管理办法](https://www.cac.gov.cn/2025-03/21/c_1744174262156096.htm)。
- SRC-27 OpenAI：[Using Goals in Codex](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex)、[Follow a goal](https://learn.chatgpt.com/docs/use-cases/follow-goals)。

## 供应商 PoC 统一样例

同一套获得授权的中文素材分别测试：60 秒单人口播、双人问答、透明背景、4K、打断式导览、方言/噪声、资产导出与删除。记录具体产品线、地区、套餐、API 版本、原始样本、输出文件、延迟分布、费用和限制。不得用不同素材的宣传视频直接比较排名。

## v1.1 功能并集补充

前期结论进一步展开为 [功能覆盖矩阵](08-competitor-capability-matrix.md)，所有已发现功能均映射到项目需求。新增直播和付费投放的自有设计不等于每个竞品已有此能力。语气克隆保留为独立效果验证项。

- SRC-28 腾讯：[SSML 停顿、读音与动作](https://intl.cloud.tencent.com/zh/document/product/1211/65921)、[语音参数与情感字段](https://cloud.tencent.com/document/product/1240/116222)。参数支持不能直接证明任意语气参考迁移。
- SRC-29 Captions：[摄像头与提词器](https://captions.ai/help/guides/creators/camera-teleprompter)、[视线修正](https://captions.ai/features/correct-your-eye-contact)。
- SRC-30 Colossyan：[互动、SCORM、软件模拟与本地化](https://www.colossyan.com/features/)，Synthesia：[课程、角色练习与访谈产品范围](https://help.synthesia.io/en/articles/9994493-what-is-synthesia)。

## v1.2 目标说话人与抗干扰证据

- SRC-31 腾讯：[AI 对话 1.0 声纹识别](https://cloud.tencent.com/document/product/647/119842)、[VoiceAI ASR HarmonyOS SDK](https://cloud.tencent.com/document/product/647/137686)。

2026-11-17 核对：1.0 接入页要求预注册约 8—18 秒有效语音，固定模式只配置一个声纹 ID，声纹判定随最终字幕返回，非匹配默认不送 LLM，页面注明试用。HarmonyOS SDK 另有按说话人转写/降噪能力说明。上述依据证明存在相关接入路径，不能证明新来客即时临时锁定、全部终端/2.0 兼容或任意噪声条件均可靠。

临时参考、多人交接、归属过滤及现场指标是本项目的新增设计要求。供应商模式、终端与真实效果保留 V-09 待验证；本次未注册声纹、调用付费接口或进行音频实测。
