import {describe} from 'vitest';
import {enterpriseDirectoryContract} from './enterprise-directory-contract.js';
import {sqliteDirectoryFixture} from './enterprise-directory-fixtures.js';
describe.sequential('SQLite受控企业目录',()=>enterpriseDirectoryContract(sqliteDirectoryFixture,'sqlite'));
