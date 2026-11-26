import {describe} from 'vitest';
import {enterpriseDirectoryContract} from './enterprise-directory-contract.js';
import {nativeDirectoryFixture} from './enterprise-directory-fixtures.js';
describe.sequential('PostgreSQL受控企业目录',()=>enterpriseDirectoryContract(nativeDirectoryFixture,'postgres'));
