import {describe} from 'vitest';
import {directoryAccessContract} from './enterprise-directory-access-contract.js';
import {sqliteDirectoryAccessFixture} from './enterprise-directory-access-fixtures.js';
describe.sequential('SQLite目录组权限映射',()=>directoryAccessContract(sqliteDirectoryAccessFixture,'sqlite'));
