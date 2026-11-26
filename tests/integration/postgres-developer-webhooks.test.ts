import { developerWebhooksContract } from './developer-webhooks-contract.js';
import { nativeWebhookFixture } from './developer-webhooks-fixtures.js';
developerWebhooksContract(nativeWebhookFixture, 'postgres');
