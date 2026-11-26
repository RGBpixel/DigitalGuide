// Explicit main-preview contract fixture. No Adobe application or real person's media is used.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {aeContractFixture} from '../packages/test-fixtures/src/ae-templates.js';
const statePath=path.resolve('storage/ae-preview-state.json'),directory=path.resolve('storage/ae-contract-preview');
if(fs.existsSync(statePath)){const state=JSON.parse(fs.readFileSync(statePath,'utf8'));assert.ok(typeof state.configFile==='string'&&state.configFile.startsWith(directory+path.sep));assert.ok(fs.existsSync(state.configFile));const config=JSON.parse(fs.readFileSync(state.configFile,'utf8'));assert.equal(config.mode,'contract_test');process.stdout.write(state.configFile);}else{assert.ok(!fs.existsSync(directory),'Existing unowned fixture directory will not be overwritten.');const fixture=aeContractFixture(directory);fs.writeFileSync(statePath,JSON.stringify({ids:{},operations:{},configFile:fixture.configFile,mode:'contract_test'},null,2)+'\n',{flag:'wx'});process.stdout.write(fixture.configFile);}
