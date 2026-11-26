import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const root='docs/evidence/T20/postgres-live-return';
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const save=(name,value)=>fs.writeFileSync(root+'/'+name,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const start=read(root+'/start.json'),previous=read(start.previousManifest),unchangedTestFiles=new Set(['tests/integration/live-peers.test.ts','tests/integration/live-guest-programme.test.ts','tests/integration/postgres-live-control.test.ts','tests/integration/postgres-live-puppet-output.test.ts','tests/unit/text-layout.test.ts']);
const tests=new Map(),runs=[];
for(const label of ['target-expiry-final','sources-final','related-final']){
 const command=read(root+'/'+label+'-command.json'),report=read(root+'/'+label+'.json');
 if(label==='target-expiry-final'){assert.equal(report.numFailedTests,1);assert.equal(command.result,'FAIL');const failures=report.testResults.flatMap(s=>s.assertionResults.filter(t=>t.status==='failed'));assert.equal(failures.length,1);assert.ok(failures[0].fullName.includes('原独立期限自然到期后隐私凭证失效'));}
 else{assert.equal(command.result,'PASS',label);assert.equal(report.success,true,label);}
 let count=0;const acceptedFiles=new Set();
 for(const suite of report.testResults)for(const item of suite.assertionResults){
  const file=path.relative(process.cwd(),suite.name).replaceAll('\\','/');
  if(label==='target-expiry-final'&&file==='tests/integration/postgres-live-programme-sources.test.ts')continue;
  assert.equal(item.status,'passed',item.fullName);
  const binding=command.bindings.find(b=>b.file===file)??(unchangedTestFiles.has(file)?{kind:'unchanged-before-increment-and-current',manifest:start.previousManifest,manifestSHA256:start.previousManifestSHA256,file,sha256:previous.sourceSHA256[file]}:undefined);
  assert.ok(binding,file);assert.equal(hash(file),binding.sha256,file);
  const key=file+'#'+item.fullName;assert.equal(tests.has(key),false,key);
  tests.set(key,{file,name:item.fullName,result:'PASS',sourceBinding:binding});count++;acceptedFiles.add(file);
 }
 runs.push({label,passed:count,files:acceptedFiles.size,originalReportResult:command.result,excludedEarlierSourceFile:label==='target-expiry-final'?'tests/integration/postgres-live-programme-sources.test.ts':null});
}
assert.equal(tests.size,178);assert.equal(runs[0].passed,45);assert.equal(runs[1].passed,7);assert.equal(runs[2].passed,126);
const added=[...tests.values()].filter(t=>/native-worker-polling|postgres-runtime-locks/.test(t.file)||t.file==='tests/unit/live-output-text.test.ts'&&t.name.includes('R-015'));
assert.equal(added.length,10);
save('backend-summary.json',{result:'PASS',distinctPassed:tests.size,files:new Set([...tests.values()].map(t=>t.file)).size,newFeatureCases:added.length,runs,tests:[...tests.values()],separateFocusedRuns:true,previousFailuresRetained:true});

const directory='compiled-expiry-final',base=root+'/'+directory,proof=read(base+'/proof.json'),returnProof=read(base+'/return-observations.json'),frame=read(base+'/actual-return-frame.json'),recording=read(base+'/actual-recording.json');
for(const v of [proof,returnProof,frame,recording])assert.equal(v.result,'PASS');
assert.equal(proof.allDirectChildrenClosed,true);assert.equal(returnProof.guestCount,3);assert.equal(returnProof.observeOnly,false);
const observation=returnProof.observations.find(o=>o.kind==='distinct_programme_connection_and_actual_element');
assert.equal(observation.qualitySatisfied,true);assert.equal(observation.frameProgressEverySample,true);assert.ok(observation.rates.encodedFps>5);
assert.ok(frame.contrast>7);assert.equal(frame.programmeVideoTrackMatches,true);
assert.equal(recording.attempts,1);assert.ok(recording.publishedFrames>100);assert.equal(recording.sha256,hash(base+'/actual-return-recording.mp4'));
const allRuns=fs.readdirSync(root).filter(name=>fs.existsSync(root+'/'+name+'/proof.json')).map(name=>({directory:name,...read(root+'/'+name+'/proof.json')}));
for(const p of allRuns)assert.equal(p.allDirectChildrenClosed,true,p.directory);
const defaultBuffer=read(root+'/duplex-complex-gaps/probe.json'),largeBuffer=read(root+'/duplex-complex-buffer/probe.json');
assert.equal(defaultBuffer.receiveBufferBytes,65536);assert.equal(defaultBuffer.sequenceGaps,3466);assert.equal(defaultBuffer.diagnostics.browserStats.find(s=>s.kind==='video').framesDecoded,0);
assert.equal(largeBuffer.receiveBufferBytes,4194304);assert.equal(largeBuffer.sequenceGaps,0);assert.equal(largeBuffer.diagnostics.browserStats.find(s=>s.kind==='video').framesDecoded,22);
save('compiled-summary.json',{result:'PASS',completedProofDirectory:directory,compiledOnlyRoot:proof.compiledOnlyRoot,allProofRuns:allRuns.map(p=>({directory:p.directory,result:p.result,privateInstance:p.root,checks:p.checks.length})),functionalChecks:proof.checks.length,guiChecks:1,recordedThreeCameraVisualCheck:1,checks:proof.checks,actualRecording:recording,returnObservation:observation,diagnosticOnly:{defaultBufferBytes:65536,defaultBufferMissingSequences:3466,defaultBufferDecodedFrames:0,largeBufferBytes:4194304,largeBufferMissingSequences:0,largeBufferDecodedFrames:22,earlierProbeVariantsNotCountedAsAcceptance:true},allKnownDirectChildrenClosed:true,physicalCameraOrMicrophoneVerified:false,physicalAudioPlaybackVerified:false,realExternalBusinessActions:false,uninterruptedAudioAccepted:false,realTime24FpsAccepted:false,publicNetworkOrLongLoadAccepted:false});
save('visual-review.json',{result:'PASS',reviewedAt:new Date().toISOString(),scope:'Actual displayed programme WebRTC frame and 390px synthetic guest page only.',files:['actual-programme-return-frame.png','actual-return-guest-0.png'].map(name=>({file:base+'/'+name,sha256:hash(base+'/'+name)})),actualProgrammeMediaStreamMatched:true,actualThreeCameraColoursVisible:true,mobileProgrammeVideoVisible:true,mobileLayoutVisuallyWithoutHorizontalOverflow:true,actualRenderedTextContrast:frame.contrast,knownEarlierFailuresRetained:true,openQualityIssues:[{requirement:'R-094',issue:'Measured '+observation.rates.encodedFps.toFixed(2)+' fps against a 24 fps target. Only twelve seconds of local synthetic return observed; continuous audio, physical devices, public networks and long load remain unaccepted.'}],wholeVisualOrPerformanceAcceptanceClaimed:false});
console.log(JSON.stringify({result:'PASS',backend:tests.size,files:new Set([...tests.values()].map(t=>t.file)).size,newCases:added.length,encodedFps:observation.rates.encodedFps,contrast:frame.contrast}));
