import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root='docs/evidence/T20/recovery',read=f=>JSON.parse(fs.readFileSync(f,'utf8')),proof=read(root+'/compiled-current/proof.json'),data=read(root+'/runtime/preservation-final.json'),b=read('docs/backlog.json');assert.equal(proof.result,'PASS');assert.equal(proof.checks.length,8);assert.equal(read(root+'/compiled-current/cleanup-audit.json').result,'PASS');assert.equal(read(root+'/runtime/main-restarted/checks.json').result,'PASS');assert.equal(data.result,'PASS');assert.equal(read(root+'/current-source-review.json').backend.passed,107);assert.ok(!fs.existsSync(root+'/delivery-state.json'));const task=b.tasks.find(t=>t.id==='T20');assert.equal(task.status,'in_progress');assert.equal(b.tasks.filter(t=>t.status==='verified').length,27);
task.evidence=[root+'/start.json','docs/60-encrypted-recovery.md',root+'/backend-final/results.json',root+'/current-source-review.json',root+'/compiled-current/proof.json',root+'/compiled-current/cleanup-audit.json',root+'/runtime/main-restarted/checks.json',root+'/runtime/preservation-final.json'];task.progressNote='T20/R-059工程增量已交付：当前SQLite和本地DATA_DIR的离线AES-256-GCM备份、独立回读验证、原绝对路径恢复、源/目标占用与维护锁及默认隔离。107项/10文件当前检查、构建/lint、当前编译8项/20个直接子进程及独立14所属进程归零通过；实际加密流强杀、双解锁竞争、256MiB/全部原表/两密钥恢复、旧cookie/业务回调阻断、worker拒绝启动均验证。主28906→47867/052，原20组/PPT/来宾/AE/练习只读保持；原300业务表3310行无变，仅4条已观测到期认证差异。完整T20仍in_progress：生产PostgreSQL/对象存储迁移、业务核对/正式恢复激活、生命周期/外部删除、身份/秘密管理、费用/告警/嵌入和部署验收继续；不把SQLite或隔离验证记作G2。';
const r=b.requirements.find(r=>r.id==='R-059');assert.equal(r.localStatus,'not_applicable');assert.equal(r.liveStatus,'in_progress');r.evidence=[...new Set([...r.evidence,'docs/60-encrypted-recovery.md',root+'/compiled-current/proof.json',root+'/backend-final/results.json'])];r.progressNote='当前SQLite/本地文件备份与同路径隔离恢复、故障/完整性/密钥/权限保护有实际证据。仅工程增量通过，生产PG/对象存储、真实秘密管理、备份后删除/授权/外部业务核对、正式激活与部署演练仍未完成，status/liveStatus保持in_progress，localStatus不改为已完成。';
for(const id of ['R-009','R-057']){const q=b.requirements.find(r=>r.id===id);q.evidence=[...new Set([...q.evidence,'docs/60-encrypted-recovery.md',root+'/compiled-current/proof.json'])];q.progressNote='T20/R-059新增独立备份密钥、认证密文和内容/迁移核验、有限只读验证API及不输出原内容/密钥的CLI诊断；当前本地证据不完成本需求的生产审计、密钥管理、真实回调或完整生命周期验收，原状态保持。';}fs.writeFileSync('docs/backlog.json',JSON.stringify(b,null,2)+'\n');
let readme=fs.readFileSync('README.md','utf8');const paragraph=readme.split('\n\n').find(p=>p.startsWith('本轮完成[T16全平台G1本地验收]'));assert.ok(paragraph);readme=readme.replace(paragraph,()=> '当前交付[T20/R-059加密备份与隔离恢复工具](docs/60-encrypted-recovery.md)：107项定向检查、当前编译8项实际故障与恢复检查通过，256MiB原文件/数据库/两密钥恢复及旧cookie/业务回调阻断已验。主47867/schema052，原数据与20组旧样例保持；T20、G2及整个目标继续，生产PostgreSQL/对象存储和正式恢复启用尚未完成。操作见[本地说明](docs/58-local-user-guide.md)。上一批[T16全平台G1本地验收](docs/59-g1-platform-acceptance.md)和27项本地verified保持，旧档案保留当时状态，最新结果以PLAN和backlog为准。');readme=readme.replace('| [本地版使用说明]',()=> '| [加密备份与隔离恢复](docs/60-encrypted-recovery.md) | T20/R-059命令、独立密钥、默认隔离、故障恢复证据和生产剩余条件 |\n| [本地版使用说明]');fs.writeFileSync('README.md',readme);
let builder=fs.readFileSync('scripts/build-docs.mjs','utf8');const n="'docs/59-g1-platform-acceptance.md'";assert.equal(builder.split(n).length,2);fs.writeFileSync('scripts/build-docs.mjs',builder.replace(n,()=>n+", 'docs/60-encrypted-recovery.md'"));
let guide=fs.readFileSync('docs/58-local-user-guide.md','utf8');const p="$env:PROVIDER_MODE='mock'";assert.equal(guide.split(p).length,2);fs.writeFileSync('docs/58-local-user-guide.md',guide.replace(p,()=>p+"\n$env:RECOVERY_VALIDATION_ONLY='0'"));
const plan=fs.readFileSync('PLAN.md','utf8'),at=plan.indexOf('## 上一批交付：T16');assert.ok(at>0);const header=`# DigitalGuide 当前执行计划

更新：2026-11-22
当前增量：T20/R-059加密备份与隔离恢复工程增量已交付，完整T20仍in_progress。G1已通过、27项本地任务verified保持；G2及整个平台目标继续，原134需求/38任务/65验收/26类不变。
当前目标：继续完成项目开发。主47867/schema052，原28906已实际终止、四进程/端口归零后按原数据/密钥/AE配置重启；无新SQL，后续053。上一目标轮分类progress。

## 当前交付：T20/R-059离线加密与隔离恢复

[运维命令和完整边界](docs/60-encrypted-recovery.md)、[当前证据](docs/evidence/T20/recovery)。Node内置AES-256-GCM、独立文件密钥、私有清单/文件名、源独占数据库快照、逐文件/全表/迁移与回读检查；非覆盖输出和恢复、目录/路径/联接限制，维护锁和死亡进程核对。短事务串行化并发解锁，只清理同编号临时密文及该操作目录，不删除源数据/正式备份。

恢复默认隔离：正式模式与worker拒绝启动，仅明确mock+development/sandbox+RECOVERY_VALIDATION_ONLY的API开放核心读取和新登录。每个验证API使用新内存cookie签名，旧cookie及上次验证进程cookie无效；业务GET、全部业务写入和公开回调403。原服务密钥字节保留，主正常实例默认不变。

当前107项/10文件通过（新增31项）；初次9项8通过/1字段预期错误，修正后29项通过，补充防护后本次107项通过。原类型/lint/空数组类型诊断及旧工程/缓存被误收集的中断记录保持；现在只发现正式tests/unit与tests/integration，当前10文件均在真实仓库tests下。构建/typecheck、lint实际通过，前端50份编译字节与G1相同。

当前编译8项、20个直接子进程关闭，独立观察14所属进程归零。正常API/worker20任务完成及三项待执行、真实API重启保留原登录；占用拒绝备份；密文流实际已有字节后SIGKILL；死亡进程检查、错编号拒绝、两个解锁进程仅一方成功。256MiB原件、全部原表/媒体和两密钥在原目录移开后实际恢复；旧cookie、live/production、worker及业务回调关闭，三项待执行不重放。第一次检查器把既有/profiles的201误期望200，原FAIL保留后按原契约完整复验。

主原练习/访谈初始与重启、开发/当前built各只读核对；PPT v1/v2、来宾、AE及20组旧样例保持。原301表3431行基线不换，300业务表3310行无变，仅4条已观测到期认证差异；原始FAIL和独立解释保留，未恢复过期会话。43旧状态、47模型/运行器/许可、41旧最终清单、原私有数据库/密钥和70旧编译备份的冻结结果见本批证据。

下一步继续T20：独立PostgreSQL迁移/事务与对象存储、生产身份/秘密管理/备份目标、完整删除传播、恢复后授权/删除/未决外部业务核对及正式激活、费用/限额/告警、品牌嵌入和部署验收；T35等可独立开发部分继续。该恢复格式仅当前SQLite/本地DATA_DIR及原绝对路径，不自动迁移外部目录、环境秘密或对象存储。R-059与T20保持in_progress，不标G2/平台或目标完成，不以一个账号缺失停工。

原降噪5/6、脚本事实/条件质量问题和真实克隆/目标声源/渠道/现场要求全部保持。主库未恢复或替换；无真实通知、开播、发布、投放、扣费、门禁、设备采集或公网部署。当前工具目标继续active。

`;fs.writeFileSync('PLAN.md',header+plan.slice(at));
const images=['runtime/main-restarted/practice-built/practice-desktop.png','runtime/main-restarted/practice-built/research-feedback-mobile.png'].map(f=>({file:root+'/'+f,sha256:createHash('sha256').update(fs.readFileSync(root+'/'+f)).digest('hex')}));fs.writeFileSync(root+'/visual-review.json',JSON.stringify({result:'SELECTED_EXISTING_MAIN_STATES_REVIEWED',checkedAt:new Date().toISOString(),images,scope:'Exact current desktop completion and mobile paused/private research states reviewed; no new web UI was introduced. All 50 compiled frontend files are byte-identical to G1.',noClaimOfAvatarOrVoiceClone:true},null,2)+'\n',{flag:'wx'});
fs.writeFileSync(root+'/delivery-state.json',JSON.stringify({result:'VERIFIED_FOUNDATION_RECORDED_FULL_T20_IN_PROGRESS',updatedAt:new Date().toISOString(),task:'T20',status:'in_progress',requirement:'R-059',requirementStatus:'in_progress',liveStatus:'in_progress',localStatus:'not_applicable',verifiedLocalTasks:27,mainHandle:'47867',wholeG1Completed:true,wholeT20Completed:false,wholeG2Completed:false,wholePlatformCompleted:false,goalComplete:false},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({result:'FOUNDATION_DELIVERED',taskStatus:'in_progress',verifiedLocalTasks:27,mainHandle:'47867'}));
