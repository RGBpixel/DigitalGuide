# 受控企业目录与成员同步

2026-11-26｜增量134｜T35｜R-119

本轮增加企业目录的入站SCIM接口：管理员明确启用后，目录可供应新成员、更新核心资料、同步用户组和停用账户。角色及工作空间由服务端固定策略决定。本地停用或权限撤回需要管理员明确复核，外部目录不能静默覆盖。

本轮采用合成目录、虚构资料和独立数据库。真实企业身份源兼容性、目录管理界面、自动组权限映射和完整离职处理仍待完成；R-119、T35和G2保持进行中。完整平台仍为134项需求、38项任务、65项验收和26组能力，保留制作、PPT、直播、投放发布、展厅、前台、餐厅及真人形象、声音语气、多人、多轨、4K与资产迁移等要求。

## 已实现的接口与权限

| 接口 | 行为 |
| --- | --- |
| `GET /api/v1/enterprise/directory` | 组织管理员核对私有连接、固定角色和空间、待复核成员、资源/本地权限/停用版本及事件；不返回令牌或私有路径 |
| `POST /api/v1/enterprise/directory/connector` | 明确确认、幂等键、CSRF、当前版本和配置核对后启用或关闭连接 |
| `POST /api/v1/enterprise/directory/review` | 依据当前三类版本明确保留本地停用，或恢复固定目录策略；删除用户不能被复核恢复 |
| `/api/v1/scim/v2/{connectorId}/Users` | POST供应独立新UUID、GET分页；单资源GET/PUT/PATCH/DELETE |
| `/api/v1/scim/v2/{connectorId}/Groups` | 组及成员关系CRUD与原子PATCH；成员必须属于同租户、同环境、同连接 |
| `ServiceProviderConfig`、`Schemas`、`ResourceTypes` | 发现支持的核心结构、复杂属性子结构、独立Bearer认证和受限能力 |

SCIM采用`application/scim+json`及标准Error/List结构，不使用应用的`data`包装。全部操作重新读取授权管理员的实际角色、空间及停用状态。授权管理员降权、缺少任一组织空间或被停用时，同步停止。普通成员和仅覆盖部分空间的管理员不能管理整个组织目录。

连接的`ownerUserId`是明确授权的组织管理员，审计同时记录目录连接、该授权人及相关本地成员事件。新成员的基础账户为无空间viewer，只有当前环境投影具有配置的editor/reviewer/viewer与固定空间。目录不接受admin、口令、roles、entitlements或任意扩权字段，不按同名、邮箱或声音/人脸识别合并账户，也不自动建立OIDC登录绑定。

## 同步规则与协议范围

- User支持`userName`、`externalId`、`displayName`、`active`、核心`name`和最多20个邮箱；组支持名称、externalId及最多1000个用户成员。只读id/meta/User.groups不会变成权限输入；额外属性明确拒绝。
- `userName`在当前连接内采用NFKC与小写规范化唯一比较。删除后可以重新供应相同用户名，但获得新UUID；旧账号仍停用。该比较不是完整Unicode PRECIS互操作认证。
- 分页从1开始；返回最多100项，`count=0`仅计数。支持id、externalId、displayName及User.userName的单项`eq`过滤和顶层attributes/excludedAttributes投影；不支持复合过滤、排序、Bulk、修改口令或嵌套组。
- PUT替换支持的可写核心属性；PATCH最多50项操作，在内存中全部校验后同一事务提交。支持成员添加、替换和`members[value eq "UUID"]`移除；无效后续操作不提交前面的变化。
- 响应meta.version和ETag一致。可选If-Match拒绝旧版本412，支持现存资源的`*`和精确标签列表；GET支持If-None-Match。无变化的User/Group写入不新增修订。
- 组名称、成员关系不自动改变平台角色或空间。组改名/成员变化更新User.groups及其版本，用户改名更新Group.members的显示和版本，删除清除关联。组资源使用联结批量读取成员，不逐人查询。
- User资料的显示名在目录资源内更新；本轮不改写跨环境共用的`users.name`。应用其他页面的已确认姓名显示和组到空间的明确映射仍需后续实现。

协议依据：[RFC 7643核心结构](https://www.rfc-editor.org/rfc/rfc7643.html)、[RFC 7644协议](https://www.rfc-editor.org/rfc/rfc7644.html)。上述为有边界的核心实现，不表示已通过所有SCIM测试套件或Microsoft Entra、Okta、Google Workspace等真实身份源的互操作验收。

## 本地停用及恢复保护

所有目录和组织成员变更先取得同一组织锁，再校验成员和会话，避免两API相互停用或版本竞争覆盖结果。SCIM在取得锁后再次读取库外凭据和配置指纹；锁等待前已认证的旧快照不能跨过凭据轮换继续执行。

目录记录已确认的成员投影版本、停用版本及固定策略摘要。人工停用、恢复核对或本地权限变化造成漂移后，目录正向启用/更新返回409；目录仍可继续停用或删除，但保留待复核标记。人工直接调岗入口拒绝目录成员，人工恢复须走目录复核。复核的hold保持停用，resume明确应用当前固定策略及目录期望状态；期望active=false时不会把账号启用。原cookie在停用后删除，恢复不会复活原登录。

连接关闭会先轮换DATA_DIR外的私有令牌，再提交关闭和事件。即使数据库写入失败或旧启用位被恢复，旧令牌也已失效；失败不能冒充关闭成功，需要重新核对当前私有凭据。重新启用必须重新固定当前指纹。此为库外凭据撤销保护，不是完整目录灾备或生产断电持久性验收。

## 私有配置及独立启动

新增服务端环境变量`ENTERPRISE_DIRECTORY_CONFIG_FILE`。未配置时没有可认证的目录连接。文件示意如下，所有UUID及路径需换成当前独立实例中的真实配置；不要把令牌写入该示例、前端或仓库：

```json
{
  "version": 1,
  "environment": "mock",
  "appEnv": "development",
  "providers": [{
    "id": "70000000-0000-4000-8000-000000000001",
    "tenantId": "10000000-0000-4000-8000-000000000001",
    "ownerUserId": "30000000-0000-4000-8000-000000000001",
    "workspaceId": "20000000-0000-4000-8000-000000000001",
    "name": "合成目录验证",
    "mode": "synthetic_directory",
    "memberRole": "editor",
    "workspaceIds": ["20000000-0000-4000-8000-000000000001"],
    "tokenFile": "D:/DigitalGuide-private/directory-token"
  }]
}
```

令牌文件使用43—256位URL安全字符、高熵随机生成，绝对路径且位于DATA_DIR之外，拒绝链接和过大文件。配置最多20个连接；配置结构、环境和固定策略需部署管理员核对。策略文件修改需受控重载；令牌在每次请求时重读。合成模式只限非生产mock；`scim`模式要求固定HTTPS WEB_ORIGIN，不表示本轮已授权接入真实企业账号。原生数据库当前仍仅支持独立开发/沙箱mock验证。

已有独立原生实例的初始化方式见[原生运行说明](62-postgres-native-core.md)；检查和启动应指向该实例自己的配置和端口。编译后API启动示例：

```powershell
$env:ENTERPRISE_DIRECTORY_CONFIG_FILE = 'D:/DigitalGuide-private/directory.json'
$env:DATABASE_DRIVER = 'postgres'
$env:POSTGRES_CORE_VALIDATION_ONLY = '1'
$env:POSTGRES_RUNTIME_CONFIG = 'D:/DigitalGuide-validation/data/api.json'
$env:DATA_DIR = 'D:/DigitalGuide-validation/data'
$env:APP_ENV = 'development'
$env:PROVIDER_MODE = 'mock'
$env:API_PORT = '4319'
$env:WEB_ORIGIN = 'http://127.0.0.1:5189'
pnpm start
```

此示例仅用于已初始化的新独立实例。当前主工作台33223、端口4301/5174与SQLite052不重启、不迁移、不切库。本轮未增加管理界面，也不需要启动worker、摄像头或麦克风。

## 验证、冻结与后续

验证事实及最终摘要以[本轮清单](evidence/T35/enterprise-directory/verification.json)为准；清单仍为进行中时，不能认定整轮封存。原始失败、分阶段源码和命令记录保留，不通过重跑已成功业务覆盖历史。

SQLite057与原生135首次提交后冻结，原生runtime132/下一136，SQLite下一058。两库新增5张目录表，原生共514表及两权限视图；原迁移和既有身份恢复v1规则摘要保持。新增目录表的完整恢复选择规则、收据与长期资料保留/删除，生产正向身份核实和启用仍需后续版本化实现，不能套用旧收据冒充完成。

后续继续目录管理界面、明确组权限映射、真实IdP互操作、OIDC供应组合、全工作族离职中止、身份生命周期与恢复，以及企业运营其余需求。模拟与演示不能作为真实形象克隆、声音语气复刻、支付、发布或感知验收证据。真实账号、企业配置、必要业务授权和真实业务系统仍是外部条件；缺少这些条件不阻塞无依赖的本地开发。

本轮实际检查：40个不同自动用例/4文件分阶段有通过证据（9单元、15SQLite、15原生及1项迁移）；9项编译检查与2项纯前端匿名启动/旧接口降级检查通过。原类型、lint、OpenAPI语法和测试注入错误均保留；当前类型/lint/构建/OpenAPI通过。纯前端使用合成HTTP响应，不表示目录管理界面或真实身份验收；桌面及390px截图已视觉复核，无横向溢出，设备调用0。严格关闭2个私有PG根、9个检查端口与47个捕获创建身份，私有进程/监听0，失败GUI与单元夹具的PID创建覆盖不扩大。主工作台四原进程、3310业务行、两密钥和052保持，8自然过期登录未恢复；没有worker或真实外部操作。最终文档校验与哈希封存见本轮清单。
