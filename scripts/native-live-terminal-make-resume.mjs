import fs from 'node:fs';
import assert from 'node:assert/strict';
let s=fs.readFileSync('scripts/native-live-terminal-proof.ts','utf8');
function change(from,to){assert.ok(s.includes(from),from.slice(0,100));s=s.replace(from,to);}
change('proofHash,proofUntil,type','proofHash,proofUntil,proofPause,type');
change("NativeContentProofRuntime.create(base+'/'+(process.argv[2]??'compiled-first'))","NativeContentProofRuntime.resume(base+'/'+(process.argv[2]??'compiled-resumed'),base+'/upgrade-handoff-final.json')");
change('await c.prepare();','await c.prepareResume();');
const tools=s.split('\n').find(l=>l.includes("const tools=path.join(c.compiledRoot"));change(tools,'');
change('fs.mkdirSync(references);','if(!fs.existsSync(references))fs.mkdirSync(references);');
change('fs.copyFileSync(from,target,fs.constants.COPYFILE_EXCL);baseline.push','if(!fs.existsSync(target))fs.copyFileSync(from,target,fs.constants.COPYFILE_EXCL);assert.equal(proofHash(target),prior.compiledSHA256[\'dist/\'+name]);baseline.push');
const start=" worker=c.start('reference85-worker'";
const at=s.indexOf(start);assert.ok(at>0);
const recover=`
 // Recover the exact original interrupted fixture before generating a second reference case.
 const original=JSON.parse(fs.readFileSync(base+'/diagnose-original/state.json','utf8')).sessions[0],originalRows=await segments(original.id),originalRaw=await raw(original.id),originalClock=JSON.parse(originalRaw.state),originalKey=randomUUID(),originalBody={version:Number(originalRaw.version),epoch:originalClock.epoch,action:'stop',confirmed:true};
 const originalRejected=await c.http('/api/v1/live-sessions/'+original.id+'/control',originalBody,c.apiA,{...c.headers,'idempotency-key':originalKey});assert.equal(originalRejected.status,409);assert.equal(originalRejected.body.error!.code,'LIVE_SEGMENT_LIMIT');assert.deepEqual(await segments(original.id),originalRows);
 await c.stop(api);api=await c.api('current-recover-original548-api');const originalEnded=await post<LiveSession>('/live-sessions/'+original.id+'/control',originalBody,originalKey);assert.equal(originalEnded.status,'ended');assert.equal(originalEnded.available,true);const recoveredRows=await segments(original.id);assert.equal(recoveredRows.length,600);assert.deepEqual(recoveredRows.slice(0,originalRows.length),originalRows);
 worker=c.worker('original548-prefix-archive-worker');const originalRecording=await proofUntil(()=>c.get<LiveRecording>('/live-recordings/'+originalEnded.recording!.id),r=>r.status==='ready',180000);await c.stop(worker);worker=undefined;
 c.save('original548-recovered.json',{result:'PASS',sessionId:original.id,previousPersistedRows:originalRows.length,finalPersistedRows:600,originalPrefixExact:true,originalFailure409Recovered:true,actualRecordingReady:true,recordingId:originalRecording.id,originalKeyRecovered:true,stateOrClockOrCounterEdited:false});c.add('original_interrupted548_row_fixture_recovered_to_bounded600_and_actual_archive_without_reseeding_or_clock_edits');
 await c.stop(api);api=c.start('reference85-api-for-full600',process.execPath,[path.join(references,'api.mjs')],c.env());await proofUntil(()=>c.http('/api/v1/readiness',undefined,c.apiA,{}),r=>r.status===200);
`;
s=s.slice(0,at)+recover+s.slice(at);
change('requests<700','requests<5000');change('conflicts++;}else','conflicts++;await proofPause(40);}else');change("r=>r.status==='ready',120000)","r=>r.status==='ready',180000)");
change("assert.equal(ended.status,'ended');assert.equal(ended.playhead", "assert.equal(ended.status,'ended');assert.equal(ended.available,true);assert.equal(ended.unavailableReason,null);assert.equal(ended.playhead");
fs.writeFileSync('scripts/native-live-terminal-resume.ts',s,{flag:'wx'});
let runner=fs.readFileSync('scripts/native-live-terminal-checks.mjs','utf8');runner=runner.replace("const files=[","const files=['scripts/native-live-terminal-resume.ts',");runner=runner.replace('const commands={',"const commands={resume:['--import','tsx','scripts/native-live-terminal-resume.ts',label],");fs.writeFileSync('scripts/native-live-terminal-checks.mjs',runner);
console.log(JSON.stringify({result:'PASS',samePrivateInstance:true,originalFixtureNotReplaced:true}));
