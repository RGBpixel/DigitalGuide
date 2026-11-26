import {describe} from 'vitest';
import {sqliteShelfFixture} from './resource-shelf-fixtures.js';
import {resourceShelfContract} from './resource-shelf-contract.js';
describe('SQLite货架运营、来源与一次模板生成',()=>resourceShelfContract(sqliteShelfFixture,'sqlite'));
