# T20 / R-058 PostgreSQL 隔离迁移基础

当前应用继续使用原SQLite数据库。本增量提供独立原生PostgreSQL基线、加密归档导入与完整回读工具，目标始终为隔离schema；不等于API/worker切换、对象存储迁移或G2生产验收。全平台134需求/38任务/65验收/26类继续保留，T20与R-058仍in_progress。

后续已增加[独立原生身份与核心任务验证](62-postgres-native-core.md)。默认完整工作台仍为SQLite，本页归档保持隔离；该新模式不激活或导入旧归档资料，也不代表其他业务模块已完成原生迁移。

## 范围与实现

`migrations/postgres`独立编号001–003，对应SQLite截至052的最终结构：301业务及历史表、3641列、399组外键、95组非主键唯一约束、69个CHECK、149个显式索引、106个原生触发器。另有2张隔离运维元数据表。SQLite052及以前不改写，下一SQLite迁移仍为053。

先在一个PostgreSQL事务中创建全新schema和表，复制原始行，再安装并验证外键、索引和触发器。这样既有素材索引不会因导入时重新触发创建而重复。全过程不禁用系统触发器、不执行源归档DDL、不覆盖既有schema；失败回滚全笔事务。

输入复用[加密备份格式](60-encrypted-recovery.md)：AES-GCM认证、全部归档文件逐个SHA-256核对、SQLite完整性/外键/迁移文件及结构指纹检查。只支持与当前独立052基线完全一致的源；不接受任意旧版本或未来迁移。运行时执行仓库内经过摘要核对的原生SQL，生成器只用于审查基线，不在应用启动时翻译SQL。

INTEGER使用bigint及十进制字符串传输，保留64位整数；REAL使用double precision；TEXT保持原始Unicode与JSON字符串，列采用C排序规则。SQLite文本先读原始字节，再严格解码UTF-8，保留BOM；零字节、无效UTF-8、TEXT中BLOB、整数列非整数、非有限浮点值、原生主键不允许的NULL均明确拒绝，不截断或替换。单行16MiB、批次约4MiB/100行，整个操作受归档文件/容量/行数上限约束。

所有301表逐行生成摘要、逐表排序汇总，再由原生PostgreSQL游标回读对比。SQLite自增高水位从sqlite_sequence读取，包含已经删除的最大编号，不能仅依据max(sequence)重置。回执包含原生约束/索引/触发器/函数/序列配置/行级策略的目录摘要。后续verify同时检查目录、迁移历史、数据和自增状态；旧回执不能替代重新校验。

两种数据库的触发器执行顺序、类型约束等并非通用等价。当前验证关键撤权、不可变记录、撤回永久性、素材索引及JSON部分唯一索引；完整业务接口仍需通过原生Repository重构和跨模块验收，不以“106个触发器均存在”宣称所有业务语义已验收。

## 运行

先准备专用离线PostgreSQL数据库和非超级用户账号，允许该账号在专用数据库创建schema。正式应用账号不应拥有迁移DDL权限。使用已有私有连接文件，密码只从独立文件读取：

```json
{
  "purpose": "offline-staging-only",
  "host": "db.internal.example",
  "port": 5432,
  "database": "digitalguide_staging",
  "user": "dg_loader",
  "passwordFile": "D:/Private/DigitalGuide/pg-password",
  "tls": {"mode": "verify-full", "caFile": "D:/Private/DigitalGuide/pg-ca.pem"}
}
```

相对路径按连接文件目录解析。不能传入明文密码字段或连接串。远程连接强制校验证书与主机名；只有显式127.0.0.1/::1才允许`loopback-test-only`，本批真实数据库验证也使用TLS。导入拒绝超级用户，不接受public或任意已有业务schema。

```powershell
pnpm postgres --help
pnpm postgres import --archive 'D:/Private/DigitalGuide/backup.dgbackup' --key-file 'D:/Private/DigitalGuide/backup-key' --connection-file 'D:/Private/DigitalGuide/pg.json' --schema dg_import_0123456789abcdef0123456789abcdef --work-dir 'D:/Private/DigitalGuide/work' --confirm-staging
pnpm postgres verify --archive 'D:/Private/DigitalGuide/backup.dgbackup' --key-file 'D:/Private/DigitalGuide/backup-key' --connection-file 'D:/Private/DigitalGuide/pg.json' --schema dg_import_0123456789abcdef0123456789abcdef --work-dir 'D:/Private/DigitalGuide/work'
```

编译入口为`node dist/postgres.mjs`，参数相同。每次导入使用新的32位十六进制schema编号；同编号并发仅一方可成功，既有schema不覆写。工具没有正式激活、DROP、TRUNCATE、业务通知、支付或发布命令。

临时明文仅存在指定私有work-dir的本操作目录。正常成功、取消或错误会清理；操作系统强杀不能执行finally，可能留下`.dg-pg-import-*`明文目录。强杀后先确认操作进程/数据库事务已结束，保留原归档并用新连接检查目标及回执，避免把提交结果不明误写成失败。由主机管理员只清理已确认归属的该临时目录，不清空整个work-dir、不改动归档和密钥；工具当前未提供自动清理崩溃残留。客户端在COMMIT附近断开时须通过verify判断结果。

## 验证与边界

可选Windows验证运行时：`pnpm setup:postgres-native`。从EDB官方链接下载18.7-2 x64 ZIP，固定本批观测SHA-256并核对原生版本；EDB未提供该包的公开校验值，不能把本地计算值称为厂商签名。保留服务器与命令行第三方许可，运行时逐文件固定摘要。仅私有目录解压，不安装系统服务或修改PATH。测试集群绑定回环，生成临时TLS证书，通过Windows Job Object管理服务器进程树；测试后停止并核对端口及所属进程。

```powershell
pnpm exec vitest run tests/unit/postgres.test.ts tests/integration/postgres-native.test.ts
```

缺少该可选运行时时原生集成用例会skip，skip不能当作通过。本批实际结果见[证据目录](evidence/T20/postgres)。核心应用仍可用`pnpm dev`按原本地配置启动。

隔离数据库保留源行，包括历史任务/认证记录；它没有连接API或worker，不能向其发起正式业务。源文件中的会话签名密钥、模型/媒体字节和外部环境秘密不写入PostgreSQL；文件只被验证，不上传对象存储，也不改写数据库中的原绝对路径。需要保留原加密归档及其密钥，不能把导入回执当作完整备份。

下一步：异步原生Repository与事务/租约/鉴权/租户隔离、对象存储迁移及引用校验、生产身份与秘密管理、认证与授权重建、未决支付/通知/发布核对、删除传播、恢复目标和正式激活流程，以及费用/告警/品牌嵌入/部署验收。真实供应商、生产基础设施和现场设备仍按对应任务准备，不因一个外部账号缺失停止独立工程工作。

参考：[PostgreSQL原生触发器](https://www.postgresql.org/docs/18/sql-createtrigger.html)、[原生约束](https://www.postgresql.org/docs/18/ddl-constraints.html)、[node-postgres TLS](https://node-postgres.com/features/ssl)、[EDB官方二进制](https://www.enterprisedb.com/download-postgresql-binaries)。
