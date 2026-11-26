import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const root='docs/evidence/T24/writing-review';
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const nativeFile=root+'/model-full-human-review/probe.json';
const native=read(nativeFile),state=read('storage/writing-review-preview-state.json');
assert.deepEqual(native.native.result,state.stable.job.result);
assert.equal(state.stable.job.adoptions.length,1);
assert.equal(state.stable.job.adoptions[0].variantIndex,0);
const selected=native.native.result.variants[0],unadopted=native.native.result.variants[1];
assert.deepEqual(state.stable.draft.payload.sections.map(s=>s.text),selected.sections.map(s=>s.text));
assert.ok(unadopted.sections[0].text.includes('其他工作日09:00到17:00开放'));
assert.ok(unadopted.sections[0].citations[0].quote.includes('每天09:00—17:00开放，周三闭馆'));
assert.equal(native.native.evidence.review.passes.at(-1).checks.find(c=>c.checkId==='v1s0').verdict,'supported');
assert.equal(native.native.evidence.review.passes.at(-1).guardFindings.length,0);
write(root+'/source-fidelity-followup.json',{
  result:'FAIL_UNADOPTED_CANDIDATE_CALENDAR_SCOPE',checkedAt:new Date().toISOString(),
  report:nativeFile,reportSHA256:hash(nativeFile),mainJob:state.ids.job,
  originalModelAndStoredResultsUnchanged:true,
  source:unadopted.sections[0].citations[0].quote,
  observed:unadopted.sections[0].text,
  issue:'The source states daily opening except Wednesday. Candidate 2 introduces a working-day scope absent from the source; weekends are not excluded by the source.',
  modelFinalVerdict:'supported',independentRulesMissedThisScope:true,
  earlierBroadFidelityAuditOverstated:true,
  earlierReportsRetained:[root+'/model-full-human-review/quality-audit.json',root+'/runtime/candidate-quality-audit.json'],
  correctedAuditScope:'Only the actually adopted candidate 1 was checked as suitable for this owned synthetic subtitle/voice demonstration. The earlier PASS must not be read as factual approval of all candidates.',
  adoptedVariantIndex:0,mainExportContainsThisWording:false,
  selectedCandidateTextUnchanged:true,selectedCandidateManualReview:'Codex inspection of synthetic source only; no external human certification.',
  generalFactualQualityVerified:false,generalWritingQualityVerified:false,
  automaticQualityGateComplete:false,taskOrPlatformComplete:false,
});

const visualRoot=root+'/runtime/browser-built-release';
const inspected=['desktop-viewport.png','mobile-viewport.png','actual-fhd-frame.png','actual-fhd-unobscured.png','actual-fhd-second-unobscured.png'];
write(root+'/visual-review.json',{
  result:'PASS',checkedAt:new Date().toISOString(),scope:'Current built desktop/mobile first viewport and two unobscured frames from the actual adopted-candidate export; not general model or avatar quality.',
  images:inspected.map(name=>({file:visualRoot+'/'+name,sha256:hash(visualRoot+'/'+name)})),
  observations:[
    'Desktop navigation, page heading, source choices and generation form are legible without visible overlaps.',
    '390px mobile navigation and form wrap within the viewport; the independent browser check reports no horizontal overflow.',
    'The diagnostic browser-video controls cover part of the subtitle box in the playback screenshot; independently decoded 14s/54s frames show the complete two-line subtitles inside the frame.',
    'Both unobscured exported frames show the actual adopted candidate, including confirmation condition and the listed order/refund/payment restriction.',
  ],
  diagnosticElementOnly:true,actualProductEmbeddedExportPlayerClaim:false,
  actualVideoReexported:false,earlierFullPageFixedSidebarCaptureOffsetIsNotAppLayoutEvidence:true,
  mainSampleSubtitleVoiceOnly:true,avatarOrVoiceClone:false,audioListened:false,
  generalFactualQualityVerified:false,
});

const backlogFile='docs/backlog.json',backlog=read(backlogFile);
const note='本批逐段核对与片段修订流程已本地验证：独立v2实际Qwen正文核对、有限显式规则和一轮四处片段替换，模型分歧保留needs-human-review；采用需确认当前回执摘要及操作者。108项后端/13文件、合并Chrome6项、当前编译9项/9根进程通过；实际核对阶段4GB推理SIGKILL、原30秒租约自然恢复attempt2及取消验证，独立93进程退出。主39215完成示例后重启62916/schema047，同一候选1/草稿/工程/完整WAV/80秒FHD运行8项、开发浏览器8项及built浏览器8项保持；v2只改时长，文字未手改，样片只有字幕/系统配音。原282业务表3010行无变，全表114条已观测过期认证差异保留原FAIL及说明；原基线/私有备份/两类密钥、18早期清单及43模型运行文件保持。通用事实质量未通过：16已知例实际模型2误判、事后规则重放16/16不算盲测，新冻结20例19符合预期仍FAIL；未采用候选2每天→工作日的漏检追加纠正审计，早期宽泛PASS不代表全部候选正确；另一真实浏览器生成有无来源服务范围扩张，FAIL保留。标题角度、自然创意、多素材语言/长资料和真实克隆/现场/渠道继续；047冻结/下一048、完整134/38/65与22项verified不变，T24/T25/T28及G1/G2不标完成。';
for(const id of ['R-072','R-073','T24']){
  const item=[...backlog.requirements,...backlog.tasks].find(x=>x.id===id);
  assert.equal(item.status,'in_progress');
  assert.ok(item.progressNote.includes(' 本轮进行中：'));
  item.progressNote=item.progressNote.slice(0,item.progressNote.lastIndexOf(' 本轮进行中：'))+' '+note;
  for(const file of ['docs/48-script-source-review.md',root+'/verification.json'])if(!item.evidence.includes(file))item.evidence.push(file);
}
assert.equal(backlog.requirements.length,134);assert.equal(backlog.tasks.length,38);assert.equal(backlog.tasks.filter(t=>t.status==='verified').length,22);
backlog.updatedAt='2026-11-22';
fs.writeFileSync(backlogFile,JSON.stringify(backlog,null,2)+'\n');
write(root+'/verification.json',{result:'PENDING_FINAL_CHECKS',recordedAt:new Date().toISOString(),task:'T24',wholeTaskOrPlatformCompleted:false,remaining:'Final type/lint/API/documentation checks and immutable evidence audits.'});
console.log(JSON.stringify({result:'DELIVERY_PREPARED',followupQualityResult:'FAIL_UNADOPTED_CANDIDATE_CALENDAR_SCOPE',selectedCandidateIndex:0,wholeTaskOrPlatformCompleted:false}));
