import path from 'node:path';
import assert from 'node:assert/strict';
import {aeContractFixture} from '../packages/test-fixtures/src/ae-templates.js';
const directory=path.resolve(process.argv[2]||''),root=path.resolve('storage/e2e-runs'),validation=path.resolve('storage/validation');assert.ok(directory.startsWith(root+path.sep)||directory.startsWith(validation+path.sep),'Contract setup is only for isolated E2E/validation runs.');assert.equal(process.env.APP_ENV,'development');assert.equal(process.env.PROVIDER_MODE,'mock');const fixture=aeContractFixture(directory);process.stdout.write(fixture.configFile);
