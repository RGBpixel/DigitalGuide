import {describe} from 'vitest';
import {enterpriseIdentityContract} from './enterprise-identity-contract.js';
import {nativeIdentityFixture} from './enterprise-identity-fixtures.js';
describe.sequential('原生PostgreSQL企业登录与账户生命周期',()=>enterpriseIdentityContract(nativeIdentityFixture,'postgres'));
