import {describe} from 'vitest';
import {sqlitePlanFixture} from './enterprise-plan-fixtures.js';
import {enterprisePlanContract} from './enterprise-plan-contract.js';
describe('SQLite持久套餐、席位及核心任务准入',()=>enterprisePlanContract(sqlitePlanFixture,'sqlite'));
