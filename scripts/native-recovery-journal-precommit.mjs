import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root='docs/evidence/T20/postgres-recovery-journal';assert.equal(fs.existsSync(root+'/126-first-committed.json'),false,'Never modify an applied migration');const file='migrations/postgres/runtime.json',r=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(r.version,123);assert.equal(r.migrations.at(-1).name,'126-native-recovery-journal.sql');r.migrations.at(-1).sha256=createHash('sha256').update(fs.readFileSync('migrations/postgres/126-native-recovery-journal.sql')).digest('hex');fs.writeFileSync(file,JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify({result:'PASS_UNCOMMITTED_JOURNAL_DIGEST_UPDATED',sha256:r.migrations.at(-1).sha256,appliedMigrationModified:false}));
