import fs from 'node:fs';
import assert from 'node:assert/strict';
function edit(file,changes){let text=fs.readFileSync(file,'utf8');for(const[before,after]of changes){assert.equal(text.split(before).length,2,file+': '+before);text=text.replace(before,after);}fs.writeFileSync(file,text);}
edit('apps/api/src/config.ts',[
 ['nativeDiningUiPreview?:true }','nativeDiningUiPreview?:true;nativeFoodUiPreview?:true }'],
 ["  const nativeDiningUiPreview=process.env.NATIVE_DINING_UI_PREVIEW==='1';","  const nativeDiningUiPreview=process.env.NATIVE_DINING_UI_PREVIEW==='1';\n  if(process.env.NATIVE_FOOD_UI_PREVIEW&&!['0','1'].includes(process.env.NATIVE_FOOD_UI_PREVIEW))throw new Error('NATIVE_FOOD_UI_PREVIEW只能为0或1。');\n  const nativeFoodUiPreview=process.env.NATIVE_FOOD_UI_PREVIEW==='1';"],
 ["  if(recoveryValidationOnly&&!existsSync", "  if(nativeFoodUiPreview&&(!nativePostgres||appEnv==='production'||providerMode!=='mock'||recoveryValidationOnly))throw new Error('偏好界面预览仅限独立原生、开发/沙箱和mock验证实例。');\n  if(recoveryValidationOnly&&!existsSync"],
 ["...(nativeDiningUiPreview?{nativeDiningUiPreview:true as const}:{})","...(nativeDiningUiPreview?{nativeDiningUiPreview:true as const}:{}),...(nativeFoodUiPreview?{nativeFoodUiPreview:true as const}:{})"]
]);
edit('apps/api/src/app.ts',[["  if(config.nativeDiningUiPreview&&!config.nativePostgres)","  if(config.nativeFoodUiPreview&&!config.nativePostgres)throw new AppError('NATIVE_PREVIEW_MODE_INVALID','偏好界面预览仅限独立原生mock验证实例。',503);\n  if(config.nativeDiningUiPreview&&!config.nativePostgres)"]]);
edit('packages/postgres/src/runtime-repository.ts',[[" diningUiPreview=false;"," diningUiPreview=false;\n foodUiPreview=false;"]]);
for(const file of ['apps/api/src/postgres-core-app.ts','apps/worker/src/postgres-core.ts'])edit(file,[["repo.diningUiPreview=config.nativeDiningUiPreview===true;","repo.diningUiPreview=config.nativeDiningUiPreview===true;repo.foodUiPreview=config.nativeFoodUiPreview===true;"]]);
for(const file of ['packages/postgres/src/runtime-restaurant.ts','packages/postgres/src/runtime-reception.ts']){
 const text=fs.readFileSync(file,'utf8');fs.writeFileSync(file,"import {nativeFoodUiVerified} from './native-food-ui-state.js';\n"+text);
}
edit('packages/postgres/src/runtime-restaurant.ts',[["preferences:false}","preferences:nativeFoodUiVerified||this.core.foodUiPreview}"]]);
edit('packages/postgres/src/runtime-reception.ts',[
 ["visitRegistration:false,personalMemory:false,dining:","visitRegistration:false,personalMemory:nativeFoodUiVerified||this.core.foodUiPreview,dining:"],
 ["reply=nativeDiningUiVerified||this.core.diningUiPreview?", "reply=nativeFoodUiVerified||this.core.foodUiPreview?'【模拟餐厅回复】您可以在下方核对预约、排队、座位与本次口味；本人授权的历史建议需要逐项选择、保存并再次确认后才能用于菜单推荐。点单和结账尚未启用，请联系店员；本条回复没有代您提交业务操作。':nativeDiningUiVerified||this.core.diningUiPreview?"]
]);
edit('packages/postgres/src/runtime-food.ts',[[" async recommendation(id:string,proof?:NativeDiningProof)"," async memoryImport(id:string,proof:NativeDiningProof){return diningMemoryImportSchema.parse(await this.call<unknown>('dg_native_food_memory_import_project',[id,proof.id,proof.tokenHash]));}\n async recommendation(id:string,proof?:NativeDiningProof)"]]);
edit('packages/postgres/src/runtime-bootstrap.ts',[["'dg_native_food_result(text,text,text)'","'dg_native_food_result(text,text,text)','dg_native_food_memory_import_project(text,text,text)'"]]);
edit('apps/api/src/postgres-dining-routes.ts',[[" function guestInput(schema:z.ZodType,raw:unknown)"," app.get(base+'/guest/sessions/:id/dining/memory-imports/:importId',async(req,reply)=>{const credentials=await prepareGuest(req);return send(req,reply,await repo.db.transaction(()=>dining.memoryImport(id(req,'importId'),{id:id(req),tokenHash:credentials.tokenHash})));});\n function guestInput(schema:z.ZodType,raw:unknown)"]]);
const partyFile='apps/web/src/restaurant/DiningPartyPanel.tsx';let party=fs.readFileSync(partyFile,'utf8');const marker='const preferenceDefaults=';assert.equal(party.split(marker).length,2);party=party.slice(0,party.indexOf(marker));
party=party.replace("import { useMutation,useQuery }", "import { useMutation }").replace('DiningHoldPlan,DiningMemoryImport,DiningParty,DiningPreference,DiningRecommendation,PublicMenu','DiningHoldPlan,DiningParty,PublicMenu').replace('localInput,money,minor,partyState,tags','localInput,partyState');
const before='focusVersion={guestBase?focusVersion:undefined} automatic={automatic}';assert.equal(party.split(before).length,2);party=party.replace(before,'focusVersion={guestBase?focusVersion:undefined} selectionVersion={selectionVersion} automatic={automatic}');
party="import {PreferenceForm,Recommendation} from './DiningPreferences.js';\n"+party;fs.writeFileSync(partyFile,party);
edit('apps/web/src/people/PeoplePage.tsx',[["changed={data => {client.setQueryData(key, data);void client.invalidateQueries({queryKey:['guest-session',session.id]});}}","changed={data => {client.setQueryData(key, data);void client.invalidateQueries({queryKey:['guest-session',session.id]});if(session.scene==='restaurant'){void client.invalidateQueries({queryKey:['guest-dining',session.id]});void client.invalidateQueries({queryKey:['dining-memory-source']});}}}"]]);
console.log(JSON.stringify({result:'FOOD_UI_SOURCE_UPDATED',previewDefault:false,migrationsChanged:false}));
