import fs from 'node:fs';
import assert from 'node:assert/strict';
const edit=(file,pairs)=>{let text=fs.readFileSync(file,'utf8');for(const[before,after]of pairs){assert.equal(text.split(before).length,2,before);text=text.replace(before,after);}fs.writeFileSync(file,text);};
edit('apps/web/src/restaurant/DiningPartyPanel.tsx',[["{capabilities?.hospitality!==false&&<><DiningServicePanel {...props}/><DiningAftercarePanel {...props}/></>}","{(capabilities?.serviceRequests===true||capabilities?.hospitality!==false)&&<DiningServicePanel {...props} native={capabilities?.serviceRequests!==undefined}/>} {capabilities?.hospitality!==false&&<DiningAftercarePanel {...props}/>}"]]);
edit('apps/web/src/restaurant/RestaurantPage.tsx',[
 ["['services','服务与餐后']","['services',r.capabilities?.hospitality===false?'餐中服务':'服务与餐后']"],
 ["id!=='services'||r.capabilities?.hospitality!==false","id!=='services'||r.capabilities?.serviceRequests===true||r.capabilities?.hospitality!==false"],
 ["tab==='services'?r.capabilities?.hospitality===false?","tab==='services'?(r.capabilities?.serviceRequests!==true&&r.capabilities?.hospitality===false)?"],
 ["<DiningServiceBoard restaurantId={rid}/><DiningAftercareBoard restaurantId={rid}/>","<DiningServiceBoard key={rid} restaurantId={rid}/>{r.capabilities?.hospitality!==false&&<DiningAftercareBoard restaurantId={rid}/>}"],
]);
edit('tests/unit/postgres-runtime.test.ts',[["'NATIVE_FOOD_UI_PREVIEW','NATIVE_ORDER_UI_PREVIEW']","'NATIVE_FOOD_UI_PREVIEW','NATIVE_ORDER_UI_PREVIEW','NATIVE_HOSPITALITY_UI_PREVIEW']"]]);
console.log(JSON.stringify({result:'PASS_SERVICE_UI_WIRING_APPLIED',mainRuntimeChanged:false}));
