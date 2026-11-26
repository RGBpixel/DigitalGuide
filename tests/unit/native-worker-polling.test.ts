import {describe,it,expect} from 'vitest';
import {NativeWorkerPolling} from '../../packages/postgres/src/runtime-worker-polling.js';

describe('R-058原生worker空队列让出数据库容量',()=>{
 it('空队列暂缓查询，持续有任务的其他队列可以立即工作',async()=>{let now=0,idle=0,busy=0;const p=new NativeWorkerPolling(()=>now);const empty=async()=>{idle++;return false;},active=async()=>{busy++;return true;};await p.run('empty',empty);for(let n=0;n<5;n++){now+=80;expect(await p.run('empty',empty)).toBe(false);expect(await p.run('active',active)).toBe(true);}expect(idle).toBe(1);expect(busy).toBe(5);now=500;await p.run('empty',empty);expect(idle).toBe(2);});
 it('有任务时不增加空队列延迟，也不替代外层正在执行的并发控制',async()=>{let release!:()=>void,count=0;const p=new NativeWorkerPolling(()=>0),gate=new Promise<void>(resolve=>{release=resolve;}),work=async()=>{count++;await gate;return true;},first=p.run('output',work),second=p.run('output',work);expect(count).toBe(2);release();expect(await first).toBe(true);expect(await second).toBe(true);expect(await p.run('output',async()=>true)).toBe(true);});
 it('失败继续向调用方抛出，其短暂退避不阻断其他任务',async()=>{let now=0,count=0;const p=new NativeWorkerPolling(()=>now),error=new Error('contract failure');await expect(p.run('failed',async()=>{count++;throw error;})).rejects.toBe(error);now=500;expect(await p.run('failed',async()=>{count++;return true;})).toBe(false);expect(await p.run('other',async()=>true)).toBe(true);expect(count).toBe(1);now=1000;expect(await p.run('failed',async()=>{count++;return true;})).toBe(true);expect(count).toBe(2);});
});
