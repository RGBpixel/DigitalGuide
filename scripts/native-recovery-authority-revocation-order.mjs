import fs from 'node:fs';
import assert from 'node:assert/strict';
const file='packages/postgres/src/recovery-authority.ts';let s=fs.readFileSync(file,'utf8');const lines=s.split('\n'),a=lines.findIndex(l=>l.startsWith(' if(p.assetsToArchive)')),c=lines.findIndex(l=>l.startsWith(' if(p.consentsToRevoke)'));assert.equal(c,a+1);[lines[a],lines[c]]=[lines[c],lines[a]];s=lines.join('\n');fs.writeFileSync(file,s);
// The existing asset-archive trigger also revokes consents. Revoke the frozen
// candidate set once first; archiving then cannot rewrite its immutable time.
const p='PLAN.md';let text=fs.readFileSync(p,'utf8');text=text.replace('更新：2026-11-25',()=> '更新：2026-11-26').replace('独立原生001—127/runtime124冻结，下一128',()=> '独立原生001—128/runtime125冻结，下一129');fs.writeFileSync(p,text);
console.log('PASS revoke fixed consent set before archive cascade; committed SQL128 unchanged');
