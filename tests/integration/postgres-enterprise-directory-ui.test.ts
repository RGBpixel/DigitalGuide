import {describe} from 'vitest';
import {directoryUiContract} from './enterprise-directory-ui-contract.js';
import {nativeDirectoryUiFixture} from './enterprise-directory-ui-fixtures.js';
describe.sequential('原生企业目录管理展示',()=>directoryUiContract(nativeDirectoryUiFixture,'postgres'));
