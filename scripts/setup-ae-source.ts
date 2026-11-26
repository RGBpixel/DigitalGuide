import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {aeSourceFixture} from '../packages/test-fixtures/src/ae-source.js';
import {aeRuntimeConfig} from '@digitalguide/contracts';
import {aeHash} from '../packages/providers/src/ae-catalog.js';
const directory=path.resolve(process.argv[2]||process.env.DATA_DIR||'storage'),destination=path.join(directory,'ae-source-fixture');
const base=process.argv[3]?aeRuntimeConfig.parse(JSON.parse(fs.readFileSync(process.argv[3],'utf8'))):null;
assert.ok(!fs.existsSync(destination),'Use a fresh source fixture directory; original files must not be overwritten.');fs.mkdirSync(destination,{recursive:true});
const fixture=aeSourceFixture(destination);
if(base){assert.equal(base.mode,fixture.runtime.mode);assert.equal(aeHash(base.command),aeHash(fixture.runtime.command));fixture.runtime.catalog=[...base.catalog,...fixture.runtime.catalog];}
fs.writeFileSync(fixture.configFile,JSON.stringify(fixture.runtime,null,2));process.stdout.write(fixture.configFile);
