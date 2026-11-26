import fs from 'node:fs';
import assert from 'node:assert/strict';
const root='docs/evidence/T20/postgres-character-production',read=f=>JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,'')),backend=read(root+'/backend-summary.json'),compiled=read(root+'/compiled-summary.json');for(const r of [backend,compiled])assert.equal(r.result,'PASS');
const media=compiled.actualMedia,recovery=compiled.actualWorkerRecovery;
const summary=`2026-11-24 原生形象制作与审核应用完成本地增量：动作方案及历史、实际素材质检、图片/原片/三维静态参考、原创二维表情/手势与WAV幅度口部、独立授权的明确模拟准备、未知原请求核对、人工审核、取消/三次重试与两项并发容量、原子应用及派生资产来源链已接通。素材回收预览包含形象、动作方案、固定任务和派生引用。172个不同检查/9文件分次通过，33项新增专项；同一私有实例与同一76份编译完成9项功能检查、5个GUI流程及原件续验。实际动作512×768/24fps，原工程HD导出1920×1080 H.264/AAC、48帧，SHA ${media.export.sha256}。校验脚本误将HD当成720p的失败保留，沿原角色、任务和文件继续，原操作不重做。真实worker强杀后，同一任务等原30秒租约自然到期，次数1→2，固定输入和创建时间未改；API/PG重启保留角色/方案/任务/结果/绑定和原件字节，随后撤回使用用途阻断原文件、恢复任务、派生资产及导出。PG053、054首次成功应用后冻结，runtime51/下一055；SQLite052/下一053，主33223原四进程、301表3318原行/3310业务行、两密钥和AE保持。134/38/65/26与27项本地verified及全部门槛状态保持，T20/G2和完整平台继续。`;
const next='下一步推进原生内容日历、聊天式编辑、批量团队、发布投放及其余展厅/前台/餐厅全场景流程，同时继续直播24fps、持续音频、复杂网络与长期负载。真人/照片/三维驱动、真实形象/声音/语气克隆、音素口型、声纹焦点、真实渠道/设备和业务系统分别接入验收；本轮参数角色及明确模拟准备不替代这些目标。';
let file='PLAN.md',text=fs.readFileSync(file,'utf8');text=text.replace('当前增量：94，T20原生形象制作与审核应用，in_progress；完整平台/G2继续，目标active。','当前增量：94，T20原生形象制作与审核应用已完成本地增量验证；完整平台/G2继续，目标active。');const a=text.indexOf('## 正在执行：原生形象制作与审核应用'),b=text.indexOf('## 上一批交付：节目返送媒体与文字对比度',a);assert.ok(a>=0&&b>a);text=text.slice(0,a)+'## 当前交付：原生形象制作与审核应用\n\n[实现、检查、启动与边界](docs/94-postgres-character-production.md)、[证据](docs/evidence/T20/postgres-character-production)。'+summary+'\n\n'+next+'\n\n'+text.slice(b);fs.writeFileSync(file,text);
file='README.md';text=fs.readFileSync(file,'utf8');assert.ok(!text.includes('docs/94-postgres-character-production.md'));text=text.replace(/^# DigitalGuide 数字人平台\r?\n/,()=> '# DigitalGuide 数字人平台\n\n[原生形象制作与审核应用](docs/94-postgres-character-production.md)：动作/质检、实际参考与二维动作、独立模拟准备及审核后应用已接通；172项检查分次通过，实际1080p导出、worker恢复、重启与撤回已验。真人克隆与完整平台/G2继续，原工作台保持。\n\n上一批交付：\n');fs.writeFileSync(file,text);
file='docs/backlog.json';const backlog=read(file),before=read(root+'/backlog-before.json'),evidence=['docs/94-postgres-character-production.md',root+'/backend-summary.json',root+'/compiled-summary.json',root+'/visual-review.json',root+'/runtime/preservation-final.json'];
function note(item,value){assert.ok(item);item.progressNote=value+(item.progressNote?'\n历史记录：'+item.progressNote:'');item.evidence=[...new Set([...(item.evidence??[]),...evidence])];}
for(const id of ['R-010','R-058','R-068','R-069','R-070','R-071','R-126'])note(backlog.requirements.find(r=>r.id===id),summary+' '+next);
for(const id of ['T20','T23'])note(backlog.tasks.find(t=>t.id===id),summary+' '+next);
note(backlog.requirements.find(r=>r.id==='R-015'),'2026-11-24 增量94实际动作、1080p合成及桌面/390px表单已核对；手机帮助文案仍偏小、偏浅，未验收全界面排版和任意背景可读性。');
assert.deepEqual(backlog.tasks.map(t=>[t.id,t.status]),before.tasks.map(t=>[t.id,t.status]));assert.deepEqual(backlog.requirements.map(r=>[r.id,r.status,r.localStatus,r.liveStatus]),before.requirements.map(r=>[r.id,r.status,r.localStatus,r.liveStatus]));assert.deepEqual(backlog.gates,before.gates);assert.deepEqual(backlog.verificationItems,before.verificationItems);fs.writeFileSync(file,JSON.stringify(backlog,null,2)+'\n');
file='docs/06-decisions-and-dependencies.md';text=fs.readFileSync(file,'utf8');text+='\n## 2026-11-24：原生形象制作与固定派生文件\n\nR-058/R-068—R-071/R-126以固定形象、源素材、独立用途、项目及动作版本创建持久任务。实际质检与实际媒体、明确模拟准备分别提交；参数角色专项训练授权不放宽通用PNG克隆任务的输入格式。两个原生物理租约、每任务最多三次尝试；取消只请求停止，实际处理结束后释放占用。API不能写worker完成结果，worker不能调用工程应用或读取原始工程/动作正文。053冻结后追加054，以受限原因投影检查版本，不扩大原始列权限。派生资产与新工程修订、一次任务应用同事务；回收影响摘要加入固定形象引用，旧摘要在引用新增后失效。详见[增量94](94-postgres-character-production.md)。\n';fs.writeFileSync(file,text);
const doc=`# 原生形象制作与审核应用

状态：2026-11-24 已完成本地增量实现与验证；T20、G2及完整134项需求继续。

${summary}

## 本轮实现

形象目录沿用独立使用授权和当前来源校验。新增动作方案、不可覆盖历史和制作任务；服务端核对同空间、形象/项目/方案版本、分镜实际区间、动作冲突和配音来源。实际质检读取PNG、原创二维参数、静态GLB、WAV及完整解码的视频，报告保留未评估项，不推断身份或真人克隆质量。

参考制作生成真实图片或原片片段；原创二维动作生成512×768、24fps、最长10秒的普通背景MP4，表情/手势按时间点执行，WAV只驱动幅度口部。关联WAV在应用时单独放到配音轨；不是音素口型或参考语气复刻。模拟准备必须选择明确的mock-character、完成当前质检并另行登记训练用途；未知结果只核对原请求，接受/拒绝由人工确认，没有真实模型文件或真实服务就绪标识。外部提供商未配置时明确失败，不退回模拟成功。

任务固定输入及实际完成凭据不可覆盖。API不具备结果写入和worker完成执行权，worker不具备应用执行权，也不能直接读取原始工程/动作正文。两项并发容量、三次尝试和30秒租约落库；取消不提前释放仍在处理的占用。完成事务中断时，任务状态、凭据及审计一起回滚。角色降权、来源或用途变化使旧任务永久失效，恢复账号或素材不自动复活原任务。

应用先核对真实文件和当前工程，要求确认替换形象及关联声音；锁定轨拒绝，长声音需另行明确裁尾。所选区间内静音原片段，保留区间外前后部分；新资产、源关系、应用记录和工程新修订同事务提交。派生资产继承最短期限并继续检查原使用用途；制作文件支持受控下载及范围请求。素材回收预览增加形象目录、动作方案、固定任务和派生引用，引用变化后旧影响摘要不能提交。

## 实际运行的检查

- 33项新增专项与139项关联检查分次通过，共172个不同检查、9个文件。覆盖真实媒体、质量阻断、租户/空间/权限、同键重放、状态和租约、并发/重试、轨道保护、原子回滚、最短期限、来源撤回及素材库影响摘要。
- 类型检查、ESLint、应用构建、文档追溯和接口导出均有独立命令报告。
- 同一私有TLS PostgreSQL和同一76份编译应用完成9项功能检查、5个GUI流程。实际浏览器创建角色、完成质检、另授训练用途、核对未知模拟请求并人工接受；保存动作方案、解码播放实际MP4、确认应用、刷新与390px页面保持。只读账号不能管理，撤回后显示具体原因。
- 原动作文件 SHA256 ${media.motion.sha256}；实际HD导出为1920×1080 H.264/AAC、24fps、48帧，SHA256 ${media.export.sha256}。独立FFmpeg抽帧核对挥手、1.1秒张口与1.6秒闭口；固定嘴部区域暗像素198→72。导出中原1200毫秒纯音区间RMS为${media.audio.earlyRms.toFixed(6)}，计划后的静音尾段为0；未用此证明实时返听或物理播放。
- 实际强杀worker后，原任务 ${recovery.jobId} 保持输入摘要和创建时间，等原期限 ${recovery.originalLeaseUntil} 自然到期，在 ${recovery.recoveredAt} 恢复完成，次数1→2；没有手改期限、次数或清空租约。
- API及PG真正停止/重启后，角色、方案、任务、输入/结果和应用绑定的所列目录行保持，原文件及导出字节相同，私有两密钥相同。随后撤回独立使用用途，原动作文件、恢复任务文件、已应用资产和原导出均拒绝访问；已下载副本不能远程收回。

证据：[检查汇总](evidence/T20/postgres-character-production/backend-summary.json)、[编译应用](evidence/T20/postgres-character-production/compiled-summary.json)、[实际画面](evidence/T20/postgres-character-production/visual-review.json)。最终冻结清单位于 evidence/T20/postgres-character-production/verification.json。

## 迁移与观察修正

053 SHA256 74973ba4cc808f8ba283d2665cec3458cc792891476068ccda496002890b8cbb 首次成功应用后冻结。旧计划失效收尾曾读取worker未授权的工程列；追加054只返回版本原因，SHA256 d1c9a955b14ee0cf836345f82554f62378a8aff0979853b960a0f37aa2d61322，两类账号目录核对后冻结。当前PG001—054/runtime51，下一055；SQLite052，下一053。无旧SQL或主库改写。

首次初始化的注册集未同步、旧占位路由重复、复合类型接收格式、误用worker连接的权限测试及旧工程测试对已迁移审阅API的权限断言均有失败记录并已修正。初次编译观察误将HD当成720p；原浏览器流程和实际1080p文件已成功，不重做原创建/制作/应用。后续仅修正观察脚本，沿同一私有实例、同一编译和同一原件完成余下验证；旧报告、原输出及尝试均保留。

## 启动与复验

现有工作台仍在 http://127.0.0.1:5174，API4301；主33223未重启、未切库。新增原生能力运行在独立私有验证实例及回环端口。

先构建，再用尚未使用的标签保存报告：

~~~powershell
node scripts/build.mjs
node scripts/native-character-production-checks.mjs my-target target
node scripts/native-character-production-checks.mjs my-related related
node scripts/native-character-production-checks.mjs my-native-browser proof
~~~

浏览器复验会建立独立TLS数据库、角色和私有目录，启动两份编译API、worker及界面，最后关闭所拥有的进程与端口。以下续验入口仅用于浏览器流程已完成、尚未产生恢复验证任务且未撤回来源的媒体观察；只有同一实例、同一编译可沿原结果继续：

~~~powershell
node scripts/native-character-production-checks.mjs my-continued proof docs/evidence/T20/postgres-character-production/my-native-browser/proof.json
~~~

若已产生恢复验证任务或执行撤回，按报告中的原标识继续专项观察，不能从上述入口另建替代任务。

手动原生实例启动见[原生核心说明](62-postgres-native-core.md)：API和worker分别使用私有api.json与worker.json，DATABASE_DRIVER=postgres、POSTGRES_CORE_VALIDATION_ONLY=1、APP_ENV=development、PROVIDER_MODE=mock及未占用的回环端口。密钥只在私有服务器配置中使用。

## 能力边界与剩余条件

本轮只用原创虚构参数角色、合成图片和纯音；没有请求摄像头/麦克风，物理扬声器未验收。静态照片/原片参考不等于照片驱动，静态GLB参考不等于骨骼动画或模型运行时迁移；明确模拟准备不产生真实克隆。原动作是512×768的普通背景文件，本轮1080p导出不替代4K、透明背景、多人、真实声音/语气及第三方模型迁移的最终验收。

手机帮助文字仍偏小、偏浅，全界面视觉质量继续改进。预制动作24fps不等于直播24fps；上轮直播实测约17fps、持续音频、复杂网络与长期负载仍有独立待验项。生产身份/对象生命周期/备份恢复/正式部署和真实供应商、许可素材、账号、目标设备及业务系统仍分别接入。没有真实推流、发布、通知、广告花费、支付、门禁或公网部署。全部状态和门槛保持，不能以本轮模拟或本地素材验收替代G2。

${next}
`;
fs.writeFileSync('docs/94-postgres-character-production.md',doc);
file='scripts/build-docs.mjs';text=fs.readFileSync(file,'utf8');assert.ok(!text.includes('docs/94-postgres-character-production.md'));text=text.replace("'docs/93-postgres-live-return.md',",()=>"'docs/93-postgres-live-return.md', 'docs/94-postgres-character-production.md',");fs.writeFileSync(file,text);
console.log(JSON.stringify({result:'PASS',updated:['README.md','PLAN.md','docs/backlog.json','docs/06-decisions-and-dependencies.md','docs/94-postgres-character-production.md'],statusesAndGatesKept:true}));
