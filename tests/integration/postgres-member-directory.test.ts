import {describe} from 'vitest';
import {memberDirectoryContract} from './member-directory-contract.js';
import {nativeMemberFixture} from './member-directory-fixtures.js';
describe.sequential('原生PostgreSQL环境成员目录',()=>memberDirectoryContract(nativeMemberFixture,'postgres'));
