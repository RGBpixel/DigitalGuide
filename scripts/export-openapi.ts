import { mkdirSync, writeFileSync } from 'node:fs';
import { openapi } from '@digitalguide/contracts';
import {registerNativeSpeakerHandoffSpec} from '../packages/contracts/src/native-speaker-handoff-openapi.js';
import {registerNativeRestaurantSpec} from '../packages/contracts/src/native-restaurant-openapi.js';
registerNativeSpeakerHandoffSpec(openapi);
registerNativeRestaurantSpec(openapi);
mkdirSync('docs/api', { recursive: true });
writeFileSync('docs/api/openapi.json', JSON.stringify(openapi, null, 2) + '\n');
console.log('已由共享 Zod 契约生成 docs/api/openapi.json。');
