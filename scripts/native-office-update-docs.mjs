import fs from 'node:fs';
import assert from 'node:assert/strict';
const root='docs/evidence/T20/postgres-office',read=f=>JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,'')),save=(n,v)=>fs.writeFileSync(root+'/'+n,JSON.stringify(v,null,2)+'\n',{flag:'wx'});
const backend=read(root+'/backend-summary.json'),compiled=read(root+'/compiled-summary.json'),closure=read(root+'/runtime/final-pg-closure.json');for(const value of [backend,compiled,closure,read(root+'/runtime/preservation-final.json'),read(root+'/runtime/operating-delivery.json')])assert.equal(value.result,'PASS');
const note='2026-11-24 原生员工口信、会议日历与提醒完成本地增量：草稿/版本确认、定时转达、本人读取/确认、会议回应/改期/取消、最小目录、私密来源守卫、保留期与持久投递接通。103个不同检查/7文件分次通过，32项新增；同一私有实例及相同76份编译累计10项检查、6个GUI流程通过。实际API提交中强杀后完整回滚，双API原键8次恢复只提交一份；模拟回执先持久化后worker强杀，同通知等原15秒租约自然到期，以第二次尝试查询唯一回执，不重发。11类办公室记录/两密钥重启一致；离开再加入不复活原通知。全部失败保留，未重置次数、期限或时钟。13个私有PG集群关闭；主33223原四进程、301表3318原行/3310业务行、两密钥与AE保持。PG001—058/runtime55冻结/下一059，SQLite052/下一053；134/38/65/26与27项本地verified及全部门槛状态保持，T20/G2与完整平台继续。';
const doc=`# 原生员工口信、会议日历与提醒

状态：完成本地增量；T20/G2与完整平台继续。2026-11-24。本轮按T20/R-058迁移既有T07/R-043、R-044/AC-09，没有新增未编号功能，也不改变134项需求、38项任务与全部最终场景。

${note}

## 已实现的行为

口信保留草稿、修改、版本核对后确认转达、实际定时、撤回与到期、收件人本人标记已读及本人确认。发信人可以看回执，管理员没有代读、代确认其他人私信的权限。local确实写入本地收件箱；mock明确表示模拟适配器接受，不能据此声称外部送达、本人已读或本人确认。失败、结果未知与本地可见状态分别保存；未配置真实渠道不会静默退回模拟成功。

会议保留本地创建、IANA时区/UTC时刻、当前成员选择、提前提醒、本人参与回应、组织者改期/取消。回应只推进对象版本，不改变内容修订；改期更换修订、重置参与回应、撤销旧提醒并建立当前提醒。移除参与者仅给仍有空间权限的原参与者通用提示，不泄露新题目、地点和安排。参会人离开空间后仍能取消会议，只通知当前有效参与者。会议结束保留历史记录，结束30天后清理题目、说明和地点；口信撤回/到期清理正文。

成员目录只给有office.write权限的当前空间成员使用，仅返回账号标识和名字。公共接待提示必须登录且只显示有待查看消息，不含正文、姓名或会议详情。权限来自登录账号/成员关系，人脸、声纹候选和普通Person记录不会获得员工操作权限。

## 持久化、最小权限与恢复

API与worker均已注册到独立原生运行应用。来源、当前参与者、来源摘要、提醒队列在同一事务提交；数据库最终约束拒绝半份会议或缺少来源凭据的通知。正文仅在当前私有来源保存，历史来源仅存内容哈希和账号范围。审计、outbox、幂等响应、模拟回执与普通日志不保存私信正文；幂等缓存只保存资源标识，回放取得当前元数据。

worker没有原始办公室正文表SELECT权限，仅在有效租约内获得必要投影，local的request为null。mock才获得当前必要请求。每租户一个独立物理投递槽位、原15秒逻辑租约与三次累计尝试持久保存。取消不在适配器实际退出前释放物理槽位；未知/中断投递先查询原模拟回执，不自动重发。查不到回执保存unknown。受控完成函数不能伪造mock已接受；仅存请求摘要和明确mock引用的回执必须实际存在。

成员/空间、来源、通知按一致顺序加锁。创建人的写权限或空间失效后永久撤销旧来源；收件人离开空间仅使自己的旧通知和参与守卫失效。重新加入不会复活原通知，组织者明确新修订可以重新邀请。来源失效后正文投影及业务动作均阻断。

## 实际验证与保留的失败

backend-summary.json记录103个不同检查、7个文件，含32项新增办公室专项，属于分次通过证据。已运行类型检查、lint、构建、原生目录/角色初始化、业务与投递测试、实际定时/到期、原15秒租约自然恢复和连续三次累计恢复、原办公室及原生运行/锁回归。未修改租约、次数、期限或数据库时钟。

30天保留期使用明确历史夹具：独立测试事务中只临时跳过来源时间/角色行守卫，完成摘要/关联约束并恢复触发器后提交；实际清理由运行角色在全部守卫启用时执行。这是历史条件契约检查，不声称已真实等待30天。首次角色受限及随后未清空延迟触发器队列的夹具失败均保留，定向修正后通过。

通知读取申请行锁与最小授权冲突，已在TS读取路径修正，未扩大API通知表写权限；参会人离开后取消失败也已定向修正复验。058初次应用前的语法错误、专项失败、脚本未使用导入、四次编译观察失败均保留。前四次编译观察未完成业务动作，涉及错误锁屏障、观察角色看不到其他角色等待、续验声明位置和resume禁止bootstrap观察。最终使用各运行角色观察自己的等待，在同一原实例/相同76份编译沿原输入和原幂等键继续；不重建成功业务或延长期限。

compiled-summary.json记录10种编译检查、6个GUI流程。实际编译API在来源与参与者已暂存、来源摘要提交前强杀，整个事务回滚；双API沿原键8次请求仅提交一份会议。两个独立浏览器账号完成口信确认转达、本人读/确认、撤回、会议回应/修改/取消、390px页面与重启后原状态核对。模拟回执实际持久化后，私有故障屏障阻止最后完成，强杀原worker；原通知等待原租约自然到期，尝试1→2，查回唯一回执，原创建时间与请求摘要保持。API/PG重启后11类办公室记录与两密钥逐项一致。

本轮13个私有PG集群已经关闭，清理按PID及创建时间核对。主工作台保持33223原四进程、301表3318原行/3310业务行、两密钥与AE。早期主数据报告的PG版本说明沿用了上一批，已保留原报告并在preservation-final.json只读复核为058/下一059，主SQLite数据始终未切换。

## 启动与复现

原[本机工作台](http://127.0.0.1:5174/office)继续运行，入口为“消息与日历”。本批没有重启或切换主工作台；新增原生实现已在隔离实例验完，所有私有验证服务已关闭。

原生手动启动使用[原生运行指南](62-postgres-native-core.md)的独立配置。完整编译验证可运行下列命令；标签须未使用，驱动创建独立本地PG/TLS角色和编译副本，结束时关闭自己启动的服务。本机需已有依赖、经过校验的PG程序与既有模型文件，密钥不写入报告。

~~~powershell
& 'C:\\Program Files\\nodejs\\node.exe' scripts/native-office-checks.mjs unique-label proof
~~~

编译驱动的resume只用于前述未成功业务动作的观察失败，必须保留原实例、输入与幂等键。成功业务之后按已保存ID做剩余只读核对，不重跑原流程。

## 冻结版本、模拟与真实边界

PG058在2026-11-24T04:14:10.027Z首次成功应用后冻结，SHA256为bd88bccb1021de1cdd51ad21fea4685f010136a17f96502a676868cf31b02549。PG001—058/runtime55，下一059；SQLite052/下一053。来源快照和运行证据在evidence/T20/postgres-office，主库不参与原生验证。

local是实际本地持久收件，mock是明确模拟投递；本轮没有发送真实短信、邮件、企业IM或桌面通知，也未同步外部日历。后续真实企业身份、通知渠道和日历需账号、接口、回调契约及具体业务授权。人员记忆、访客接待、数字人现场播报、批量团队、发布投放和展厅/前台/餐厅业务继续推进。真人形象/声音/语气克隆、实时目标说话人/声纹、现场设备、POS/支付等仍分别接入验收；R-015小字/浅色帮助、R-094实时24fps/持续音频/复杂网络/长期负载保持未验。全部最终要求保留，本轮不宣称全平台或G2完成。
`;
fs.writeFileSync('docs/96-postgres-office.md',doc);
const p='PLAN.md',plan=fs.readFileSync(p,'utf8'),a=plan.indexOf('## 正在执行：原生员工口信、会议日历与提醒'),b=plan.indexOf('## 上一批交付：',a);assert.ok(a>=0&&b>a);const header=plan.slice(0,a).replace('当前增量：96，T20原生员工口信、会议日历与提醒，in_progress','当前增量：96，T20原生员工口信、会议日历与提醒，完成本地增量');fs.writeFileSync(p,header+'## 本批交付：原生员工口信、会议日历与提醒\n\n[实现、检查、启动与边界](docs/96-postgres-office.md)、[本批证据](docs/evidence/T20/postgres-office)。'+note+'\n\n下一步继续原生人员/记忆、来访与接待业务动作，以及批量团队、发布投放、其余展厅/前台/餐厅、生产身份与对象存储等完整范围。真实克隆、实时目标说话人、设备、企业通知/日历与业务系统分别接入验收；不缩减既有功能。\n\n'+plan.slice(b));
const r='README.md',text=fs.readFileSync(r,'utf8'),end=text.indexOf('\n');fs.writeFileSync(r,text.slice(0,end+1)+'\n[原生员工口信、会议与提醒](docs/96-postgres-office.md)：版本确认、本人回执、会议回应/改期/取消、定时与持久投递已接通；103项检查分次通过，原通知自然恢复、11类记录重启一致和6个GUI流程已验。主工作台保持，真实企业通知/外部日历及完整平台继续。\n\n上一批交付：\n'+text.slice(end+1));
const backlog=read('docs/backlog.json'),before=backlog.tasks.map(t=>[t.id,t.status]);for(const id of ['T20','T07']){const t=backlog.tasks.find(t=>t.id===id);t.progressNote=note+'\n历史记录：'+t.progressNote;for(const e of ['backend-summary.json','compiled-summary.json','compiled-role-observation/proof.json','runtime/preservation-final.json','runtime/operating-delivery.json','runtime/final-pg-closure.json'])if(!t.evidence.includes(root+'/'+e))t.evidence.push(root+'/'+e);}assert.deepEqual(backlog.tasks.map(t=>[t.id,t.status]),before);fs.writeFileSync('docs/backlog.json',JSON.stringify(backlog,null,2)+'\n');
save('visual-review.json',{result:'PASS',checkedAt:new Date().toISOString(),inspected:['office-desktop.png','office-mobile.png','calendar-desktop.png','office-after-restart.png'].map(f=>'compiled-role-observation/'+f),scope:'Existing office draft/receipt layout, 390px stacked layout, private meeting response/update/cancel and cancelled state after restart.',horizontalOverflowAt390:false,limits:['R-015 small pale helper text remains pending.','No whole-platform design, real device, cloning or production acceptance claimed.']});console.log('Updated96 delivery docs; all task/requirement/gate statuses and full scope retained.');
