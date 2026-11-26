import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
function edit(file,from,to){const source=fs.readFileSync(file,'utf8');assert.ok(source.includes(from),file);fs.writeFileSync(file,source.replace(from,()=>to));}
edit('packages/postgres/src/runtime-database.ts',"'133-native-enterprise-member-directory.sql']","'133-native-enterprise-member-directory.sql','134-native-member-business-access.sql']");
edit('packages/postgres/src/runtime-database.ts','manifest.version!==130','manifest.version!==131');
edit('tests/unit/postgres-runtime.test.ts',"'133-native-enterprise-member-directory.sql']","'133-native-enterprise-member-directory.sql','134-native-member-business-access.sql']");
edit('packages/postgres/src/runtime-bootstrap.ts',"  await client.query('GRANT SELECT,INSERT,UPDATE ON enterprise_member_directory TO '+apiRole);", "  for(const role of [apiRole,identifier(input.worker.user)])await client.query('GRANT SELECT ON _dg_native_effective_member_directory,_dg_native_effective_memberships TO '+role);\n  await client.query('GRANT SELECT,INSERT,UPDATE ON enterprise_member_directory TO '+apiRole);");
const file='migrations/postgres/runtime.json',manifest=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(manifest.version,130);manifest.version=131;manifest.migrations.push({name:'134-native-member-business-access.sql',sha256:createHash('sha256').update(fs.readFileSync('migrations/postgres/134-native-member-business-access.sql')).digest('hex')});fs.writeFileSync(file,JSON.stringify(manifest,null,2)+'\n');console.log('Native business membership projection appended; legacy lock anchors retained.');
