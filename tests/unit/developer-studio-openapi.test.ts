import { describe, expect, it } from 'vitest';
import { openapi } from '../../packages/contracts/src/index.js';
type Operation={security:unknown[];parameters:{name:string;required?:boolean}[];responses:Record<string,{content?:unknown}>;'x-developer-actions'?:string[];requestBody?:{content:{'application/json':{schema:{properties:Record<string,unknown>;additionalProperties:boolean}}}}};
const paths=openapi.paths as Record<string,{servers?:unknown[];get?:Operation;post?:Operation;head?:Operation}>;
describe('应用制作API的公开契约',()=>{
 it('人员委托和机器执行使用各自鉴权，所有写入需要操作编号和明确确认',()=>{
  expect(paths['/enterprise/developer-studio/configure'].post!.security).toEqual([{session:[]}]);
  for(const suffix of ['/projects','/projects/{id}/save','/projects/{id}/exports','/exports/{id}/cancel']){const route=paths['/open/v1/studio'+suffix],op=route.post!;expect(route.servers).toEqual([{url:'/api'}]);expect(op.security).toEqual([{developerBearer:[]}]);expect(op.parameters).toContainEqual(expect.objectContaining({name:'Idempotency-Key',required:true}));expect(op.requestBody!.content['application/json'].schema.properties.confirmed).toEqual(expect.objectContaining({const:true}));}
  const create=paths['/open/v1/studio/projects'].post!.requestBody!.content['application/json'].schema;expect(create.additionalProperties).toBe(false);expect(create.properties).not.toHaveProperty('workspaceId');expect(create.properties).not.toHaveProperty('actorId');
 });
 it('工程正文和导出动作分开说明，所有机器接口声明共享限频',()=>{
  expect(paths['/open/v1/studio/projects/{id}'].get!['x-developer-actions']).toEqual(['projects.write']);expect(paths['/open/v1/studio/projects/{id}/exports'].post!['x-developer-actions']).toEqual(['exports.submit']);expect(paths['/open/v1/studio/exports/{id}/cancel'].post!['x-developer-actions']).toEqual(['exports.cancel']);
  for(const [name,route] of Object.entries(paths).filter(([name])=>name.startsWith('/open/v1/studio')))for(const op of [route.get,route.post,route.head].filter(Boolean) as Operation[]){expect(op.responses['429'],name).toBeDefined();expect(op.security).toEqual([{developerBearer:[]}]);}
 });
 it('下载与HEAD声明独立授权、Range、If-Range及无正文响应',()=>{
  const route=paths['/open/v1/studio/exports/{id}/files/{artifactId}'];for(const op of [route.get!,route.head!]){expect(op['x-developer-actions']).toEqual(['exports.download']);expect(op.parameters.map(p=>p.name)).toEqual(['id','artifactId','Range','If-Range']);for(const status of ['200','206','416','401','403','409'])expect(op.responses[status]).toBeDefined();}
  expect(route.get!.responses['200'].content).toHaveProperty('video/mp4');expect(route.head!.responses['200'].content).toBeUndefined();expect(route.head!.responses['206'].content).toBeUndefined();
 });
});
