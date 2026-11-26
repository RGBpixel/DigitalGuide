import {describe} from 'vitest';
import {directoryAccessAuthorityContract} from './enterprise-directory-access-authority-contract.js';
import {nativeDirectoryAccessFixture} from './enterprise-directory-access-fixtures.js';
describe.sequential('原生组映射委托与回执范围',()=>directoryAccessAuthorityContract(nativeDirectoryAccessFixture));
