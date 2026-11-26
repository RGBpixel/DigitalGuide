import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => fs.readFile(path.join(root, name), 'utf8');
const backlog = JSON.parse(await read('docs/backlog.json'));
const taskMap = new Map(backlog.requirements.map(r => [r.id, backlog.tasks.filter(t => t.requirementIds.includes(r.id)).map(t => t.id)]));
const originNames = {user: '用户要求', derived: '实现必需', research: '研究衍生'};
const lines = [
  '# DigitalGuide 需求追溯清单', '',
  '由 docs/backlog.json 生成。更新结构化清单后运行 node scripts/build-docs.mjs，不单独修改本文件。', '',
  '阶段顺序不取消最终需求；G1 的模拟验证不替代 G2 的真实能力。各项当前状态以结构化清单为准。', '',
  '| 编号 | 需求 | 来源类型 | 优先级 | 阶段 | 开发任务 | 验收 |',
  '| --- | --- | --- | --- | --- | --- | --- |'
];
for (const r of backlog.requirements) lines.push('| ' + [r.id, r.title, originNames[r.origin], r.priority, r.milestones.join('/'), taskMap.get(r.id).join(', '), r.acceptanceIds.join(', ')].join(' | ') + ' |');
lines.push('', '## 任务依赖', '', '| 任务 | 交付 | 阶段 | 前置 | 当前状态 |', '| --- | --- | --- | --- | --- |');
for (const t of backlog.tasks) lines.push('| ' + [t.id, t.title, t.milestone, t.dependsOn.join(', ') || '无', t.status].join(' | ') + ' |');
lines.push('', '详细任务交付和证据保存在 [backlog.json](backlog.json)。', '');
await fs.writeFile(path.join(root, 'docs/07-requirements-traceability.md'), lines.join('\n'), 'utf8');

const coverage = [
  '# DigitalGuide 竞品功能覆盖矩阵', '',
  '版本 ' + backlog.version + '。由结构化清单生成；前期已发现功能和用户场景共同进入项目范围，阶段只决定实施顺序。', '',
  '官方说明表示有公开证据，仍需项目实测；用户新增和自有设计不冒充竞品已支持。覆盖的是本轮可查阅资料，不宣称穷尽登录后台及商务定制。', '',
  '所有来源编号见 [研究证据](05-research-evidence.md)，每项需求的阶段、任务与验收见 [追溯清单](07-requirements-traceability.md)。', '',
  '| 功能组 | 具体能力 | 依据与来源 | 项目需求 | 重要边界 |',
  '| --- | --- | --- | --- | --- |'
];
for (const g of backlog.capabilityGroups || []) coverage.push('| ' + [g.title,g.features,g.evidenceLevel + '；' + (g.sourceIds.join(', ') || '用户/设计要求'),g.requirementIds.join(', '),g.boundary].join(' | ') + ' |');
coverage.push('', '## 待验证能力', '', '这些事项保留在最终范围与任务中，未确认前不写成已接通或已支持。', '', '| 编号 | 待验证项 | 处理方式 |', '| --- | --- | --- |');
for (const v of backlog.verificationItems || []) coverage.push('| ' + [v.id,v.topic,v.resolution].join(' | ') + ' |');
coverage.push('', '具体新增业务流程见 [全场景功能扩展](09-full-platform-scope.md)。', '');
await fs.writeFile(path.join(root, 'docs/08-competitor-capability-matrix.md'), coverage.join('\n'), 'utf8');

const parts = [
'docs/01-product-design.md', 'docs/09-full-platform-scope.md', 'docs/10-speaker-focus.md', 'docs/11-interactive-motion-prompts.md', 'docs/18-restaurant.md', 'docs/19-orders-kitchen.md', 'docs/20-billing-service.md', 'docs/21-voice-localization.md', 'docs/22-character-motion.md', 'docs/23-content-workbench.md', 'docs/24-media-collaboration.md', 'docs/25-asset-library.md', 'docs/26-file-collections.md', 'docs/27-presentations.md', 'docs/28-courses-learning.md', 'docs/29-parameterized-templates.md', 'docs/30-ae-templates.md', 'docs/31-interactive-sharing.md', 'docs/32-content-governance.md', 'docs/33-live-control.md', 'docs/34-live-continuous-output.md', 'docs/35-advertising.md', 'docs/36-studio-assistant.md', 'docs/37-neural-segmentation.md', 'docs/38-subject-tracking.md', 'docs/39-semantic-clips.md', 'docs/40-neural-restoration.md', 'docs/41-local-semantic-editor.md', 'docs/42-gaze-geometry.md', 'docs/43-local-presentation-answers.md', 'docs/44-live-system-speech.md', 'docs/45-live-local-answers.md', 'docs/46-live-puppet.md', 'docs/47-source-script-generation.md', 'docs/48-script-source-review.md', 'docs/49-opening-calendar-review.md', 'docs/02-architecture.md', 'docs/03-data-api.md',
'docs/50-ae-source-exports.md', 'docs/51-neural-denoising.md', 'docs/52-ae-media-adoption.md', 'docs/53-local-webrtc-calls.md', 'docs/54-live-guest-programme.md', 'docs/55-presentation-question-parts.md', 'docs/56-g1-local-exit-audit.md', 'docs/57-role-practice.md', 'docs/58-local-user-guide.md', 'docs/59-g1-platform-acceptance.md', 'docs/60-encrypted-recovery.md', 'docs/61-postgres-staging-migration.md', 'docs/62-postgres-native-core.md', 'docs/63-postgres-native-assets.md', 'docs/64-postgres-library-clones.md', 'docs/65-postgres-studio.md', 'docs/66-postgres-media.md', 'docs/67-postgres-project-packages.md', 'docs/68-postgres-video-sources.md', 'docs/69-postgres-document-imports.md', 'docs/70-postgres-presentations.md', 'docs/71-postgres-presentation-answers.md', 'docs/72-postgres-speech-authoring.md', 'docs/73-postgres-content-authoring.md', 'docs/74-subtitle-word-layout.md', 'docs/75-postgres-file-transcriptions.md', 'docs/76-caption-pagination.md', 'docs/77-postgres-media-processing.md', 'docs/78-postgres-recordings.md', 'docs/79-postgres-ae-sources.md', 'docs/80-postgres-ae-render-media.md', 'docs/81-postgres-team-reviews.md', 'docs/82-postgres-frame-reviews.md', 'docs/83-postgres-live-control.md', 'docs/84-postgres-live-output.md', 'docs/85-postgres-live-timeline.md', 'docs/86-postgres-live-terminal.md', 'docs/87-postgres-live-knowledge.md', 'docs/88-postgres-live-speech.md', 'docs/89-postgres-live-answers.md', 'docs/90-postgres-live-puppet.md', 'docs/91-postgres-live-guests.md', 'docs/92-postgres-live-programme.md', 'docs/93-postgres-live-return.md', 'docs/94-postgres-character-production.md', 'docs/95-postgres-studio-assistant.md', 'docs/96-postgres-office.md', 'docs/97-postgres-people.md', 'docs/98-postgres-reception.md', 'docs/99-postgres-guest-memory.md', 'docs/100-postgres-visits.md', 'docs/101-postgres-speaker-focus.md', 'docs/102-postgres-vision.md', 'docs/103-postgres-restaurant.md', 'docs/104-postgres-restaurant-sessions.md', 'docs/105-postgres-dining.md', 'docs/106-postgres-dining-food.md', 'docs/107-postgres-orders.md', 'docs/108-postgres-order-dispatch.md', 'docs/109-postgres-kitchen-control.md', 'docs/110-postgres-billing.md', 'docs/111-postgres-financial.md', 'docs/04-roadmap-acceptance.md', 'docs/05-research-evidence.md',
'docs/127-operations-metrics.md', 'docs/128-enterprise-plans.md', 'docs/129-resource-shelf.md', 'docs/130-enterprise-identity.md', 'docs/131-member-directory.md', 'docs/132-member-runtime-access.md', 'docs/133-identity-recovery.md', 'docs/134-enterprise-directory.md', 'docs/135-enterprise-directory-ui.md', 'docs/136-enterprise-directory-access.md', 'docs/137-directory-recovery.md', 'docs/138-directory-lifecycle.md', 'docs/139-directory-erasure-recovery.md', 'docs/140-developer-access.md', 'docs/06-decisions-and-dependencies.md', 'docs/08-competitor-capability-matrix.md', 'docs/07-requirements-traceability.md',
'docs/CODEX_GOAL_PROMPT.md'
];
let book = '# DigitalGuide 数字人平台建设总文档\n\n版本 ' + backlog.version + '｜' + backlog.updatedAt + '｜' + (backlog.baseline === 'design_only' ? '设计基线，应用尚未开发。' : '设计基线；应用已启动开发，实际进度见 PLAN.md。') + '\n\n';
book += '本文件便于整体阅读，由专项文档自动汇编。修改请更新 docs 内原文与 backlog.json 后运行 node scripts/build-docs.mjs。Codex 开发入口为 [README](README.md)、[AGENTS](AGENTS.md) 与 [PLAN](PLAN.md)。\n\n';
book += '统一覆盖预制视频、PPT、直播、发布投放、展厅、企业前台和餐厅，以及前期竞品已发现能力。内容包括产品设计、技术架构、数据接口、开发验收、竞品功能矩阵、接入条件、' + backlog.requirements.length + ' 项需求、' + backlog.tasks.length + ' 项任务及目标执行提示词。\n\n';
for (const name of parts) {
  let body = await read(name);
  body = body.replace(/\]\(([^)]+)\)/g, (match, link) => {
    if (/^(https?:|mailto:|#)/.test(link)) return match;
    return '](' + path.posix.normalize(path.posix.join(path.posix.dirname(name), link)) + ')';
  });
  let fenced = false;
  body = body.split('\n').map(line => {
    if (line.startsWith('~~~')) { fenced = !fenced; return line; }
    return !fenced && /^#{1,5} /.test(line) ? '#' + line : line;
  }).join('\n');
  book += '\n' + body.trim() + '\n';
}
await fs.writeFile(path.join(root, 'DigitalGuide-平台建设总文档.md'), book, 'utf8');
process.stdout.write('Generated master document and requirement traceability.\n');

