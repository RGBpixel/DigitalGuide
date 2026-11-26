import fs from 'node:fs';
import assert from 'node:assert/strict';
const root='docs/evidence/T20/postgres-people',read=f=>JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,'')),save=(n,v)=>fs.writeFileSync(root+'/'+n,JSON.stringify(v,null,2)+'\n',{flag:'wx'});
for(const name of ['backend-summary.json','compiled-summary.json','runtime/final-pg-closure.json','runtime/preservation-final.json','runtime/operating-delivery.json'])assert.equal(read(root+'/'+name).result,'PASS');
const note='2026-11-24 原生账号本人资料与记忆完成本地增量：自愿登记/限定授权、本人声明候选/确认/纠正/拒绝/撤回、受控接待检索、复核摘要/待办、免打扰/静默/冷却问候预览、本人导出与原子删除、实际到期和成员离开永久失效已接通。117个不同检查/7文件分次通过，20项新增；同一私有实例及相同76份编译完成7项检查、8个GUI流程。候选和删除各做一次真实API提交前强杀，均完整回滚，双API沿各原键8次恢复只提交一项候选/一份删除回执。实际下载本人JSON、原期限自然到达后编译worker清空原文、8类记录/两密钥重启一致已验；100项容量边界并发仍有界。失败保留，059成功应用后冻结，再追加060修正；PG001—060/runtime57/下一061，SQLite052/下一053。9个私有PG集群关闭，主33223原四进程、301表3318原行/3310业务行、两密钥与AE保持。134/38/65/26与27项本地verified及全部门槛状态保持，T20/G2和完整平台继续。';
const doc=`# 原生人员与本人记忆生命周期

状态：完成账号本人部分的本地增量，2026-11-24；T20/G2与完整平台继续。迁移既有T06/R-040、R-041、R-042、R-045、R-053、R-054，不改变134项需求、38任务与全部最终场景。

${note}

## 本人资料及使用规则

当前登录账号可在每个已授权工作空间主动同意memory-v1用途，自愿登记称呼及访客/顾客业务标签，选择30、90或180天授权。默认关闭个性化、开启免打扰。employee来自服务端账号关联，业务标签不授予额外操作权限，也不验证自述单位。已存在本人有效资料时使用设置修改；不按同名、人脸或声音合并到其他人。

本人声明先为pending，只有本人明确核对后成为confirmed。支持喜欢、避免、称呼、单位和交流话题，保留来源类型、使用范围、确认时间与期限。纠正先移除旧索引并回到pending，需要再次确认；拒绝、撤回或到期清空正文。接待预览只检索已确认、未到期、标为reception且本人开启个性化的条目，私人条目不进入索引。索引是实际PG派生表，最终约束要求其与当前允许使用的事实完全一致，不能伪造候选为确认记忆或漏删旧值。

摘要和待办由本人填写并明确复核，最长30天且不超过资料授权；仅开放待办可完成，摘要/待办可删除。当前账号资料只接受本人填写，拒绝未绑定的会话文字、旧focusVersion或声纹字幕作为来源。本人导出实际下载JSON，只含本人资料、事实、复核记录及排除项，当前账号阶段的transcript为空，不伪造接待会话已经迁移。

问候功能是受控文字预览，检查个性化、免打扰、场所时区的静默时段和实际冷却。相同静默起止表示全天静默；允许时仅使用明确公开的确认称呼，或通用问候，不朗读私人偏好。预览不自动播音、不发送通知、不驱动摄像头/麦克风，也不代表自动接待问候已经完成。

## 权限、持久化及删除

API与worker均不获得people、memory_facts、memory_notes、memory_lookup等原文表的任意SELECT/写权限。本人投影、操作、检索、导出与最小目录通过受控数据库函数执行，以当前登录账号、租户、工作空间和原授权守卫校验。管理员只能看主动登记的称呼、业务角色、来源与期限，不可读取或导出他人的私人记忆。只读成员仍可管理本人资料，降为只读不等于退出工作空间。

锁顺序为成员身份、工作空间、本人记录。范围读取在锁定本人记录前先校验本人空间，避免同登记键回放与设置形成反向等待；保留期清理放在独立短事务，避免它持有资料锁再等待业务幂等锁。本人记录串行化内容确认、版本、100项事实/100项摘要待办限额。静默、更正、撤回和删除不依赖前端按钮隐藏，实际数据库函数继续校验状态及版本。

幂等缓存只保存标识，变更使旧本人响应失效，旧动作返回DATA_REMOVED或已不可访问。更正后的新值不覆盖为已确认事实，也不保留可还原的旧正文历史。问候回执只保存资料版本、称呼事实标识/版本与允许原因，不保存称呼正文；资料改变后不能回放旧问候。审计、outbox和普通日志均不保存个人正文。

删除在一个事务中清空本人名称和角色、记忆、检索与摘要待办，撤销授权守卫并生成最小删除回执。回执保留原账号范围用于本人核对及原删除键的幂等恢复，不复活已删除资料。当前没有外部记忆服务，external=not_applicable；生产备份、未来提供商和其他外部系统的删除不因此标为完成。成员离开空间立即执行同类删除；重新加入后原档案不会复活，可以明确登记新编号的本人资料。

## 实际检查与失败历史

backend-summary.json记录117项不同检查/7文件，其中20项新增，属于分次通过证据。首轮17项有13项通过：实际并发暴露保留期清理与幂等/本人锁的顺序冲突，允许问候暴露SQL局部变量与表别名的歧义；另两项为bigint类型和异常包装预期。060及TS修正后5项定向检查通过，新增锁顺序并发用例覆盖登记键回放与本人设置。其余两项追加检查验证历史授权到期清理及100项边界并发，均实际通过。51项既有人员记忆/恢复/运行配置回归、31项原生运行与锁回归、15项原生办公室回归实际通过。

历史30天授权夹具只在独立测试事务中临时跳过资料时间/身份行守卫，校验延迟约束并恢复触发器后提交；实际运行角色随后清理。该契约检查不声称已真实等待30天。短期事实则确实等待原期限自然到达，API与编译worker分别有原文清除证据，未修改时钟或期限。代码规范检查发现的测试变量声明问题及两次lint失败保留，修正后的检查另存，不覆写失败记录。

compiled-first/proof.json在同一私有实例、同一76份编译完成7种检查、8个GUI流程。新增候选暂存后、最后检索副本更新前强杀实际API，整个事务回滚；沿原输入/原键由双API8次恢复只产生一项候选。完成本人确认、纠正、再次确认、接待检索、复核待办、实际JSON下载、独立只读账号的私人事实、390px页面与删除回执。另一轮在删除暂存、回执提交前强杀实际API，完整回滚后沿原键8次恢复，仅保留一份删除回执。API/PG重启前后8类记录与两密钥逐项一致。失败观察没有通过重跑成功业务掩盖；本轮编译验证首次完整通过。

本轮9个私有PG集群已经关闭，按PID及创建时间核对无残留。主33223原四进程不重启不切库，301表3318原行/3310业务行、两密钥与AE保持。类型、lint、构建、文档与接口规范检查均保存实际命令和来源绑定。既有R-015小字/浅色帮助、R-094实时24fps/持续音频/复杂网络/长期负载保持未验。

## 启动、冻结版本及剩余范围

原[本机工作台](http://127.0.0.1:5174/people)继续运行，入口为“人员与记忆”。本批新增原生实现已在独立实例验完，私有服务已关闭，没有替换默认工作台。独立原生配置的手动启动见[原生运行指南](62-postgres-native-core.md)。已有本机依赖、经过校验的PG程序及模型文件时，可以使用一个未使用的标签重新创建独立验证实例：

~~~powershell
& 'C:\\Program Files\\nodejs\\node.exe' scripts/native-people-checks.mjs unique-label proof
~~~

驱动只创建/关闭自己的本地验证服务，不触发真实业务。实际中断恢复必须保留原实例、输入、标识、幂等键和期限；不要通过重建成功业务替代剩余验证。密钥与连接文件只留私有目录，不复制到报告。

059首次应用后冻结：SHA256 f75914546224fe0b97c21a006489f3107e31a4c9243ef056979814e13393d0ef；060为1080b58b8d78867786d2c53d83cdbbb10c919c1a04ab89442d291c655236dbfe。PG001—060/runtime57/下一061，SQLite052/下一053。来源快照及本批证据见evidence/T20/postgres-people。

匿名终端、会话/focusVersion来源、目标变化阻断、一次性恢复凭证、自动问候、会话原文/访客通知联动仍属于最终范围，随原生接待和来访迁移继续。当前不自动采集陌生人建长期档案，不从外貌/声音推断性格。真人形象/声音/语气克隆、实时目标说话人、现场设备、企业身份/通知/日历、餐厅POS/支付/桌台、批量团队、发布投放及生产部署继续分别接入与验收，不因本批完成账号部分而删减。真实服务需要对应账号、设备、接口、生命周期策略与具体业务授权；普通开发和本地验证继续。
`;
fs.writeFileSync('docs/97-postgres-people.md',doc);const f='PLAN.md',plan=fs.readFileSync(f,'utf8'),a=plan.indexOf('## 正在执行：原生人员与本人记忆生命周期'),b=plan.indexOf('## 上一批交付：',a);assert.ok(a>=0&&b>a);let header=plan.slice(0,a).replace('当前增量：97，T20原生人员与本人记忆生命周期，in_progress','当前增量：97，T20原生人员与本人记忆生命周期，账号本人部分完成本地增量').replace('独立原生001—058冻结/runtime55/下一059','独立原生001—060冻结/runtime57/下一061');fs.writeFileSync(f,header+'## 本批交付：原生人员与本人记忆生命周期\n\n[实现、检查、启动与边界](docs/97-postgres-people.md)、[本批证据](docs/evidence/T20/postgres-people)。'+note+'\n\n下一步继续原生匿名接待、会话/focus来源与目标变化阻断、一次性偏好恢复凭证、主动问候及来访/受访人/通知/人工接管联动；继续批量团队、发布投放、展厅/前台/餐厅、对象存储和生产身份等全部最终范围。真实克隆、声纹、设备及各业务系统分别接入验收，不将本人文字资料代替现场接待或识别。\n\n'+plan.slice(b));
const r='README.md',text=fs.readFileSync(r,'utf8'),end=text.indexOf('\n');fs.writeFileSync(r,text.slice(0,end+1)+'\n[原生人员与本人记忆](docs/97-postgres-people.md)：自愿资料、偏好确认/纠正、私密检索、复核待办、导出与原子删除已接通；117项检查分次通过，真实API中断恢复、自然到期、重启与8个GUI流程已验。匿名接待/恢复凭证与完整平台继续，主工作台保持。\n\n上一批交付：\n'+text.slice(end+1));
const backlog=read('docs/backlog.json'),before=backlog.tasks.map(t=>[t.id,t.status]);for(const id of ['T20','T06']){const t=backlog.tasks.find(t=>t.id===id);t.progressNote=note+'\n历史记录：'+t.progressNote;for(const e of ['backend-summary.json','compiled-summary.json','compiled-first/proof.json','runtime/preservation-final.json','runtime/operating-delivery.json','runtime/final-pg-closure.json'])if(!t.evidence.includes(root+'/'+e))t.evidence.push(root+'/'+e);}assert.deepEqual(backlog.tasks.map(t=>[t.id,t.status]),before);fs.writeFileSync('docs/backlog.json',JSON.stringify(backlog,null,2)+'\n');
save('visual-review.json',{result:'PASS',checkedAt:new Date().toISOString(),inspected:['people-desktop.png','people-mobile.png','people-deleted.png'].map(f=>'compiled-first/'+f),scope:'Existing personal memory layout, confirmed/corrected value, completed todo, 390px stacking/minimal directory and deletion receipt with voluntary re-enrollment.',horizontalOverflowAt390:false,limits:['R-015 small pale helper text remains pending.','Anonymous reception, external model/device use and production/whole-platform quality not accepted.']});console.log('Updated97 docs; statuses/gates and all final scope retained.');
