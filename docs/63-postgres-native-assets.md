# T20 / R-058 原生素材、统一角色与专项训练授权

最新文件夹/标签/独立版本、回收影响与模拟参考验收见[007/008增量](64-postgres-library-clones.md)。本文保留001–006原件链路及其历史证据，当前操作和下一迁移以64文档为准。

本增量把既有R-005素材授权、R-010/R-011本地训练流程和统一角色的基础链路迁移到实际异步PostgreSQL。使用同一API工厂、worker入口及现有HTTP契约；默认完整SQLite工作台继续保留全部既有功能。全平台134需求、38任务、65验收、26类及27项本地verified不变，T20/R-058/R-059和G2继续。

## 已贯通的原生链路

PNG/PCM WAV上传、内容检查、私有原件、一次确认、分页、原件及Range下载、版本修改/历史、回收/恢复、专项授权/撤回、统一角色及场景绑定，已经在真实PG18.7/TLS实例运行。共享Zod输入与原路径保持：

| 路径 | 当前行为 |
| --- | --- |
| POST /assets/uploads、POST /assets | 内容识别、最多8MiB、私有随机文件名、固定SHA/规格；同键上传只保存一次，同上传并发确认只允许一次 |
| GET /assets、/:id、/:id/content、/:id/versions | 当前组织/空间权限、分页、完整或单一Range下载；原件每次按大小/SHA回读，历史不覆写 |
| PATCH /assets/:id | 服务器版本锁；回收/恢复递增版本并永久撤销既有专项授权，不自动恢复授权 |
| POST/GET /assets/:id/consents、POST /consents/:id/revoke | 专项用途、范围、期限、证明登记；用途不可互换，重放读取当前撤回状态；普通响应及审计不含证明正文 |
| POST/GET /profiles、GET/PUT /profiles/:id、GET /profiles/:id/versions | 同空间PNG/WAV参考、七类场景、版本历史、持久统一角色 |
| POST /profiles/:id/resolve | 当前版本、启用场景、素材可用性和熔断复验；只返回明确的模拟绑定，readyForRealService=false |
| POST/GET /jobs、cancel | provider.check、training.avatar、training.voice原生持久任务；训练固定原素材版本、原件SHA及专项授权 |

以上路径均带`/api/v1`前缀。匿名访问、只读账号写入、其他租户/空间、上传所有权不符、CSRF/Origin无效均拒绝。幂等记录只保存对象引用；每次回放重查当前成员及对象范围，不能借旧响应取得已失去的权限。Cookie仍按原生实例区分，不覆盖原SQLite登录。

每个原生资产具有独立、不可改写的`private_upload`来源记录，绑定组织、空间、运行环境、上传ID、SHA和大小。没有当前来源记录的资产明确503/PG_ASSET_ORIGIN_UNMIGRATED。当前不能把旧归档、字符派生、脚本派生、媒体加工、直播归档、收集或AE来源直接标成原生上传；这些链路仍需分别迁移和验收。

## 训练、锁和撤回

训练提交固定素材版本、原件和授权ID/期限。先按统一顺序锁成员、素材、授权，再等待额度锁；拿锁后重查数据库当前时间。等待期间自然到期的授权不能创建任务。

worker通过受限SECURITY DEFINER函数取得素材与授权共享锁，函数固定search_path且不向PUBLIC开放。worker没有素材、上传或授权写权限，也不能请求这些函数的排他写锁。共享锁跨await保留；回收或撤回须等待正在完成的读取事务。

执行前检查固定来源、当前权限、文件字节及有效租约；取消、到期或被重领的旧执行不能启动。提供商执行结束后再次核对当前来源、成员及专项授权，最终UPDATE仍比较令牌和数据库当前到期时间。执行期间撤回、素材版本变化或自然到期，结果不采用且不记成功用量。已有10秒租约、SKIP LOCKED、幂等/额度、取消/未知状态及本地outbox保持。

训练使用明确的MockTaskProvider，回执simulated=true，没有生成真人模型、克隆声音、语气或真实驱动文件。角色绑定PNG/WAV参考不代表真实数字人服务；studio/clones验收、派生作品、声纹参考和真实克隆分别建设，不互相替代。

## 数据与启动

原生迁移001–006；006新增两张固定来源表、受限锁函数以及原件/历史/授权守卫。001–005及SQLite001–052保持原字节，下一PostgreSQL为007、下一SQLite为053。新实例沿用301张基础表及两张核心运行元数据表，再增加两张来源表。API仅新增所需表/列权限，worker仅新增来源读取和共享锁权限。

初始化仍只接受全新独立目录/schema、开发或沙箱与mock；[原生核心说明](62-postgres-native-core.md)的三份连接文件、独立角色、TLS及环境参数沿用：

~~~powershell
pnpm postgres:runtime --help
pnpm postgres:runtime init --loader-file 'D:/Private/DigitalGuide/loader.json' --application-file 'D:/Private/DigitalGuide/api-connection.json' --worker-file 'D:/Private/DigitalGuide/worker-connection.json' --schema dg_validation_0123456789abcdef0123456789abcdef --data-dir 'D:/Private/DigitalGuide/native-assets' --app-env development --confirm-local-validation --seed-synthetic-identities
~~~

按62文档设置DATABASE_DRIVER、POSTGRES_CORE_VALIDATION_ONLY、POSTGRES_RUNTIME_CONFIG和匹配DATA_DIR，再分别运行`node dist/api.mjs`及`node dist/worker.mjs`。新建实例启用006；旧的001–005原生验证schema不会自动升级、重建或覆盖，不符合迁移摘要时拒绝启动。`dg_import_*`加密归档仍隔离，没有正式激活命令。当前不建议把完整UI切换到这一部分原生接口，完整工作台继续按[本地启动说明](58-local-user-guide.md)使用SQLite。

原件先写入当前实例私有objects，再将引用与业务元数据提交数据库。数据库失败或强杀可留下无引用的私有文件；不在提交结果未知时自动删除，避免删掉已成功提交的原件。本批实际验证数据库回滚和孤立字节保留，没有实现对象存储、自动孤立文件清理、原生PG备份/恢复或生产生命周期。

## 实际验证与后续

[本批证据](evidence/T20/postgres-assets)包含170项/10文件通过、0失败/0跳过，其中新增24项原生素材用例；原身份/队列、原生隔离归档、SQLite恢复/资产/财务检查继续通过。首轮20项通过的原报告保留，随后增加执行前取消/自然租约、共享锁和额度等待到期检查。既有原生测试仅更新006迁移清单及新训练能力预期，旧SQLite测试未改。

当前编译17项检查通过：两个HTTP API、两个worker、每种文件20同键并发只保存一次，实际PNG/WAV与Range字节回读、两类模拟训练与一次用量、角色绑定、执行前撤回拒绝、文件篡改拒绝。实际API强杀重启后文件/角色/登录/密钥保持；worker提交租约后被强杀，自然10秒重领；专用编译事务进程在写完素材/授权/角色/任务等14张表、COMMIT前被强杀，相关数据库行全部回滚，无引用私有文件保留。原4表事务回滚和PG停机503/恢复也通过。

22个直接子进程全部关闭，独立观察30个所属进程归零，全部私有PG集群的进程、端口和postmaster.pid另作OS检查。原正常工作台保持33223/原四个正数ProcessId，未为本批重启或更换原库/密钥；就绪与练习只读核对通过，全部原业务行另作摘要比较。原质量失败、历史最终清单、模型/许可及私有编译备份继续保留。

后续继续迁移素材库组织/文件版本/收集、studio/clones验收与角色扩展、各类派生来源、工程/模板/多轨/成片和其余全场景业务，再推进对象存储、生产身份、生命周期/删除、PG备份/恢复、费用/告警、品牌嵌入及部署。真实供应商、合法真人/声音/语气素材、物理设备、渠道、Adobe/POS/支付等外部条件仍按原任务准备。本批没有真实通知、推流、发布、投放、扣费、门禁或设备采集，不标G2或平台目标完成。
