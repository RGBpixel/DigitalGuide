import {directoryLifecycleContract} from './enterprise-directory-lifecycle-contract.js';
import {sqliteDirectoryLifecycleFixture} from './enterprise-directory-lifecycle-fixtures.js';
directoryLifecycleContract(sqliteDirectoryLifecycleFixture,'sqlite');
