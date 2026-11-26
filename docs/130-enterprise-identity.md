# 企业登录与已有成员访问控制

2026-11-26｜增量130｜T35 / R-119 / AC-56

平台已接通OIDC授权码登录、管理员明确绑定外部身份、身份源开关，以及已有成员的停用、恢复和会话撤销。SQLite和原生PostgreSQL均已实现。验证使用本机签名身份源和虚构人员，真实企业互操作、完整账户供应及离职业务处理仍需继续；R-119、T35、T20和G2保持进行中。

## 当前可使用的流程

| 使用者 | 当前行为 |
| --- | --- |
| 部署管理员 | 在服务端私有配置中登记固定发行方、授权/令牌/JWKS端点和客户端密钥文件；应用环境必须匹配 |
| 覆盖全部组织空间的管理员 | 核对发行方后启用登录；把精确外部subject绑定到已有本地成员；停用/恢复绑定或已有成员；查看最近记录 |
| 部分空间管理员 | 只读查看当前空间成员，不能更改影响整个组织的登录与账户状态 |
| 已绑定成员 | 前往身份源验证，回到平台后沿用当前本地角色和空间；身份源的邮箱、姓名或管理员声明不自动增加权限 |
| 停用的成员 | 原登录被撤销，新登录拒绝；恢复后重新登录，旧cookie不会恢复 |

未知subject不会自动建号，也不会按同名或相同邮箱合并账户。该登录链路与人脸、声纹或访客识别分别管理，不授予设备、支付或其他业务操作权。

## 登录与当前授权

~~~mermaid
sequenceDiagram
    participant B as 浏览器
    participant A as 平台API
    participant I as 受信任身份源
    B->>A: 从当前工作台开始登录
    A->>A: 保存短期流程及浏览器绑定
    A-->>B: 返回固定授权地址
    B->>I: 授权码 + PKCE + state + nonce
    I-->>A: 经浏览器返回一次性授权码
    A->>I: 在事务外交换令牌并验证签名
    A->>A: 再次检查当前配置、绑定及本地成员
    A-->>B: 签发平台会话，回到固定工作台
~~~

采用锁定的openid-client 6.9.1（MIT），授权码流程使用PKCE S256、state、nonce和最长300秒的认证新鲜度。额外启用JWS签名检查，当前限定RS256、固定JWKS与授权响应iss；客户端认证使用client_secret_post。未配置自动发现、任意算法或任意企业IdP兼容承诺。实现依据见[OpenID Connect Core](https://openid.net/specs/openid-connect-core-1_0.html)、[OAuth安全实践RFC9700](https://www.rfc-editor.org/rfc/rfc9700.html)及[openid-client签名检查说明](https://github.com/panva/openid-client/blob/main/docs/functions/enableNonRepudiationChecks.md)。

- 登录流程最长5分钟，浏览器凭据使用独立的HttpOnly、SameSite=Lax cookie；state和浏览器凭据只存摘要，nonce及PKCE验证值加密保存。
- 回调先原子消费流程、清除加密秘密，再在数据库事务外交换令牌。失败后重新开始，不重放原授权码；并发回调只有一个能交换。
- 令牌端点及JWKS地址从服务端私有配置固定读取，不接受用户指定地址或网络重定向。响应最多512KiB、请求最长10秒；真实配置要求HTTPS，合成配置仅允许127.0.0.1且限开发/沙箱与mock。
- 完成交换后重新检查当前身份源版本和摘要、明确绑定及本地成员状态，按现有角色和空间创建平台会话。平台会话最长8小时，并受已验证ID Token到期时间限制；不保存访问/刷新令牌或完整ID Token。
- 外部会话每次请求都检查当前身份源、绑定、成员版本和启动配置摘要。关闭身份源或绑定会撤销关联外部会话；停用成员会撤销当前环境的全部平台会话。
- 服务端401使员工工作台重新读取当前身份并返回登录页；访客及外部分享接口的401不触发员工退出。它不声称远程擦除已下载内容，也不自动倒回已发出的业务动作。

原生账户控制先取组织锁，再取会话/成员锁。成员停用与既有成员读取串行化，等锁后重新读停用状态；两个管理员并发互相停用不能让两人都失去访问。当前登录用户不能自行停用自己。SQLite使用同步事务执行同一组声明式工作流，不在事务内等待身份源网络。

## 配置核对与操作记录

组织管理写入必须满足当前管理员、完整组织空间权限、当前版本、CSRF、幂等键和明确确认。身份源启用还必须带当前管理员视图提供的configurationToken；绑定必须同时带该核对凭据及providerVersion。凭据为不暴露配置秘密的核对摘要，不是登录令牌。

私有配置变化后，旧页面的核对凭据会被拒绝；另一个API明确核对新配置后，旧部署不能继续按旧配置发起登录。界面在版本变化时清除确认，并重新核对当前成员/来源。停用、恢复与配置更新保留既有业务记录，运营事件只追加，原始subject只用于匹配，不以正文展示或留在普通日志中。

成员分页每页最多50项，界面默认20项；每组织最多1000个绑定、每成员最多10个绑定；每组织最多1000个待处理登录流程、每浏览器最多5个。开始登录只清理当前组织、环境和应用环境中过期的流程，不清理其他组织的数据。这些本地边界不代表生产入口限流和全部组织安全策略已验收。

## 接口与配置入口

| 接口 | 用途 |
| --- | --- |
| GET /api/v1/auth/methods | 已启用的公开登录入口及演示登录可用性 |
| POST /api/v1/auth/oidc/start | 由当前工作台Origin开始浏览器绑定流程 |
| GET /api/v1/auth/oidc/callback | 一次性回调；成功或失败均303跳回固定工作台 |
| GET /api/v1/enterprise/identity?workspaceId=UUID | 当前空间成员、身份源及最近记录；支持cursor/limit |
| POST /api/v1/enterprise/identity/provider | 核对并启用或关闭身份源 |
| POST /api/v1/enterprise/identity/binding | 明确绑定精确subject到已有成员 |
| POST /api/v1/enterprise/identity/binding-control | 按当前版本停用或恢复绑定 |
| POST /api/v1/enterprise/identity/member | 按当前版本停用或恢复已有成员 |

共享OpenAPI已生成。部署配置入口为服务端ENTERPRISE_IDENTITY_CONFIG_FILE，默认空；配置格式如下，仅为格式示例，不是可运行凭据：

~~~json
{
  "version": 1,
  "environment": "live",
  "appEnv": "production",
  "providers": [{
    "id": "70000000-0000-4000-8000-000000000001",
    "tenantId": "10000000-0000-4000-8000-000000000001",
    "name": "企业身份源",
    "mode": "oidc",
    "issuer": "https://sso.example.invalid/oidc",
    "authorizationEndpoint": "https://sso.example.invalid/authorize",
    "tokenEndpoint": "https://sso.example.invalid/token",
    "jwksUri": "https://sso.example.invalid/jwks",
    "clientId": "replace-with-registered-client-id",
    "clientSecretFile": "D:\\Private\\DigitalGuide\\oidc-client.secret"
  }]
}
~~~

回调固定为WEB_ORIGIN加/api/v1/auth/oidc/callback。密钥正文不写入配置示例、前端或报告；配置文件与密钥由部署管理员保存在私有服务端目录。修改配置后需受控重启相应实例，并明确重新核对；本轮没有重启现有主工作台。配置错误或真实身份源失败不返回模拟登录成功。

## 持久化与迁移

新增enterprise_identity_providers、enterprise_member_controls、enterprise_identity_bindings、enterprise_login_flows、enterprise_identity_session_origins、enterprise_identity_events。会话来源随对应auth_sessions删除级联清除；停用与恢复修订持久化。原生工作进程经现有中央成员函数检查当前停用状态，不需要读取私有登录流程。

SQLite055与原生132首次提交后冻结，runtime129。源码SQLite001—055/下一056，原生001—132/runtime129/下一133；新原生实例507表。主工作台仍SQLite052，主库报告中的“下一053”指主库当前迁移位置，不能当作源码下一056。新表由既有恢复日志安装流程纳入覆盖，完整当前身份恢复核对及生产启用仍是T20后续工作。

## 实际验证与版本边界

61个不同自动用例分阶段有通过证据：10单元、SQLite原阶段24、原生26、迁移定向1；其余44迁移用例未执行。原SQLite另2项失败保留：跨空间状态码预期与OpenAPI包装层断言；最后用例在完成重启、当前cookie和待处理流程检查后因元数据断言失败，没有把整个用例计为通过。

同一个失败SQLite根接续两组补验，共3+4个检查：补齐权限/Origin/CSRF和元数据检查，新增合成成员目录停用与双管理员竞争，以及配置核对、绑定版本和租户过期清理。原提供方及原绑定保持，原24项成功业务与原重启流程没有重做。新配置核对和后续界面逻辑由这些补验及编译流程补充覆盖，不把最初61个用例说成最终源码的全仓单轮测试。

8个不同编译检查、13类GUI按3+1+9同库接续取得证据。前两次编译脚本分别因按钮辅助说明的精确名称匹配、错误的创作页面地址失败；随后保留同一数据库、原API/Web及身份源端口、RSA密钥与既有身份设置，直接接续未完成的流程。没有重建已成功的身份源/绑定，也没有重复已经完成的签名登录。

本机身份源实际完成5次授权码交换、2次JWKS请求；包含停用时签名有效但平台拒绝登录的情况。GUI覆盖管理员启用/绑定、只读拒绝、现有编辑角色、实际新建工程、撤销后下一接口返回登录、恢复需重新登录、绑定/身份源开关、冲突重新确认及390px。5次交换是不同账户状态下的必要登录尝试，不冒充5次真实企业认证。

实际双API及PostgreSQL重启后507表、两原应用密钥、当前管理员/SSO cookie、配置/绑定/状态/历史及已创建工程保持。另一组双管理员真实并发互停仅一方成功，仍保留一位活动管理员。身份源的管理员声明不能扩大原编辑权限，私有空间创建被拒绝。

另起的临时编译预览对原主API只做匿名GET，确认旧服务仍显示明确的演示登录入口；没有给主库签发新登录，没有重启主进程或改库。桌面、手机、绑定核对和旧登录兼容截图均已查看。最初两次失败浏览器没有完整CIM创建身份捕获，不扩大这部分覆盖；之后的浏览器父进程与退出后严格核对单独记录。

SSO验收实际执行91份编译文件。截图检查发现父级“套餐与席位”导航也高亮，最后只给该NavLink补end属性；27份服务器编译文件相同，Web入口哈希传播导致57个路径差异。最终91份构建已离线复制核对，未再次执行整套GUI或业务；原91份执行版本与当前91份离线版本分别绑定。以下截图拍于该导航小修之前，不把离线构建当作新增执行证据。

类型、lint、构建、接口导出、文档结构和关闭核对的实际结果见最终清单；最初FetchBody类型、未使用导入及两次编译脚本FAIL均保留。普通日志/JSON已检查应用密钥、cookie/CSRF及合成身份源的client secret/state/nonce/code，未保存原始秘密到报告；没有读取或链接4.28GB内容模型，没有操作摄像头、麦克风或真实外部业务。

## 启动与查看

现有主工作台API4301/web5174保持原实例，本轮隔离服务已关闭。可查看[桌面管理页](evidence/T35/enterprise-identity/identity-compiled-tail/identity-desktop.png)、[手机管理页](evidence/T35/enterprise-identity/identity-compiled-tail/identity-mobile.png)、[手机绑定核对](evidence/T35/enterprise-identity/identity-compiled-tail/identity-mobile-review.png)及[旧服务登录兼容](evidence/T35/enterprise-identity/identity-compiled-tail/identity-legacy-login.png)。

在独立项目副本按[运营看板启动说明](127-operations-metrics.md#启动与查看)使用Node.js24.x、锁定依赖、新DATA_DIR和两份新私有应用密钥；选择独立空闲端口，如API4311、WEB5181、WEB_ORIGIN=http://localhost:5181。在该副本运行pnpm install、pnpm setup:local、pnpm dev，管理员访问 http://localhost:5181/enterprise/identity。没有配置身份源时仍可查看并控制已有演示成员；企业签名登录需要单独私有配置和已绑定身份。

不要在当前主数据目录重新初始化或占用主端口。原生使用README的postgres:runtime流程创建包含132迁移的新隔离mock实例；本轮成功封存根不重新开放，恢复隔离副本不通过企业登录激活。

## 完整目标及剩余条件

完整R-119/T35继续：入职建号/供应、调岗与全业务离职处理、企业目录及SCIM/组同步、实际企业IdP互操作、生产入口策略/紧急访问与最后登录源保护、MFA及企业单点登出等仍需落实和分别验证。当前已有账户停用不等于完成所有已派发业务的撤回、所有工作族的代次中止或公司目录自动同步。

真实接入仍需身份管理员提供经核对的元数据、已登记回调、有效客户端凭据及具体使用授权；本轮没有登录真实公司账号。套餐与正式收费、完整货架/资产迁移、品牌嵌入/API/SDK/Webhook、全部指标/成本与部署，及T20完整恢复核对/生产复制启用继续。

全平台134需求、38任务、65验收、26功能组保持；27项仅本地verified，T20/T35进行中，9任务pending，G2和目标active。预制视频、PPT、直播、发布投放、展厅、前台、餐厅，以及真人/声音/语气克隆、多轨与模板、多人同屏、批量协作、透明导出、4K、资产导出与模型迁移全部保留。

最终清单位于`docs/evidence/T35/enterprise-identity/verification.json`。证据：[原生用例](evidence/T35/enterprise-identity/identity-native-initial.json)、[配置核对补验](evidence/T35/enterprise-identity/sqlite-review-isolation-supplement.json)、[编译接续](evidence/T35/enterprise-identity/identity-compiled-tail/proof.json)、[重启保持](evidence/T35/enterprise-identity/identity-compiled-tail/restart-verification.json)、[末次导航构建边界](evidence/T35/enterprise-identity/navigation-only-build-binding.json)。
