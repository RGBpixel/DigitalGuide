import fs from 'node:fs';
import assert from 'node:assert/strict';
const root='docs/evidence/T16/g1',read=f=>JSON.parse(fs.readFileSync(f,'utf8')),review=read(root+'/review.json'),b=read('docs/backlog.json'),task=b.tasks.find(t=>t.id==='T16'),dir=root+'/status-before';assert.equal(review.result,'PASS_ALL_58_G1_SCOPED_ACCEPTANCE');assert.equal(task.status,'in_progress');assert.equal(b.tasks.filter(t=>t.status==='verified').length,26);assert.ok(!fs.existsSync(root+'/status-update.json'));fs.mkdirSync(dir,{recursive:true});for(const f of ['PLAN.md','README.md','docs/backlog.json','docs/58-local-user-guide.md','scripts/build-docs.mjs'])fs.copyFileSync(f,dir+'/'+f.replaceAll('/','__'),fs.constants.COPYFILE_EXCL);
task.status='verified';task.verificationScope='G1_local_task';task.evidence=['docs/58-local-user-guide.md','docs/59-g1-platform-acceptance.md',root+'/review.json',root+'/browser-review.json',root+'/clean-current/proof.json',root+'/recovery-first/proof.json',root+'/compiled-current/proof.json',root+'/compiled-current/cleanup-audit.json',root+'/runtime/main-restarted/checks.json',root+'/runtime/preservation-final.json'];task.progressNote='原65条中58条适用G1已逐项审核，完整1079项/133文件及新增财务幂等2项通过；146条不同Chrome流程经完整首轮和定向复验有当前通过证据，原失败保留，不声称同轮全过。干净安装9项、独立恢复5项、当前编译9项/8根进程及独立22所属进程归零通过；20任务双API幂等、实际API/worker强杀及原10秒租约自然恢复，无时钟或租约造假。主48214→28906/052，原20组样例、PPT/练习/来宾/AE只读保持；原300业务表3310行无变，15条到期认证差异有原FAIL及独立说明。134需求/38任务/65验收/26类完整保留；全部G2及模型质量失败、真实克隆/目标声源/渠道/生产任务继续。';
for(const id of ['R-061','R-064','R-126']){const r=b.requirements.find(r=>r.id===id);assert.equal(r.status,'in_progress');r.localStatus='verified';r.evidence=[...new Set([...r.evidence,'docs/59-g1-platform-acceptance.md',root+'/review.json'])];r.progressNote=id==='R-061'?'58条G1适用验收、146不同Chrome流程及各场景现有路径有当前通过证据，中文总览九类入口、错误/权限/加载流程已核对。仅localStatus完成；AC-29/30的真实部分及T21仍未完成，整体status保持in_progress。':id==='R-064'?'G1匿名终端、默认关闭识别、明确模拟事件/合成设备及控制/权限路径核对通过；人脸或声纹候选不授予身份。真实终端及T18/T38仍未验收，liveStatus与整体status保持。':'本地素材期限录入、7天内提醒、到期入口停用，以及两个当前API自然2秒到期前后完整字节/ASSET_EXPIRED已验证；现有权益/用途检查继续执行。仅localStatus完成，真实租赁、克隆定制、购买/续费/外部通知及供应商权益仍由T17验收，不自动扣费。';}
assert.equal(b.tasks.filter(t=>t.status==='verified').length,27);assert.equal(b.requirements.length,134);assert.equal(b.tasks.length,38);b.updatedAt='2026-11-22';fs.writeFileSync('docs/backlog.json',JSON.stringify(b,null,2)+'\n');
let guide=fs.readFileSync('docs/58-local-user-guide.md','utf8');const old='T16整体验收正在执行，完整G1、G2和生产试点尚未通过。';assert.ok(guide.includes(old));guide=guide.replace(old,()=> 'T16完成全部58条适用G1的本地验收，G2和生产试点尚未完成，结果见[全平台本地验收](59-g1-platform-acceptance.md)。');fs.writeFileSync('docs/58-local-user-guide.md',guide);
let builder=fs.readFileSync('scripts/build-docs.mjs','utf8'),needle="'docs/58-local-user-guide.md'";assert.equal(builder.split(needle).length,2);builder=builder.replace(needle,()=>needle+", 'docs/59-g1-platform-acceptance.md'");fs.writeFileSync('scripts/build-docs.mjs',builder);
let readme=fs.readFileSync('README.md','utf8').replaceAll('\r\n','\n');readme=readme.replace(/^设计基线：.*$/m,()=> '设计基线：1.2｜应用：0.1.0｜2026-11-22｜T01—T16及T22—T30/T36/T37共27项本地任务已验证，G1本地验收通过，G2与平台继续建设。');const paragraph=readme.split('\n\n').find(p=>p.startsWith('本轮推进T16完整G1验收'));assert.ok(paragraph);readme=readme.replace(paragraph,()=> '本轮完成[T16全平台G1本地验收](docs/59-g1-platform-acceptance.md)：58条适用条款、134需求逐项审核；1081项后端与146条不同Chrome路径有通过证据，原失败和定向修复记录保留。新增总览正确路由、素材有效期提醒及播音状态竞争修复，干净安装、独立恢复、实际强杀/重启和自然到期检查通过。主28906/schema052、原300业务表3310行及旧样例保持；全部G2、真实克隆/目标声源/渠道/生产与模型质量失败继续。操作见[本地使用说明](docs/58-local-user-guide.md)，旧批次档案保留当时状态，最新结果以PLAN和backlog为准。');readme=readme.replace('有效期和模拟/真实边界；T16正在验收','有效期和模拟/真实边界；T16本地验收通过');readme=readme.replace('| [角色练习与调研访谈]',()=> '| [全平台G1本地验收](docs/59-g1-platform-acceptance.md) | 58条适用条款、134需求、当前检查、原失败与G2剩余条件 |\n| [角色练习与调研访谈]');fs.writeFileSync('README.md',readme);
const plan=fs.readFileSync('PLAN.md','utf8'),anchor='## 当前交付：T30独立角色练习与调研访谈',at=plan.indexOf(anchor);assert.ok(at>0);
const header=`# DigitalGuide 当前执行计划

更新：2026-11-22
当前增量：T16完成G1全平台本地验收，27项本地任务verified；58条适用G1通过，7条仅G2尚未验收。134需求/38任务/65验收/26类保持，91项需求仍有关联最终任务，不批量提升整体需求或真实状态。
当前目标：继续完成统一数字人平台开发。主28906/schema052，后续053。下一步T20生产治理/恢复基础设施及T35企业运营等无外部交易依赖的工程工作；真实条件按T17/T18/T19/T31—T35/T38继续，T21未完成，工具目标active。

## 当前交付：T16全平台G1本地验收

[使用说明](docs/58-local-user-guide.md)、[全平台验收与剩余条件](docs/59-g1-platform-acceptance.md)、[58原条款与134需求](docs/evidence/T16/g1/review.json)、[本轮证据](docs/evidence/T16/g1)。九类总览实际入口、素材期限录入/7天提醒/到期入口限制、分页加载提示及直播播音读回前继续竞争修复；紧急停止仍可用，服务端权限和版本检查保持。

完整1079项/133文件及新财务幂等2项通过，共1081项/134文件；550份API/worker/packages/迁移源码不变。146条不同Chrome路径有当前通过证据；原完整145项133通过/12失败、定向16项11通过/5失败、后6项5通过/1失败、最后播音1项通过，所有原失败/修复前源码和夹具说明保留，不声称同轮全过。

独立干净源目录锁定离线安装、从零建库和构建、实际服务重启20任务保持9项通过；新建虚构库备份/恢复301表259行、两密钥/4媒体及实际built桌面/390px5项通过。300次三类实际GET、10并发，在所录条件p95约5.05ms，不代表写入/模型/现场/生产延迟。订单和支付各百次重复/乱序检查仅隔离mock，无真实收费。

当前编译9项/8根进程、独立22所属进程归零；双API20任务去重、实际API强杀、执行中worker强杀、原10秒租约自然恢复与完整重启、用量各一次。素材自然两秒到期后两个API均409，未改时钟/租约。首次比较器漏算本次素材应有索引的原FAIL/源码保留，补验原8条索引不变且只新增本次family/revision后完整复验通过。

主48214实际退出，原四进程/4301和5174归零后28906启动；原练习/访谈、PPT v1/v2、来宾节目、AE和20组旧样例只读保持。原301表3414行基线不换，300业务表3310行无变，仅15条已观测到期认证差异；原始行比较FAIL及单独解释保留，未恢复过期认证。052原SHA保持，无新SQL，后续053；43状态、47模型/运行器/许可、40旧最终清单及70旧编译私有备份最后冻结审核中。

原降噪5/6、弱噪声+0.71468dB<3dB、脚本事实/条件/归属问题保持；人工修订不是模型自动批准。系统WAV/二维角色/AE契约/合成设备不代表克隆、真人驱动、Adobe、目标声源/回声/物理或公网质量。所有G2及生产身份/数据库/删除/恢复、渠道、LMS/POS/通知/支付和企业运营继续。未购买、开播、发布、投放、扣费、采集主终端或上线公网。

下一步：完成本批文档与源文件冻结清单的独立复核后，按原依赖推进T20/T35及可独立开发的真实适配层；不因单一账号缺失停工，不把waiting_external标完成，不缩减任何最终功能。原批次档案如下。

`;
fs.writeFileSync('PLAN.md',header+plan.slice(at));fs.writeFileSync(root+'/status-update.json',JSON.stringify({result:'EXECUTED_G1_SCOPE_STATE_RECORDED_FINAL_FILE_AUDIT_PENDING',updatedAt:new Date().toISOString(),task:'T16',taskStatus:'verified',taskVerificationScope:'G1_local_task',verifiedLocalTasks:27,onlyLocalRequirementFlagsChanged:['R-061','R-064','R-126'],overallRequirementsOrRealStatusesPromoted:false,g2OrWholePlatformOrGoalCompleted:false},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({result:'G1_SCOPE_STATE_RECORDED',verifiedLocalTasks:27,finalDocumentationAndHashAuditPending:true}));
