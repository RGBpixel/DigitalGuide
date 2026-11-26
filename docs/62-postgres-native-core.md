# T20 / R-058 原生 PostgreSQL 身份与持久任务

最新原生素材、角色及三类模拟任务见[006增量](63-postgres-native-assets.md)。本文保留001–005核心交付及其历史证据；最新操作与下一迁移以63文档为准。

本增量让同一API工厂和worker入口实际使用异步PostgreSQL处理身份、权限、核心任务与本地事件，不再只有离线复制工具。当前原生模式只贯通上述核心链路，支持的任务为`provider.check`；结果明确`simulated=true`。数字人、素材授权链、创作/PPT、接待/记忆/餐饮、直播/发布/投放及其他模块继续迁移，原SQLite工作台保留全部既有本地功能。

全平台134需求/38任务/65验收/26类不变，27项本地verified和历史G1结果保持。T20、R-058/R-059、G2和平台目标仍未完成，当前不能用于生产启用或证明真人/声音克隆、真实通知、支付或发布能力。

## 实际接入

`DATABASE_DRIVER=postgres`需要显式`POSTGRES_CORE_VALIDATION_ONLY=1`、开发/沙箱、mock、匹配的私有运行配置和数据目录。未知驱动、不完整配置、生产/真实环境、恢复验证混用均在启动前拒绝。无SQLite回退。

新实例使用`dg_validation_<32位十六进制>`空schema、独立实例ID、目录归属标记和新服务密钥。只允许经过核对的独立原生迁移001–005；SQLite仍冻结052，下一SQLite为053，下一PostgreSQL为006。301原表及2张运行元数据表在单事务内创建，不伪造SQLite迁移历史。

[上一批加密归档](61-postgres-staging-migration.md)的`dg_import_*`及`_dg_import_control`始终隔离，不能通过本模式激活。初始化只接受全新目录/schema，不覆盖旧工作台、不载入归档人员/会话/任务。旧验证实例也不会自动升级或重建。

API、worker与迁移账号分离；运行账号不得具有超级用户、创建数据库/角色、复制或绕过RLS权限，不得继承迁移账号或彼此的权限。API/worker无DDL、成员修改或运行控制行修改权限。受限的SECURITY DEFINER函数在固定search_path中执行成员共享锁和租户排他锁，仅授权指定角色；pg_temp放在最后，函数不向PUBLIC开放。

异步事务固定同一池连接，AsyncLocalStorage将嵌套调用绑定到该事务；异常回滚，内层异常被捕获也不允许外层提交。仍在运行的未等待查询使事务回滚，事务结束后的异步调用不能继续使用已释放连接。只读事务由PostgreSQL拒绝业务写入。

## 身份、作用域与任务

沿用现有HTTP路径和响应格式：health/readiness、演示账号/登录/退出、me、jobs及cancel、capabilities、events、provider-usage、audit-events。演示身份只在独立开发/沙箱验证实例中使用；生产OIDC尚待接入。

登录会话落PostgreSQL，服务端核对签名Cookie、有效期、环境、当前成员、组织及真实工作空间归属；写入核对Origin、CSRF、角色与空间。成员锁跨await保留，提交前重查会话有效期。Cookie名含实例ID，避免覆盖同主机现有SQLite工作台的`dg_session`。同一实例多个API及重启后共享私有签名密钥和持久会话。

幂等键以组织/账号/操作隔离，原生事务锁串行化同键竞争；只保存任务引用，回放仍重查当前权限和任务。正文改变409。不同键的并发提交在租户行锁下核对每日额度，不能靠并发绕过。

worker通过`FOR UPDATE SKIP LOCKED`领任务；租户锁约束并发，拿锁后按数据库当前时间生成完整10秒租约。令牌及到期时间在最终UPDATE中再次比较，旧worker、旧令牌或等待锁后已过期的结果不能落库。完成前重查创建人的成员/工作空间/权限，撤权后不采用旧结果或记录成功用量。

暂时故障按真实available_at重试；未知结果保持unknown，不自动重领；取消结果不采用。任务状态、结果、用量和outbox在一个事务内提交，重复完成不增加用量。outbox消费者只确认本地`job.*`事件，不发送通知、发布、支付或其他真实业务动作。

004增加核心任务的输入不可变、状态转移及租约约束。005用受限函数完成租户锁，保留运行账号无租户写权限。不是所有原生业务已验收的声明；未迁移路径明确503/`PG_MODULE_NOT_MIGRATED`。

## 启动

先准备专用PostgreSQL数据库、迁移账号及两个独立低权限登录角色。连接文件沿用[61文档](61-postgres-staging-migration.md)的显式私有连接格式，密码只放独立文件，远程必须验证TLS证书及主机名。本批实际验证也使用TLS。

~~~powershell
pnpm postgres:runtime --help
pnpm postgres:runtime init --loader-file 'D:/Private/DigitalGuide/loader.json' --application-file 'D:/Private/DigitalGuide/api-connection.json' --worker-file 'D:/Private/DigitalGuide/worker-connection.json' --schema dg_validation_0123456789abcdef0123456789abcdef --data-dir 'D:/Private/DigitalGuide/native-demo' --app-env development --confirm-local-validation --seed-synthetic-identities
~~~

上层私有目录须已存在，native-demo须不存在。`--seed-synthetic-identities`只创建两个虚构组织、三个空间和四个演示成员，不导入任何真实资料。省略该参数则不创建演示身份。生成api.json、worker.json、两密钥及归属标记；配置中只有凭据文件路径，没有明文密码。

~~~powershell
$env:DATABASE_DRIVER='postgres'
$env:POSTGRES_CORE_VALIDATION_ONLY='1'
$env:POSTGRES_RUNTIME_CONFIG='D:/Private/DigitalGuide/native-demo/api.json'
$env:DATA_DIR='D:/Private/DigitalGuide/native-demo'
$env:APP_ENV='development'
$env:PROVIDER_MODE='mock'
$env:RECOVERY_VALIDATION_ONLY='0'
$env:SESSION_SECRET=''
$env:CONTENT_PROVENANCE_SIGNING_KEY=''
$env:API_PORT='4309'
$env:WEB_ORIGIN='http://127.0.0.1:5179'
node dist/api.mjs
~~~

第二终端设置相同环境，再将POSTGRES_RUNTIME_CONFIG改为worker.json，运行`node dist/worker.mjs`。API仅绑定本机回环。当前用于核心接口验证，完整UI继续使用原SQLite工作台及`pnpm dev`配置。

~~~powershell
pnpm postgres:runtime check --config-file 'D:/Private/DigitalGuide/native-demo/api.json' --role api
pnpm postgres:runtime check --config-file 'D:/Private/DigitalGuide/native-demo/worker.json' --role worker
node node_modules/vitest/vitest.mjs run tests/unit/postgres-runtime.test.ts tests/integration/postgres-runtime.test.ts
~~~

CLI编译入口为`node dist/postgres-runtime.mjs`。缺少可选原生PG验证运行时时，原生集成用例会skip，不能记为通过；安装及许可说明见61文档。当前Windows上原恢复目录联接用例通过直接Node启动验证，pnpm启动差异及原FAIL保留。

## 当前证据与剩余条件

[本批证据](evidence/T20/postgres-runtime)包含当前146项/9文件通过，其中新增50项；构建/typecheck/lint及原始失败/修正前源码保留。覆盖同连接/嵌套/未等待事务、真实行锁、20并发幂等/额度、撤权、自然10秒租约、等待锁后过期和完整租期、未知结果、取消、整数与目录隔离。

编译10项/19个直接子进程关闭，独立观察36所属进程归零：两个实际HTTP API和两个worker共享PostgreSQL；同键20请求只创建一项；worker在提交租约后SIGKILL，另一进程自然到期重领且只记一次用量；实际API重启保留cookie/任务/密钥。独立编译事务进程完成jobs/idempotency/audit/outbox四份写入后、COMMIT前被强杀，四表均回滚。数据库实际停机时API503，无SQLite文件，恢复后继续原生读取。进程日志核对不含密码、Cookie、CSRF或服务密钥。

原完整工作台当前在[本机入口](http://127.0.0.1:5174)运行（会话33223）。13921曾通过20组旧样例、练习built页面及PPT v1/v2核对；工具刷新后独立OS检查确认旧四进程/两端口已停止，按原数据/两密钥/AE配置续启，新的就绪与练习检查通过；不将工具句柄消失直接解释为进程退出。原始停止检查器误用pid字段的FAIL，以及上一批同类审计的补查均保留，后续按正数ProcessId核对。

租户锁首轮权限不足及校验错误被包装为503的原FAIL已保留，分别通过独立005迁移与保留Zod错误类型修正。原SQLite样例和数据另作只读复核，不用新建Native夹具替代旧数据。

仍需迁移全部其他业务模块的异步Repository、资产/来源/克隆授权和租约、对象存储及引用路径、生产身份与秘密管理、完整PG备份/恢复/生命周期/外部删除、未决业务核对、费用/告警/品牌嵌入和正式部署。当前SQLite加密备份命令不能代替原生PG备份。实际供应商、合法真人素材、现场设备、Adobe、渠道/POS/测试商户、目标LMS及生产基础设施按原G2任务继续准备，不因一个依赖缺失停止独立开发。

参考：[PostgreSQL锁定读取](https://www.postgresql.org/docs/18/sql-select.html)、[受限函数](https://www.postgresql.org/docs/18/sql-createfunction.html)、[node-postgres同连接事务](https://node-postgres.com/features/transactions)。
