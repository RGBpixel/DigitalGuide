import {it,expect,vi} from 'vitest';
import type {SQLInputValue} from 'node:sqlite';
import {Repository} from '@digitalguide/database';
import {AdvertisingService} from '../../apps/api/src/advertising-service.js';
import type {AdRunRow} from '../../apps/api/src/advertising-state.js';
import {harness} from './helpers.js';
import {advertisingActivated} from './advertising-helpers.js';
import {shareApi} from './share-helpers.js';
it('读取中另一数据库连接确认暂停时，计划、执行和预算仍取自同一快照，下一次读取才切换',async()=>{
 const h=await harness();let peer:Repository|undefined;try{const p=await advertisingActivated(h),id=p.campaign.id;peer=new Repository(h.config.dataDir,h.config.root,{environment:'mock',appEnv:'development'});const service=new AdvertisingService(peer,h.config),original=h.repo.get.bind(h.repo);let committed=false;const spy=vi.spyOn(h.repo,'get').mockImplementation(function<T>(sql:string,...values:SQLInputValue[]):T|undefined{const row=original<T>(sql,...values);if(!committed&&sql.startsWith('SELECT * FROM ad_campaigns WHERE id=? AND tenant_id=?')){committed=true;peer!.transaction(()=>{const run=peer!.get<AdRunRow>('SELECT * FROM ad_runs WHERE campaign_id=?',id)!;service.requestPause(run,'另一工作进程在读取期间确认未提交排期已暂停');});}return row;});let response=await shareApi(h).get('/campaigns/'+id);spy.mockRestore();expect(response.statusCode,response.body).toBe(200);expect(committed).toBe(true);expect(response.json().data).toMatchObject({status:'scheduled',cost:{committedRemainingMinor:2000},runs:[{status:'scheduled'}]});response=await shareApi(h).get('/campaigns/'+id);expect(response.json().data).toMatchObject({status:'paused',cost:{committedRemainingMinor:0},runs:[{status:'paused'}]});}finally{vi.restoreAllMocks();peer?.close();await h.close();}
},120000);
