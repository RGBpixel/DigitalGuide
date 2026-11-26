import fs from 'node:fs';
import assert from 'node:assert/strict';
function edit(file,changes){let text=fs.readFileSync(file,'utf8');for(const[before,after]of changes){assert.equal(text.split(before).length,2,file+': '+before);text=text.replace(before,after);}fs.writeFileSync(file,text);}
edit('packages/contracts/src/index.ts',[
 [" const result=path.endsWith('/table-plan')?diningHoldPlanSchema:"," const nativeBody=guest&&schema instanceof z.ZodObject?schema.safeExtend({focusVersion:z.int().nonnegative(),selectionVersion:z.int().nonnegative()}):null;\n const requestSchema=nativeBody?{oneOf:[z.toJSONSchema(body,{io:'input'}),z.toJSONSchema(nativeBody,{io:'input'})],'x-native-postgres-schema-index':1,description:'原生PostgreSQL顾客接口使用第二分支，必须携带当前focusVersion与selectionVersion；SQLite使用第一分支。'}:z.toJSONSchema(body,{io:'input'});\n const result=path.endsWith('/table-plan')?diningHoldPlanSchema:"],
 ["schema:z.toJSONSchema(body,{io:'input'})","schema:requestSchema"]
]);
const file='packages/contracts/src/index.ts';let spec=fs.readFileSync(file,'utf8');const marker="export * from './billing.js';";assert.equal(spec.split(marker).length,2);
spec=spec.replace(marker,`openapi.paths['/guest/sessions/{id}/dining/memory-imports/{importId}']={get:{summary:'原生餐厅顾客读取本人当前仍有效的建议快照',security:[{guestSession:[]}],'x-native-postgres-only':true,parameters:[{name:'id',in:'path',required:true,schema:{type:'string',format:'uuid'}},{name:'importId',in:'path',required:true,schema:{type:'string',format:'uuid'}}],responses:{'200':{description:'当前本人、门店、发问人和就餐选择范围内的建议',content:{'application/json':{schema:z.toJSONSchema(responseSchema(diningMemoryImportSchema))}}},...Object.fromEntries(['401','403','404','409'].map(code=>[code,{description:'授权或建议来源已失效',content:{'application/json':{schema:z.toJSONSchema(errorSchema)}}}]))}}};
`+marker);fs.writeFileSync(file,spec);
edit('apps/web/src/people/PeoplePage.tsx',[
 ["roles: session ? ['visitor'] : []","roles: session ? [session.scene==='restaurant'?'customer':'visitor'] : []"],
 ["  return query.error ? <div className=\"error\" role=\"alert\">{query.error.message}","  return <>{session.scene==='restaurant'&&<p className=\"visit-help\">本人资料仅用于本店接待和本次授权建议，不与企业前台或其他门店默认共享；就餐恢复凭证不会恢复本人资料。</p>}{query.error ? <div className=\"error\" role=\"alert\">{query.error.message}"],
 ["无法载入本次偏好，请重新开始接待。</div>;","无法载入本次偏好，请重新开始接待。</div>}</>;"]
]);
edit('tests/unit/postgres-runtime.test.ts',[["'NATIVE_DINING_UI_PREVIEW']","'NATIVE_DINING_UI_PREVIEW','NATIVE_FOOD_UI_PREVIEW']"]]);
console.log(JSON.stringify({result:'CONTRACT_AND_MEMORY_PURPOSE_UI_UPDATED',nativeSelectionVersionRequired:true}));
