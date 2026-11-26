# PostgreSQL 生产迁移边界

T20/R-058已提供独立原生基线：001表/索引、002外键、003触发器及baseline.json。覆盖SQLite截至052的301表、399组外键、149索引、106触发器；由离线工具在全新隔离schema中单事务导入及校验加密归档，不执行归档DDL或覆盖既有schema。生成器是构建时审查工具，后续PostgreSQL独立编号；SQLite052不改，下一053。

默认完整应用继续使用SQLite。独立原生验证实例逐步接入同一API/worker的异步事务、租约、素材和制作链；生产身份、对象存储、全平台迁移及部署继续，本目录不表示已完成生产切换。[隔离归档](../../docs/61-postgres-staging-migration.md)、[当前原生制作与迁移边界](../../docs/67-postgres-project-packages.md)。

004–005为全新dg_validation实例增加运行归属、受限锁函数及核心任务约束，runtime.json固定迁移摘要。身份与provider.check的异步API/worker已实际验证；默认完整工作台仍SQLite，归档不激活，其他业务/生产继续。004/005已应用并冻结，下一PG006；SQLite052不变/下一053。[原生核心](../../docs/62-postgres-native-core.md)。


006-native-assets.sql新增原生私有上传来源/训练固定来源、受限素材/授权锁及不可覆写守卫；只用于全新独立验证实例，不能激活归档或自动升级旧验证schema。001–006已实际执行并冻结，下一为007；SQLite仍052/下一053。[操作与证据](../../docs/63-postgres-native-assets.md)。


007-native-library-clones.sql增加固定模拟来源、训练尝试/状态历史、文件记录守卫；008-native-library-reference-counts.sql提供不开放正文的受限引用统计，修复首轮权限不足而不改写007。001–008已实际执行并冻结，下一009；SQLite仍052/下一053。[操作与证据](../../docs/64-postgres-library-clones.md)。


009-native-studio.sql增加工程/模板/品牌守卫、受限读取函数和静态PNG固定来源/文件凭据；010-native-studio-invalidation.sql保留既有失效规则，仅修正其执行身份，不开放未迁移正文。原生工程/模板/品牌、多轨保存和静态PNG已验证，视频成片/导入/批量协作/其他场景继续。001–010已实际执行冻结，下一011；SQLite052不变/下一053。[操作与证据](../../docs/65-postgres-studio.md)。

011-native-studio-media.sql为时间线/成片任务增加固定来源、产物凭据及状态/租约守卫；012-native-media-reference-counts.sql将媒体快照引用加入受限计数并增加作用域索引，原008/011不重写。实际MP4/WAV、HD/4K Alpha MOV、字幕清单和中断恢复已验证；工程包/PPT/派生/协作/批量及其他模块继续。001–012已执行冻结，runtime.json版本9，下一PG013；SQLite052不变/下一053。仍仅支持全新独立验证实例，不升级旧实例或激活隔离归档。[操作与证据](../../docs/66-postgres-media.md)。


013-native-project-packages.sql增加工程包传输/分片守卫、固定清单/素材来源及受限worker提交；首轮bigint分片索引FAIL保留，通过独立014-native-package-part-index.sql显式转换。015-native-package-completion-audit.sql增加同事务完成审计，016-native-package-library-search.sql使用共享Unicode名称键修复实际全角检索回归。原013/014/015未重写。001–016已执行冻结，runtime.json版本13、下一PG017；SQLite052/下一053。实际ZIP/分片/重新导入已接通；视频/PPT/其他派生、批量协作和其他全场景继续，仍只支持全新独立验证实例。[操作与证据](../../docs/67-postgres-project-packages.md)。


## 017 原生视频来源

017-native-video-sources.sql已在独立实际PG执行并冻结，runtime.json版本14，下一018。新增_dg_native_video_origins、受限视频完成入口与不授予业务账号的内部素材函数，保持租约/当前成员/空间与原件凭据、完成审计及事件的同事务提交。001—016未改写；不用于旧schema原地升级或激活隔离归档，SQLite052/下一053不变。见[实现与验证](../../docs/68-postgres-video-sources.md)。


018-native-document-imports.sql已在独立实际PG执行并冻结，runtime.json版本15，下一019。新增_dg_native_import_sources/outputs/media三个不可变账本、文档状态/租约/固定输入守卫及受限dg_native_commit_import入口；解析结果、实际PNG来源、完成审计和事件同事务提交。worker无直接写入输出或替换正文权限。001—017不改写，仍只初始化新的独立验证schema/目录，不激活归档；SQLite052/下一053保持。见[实现与验证](../../docs/69-postgres-document-imports.md)。

019-native-presentations.sql已在实际私有PG执行后冻结，SHA 749e6abff4385b70edb704aafcb6bc318cbab6d0d3a3f3f3607bd50c818d5325，runtime.json版本16，下一020。固定逐页来源、历史与采用凭据、完整成片/断点绑定、问题所属和答复不可变；003主持失效函数仅切换为受限SECURITY DEFINER并保留正文/固定路径。001—018未改写；自动模型/配音表不授予API或worker，SQLite052/下一053、默认工作台保持。见[实现与验证](../../docs/70-postgres-presentations.md)。


## 原生 PPT 自动答疑与系统语音（2026-11-23）

020-native-presentation-answers.sql已在真实私有PG执行后冻结，SHA f5f545ce7b9caa73ff8bcb4a5a77dc8f747b0672563eccf9f8875acfcdd92078，runtime17/下一021。新增_dg_native_answer_inputs/outputs、固定问题/配置/尝试与播放约束、受限worker上下文和CPU生命周期及提交函数；原生逐子问模型与系统声音已接通。001—019不改写，不激活归档或原地升级旧验证schema。通用工程配音及其他原生模块继续，SQLite052/下一053及默认工作台保持。 详见[实现、接口和验证](../../docs/71-postgres-presentation-answers.md)。


## 原生工程配音、品牌词典与人工语言字幕（2026-11-23）

021原生声音守卫/账本，022领取版本列限定，023工程包PCM WAV上限64MB，024品牌归属布尔函数，均已在实际独立PG执行后冻结。原001—020保持。runtime.json为21，下一025；SQLite052/下一053不变。024不授予worker品牌正文SELECT，023不扩大普通上传8MB上限。仍仅初始化全新验证schema/目录，不原地升级旧验证实例或激活隔离归档。 详见[实现、接口与证据](../../docs/72-postgres-speech-authoring.md)。


## 原生内容来源、脚本与真实模型队列（2026-11-23）

025原生内容来源/定位、草稿/计划、真实模型队列及固定来源/输入输出采用账本，已在实际独立PG提交后冻结，SHA256=2791241ccbf71668b23821aa480112123d95ca7780b749fa602cd386ff1ea28a。001—024保持；runtime22/下一026，SQLite052/下一053不变。worker无来源/定位原文直接SELECT和任意结果UPDATE权限，只用受限投影和完成函数；共享旧物理模型租约但不改020函数。只初始化全新验证schema/目录，正式备份恢复和生产接入继续。 详见[操作、接口及证据](../../docs/73-postgres-content-authoring.md)。
