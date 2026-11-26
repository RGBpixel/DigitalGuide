import fs from 'node:fs';
import assert from 'node:assert/strict';
const root='docs/evidence/T35/developer-webhooks';
const evidence=['webhook-type-initial-command.json','webhook-lint-initial-command.json'].map(name=>root+'/'+name);
for(const file of evidence){const report=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(report.result,'PASS',file);assert.equal(report.exitCode,0,file);}
const source=fs.readFileSync('apps/api/src/postgres-identity-routes.ts','utf8');
assert.match(source,/registerDirectoryAdminRoutes\([^\n]+,send\);/);
assert.match(source,/registerDeveloperRoutes\([^\n]+,send,webhookRuntime\);/);
const note='2026-11-26 增量141核心接线检查点：订阅契约、私有接收端注册表、HMAC签名、同事务事件/持久队列及独立派发入口已实现初稿；修正原生接线，把Webhook运行时传入开发者路由，目录路由保持原签名。当前完整类型检查与lint已实际通过，SQL模板也纳入检查源快照。业务单元/双库/编译/界面及接收端投递尚未验证，不称功能完成；061/140/runtime137仅已生成接线、未执行本轮迁移。主33223/052与旧封存成功根保持，完整134/38/65/26、27本地verified、T20/T35和目标active、G2继续。';
const planFile='PLAN.md',plan=fs.readFileSync(planFile,'utf8');
assert.ok(!plan.includes(note),'checkpoint already recorded');
assert.ok(plan.includes('当前增量：141，Webhook订阅、签名与持久投递；本轮尚未测试。'));
const backlogFile='docs/backlog.json',backlog=JSON.parse(fs.readFileSync(backlogFile,'utf8'));
const task=backlog.tasks.find(item=>item.id==='T35');assert.equal(task.status,'in_progress');
assert.equal(backlog.requirements.length,134);assert.equal(backlog.tasks.length,38);
for(const item of [task,...backlog.requirements.filter(item=>['R-062','R-120'].includes(item.id))]){
  item.progressNotes=(item.progressNotes?item.progressNotes+'\n':'')+note;
  item.evidence=[...new Set([...(item.evidence||[]),...evidence])];
}
const nextPlan=plan.replace('当前增量：141，Webhook订阅、签名与持久投递；本轮尚未测试。','当前增量：141，Webhook订阅、签名与持久投递；核心初稿类型/lint通过，业务/双库/编译/界面未验。').replace('\n2026-11-26 增量141开始：','\n'+note+'\n\n2026-11-26 增量141开始：');
fs.writeFileSync(planFile,nextPlan);fs.writeFileSync(backlogFile,JSON.stringify(backlog,null,2)+'\n');
fs.writeFileSync(root+'/core-checkpoint.json',JSON.stringify({result:'CORE_STATIC_CHECKS_PASS_FUNCTIONAL_VALIDATION_PENDING',recordedAt:new Date().toISOString(),evidence,checks:{typecheck:'PASS',lint:'PASS',businessTests:'NOT_RUN',sqliteMigration:'NOT_RUN',nativeMigration:'NOT_RUN',compiledProof:'NOT_RUN',gui:'NOT_RUN'},goal:'active',note},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({result:'CORE_CHECKPOINT_RECORDED',functionalValidation:'pending',goal:'active'}));
