import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => fs.readFile(path.join(root, name), 'utf8');
const b = JSON.parse(await read('docs/backlog.json'));
if (b.version !== '1.1') throw new Error('This one-time migration requires design version 1.1');
const edits = new Map();
async function change(name, transform) {
  edits.set(name, transform(await read(name)));
}
const upgrade = text => text.replace('版本 1.1｜', '版本 1.2｜').replace('版本：1.1｜', '版本：1.2｜');
const append = (text, addition) => text.trimEnd() + '\n\n' + addition.trim() + '\n';
const reqIds = Array.from({length:6}, (_, i) => 'R-' + (129+i));
const acIds = Array.from({length:6}, (_, i) => 'AC-' + (60+i));
const titles = [
  '当前发问人的临时声纹参考与目标锁定',
  '目标语音提取 降噪与回声消除',
  '目标归属过滤与专属语音打断',
  '多人交接 重锁与迟到音频隔离',
  '声纹参考授权 生命周期与身份权限隔离',
  '嘈杂及重叠语音基准与交互回退'
];
for (let i = 0; i < titles.length; i++) b.requirements.push({
  id:reqIds[i], title:titles[i], module:'speaker-focus',
  origin:i < 3 ? 'user' : 'derived', priority:'P0', milestones:['M2','M5'],
  status:'planned', localStatus:'planned', liveStatus:'planned',
  acceptanceIds:[acIds[i]], sourceIds:['SRC-31'], evidence:[]
});
b.tasks.push({
  id:'T37', title:'目标说话人锁定与会话控制', milestone:'M2',
  dependsOn:['T04','T06','T26'], requirementIds:reqIds, acceptanceIds:acIds,
  status:'pending',
  deliverable:'实现临时/已登记参考契约、专注对话界面、归属过滤、partial 缓冲、目标打断控制、换人/重锁、参考清理及基准数据格式；用显式模拟事件验证，不宣称实际降噪。',
  externalDependencies:[], evidence:[]
}, {
  id:'T38', title:'目标语音真实接入与噪声现场验收', milestone:'M5',
  dependsOn:['T16'], requirementIds:reqIds, acceptanceIds:acIds,
  status:'pending',
  deliverable:'接入适配终端的真实声纹/目标提取服务，分别验证临时参考和已登记模式；按预先固定的多人噪声矩阵验证保留率、误触发、换人、打断、延迟和删除，保存可用范围及回退证据。',
  externalDependencies:['适用终端 SDK/提供商权限、授权语音样本、麦克风与扬声器、现场或可控混合测试条件；见 docs/10-speaker-focus.md。'],
  evidence:[]
});
b.tasks.find(t => t.id === 'T16').dependsOn.push('T37');
b.tasks.find(t => t.id === 'T21').dependsOn.push('T38');
b.tasks.find(t => t.id === 'T21').acceptanceIds.push(...acIds);
b.capabilityGroups.push({
  id:'CG-26', title:'接待专注对话与抗干扰',
  features:'临时声纹参考、目标语音提取、说话人跟踪、目标打断、换人、回退与基准',
  evidenceLevel:'用户新增；腾讯部分接口公开说明，其余为自有设计待实测',
  requirementIds:reqIds, sourceIds:['SRC-31'],
  boundary:'声纹匹配与语音分离分开验证；1.0 预注册或 HarmonyOS 能力不泛化为所有终端；不承诺完全排除噪声。',
  scope:'included'
});
b.verificationItems.push({
  id:'V-09', topic:'临时目标声纹与端到端抗噪能力',
  status:'to_verify',
  resolution:'核对 1.0/2.0、Web/移动 SDK、预注册与临时参考条件、最终字幕判定时机和目标打断支持；实际麦克风与多人重叠场景按 docs/10-speaker-focus.md 测量。'
});
b.version = '1.2';
b.updatedAt = '2026-11-17';
b.scopeRevision += ' v1.2 增加前台、餐厅桌位及展厅目标说话人锁定与抗干扰对话，保留全部既有范围。';
b.expectedCounts = {requirements:134,tasks:38,acceptanceCases:65,capabilityGroups:26};
edits.set('docs/backlog.json', JSON.stringify(b, null, 2) + '\n');

await change('README.md', text => upgrade(text)
  .replace('128 项需求和 36 项任务', '134 项需求和 38 项任务')
  .replace('| [当前执行计划]', '| [目标说话人锁定与抗干扰对话](docs/10-speaker-focus.md) | 多人环境、声纹参考、语音提取、换人、回退与验收 |\n| [当前执行计划]'));
await change('docs/01-product-design.md', text => append(upgrade(text), `
## v1.2 接待专注对话

前台、餐厅桌位和展厅增加目标说话人锁定：先确定本次发问人，建立临时语音参考，结合降噪、回声消除和目标语音提取持续跟踪，只将确认属于目标的内容送入回答与业务流程。噪声更大的旁人不能直接抢走会话；目标插话和普通背景声音分别处理。

默认临时参考会话结束即清理，长期登记另行授权。声纹匹配不授予员工或支付权限；切换发问人需显式交接，避免串单、串档。无法可靠分离时提示轮流说话、靠近或按住说话。详细流程、供应商边界和测量条件见 [专项设计](10-speaker-focus.md)，对应 R-129—R-134、T37/T38 与 AC-60—AC-65。
`));
await change('docs/02-architecture.md', text => append(upgrade(text)
  .replace('5. ASR 文本与会话状态送入业务编排，检索当前角色可访问的知识和记忆。', '5. ASR 文本须先通过目标归属过滤，再与会话状态送入业务编排；归属不明的部分字幕不得提前送入 LLM、记忆或工具。检索限于当前角色可访问的知识和记忆。')
  .replace('8. 用户插话取消尚未播放的旧回复；', '8. 经确认的目标发问人插话取消尚未播放的旧回复；旁人谈话不触发自动打断，人工停止按钮始终可用；'), `
## v1.2 目标说话人音频链路

在接待实时链路中增加 SpeakerFocusProvider 与 TargetSpeechProvider 能力边界，允许一个 SDK 同时实现二者。前者负责临时/登记参考与目标归属，后者负责目标提取、降噪、回声处理；VoiceProvider 的克隆合成职责保持独立。

ProviderCapabilities 增加 temporaryReference、enrolledReference、minReferenceDuration、supportedPlatforms、targetExtraction、overlapSupport、targetBargeIn、attributionTiming、referenceDeletion、processingLocation、audioChannelRequirements。未证实能力保持未验证，不根据同一家厂商其他产品线推断支持。

参考链路为麦克风 → 回声消除/降噪/可选阵列 → 目标提取与跟踪 → ASR → 目标归属过滤 → LLM/工具 → TTS/数字人。按提供商调整具体顺序，但归属过滤必须位于模型、记忆与业务执行前。只能在最终字幕判定目标的服务，部分字幕使用限长短期缓冲；不得提前展示或生成回答。

每个桌位/终端维护独立会话与 focusVersion；换人、重锁和释放使旧版本结果失效。持续匹配只用于对话归属，不能建立已认证身份。参考、事件、回退与评测契约以 [专项设计](10-speaker-focus.md) 为准。G1 验证控制和隔离，G2 验证真实混合音频效果。
`));
await change('docs/03-data-api.md', text => append(upgrade(text), `
## v1.2 说话人归属契约

新增 SpeakerFocusSession、SpeakerReference、SpeakerSegmentDecision，字段及接口详见 [目标说话人专项设计](10-speaker-focus.md)。会话保存配置快照和 focusVersion，转写片段保存 target/other/uncertain 判定，不将非目标文本写入对话记录。

接口包括 POST/GET/DELETE /sessions/:id/speaker-focus、POST /sessions/:id/speaker-focus/reacquire、POST /sessions/:id/speaker-focus/handoff，以及 POST/DELETE /speaker-references（删除具体资源时使用 /:id）。创建长期模板要求该用途授权；访问始终检查租户、场所、会话所有权及权限。

事件包括 speaker.focus_acquiring、speaker.focus_locked、speaker.focus_uncertain、speaker.focus_changed、speaker.segment_rejected、speaker.focus_released。订单、记忆与工具调用同时核对 sessionId、focusVersion 和原有确认令牌；新目标不能使用旧目标的确认。此检查在服务端执行，不能只靠客户端过滤字幕。

删除临时参考覆盖本地缓存与提供商引用，并记录完成/失败状态。长期参考与声音克隆素材独立管理；voiceprint match 不建立员工登录态。原始声纹和旁人转写不得进入普通日志或分析仓库。
`));
await change('docs/04-roadmap-acceptance.md', text => upgrade(text)
  .replace('G1 范围已按 v1.1 扩展', 'G1 范围已按 v1.1 与 v1.2 扩展')
  .replace('## 媒体与现场验证', `## v1.2 目标说话人验收

| ID | 用例与通过条件 | 范围 |
| --- | --- | --- |
| AC-60 | 明确服务对象后建立临时参考；质量不足或多人样本不显示锁定；已登记与临时模式分别验证，不自动建立长期档案 | G1 控制/G2 识别 |
| AC-61 | 目标、旁人、背景噪声及自身播报混合输入可按声明能力提取目标；记录 ASR 错误率与基线，缺少阵列/服务时明确回退 | G1 契约/G2 音频 |
| AC-62 | 非目标和不确定字幕包括 partial 不进入 LLM、展示、记忆或工具；目标可按已验证能力打断，旁人不触发自动打断；错误模式可手动停止 | G1 策略/G2 打断 |
| AC-63 | 旁人更响不直接换人；移动/失锁触发重锁；明确交接更新 focusVersion，迟到音频与旧确认失效，多桌不串会话 | G1/G2 |
| AC-64 | 临时参考结束/超时/撤回清理；登记模板有独立授权及外部删除状态；声纹匹配、相似声音、录音重放均不能授予员工或敏感动作权限 | G1 生命周期/G2 提供商 |
| AC-65 | 按专项设计预定设备、噪声与重叠矩阵和阈值；报告目标保留、旁人触发、错误换人、打断与延迟及样本量；失败可近场/按键/人工回退，不宣称全环境免干扰 | G1 评测契约/G2 现场 |

G1 的模拟说话人事件只证明流程与权限。G2 的真实音频测试按 [专项设计](10-speaker-focus.md) 保存条件、标注和统计；真实业务负向测试不得出现越权操作。AC-24 的语音打断与本节 AC-62 共同验收，不以普通声音活动触发停止冒充目标专属打断。

## 媒体与现场验证`));
await change('docs/05-research-evidence.md', text => append(upgrade(text), `
## v1.2 目标说话人与抗干扰证据

- SRC-31 腾讯：[AI 对话 1.0 声纹识别](https://cloud.tencent.com/document/product/647/119842)、[VoiceAI ASR HarmonyOS SDK](https://cloud.tencent.com/document/product/647/137686)。

2026-11-17 核对：1.0 接入页要求预注册约 8—18 秒有效语音，固定模式只配置一个声纹 ID，声纹判定随最终字幕返回，非匹配默认不送 LLM，页面注明试用。HarmonyOS SDK 另有按说话人转写/降噪能力说明。上述依据证明存在相关接入路径，不能证明新来客即时临时锁定、全部终端/2.0 兼容或任意噪声条件均可靠。

临时参考、多人交接、归属过滤及现场指标是本项目的新增设计要求。供应商模式、终端与真实效果保留 V-09 待验证；本次未注册声纹、调用付费接口或进行音频实测。
`));
await change('docs/06-decisions-and-dependencies.md', text => append(upgrade(text), `
## v1.2 专注对话决策与条件

D-19：多人接待默认使用当前会话临时参考锁定发问人；已登记声纹独立授权，识别与克隆分开管理。
D-20：声音归属确认先于 LLM、记忆和业务执行；部分字幕不绕过归属过滤，声纹不授予身份权限。
D-21：按场所和硬件声明抗噪可用范围；低置信度和无法分离的重叠语音回退，不承诺完全免干扰。

新增真实依赖：麦克风/阵列及扬声器回声参考、部署距离与混响条件、允许使用的多人测试录音、具体 SDK 终端版本、临时参考/登记能力、删除接口和试用资格。V-09 单独核实腾讯 1.0、2.0 与各 SDK 的差异。缺少条件时 T37 可完成模拟控制与数据策略，T38 保留真实接入等待项。
`));
await change('docs/CODEX_GOAL_PROMPT.md', text => text
  .replace('docs/08-competitor-capability-matrix.md、docs/09-full-platform-scope.md\n和 docs/backlog.json。', 'docs/08-competitor-capability-matrix.md、docs/09-full-platform-scope.md、\ndocs/10-speaker-focus.md 和 docs/backlog.json。')
  .replace('互动课程与角色训练。按完整功能矩阵执行', '互动课程与角色训练，以及接待目标说话人锁定、归属过滤、换人和回退。\n声纹参考默认限于本会话，模拟控制不能当作实际抗噪效果。按完整功能矩阵执行')
  .replace('按 docs/04-roadmap-acceptance.md 保存真实回执、输出规格和现场测试证据。', '按 docs/04-roadmap-acceptance.md 保存真实回执、输出规格和现场测试证据。\n目标语音按 docs/10-speaker-focus.md 验证真实噪声、重叠、换人与打断，\n记录设备和可用范围，不以供应商声纹接口存在替代现场验收。'));
await change('PLAN.md', text => append(text.replace('当前交付：设计基线 v1.1', '当前交付：设计基线 v1.2'), `
## v1.2 接待目标说话人修订

2026-11-17：按用户补充加入餐厅桌位、前台和展厅的发问人锁定与抗干扰对话。新增专项设计及 R-129—R-134、T37/T38、AC-60—AC-65、CG-26、V-09、SRC-31；完整基线为 134 项需求、38 项任务、65 条验收、26 组功能和 9 项待验证。G1/G2 出口均包含新增任务。

同步产品、架构、数据接口、决策、目标提示词与总文档编排。重点补充临时/登记参考区别、目标语音提取、partial 归属过滤、目标打断、换人版本隔离、生命周期及现场测量。腾讯证据按 1.0/终端边界记录。未启动应用开发或真实声纹采集。
`));

for (const [name, text] of edits) await fs.writeFile(path.join(root, name), text, 'utf8');
process.stdout.write('Updated design baseline from 1.1 to 1.2. Run build-docs.mjs and check-docs.mjs.\n');

