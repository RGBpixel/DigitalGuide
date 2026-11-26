import {describe} from 'vitest';
import {directoryAccessAuthorityContract} from './enterprise-directory-access-authority-contract.js';
import {sqliteDirectoryAccessFixture} from './enterprise-directory-access-fixtures.js';
describe.sequential('SQLite组映射委托与回执范围',()=>directoryAccessAuthorityContract(sqliteDirectoryAccessFixture));
