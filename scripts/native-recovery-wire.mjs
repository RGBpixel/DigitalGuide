import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const name='125-native-recovery-quarantine.sql',file='migrations/postgres/runtime.json',r=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(r.version,121);assert.equal(r.migrations.at(-1).name,'124-native-proactive-purpose.sql');r.version=122;r.migrations.push({name,sha256:createHash('sha256').update(fs.readFileSync('migrations/postgres/'+name)).digest('hex')});fs.writeFileSync(file,JSON.stringify(r,null,2)+'\n');
function change(file,from,to){const s=fs.readFileSync(file,'utf8');assert.equal(s.split(from).length,2,file+': '+from);fs.writeFileSync(file,s.replace(from,()=>to));}
change('packages/postgres/src/runtime-database.ts',"'124-native-proactive-purpose.sql'];","'124-native-proactive-purpose.sql','125-native-recovery-quarantine.sql'];");
change('packages/postgres/src/runtime-database.ts','manifest.version!==121','manifest.version!==122');
change('tests/unit/postgres-runtime.test.ts',"'124-native-proactive-purpose.sql']);","'124-native-proactive-purpose.sql','125-native-recovery-quarantine.sql']);");
const p=JSON.parse(fs.readFileSync('package.json','utf8'));assert.ok(!p.scripts['postgres:recovery']);p.scripts['postgres:recovery']='tsx scripts/postgres-recovery.ts';fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n');
change('scripts/build.mjs',"entryPoints: { 'postgres-runtime':","entryPoints: { 'postgres-recovery': 'scripts/postgres-recovery.ts', 'postgres-runtime':");
console.log(JSON.stringify({result:'PASS_NATIVE_RECOVERY_WIRING',runtime:122,migration:name,nextMigration:'126',sqlite:'052'}));
