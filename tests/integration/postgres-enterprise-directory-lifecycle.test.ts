import {directoryLifecycleContract} from './enterprise-directory-lifecycle-contract.js';
import {nativeDirectoryLifecycleFixture} from './enterprise-directory-lifecycle-fixtures.js';
directoryLifecycleContract(nativeDirectoryLifecycleFixture,'postgres');
