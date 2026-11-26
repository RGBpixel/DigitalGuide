# DigitalGuide 本地开发说明

2026-11-18｜应用 0.1.0｜本轮任务 T01 / T02 / T03 / T36，关联需求见 backlog.json。

## 启动与配置

在项目根目录依次运行 pnpm install、pnpm setup:local、pnpm dev。默认工作台 http://127.0.0.1:5173，API http://127.0.0.1:4300/api/v1/health。API 和 worker 使用同一 SQLite 文件及 WAL；API 与媒体任务分进程运行。所有端口只监听回环地址。端口占用会显示中文提示，修改私有 .env 中 API_PORT、WEB_PORT 和 WEB_ORIGIN 后重试。

本轮验证使用 Node 24.14.0、pnpm 11.25.0。实际依赖以 pnpm-lock.yaml 为准。项目内 store、hoisted 布局与源码别名避免依赖 Windows 的符号链接权限。未关闭依赖供应链策略。setup:local 生成虚构组织、成员、工作空间、场所、PNG 形象参考和 PCM WAV 提示音。种子操作不更新已存在的业务记录。

storage/ 保存数据库、源素材和 .session-secret；不要提交此目录。SESSION_SECRET 可在服务端私有环境中配置，前端只能获取防 CSRF 凭证，不获取会话密钥。APP_ENV=production 禁用演示账号入口与登录，生产 OIDC 仍待后续任务。PROVIDER_MODE=sandbox/live 没有已配置适配器时返回 PROVIDER_NOT_CONFIGURED，不退回模拟结果。

## 功能路径

1. 从虚构账号入口进入工作台。切换工作空间可查看权限范围；只读成员不能写入，编辑成员不能查看内部研发与审计。
2. 在资产与角色上传 PNG 或 16 位 PCM WAV（不超过 8 MB），校验字节内容与规格后确认资产。暂不支持视频、JPEG 或外链导入；请先转换支持格式，其他输入能力由后续制作任务补齐。
3. 素材菜单中登记训练用途、主体、证明说明和到期时间，再提交模拟训练。撤回或到期会阻止尚未完成的任务。此处是授权记录与策略验证，不代表素材法律权限已被系统独立核实。
4. 新建角色绑定同一工作空间的参考素材和场景。配置可保存新版本、检查场景路由；检查会验证角色版本、素材有效期和供应商状态，不会启动真实数字人服务。
5. 在任务中心提交正常、可重试、失败或结果未知的模拟检查。未知状态不自动重发；运行中取消需 worker 确认，完成结果才会写入用量。失败原因及下一步可见。
6. 管理员可查看操作审计；普通审计只记录动作和资源引用，不保存授权证明或媒体内容。

T04 已增加企业接待与独立访客终端，见 [接待终端说明](13-reception-terminal.md)。来访登记/通知与人员记忆，以及创作、PPT、直播、发布投放、展厅、餐厅和课程的业务流程仍按 M2—M4 开发；规划入口不作为已实现业务的证据。G1 和 G2 均未验收。

## 实现目录

apps/web 是 React/Vite 工作台；apps/api 为 Fastify API；apps/worker 为持久任务执行器。packages/contracts 是 Zod 输入契约和 OpenAPI；packages/domain 是服务端规则；packages/database 是 SQLite Repository；packages/providers 为可替换模拟协议；packages/media 校验真实媒体字节；packages/test-fixtures 只包含合成素材和虚构数据。

migrations/sqlite 按文件名排序、事务执行并记录已应用版本。migrations/postgres 预留给后续生产迁移，尚未实现，不声称本地数据库文件可直接生产迁移。核心表记录租户和工作空间；查询基于服务端会话，写入使用 Idempotency-Key、CSRF 及乐观版本锁。

运行 pnpm api:spec 从共享 Zod 契约生成 [OpenAPI 3.1](api/openapi.json)。已实现的 M1 路径包含在此文件；完整目标 API 仍以数据接口文档为规划来源。资产、任务和角色有显式响应 schema，其他管理响应当前仅描述封套，业务模块会继续补齐。

任务按环境隔离。worker 的租约令牌与过期时间共同限制提交结果，重启可接管过期任务。状态、用量和 outbox 在事务内提交，用量以 job_id 唯一约束防重。M1 的 outbox 消费者仅为本地事件流，不发送通知或执行真实渠道动作。当前任务为短时模拟调用，长时媒体处理的心跳与取消需要相应任务扩展。

## 检查与证据

~~~powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
node scripts/build-docs.mjs
node scripts/check-docs.mjs
~~~

test:e2e 使用已安装 Chrome，无需操作用户浏览器资料。隔离服务默认使用 4311/5179；不复用正在运行的开发服务。每次使用新的 storage/e2e-runs/ 子目录，测试不会清空当前开发数据库。

build 输出 dist/web、dist/api.mjs、dist/worker.mjs。根目录运行 pnpm start 和 pnpm start:worker 可启动构建后的后端；静态前端需通过同源代理转发 /api。此输出供本地构建验证，生产 TLS、OIDC、PostgreSQL、对象存储与上线仍未验收。

检查是否实际执行及结果，以 PLAN.md 和 docs/evidence/M1 中的报告为准，不以这里列出的命令视为通过。

## 模拟边界及外部条件

上传字节、SQLite 持久化、会话、权限、授权策略、版本锁与任务队列是实际本地实现。图片和提示音是代码生成测试素材；模拟训练不产生真人形象、声音或语气克隆模型。参考图片不等于实时数字人。没有发送真实通知、发布社交内容、推流、开启广告、接入 POS、扣款或部署公网。

后续真实接入按专项任务准备供应商产品线/账号、授权人像与语音、终端及音频设备、通知和日历、POS/测试支付、渠道权限、展品与设备协议、AE/LMS 条件。缺少这些条件不影响当前工程继续开发。
