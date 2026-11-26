import { developerAccessContract } from './developer-access-contract.js';
import { sqliteDeveloperFixture } from './developer-access-fixtures.js';
developerAccessContract(sqliteDeveloperFixture, 'sqlite');
