import fs from 'node:fs';
import assert from 'node:assert/strict';
const original=fs.readFileSync('scripts/native-recording-update-docs.mjs','utf8').match(/summary='([^']+)';/)[1];
const summary='2026-11-23 原生录制/提词快照、分片续传、独立原片/规范MP4、工程采用及撤回链已接通。667项/49文件完整关联回归通过，新增用例由24增至25；加强既有提交前回滚用例和新增独立会话并发各1项通过，共668个不同检查、669次通过执行，非单轮668全过。五次编译累计23个不同检查、25次通过执行及7个不同built流程；前三次中断及空目标400、并发分片503均保留。最后前端单行refetch及API写锁顺序分别修正；最终API专项验证分片/完成/取消各12并发全200且只变更一次，worker/媒体程序及50份当前前端不变。实际MediaRecorder相机/画中画混音/无声静态、IndexedDB、原片SHA、FHD/4K Alpha/开放包已验；四类提交前强杀和实际FFmpeg强杀、两个原90秒租约自然恢复通过。61直接/83观测/47Chrome关闭。029冻结，SQL局部字段错误以030追加修复，当前001—030/runtime27/下一031；SQLite052/下一053。原33223四进程不重启不切库，3316原行/3310业务行和两密钥保持，本批原认证移除0。134/38/65/26及27本地verified不变，真实设备/克隆/声纹/G2及全平台继续。';
for(const file of ['README.md','PLAN.md']){const s=fs.readFileSync(file,'utf8');assert.equal(s.split(original).length,2);fs.writeFileSync(file,s.replace(original,summary));}
const backlog=JSON.parse(fs.readFileSync('docs/backlog.json','utf8'));let count=0;for(const table of ['tasks','requirements'])for(const r of backlog[table])if(r.progressNote?.includes(original)){r.progressNote=r.progressNote.replace(original,summary);count++;}assert.equal(count,9);fs.writeFileSync('docs/backlog.json',JSON.stringify(backlog,null,2)+'\n');
const file='docs/78-postgres-recordings.md';let s=fs.readFileSync(file,'utf8');
s=s.replace('本轮还修复了新建录像工程成功后对空目标工程地址的多余请求。','并发复核还发现同一账号两个独立会话续传同一分片时会有503：预检先取共享锁，随后同时升级写锁导致冲突。变更接口现在先按统一顺序取得工作空间排他锁与当前传输，再复验来源和幂等记录；分片、完成与取消共用此顺序，没有跳过来源验证。修正前FAIL保留，构建后的两个实际HTTP API分别以两个独立会话，对三类操作各提交12次同键请求，均200且只登记/转移一次。\n\n本轮还修复了新建录像工程成功后对空目标工程地址的多余请求。');
s=s.replace('| [后台汇总](evidence/T20/postgres-recordings/backend-summary.json) | 667项/49文件完整关联回归通过，新增24项原生用例。最后加强既有回滚用例，另定向1项通过，合计668次通过执行；不同用例数仍667。原录制测试在加强前已结束，旧源码按精确SHA留存。 |','| [后台汇总](evidence/T20/postgres-recordings/backend-summary-final.json) | 完整667项/49文件通过，随后既有回滚用例加强与新增独立会话并发各1项通过，合计668个不同检查、669次通过执行，新增25项原生用例。完整回归绑定修复前源码；加强用例的24项源码由当前文件重建并按原命令SHA精确核对，未冒充当时保存的快照。 |');
s=s.replace('| [编译运行汇总](evidence/T20/postgres-recordings/compiled-summary.json) | 四次运行累计15个不同检查、16次通过执行，7个不同浏览器流程通过。前三次整体FAIL分别涉及脚本初始化、只读控件定位及多余400请求、FFmpeg时间字面量；最终使用保留的同一批成片补验通过，不重录或重编码这些成片。 |','| [编译运行汇总](evidence/T20/postgres-recordings/compiled-summary-final.json) | 五次运行累计23个不同检查、25次通过执行，7个不同浏览器流程通过。前三次整体FAIL涉及脚本初始化、只读控件定位及多余400请求、FFmpeg时间字面量；成片补验复用原文件。最后用新的隔离实例专项验证当前API并发锁顺序及原片转换/采用/撤回，复用原浏览器WebM，没有重跑90秒中断或4K成片。 |');
s=s.replace('| 源码与编译 | 服务端、视频检查及渲染二进制在四次编译验证中相同。后期只修正一行前端refetch；50份前端文件按具体产物文件名归一比较后，仅StudioPage有功能差异，其余49份是相同内容或文件名引用传播。 |','| 源码与编译 | 最后类型检查、lint与构建均通过。前四次服务端/媒体二进制相同，最后API写锁修复另有实际HTTP证据；worker、视频检查、渲染及50份当前前端均未变化。对比上批的前端，仅StudioPage一行refetch有功能差异，其余49份按具体文件名归一后相同。 |');
s=s.replace('50直接子进程、79独立观测进程、47个Chrome均关闭','61直接子进程、83独立观测进程、47个Chrome均关闭');
s=s.replace('编译界面使用当前前端私有副本；原前端和前三次失败图、日志均保留。','编译界面使用当前前端私有副本；原前端和前三次失败图、日志、并发503回归FAIL均保留。前期和最终API使用各自构建文件及精确源码摘要绑定。');
assert.ok(!s.includes('668次通过执行'));assert.ok(s.includes('compiled-summary-final.json'));fs.writeFileSync(file,s);
for(const[file,needle,addition]of [
 ['docs/02-architecture.md','录制输入/历史/原片/规范输出/封面和一次完成审计均持久化。','变更传输先取工作空间排他锁和当前传输行，再做来源及幂等预检，避免独立会话先共享后升级写锁冲突。'],
 ['docs/23-content-workbench.md','新建工程后不再刷新空目标地址。','独立会话同键并发续传、完成和取消分别12请求验证，全成功且每项状态只变更一次。']
]){const text=fs.readFileSync(file,'utf8');assert.ok(text.includes(needle));assert.ok(!text.includes(addition));fs.writeFileSync(file,text.replace(needle,needle+addition));}
console.log(JSON.stringify({result:'PASS',updatedProgressNotes:count,scopeUnchanged:true}));
