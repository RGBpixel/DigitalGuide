import fs from 'node:fs';
import assert from 'node:assert/strict';
let source=fs.readFileSync('tests/integration/postgres-recovery-journal-restore.test.ts','utf8');for(const[from,to]of [["docs/evidence/T20/postgres-recovery-journal","docs/evidence/T20/postgres-recovery-privacy"],["函数签名排序v2备份与隔离副本的恢复核对","保守清理增量下的原恢复计划兼容与拒绝边界"]]){assert.equal(source.split(from).length,2);source=source.replace(from,()=>to);}fs.writeFileSync('tests/integration/postgres-recovery-privacy-plan.test.ts',source,{flag:'wx'});
