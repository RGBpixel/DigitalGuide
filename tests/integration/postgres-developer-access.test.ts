import { developerAccessContract } from './developer-access-contract.js';
import { nativeDeveloperFixture } from './developer-access-fixtures.js';
developerAccessContract(nativeDeveloperFixture, 'postgres');
