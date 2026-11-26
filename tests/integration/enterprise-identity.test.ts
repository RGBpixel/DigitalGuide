import {describe} from 'vitest';
import {enterpriseIdentityContract} from './enterprise-identity-contract.js';
import {sqliteIdentityFixture} from './enterprise-identity-fixtures.js';
describe.sequential('SQLite企业登录与账户生命周期',()=>enterpriseIdentityContract(sqliteIdentityFixture,'sqlite'));
