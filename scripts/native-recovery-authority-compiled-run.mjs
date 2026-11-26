import fs from 'node:fs';
import assert from 'node:assert/strict';
const file='docs/evidence/T20/postgres-recovery-authority/check-runner.mjs';let s=fs.readFileSync(file,'utf8');assert.ok(!s.includes("'authority-compiled':"));s=s.replace('const commands={',()=>"const commands={'authority-compiled':['--import','tsx','scripts/native-recovery-authority-proof.ts','authority-compiled'],");fs.writeFileSync(file,s);console.log('PASS isolated compiled proof command registered');
