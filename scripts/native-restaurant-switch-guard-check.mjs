import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const directory='storage/postgres-native-tests',before=fs.readdirSync(directory).sort(),startedAt=new Date().toISOString(),result=spawnSync(process.execPath,['--import','tsx','scripts/native-restaurant-switch-proof.ts','sealed-guard-check'],{windowsHide:true,encoding:'utf8',timeout:30000});
assert.equal(result.status,1);assert.ok(result.stderr.includes('Original switch producer is sealed; continue the same 089 instance instead.'));assert.deepEqual(fs.readdirSync(directory).sort(),before);
fs.writeFileSync('docs/evidence/T20/postgres-restaurant-session/switch-producer-guard.json',JSON.stringify({result:'PASS',startedAt,checkedAt:new Date().toISOString(),expectedExitCode:1,actualExitCode:result.status,sealedProducerGuardReached:true,newNativeRootsCreated:0,oldProducerExecuted:false},null,2)+'\n',{flag:'wx'});console.log('PASS: sealed producer refused before creating a runtime.');
