import fs from 'node:fs';
import assert from 'node:assert/strict';
const folder='docs/evidence/T25/ae-adoption',read=f=>JSON.parse(fs.readFileSync(f,'utf8')),write=(f,s)=>fs.writeFileSync(f,s),b=read('docs/backlog.json'),proof=read(folder+'/compiled-final/proof.json'),audit=read(folder+'/compiled-final/cleanup-audit.json'),ae=read(folder+'/backend-ae-release.json'),related=read(folder+'/backend-final.json');
assert.equal(proof.result,'PASS');assert.equal(audit.result,'PASS');assert.equal(ae.numPassedTests,13);assert.equal(related.numPassedTests,89);assert.equal(b.tasks.filter(t=>t.status==='verified').length,22);
const note='049 AE成片采用：固定来源和独立用途、MP4/透明MOV实际完整解码/原件入库，唯一独立多轨工程、透明叠加轨/画布、直接来源治理事实，接入原审核/标识/分享及来源撤回。相关89项/8文件与当前13项专项复验，跨运行90个不同后端用例；当前同次Chrome4项。最终编译8项/9根进程，实际599秒FHD解码中分别强杀helper和worker、原30秒自然恢复同任务attempt3、实际取消/目录撤销/重启/built实播和390px，独立41所属进程归零。长视频源结果为明确注入的契约夹具，不证明AE渲染；普通短片与主实例亦为原创契约引擎/假AEP，非Adobe、真人或克隆。主58108/048→89966/049→40842，初始及重启各5项运行/5项开发浏览器、当前built5项通过，同一25735字节MP4与工程v1保持。原38状态、47模型/运行器/许可、原AE源ZIP及22份早期最终清单保持；原284业务表3121行无变化，全表原始FAIL仅55条已观测到期认证删除，私有备份/密钥/原基线保持。049冻结/后续050。完整T25/真实Adobe/资产迁移及全平台G1/G2仍进行中，134需求/38任务/65验收/26类和22项verified不变。';
const evidence=['docs/52-ae-media-adoption.md',folder+'/verification.json'];
for(const r of b.requirements.filter(r=>['R-081','R-082','R-121'].includes(r.id))){r.status='in_progress';r.localStatus='in_progress';r.evidence=[...new Set([...r.evidence,...evidence])];r.progressNote=note+' '+r.progressNote;}
const t=b.tasks.find(t=>t.id==='T25');t.status='in_progress';t.evidence=[...new Set([...t.evidence,...evidence])];t.progressNote=note+' '+t.progressNote.replace(/^049增量开发中：[\s\S]*?此前证据及完整T25\/真实Adobe与G1\/G2剩余要求保持。 /,'');
write('docs/backlog.json',JSON.stringify(b,null,2)+'\n');
let p=fs.readFileSync('PLAN.md','utf8'),oldMarker='## 当前交付：T24 本机神经人声降噪';assert.ok(p.includes(oldMarker));p=p.slice(p.indexOf(oldMarker)).replace(oldMarker,'## 上一批交付：T24 本机神经人声降噪');
const head=`# DigitalGuide 当前执行计划

更新：2026-11-22
当前增量：T25/R-081/R-082/R-121 AE成片进入独立多轨、审核与传播，声明本地范围已验证。相关89项/8文件与当前13项专项复验，跨运行90个不同后端用例；最终同次Chrome4项；当前编译8项/9根进程，独立41所属进程退出。主58108/048→89966/049→40842，运行/开发/built各5项；049已应用冻结，下一050。
当前目标：持续完成统一数字人平台开发；T24内容智能加工、T25媒体协作/高级模板及T28完整直播继续进行。完整134需求/38任务/65验收、26类与22项verified保持，G1/G2未完成。
本轮起始：上一批1333份源码摘要、22份早期最终清单一致，285表3418行原快照、私有数据库/两类密钥与原编译产物备份保存。收尾原284业务表3121行无改变；全表原始FAIL为55条已观测到期认证删除，原报告和独立解释保持。38份旧状态、47模型/工具/许可与原AE源ZIP保持。

## 当前交付：T25 AE成片采用与继续制作

[操作、启动与边界](docs/52-ae-media-adoption.md)，[本批证据](${folder}/verification.json)。固定原批次/条目/清单/参数/素材摘要与独立用途，实际MP4/MOV完整解码及原件入库、一次独立工程。透明素材保留Alpha画布和叠加轨，实际重导验证透明/半透明像素；入库原件字节不变，不还原AE图层或供应商模型。直接采用的素材在治理私有事实中保留AE执行模式和来源摘要，公开回执不泄漏内部编号或说明。

独立持久队列、控制代次、30秒租约/最多三次尝试、新建与重试三项限额、幂等和永久撤回生效。Windows原生Job Object在挂起启动时纳管Node与FFmpeg，实际强杀检查器和worker后无所属原生残留，同任务自然恢复attempt3；实际599秒FHD/双声道原件、取消/撤销目录、双API/worker重启、当前built播放/尾部定位/390px和撤回通过。长视频原AE结果为明确注入的契约夹具，只证明新采用生命周期，不是AE运行时验收。

[原主AE批次](http://127.0.0.1:5174/studio/ae/9a7cd481-da6b-4cc9-bd82-1a3b33626a77)第一项已采用至[独立工程v1](http://127.0.0.1:5174/studio/projects/8aceeab1-3f1c-4b9f-a854-cec85dafd865)。实际25735字节/1秒FHD/双声道，SHA 7019cb2e004f36ac588261b8e361ae72f39bb2ddd264c3c6dbac8cb1b630b35c；原批次响应/文件不改，刷新和实际重启后同一采用及工程保持。开发与当前built只读播放、完整SHA/绿色像素、390px、零设备采集/业务写入/页面和API错误通过。

首轮后端9通过；扩展后两次11通过/1项测试预期失败，实际接口返回不可执行计划而非HTTP409、下游使用通用来源失效文字。按原协议校验拒绝状态并补验旧计划执行409，没有放宽来源、文件、权限、取消或幂等断言。另有测试变量重名的0用例转换错误、跨文件重复登记夹具造成浏览器3通过/1失败、lint/typecheck与模型大小字段诊断失败；原始记录保留，修正后专项13项/同次Chrome4项及最终编译通过。旧编译first版本证明保留，补重试限额后重新构建并完整复验final。

边界：原创假AEP和契约短片不证明Adobe、真人/声音/语气克隆、字体/插件、MOGRT/DGR或模型迁移。实际AE/素材许可、现场目标声源/低延迟、真实渠道/设备、全部直播/接待/餐厅等要求仍在原任务中继续。上一批神经降噪有限质量5/6、弱噪声FAIL及目标声源尚未验收等限制保持。

下一步从当前源码、状态和证据续跑T24/T25/T28与G1/G2；完成可独立推进的本地衔接，真实条件按具体授权素材、凭证和设备逐项接入。保持原竞品并集及任务依赖，不将本批采用工程提升为完整T25或平台完成。

`;
write('PLAN.md',head+p);
let readme=fs.readFileSync('README.md','utf8');const from=readme.indexOf('本轮新增：'),to=readme.indexOf('\n\n需要一份',from);assert.ok(from>0&&to>from);readme=readme.slice(0,from)+'本轮新增：[AE成片采用与继续制作](docs/52-ae-media-adoption.md)：MP4/透明MOV入库为独立多轨工程，接入原审核、AI标识与分享，继承来源和永久撤回。当前主40842/schema049，仅回环4301/5174；本地契约示例可直接播放，非Adobe或克隆验收。上一批[神经人声降噪](docs/51-neural-denoising.md)的有限合成质量5/6及弱噪声FAIL保持；[AE源工程导出](docs/50-ae-source-exports.md)、全部竞品并集与完整G1/G2继续。'+readme.slice(to);write('README.md',readme);
fs.appendFileSync('docs/02-architecture.md','\n\n## 049 AE成片采用与来源继承\n\n[成片采用](52-ae-media-adoption.md)复用实际视频检查器与Studio/治理，独立持久任务在单事务建立原件、检查帧/透明代理、来源和工程v1。Repository的素材入口同步校验当前目录清单及固定来源，异步计划/worker校验真实文件；新建与重试共用组织/环境限额。Windows私有Job Object挂起纳管Node及FFmpeg，父worker/检查器/看护退出或取消关闭整树；编译使用独立collection-native入口。049应用后冻结，后续050。契约来源与真实AE模式保持，未验收完整Adobe/模型或所有渠道；历史来源与旧API格式不补写默认字段。\n');
fs.appendFileSync('docs/03-data-api.md','\n\n## 049 AE成片采用\n\nae_media_adoptions与ae_media_attempts保存固定产物、清单/参数/替换素材来源及独立用途、控制代次、阶段/进度、原30秒租约、三次尝试和唯一素材/工程。固定输入、已保存结果和永久撤回由SQL约束。/studio/ae-artifacts/:id/media-plan|media-adoptions|media-adoption与/studio/ae-media-adoptions/:id及cancel|retry|withdraw均按当前身份/环境/空间校验，输入/输出见[专项](52-ae-media-adoption.md)及生成OpenAPI。直接采用资产的治理私有事实可包含advancedTemplateSources，旧事实不增加默认字段，公开回执结构不变。049冻结，后续050。\n');
fs.appendFileSync('docs/04-roadmap-acceptance.md','\n\n## T25 AE成片继续制作子模块（2026-11-22）\n\nR-081/R-082/R-121新增固定来源与独立用途、实际MP4/MOV入库及唯一多轨工程、透明叠加轨/画布、后续审核/标识/分享与来源撤回。相关89项/8文件及最终13项专项复验，跨运行90个不同后端用例；同次Chrome4项，最终编译8项/9根进程，独立41所属进程退出。599秒长片源记录为明确注入的契约夹具，只证明新采用队列及生命周期；普通短片为原创假AEP契约引擎，也不计AC-38的合法Adobe渲染。此批不替代原20项批量或4K证据。\n\n主40842/schema049，原主批次第一项与独立工程v1、实际25735字节FHD原件重启保持；原284业务表3121行无变化，全表原始FAIL仅55条已观测到期认证删除。完整T25、AC-38/AC-57及G1/G2不标完成，134/38/65、26类和22项本地verified保持。[使用与边界](52-ae-media-adoption.md)，[最终证据](evidence/T25/ae-adoption/verification.json)。\n');
let build=fs.readFileSync('scripts/build-docs.mjs','utf8');assert.ok(build.includes("'docs/51-neural-denoising.md'"));build=build.replace("'docs/51-neural-denoising.md'","'docs/51-neural-denoising.md', 'docs/52-ae-media-adoption.md'");write('scripts/build-docs.mjs',build);
fs.writeFileSync(folder+'/verification.json',JSON.stringify({result:'PREPARING_FINAL_EVIDENCE',wholeTaskOrPlatformCompleted:false},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({result:'DOCS_UPDATED',requirements:b.requirements.length,tasks:b.tasks.length,verifiedTasks:22,wholeTaskOrPlatformCompleted:false}));
