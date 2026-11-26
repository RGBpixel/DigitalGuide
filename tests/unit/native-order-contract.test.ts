import {describe,expect,it} from 'vitest';
import {openapi} from '@digitalguide/contracts';
type Schema={oneOf?:Schema[];required?:string[];additionalProperties?:boolean;properties?:Record<string,unknown>;'x-native-postgres-schema-index'?:number};
type Operation={requestBody?:{content:{'application/json':{schema:Schema}}}};
const paths=openapi.paths as unknown as Record<string,{post?:Operation}>;
describe('原生点单请求和旧接口明确区分',()=>{
 it('原生草稿、确认和提交必须携带当前发问人与就餐选择版本',()=>{for(const path of ['/guest/sessions/{id}/dining/parties/{partyId}/orders',...['update','review','confirm','submit','withdraw'].map(action=>'/guest/sessions/{id}/dining/changes/{changeId}/'+action)]){const schema=paths[path].post!.requestBody!.content['application/json'].schema;expect(schema['x-native-postgres-schema-index']).toBe(1);expect(schema.oneOf).toHaveLength(2);expect(schema.oneOf![1].required).toEqual(expect.arrayContaining(['focusVersion','selectionVersion']));expect(schema.oneOf![1].additionalProperties).toBe(false);}});
 it('旧点单接口保持原字段，不接受原生选择版本',()=>{const schema=paths['/guest/sessions/{id}/dining/changes/{changeId}/submit'].post!.requestBody!.content['application/json'].schema;expect(schema.oneOf![0].properties).not.toHaveProperty('selectionVersion');expect(schema.oneOf![0].additionalProperties).toBe(false);expect(schema.oneOf![1].properties?.selectionVersion).toMatchObject({type:'integer',minimum:0});});
});
