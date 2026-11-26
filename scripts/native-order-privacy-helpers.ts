import {createHash} from 'node:crypto';
import {expect,type Page,type Route} from '@playwright/test';
/** Capture real authorized reads before a scope change; never fabricate a successful response. */
export async function holdOrderReads(page:Page,accept:(url:URL)=>boolean,errors:string[]){
 const pattern='**/api/v1/**',captured=new Map<string,{path:string;status:number;sha256:string}>(),pending=new Set<Promise<void>>();let opened=false,release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
 const handler=async(route:Route)=>{if(opened||route.request().method()!=='GET'||!accept(new URL(route.request().url()))){await route.continue();return;}let done!:()=>void;const job=new Promise<void>(r=>{done=r;});pending.add(job);try{const response=await route.fetch(),url=new URL(route.request().url());captured.set(url.pathname,{path:url.pathname,status:response.status(),sha256:createHash('sha256').update(await response.body()).digest('hex')});await gate;await route.fulfill({response});}catch(error){if(!/abort|cancel|closed|already handled/i.test(String(error)))errors.push(String(error));}finally{done();pending.delete(job);}};
 await page.route(pattern,handler);
 return{async wait(path:string){await expect.poll(()=>captured.get(path)?.status,{timeout:15000}).toBe(200);},records:()=>[...captured.values()],async release(){opened=true;release();await Promise.all([...pending]);await page.unroute(pattern,handler);}};
}
