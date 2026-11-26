import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const name='126-native-recovery-journal.sql',file='migrations/postgres/runtime.json',r=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(r.version,122);assert.equal(r.migrations.at(-1).name,'125-native-recovery-quarantine.sql');r.version=123;r.migrations.push({name,sha256:createHash('sha256').update(fs.readFileSync('migrations/postgres/'+name)).digest('hex')});fs.writeFileSync(file,JSON.stringify(r,null,2)+'\n');
function change(f,from,to){const s=fs.readFileSync(f,'utf8');assert.equal(s.split(from).length,2,f);fs.writeFileSync(f,s.replace(from,()=>to));}
change('packages/postgres/src/runtime-database.ts',"'125-native-recovery-quarantine.sql'];","'125-native-recovery-quarantine.sql','126-native-recovery-journal.sql'];");change('packages/postgres/src/runtime-database.ts','manifest.version!==122','manifest.version!==123');change('tests/unit/postgres-runtime.test.ts',"'125-native-recovery-quarantine.sql']);","'125-native-recovery-quarantine.sql','126-native-recovery-journal.sql']);");
console.log(JSON.stringify({result:'PASS_RECOVERY_JOURNAL_WIRING',runtime:123,migration:name,nextMigration:'127',sqlite:'052'}));
