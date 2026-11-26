import { developerWebhooksContract } from './developer-webhooks-contract.js';
import { sqliteWebhookFixture } from './developer-webhooks-fixtures.js';
developerWebhooksContract(sqliteWebhookFixture, 'sqlite');
