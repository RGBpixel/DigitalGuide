import fs from 'node:fs';
import assert from 'node:assert/strict';
const root='docs/evidence/T20/postgres-speech',read=f=>JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,'')),backend=read(root+'/backend-summary-current.json'),proof=read(root+'/compiled-summary-current.json'),preserved=read(root+'/runtime/preservation-current.json'),visual=read(root+'/visual-review-current.json');for(const r of [backend,proof,preserved,visual])assert.equal(r.result,'PASS');assert.equal(proof.checks.length,16);assert.equal(backend.distinctPassed,636);const large=proof.checks.find(c=>c.name==='original_thirty_second_lease_real_sapi_recovery_and_over_8mb_wav_adoption_and_package_import').details,stage=proof.stage;
const note=`2026-11-23 T20/R-058原生工程配音与声音制作：语气/独立参考授权、品牌发音词典、受控SSML、真实SAPI持久配音、人工语言版本、逐词字幕和明确采用已接通。${backend.distinctPassed}个不同检查有通过证据，来自多次完整与定向运行；630项完整回归的关闭钩子超时、123项定向中一次pg_ctl退出超时均保留，最终26项关闭复验及当前68项声音/品牌检查通过，不冒充单轮全过。当前编译16项、10个界面流程通过，另保留移动端捕获失败和布局稳定后复验。实际5/4/12表提交前强杀、SAPI输出文件创建阶段强制终止、两次原30秒租约自然恢复、API强杀和PG停止/重启均验；${large.actualWav.size}字节实际WAV和六分片工程包跨空间往返。${proof.children.length}直接子进程、${proof.observedProcesses}独立观测进程及${proof.browserProcessesIndependentlyObserved}个Chrome关闭。001—024冻结/runtime21/下一025；SQLite052/下一053，主33223原四进程不重启/不切库。原3310业务记录身份保留，其中3309行摘要不变，1条既有邀请按原期限自然过期并清除访问凭据，${preserved.removedObservedExpiredAuthenticationRows}条到期认证清理单列；原始差异FAIL、旧失败、备份与两密钥保持。134/38/65/26和27本地verified保持；真实音色/语气克隆、其余原生模块及完整T20/R-058/R-059/G2继续。`;
const backlog=read('docs/backlog.json');for(const item of [backlog.tasks.find(t=>t.id==='T20'),backlog.requirements.find(r=>r.id==='R-058')]){assert.equal(item.status,'in_progress');for(const file of ['docs/72-postgres-speech-authoring.md',root])if(!item.evidence.includes(file))item.evidence.push(file);item.progressNote=note;}fs.writeFileSync('docs/backlog.json',JSON.stringify(backlog,null,2)+'\n');
let plan=fs.readFileSync('PLAN.md','utf8');plan=plan.replace(/^当前增量：.*$/m,'当前增量：T20/R-058原生工程配音、品牌发音词典、人工语言/字幕、实际大WAV和中断恢复已验证；完整T20/R-058/R-059及G2继续。').replace('独立原生001–020冻结/下一021','独立原生001–024冻结/runtime21/下一025');const start=plan.indexOf('## 当前开发：'),end=plan.indexOf('## 上一批交付：',start);assert.ok(start>=0&&end>start);plan=plan.slice(0,start)+'## 当前交付：T20/R-058原生工程配音与声音制作\n\n[实现、操作与边界](docs/72-postgres-speech-authoring.md)、[本批证据]('+root+')。'+note+'\n\n下一步继续原生内容/处理/录制/直播/AE来源链、批量协作与其他全场景模块，再推进对象存储、生命周期、生产身份和原生备份恢复。当前工具目标继续active；不因本增量完成将T20/G2或全平台标为完成。\n\n'+plan.slice(end);fs.writeFileSync('PLAN.md',plan);
let readme=fs.readFileSync('README.md','utf8');assert.ok(!readme.includes('docs/72-postgres-speech-authoring.md'));readme=readme.replace('当前交付[T20/R-058原生PPT自动答疑与系统语音]','当前交付[T20/R-058原生工程配音与声音制作](docs/72-postgres-speech-authoring.md)：'+note.replace(/^2026-11-23 T20\/R-058原生工程配音与声音制作：/,'')+'\n\n上一批交付[T20/R-058原生PPT自动答疑与系统语音]');const anchor='| [PostgreSQL PPT自动答疑与系统语音]';assert.ok(readme.includes(anchor));readme=readme.replace(anchor,'| [PostgreSQL工程配音与声音制作](docs/72-postgres-speech-authoring.md) | 真实系统配音、品牌词典、人工语言与字幕、64MB WAV来源和中断恢复 |\n'+anchor);fs.writeFileSync('README.md',readme);
const additions={
 'docs/02-architecture.md':'本节更新前述批次中通用工程配音尚未迁移的状态。021新增语气/词典、语言/字幕及声音任务守卫、不可覆写输入/输出/采用/资产来源账本；022独立修正领取函数同名版本字段歧义，023独立扩大工程包PCM WAV至64MB，024只提供品牌归属布尔检查，worker仍无品牌正文直读权。成员→空间→任务锁、当前权限、最终原件/声音复验和同事务审计/事件保持；两执行槽位、30秒租约、最多两次尝试，取消后待实际执行器退出才释放槽位。源工程后续编辑不使已采用音频自我失效，原素材/期限/场景限制继续继承。001—024冻结/runtime21/下一025，默认SQLite保持；其余原生领域和G2继续。',
 'docs/03-data-api.md':'通用/studio/voice/styles、dictionaries及各自update/versions，voice/compile与capabilities，projects/:id/languages、subtitles、speech-jobs，以及subtitles/:id的save/apply/versions/srt/vtt、speech-jobs/:id的control/apply/segments/:segmentId/audio已接入原生。写入验证当前成员、CSRF、幂等、版本与来源，采用前实际WAV/PCM复核；私有音频支持单Range。品牌词典通过受限布尔函数验证，不给worker品牌正文。人工译文和估算/人工字幕标识保持；系统声音不代表克隆、自动翻译或口型。该状态替代前述020交付时通用speech-jobs仍503的历史说明。',
 'docs/06-decisions-and-dependencies.md':'继续复用已安装的Windows SAPI和共享声音编译/时间线；声音清单只合并在途探测，不持久缓存，排队不代表声音完成，worker复核实际返回的声音身份和字节。独立voice_style授权不由train_voice替代，当前引擎拒绝参考语气迁移及外部声音降级。品牌只检查归属，不给执行角色完整品牌数据。64MB只适用于已生成或工程包PCM WAV，普通上传仍8MB。没有新增供应商、模型下载或付费调用；真实音色/语气模型、其他渠道/设备和生产接入条件保持。',
 'docs/58-local-user-guide.md':'当前默认工作台仍可访问http://127.0.0.1:5174，原四进程保持运行；无需重新启动。独立原生实例进入“语气与语言”，选择当前工程、安装的系统声音、语气和词典，明确确认生成；试听后确认采用，在新轨继续编辑。语气与词典库保留版本，品牌词典可用于PPT目的配音。人工语言版本独立保留原稿关联；字幕先估算，再校对、显式确认时间、下载和采用。音频过长需另行确认裁尾，锁定轨不能替换；任务过期/撤权/源变化要重新核对。大WAV开放包保留真实字节和合成标识，目标用途独立确认，不迁移模型/专项授权。本节更新前面通用工程配音未迁移的说明；其他原生模块继续按实际接通范围显示。',
 'migrations/postgres/README.md':'021原生声音守卫/账本，022领取版本列限定，023工程包PCM WAV上限64MB，024品牌归属布尔函数，均已在实际独立PG执行后冻结。原001—020保持。runtime.json为21，下一025；SQLite052/下一053不变。024不授予worker品牌正文SELECT，023不扩大普通上传8MB上限。仍仅初始化全新验证schema/目录，不原地升级旧验证实例或激活隔离归档。'
};for(const[file,body]of Object.entries(additions)){const title='## 原生工程配音、品牌词典与人工语言字幕（2026-11-23）';assert.ok(!fs.readFileSync(file,'utf8').includes(title));fs.appendFileSync(file,'\n\n'+title+'\n\n'+body+' 详见[实现、接口与证据]('+(file.startsWith('migrations/')?'../../docs/':'')+'72-postgres-speech-authoring.md)。\n');}
let builder=fs.readFileSync('scripts/build-docs.mjs','utf8');assert.ok(!builder.includes('docs/72-postgres-speech-authoring.md'));builder=builder.replace("'docs/71-postgres-presentation-answers.md',","'docs/71-postgres-presentation-answers.md', 'docs/72-postgres-speech-authoring.md',");fs.writeFileSync('scripts/build-docs.mjs',builder);
const doc=`# T20 / R-058 原生工程配音与声音制作

${note}

## 功能与操作

| 能力 | 实现与边界 | 需求 |
| --- | --- | --- |
| 语气与参考 | 预设、语速/音高/音量、停顿/重读、版本和独立voice_style授权；本机明确不迁移参考风格 | R-065、R-066 |
| 品牌发音术语 | 品牌归属、读音别名和人工译名、不可覆写历史；worker只读取所需词条并通过受限函数检查品牌归属 | R-066、R-075 |
| 系统配音 | 当前安装声音、固定原稿/声音/控制/词典/标注、持久队列、取消与有界重试、私有Range试听 | R-066、R-067、R-058 |
| 明确采用 | 实际WAV/PCM校验、合成资产与来源、独立可编辑声音轨；保留所选范围之外原片段，锁定轨拒绝覆盖 | R-066、R-058 |
| 人工语言版本 | 原稿/译稿独立，源变化和术语提示；原语言声音与字幕静音，不宣称自动翻译或口型 | R-067、R-075 |
| 逐词字幕 | 估算、未确认时间修改、明确人工时间确认、历史、SRT/VTT和新字幕轨 | R-077 |
| 声音资产与开放包 | 生成/包内PCM WAV总文件64MB，保留合成标识和最短期限；模型/服务绑定不转移 | R-058、R-066 |

“语气与语言”沿用既有中文界面。当前工作台仍在 http://127.0.0.1:5174 运行，API为 http://127.0.0.1:4301；本批没有重启四个主进程或切换主数据库。服务停止后的默认启动沿用仓库根目录的 pnpm dev。独立PG只使用新验证目录/schema，初始化与API/worker环境配置见[原生核心说明](62-postgres-native-core.md)；所有本批验证实例均已停止，不把测试夹具当作正式服务。生产模式仍被拒绝。

工程录入文字后选择声音与控制，核对确认再生成；生成完成后实际试听，再确认采用。过长声音需显式裁尾或延长分镜后重做。语言版本输入人工译文；字幕编辑文字不会自动变成“人工时间确认”。移动端只读账号可以查看，不能保存或生成。

## 固定来源、事务与权限

输入账本固定原稿和素材/角色/文档来源、最短期限、声音身份、控制、词典和标注。品牌词典不扩大worker读取品牌正文的权限。完成前、写入结果/审计/事件之后和最终提交前复验来源、当前创建人权限、令牌及真实文件。API不能伪造执行结果，worker不能直接更新声音任务结果或创建采用资产。

两执行槽位属于当前独立运行实例，原租期30秒，最多两次尝试。槽位保持与业务续租分开提交；取消时先等真实执行器关闭。自然到期不是恢复时间恰好30秒的生产SLA，多实例容量和网络故障仍需生产调度验收。

采用保存实际字节和不可覆写应用凭据。后续编辑源工程不会使自身已采用音频失效；任务再次采用仍要求当前版本和配置。已采用资产依旧核对冻结原稿所引用的素材、授权、最短期限、原件摘要和角色场景。递归检查有环路/深度保护。工程包明确列出未迁移的任务、控制和词典绑定；目标空间独立确认用途，下载出的字节不能远程收回。

## 实际验证与保留的失败

主报告为[后端汇总](evidence/T20/postgres-speech/backend-summary-current.json)、[当前编译汇总](evidence/T20/postgres-speech/compiled-summary-current.json)和[视觉复核](evidence/T20/postgres-speech/visual-review-current.json)。${backend.distinctPassed}个不同检查覆盖${backend.files}个文件，迁移链检查改标签仍计同一个检查。完整630项断言虽然全部通过，但原退出码1由关闭钩子超时保留；123项原生定向中122通过/1个独立PG退出超时也保留。最终26项PPT复验和当前68项声音/品牌检查通过。不是单轮${backend.distinctPassed}项全过，也不累计重复用例冒充新增覆盖。

当前编译阶段${stage}在全新001—024实例通过16项检查和10个GUI流程。实际SAPI产物为${large.actualWav.size}字节，SHA256为${large.actualWav.sha256}，PCM SHA256为${large.actualWav.pcmSHA256}；采用、六个持久分片、跨空间重导入后字节一致。契约音调的8.82MB样例另在隔离SQLite实例回读一致，不能作为真实声音质量证据。默认声音合成与契约样例分别记录；不以非零PCM代替主观音色/语气验收。

真实5表排队、4表完成、12表采用在写入后COMMIT前强杀，业务行/结果/审计/事件整体回滚。另在实际SAPI帮助进程和输出文件已创建时，用已核对的原进程句柄强制终止worker；该观测的输出文件为0字节，不声称强杀前已写出PCM。原30秒租约自然恢复后，同一任务尝试2得到真实完整WAV，只有一份完成凭据/审计/事件。API强杀和PG停机503/重启保留工程、声音、语言/字幕与密钥。

早期021草稿语法错误在整笔迁移回滚后修正；已应用021保持冻结，022修复版本字段歧义，023修复较大WAV包的数据库限额，024修复品牌词典worker范围检查。探针计数、普通上传413预期、相对URL和测试夹具字段等失败不改写。首次移动语言截图被正在收起的侧栏遮挡，原图保留FAIL；等待侧栏稳定与实际卡片边界后复验。未修改产品CSS或图片来修补截图。

${proof.children.length}个直接子进程记录、${proof.observedProcesses}个独立观测进程及${proof.browserProcessesIndependentlyObserved}个Chrome均关闭。一次失败测试遗留的死亡PG锁文件在核对PID/创建时刻、目录和端口后，仅将原文件归档到证据；没有删除数据库文件或停止无关进程。没有自动孤立文件回收、正式备份恢复或生产部署验收声明。

## 原工作台保留

原301表/3316行基线不替换。3310条业务记录身份保持，其中3309行摘要不变；一条既有连麦邀请在2026-11-22T23:50:39.818Z自然到期，原有sweep在23:50:39.966Z将issued变为expired、递增版本并清除访问凭据。该变化与${preserved.removedObservedExpiredAuthenticationRows}条到期认证清理单独存证，不把原始差异FAIL抹成逐字无变化，也不恢复过期权限。私有原库备份、两密钥、43旧状态、53旧最终清单、47模型/运行时/许可和1594份PG文件继续核对。73份旧编译私有备份保留；50份前端字节不变，19份后端/支持编译有预期差异，其中16份支持入口仅增加共享WAV常量声明。

## 接口与复现

API均在/api/v1/studio下：voice/styles与dictionaries的列表/保存/update/versions，voice/compile与capabilities；projects/:id/languages、subtitles、speech-jobs；subtitles/:id的读取/save/apply/versions/srt/vtt；speech-jobs/:id的读取/control/apply/segments/:segmentId/audio。列表/资源读取按当前租户和空间隔离，写入需要CSRF、幂等键和版本。未知声音/外部引擎、参考语气迁移或失效来源给出明确失败，不能降级成模拟成功。

在仓库根目录可用本机Node运行 node node_modules/vitest/vitest.mjs run tests/integration/postgres-speech.test.ts tests/integration/postgres-speech-guards.test.ts tests/integration/postgres-speech-large.test.ts tests/integration/postgres-speech-brands.test.ts。完整与定向命令、真实退出码和源码摘要在证据目录的各个-command.json中。重新使用取证脚本时选择新的输出标签，不能覆盖已有结果。构建使用 node scripts/build.mjs，静态与文档检查见checks-final。

## 继续建设

真人形象、音色及参考语气克隆、实时驱动/口型、自动翻译/强制对齐、目标声源和现场设备仍分别需要实际引擎、授权素材、账号或硬件。生产身份、对象存储、文件生命周期、原生PG备份恢复/部署、未决外部业务核对、费用/告警及其他原生全场景继续。所有制作/PPT、直播、发布投放、展厅、前台、餐厅、多人/批量协作、4K/透明与资产迁移最终要求保留；没有真实通知、推流、发布、广告花费、收费、门禁或公网部署。T20/R-058/R-059及G2保持in_progress，工具目标继续active。
`;fs.writeFileSync('docs/72-postgres-speech-authoring.md',doc);console.log(JSON.stringify({result:'PASS',updatedBacklogIds:['T20','R-058'],statusesChanged:false,fullPlatformScopePreserved:true}));
