import {describe} from 'vitest';
import {directoryAccessContract} from './enterprise-directory-access-contract.js';
import {nativeDirectoryAccessFixture} from './enterprise-directory-access-fixtures.js';
describe.sequential('原生目录组权限映射',()=>directoryAccessContract(nativeDirectoryAccessFixture,'postgres'));
