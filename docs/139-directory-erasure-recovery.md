# 恢复后的目录资料删除重核

2026-11-26｜增量139｜R-009、R-058、R-059、R-119｜T20、T35

已接通签名目录清理范围证明、隔离恢复后的只读预览、明确确认、原子清理和独立不可变运维收据。20个不同自动用例通过，实际构建的命令行12项检查按1+11在同一实例上分阶段通过，原始失败保留。完整平台目标保持active，T20、T35和G2尚未完成。

旧备份可能含有来源后来已清理的目录姓名、邮箱、外部编号和个人正文。既有签名日志只保存主键摘要；目录清理业务回执的主键是随机UUID，不能用它反推出人员。本增量在原日志格式之外增加独立签名证明，让恢复工具准确核对已证明的范围。

## 已实现的行为

| 环节 | 行为与边界 |
| --- | --- |
| 来源导出 | `journal-export`在读取完整日志的同一重复读快照内读取最低清理回执，验证目录已成为清理占位记录、回执只有原始INSERT，再生成独立Ed25519签名证明。 |
| 证明内容 | 只有范围主键摘要、原清理回执主键摘要及是否清理基础姓名的来源决定；不包含原姓名、邮箱、人员UUID、单位或个人正文。摘要仍按私有运维资料管理。 |
| 可信绑定 | 使用备份固定的来源公钥，绑定完整日志元数据与确切日志头SHA-256；错误来源、签名、范围、头、重复项或容量超限均拒绝。 |
| 文件发布 | 按流、代次和日志头保存，先私有临时文件再原子发布；同一头只能复用相同证明。证明先于日志头发布，未发布未来头的孤立证明不代表有效恢复输入。 |
| 恢复匹配 | 先完成原身份及目录保守撤权，逐一核对证明与完整签名日志中的原业务回执INSERT，再按范围摘要匹配恢复库中已有的受管成员。备份后新人员只计为未匹配，不创建人员或身份。 |
| 只读预览 | 返回将清理的目录正文、独占基础姓名、当前成员/控制范围、组关系、基础快照、绑定和旧登录数量，绑定完整数据库状态、固定规则、证明与日志头。 |
| 明确清理 | 固定预览摘要和明确确认缺一不可；在单一事务中完成占位、限制当前环境访问、移除匹配基础/组关系、停用绑定与失效旧登录。中途失败全部回滚。 |
| 共享姓名 | 严格保留来源清理时的决定。来源认定为共享时，恢复副本保留基础姓名；无关成员与其他环境记录保持。 |
| 审计与幂等 | 保留备份已有的原业务回执和目录事件；不根据摘要伪造原操作人、回执UUID或业务删除记录。另存所有者私有、不可改删截断的运维收据；同一有效确认复用原收据。 |
| 操作衔接 | 新增`directory_erasure_v1`状态边，与原身份、目录、隐私和基础撤权组成五类收据链。包含目录清理表的恢复库，基础撤权不能跳过此步骤。 |
| 恢复隔离 | 仍拒绝业务连接、执行队列和生产启用；清理完成不代表身份已重新核实、权限已重新授予或整个恢复计划已完成。 |

证明位于专用日志库的`<streamId>/directory-erasures/<generation>-<headSHA256>.json`，单个文件上限为运维容量与4MiB中的较小值，最多为运维行数容量与10000项中的较小值。原加密日志数据包、日志头及其既有格式保持。

## 启动与使用

在仓库根目录安装既有锁定依赖后，可先查看命令帮助：

```powershell
pnpm postgres:recovery --help
```

新功能使用独立原生PostgreSQL验证副本。初始化及独立启动参考[目录生命周期启动说明](138-directory-lifecycle.md)与[原生备份恢复](123-postgres-recovery.md)。当前主工作台仍为SQLite052，API4301/Web5174；本增量没有重启、升级、恢复或切换主工作台。

下面使用私有配置文件路径作示意，需替换为同一个隔离恢复副本及其固定计划的实际路径。密钥、密码、公钥固定关系和日志库按运维配置提供，不能把密码或连接串粘贴到命令参数中。

```powershell
# 来源：先备份，再定期导出同一来源的完整日志及独立清理范围证明。
pnpm postgres:recovery journal-export --config-file <来源api.json> --loader-file <来源独立运维连接.json> --store-dir <专用日志库> --key-file <私有AES密钥文件>

# 目标：完成隔离恢复及journal-plan后，按同一最新计划依次执行。
pnpm postgres:recovery identity-preview --loader-file <目标运维连接.json> --data-dir <隔离恢复目录> --store-dir <专用日志库> --key-file <私有AES密钥文件> --plan-id <计划UUID>
pnpm postgres:recovery identity-apply --loader-file <目标运维连接.json> --data-dir <隔离恢复目录> --store-dir <专用日志库> --key-file <私有AES密钥文件> --plan-id <计划UUID> --preview-sha256 <身份预览摘要> --confirm-identity-restriction
pnpm postgres:recovery directory-preview --loader-file <目标运维连接.json> --data-dir <隔离恢复目录> --store-dir <专用日志库> --key-file <私有AES密钥文件> --plan-id <计划UUID>
pnpm postgres:recovery directory-apply --loader-file <目标运维连接.json> --data-dir <隔离恢复目录> --store-dir <专用日志库> --key-file <私有AES密钥文件> --plan-id <计划UUID> --preview-sha256 <目录预览摘要> --confirm-directory-restriction
pnpm postgres:recovery directory-erasure-preview --loader-file <目标运维连接.json> --data-dir <隔离恢复目录> --store-dir <专用日志库> --key-file <私有AES密钥文件> --plan-id <计划UUID>
pnpm postgres:recovery directory-erasure-apply --loader-file <目标运维连接.json> --data-dir <隔离恢复目录> --store-dir <专用日志库> --key-file <私有AES密钥文件> --plan-id <计划UUID> --preview-sha256 <资料清理预览摘要> --confirm-directory-erasure
```

每步确认前核对对应预览的实际范围。随后按[隐私清理](125-postgres-recovery-privacy.md)与[基础撤权](126-postgres-recovery-authority.md)处理原计划；不能把本增量的目录清理收据当成整个计划已完成的证明。缺证、状态变化或来源不匹配时应保留隔离，并按错误原因重新获取可信输入或预览，不能绕过步骤开启业务。

## 实际检查与证据

| 检查 | 当前证据 |
| --- | --- |
| 单元7项 | 严格签名与头/来源绑定、篡改、重复范围、同头幂等及分叉拒绝、容量拒绝不发布、收据计数约束均通过。 |
| 原生13项 | 实际517表/两视图跨集群恢复、两密钥、缺证/格式/签名/确认/摘要/容量、状态漂移、两处故障完整回滚、精确清理与共享保护、原业务回执保留、幂等/不可变/五收据链及目标PG重启均通过。 |
| 编译命令行12项 | 初始环境1项、同实例续验11项通过：实际备份/校验/签名导出/跨集群恢复、顺序/确认/摘要/缺证拒绝、精确清理/共享保留、隐私及基础撤权、五类收据和目标PG重启原收据复用。首个空DELETE因验证脚本错误设置JSON请求头返回400，失败已保留；原实例经独立严格关闭核对后续验，不重新建号或重做已提交恢复。 |
| 类型及构建 | 当前类型、lint和应用构建通过。首次证明脚本引用不存在的辅助文件导致类型检查失败，已改为既有媒体模块；原始失败及修正、续验检查各自保留。 |
| Web与API契约 | 未增加HTTP产品入口；96份实际运行构建与当前产物绑定，69份Web及OpenAPI与上一轮字节相同，没有新增GUI检查。 |

证据目录：[本轮验证](evidence/T20/postgres-recovery-directory-erasure/verification.json)、[最终文件绑定](evidence/T20/postgres-recovery-directory-erasure/final-hash-audit.json)、[初始原生13项](evidence/T20/postgres-recovery-directory-erasure/directory-erasure-native-initial.json)、[原生五收据链](evidence/T20/postgres-recovery-directory-erasure/erasure-five-stage-chain.json)。所有结果以实际执行记录为准，失败记录不删除。

## 模拟与真实能力边界

使用本机真实PostgreSQL、实际编译CLI、加密归档、独立目标集群及虚构目录/人员/素材验证；没有连接真实企业IdP、采购服务、发送通知、直播发布、扣款、门禁或摄像头/麦克风。没有启动worker，也没有读取、复制或硬链接大内容模型。合成目录不构成真实SCIM/OIDC互操作验收，以上检查也不构成真人克隆、声音/语气复刻或G2验收。

无新增业务迁移。SQLite001—059、原生001—138及runtime135冻结，下一编号060/139。旧身份恢复v1、目录权限恢复v1和原日志格式不改；新资料清理算法为独立的`restored-directory-profile-erasure-v1`，首次实际提交后按固定规则复核原收据。

本轮只支持备份与当前日志采用相同覆盖版本；不能用较旧覆盖清单自动跨迁移恢复。清理针对恢复副本，不会重写或消除原加密归档中的历史个人信息。由于证明只含摘要，恢复后的新增业务删除标记不能凭空重建；正式生产前仍需设计可信删除标记接续、完整生命周期与正向身份/业务核实，隔离保护必须继续。

剩余外部条件包括真实IdP/OIDC与SCIM账号、正式密钥/信任根管理、对象存储及日志保留设施、生产业务核对流程，以及完整平台的真实模型、设备、渠道和现场验收。缺少这些条件不阻塞其他本地工程工作，也不能把它们标为完成。

全部134需求、38任务、65验收项和26能力组继续保留；27项本地verified、T20/T35两项进行中、9项pending只是任务数量状态，不代表整个平台已完成约71%的真实能力。
