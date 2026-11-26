import fs from 'node:fs';
import assert from 'node:assert/strict';
const file='scripts/operations-directory-proof.ts',source=fs.readFileSync(file,'utf8'),old="for(const process of [...c.running].reverse())if(process.label.startsWith('api-')";assert.ok(source.includes(old));fs.writeFileSync(file,source.replace(old,"await c.observe('observed-directory-before-restart');for(const process of [...c.running].reverse())if(process.label.startsWith('api-')"));
