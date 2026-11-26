import {describe,expect,it} from 'vitest';
import {openapi} from '@digitalguide/contracts';
type Schema={oneOf?:Schema[];required?:string[];additionalProperties?:boolean;properties?:Record<string,unknown>;'x-native-postgres-schema-index'?:number};
type Operation={security?:unknown[];'x-native-postgres-only'?:boolean;requestBody?:{content:{'application/json':{schema:Schema}}}};
const paths=openapi.paths as unknown as Record<string,{post?:Operation;get?:Operation}>;
describe('原生餐厅选择版本和本人建议读取契约',()=>{
 it('原生顾客写入要求焦点与就餐选择版本，和SQLite分支可明确区分',()=>{for(const suffix of ['preferences','preferences/confirm','recommendations','memory-import']){const body=paths['/guest/sessions/{id}/dining/parties/{partyId}/'+suffix].post!.requestBody!.content['application/json'].schema;expect(body['x-native-postgres-schema-index']).toBe(1);expect(body.oneOf).toHaveLength(2);expect(body.oneOf![1].required).toEqual(expect.arrayContaining(['focusVersion','selectionVersion']));expect(body.oneOf![1].additionalProperties).toBe(false);}});
 it('SQLite分支保持原字段集合，原生分支声明选择版本且不能为负数',()=>{const body=paths['/guest/sessions/{id}/dining/parties/{partyId}/memory-import'].post!.requestBody!.content['application/json'].schema;expect(body.oneOf![0].properties).not.toHaveProperty('selectionVersion');expect(body.oneOf![1].properties).toHaveProperty('selectionVersion',expect.objectContaining({type:'integer',minimum:0}));});
 it('本人建议读取明确为原生专用且需要访客会话，不授予员工读取权限',()=>{const operation=paths['/guest/sessions/{id}/dining/memory-imports/{importId}'].get!;expect(operation['x-native-postgres-only']).toBe(true);expect(operation.security).toEqual([{guestSession:[]}]);});
});
