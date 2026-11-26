# DigitalGuide 加密备份与隔离恢复

2026-11-22。T20/R-059的当前工程增量：为现有SQLite和本地DATA_DIR提供可重复使用的离线加密备份、独立验证、同路径恢复及中断保护。107项定向检查和当前编译8项实际进程检查通过；完整T20、生产PostgreSQL/对象存储及G2仍未完成。

本轮是运维命令，没有普通成员下载整库的HTTP接口。原134需求/38任务/65验收/26类范围保持，G1已有出口不替代生产治理。[证据目录](evidence/T20/recovery)保留原失败及修正；[当前编译演练](evidence/T20/recovery/compiled-current/proof.json)记录实际行为。

## 备份和验证

在仓库目录使用`pnpm recovery`；构建后可替换为`node dist/recovery.mjs`。帮助为`pnpm recovery --help`。

以下是运维路径示例，需替换为实际位置。原服务及使用同一目录的数据库连接应先停止；工具遇到占用会拒绝，不会强制停止服务。

~~~powershell
pnpm recovery keygen --key-file 'C:\DigitalGuideSecrets\recovery.key'
pnpm recovery backup --data-dir 'D:\DigitalGuideData' --output 'E:\DigitalGuideBackups\2026-11-22.dgbackup' --key-file 'C:\DigitalGuideSecrets\recovery.key'
pnpm recovery verify --archive 'E:\DigitalGuideBackups\2026-11-22.dgbackup' --key-file 'C:\DigitalGuideSecrets\recovery.key'
~~~

密钥文件是32字节或64位十六进制值，保存在DATA_DIR外，由主机运维单独保管；`keygen`不覆盖已有文件，不打印密钥值。密钥值不作为命令行参数。备份输出也必须位于源目录之外，已有备份不能覆盖。

根数据库通过SQLite备份API取得一致快照，源连接保持独占锁；同时保存DATA_DIR内的普通私有文件、空目录和文件中的两类服务密钥。每个文件有长度和SHA-256，数据库有表/行摘要、结构、外键、完整性和迁移SQL摘要。根WAL/SHM与恢复隔离标记不直接复制；额外目录按文件保存，不被宣称为其他数据库的一致快照。

归档采用不压缩的ZIP条目及AES-256-GCM，随机12字节nonce，格式头作为AAD，16字节认证标签。清单和文件名也在密文内。先回读已写入密文、认证解密及完整检查，再发布正式文件名；加密写入、源文件变化或验证失败均不冒充成功。JSON进度只含操作编号和阶段，结果只给摘要与数量，普通错误不输出原始内容、密钥或SQL。

默认限制是100GiB私有文件、10万个文件与目录、100万数据库行、32MiB清单；可通过`--max-bytes`、`--max-files`、`--max-rows`设置操作限制。文件路径、重复/大小写/规范化冲突、越界、符号链接或目录联接、特殊条目及不支持格式均明确拒绝。临时明文只在本机私有操作目录内使用；正常失败会清理，中断后按下方运维锁流程处理。生产Windows ACL、主机磁盘加密及秘密管理仍需按部署目标验收。

## 恢复与验证副本

当前版本保留平台中的绝对文件引用，所以要求恢复到清单中的原绝对DATA_DIR；目标目录必须不存在，不合并、不覆盖也不自动删除旧目录。迁往其他路径、PostgreSQL或对象存储的迁移继续由R-058/T20实现。

~~~powershell
pnpm recovery restore --archive 'E:\DigitalGuideBackups\2026-11-22.dgbackup' --data-dir 'D:\DigitalGuideData' --key-file 'C:\DigitalGuideSecrets\recovery.key' --confirm-restore
~~~

工具先完整认证、验证内容及数据库，再独占取得目标目录；数据带有完成状态及隔离标记。恢复后不会自动开业务，正常API模式、live/production及worker均拒绝启动。尚未完成的恢复不能借验证标志启动。

明确检查恢复副本时只启动API，不使用`pnpm dev`或worker。使用匹配的原文件配置，设置：

~~~powershell
$env:DATA_DIR='D:\DigitalGuideData'
$env:APP_ENV='sandbox'
$env:PROVIDER_MODE='mock'
$env:RECOVERY_VALIDATION_ONLY='1'
$env:API_PORT='4312'
$env:WEB_ORIGIN='http://127.0.0.1:5180'
node dist/api.mjs
~~~

该模式只允许核心素材/角色/任务读取、就绪检查及新的演示登录/登出；范围外的业务GET、全部业务写入和公开回调均403。素材和工作空间仍执行原鉴权及隔离。响应包含`X-DigitalGuide-Recovery: validation-only`，readiness明确worker和业务未启用。

每个验证API进程使用新的内存cookie签名，原备份cookie不能使用，验证进程重启后也需重新登录；原服务密钥文件字节保留。这是有限的恢复检查模式，未提供生产启用开关或完整工作台恢复承诺。普通未恢复实例默认行为保持。

正式恢复仍需从可信状态核对备份后发生的授权撤回/个人删除、身份变更、未决支付/POS/通知/发布、用量及外部回执；不能仅凭旧数据库重新开放真实动作。环境变量/秘密管理服务、DATA_DIR外的AE目录、模型运行时及外部对象存储未被自动打包，其恢复仍需分别实现和验证。

## 中断与运维锁

实际备份/恢复时，API与Repository启动会检查相应目录的运维锁。锁存有操作编号、进程和阶段；不会因为心跳超时就自动夺取。短时SQLite协调事务串行化创建及解锁，防止并发解锁误移走新操作的锁。

~~~powershell
pnpm recovery inspect --data-dir 'D:\DigitalGuideData'
pnpm recovery unlock --data-dir 'D:\DigitalGuideData' --operation-id '检查结果中的操作编号'
~~~

只在确证原进程已退出、操作编号相符时清理该操作的临时目录与带同编号的临时密文，不删除源数据、正式备份或解除恢复隔离。活进程、编号变化、异常路径或不能确认的状态均拒绝处理。验证归档使用`inspect/unlock --archive <备份> [--work-dir <原工作目录>]`。

如果恢复发布被中断且目标缺少隔离标记，工具保留启动保护，不直接解锁；应先检查并移开不完整目录，再重新验证原备份和恢复。若原PID被操作系统复用为活进程，也不会强制清理；由主机运维检查。进程强杀已验，断电、硬盘损坏和异地恢复未据此标真。

## 实际检查与剩余工作

当前107项/10文件涵盖新增31项、原鉴权/租户、队列/进程重启、订单/支付安全、记忆及练习。首次9项为8通过/1项测试字段错误，随后29项通过；补充防护与发现范围修正后当前107项通过。早期类型/lint诊断和误收集旧工程的中断记录保留，旧快照结果不计入当前通过数。收集范围固定为正式tests/unit与tests/integration，没有排除其中原用例。

实际编译CLI/API/worker执行8项：正常实例20任务及三项待执行、真实API重启保留登录；在线连接拒绝备份；加密流已有实际字节后强杀；死亡进程核对及双解锁竞争；256MiB原文件和全部数据库/密钥备份回读；移开原目录后恢复；默认/live/production及worker启动拒绝；真实PNG解码、旧cookie及业务回调阻断、待执行任务不重放。20个直接子进程均关闭，独立观察到14个所属进程并确认最终归零。首次编译检查器误把既有POST /profiles的201期望为200，原FAIL保留，按原契约修正后完整复验。

本批没有新SQL；052原摘要及053后续顺序保持。主工作台继续使用原数据与配置；当前实际句柄、重启核对及原数据保留结果见[PLAN](../PLAN.md)和本批runtime证据。

T20继续：PostgreSQL独立迁移/事务及对象存储、生产身份与密钥、完整生命周期和外部删除传播、恢复后的业务核对与正式激活、费用/限额/告警、品牌嵌入与部署验收。T35的套餐、SSO、API/Webhook和指标亦未完成；真实渠道及现场能力保持原条件。没有购买、发送真实通知、开播、发布、投放、扣费、控制门禁或上线公网。

实现参考：[Node.js 24.14 SQLite](https://nodejs.org/download/release/v24.14.0/docs/api/sqlite.html)、[SQLite独占锁](https://www.sqlite.org/pragma.html#pragma_locking_mode)与[备份API](https://www.sqlite.org/backup.html)。这些文档支持底层接口语义，实际验收以本批执行证据为准。
