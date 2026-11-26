# DigitalGuide 数据与接口契约

PG089/runtime86给原生餐厅“下一位”增加固定目标：`{action:'next',confirmed:true,sessionId,version,focusVersion}`，在门店和终端锁下复核；列表额外返回`currentSessionVersion/currentFocusVersion`，其他顾客或过期版本409且不执行结束。原生open仍仅action/confirmed，access必须带刚开启的sessionId。UI勾选保存当时的对象，轮询变化后取消确认。旧SQLite请求合同保持，OpenAPI提供原生请求变体；089的实现、分阶段GUI及原网址观察失败见[餐厅终端](104-postgres-restaurant-sessions.md)。

原生餐厅目录沿PG085/086实现门店、独立职责、桌位、菜单与库存，087/088接通独立终端及匿名顾客会话；原表不授予API/worker直接写权限。`Restaurant.capabilities`为可选能力状态，旧工作台缺省时沿用原功能。当前原生`terminals=true`，预约落座、订单、支付及餐后服务仍未启用，顾客`dining=false`。操作及访次绑定成员代次与门店职责版本，撤回再恢复不能复活旧键或Cookie。原生`POST /restaurant/terminals/:id/access`必须提交刚开启的`sessionId`，换人后不签发到其他顾客；旧SQLite仍接收原空对象合同，OpenAPI提供原生请求变体。餐厅访客的员工来访和个人记忆入口由服务端拒绝；专注对话复用共用会话守卫，原生专属`/restaurant/sessions/:id/speaker-events`仅接收本访次开启人的合成事件，不接真实音频。来源选择目录仍只向本店经理返回本空间有限字段，不授予知识编辑或业务身份。详见[原生餐厅配置](103-postgres-restaurant.md)和[顾客终端](104-postgres-restaurant-sessions.md)。

原生受限画面问答的授权、请求、执行租约、撤回与回复来源已沿PG082—084实现；复用既有vision输入，原图仅在内存，不入数据库。原键接续保留原8秒租约/15秒请求期限，当前来源、访问、focus及播放代次均由服务端复核。后端及编译/GUI分阶段验证已完成，原生私有mock的`visionQuestions`默认true；场景来源与逐次同意仍由服务端独立校验，mock-vision不证明视觉识别。当前说明和证据见[原生画面问答](102-postgres-vision.md)。

T20/R-059的[恢复验证模式](60-encrypted-recovery.md)由文件隔离标记和显式`RECOVERY_VALIDATION_ONLY=1`启用，配置还须为development/sandbox与mock。该模式只开放核心素材/角色/任务读取与新登录/登出；其他业务GET、写入及公开回调统一403/`RECOVERY_READ_ONLY`。响应带`X-DigitalGuide-Recovery: validation-only`，readiness明确`recoveryValidationOnly=true`、`worker=disabled`及`businessEnabled=false`。每个验证API独立内存签名使旧cookie无效，worker不启动。普通实例默认接口不变；整库备份不向普通成员提供HTTP下载接口。

版本 1.2｜2026-11-17

044增加`studio_presentation_answer_jobs`和`native_model_leases`，为旧场次增加默认人工答疑配置与控制代次，为问题记录实际回答任务。输入和已完成成果不可覆写；讲稿、引用、语音及播放控制都校验当前空间、来源、版本和有效代次。新增模型能力/场次配置/答疑任务/设备播放与私有WAV接口见[完整说明](43-local-presentation-answers.md)，OpenAPI由共享Zod契约生成。

## T08 创作实体与接口补充

迁移 013 增加 studio_projects/project_versions、studio_templates/template_versions、studio_brand_kits、studio_clones、studio_imports/import_media、studio_preview_frames/review_plans/preview_jobs。工程与模板内容、角色和导入页使用稳定 ID；源文件与 PNG 保存于私有 objects，接口逐次检查成员、工作空间和环境。studio.write 仅管理员/编辑者具备；只读读取不能升级为创建、预览、训练或恢复操作。

GET /studio/projects、/studio/templates、/studio/brands、/studio/imports、/studio/clones 使用 workspaceId/cursor/limit 分页，工程额外支持 archived。工程详情为 /studio/projects/:id，写入子路由 save、restore、archive、plan 和 previews；另有 versions 和 preview-jobs 读取。预览任务为 /studio/preview-jobs/:id 及 cancel，实际 PNG 为 /studio/previews/:id。计划只描述当前保存修订，确认哈希及分镜选择后才排队生成。

导入为 POST /studio/imports，详情、cancel、apply、source 位于 /studio/imports/:id；受控图片位于 /studio/import-media/:id。导入状态 queued → processing → review/failed/cancelled，apply 不消耗源页，以当前源版本和明确选页创建新工程；文件在多个工程复用时不能取消。模板和品牌更新使用 /:id/update；克隆使用 /studio/clones/:id/control，状态包含 training、awaiting_review、accepted、rejected、failed、unknown、cancelled、revoked。

所有写入执行现有鉴权、CSRF、来源、版本和幂等策略。幂等响应只缓存对象编号，返回时重读当前范围与授权，不缓存完整源文档或旧图片。OpenAPI 由共享契约生成；二进制下载仍需登录，不提供公开访问豁免。模拟训练与接待声纹参考是不同实体、用途和授权，不能互相替代。


本文定义首版语义与最低接口范围，开发时在 packages/contracts 中实现 schema 并生成 OpenAPI。接口路径可在保持兼容并更新文档后调整，不可让 UI 与服务端自行解释不同状态。

2026-11-18 T04 实现补充：工作人员使用 /terminals 与 /sessions 接口；匿名访客读取与写入限定在 /guest/sessions/:id 下，通过本会话路径的 HttpOnly Cookie、独立 CSRF 和服务端能力校验访问。此 Cookie 不能用于 /me、资产、任务或其他会话。当前没有自动授予员工身份。完整运行路径见 [接待终端说明](13-reception-terminal.md) 与生成的 [OpenAPI](api/openapi.json)。原表中的其他业务接口仍为后续目标范围，不表示本批全部实现。

T05 的登记、确认和通知使用 /guest/sessions/:id/visit 子路径；工作人员使用 /visits 和 /visits/inbox，接待回复限定已确认的指定收件账号。通知与员工同意分别记录，未知回执不重发，配置变更不重分配旧请求。模拟回调需要签名、时间窗口和事件去重；详情见 [企业来访说明](14-visit-workflow.md)。

T06 的本人资料使用 /people/self 与受所有权限制的 /people/:id，访客仅用 /guest/sessions/:id/memory。Person 的业务角色不会授予 Membership 权限；候选记忆、来源、确认和检索索引分别记录，个人原文/摘要/长期偏好按独立期限清理。实际路径与删除范围见 [人员与记忆说明](15-people-memory.md)。

T07 的员工事务使用 /office/relays、/office/inbox 和 /office/calendar；发信人由服务端身份固定，只有本人收件或参与范围可读。确认、内容修订版本和投递状态分开记录，会议变更使旧版通知失效。/office/public-notice 仅返回本人待查看的通用提示，不包含私密正文。实际状态和保留规则见 [员工消息与日历说明](16-office-messages-calendar.md)。

## T09 时间线接口

迁移 014 增加 studio_timeline_previews，保存组织/空间/环境、创建人、工程修订、计划哈希、区间、状态、租约/尝试数、进度、产物引用与结果。工程 JSON 的 timeline 保存六类可编辑轨道，不新增另一份脚本。片段采用稳定 ID、关联分镜/角色、时间、来源、变换、关键帧和音量曲线；独立形象来源 speaker_avatar 直接绑定角色，避免串联第一段文字及移除角色后的无主引用。

POST /studio/projects/:id/timeline-plan 审阅已保存版本与 0.1—30 秒区间；timeline-previews 子路由确认哈希后排队。GET 同一路径列出最近二十个任务，GET /studio/timeline-previews/:id 查看状态，POST /cancel 取消，GET /video 与 /audio 读取仍然有效的产物。媒体每次鉴权、范围隔离和当前来源校验，支持单一 Range 字节区间、206 与无效区间 416，不签发公开下载链接。

POST /studio/projects/:id/timeline-suggestions 绑定当前修订，返回 local_rules、modelUsed=false 及待审阅提案；背景候选先按工作空间和素材状态过滤。调用不改写工程，采用后通过原有版本化保存接口提交。模拟建议来源、素材混音和真人驱动分别标识，不将其组合为一次“真实克隆完成”。所有操作的共享契约与 OpenAPI 已同步。


## 数据约定

ID 使用不可预测的 UUID；时间保存 UTC，展示按场所时区。金额为最小货币单位整数并携带 currency；数量和单价不使用浮点累计。音视频时间使用整数毫秒。所有可编辑聚合带 version，写入采用乐观锁。

除明确的全局配置外，数据必须带 tenant_id。对访问越权的对象返回 404 或统一拒绝，不能泄露其存在。敏感资料的导出同样执行权限检查。

## 核心实体

| 实体 | 关键字段与关系 |
| --- | --- |
| Tenant / Workspace / Venue | 组织、工作空间、场所、时区、业务类型、保留策略 |
| User / Membership / RoleGrant | 登录主体、组织成员、角色、资源范围、有效期 |
| Person / PersonRole | 业务人员档案；可关联 User，但访客 Person 不是登录用户 |
| ProfileFact | 字段、值、来源、self_reported/verified、确认时间与可见范围 |
| ConsentRecord | 主体、具体用途、告知版本、授予/撤回时间、到期、证明引用 |
| IdentityBinding | person_id、提供商、模型/模板引用、授权引用；不存明文人脸于普通表 |
| MemoryFact | 内容、类型、来源、待确认/已确认/失效、scope、expires_at |
| Session / SessionParticipant | 场所、通道、临时 track、参与者、身份置信状态、接管状态 |
| Message / Transcript / Summary | 发言主体、时间、文本、来源、会话；原文与摘要可分开授权 |
| Visit | 访客、受访人、事由、预约引用、状态、通知和交接记录 |
| RelayMessage / Reminder | 发信人与收信人、内容、保密级别、触发条件、期限、回执 |
| Asset / AssetVariant | 类型、对象存储 key、hash、授权、规格、供应商资产映射 |
| TrainingJob | 形象/声音、素材、授权引用、供应商任务、验收结果 |
| VideoProject / ProjectVersion | 工程 JSON、脚本段、版本、工作空间、审核状态 |
| Template / TemplateVersion | 工程模板、变量 schema、适用比例和许可 |
| RenderJob / BatchJob | 输入版本、输出规格、任务状态、费用预算、manifest |
| Review / Approval | 对象版本、评论定位、审批人、结论、时间 |
| ChannelAccount / PublishJob | 平台、凭据引用、作品版本、计划、远端 ID、回执 |
| RestaurantTable / Reservation | 容量、占用状态、预订区间、版本和占用租约 |
| MenuItem / MenuVariant | 售价、库存引用、规格、可售状态、配料和确认过的限制 |
| DiningSession / Order / OrderLine | 桌台、顾客引用、行项目、备注、价格快照、版本 |
| KitchenTicket / KitchenEvent | 订单行、制作状态、必要备注与回执 |
| PaymentAttempt / Refund | 订单、金额、币种、渠道引用、状态、已验证回调引用 |
| Job / OutboxEvent / Delivery | 任务、持久事件、投递尝试、租约和幂等键 |
| AuditEvent / ProviderUsage | 操作者、动作、资源、结果、请求引用、资源用量和费用 |

唯一约束至少包含：渠道回调事件 ID、租户下幂等动作键、有效桌台占用、供应商任务映射、工作空间内工程版本。业务数据删除使用明确策略；审计不保存不必要原文。

## 身份与权限

身份状态：anonymous → self_reported → verified；face_candidate 仅是辅助证据，不是 verified 的自动升级路径。已验证登录员工的授权来自 Membership / RoleGrant。

访客可创建和查看自己持有会话令牌的来访请求；不能枚举员工、读取他人档案或获得内部通知内容。顾客只操作持有相应餐桌/订单会话凭证的草稿与订单，不因进入已识别人员库获得额外权限。

权限码示例：asset.read、asset.train、video.edit、video.approve、video.publish、visit.manage、message.private.read、memory.manage_self、order.create、order.refund、provider.configure。服务端同时验证对象所属关系、场所和动作，不能只检查角色名称。

## 状态机

### 来访与通知

Visit：draft → awaiting_confirmation → notifying → waiting_host → accepted / declined / escalated → completed / cancelled。

Delivery：queued → submitted → delivered（若渠道可证实）→ acknowledged；失败进入 failed，结果不明进入 unknown。submitted 只代表渠道接受请求。

接待人没有响应时进入 escalated 并转备用接待；不伪造接待人同意。

### 视频与发布

TrainingJob：draft → consent_checked → submitted → processing → preview_ready → accepted / rejected / failed。

RenderJob：queued → running → validating → succeeded；任一步可 failed 或 cancellation_requested，worker 停止后才 cancelled。succeeded 必须有实际文件和规格检查。

PublishJob：draft → approved → scheduled → submitting → published；远端状态不明进入 reconciling，不能直接重发。作品变更使原审批过期，须按新版本审批。

### 餐厅与支付

Table：available → held → seated → cleaning → available；reservation 参与可用性计算。过期 held 自动释放，有顾客确认占用时不得被另一请求覆盖。

Order：draft → awaiting_confirmation → confirmed → submitted → accepted → preparing → served → closed；cancelled 仅在允许状态发生。支付状态独立记录，餐品完成不自动等于已付款。

PaymentAttempt：created → pending → succeeded / failed / expired；退款使用独立 Refund 状态。成功只接受经过验证且订单号、商户、金额、币种匹配的支付结果。重复/乱序通知不得使成功降级，也不得二次记账。

## API 约定

基础路径 /api/v1。认证使用安全会话 cookie 或经过验证的访问令牌。终端访客采用能力受限的短时 session token。敏感写入防 CSRF；跨域仅允许配置来源。

普通成功返回 data、requestId；错误返回 error.code、error.message、error.retryable、requestId。列表使用 cursor 和 limit。异步任务返回 202、jobId、statusUrl。写操作需 Idempotency-Key；版本冲突返回 409。

代表性错误：AUTH_REQUIRED、FORBIDDEN、VERSION_CONFLICT、CONSENT_REQUIRED、CAPABILITY_UNAVAILABLE、QUOTA_EXCEEDED、PROVIDER_NOT_CONFIGURED、PROVIDER_TIMEOUT、STATE_CONFLICT、VALIDATION_FAILED。

| 领域 | 最低接口 |
| --- | --- |
| 系统 | GET /health、GET /readiness、GET /capabilities |
| 身份 | POST /auth/login、POST /auth/logout、GET /me；演示登录受环境限制 |
| 资产 | POST /assets/uploads、POST /assets、GET /assets、GET /assets/:id、POST /assets/:id/export |
| 克隆 | POST /training-jobs、GET /training-jobs/:id、POST /training-jobs/:id/accept |
| 视频 | POST /projects、GET /projects/:id、PUT /projects/:id、GET /projects/:id/versions |
| 模板与批量 | POST /templates、POST /batches、GET /batches/:id |
| 合成 | POST /renders、GET /renders/:id、POST /renders/:id/cancel、GET /renders/:id/manifest |
| 团队与审批 | GET /workspaces/:id/members、POST /reviews、POST /approvals |
| 发布 | POST /publish-jobs、GET /publish-jobs/:id、POST /publish-jobs/:id/cancel |
| 接待 | POST /sessions、POST /sessions/:id/events、POST /sessions/:id/messages、POST /sessions/:id/handoff |
| 人员 | POST /persons、GET /persons/:id、PATCH /persons/:id、POST /persons/:id/consents |
| 识别 | POST /identity/candidates；仅授权用途且不返回登录令牌 |
| 记忆 | GET /persons/:id/memories、POST /memories/:id/confirm、PATCH /memories/:id、DELETE /memories/:id |
| 来访 | POST /visits、POST /visits/:id/confirm、POST /visits/:id/notify、POST /visits/:id/respond |
| 消息 | POST /relay-messages、POST /reminders、POST /deliveries/:id/ack |
| 餐厅 | GET /venues/:id/tables、POST /table-holds、POST /dining-sessions、GET /menus |
| 订单 | POST /orders、PATCH /orders/:id、POST /orders/:id/confirm、POST /orders/:id/submit |
| 后厨 | GET /kitchen-tickets、POST /kitchen-tickets/:id/events |
| 支付 | POST /orders/:id/payment-attempts、GET /payment-attempts/:id、POST /refunds |
| 回调 | POST /webhooks/:provider/:type；独立签名与事件去重 |
| 运行 | GET /jobs/:id、GET /events（SSE）、GET /audit-events、GET /provider-usage |

路径中的 ID 只定位对象，访问控制不得由 ID 保密性代替。每类接口须包含成功、无权限、跨租户、输入错误和状态冲突测试。

## 工程 JSON 示例

~~~json
{
  "schemaVersion": 1,
  "projectId": "example-project",
  "version": 1,
  "canvas": {"width": 1920, "height": 1080, "fps": 25},
  "segments": [{"id": "seg-1", "speakerId": "speaker-a", "text": "欢迎来到演示展厅"}],
  "tracks": [
    {
      "id": "track-avatar-a",
      "type": "avatar",
      "clips": [
        {"id": "clip-1", "segmentId": "seg-1", "assetId": "asset-demo", "startMs": 0, "durationMs": 5000, "sourceInMs": 0, "zIndex": 2}
      ]
    }
  ]
}
~~~

示例 ID 仅用于说明，不代表真实资源。保存服务验证时间非负、素材权限、轨道类型、边界和 schemaVersion；未知版本拒绝并给出迁移提示。

## 事件与工具调用

事件封套：eventId、type、schemaVersion、occurredAt、tenantId、correlationId、aggregateId、payload。敏感信息用引用而非整段原文广播。

关键事件：presence.entered、session.started、identity.candidate_found、visit.confirmed、notification.submitted、notification.acknowledged、memory.proposed、memory.confirmed、render.completed、publish.confirmed、order.confirmed、kitchen.accepted、payment.verified、handoff.requested。

事件必须带环境标识，mock 事件不能进入 live 消费者。模拟摄像头触发与真实摄像头触发在界面和审计中明确区分。

大模型工具采用白名单，例如 lookup_host、create_visit_draft、notify_host、get_menu、hold_table、create_order_draft、submit_confirmed_order、create_payment_link。模型只提供结构化参数；服务端重新读取身份、价格和权限。确认令牌绑定用户、动作、金额/订单哈希、版本、过期时间，防止确认后被更换内容。

## 导出、删除和外部一致性

导出包包含 manifest、工程、被授权的源素材、字幕及可下载的资产；含供应商许可限制与缺失清单。不可下载模型须解释原因，不能提供空文件占位。

删除请求覆盖主库、媒体、检索索引、缓存与供应商侧删除能力。不能立即删除的必要业务记录保留最小字段并限制使用；后台可查看处理状态与失败重试，按既定期限完成。

## v1.1 新增领域契约

| 实体 | 关键字段与约束 |
| --- | --- |
| DigitalHumanProfile / SceneApp | 统一角色版本；场景、角色权限、知识范围、资产/语音/表达绑定及生效快照 |
| ExpressionProfile / PronunciationLexicon | 授权参考音频、风格、模型映射、参数、适用语言、试听验收和词典版本 |
| KnowledgeCollection / KnowledgeDocument / KnowledgeVersion | 来源、租户、场景可见范围、生效时间、索引状态和引用片段 |
| LiveProgram / LiveSession / LiveScene | 节目单、实时/预录/混合模式、时段、控制状态、角色和内容版本 |
| StreamDestination / StreamHealth | 渠道、凭据引用、协议、推流状态、最后心跳、错误与远端播放验证 |
| AudienceEvent / AudienceQuestion | 渠道事件 ID、临时观众引用、授权画面引用、去重键、审核及回答状态 |
| LiveRecording | 场次、分段文件、时间轴、可访问范围、归档与拆条任务 |
| AdAccount / Campaign / AdGroup / AdCreative | 渠道账户、目标、素材版本、预算、币种、排期、审批哈希和远端 ID |
| BudgetPolicy / SpendLedger / CampaignMetric | 本地/平台限额、实耗与在途、指标时间窗、口径、对账与暂停状态 |
| Exhibition / Exhibit / TourRoute / TourSession | 展区内容版本、路线、讲解段、当前断点、团体和预约 |
| DeviceBinding / DeviceCommand | 场所设备、白名单动作、会话授权、执行状态与回执 |
| Presentation / Slide / PresentationSession | 页码、原文、讲稿、人物位置、指示、动画降级、播放断点 |
| Course / BranchNode / Assessment / LearningAttempt | 分支图、题目、条件、学习记录、SCORM/LMS 映射 |
| RoleplayScenario / PracticeSession / Feedback | 角色目标、模拟工具、评价依据、访谈记录，区别正式业务 |
| SharePage / ReviewLink | 内容版本、受众、到期时间、CTA、审核和有限互动统计 |
| PlanSKU / Entitlement / CatalogListing | 套餐、席位/额度、资产货架、租户价格与有效期；不因本地创建就收费 |
| IntegrationClient / WebhookSubscription | 租户应用、授权 scope、凭据引用、事件订阅和去重回执 |

### 直播状态

LiveSession：draft → scheduled → preflight → preview → starting → live → stopping → ended。
failed、reconnecting、manual_control 为明确异常/控制状态；展示命令已提交和媒体已生效两个状态。某个 StreamDestination 失败不自动终止全部分发；策略配置决定停播或隔离该目标。预录内容绑定 mode，不能伪装为真人实时。

AudienceQuestion：received → moderated → queued → answering → answered；可 rejected、cancelled、expired。撤销未播回复不等于撤销已执行的业务动作；所有工具调用仍走确认和幂等。

### 广告状态

Campaign：draft → awaiting_approval → approved → activating → active → pausing → paused / completed。
平台审核状态单独记录。审批绑定 account、creativeVersion、budget、currency、schedule；任意受保护字段变化使旧审批失效。paused 只有远端确认后才显示为已暂停，未知进入 reconciling。指标记录 event_time 与 fetched_at，防止回传延迟被误认为花费已停止。

### 讲解状态

TourSession / PresentationSession：ready → explaining → question_pending → answering → resuming → explaining → completed。
currentSlide、segmentId 和 offsetMs 持久保存。多人提问不覆盖同一主讲断点。设备执行失败不允许数字人宣称“已经切换屏幕”。

### 新增接口

| 领域 | 最低接口 |
| --- | --- |
| 角色与表达 | POST /digital-human-profiles、POST /scene-apps、POST /expression-profiles、POST /expression-profiles/:id/preview |
| 知识 | POST /knowledge-collections、POST /knowledge-documents、POST /knowledge-versions/:id/publish、POST /knowledge-search |
| 直播 | POST /live-programs、POST /live-sessions、POST /live-sessions/:id/preflight、POST /live-sessions/:id/start、POST /live-sessions/:id/control、POST /live-sessions/:id/stop |
| 观众 | POST /live-sessions/:id/audience-events、POST /audience-questions/:id/moderate、POST /audience-questions/:id/answer |
| 录制 | GET /live-sessions/:id/recordings、POST /live-recordings/:id/create-clips |
| 投放 | POST /campaigns、POST /campaigns/:id/approve、POST /campaigns/:id/activate、POST /campaigns/:id/pause、GET /campaigns/:id/metrics |
| 展厅 | POST /exhibits、POST /tour-routes、POST /tour-sessions、POST /tour-sessions/:id/question、POST /device-commands |
| PPT | POST /presentations、PATCH /presentations/:id/slides/:slideId、POST /presentation-sessions、POST /presentation-sessions/:id/control |
| 课程 | POST /courses、POST /courses/releases/:id/exports、POST /learning-attempts、POST /learning-attempts/:id/events |
| 练习 | POST /practice-sessions、POST /practice-sessions/:id/feedback |
| 运营 | POST /plan-skus、POST /entitlements、POST /catalog-listings、POST /integration-clients、GET /operations-metrics |

新增权限：live.manage、live.start、live.moderate、ad.plan、ad.approve、ad.activate、ad.budget.manage、exhibit.manage、device.control、course.manage、entitlement.manage。普通视频编辑权限不包含广告激活，访客/直播观众不拥有组织后台工具权限。

新增事件：live.started、stream.health_changed、audience.question_received、live.handoff、recording.finalized、campaign.activation_confirmed、budget.threshold_reached、campaign.pause_confirmed、tour.resumed、device.command_confirmed、learning.progress_updated。所有事件沿用租户、环境、版本、关联和幂等约定。

保密约束：推流密钥不进入前端可读日志；普通观众事件不能携带其他用户摄像头；练习记录不自动并入员工绩效或顾客正式档案；跨场景统计优先聚合，不绕过身份和记忆权限。

## v1.2 说话人归属契约

新增 SpeakerFocusSession、SpeakerReference、SpeakerSegmentDecision，字段及接口详见 [目标说话人专项设计](10-speaker-focus.md)。会话保存配置快照和 focusVersion，转写片段保存 target/other/uncertain 判定，不将非目标文本写入对话记录。

接口包括 POST/GET/DELETE /sessions/:id/speaker-focus、POST /sessions/:id/speaker-focus/reacquire、POST /sessions/:id/speaker-focus/handoff，以及 POST/DELETE /speaker-references（删除具体资源时使用 /:id）。创建长期模板要求该用途授权；访问始终检查租户、场所、会话所有权及权限。

事件包括 speaker.focus_acquiring、speaker.focus_locked、speaker.focus_uncertain、speaker.focus_changed、speaker.segment_rejected、speaker.focus_released。订单、记忆与工具调用同时核对 sessionId、focusVersion 和原有确认令牌；新目标不能使用旧目标的确认。此检查在服务端执行，不能只靠客户端过滤字幕。

删除临时参考覆盖本地缓存与提供商引用，并记录完成/失败状态。长期参考与声音克隆素材独立管理；voiceprint match 不建立员工登录态。原始声纹和旁人转写不得进入普通日志或分析仓库。

## T26 本批落地接口

007/008 追加迁移引入 memory_recovery_credentials、memory_session_greetings、knowledge_collections、knowledge_documents、knowledge_versions、knowledge_chunks、scene_apps、scene_app_versions。接待会话追加场景快照，消息追加精确知识引用；旧数据保留。

知识管理位于 /knowledge/collections、/knowledge/documents，包含新草稿、明确发布和撤回；检索为 POST /knowledge/search。场景应用位于 /scene-apps，包含保存修订、query 预览和 resolve 能力检查。管理权限 knowledge.manage 仅授予管理员和内容编辑；内部阅读额外按真实角色过滤。写入检查 CSRF、幂等、对象范围与版本，幂等缓存仅存标识和版本。

本人恢复入口为 /guest/sessions/:id/memory/recovery、recovery/revoke 和 restore。凭证用服务端 HMAC 派生，数据库仅存哈希，成功恢复后一次性失效；同名、声纹和人脸不建立账户关联。访客写入在幂等命中前核对 focusVersion，防止旧对象响应重放。

009/010 追加 visual_grants、visual_requests、conversation_tool_requests；消息增加画面引用及工具建议投影。访客的 /vision/grants、/vision/revoke、/vision/questions 绑定会话与目标版本，使用单帧、八秒处理上限和异步结果再次校验；不持久化原始帧。/tools/confirm 只确认当前白名单内、未过期的人工接待建议，状态变化和审计同事务提交。

/scene-apps/:id/pipeline/check 为管理员/编辑的模拟诊断，使用固定合成输入检查独立 ASR/模型/TTS，不读取麦克风、不执行业务动作；异步后重查身份、配置及知识权限。接待人只读工具只返回当前工作空间有效公开名称。共享契约及实际导出的 OpenAPI 是已实现输入的依据，真实服务和后续业务工具仍按原模块接入，见 [T26 当前交付](17-knowledge-scenes.md)。

## T37 本批落地接口

迁移 011 新增 speaker_references、speaker_focus_sessions、speaker_segment_decisions、speaker_use_tickets、speaker_ptt_permits；reception_messages 追加 input_source 与 speaker_decision_id。memory_session_links 改为 session_id/focus_version 复合键，保留历史同人来源，不能跨人复用。

当前实际路由使用 /guest/sessions/:id/speaker-focus 下的开始、参考确认、重锁、释放、交接和回退操作；登记参考的撤回采用 POST /speaker-references/:id/delete，覆盖原接口草案的删除语义。管理员模拟路由检查 session.manage、工作空间与当前目标版本，并记录实际操作账号；真实 SDK 回调尚未开放。详细输入来自共享 Zod 与生成的 OpenAPI，见 [专项实现说明](10-speaker-focus.md)。

登记使用码的幂等缓存只存元数据，再核对本人、有效期及会话状态后派生明文；消费后立即清空哈希。普通访客响应不含提供商参考、target token、主人账号或未确认字幕。片段判定只持久化元数据，最终通过后才写正常对话，并由判定证明校验记忆来源。

## T27 本批展厅接口

新增 exhibition_halls、exhibits/exhibit_versions、tour_routes、tour_slots、tour_bookings、tour_sessions、tour_questions、exhibit_devices、exhibit_device_commands 与 exhibit_device_receipts。导览保存场景/路线快照、cursor、resume_cursor、focus_version、playback_epoch、access_version；问题和设备回执有各自状态，不靠前端临时变量恢复。

实际路由为 /exhibitions、/exhibits、/tour-routes、/tour-slots、/tour-bookings、/exhibit-devices、/exhibit-device-commands 和 /tours；路线预览为 /tour-routes/:id/plan，工作人员控制为 /tours/:id/control。独立终端 GET /guest/tours/:id，写入 control、questions 和 questions/cancel；客户端 audio 或归属声明不在文字契约中接受。

展馆/讲稿/路线/预约/导览管理使用 exhibit.manage，设备绑定与直接命令使用独立 device.control。匿名终端使用 dg_tour cookie 和独立 CSRF，不能复用为 dg_session。命令状态 pending/succeeded/failed/cancelled/unknown 与模拟回执分开，只有 worker 确认才改变已确认展屏；旧租约或旧播放代数会取消。

共享输入及 OpenAPI 位于 packages/contracts/src/exhibition.ts 与 docs/api/openapi.json；实际使用和本地限制见 [展厅实现说明](09-full-platform-scope.md)。这些落地路由实现前文 /tour-sessions 等草案语义，后续以共享契约为准。

## T10 当前媒体输出接口

迁移015新增studio_exports和studio_export_artifacts，保存输出类型、完整规格、来源计划哈希、范围、确认素材权限时间、状态、租约、尝试次数、进度，以及受控文件键、大小与SHA-256。输出与组织、空间、提供商环境及应用环境绑定，不以页面内状态代替持久化。

POST /studio/projects/:id/export-plan读取当前版本并核对规格；POST /studio/projects/:id/exports要求planHash、confirmed:true和rightsConfirmed:true，使用studio.write、CSRF及幂等。GET /studio/projects/:id/exports与GET /studio/exports/:id按当前权限投影文件，POST /studio/exports/:id/cancel取消未结束任务。GET /studio/exports/:id/files/:artifactId核对任务所属、来源和文件大小，支持单一字节Range与私有禁缓存下载；未登录或跨组织不能读取。

共享Zod输入和响应见packages/contracts/src/export.ts，实际生成规范见docs/api/openapi.json。kind=package现可审阅并生成完整开放工程ZIP、project JSON和素材清单；必须选择完整工程，不使用视频/音频区间。视频及工程包共用下列持久化传输接口。

## T10 当前分片视频接口

POST /studio/transfers要求workspaceId、kind=video、文件声明、分类、partHashes/可选sha256、来源用途说明和rightsConfirmed:true。POST /studio/transfers/:id/parts接收index、contentBase64和sha256，校验准确分片大小、编码和声明内容；相同分片不重复登记。POST子路由finalize与cancel检查当前version。所有写入要求asset.write、CSRF、幂等以及本人/空间/环境；任务GET和列表不向其他上传者开放。

完整分片进入queued→processing→ready/failed/cancelled，处理租约与尝试持久化。ready关联一个实际video/mp4资产和独立封面，不直接向客户端接受mediaType或检查结果。GET /assets/:id/poster读取实际PNG，GET /assets/:id/content支持PNG/WAV/MP4的鉴权单Range；GET /assets增加mediaType筛选，按源素材原有工作空间权限分页。

严格VideoSpecs记录显示与编码尺寸、时长、帧率、正交旋转、原声有无、采样率和声道。原声剪辑复用既有clip的sourceInMs、playbackRate、loop、volume和envelope，不另创建隐式人员或声纹引用。kind=package已经执行独立路径、总量、CRC、SHA-256和工程引用验证，接入方式见下节。

## T10 工程包实际接口

- POST /studio/projects/:id/export-plan：kind=package必须startMs=0、durationMs=null或完整工程时长；返回素材规格、预计大小、不可迁移项与canExport。
- POST /studio/projects/:id/exports：沿用版本、planHash及独立确认，排队后提供package（application/zip）、project（application/json）和manifest三份受控下载；旧工程或来源变化时下载失效。
- POST /studio/transfers：kind=package、.zip文件名、size最多1073741824；rightsConfirmed=true且acceptNonPortable=true，保存两类确认。包传输需要asset.write及studio.write，分片与完成/取消接口同视频。
- GET /studio/transfers及/:id：本人任务的kind、状态、进度、projectId、warnings与失败说明。ready后projectId可通过原工程接口读取；不会把已提交业务对象仅放在客户端内存。

清单为packages/contracts/src/export.ts中的portableProjectSchema。素材清单必须与全部文档引用及ZIP条目一一对应；不能借目标空间已有UUID补齐缺失文件。导入新的素材ID及工程对象ID，保留到期时间；不导入profileId、avatarCloneId、voiceCloneId、importMediaId或原文档source处理绑定。studio_package_imports的服务端映射与包SHA用于追溯，不作为声纹、身份或训练授权。ZIP及素材清单没有平台权属签名，不把用户提交的声明当作原作者或模型许可证明。

## T11 批次、评论与审核实际接口

| 接口 | 输入或结果要点 |
| --- | --- |
| POST /studio/batch-plan | workspaceId、name、templateId/templateVersion、data.format/content、kind、settings、maxInFlight、maxAttempts；返回确定性hash、逐项错误、大小及本地外部费用说明 |
| POST /studio/batches | 同计划及planHash、confirmed、rightsConfirmed；有错误行时另需acceptInvalidRows |
| GET /studio/batches 与 /:id | 范围内摘要、计数、进度、逐项工程/导出/错误/尝试历史，文件仍按T10当前来源校验 |
| POST /studio/batches/:id/control | 批次version及pause/resume/cancel；暂停后已有任务继续 |
| POST /studio/batches/:id/items/:itemId/retry | 条目version、新name/variables及rightsConfirmed；只接受失败项和剩余尝试次数 |
| POST /studio/batches/:id/items/:itemId/cancel | 条目version；不修改其他条目或既有完成文件 |
| GET/POST /studio/projects/:id/comments | 当前范围内版本定位评论；POST的version为目标工程版本，anchor含可选segmentId/clipId/timeMs，parentId须同工程同版本 |
| POST /studio/projects/:id/comments/:commentId/resolve | 评论自身version及resolved，不把评论版本与工程版本混用 |
| GET /studio/projects/:id/review-summary | 能力、可选独立审核者、当前可用成品、审核历史和有效approvedDeliveryIds |
| POST /studio/projects/:id/reviews | 工程version、stage=project或delivery、exportId、reviewerId、confirmed；成品须属于同一当前工程且已实际完成 |
| GET /studio/reviews 与 /:id | 组织/空间/环境范围，支持assigned=me/all、status=pending/all；返回历史status和当前effectiveStatus、失效原因及可执行动作 |
| POST /studio/reviews/:id/decision | 审核记录version、approve/request_changes、note及confirmed；退回必须有原因，仅指定且独立的审核人可处理 |
| POST /studio/reviews/:id/withdraw | 审核记录version，仅提交人或管理员撤回待审 |

所有写入先做当前权限和范围检查，执行幂等与审计；缓存只返回资源引用，再读取当前对象状态。评论正文、批量文案、凭据不进入普通审计日志。state/version转移在服务端及数据库事务执行；人脸或声纹匹配与这些账号权限无关。

Batch状态running/paused到completed或completed_with_errors，明确取消到cancelled；Item为queued/rendering/succeeded/failed/cancelled。成功状态记录历史生成结果，来源/版本变化后旧文件可不可下载由T10重新校验，不把历史成功当作当前有效成品。Review保留pending/approved/changes_requested/withdrawn，effectiveStatus可为stale；原决定不抹除。接口契约由packages/contracts/src/studio-team.ts与OpenAPI共同提供。

## T12 传播实际接口

以下路径前缀/api/v1。写操作使用当前登录、CSRF、工作空间、版本和幂等；publishing.publish只授予管理员，studio.write负责变体编辑和生成本地包，studio.approve负责指定审核。

| 方法/路径 | 实际用途 |
| --- | --- |
| GET /distribution/capabilities | 平台分类、人工包、模拟可用性和当前权限；真实自动能力均未配置 |
| POST /distribution/variant-projects | 版本确认后另建横/竖/方形可编辑工程，不改原稿 |
| GET/POST /distribution/variants | 分页读取/创建绑定实际成片和PNG封面的变体 |
| GET /distribution/variants/:id | 当前元数据、来源问题、当前文件、审核历史和可操作能力 |
| POST /distribution/variants/:id/update | 乐观版本保存元数据，保存完整历史并失效旧审批 |
| GET /distribution/variants/:id/versions | 历史标题/说明/标签/素材引用、操作者及时间 |
| POST /distribution/variants/:id/reviews | 提交当前来源和元数据快照给独立审核员 |
| POST /distribution/reviews/:id/decision | 指定审核者通过或填写原因退回，绑定审核记录版本 |
| GET/POST /distribution/accounts | 分页渠道配置/创建manual或mock账号 |
| POST /distribution/accounts/:id/update | 名称、启停与模拟场景更新，账号版本递增 |
| POST /distribution/publish-plan | 审阅变体、账号、排期和release快照，返回计划哈希 |
| GET/POST /distribution/jobs | 分页查询/明确确认计划后创建持久模拟排期 |
| GET /distribution/jobs/:id | 冻结提交快照、具体远端编号、当前状态和操作能力 |
| POST /distribution/jobs/:id/cancel | 仅取消尚未提交排期，不虚报远端撤回 |
| POST /distribution/jobs/:id/reconcile | 只查询同一请求，不能将未知当可重试失败 |
| GET/POST /distribution/jobs/:id/metrics | 已采集快照/明确收集一次模拟指标，写入幂等 |
| POST /distribution/jobs/:id/mock-receipt | 需发布权限的明确模拟回执，走同一签名和事件校验 |
| POST /webhooks/mock-publishing | 独立HMAC签名、时间窗口、远端匹配、事件去重与乱序保护 |
| GET/POST /distribution/variants/:id/packages | 最近20个包/为当前已批准release生成实际ZIP |
| GET /distribution/packages/:id | 包状态、哈希、大小及仍有效的下载地址 |
| GET /distribution/packages/:id/file | 再验证会话、来源、审批和ZIP字节后的私有下载，支持Range |

publishing_jobs为scheduled → submitting → submitted/published/failed/reconciling；scheduled可cancelled，执行前条件变化可stale，提交后未知仅核对。published需要对应远端作品编号。原发布元数据和账号名称冻结，后来编辑不覆写历史；作品/账号/审批版本不满足时旧排期不能擅自改用新内容。

本地限额：空间500变体/50渠道、组织当前环境50项待提交排期及一个在生成发布包；最多10标签/100字标题/3000字说明，属于本地接口约束，不宣称是各真实平台最新限制。真实渠道规格由T19逐平台验证。共享Zod及[OpenAPI](api/openapi.json)已覆盖当前输入和结果结构。
## T13 餐厅数据与接口补充

迁移020增加restaurants、restaurant_staff、restaurant_terminals、restaurant_tables、dining_parties、dining_reservations、dining_occupancies、dining_hold_plans、restaurant_menu_items/skus、restaurant_stock_adjustments、dining_preferences、dining_memory_imports、dining_recommendations、dining_obligations及dining_claim_limits。ReceptionSession增加服务场景和当前就餐引用，消息增加restaurantContext来源版本；不由客户端决定门店、租户或服务场景。

门店与菜单按version/menuVersion校验。Party使用waiting/reserved/held/seated/cancelled/completed/no_show；预约另有confirmed/checked_in/seated/expired等状态，已签到过期不自动变成no_show。占用状态held/seated/released/expired，数据库部分唯一索引限制每桌和每组至多一份有效占用。入座不按预计结束自动释放，结束必须检查义务后转清洁。

写接口位于POST /restaurant/restaurants/:id及下属tables、parties、reservations、table-plan、menu-items、staff、terminals，独立资源使用/restaurant/parties/:id、reservations/:id、table-holds、skus/:id等。读取有门店/桌位/菜单/队列、本人权限内详情、推荐及经理盘点历史；队列支持kind、cursor、limit。完整方法、输入、嵌套路径和返回DTO以[OpenAPI](api/openapi.json)为准。

顾客使用/guest/sessions/:id/dining及其parties/:partyId、reservations/:reservationId、table-holds/:holdId和recommendations/:recommendationId。每次写入要求当前受限Cookie、CSRF、幂等键和focusVersion，并在缓存前后核对记录归属。未完成就餐记录跨短时会话保留，凭私有就餐凭证移交；凭证轮换并清理旧偏好，不能恢复人员身份。失败恢复次数独立于失败业务事务保存。

本次偏好草稿与确认分开；目的导入保存来源事实及版本，源撤回、修改或到期后不可继续使用。推荐绑定菜单、Party和偏好版本，十五分钟有效；读取返回current/stale/expired及原因。T14必须在提交前调用当前推荐/菜单有效性检查，在数据库事务内复核价格、库存、桌位并登记dining_obligations，不能从旧聊天或旧候选直接下单。

本地餐厅业务请求的幂等缓存只存资源引用，重新检查当前身份及门店权限后序列化；问答请求也重新读取当前会话，避免恢复旧ready回复。价格、库存、偏好与来源失效会取消相关播报并更新replyEpoch，旧播放确认被拒绝。普通日志不保存就餐凭证、原始声纹或旁人转写。使用说明见[餐厅说明](18-restaurant.md)。

## T15 账单、资金事实与餐后服务补充

迁移022新增restaurant_payment_configs、restaurant_bills、restaurant_financial_quotes/operations/postings/receipts/events、mock_financial_operations、dining_service_requests/events、dining_farewells/feedback/followup_consents。原订单唯一约束调整为每次就餐至多一份未结活跃订单，允许已付款订单继续履行。金额均为CNY整数分，以已接单数量与原价计算；退款账目不改写原收款。

财务操作状态为queued/submitting/pending/unknown/needs_attention/succeeded/failed/expired/cancelled/stale。queued至unknown的支付有账单级部分唯一索引；needs_attention独立保存可信回执应用失败，继续保留财务义务、改单限制与退款预占，不能通过关闭清除。未知不自动重发；已核实失败/关闭不被pending回执重新打开，迟到成功仍登记事实。接收回执先持久化，savepoint只回滚局部入账。支付、订单制作及就餐占用三个状态分别维护，不以付款替代上齐或清洁。

店员接口包括GET /restaurant/parties/:partyId/billing、POST /restaurant/orders/:orderId/billing/review、POST /restaurant/billing/confirm、GET /restaurant/bills/:billId及receipt、POST /restaurant/financial-operations/:operationId/actions。退款审阅、支付配置和显式模拟结果需本店经理；公开/webhooks/mock-payments要求HMAC和五分钟时窗，绑定原请求/商户/币种/金额/远端编号并去重。外部真实配置未接入会明确拒绝，不能返回模拟成功。

服务请求包括加水、餐巾纸、店员帮助、菜品进度与结账协助，状态requested→acknowledged→resolved，或cancelled；顾客不能代替店员接收/完成。对应parties/:partyId/services、services/:requestId/actions和restaurants/:id/services。送别/评价/回访通过parties/:partyId/aftercare及feedback/followup/revoke子路径处理。顾客资源均在/guest/sessions/:id/dining下，写入必须核对当前focusVersion；归属或权限失效先于旧幂等引用缓存。

回访联系方式密文只在服务端使用，DTO和缓存不含原始内容；目的、保留期、授权、撤回及到期分别记录。数字人restaurant.service_request只提交待本人确认建议；已付款口头声明只触发只读账单核对，不能生成资金事实。完整参数与返回结构见[共享OpenAPI](api/openapi.json)，使用、检查及模拟边界见[账单与餐后服务](20-billing-service.md)。

## T22 语气、语言与字幕补充

迁移023增加独立语气配置/历史、发音术语库/历史、源目标语言关联、字幕/不可覆写修订和本地系统配音任务。voice_style用途只对WAV授权，不能复用声音训练授权；授权缓存只存引用并重新检查当前撤回状态和成员范围。

新增/studio/voice下的styles、dictionaries、compile及capabilities，工程下的languages、subtitles及speech-jobs；单项字幕提供save、apply、versions、srt/vtt，配音任务提供control、apply及受保护的分镜audio。规范语言代码不代表已安装相应系统声音；外部语音未接通不能退回模拟成功。完整请求与响应由共享Zod生成[OpenAPI](api/openapi.json)。

配音输入固定工程/配置/词典版本、字节哈希和原作者范围，状态queued→rendering→succeeded/failed/cancelled/stale；30秒持久租约与最多两次本地尝试。应用生成合成音频资产和可编辑轨，记录应用版本；源变化后旧请求/下载重新受限。字幕记录estimated/mixed/manual时间来源，只有明确逐条确认才标manual；文字修改不冒充时间对齐。人工语言版本保留源快照且互不覆写。具体操作和真实能力边界见[语气与多语言](21-voice-localization.md)。

## T23 形象、变体、动作及任务补充

迁移024新增studio_characters/versions、character_motion_plans/versions、character_jobs和character_derivations。形象绑定原素材版本、SHA和独立character_use用途；变体固定父关系且要求实际不同来源，禁止循环及跨空间引用。派生关系保存形象、授权和可选声音依赖，普通AssetDTO可显示unavailableReason，业务读取继续由服务端拒绝。

接口前缀/api/v1。/studio/characters提供分页、capabilities、factory及models；单项提供update、archive、versions、preview、jobs、quality、prepare、render。工程下character-plans建立计划，/studio/character-plans/:id提供save及versions。/studio/character-jobs/:id提供control、apply及私有file。字段和返回约束见[共享OpenAPI](api/openapi.json)，使用见[形象与动作](22-character-motion.md)。

任务区分quality/reference/motion/mock_training，固定来源与原作者，输入哈希包含操作类型；活动任务唯一，状态queued/rendering/succeeded/awaiting_review/accepted/rejected/failed/unknown/cancelled/stale。未知仅查询原请求，最多三次有界尝试；接受模拟训练仍simulated=true及readyForRealService=false，无模型文件。实际视频输出关联海报及video_sources，可应用到形象与独立narration配音轨；trimLongVoice必须显式确认。缓存仅存引用，当前权限/来源在缓存前、异步提交和最终响应前重查。

## T24 内容来源和定位补充（进行中）

迁移025新增studio_content_sources/source_versions和studio_content_briefs/brief_versions。正文、段落、两份SHA、捕获方式、授权主体/依据/期限及撤回事实独立保存；视频只绑定已就绪原片及人工转写来源。账号定位配置和修订保存受众、内容目标、渠道、表达及选题，版本冲突不覆写。

/studio/content提供capabilities、sources和briefs分页/创建；单项sources提供versions及withdraw，单项briefs提供versions及save。完整请求/响应来自[共享OpenAPI](api/openapi.json)。来源失效时text为null、paragraphs为空并提供原因，历史不返回受限正文；缓存只存资源引用并重新检查当前状态。录制接口见下文，媒体加工继续建设，T24整体仍in_progress，详见[内容制作工具](23-content-workbench.md)。

## T24 草稿、审阅计划及来源依赖补充

026增加studio_content_drafts/draft_versions、studio_content_plans/plan_versions、studio_content_origins及studio_content_asset_origins。草稿记录父/根关系、来源版本/正文SHA、定位快照、提供方式、段落及原工程版本；计划状态review→applied/cancelled，固定草稿与可选目标工程哈希。版本冲突不产生第二次应用，保存审阅只能修改预定段落的新文字。

/studio/content/drafts提供分页/创建，单项提供save/fork/restore/versions/plans；POST /studio/projects/:id/content-draft复制明确选择的工程分镜。/studio/content/plans/:id提供GET、save/apply/cancel/versions，apply必须传当前版本、planHash及明确确认。完整字段由共享Zod生成OpenAPI。权限及来源在缓存前、异步后、事务写入和最终投影时重新核对；来源失效后的草稿payload及计划patches为null并给出原因。

工程分镜可选contentOriginId/contentExpiresAt，普通保存不能篡改；既有无来源工程不新增默认字段，保留旧指纹。配音应用资产关联content_origin并继承期限，原作者、来源和依赖验证覆盖直接资产、原配音、成片及工程包。portableProject不携带服务端来源编号，记录content_origin为不可迁移项、保留期限并要求导入时独立确认。确认后的工程历史不因来源撤回而删除。

## T24 录制方案、文件与工程应用

027新增studio_recordings、studio_recording_versions、studio_recording_outputs及studio_recording_applications。方案固定本人/组织/空间/环境、配置、提词快照、来源SHA及期限；绑定原片后不能修改配置，版本修订不可覆写。应用以规范请求摘要、本人和录制编号唯一去重；原片、规范MP4的哈希/大小、实际解码规格和可选本机计时分别存储，计时不授予权限。

/studio/recordings提供本人分页/创建/capabilities；/:id提供GET/save/upload/withdraw/apply/versions/source。upload绑定WebM/MP4及分片SHA，recordedDurationMs可空，只在无声且未声明时长时用于保持末帧；不会截断已解码内容。后续/studio/transfers/:id/parts/finalize/cancel沿用持久状态，传输kind增加recording，但普通创建传输请求不能自行指定recording绕过方案。worker提交时重新验证原作者、源和租约，原片/规范资产同事务关联后才ready。

录制source为私有二进制且支持Range；用途中止、过期或提词来源失效后，snapshot及历史正文为null、rawUrl为null，直接原片/资产/封面/成片和旧应用缓存拒绝。已经确认的工程保留并显示来源问题。完整共享输入/响应见[OpenAPI](api/openapi.json)，实际边界见[内容制作工具](23-content-workbench.md)。

## T24 文件转写、校对修订及来源依赖

029增加studio_transcriptions、studio_transcription_revisions与studio_transcription_sources。任务绑定本人/组织/空间/环境、不可变原视频版本/SHA/规格及用途/最短期限，原生识别结果独立保存并校验摘要；校对稿保存有序不重叠的原视频时间和不可覆写修订。确认关系固定修订/摘要/确认摘要，唯一键为转写编号与校对版本，避免双API重复登记。

`/studio/transcriptions`提供本人分页/创建，`/capabilities`读取实际Windows离线识别器；`/:id`提供GET及review/control/withdraw/confirm，`/:id/revisions`、`/:id/audio`及`/:id/export`提供历史、私有原声和JSON/SRT/VTT。创建/校对/控制需当前写权限；原声异步读取前后重新验证身份、工作空间、源和文件摘要。外部ASR未配置直接拒绝，模拟无真实来源，文件ASR不与接待实时说话人通路共用权限。

已登记来源通过video原片及reviewed_video_asr来源关系双重校验，缺失确认关系、修订或原稿摘要不符时拒绝正文。新校对不改旧来源；转写撤回使原声、历史文件、来源/草稿及后续配音/资产/成片/ZIP受限，原视频和确认工程历史保留。列表不带转写正文，缓存命中仍复核当前权限及来源。字段及错误格式见[共享OpenAPI](api/openapi.json)，使用/真实边界见[内容制作工具](23-content-workbench.md)。

## T25 逐帧批注与外部审阅

030新增studio_frame_reviews、studio_frame_review_links、studio_frame_review_sessions、studio_frame_comments、studio_frame_feedback及studio_frame_requests。分别保存固定工程/成片/来源快照与副本任务、邀请、受限会话、帧位置讨论、本人反馈和请求摘要。成片副本media保存完整帧数、帧率、原工程起点、预览/原片规格与实际SHA，单独保存元数据摘要。帧号从0开始，坐标归一化。

内部使用/studio/frame-reviews及/:id的control、video、report、comments/resolve、feedback、links/revoke。公开路由仅限/external/frame-reviews/:id的join/context/video/comments/resolve/feedback/leave；它们使用独立且限定路径的HttpOnly Cookie，不采用成员身份。创建邀请需明确范围/期限，成员和公共幂等缓存不保存原始邀请凭证；请求摘要不能作为授权。

公共响应只投影所选副本、对外讨论及本人的反馈。Origin/CSRF、本人批注、乐观锁及组织/空间/环境由后端执行；外部反馈不写studio_reviews。成员权限和工程版本/归档触发器永久撤回旧邀请，恢复不复活。副本下载异步SHA前后重检身份和来源；来源失效时内部正文/报告也受限，旧版有效来源的内部讨论可保留。具体契约见[OpenAPI](api/openapi.json)，范围、实际媒体、运行和限制见[媒体协作](24-media-collaboration.md)。

## T25 素材分类与独立文件版本

R-084使用asset_library_folders/families/revisions/events及consent_revocations。分类版本与assets.version分开；每个文件版本保留原asset_id/upload_id和SHA，不把已有工程指针换成组的latest。既有/新资产自动索引，原独立组被加入另一组后保留merged_into记录。

成员路由为/asset-library/folders、/:id/save/archive及/asset-library/families、/:id/save/versions/recycle-plan/recycle/events；按工作空间和当前权限校验。分类共享范围沿用基础素材库，实际文件继续执行原有来源/环境约束。检索支持folderId、tag、search、kind、category、state及游标；事件按sequence分页。

回收/恢复请求必须指定文件ID数组、组版本、当前planHash并明确确认，事务中重新计算影响。永久撤回原用途授权，恢复不复活；原PATCH资产接口同步遵守。写入幂等缓存只记录结果ID，每次重新读取当前身份和状态。GET /asset-library/families/:id/files/:assetId读取原件，实际摘要校验后重检身份/来源，支持私有Range，不向普通审计写入内容或凭证。[共享契约](api/openapi.json)与[使用及边界](25-asset-library.md)保持一致；受限文件收集见下一节。

## T25 受限文件收集、检查与验收

032新增asset_collections、asset_collection_links、asset_collection_sessions、asset_collection_receipts、asset_collection_parts、asset_collection_requests、asset_collection_origins。收集固定组织/空间/environment/app_env、格式/容量/截止与建议文件夹；回执固定提供声明/期限/合成标记、clientFileId、整件/分片摘要与实际检查结果。requests按scope_group限制一次会话所有动作的写入预算，幂等只保存结果ID/请求摘要，回放重新投影当前状态。

成员接口/asset-collections提供列表/创建及/:id详情、close、links/revoke、receipts；/:id/receipts/:receiptId提供accept/reject/cancel/retry/revoke-use以及files/:kind（original/poster/preview）。公开接口仅/external/file-collections/:id的join/context/receipts/leave及receipts/:receiptId的parts/submit/cancel/retry。全部路径以/api/v1为前缀；公开会话不能读取后台媒体或成员身份，提供者名称仅自报。共享OpenAPI新增collectionSession Cookie安全方案，与成员/审片凭证相互独立。

状态uploading → queued → validating → review → accepted，另有failed/rejected/cancelled/expired。收集/邀请/会话关闭禁止继续未提交上传，已提交任务由团队按保管/用途期继续处理；入库后使用独立来源许可。accept要求当前回执版本、确认的独立用途/期限、类型/分类与检查结果，同键或异键竞争都不能重复建立素材。不创建训练授权；永久撤回使用后禁止原件/预览及既有派生成片的新下载，确认工程文档保留。

下载支持私有Range/no-store并在实际SHA后复核来源、身份、版本和环境；异步任务禁止迟到提交。公开响应隐藏内部assetId、所有媒体URL、团队用途正文及提供者名称；上传原始凭证不入普通日志或证据。当前六种格式、配额/时限、实际检查与生产限制见[文件收集说明](26-file-collections.md)及[共享契约](api/openapi.json)。

## T25 PPT逐页方案与讲解场次

033新增studio_presentation_plans、studio_presentation_plan_versions、studio_presentation_applications、studio_presentation_sessions、studio_presentation_questions。方案保存固定原工程/版本/source_hash、定义及摘要；修订不可覆写，同一方案版本唯一采用到一个独立工程。定义含页序/讲稿/时长/角色/位置、独立WAV、字幕和重点时点、过渡；普通采用不移除原导入或内容授权关系。

成员接口/api/v1/studio/presentations下的/plans提供分页/创建，/:id提供读取、save、versions、apply；/sessions提供分页/创建，/:id提供读取、control、questions、answer和video。所有接口要求当前成员及工作空间/环境；只有本场主持或空间管理员可控制/答复，其他编辑不自动接管。持久幂等只记录结果ID，缓存命中仍检查当前角色/来源，不保存问答正文到普通审计日志。

场次ready/playing/paused/question/ended，position_ms与anchor_at确定服务端位置，chapters/captions固定实际时间线，export_id/artifact_id及摘要绑定完整已完成MP4。控制要求version/observedPageId，跳转另带目标pageId/offsetMs；提问保存page_id/position_ms、原resume_state/resume_position_ms。answer要求当前问题ID/问题版本/场次版本，continue需同一已答问题；明确结束不能复活。下载重新计算实际SHA并在异步后复核当前身份/来源/元数据，提供私有Range。

响应声明answerMode=human_text、realTimeAvatarAvailable=false。来源不可用时mediaUrl为空、字幕与问答正文隐藏；确认工程和历史事实保留。前端草稿冲突不覆盖输入；当前能力及真实自动问答/声纹/驱动边界见[逐页讲解](27-presentations.md)，字段和错误见[共享OpenAPI](api/openapi.json)。

## 互动课程实际接口（迁移034）

`/courses` 草稿/版本/发布计划和固定release，`/courses/releases/:id/enrollments` 安排与教师成绩报告，`/learning-enrollments` 当前成员自己的安排，`/learning-attempts/:id/events` 版本/观察节点与视频epoch保护的学习事件，`/courses/releases/:id/exports` 持久SCORM打包与私有Range下载。完整字段与路由见[课程说明](28-courses-learning.md)及共享Zod/OpenAPI。

成员离开空间/组织永久撤销原安排，恢复成员不复活旧尝试；原发布人离开不自动删除机构发布的课程。源资产/工程失效时阻断后续学习正文与媒体，但保留已确认的成绩事实。普通日志/审计只记操作与资源编号，作答正文留在专门业务表。没有将课程身份或成绩用于接待权限、人脸/声纹登记或支付授权。

## 参数化模板实际接口（迁移035）

模板增加可选`controls`，单工程创建增加`parameters`/`templatePlanHash`，批量输入/计划/条目/重试增加可选类型化参数。新增引擎能力、工程槽位、模板采用计划、模板历史/恢复与工程来源接口；完整字段由共享Zod/OpenAPI生成，见[参数化模板说明](29-parameterized-templates.md)。旧响应在没有高级参数时省略新增字段；旧行原始列保留。

计划绑定固定模板版本、参数、实际素材及来源哈希；创建前和幂等回放前重新检查。批次存固定模板快照，派发时重新构建并比较文档；素材到期或越权会失败。工程来源单独持久化组织/空间/环境、固定定义、参数与文档哈希；读权限不会因此授予模板编辑权。恢复明确确认为新修订，保留旧工程和批次。

## 受控AE实际接口（迁移036）

T24神经降噪复用`/studio/media-processing`现有接口，新增独立`neural_denoise`配置与可选固定引擎类型，能力响应可选`denoising`。没有新增SQL或给旧JSON补默认字段；当前权限/来源/模型/时序及控制、工程派生约束见[神经降噪说明](51-neural-denoising.md)。

048追加独立[源工程导出接口与状态](50-ae-source-exports.md)：`ae_source_exports`、`ae_source_attempts`固定历史登记及原件清单；`/studio/ae-source-permission`、模板`source-capability`及`/studio/ae-source-exports`计划、幂等排队、控制/撤回和私有ZIP下载。源权限/许可独立于制作，缓存只保存资源ID，异步校验后重新鉴权与检查当前授权。原036批次结构不追加默认字段；源包不包含服务器配置或赋予目标空间权限。

`/studio/ae-catalog`只列管理员授权给本组织/空间/环境的目录，不返回机器路径或命令；`/studio/ae-templates`登记固定工程和修订；`/studio/ae-batch-plan`校验类型参数、素材、包/引擎指纹及执行模式；`/studio/ae-batches`保存持久条目与尝试，支持CAS取消和失败修正。`/studio/ae-artifacts/:id/file`重新鉴权和核对实际字节后提供私有Range。字段由共享Zod/OpenAPI生成，详见[受控AE说明](30-ae-templates.md)。

创建必须提供expectedMode和一致计划哈希。契约模式始终simulated，不能进入production/live；没有静默改引擎或原生替代。批次来源和历史修订有SQL不可覆写保护。失败项重试记录本次授权执行者，原批次创建者不变；完成文件的有效授权读取不依赖旧引擎仍安装，素材/目录权限撤回仍会阻断。

## 互动分享接口（迁移037）

`/shares`管理当前空间的草稿、CAS保存、版本与发布计划；`/shares/:id/publish`由发布人确认计划和实际文件后创建固定版。`/share-releases/:id`提供状态、撤回、链接和限定聚合；`/share-links/:id/access|rotate|revoke`要求当前发布权限。成员幂等只保存引用，重放也重新鉴权。

`/external/shares/:id/player`及独立player.js提供播放器；join以完整链接交换本链接观看Cookie，context只返回固定公开内容和本人状态，consent/forget以本人CSRF和CAS控制保存及删除，events验证可见时间/组件/选项并幂等。video/captions/poster在观看权限与实际字节检查后读取固定文件；视频支持单段Range。观看身份不能替代企业会话，不得将未同意的数据纳入统计。字段、状态与错误由共享Zod和生成OpenAPI记录，详见[实际边界](31-interactive-sharing.md)。

## 内容审核与来源接口（迁移038）

六表保存规则、历史、固定制作、产物、独立审核和公开回执。`/content-governance/policies`及`/:id/save|versions`需管理员能力；`/plan|deliveries`需当前创作权限，固定规则/源哈希而非由客户端提供批准。制作状态为queued/rendering/ready/failed/cancelled/withdrawn，最多三次尝试；`cancel|retry|withdraw`检查版本及当前来源。每组织/环境最多三项活动制作，每传播版本最多100份记录，每记录最多100次审核。

`/deliveries/:id/reviews`指定独立审核员，`/review-inbox`和`/reviews/:id/decision`处理当前本人审核及逐条提示确认；制作、提交或审核成员失权使原审核失效。实际`video|cover`按当前权限及SHA读取；`receipt|verify-receipt`分别返回公开字段和当前文件/来源/签名核对。`/external/shares/:id/provenance`受本次观看权限限制，不能读取内部事实。所有写入遵循既有来源/CSRF、CAS及适用幂等，字段由Zod/OpenAPI生成。[具体状态与边界](32-content-governance.md)。

## 直播本地控制接口（迁移039）

十一表保存节目/历史、固定场次、目标、片段、命令、合成事件、成员观察、归档、资产来源及拆条。场次状态ready/scheduled/preview/live/ended/failed，其中live是明确标注的模拟播出。时钟与控制版本分离，代次在换段/问答/接管/控制时校验；目标状态、尝试及操作编号独立，不因未知自动重发。

`/live-programs`及`/:id/save|versions|preflight`管理与核对节目；`/live-sessions`及`/:id/preflight|start|control|stop`管理固定场次，列表只返回摘要；`/live-destinations/:id/control`处理本目标。`/live-sessions/:id/audience-events`与`/audience-questions/:id/moderate|answer|play`只接收认证场控的合成事件；每问题最多固定一份准备好的回复，旧幂等重放重新投影来源。知识收紧后不返回旧正文或引用。

`/live-sessions/:id/observations`仅保存本人当前代次观察；`/cues/:cueId/media`和`/live-recordings/:id/file`异步核对实际SHA后重检当前身份与范围，支持私有Range。归档control提供三次内重试、取消和撤回，create-clips返回实际多轨工程编号；撤回也影响普通资产读取和已有派生工程。没有开放真实推流/评论Webhook或匿名后台权限。[操作、限额与错误边界](33-live-control.md)。

## T28连续媒体实现（040）

独立live_outputs及媒体代次、完整片段、帧区间、画面配置历史、录制关联和终端观察落库。原节目快照不增加隐式默认字段，旧场次继续保留原摘要。场控命令增加独立media_applied_at/media_frame；录制capture_kind区分local_timeline_reconstruction与local_continuous_output。

新增/live-outputs/preflight、/live-outputs、/live-sessions/:id/output，以及媒体任务的presentation/control/context/parts/:partId/observations接口；共享契约与OpenAPI同步，具体状态和权限见[连续媒体](34-live-continuous-output.md)。来源、租户、环境、租约、版本、代次及异步文件检查后的再鉴权均由服务端执行，终端自报的播放观察不能用作远端平台回执或身份授权。

## 广告实体与当前接口（T29 / 041）

041新增20张广告/模拟渠道表，包含独立附加授权、账户/预算策略与历史、计划/版本/审批、执行/原操作、预算占用、模拟远端/消费/延迟报告、回执/追加账本/指标/提醒/固定对账与修正说明。受众仅为上下文条件，不接入接待人物档案。当前路径、币种最小单位、三个版本来源、签名回执与分页CSV见[广告专项数据/API](35-advertising.md)及[共享OpenAPI](api/openapi.json)。审批流程为提交reviews并对campaign-reviews指定ID决定，通用设计中的approve简写不代表另一个绕过审批接口。

## 聊天式局部编辑接口（T24 / 042）

四张042的studio_assistant表保存固定对话/原工程来源、多轮追加候选、固定生成计划与阶段/子任务、不可覆写应用事实。接口为/studio/assistant下capabilities、sessions、turns、generation-plan、generations、apply/close、cancel及受控audio/artifacts。共享Zod/OpenAPI规定确切字段和私有Range；[专项说明](36-studio-assistant.md)记录状态、限额与错误。sessionVersion、turnHash、generationVersion、sourceHash和branchVersion分别保护原工程、当前建议、实际产物和工作副本，任一过期不能由旧幂等响应绕过。042保持冻结；当前新增043解释队列，见下文，后续从044新增。

## 前景模型能力与固定快照（T24 / R-076）

沿用/studio/media-processing接口和原表。capabilities增加segmentation的available/reason、模型/运行时摘要及执行说明，本机完整时localOperations含segmentation。方案payload及任务详情可选engine由服务端生成，固定modelId、modelSha256、runtime、runtimeVersion、runtimeSha256和preprocessing；客户端额外传入engine按严格契约拒绝。旧JSON没有追加默认值，历史哈希不变，不需要043迁移。模型未安装/损坏或运行时不一致时明确拒绝，模型相关检查不替代当前用户、来源及用途检查；已完成输出的读取保持原撤回约束。具体处理、限制和证据见[模型说明](37-neural-segmentation.md)。

## 主体跟踪与检查帧（T24 / R-078）

subject_tracking的本机模式要求tracking构图/起始点配置，engine另固定trackingPolicy。capabilities.subjectTracking报告实际就绪与引擎；任务可选trackingSource和report.tracking只在当前授权来源可用时返回，撤回后与旧正文共同隐藏。旧字段不加隐式默认值，无SQL迁移。新增/assets/:id/inspection-frame查询frame/sourceVersion/sourceSHA256，实际取帧、前后鉴权/原片校验、有界解码、no-store及临时文件清理；不改变原透明/frame读取语义。确切字段见[OpenAPI](api/openapi.json)，使用、对齐和质量边界见[主体跟随](38-subject-tracking.md)。

## 主题语义候选与实际分段（T24 / R-079）

capabilities.semanticClips提供本机真实就绪与固定指纹；GET /studio/media-processing/semantic-sources按workspaceId/assetId列出当前原片版本仍有效的已确认短语稿。semantic_split本机配置选择semantic.contentSourceId和时长/数量，instruction为主题；semanticSource与engine由服务端生成，不接受客户端自带快照。完成报告的semantic包含完整原话、短语时间、候选编号及相对相似度，任务semanticVideo仅在来源仍有效时返回。POST /studio/media-processing/jobs/:id/semantic-selections按版本、候选编号与明确确认建立split方案，服务端保存semanticBasis；重复采用、后续编辑和工程复用仍保留父任务与校对稿限制。旧JSON兼容，无新增表或迁移。[详细协议与边界](39-semantic-clips.md)，精确字段由共享Zod生成的[OpenAPI](api/openapi.json)维护。

## 神经修复配置与原件（T24 / R-080）

capabilities.restoration提供真实就绪、固定引擎、缺失原因与说明；restore本机配置要求restoration.scale=1/2/4，strength控制模型融合，禁止文字指令。服务端engine增加sourceCheckpointSha256、nativeScale、tileSize和tilePadding，完整摘要/策略在方案与任务固定；客户端注入引擎拒绝。当前有效任务可返回restorationSource，撤回后与报告/引擎/文件链接共同隐藏。原表、接口与JSON兼容，无新迁移；工程包支持有界已入库大PNG，常规上传上限保持。精确字段见[OpenAPI](api/openapi.json)，使用、质量及限额见[神经修复](40-neural-restoration.md)。

## 本机真实语义解释队列（T24 / R-127）

043保存studio_assistant_interpretations：固定会话版本/父候选、所选输入、上下文/引擎/输入摘要，持久状态/控制版本/尝试/租约和实际模型回执。capabilities可选localModel报告实际固定引擎与失败原因，providers新增local_llm；semanticModelVerified仍为false表示通用质量未验收，不否认本机实际执行。旧同步turns遇local_llm返回需要队列的422，不回退其他编辑方式。

GET/POST /studio/assistant/sessions/:id/interpretations分别分页历史与建立任务，历史页另外返回当前active任务。POST固定version、parentTurnId、instruction、confirmed，不接收客户端引擎/模型输出。GET /studio/assistant/interpretations/:id读取原任务，POST其/control接收version和cancel/retry。所有写入沿用当前鉴权、工作区/环境、CSRF和幂等；同键只保存引用，重放重新核对当前权限/来源，不能回放已失效正文。候选可选modelEvidence记录实际输入/提示/输出摘要、模型/运行时/策略身份、token数和编译入口；旧JSON不补默认字段，历史摘要不变。来源失效时instruction、engine、evidence为null，候选/媒体继续受既有撤回限制。确切Zod/OpenAPI和[限额/恢复/许可说明](41-local-semantic-editor.md)共同约束实现；043已在主库应用后冻结，下一迁移044。

## 眼部纠偏契约与透明MOV入库

T24/R-076接入固定MediaPipe FaceLandmarker v1/Tasks1.2.3、Playwright1.65.1和现有Chrome的实际CPU478点检测，受控离线上下文和眼眶内有界几何处理；不是神经视线生成或真实注视方向。严格gaze设置/engine和全部帧记录进入现有方案/持久任务JSON，旧JSON不加默认字段、无SQL迁移，043冻结/下一044。来源版本/哈希/用途、当前权限、租约、取消、撤回及单次工程应用由服务端校验。PNG和有声/透明视频经实际处理，前后眼部按准确帧号/固定版本及摘要取帧并核对解码，失败有重试；正常视频入口同时支持128MiB内ProRes 4444 MOV、完整解码和私有代理。大报告等待IPC发送完成后辅助进程才断开，实际编译240帧强杀/原租约恢复已验证。详情、许可、设备/遥测阻断与真实边界见[实现说明](42-gaze-geometry.md)，完整T24/G1/G2继续。


## 045 直播系统播音实体与接口

新增live_speech_plans、live_speech_jobs、live_speech_playbacks，分别保存固定计划、持久合成任务和语音/原节目断点。liveOutputSettings可选speechPlanId，liveRecordingGuard可选speech来源；均无默认注入。计划/任务控制、当前版本/代次明确播出、私有WAV及来源撤回保护见[接口与状态说明](44-live-system-speech.md)及[共享OpenAPI](api/openapi.json)。045已冻结，后续046。


## 046 直播模型配置、任务与采用来源

新增live_answer_configurations、live_answer_jobs、live_answer_origins；不可变输入/结果、配置代次、场控版本、取消控制版本与租约分开保存。七个模型能力、场次设置/候选、任务控制/采用接口见[专项文档](45-live-local-answers.md)与[OpenAPI](api/openapi.json)。LiveQuestion仅增加显式local_model来源值，旧LiveSession不注入配置，录制answers来源可选且无默认。046已应用冻结，后续047。

## 原创二维直播的可选来源

原连续媒体预检/建立接口允许严格可选settings.puppet：characterId、characterVersion、placement。必须同时选择有效且已完成的真实播音方案。服务端固定配置、原件版本/摘要/尺寸和独立character_use授权；媒体视图可选puppet绑定及puppet2d_audio模式，录制来源guard继承同一绑定。原件字节、租户/空间/环境、当前版本、用途及到期由服务端及worker校验，角色撤回限制HLS/录制/资产/实际派生，独立WAV用途不受错误牵连。没有新增路由、表或SQL，旧JSON不补默认字段。详细边界见[二维直播](46-live-puppet.md)，精确字段见[OpenAPI](api/openapi.json)。

## 047资料脚本任务及采用

studio_content_writing_jobs固定来源/定位/模型输入、共享CPU任务状态和不可覆写结果；studio_content_writing_adoptions按任务/候选保存唯一草稿及采用人。/studio/content/writing下能力、分页任务、单项、控制与采用六项接口由[OpenAPI](api/openapi.json)维护，详情见[专项说明](47-source-script-generation.md)。源正文受限时任务正文/候选/引用/回执隐藏；定位新版保留旧候选供对照但禁止采用。草稿provider新增local-model及可选modelOrigin，客户端旧创建/保存接口不能注入模型来源；此标记追溯最初起稿，人工修订另有版本。旧内容能力布尔值反映实际本机模型就绪，外部提供商状态保持独立。047已冻结，后续048。

逐段核对回执与一次片段补丁保存在原任务JSON中，无新表或SQL。模型supported/unsupported/uncertain意见与guardFindings分别记录；outcome为model-supported或needs-human-review。后者采用时需acknowledgeUnresolvedReview:true及当前reviewSHA256，服务端记录actorId/at/reviewSHA256，原分歧不变。缺失或过期回执返回CONTENT_WRITING_REVIEW_ACK；无法通过固定来源/规则/版本检查的任务不能借此确认采用。unresolvedReviewHash与modelOrigin中的核对字段均可选，旧JSON不注入默认值。

新source-script-reviewed-v3固定paragraph-support-v2/explicit-constraints-v2，规则额外区分availability-calendar、availability-exception和availability-hours。v2保留原paragraph-support-v1/explicit-constraints-v1。所有生成、核对、修订提示摘要和规则重算按任务固定版本执行，不能将旧回执更换引擎身份后采用。[开放安排与限额边界](49-opening-calendar-review.md)及[OpenAPI](api/openapi.json)维护确切字段。


## 049 AE成片采用

ae_media_adoptions与ae_media_attempts保存固定产物、清单/参数/替换素材来源及独立用途、控制代次、阶段/进度、原30秒租约、三次尝试和唯一素材/工程。固定输入、已保存结果和永久撤回由SQL约束。/studio/ae-artifacts/:id/media-plan|media-adoptions|media-adoption与/studio/ae-media-adoptions/:id及cancel|retry|withdraw均按当前身份/环境/空间校验，输入/输出见[专项](52-ae-media-adoption.md)及生成OpenAPI。直接采用资产的治理私有事实可包含advancedTemplateSources，旧事实不增加默认字段，公开回执结构不变。049冻结，后续050。


## 050主动授权的连麦邀请与临时信令

六表live_peer_invites/guests/consents/attempts/signals/limits固定邀请、每次设备用途和同意版本、双设备连接及短期信令。来宾Cookie独立HttpOnly/SameSite=Strict/邀请路径，写入另验CSRF，不授予组织身份。主持/live-peer-invites与/live-peer-attempts、来宾/external/live-peers/:id下领取/授权/撤回及具体attempt信令均由[OpenAPI](api/openapi.json)维护。控制CAS、顺序与幂等重放后仍验证当前来源；整个用途撤回允许早期界面版本，不能借此放宽接通或信令版本。成员变化/节目停止/源撤回永久关闭邀请，清除昵称/访问凭证/设备标志/临时SDP和ICE，保留结束和授权审计，不存来宾音视频或转写。详见[操作及边界](53-local-webrtc-calls.md)，050冻结/后续051。


## 051节目用途、媒体连接和控制

新增live_guest_programme_grants/connections/controls三表，分别固定独立同意及录制到期、设备/运行令牌/编码代次和不可变控制输入及编码确认。组织/live-guest-programme-grants和来宾/external/live-peers/:id/programme-grants、独立/external/live-programme/:id的管理/连接/应答/心跳/结束/撤回详见[OpenAPI](api/openapi.json)。独立路径Cookie/CSRF在正常通话结束后仍可管理；用途≤原邀请/24小时。帧/录制/资产/实际拆条渲染继承同意摘要及来源，过期/撤回阻止历史读取；节目可继续剩余来宾，但尚不自动清理混合录制。[实现及局限](54-live-guest-programme.md)。051冻结，后续052。


## PPT组合答疑可选字段

复用044的配置/问题/任务JSON，无新接口或SQL。result.composition存schemaVersion2、coverage及1—6个原话UTF16区间/状态/正文/引用；evidence.composition存分段和schema/输出摘要、逐子问来源顺序及source/compiled入口SHA。supported表示至少一段有据，全部状态以coverage及parts为准。旧v1字段仍缺省；服务端在SAPI前和提交时校验，可识别失败而不保存半份答案。既有权限、来源撤回、播放租约和幂等不变。 [操作、证据和边界](55-presentation-question-parts.md)。

## 角色练习与访谈接口（052）

新增practice_scenarios、practice_scenario_versions、practice_releases、practice_runs、practice_turns五表，发布版/原回答不可覆写，明确删除后原问题/回答/反馈与状态置空并保留最小标记。/practice/scenarios及save/versions/publish-plan/publish、/practice/releases及withdraw/runs/responses、/practice/runs及answers/continue/stop/sharing/delete，所有路径前缀/api/v1。设计权限studio.write，参与asset.read，正文另限制本人或当前原发布者的明确共享。到期/撤回/来源及旧幂等重放均重新校验；共享契约生成OpenAPI。详见[流程、期限及实际边界](57-role-practice.md)。


## T20 PostgreSQL数据隔离迁移

离线CLI读取认证加密归档并核对全文件、原SQLite结构/52个迁移文件，导入独立PG原生001–003结构。301源表之外只新增_dg_postgres_migrations和_dg_import_control，原schema_migrations作为源历史保留；控制行只能quarantined。逐表摘要与原生目录/序列高水位可重新核验，不改API路径或当前存储引擎，不激活源认证/任务。媒体/签名密钥不写PG，原路径不迁移，对象存储和生产激活继续。[完整边界](61-postgres-staging-migration.md)。


## 原生PostgreSQL核心运行模式

显式原生验证模式在既有路径贯通auth/me/jobs/capabilities/events/provider-usage/audit-events，按当前权限/空间/环境/CSRF/Origin验证。Cookie名含实例ID，避免与默认SQLite工作台冲突。幂等只保存任务引用，回放重验权限；租户锁约束每日额度/并发，10秒租约在最终UPDATE中按数据库当前时间及令牌校验。其他模块返回503/PG_MODULE_NOT_MIGRATED，不静默回退。运行控制与迁移历史独立，原schema_migrations保持空而非伪造SQLite历史；新实例不会载入归档人员或会话。[字段/启动/边界](62-postgres-native-core.md)。


## 原生素材与专项授权增量（2026-11-22）

[原生素材/角色/训练链](63-postgres-native-assets.md)在同一API/worker入口接入私有PNG/WAV、版本及回收、专项授权与固定来源、统一角色和三类模拟任务。等待锁后/执行前/提交时复验当前权限、授权、原件和租约；17项编译实际进程及170项定向检查通过。PG006冻结/下一007，SQLite仍052/下一053；默认完整SQLite工作台33223不变。其他派生来源和全平台模块、对象存储、原生备份/清理/生产身份及G2继续，不把模拟训练称为真实克隆。


## 原生素材库与模拟验收（2026-11-22）

[原生文件版本/影响计划/模拟克隆验收](64-postgres-library-clones.md)接入同一API/worker。范围事务锁保护引用/文件一致性，008受限统计不开放未迁移工程正文；来源、尝试与状态版本固定且永久撤回。229项/14文件、编译23项及4个内嵌built Chrome流程通过，20表实际强杀回滚。PG001–008冻结/下一009，SQLite仍052/下一053；完整SQLite工作台33223保持，其他原生模块/派生来源和生产/G2继续，模拟结果不是真实克隆。


## 原生制作工程与静态预览

原生沿用/studio/projects、templates、brands、preview-jobs/previews，以及模板参数计划/历史/来源契约。009新增_dg_native_preview_job_sources、_dg_native_preview_artifacts两张追加凭据；studio_project_versions/template_versions/instantiations/review_plans禁止覆写。010保留既有失效触发器规则与固定作用域，未开放审阅/PPT正文。未迁移导入/来源和视频/评论等入口明确503。详见[操作与证据](65-postgres-studio.md)。

## 原生时间线与媒体导出

现接通`/studio/projects/:id/timeline-plan`、`timeline-previews`、`export-plan`、`exports`，以及对应任务查询/取消、MP4/WAV和私有文件下载；继续使用共享契约，写入须当前权限、Origin/CSRF、幂等键和明确计划/用途确认。011为两类任务增加固定来源快照、时间线产物凭据和不可变输入/租约状态守卫；012将媒体快照中的素材引用加入原受限六类统计，回收旧计划遇到新引用会失效。读取、幂等重放和下载重新检查当前工程版本及来源，Range下载从同一文件句柄分块计算SHA并流式输出。工程包/PPT/派生来源、审核评论等尚未迁移仍明确503。PG001–012冻结/下一013，SQLite052/下一053；详见[字段、任务与边界](66-postgres-media.md)。


## 原生工程包和分片传输

现支持现有export-plan/exports中的package类型，必须完整范围、固定当前来源并明确确认。实际返回package/project/manifest三份私有文件，下载仍复验当前工程/来源与实际SHA。新增原生/studio/transfers的分页/本人读取、创建、parts、finalize、cancel沿用共享MediaTransfer契约；分片固定4MB，版本和内容指纹用于续传，重复分片不覆盖。013增加传输/分片守卫、固定清单与素材来源，014显式转换bigint分片索引，015同事务完成审计，016使用共享名称规范化键。受限提交只允许当前原生worker与有效token，目标不继承旧编号/模型/consent，最短期限保留。视频原件、大原件、PPT及其他派生链尚未接通的入口明确失败，详见[接口、来源和恢复](67-postgres-project-packages.md)。


## 原生视频原件与检查帧

现有/studio/transfers的video类型已接通MP4/透明MOV，沿用4MB持久分片、指纹、parts/finalize/cancel及本人可见范围。/assets/:id/content流式返回原件，poster/browser-preview分别返回实际封面与独立网页代理；frame读取MOV实际Alpha，inspection-frame绑定帧编号、sourceVersion与sourceSHA256。两个数据库抽帧槽覆盖所有API，繁忙429。新增video_upload固定来源及017视频完成入口；工程包内视频重新实际检查，大PNG按64MB加64KB及像素限额解码。详见[接口、格式和来源](68-postgres-video-sources.md)。


## 原生PPT/PDF导入接口增量

/studio/imports列表要求workspaceId；POST登记已明确确认用途的8MB以内PDF/PPTX。/:id读取状态和审阅页，/:id/source私有Range下载实际原件，/studio/import-media/:id读取实际PNG。/:id/cancel验证当前版本及工程/模板图片引用；/:id/apply验证已审阅版本、选页、确认与当前空间并建立可编辑工程。review完成审计、结果/图片凭据和事件同事务，来源已损坏不继续返回页面正文。文档原件不随开放工程包迁移，PNG转换成普通包内素材且列出document_origin。详见[接口、限制和恢复](69-postgres-document-imports.md)。

## 原生逐页方案与成员场次（2026-11-23）

原生已接通/studio/presentations/plans的列表、建立、读取、save、versions和apply，以及/sessions的列表、建立、读取、control、questions、answer及video。写入带CSRF、幂等键、版本/观察页与明确确认；方案/独立采用/断点/问答、审计、事件和幂等同事务。实际MP4私有Range回读SHA；无效来源隐藏字幕和问答正文。自动answer-capabilities/answers/config仍503 PG_MODULE_NOT_MIGRATED，人工答复不冒充模型或实时数字人。见[接口与持久化约束](70-postgres-presentations.md)。


## 原生 PPT 自动答疑与系统语音（2026-11-23）

本增量接通/studio/presentations/answer-capabilities、/sessions/:id/answer-configuration、/sessions/:id/answers和/answers/:id的读取、control、playback/start、playback/end及私有audio Range。新的明确文字问题与自动任务/输入凭据同事务；输出凭据、问题、场次、审计和事件同事务。API不能写模型结果，worker无通用PPT正文SELECT，只得到当前租约投影。声源归属字幕不在此入口接收；通用工程speech-jobs等仍503 PG_MODULE_NOT_MIGRATED。 详见[实现、接口和验证](71-postgres-presentation-answers.md)。


## 原生工程配音、品牌词典与人工语言字幕（2026-11-23）

通用/studio/voice/styles、dictionaries及各自update/versions，voice/compile与capabilities，projects/:id/languages、subtitles、speech-jobs，以及subtitles/:id的save/apply/versions/srt/vtt、speech-jobs/:id的control/apply/segments/:segmentId/audio已接入原生。写入验证当前成员、CSRF、幂等、版本与来源，采用前实际WAV/PCM复核；私有音频支持单Range。品牌词典通过受限布尔函数验证，不给worker品牌正文。人工译文和估算/人工字幕标识保持；系统声音不代表克隆、自动翻译或口型。该状态替代前述020交付时通用speech-jobs仍503的历史说明。 详见[实现、接口与证据](72-postgres-speech-authoring.md)。


## 原生内容来源、脚本与真实模型队列（2026-11-23）

原生/studio/content/capabilities、sources及读取/withdraw/versions、briefs及读取/save/versions、drafts及读取/save/fork/restore/versions/plans、plans及读取/save/apply/cancel/versions，以及writing/capabilities和writing/jobs的列表/读取/control/adopt已接通。写请求按当前会话、CSRF、幂等和版本验证；模型未完成/资料撤回或原件损坏时明确不可用。计划草稿列表GET已补齐，不能以按钮隐藏代替后端权限。录制、自动视频ASR、内容日历和其他未迁移领域继续明确失败。 详见[操作、接口及证据](73-postgres-content-authoring.md)。


## 字幕断行、字形边界与预览缓存（2026-11-23）

接口路径不变。新策略下旧分镜PNG地址和旧预览计划返回409/PREVIEW_STALE或PLAN_CHANGED，需重新审阅/生成；成功后同策略缓存可复用。软断行不改保存的字幕或SRT时序。既有透明MOV规格为prores_4444，实际为ProRes 4444/PCM，4K解码alpha已复验。 详见[本批实现与验证](74-subtitle-word-layout.md)。


## T20/R-058 文件转写原生接口

新增原生 /api/v1/studio/transcriptions 的创建、本人列表、review/confirm/control/withdraw、revisions/audio/export，保持现有契约。API不写分析输出；受控worker写固定输入/PCM/分析初稿凭据；来源由真实分析和当前校对版本绑定，重新校对/撤回使下游失效。 详见[本批操作、接口和证据](75-postgres-file-transcriptions.md)。


## 字幕分页兼容规则

无新增公共字段或SQL。既有计划warnings说明显示时间为估算，canPreview/canRender/canExport承载容量失败。旧预览策略失效；成功导出的current校验保留原协议摘要和当前来源/权限，不重算原成片。保存文档/原字幕SRT/VTT不被分页改写。 详见[长字幕分页、验证与边界](76-caption-pagination.md)。


## T20/R-058 媒体加工原生接口

原生 /api/v1/studio/media-processing 的capabilities、plans/history/run/withdraw、jobs/control/semantic-selections/apply/revert/applications已接通既有契约。派生origin为media_processing，绑定实际不可覆写文件回执。列表元数据可见不代表下载或采用可用，素材库显示具体失效原因。 详见[本批操作和实际证据](77-postgres-media-processing.md)。


## T20/R-058 录制原生接口

原生 /api/v1/studio/recordings 的capabilities/list/create/save/upload/withdraw/apply/versions/source已接通既有契约；传输kind=recording仅能由本人方案绑定创建。recording来源独立固定原片与规范视频，素材库元数据可见不等于可下载。原片支持私有Range。 详见[本批操作与实际证据](78-postgres-recordings.md)。


## T20/R-058 AE源工程原生接口

原生ae-catalog、ae-templates/list/register/sync/versions、ae-source-permission/capability和ae-source-exports/plan/create/list/read/cancel/retry/withdraw/file沿用既有契约。写操作执行当前权限/CSRF/版本/幂等；源包独立studio.source.export，真实ZIP回执和当前目录授权决定私有Range下载。 详见[本批实现和证据](79-postgres-ae-sources.md)。


## 2026-11-23 原生AE渲染与成片采用

2026-11-23 原生AE单条/批量参数渲染、逐项错误和修正重试、视频/回执/Range，以及实际成片入库、透明代理和六轨工程已接通。583个不同检查/32文件有通过证据，新增36项；首轮关联540通过/29失败/13未执行，独立PG意外退出及既有分词器缺失的原失败保留；从原批准包恢复缺失文件后45项通过，真实问答单项补验1项通过，合计46且非单轮，再追加元数据入口1项通过；非单轮全部使用最终API。五次编译累计22项/26次检查通过、8个built流程；缺少夹具媒体工具、刷新未展开详情及二进制误读JSON的中断均保留，后续使用原编译/原实例续验，五类提交前强杀、实际FFmpeg强杀和三个原30秒自然恢复不重跑。最后仅API元数据读取守卫变化，worker、媒体程序及50份前端保持；最终双HTTP API及只读账户撤回后仍读到不可用原因，文件和工程继续受限。63直接/67观测/29Chrome关闭。032已应用冻结，函数引用以033追加修复，当前PG001—033/runtime30/下一034；SQLite052/下一053。主33223原四进程不重启不切库，3317原行/3310业务行和两密钥保持，本批原认证移除0。134/38/65/26及27本地verified保持；真实Adobe/克隆/声纹/G2和全平台继续。 见[本批实现和证据](80-postgres-ae-render-media.md)。


## 2026-11-23 原生团队评论与独立审核

2026-11-23 原生固定版本评论、回复/处理、独立工程与成品审核、收件箱、固定快照及决定回执已接通。两轮定向165个不同检查/7文件通过，新增35项；首轮分镜夹具500ms的33个失败、早期两次类型错误保留，修正夹具和类型后通过。相同编译两次累计13项/15次通过、6个built流程；首次旁白角色夹具被拒绝的失败保留，修正后完成五次实际API提交前强杀、同键恢复、双HTTP API独立会话十二并发、实际FHD原片/非静音合成纯音、390px/只读及API/PG重启。39直接/20观测/28Chrome关闭；50份前端和原71份编译文件保持，API/worker/CLI三份变化。034应用冻结，PG001—034/runtime31/下一035；SQLite052/下一053。主33223原四进程不重启不切库，3318原行/3310业务行和两密钥保持，原认证到期移除0。134/38/65/26及27本地verified保持；逐帧副本/邀请和直播继续，真实克隆/声纹/G2与全平台未完成。 见[本批实现与边界](81-postgres-team-reviews.md)。


## 2026-11-23 原生逐帧审阅与限时邀请

2026-11-23 原生完整逐帧副本、帧/画面坐标批注、内外讨论、独立外部反馈、限时邀请/会话/退出及撤回已接通。四轮选择性运行合计174个不同检查/6文件、38项新增通过（61+1+1+111）；两个专项过滤36/37项，非单轮174或全仓验收。编译首轮17项后BOM读取中断的FAIL保留；同一实例与75份原编译续验5项，共22项/22次通过、9个built流程。八次API及一次worker提交前强杀、原45秒租约恢复、原65秒邀请自然到期、独立实际Node/FFmpeg强杀、4K透明原件/24帧FHD副本和非静音合成纯音均验，原中断/自然期限未重跑或改写。60直接/57观测/30Chrome关闭。71份原编译与50份前端保持，三份变化且新增frame-review.mjs。035应用冻结，PG001—035/runtime32/下一036，SQLite052/下一053。主33223原四进程不重启不切库，3318原行/3310业务行/两密钥保持，原认证到期移除0。134/38/65/26及27本地verified保持；原生直播、生产身份/对外部署及全平台/G2继续，真实克隆/声纹未接受。 见[本批实现与边界](82-postgres-frame-reviews.md)。


## 2026-11-23 原生直播节目单与互动场控

2026-11-23 原生节目单/历史、固定场次、独立批准实际MP4、预览/自然排期、代次场控、模拟独立分发与人工/商品问答已接通。当前63及关联87项通过，共150个不同检查/6文件、新增38项，非单轮全仓验收；首轮5项失败及036清单字段顺序、037停止清理修复均保留。相同75份编译产物5次验证，累计37种/42次通过检查、8个最终GUI流程；前四次中断保留，最后沿用强杀/期限和原实例完成。强证据为终止前即时等待见证的10次API及1次worker回滚/原键恢复；另保留早期10/1物理强杀，不当作额外强证据。原3秒锁上限不改，新2.5秒来源暂存后自然到期409/全回滚、原3秒排期一次启动、实际FHD/24帧/非静音纯音、API/PG重启均验。111直接/179观测/29Chrome关闭、12私有集群关闭；截图加载态/展开导航限制单列。72原编译/50前端保持，仅API/worker/CLI变化。PG001—037冻结/runtime34/下一038，SQLite052/下一053。主33223原四进程不重启不切库，3318原行/3310业务行/两密钥保持，原认证移除0。134/38/65/26及27本地verified保持；原生连续媒体/录制/知识/播音/模型/数字人/连麦与全平台/G2继续，真实克隆/声纹/推流未接受。 见[本批实现与边界](83-postgres-live-control.md)。


## 2026-11-23 原生连续合流与实际录制

2026-11-23 原生连续720p/24fps合流、标题/字幕/PNG/WAV/静音预制画中画、实际帧计时与编码确认、实际片段MP4录制及拆条导出/撤回链已接通。最终原生47及关联116项通过，共163个不同检查/7文件、22项新增；关联运行早于后续封存/审计/重放校验收紧，非单轮全仓验收。7次编译验证累计25种/26次通过检查、6个不同GUI流程，另保留一次未启动实例的参数失败。原实例及75份原编译持续续验，早期权限/夹具/类型与报告、定位器、旧代次拒绝、过早观察、进程筛选等FAIL均保留，不重复已成功强杀或修改原租约、时钟、次数及期限。三类API及帧/录制两个worker提交前强杀、两个原30秒自然恢复、实际编码器独立强停、双HTTP API独立会话12并发拆条与撤回后原键拒绝、2.5秒来源暂存后自然到期409回滚均验。682帧与原实际片段逐帧一致，纯音/静音PCM、真实蓝色视频与后续稳定390px截图、API/PG重启已验。最终仅API增加拆条重放来源校验，另外74份编译含worker/媒体/CLI/50前端与原证据一致；相对83批仅API/worker/CLI三份变化。94直接/198观测/60Chrome及13私有集群关闭。PG001—039冻结/runtime36/下一040，SQLite052/下一053。主33223原四进程不重启不切库，3318原行/3310业务行/两密钥与AE配置保持，认证移除0。134/38/65/26及27本地verified保持；原生时间轴重建/知识/播音/模型/角色/连麦及全平台/G2继续，真实克隆/声纹/渠道未接受。 见[实现与边界](84-postgres-live-output.md)。


## 2026-11-23 原生时间轴重建录制

2026-11-23 原生时间轴重建归档已接通：停止/自然结束与任务原子保存，实际720p/24fps H.264/AAC、预制原声/暂停冻结/静音/人工问答卡片，支持取消、固定执行器重试、素材采用和拆条导出；保留与实际连续片段录制的区别。专项42项、关联73+1项通过，共116个不同检查/6文件，17项新增，非单轮或全仓验收；旧失败保留。相同76份编译、同一私有实例两轮10种/11次检查及5个GUI流程通过：API停止与worker归档提交前强杀、原90秒租约自然恢复、实际helper强杀/FFmpeg退出、双API独立会话12并发重试与拆条、实际纯音/静音/冻结帧、API/PG重启和原工程变更后全链阻断。PG001—040冻结/runtime37/下一041，SQLite052/下一053；原工作台33223不重启不切库。134需求/38任务/65验收/26组与27项本地verified保持，T20及完整G2/平台继续，真实克隆、声纹与渠道未验收。 见[实现、启动和边界](85-postgres-live-timeline.md)。

原有 `live-recordings` 查询、`control` 和 `create-clips` 接口现在支持原生 `local_timeline_reconstruction`。启用录制且未绑定连续输出时不再拒绝开播，终场事务排队；`queued/rendering` 不提供下载地址，失败保留原因。重试、取消、撤回需要当前开播权限和版本；拆条需要编辑权限，重放也复核原来源。内部三份不可覆盖账本由迁移040新增，不提供客户端写入端点。


## 2026-11-24 时间轴容量与停播收尾

2026-11-24 时间轴600段停播边界已完成本地修正：最后片段自动收尾，旧满额可停止，待播取消与归档原子保存；原片段不覆盖，未记录尾段不补造。新增可选terminalReason，容量提示与来源可用性分开，SQLite与原生服务均验证。136个不同检查/13文件有通过记录，13项新增；74+49关联早于最后原因分类修正，最终13项及当前编译覆盖该修正，非单轮全仓验收。同一私有实例续验保留原548条记录并实际成片，再用旧API/worker真正产生600段、复现409；修正版接手后600原行逐条不变，原键恢复、双API独立会话12次停止重放只结束/归档一次。最终7项编译检查、6个GUI流程及实际720p/AAC/原前缀时长、API/PG重启已验。原700请求驱动上限、清理函数名、快照并发占用及程序差异假设的中断均保留；未手动修改原时钟、计数或租约。PG001—040/runtime37冻结/下一041，无新SQL；SQLite052/下一053，主33223不重启不切库。134/38/65/26及27项本地verified保持，T20/G2与完整平台继续。 见[实现、启动和边界](86-postgres-live-terminal.md)。


## 2026-11-24 原生知识、场景与公开直播回复

原生运行目录38/迁移041已接通知识与场景现有接口。来源、受众、角色和播出代次贯穿回复与实际媒体派生，worker只获绑定公开来源的布尔校验，不读取内部原文。草稿/发布/撤回历史不可覆盖，过期或撤回用途不续期。关键词和模拟提示音不冒充语义模型、真人或真实ASR/TTS；未迁移业务工具明确503。原SQLite工作台不切换，后续PG042/SQLite053。见[实现、验证、启动与边界](87-postgres-live-knowledge.md)。


## 2026-11-24 原生直播实际系统播音

原生运行目录39/迁移042已接通系统播音现有接口与真实Windows SAPI生成，方案/任务输入和实际WAV/PCM回执不可覆盖。API控制与worker领取/提交权限分离；需明确选用方案和插播，暂停保持声音位置，静音继续推进。异常恢复只采用已发布片段的语音位置，撤回继续限制录像、素材、拆条和导出。系统声音不代表克隆、实时人物、真实渠道或现场说话人效果。主SQLite工作台不切换，后续PG043/SQLite053。见[实现、验证、启动与边界](88-postgres-live-speech.md)。


## 2026-11-24 原生直播本机模型问答

原生运行目录40/迁移043已接通实际Qwen/E5与原模型问答接口。配置、固定公开输入、实际结果和主持采用回执不可覆盖，自动模式仅准备已审核问题的候选，明确采用和播音仍分别确认。与PPT/脚本共用一个CPU槽位，30秒租约、最多三次尝试，取消保留物理执行器退出前的互斥。来源或权限失效贯穿答复、系统语音、片段、录像、素材、剪辑和导出。206项不同后端检查分次通过，7个GUI流程及实际模型、系统声音、AAC录像与重启已验；有限样本不代表低延迟、真人克隆或真实业务渠道。主SQLite不切换，后续PG044/SQLite053。见[实现、验证、启动与边界](89-postgres-live-answers.md)。


## 2026-11-24 原生形象目录与二维角色直播

运行目录42/迁移044—045接通原生形象来源、独立使用授权、目录版本/变体/归档、实际预览与固定二维直播绑定。复用原RMS绘制器及真实系统播音，源/版本/授权变化限制含形象的连续片段、录像、素材、剪辑和导出，独立系统WAV用途保持。专项47与关联239项分次通过；实际像素、音轨、原租约恢复、GUI及API/PG重启已验。工程动作/质检/训练和来宾合流仍待迁移，原工作台完整路径保留。卡通幅度口部不代表真人克隆、音素质量、实时吞吐或真实渠道。后续PG046/SQLite053。见[实现、验证、启动与边界](90-postgres-live-puppet.md)。


## 2026-11-25 原生下一访客交接协议

R-132/R-133的原生验证新增`POST /guest/sessions/:id/speaker-focus/handoff-intent`，使用既有严格的版本/目标及两项明确确认输入。当前本人访问、CSRF、来源和权限有效时签发独立60秒HttpOnly意图Cookie；仅返回意图编号、原截止时间及指定operationKey，不返回原始识别材料或凭证。`GET`同路径恢复必须同时具备旧普通Cookie和独立意图，只返回原非个人输入模板及旧CSRF，不续期。准备每分钟10个新操作受限；原幂等键重试不重复扣次，也不重签期限。

`POST /guest/sessions/:id/speaker-focus/handoff`在原生模式还须独立意图，Idempotency-Key必须等于其operationKey。旧结束、新匿名会话、新路径访问绑定与审计原子提交，拒绝漏绑定。新对象不继承资料、偏好、来访、声音参考或身份权限。普通旧Cookie在数据库立即失效；浏览器原Cookie保持原期限，以便已收到响应头却丢失正文时配合意图恢复。新访问首次成功授权即清空交接摘要并关闭旧领取入口；原始60秒到期同样关闭。源授权撤回、转人工或对象变化均不能利用旧恢复流程。

共享输入沿用speakerHandoffInput，原生专属OpenAPI补充位于`packages/contracts/src/native-speaker-handoff-openapi.ts`，由export-openapi生成完整目录并标注x-digitalguide-native-only；它不向旧SQLite服务宣称新增接口已开放。原生完整专注界面仍保持关闭，模拟协议与真实声纹、ASR及抗噪分别验收。细节和实际证据见[原生专注对话](101-postgres-speaker-focus.md)。


### 原生专注界面预览边界（2026-11-25）

ReceptionFeatures新增可选speakerHandoffIntent及speakerFocusPreview。原生准备/恢复能力使用既有079—081协议；只有完整界面标记或明确私有预览才显示专注面板。`NATIVE_SPEAKER_UI_PREVIEW=1`仅用于独立原生、开发/沙箱、mock且非恢复验证，SQLite/生产/live拒绝；当前完整界面标记仍false。开启预览时audio投影当前合成参考状态，不授予音频采集、身份、支付或管理权限。交接恢复待核对标记不含凭证，实际模板与原期限仍由服务端校验。实现及部分GUI证据见[原生专注文档](101-postgres-speaker-focus.md)。


### 原生专注界面本地验收后状态（2026-11-25）

在匹配私有目录、开发/沙箱和mock的原生验证运行时，speakerFocus现为true，speakerHandoffIntent为true，speakerFocusPreview为false，默认无需预览变量。它表示本地模拟控制链和界面可用，实际声音服务仍按场景单独配置；未配置时audio为not_configured/unlocked，明确合成服务才返回mock_focus及当前状态。其余权限、CSRF、双Cookie交接原60秒、来源/焦点/幂等校验保持；声纹或界面标记不授予身份。详细分阶段验证及失败记录见[实施文档](101-postgres-speaker-focus.md)。
