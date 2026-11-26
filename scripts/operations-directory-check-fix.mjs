import fs from 'node:fs';
import assert from 'node:assert/strict';
const file='tests/unit/postgres-runtime.test.ts',old=fs.readFileSync(file,'utf8');assert.ok(old.includes("'134-native-member-business-access.sql']"));fs.writeFileSync(file,old.replace("'134-native-member-business-access.sql']","'134-native-member-business-access.sql','135-native-enterprise-directory.sql']"));
