import {describe} from 'vitest';
import {directoryUiContract} from './enterprise-directory-ui-contract.js';
import {sqliteDirectoryUiFixture} from './enterprise-directory-ui-fixtures.js';
describe.sequential('SQLite企业目录管理展示',()=>directoryUiContract(sqliteDirectoryUiFixture,'sqlite'));
