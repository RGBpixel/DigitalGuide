# 接待终端基础：T04

2026-11-18｜M2 建设中｜关联 R-003、R-032、R-033、R-034、R-035、R-056、R-064。

## 使用方式

当前本地开发服务已按用户预览需求保持运行。打开 http://127.0.0.1:5173/reception，使用虚构管理员账号进入企业接待。首次选择场所并保存终端配置，再点击“开始文字接待”。没有运行服务时，在项目根目录执行 pnpm setup:local、pnpm dev；首次安装先执行 pnpm install。只读成员和内容编辑没有接待管理权限。

进入访客终端后可输入文字、演示回复播放状态、手动停止、请求人工接待和结束会话。模拟播放不产生语音或真人画面。人工接管后自动回复暂停，访客仍能留文字；恢复自动接待需要工作人员在企业接待台明确释放。

“模拟访客 A/B 接近”使用显式模拟事件验证单活动会话、冷却和排队。同一短时目标不会重复问候；当前会话结束后点击“接待下一位”。等候列表仅保留最近 30 秒内仍有接近事件的目标，问候冷却为 60 秒。工作人员主动开始文字接待是明确用户意图，可单独启动。当前不通过相机自动检测来客。

## 实际实现和限制

终端配置、匿名会话、消息、播放状态、人工控制、问候冷却和队列落库保存。SQLite 新增 002 迁移，不重建或清空原有资产、任务和用户表。角色在会话创建时固定版本快照；后续角色修改不改变正在进行的接待。

会话空闲 2 分钟或最长 15 分钟后结束，worker 与 API 访问时均执行到期清理。读取页面的轮询不延长空闲时间；明确的文字或控制动作才更新活动时间。临时访问 Cookie 限于本会话路径，并绑定会话、访问版本和运行环境。结束与超时使凭证失效，无法继续读取历史消息；工作人员按工作空间权限查看状态。此短时授权不能用于资产、任务、人员或其他后台接口。

播放确认绑定 sessionId、replyId、replyEpoch、focusVersion。手动停止、新文字、人工接管、会话结束会取消未完成旧回复；旧播放确认返回状态冲突，不能恢复旧回复。focusVersion 只为后续目标说话人控制预留，此阶段没有建立或识别声纹。

摄像头和麦克风调用由终端使用者主动点击触发。T04 的设备入口只提供本机预览和设备检查。2026-11-19 T26 另增加明确授权后手动发送单帧的画面问答，详见 [画面、语音及工具流程](17-knowledge-scenes.md)；开启设备仍不会自动上传。当前不运行真实 ASR、人脸识别或陌生人建库。拒绝、缺少设备或占用时保留文字入口；退出、结束、接管、取消请求和迟到授权均释放相应轨道。

设备接口使用 [getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)，释放使用 [MediaStreamTrack.stop](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/stop)。自动测试使用权限拒绝与合成轨道替身，没有自动接受本机相机或麦克风权限；真实硬件仍需使用者主动验证。

遵循 [目标说话人规则](10-speaker-focus.md)：由于尚无可靠归属服务，所有模拟语音片段，包括自称 target 的 partial/final，均不进入对话展示、模型、记忆或业务。只记录拒绝元数据，不保存被拒绝文字；旁人音频不能打断当前回复。T37 将在其依赖完成后实现真正的临时参考与归属控制，T38 负责真实音频验收。

当前回复来自确定性的 mock-realtime 适配器，没有调用 LLM、TTS、真人驱动或外部业务。sandbox/live 没有适配器时明确拒绝，不降级为模拟成功。T05 已增加 [来访登记与模拟通知](14-visit-workflow.md)；人员与记忆、口信日历继续由 T06/T07 实现。G1/G2 均未验收。

## 接口与验证

管理接口：GET/POST /terminals、POST /terminals/:id/presence、POST /terminals/:id/next、POST /sessions、GET /sessions/:id、POST /sessions/:id/access、POST /sessions/:id/control。它们要求管理员权限、租户与工作空间授权。

访客接口限定在 /guest/sessions/:id，包括读取、messages、events 和 control。独立 Cookie、防 CSRF、来源校验与幂等键在服务端执行。恢复自动模式仅允许管理接口；请求正文中的身份字段、未知来源和额外权限字段会被 schema 拒绝。

输入与会话响应 schema 位于 packages/contracts/src/reception.ts，OpenAPI 通过 pnpm api:spec 生成。实现位于 apps/api/src/reception-service.ts、reception-routes.ts 和 apps/web/src/reception/。当前证据见 [T04 验证记录](evidence/T04/verification.json) 与 PLAN.md。

已验证文字持久化、受限凭证、跨租户拒绝、CSRF、问候冷却/队列、公平顺序、幂等、播放取消/迟到事件、接管与超时、角色快照、到期资产及真实环境不回退模拟。真实噪声、语音打断、摄像头接近算法和现场效果不属于这些模拟证据。
