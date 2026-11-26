import {describe,expect,it} from 'vitest';
import {openapi,diningServiceInput,nativeDiningServiceInput} from '@digitalguide/contracts';
type Schema={oneOf?:Schema[];required?:string[];additionalProperties?:boolean;properties?:Record<string,unknown>;'x-native-postgres-schema-index'?:number};
const paths=openapi.paths as unknown as Record<string,{post:{requestBody:{content:{'application/json':{schema:Schema}}}}}>;
describe('餐中服务接口的运行时合同',()=>{
 it('原生员工操作携带当前就餐版本，旧SQLite分支不接受该字段',()=>{
  for(const path of ['/restaurant/parties/{partyId}/services','/restaurant/services/{requestId}/actions']){
   const schema=paths[path].post.requestBody.content['application/json'].schema;
   expect(schema['x-native-postgres-schema-index']).toBe(1);
   expect(schema.oneOf).toHaveLength(2);
   expect(schema.oneOf![0].properties).not.toHaveProperty('partyVersion');
   expect(schema.oneOf![1].required).toContain('partyVersion');
   expect(schema.oneOf!.every(s=>s.additionalProperties===false)).toBe(true);
  }
 });
 it('原生顾客服务同时要求当前就餐、发问人和选择版本',()=>{
  for(const path of ['/guest/sessions/{id}/dining/parties/{partyId}/services','/guest/sessions/{id}/dining/services/{requestId}/actions']){
   const schema=paths[path].post.requestBody.content['application/json'].schema;
   expect(schema.oneOf![1].required).toEqual(expect.arrayContaining(['partyVersion','focusVersion','selectionVersion','confirmed']));
   expect(schema.oneOf![0].properties).not.toHaveProperty('selectionVersion');
  }
 });
 it('明确确认和正整数版本不能省略或用旧合同静默接收',()=>{
  const body={kind:'water',note:'原创服务合同',partyVersion:1,confirmed:true};
  expect(nativeDiningServiceInput.safeParse(body).success).toBe(true);
  expect(diningServiceInput.safeParse(body).success).toBe(false);
  for(const patch of [{confirmed:false},{partyVersion:0},{partyVersion:undefined}])expect(nativeDiningServiceInput.safeParse({...body,...patch}).success).toBe(false);
 });
});
