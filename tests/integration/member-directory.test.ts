import {describe} from 'vitest';
import {memberDirectoryContract} from './member-directory-contract.js';
import {sqliteMemberFixture} from './member-directory-fixtures.js';
describe.sequential('SQLite环境成员目录',()=>memberDirectoryContract(sqliteMemberFixture,'sqlite'));
