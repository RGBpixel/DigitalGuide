# PostgreSQL 文件转写与校对来源

2026-11-23｜T20/R-058、T24/R-072｜原生验证增量；全平台和 G2 继续。

本批将已有文件转写流程接入独立 PostgreSQL：已检查视频 → 实际 PCM 解码 → 离线 ASR → 不可覆写识别原稿 → 人工校对历史 → 明确确认内容来源 → 脚本和工程。没有切换或重启默认完整 SQLite 工作台。预制视频、PPT、直播、发布投放、展厅、企业前台、餐厅和全部竞品规划继续保留。

## 实现与使用

- `/studio/transcriptions` 复用已有工作台：选择带原声的 MP4/MOV、原视频版本、区间、实际安装的识别器和用途期限；明确确认后创建本人持久任务。
- Windows 文件识别复用系统识别器；原声实际解码为 16kHz/单声道/16 位 PCM WAV，最多十分钟。原件、识别结果和每次校对保留摘要；可回听所选原声、编辑片段时间和正文、导出 JSON/SRT/VTT。
- 识别结果只进入待校对状态。登记来源必须明确确认当前校对版本及摘要；使用期限取视频、原转写用途、新来源用途的最短期限。
- 新来源包含真实分析、PCM、原视频和校对绑定，供既有内容草稿、审阅计划和工程来源校验使用。内部 `semanticSource` 只投影已确认的有效时间片段；无时间的人工粘贴正文不能替代。语义加工队列本批仍未迁移。
- 新校对版本使旧来源及依赖失效，保留原历史；永久撤回限制识别正文、原声、历史下载及后续采用。原始视频和工程历史不改写。

源码入口：[服务与来源](../packages/postgres/src/runtime-transcriptions.ts)、[worker](../packages/postgres/src/runtime-transcription-worker.ts)、[路由](../apps/api/src/postgres-transcription-routes.ts)、[内容来源校验](../packages/postgres/src/runtime-content-sources.ts)。

## 数据、权限和恢复

新增并已实际应用的 `026-native-file-transcriptions.sql` 固定为 runtime23；001—025 原摘要不变，后续从027开始。SQLite052/下一053保持。

| 数据/接口 | 行为 |
| --- | --- |
| `_dg_native_transcription_inputs` | 固定任务摘要及实际识别器回执 |
| `_dg_native_transcription_outputs` | 仅由受控 worker 完成函数写入的分析、PCM、初次校对凭据；不可覆写 |
| `studio_transcription_revisions` / `studio_transcription_sources` | 不可覆写的校对历史及确认绑定 |
| `_dg_native_transcription_leases` | 两个实际执行槽位，30秒租约；最多三次尝试 |
| `GET/POST /studio/transcriptions` | 本人任务列表与创建；跨账号私人任务不能读取 |
| `GET /studio/transcriptions/capabilities` | 实际识别器/语言、文件限制和明确模拟能力 |
| `GET /studio/transcriptions/:id` | 当前任务；来源失效时隐藏正文和原声地址 |
| `POST …/:id/review,confirm,control,withdraw` | 版本保护的校对、来源确认、取消重试和永久撤回 |
| `GET …/:id/revisions,audio,export` | 历史、私有 Range 原声和指定校对版本下载 |

上述路径均带 `/api/v1` 前缀。写入需要当前会话、CSRF、编辑权限及幂等编号；原视频和当前空间权限在最终提交前复验。共享内容来源允许授权成员读取，但不开放他人的私人转写任务。API 不可写识别分析或完成凭据；worker 不获普通任务行写权限。取消后等待实际执行器结束才释放槽位，旧 token 不能提交或释放新执行。

## 实际检查

- [完整后台回归](evidence/T20/postgres-processing/backend-summary.json)：**483项/29文件通过，19项新增原生检查**；同时覆盖已有8项 SQLite 转写检查和素材、工程、配音、内容、PPT等关联模块。
- 首轮新增检查5通过/12失败，修正 worker 加锁读取后13通过/4失败，再修正内部确认输入及测试下载地址后17项通过；最终新增19项全部进入完整483项回归。原失败报告保留，未修改已应用SQL或扩大worker写权限。
- [编译版证据](evidence/T20/postgres-processing/compiled-summary.json)：**16个不同检查**来自首轮9项和恢复轮7项，不是一轮16项全过。首轮进程观察脚本因 `Get-FileHash` 不可用中断；原报告保留，以 .NET SHA256 修正观察脚本后复用同一数据库、密钥和编译产物补验。
- 实际本机中文 SAPI 文案生成39.745秒声音，实际视频上传和 PCM 解码，实际 Windows 中文识别；保留原始识别文字及参考分，不把参考分当准确率。
- 实际创建、完成、校对、确认事务提交前强杀；完成事务的分析、PCM凭据、初次校对、审计、事件全部回滚。两次原30秒租约自然恢复，另恢复前一脚本中断留下的任务，未改租约时间。实际识别请求进程运行期间强杀其所属编译 worker，并独立核对后代关闭。
- API强杀与 PostgreSQL停止/重启后，分析、校对、来源和撤回状态保持；数据库不可用返回503，没有回退SQLite。
- **10个实际 built 界面流程通过**：原稿与校对分开、实际私有 PCM 播放、保存修订、明确确认、字幕下载、刷新、390px、只读成员共享来源及撤回。19个Chrome进程关闭，无设备采集调用或未预期API失败。
- 45个编译核验直接子进程与43个独立观测进程关闭；另3个独立媒体核验进程关闭。当前编译仅 API、worker、原生初始化CLI改变；70个旧编译文件及50个前端文件不变。
- [独立媒体核验](evidence/T20/postgres-processing/media-verified/verification.json)：实际导出文件为1920×1080 H.264、24帧/约1秒，已实际解码；输入系统声音非静音。这只接受文件规格及来源链。

## 画面复核发现与边界

[三张原图复核](evidence/T20/postgres-processing/visual-review.json)中，桌面和390px转写界面通过，**新导出帧的整段长字幕裁切为FAIL**：整段讲稿直接使用默认字幕框时，第三行底部被截断。74批次按词/字素断行不能解决框容量。原失败PNG保留，已记入R-077继续处理；不把可播放视频当作字幕显示验收。下一增量需要限制容量或按时间分页，并核验原文字/时间不丢失、旧预览缓存和FHD/4K输出。

19项新增后台检查使用明确命名的契约识别器及真实FFmpeg PCM；真实 SAPI/ASR 另有编译证据。编译界面中的校对确认是原创合成文案的自动化流程测试，没有声称自然人听审。没有接通外部ASR、真人音色或语气克隆、实时麦克风、声纹身份、目标说话人提取，亦不接受自然语音准确率、实时延迟或客户质量。旧模型语义质量及神经降噪5/6的失败证据不变。

## 启动与复验

默认工作台保留在本机 `http://127.0.0.1:5174/studio/transcriptions`，原33223四进程未重启、未切库。正常启动方式仍是 `pnpm dev`；已有服务运行时不重复启动。新代码的原生验证采用独立私有目录和账号，按[原生运行说明](62-postgres-native-core.md)初始化 `pnpm postgres:runtime`；随后分别指定其私有 `api.json`/`worker.json`，以 `DATABASE_DRIVER=postgres`、`POSTGRES_CORE_VALIDATION_ONLY=1`、`APP_ENV=development`、`PROVIDER_MODE=mock` 运行 `node dist/api.mjs` / `node dist/worker.mjs`。本批私有验证实例已关闭，不自动激活归档或上线公网。

当前完整回归命令保存在 `backend-current-command.json`；可执行 `pnpm typecheck`、`pnpm lint`、`pnpm build`。新增后台文件为 `tests/integration/postgres-transcriptions.test.ts`，真实编译核验入口为 `scripts/postgres-transcription-compiled.mjs`，必须使用新的证据标签，避免覆盖旧报告。

主数据库原301表/3315行基线不替换，3310业务行保持；1条已观测到期认证被正常清理，原始差异报告另存，两密钥及私有备份保持。134需求、38任务、65验收、26能力组、27项本地verified不变。对象存储/生命周期、生产身份及原生备份恢复、录制/媒体加工、直播/AE、发布投放、批量团队和其余全场景原生领域继续；T20/R-058/R-059/G2和目标保持进行中。
