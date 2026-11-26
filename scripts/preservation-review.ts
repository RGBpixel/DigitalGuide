// Keeps the raw all-table result intact; assesses only captured expired-auth evidence.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
const [baselineArg,reportArg,outputArg]=process.argv.slice(2);assert.ok(baselineArg&&reportArg&&outputArg,'Provide original baseline, raw report and separate assessment paths.');
const baselinePath=path.resolve(baselineArg),reportPath=path.resolve(reportArg),outputPath=path.resolve(outputArg);assert.notEqual(outputPath,baselinePath);assert.notEqual(outputPath,reportPath);
const originalBytes=fs.readFileSync(baselinePath),before=JSON.parse(originalBytes.toString()),raw=JSON.parse(fs.readFileSync(reportPath,'utf8')),hash=(row:unknown)=>createHash('sha256').update(JSON.stringify(row)).digest('hex');
const businesses=raw.checks.filter((r:{table:string})=>r.table!=='auth_sessions'),businessMissing=businesses.reduce((n:number,r:{missingOrChangedOriginalRows:number})=>n+r.missingOrChangedOriginalRows,0),db=new DatabaseSync(before.database,{readOnly:true});
try{
 const currentAuth=new Set(db.prepare('SELECT * FROM auth_sessions').all().map(hash)),removed=(before.authSessionExpiry as {rowHash:string;expiresAt:string}[]).filter(row=>!currentAuth.has(row.rowHash)),allExpired=removed.every(row=>Number.isFinite(Date.parse(row.expiresAt))&&Date.parse(row.expiresAt)<=Date.parse(raw.checkedAt)),authMissing=raw.checks.find((r:{table:string})=>r.table==='auth_sessions')?.missingOrChangedOriginalRows||0,pass=businessMissing===0&&allExpired&&removed.length===authMissing;
 const result={result:pass?'PASS_ORIGINAL_BUSINESS_ROWS_WITH_EXPIRED_AUTH_REMOVALS':'FAIL',rawFullTableResult:raw.result,rawReport:path.relative(process.cwd(),reportPath),baselineCapturedAt:before.capturedAt,baselineSHA256:createHash('sha256').update(originalBytes).digest('hex'),originalTables:raw.tables,originalRows:raw.originalRows,businessTables:businesses.length,originalBusinessRows:businesses.reduce((n:number,r:{originalRows:number})=>n+r.originalRows,0),missingOrChangedOriginalBusinessRows:businessMissing,removedAuthenticationRows:removed.length,allRemovedAuthenticationRowsObservedExpired:allExpired,expiryEvidence:removed,explanation:'原始全表报告保持原结果。已有登录时清理过期会话的路径可解释本次差异；未独立审计每条删除事务，不将解释替代原始报告，不恢复过期凭证或更换基线。',checkedAt:new Date().toISOString()};fs.writeFileSync(outputPath,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({result:result.result,businessTables:result.businessTables,businessRows:result.originalBusinessRows,missingBusinessRows:businessMissing,removedExpiredAuth:removed.length,raw:raw.result}));if(!pass)process.exitCode=1;
}finally{db.close();}
