import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
import { randomUUID,createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { contentSourceSchema,contentBriefSchema,type ContentSource,type ContentBrief,type MediaTransfer } from '@digitalguide/contracts';
import { fixtureIds as f } from '../../packages/test-fixtures/src/seed.js';
import { originalWordContentFixture } from '../../packages/test-fixtures/src/content.js';
import { originalVideoFixture } from '../../packages/test-fixtures/src/video.js';
import { runMediaTransfer } from '../../apps/worker/src/media-transfers.js';
import { ContentSources } from '../../apps/api/src/content-sources.js';
import { harness } from './helpers.js';
let h:Awaited<ReturnType<typeof harness>>;
beforeEach(async()=>{h=await harness();});afterEach(async()=>{vi.restoreAllMocks();await h.close();});
const future=()=>new Date(Date.now()+30*86400000).toISOString(),rights=()=>({subject:'原创合成内容作者',proof:'此文字为独立原创的本地测试讲稿',expiresAt:future(),confirmed:true});
const post=(url:string,body:object,headers=h.headers,key:string=randomUUID())=>h.app.inject({method:'POST',url:'/api/v1'+url,headers:{...headers,'idempotency-key':key},payload:body});
const get=(url:string,headers=h.headers)=>h.app.inject({url:'/api/v1'+url,headers});
async function good<T>(url:string,body:object,headers=h.headers,key?:string):Promise<T>{const r=await post(url,body,headers,key);expect(r.statusCode,r.body).toBe(200);return r.json().data;}
const brief=()=>({workspaceId:f.workspaceA,name:'展厅账号定位',position:'面向参观者的原创展厅讲解',audience:'首次参观者',objective:'解释展品和参观路线',channel:'官网与线下展厅',tone:'清楚亲切',topics:['第一站如何参观','展品背后的设计']});
describe('T24内容来源与账号定位权限、版本及撤回',()=>{
  it('实际视频先完整导入再登记人工转写；原片版本/状态失效立即限制正文',async()=>{
    const file=await originalVideoFixture(path.join(h.config.dataDir,'source-video'),h.config.root,{durationMs:1000}),bytes=fs.readFileSync(file),hash=createHash('sha256').update(bytes).digest('hex');
    let transfer=await good<MediaTransfer>('/studio/transfers',{workspaceId:f.workspaceA,kind:'video',name:'内容来源原创测试片',fileName:'source.mp4',size:bytes.length,sha256:hash,partHashes:[hash],rightsNote:'平台原创色块和测试音，不含真人',rightsConfirmed:true});
    transfer=await good<MediaTransfer>('/studio/transfers/'+transfer.id+'/parts',{index:0,contentBase64:bytes.toString('base64'),sha256:hash});
    await good('/studio/transfers/'+transfer.id+'/finalize',{version:transfer.version});await runMediaTransfer(h.repo,h.config);
    transfer=(await get('/studio/transfers/'+transfer.id)).json().data;expect(transfer.status).toBe('ready');
    const input={workspaceId:f.workspaceA,name:'原片的人工校对稿',kind:'video',assetId:transfer.assetId,assetVersion:1,transcript:'这是一条人工写入且已核对的原片说明。',transcriptOrigin:'manual',rights:rights()},key=randomUUID();
    const s=await good<ContentSource>('/studio/content/sources',input,h.headers,key);expect(s.origin).toMatchObject({mode:'manual_video_transcript',assetSHA256:hash,videoDurationMs:1000});expect(s.warnings.join('')).toContain('不代表');
    h.repo.run('UPDATE assets SET archived=1 WHERE id=?',transfer.assetId);
    expect((await get('/studio/content/sources/'+s.id)).json().data).toMatchObject({text:null,available:false});
    expect((await post('/studio/content/sources',input,h.headers,key)).statusCode).toBe(409);
  },30000);
  it('异步解析后重新检查当前身份/权限；失权结果不写数据库或幂等缓存',async()=>{
    const original=ContentSources.prototype.capture;
    vi.spyOn(ContentSources.prototype,'capture').mockImplementationOnce(async(p,input)=>{
      const result=await original.call(new ContentSources(h.repo,h.config),p,input);
      h.repo.run('UPDATE memberships SET workspace_ids=? WHERE user_id=?','[]',f.adminA);return result;
    });
    const key=randomUUID(),response=await post('/studio/content/sources',{workspaceId:f.workspaceA,name:'在途Word',kind:'docx',fileName:'original.docx',contentBase64:(await originalWordContentFixture()).toString('base64'),rights:rights()},h.headers,key);
    expect(response.statusCode).toBe(404);expect(h.repo.get<{n:number}>('SELECT count(*) n FROM studio_content_sources')!.n).toBe(0);expect(h.repo.get('SELECT key FROM idempotency WHERE key=?',key)).toBeUndefined();
  });
  it('实际正文与授权入库，撤回后旧创建/撤回缓存返回当前事实而不恢复正文',async()=>{
    const input={workspaceId:f.workspaceA,name:'原创讲稿',kind:'text',text:'你好，欢迎参观。\n这里是第二段。',rights:rights()},key=randomUUID(),s=await good<ContentSource>('/studio/content/sources',input,h.headers,key);
    expect(contentSourceSchema.safeParse(s).success).toBe(true);expect(s.paragraphs).toHaveLength(2);
    const withdrawal=randomUUID(),removed=await good<ContentSource>('/studio/content/sources/'+s.id+'/withdraw',{version:1,confirmed:true},h.headers,withdrawal);
    expect(removed).toMatchObject({version:2,withdrawn:true,available:false,text:null,paragraphs:[]});
    expect(await good<ContentSource>('/studio/content/sources',input,h.headers,key)).toMatchObject({id:s.id,text:null,version:2});
    expect(await good<ContentSource>('/studio/content/sources/'+s.id+'/withdraw',{version:1,confirmed:true},h.headers,withdrawal)).toMatchObject({version:2});
    const history=(await get('/studio/content/sources/'+s.id+'/versions')).json().data;expect(history).toHaveLength(2);expect(JSON.stringify(history)).not.toContain('欢迎参观');
  });
  it('DOCX实际段落与HTML实体进入来源，文件/大小/空正文/过期用途明确拒绝',async()=>{
    const bytes=await originalWordContentFixture(),doc=await good<ContentSource>('/studio/content/sources',{workspaceId:f.workspaceA,name:'Word来源',kind:'docx',fileName:'原创讲稿.docx',contentBase64:bytes.toString('base64'),rights:rights()});
    expect(doc.text).toContain('原创合成讲稿');expect(doc.paragraphs).toHaveLength(2);expect(doc.origin.fileName).toBe('原创讲稿.docx');
    const web=await good<ContentSource>('/studio/content/sources',{workspaceId:f.workspaceA,name:'原创网页快照',kind:'web',url:'https://example.com/original',capture:'snapshot',html:'<html><head><script>隐藏指令</script></head><body><p>原创 &amp; 正文</p></body></html>',rights:rights()});
    expect(web.text).toBe('原创 & 正文');expect(web.origin.networkFetched).toBe(false);
    const bad=await post('/studio/content/sources',{workspaceId:f.workspaceA,name:'损坏Word',kind:'docx',fileName:'bad.docx',contentBase64:Buffer.from('a'.repeat(60)).toString('base64'),rights:rights()});expect(bad.statusCode).toBe(422);
    const expired=await post('/studio/content/sources',{workspaceId:f.workspaceA,name:'到期讲稿',kind:'text',text:'这条不应写入',rights:{...rights(),expiresAt:new Date(0).toISOString()}});expect(expired.statusCode).toBe(409);
  });
  it('网页内网读取在网络前拒绝；到期来源列表及单项不泄露正文',async()=>{
    const blocked=await post('/studio/content/sources',{workspaceId:f.workspaceA,name:'本机不可抓取',kind:'web',url:'https://127.0.0.1/private',capture:'fetch',rights:rights()});expect(blocked.statusCode).toBe(422);expect(blocked.json().error.code).toBe('CONTENT_URL_REFUSED');
    const s=await good<ContentSource>('/studio/content/sources',{workspaceId:f.workspaceA,name:'短期讲稿',kind:'text',text:'期限内的原创材料',rights:rights()});
    h.repo.run('UPDATE studio_content_sources SET expires_at=? WHERE id=?',new Date(0).toISOString(),s.id);
    expect((await get('/studio/content/sources/'+s.id)).json().data).toMatchObject({available:false,text:null,paragraphs:[]});
    const list=(await get('/studio/content/sources?workspaceId='+f.workspaceA)).json().data;expect(list.items[0].text).toBeNull();
  });
  it('跨空间、只读和已撤销当前权限均无法写入或重放旧幂等响应',async()=>{
    const input={workspaceId:f.workspaceA,name:'受控讲稿',kind:'text',text:'空间A内部原创材料',rights:rights()},key=randomUUID(),s=await good<ContentSource>('/studio/content/sources',input,h.headers,key);
    const viewer=await h.login(f.viewerA);expect((await get('/studio/content/sources/'+s.id,viewer)).statusCode).toBe(200);expect((await post('/studio/content/sources',input,viewer)).statusCode).toBe(403);
    expect((await post('/studio/content/sources',{...input,workspaceId:f.workspaceB})).statusCode).toBe(404);
    h.repo.run('UPDATE memberships SET role=? WHERE user_id=?','viewer',f.adminA);
    expect((await post('/studio/content/sources',input,h.headers,key)).statusCode).toBe(403);
    expect(h.repo.get<{n:number}>('SELECT count(*) n FROM studio_content_sources')!.n).toBe(1);
  });
  it('定位/选题有不可覆写修订，旧版本冲突不改当前值，旧缓存返回当前修订',async()=>{
    const input=brief(),key=randomUUID(),b=await good<ContentBrief>('/studio/content/briefs',input,h.headers,key);expect(contentBriefSchema.safeParse(b).success).toBe(true);
    const {workspaceId:_,...configuration}=input;void _;
    const updated=await good<ContentBrief>('/studio/content/briefs/'+b.id+'/save',{...configuration,version:1,position:'由工作人员核对的新定位',topics:['一条新选题']});
    expect(updated.version).toBe(2);expect((await post('/studio/content/briefs/'+b.id+'/save',{...configuration,version:1})).statusCode).toBe(409);
    expect(await good<ContentBrief>('/studio/content/briefs',input,h.headers,key)).toMatchObject({version:2,position:'由工作人员核对的新定位'});
    const history=(await get('/studio/content/briefs/'+b.id+'/versions')).json().data;expect(history.map((v:{version:number})=>v.version)).toEqual([2,1]);expect(history[1].configuration.position).toBe(input.position);
    expect((await post('/studio/content/briefs',{...input,topics:['同一选题','同一选题']})).statusCode).toBe(422);
  });
});
