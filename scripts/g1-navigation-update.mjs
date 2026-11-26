import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const file='apps/web/src/App.tsx',folder='docs/evidence/T16/g1/navigation';fs.mkdirSync(folder,{recursive:true});assert.ok(!fs.existsSync(folder+'/before-source.txt'));const old=fs.readFileSync(file,'utf8');fs.writeFileSync(folder+'/before-source.txt',old,{flag:'wx'});
const marker="[{ id: 'creation', title: '视频与 PPT'",start=old.indexOf(marker),end=old.indexOf('].map(s => <Link className="scene-card"',start);assert.ok(start>=0&&end>start);assert.equal(old.indexOf(marker,start+1),-1);
const scenes=`[
 {id:'creation',title:'视频与 PPT',desc:'口播 · 多轨编辑 · PPT制作',icon:Clapperboard,path:'/studio'},
 {id:'live',title:'数字人直播',desc:'节目场控 · 连麦 · 本地录制',icon:Radio,path:'/live'},
 {id:'exhibition',title:'展厅导览',desc:'路线讲解 · 团体问答 · 模拟联动',icon:MonitorPlay,path:'/exhibition'},
 {id:'reception',title:'企业接待',desc:'访客登记 · 模拟通知 · 口信',icon:MessageSquare,path:'/reception'},
 {id:'restaurant',title:'餐厅服务',desc:'桌台 · 点单 · 后厨 · 模拟结账',icon:Utensils,path:'/restaurant'},
 {id:'publishing',title:'传播与自然发布',desc:'团队审核 · 排期 · 人工素材包',icon:ArrowUpRight,path:'/distribution'},
 {id:'advertising',title:'广告投放',desc:'计划 · 预算审批 · 模拟回执',icon:ArrowUpRight,path:'/advertising'},
 {id:'learning',title:'课程训练',desc:'互动分支 · 测验 · 自学包',icon:ClipboardCheck,path:'/learning'},
 {id:'practice',title:'角色练习与访谈',desc:'问题流程 · 字样反馈 · 原话记录',icon:MessageSquare,path:'/practice'}
`;
let next=old.slice(0,start)+scenes+old.slice(end);
const route="to={s.id === 'creation' ? '/studio' : s.id === 'publishing' ? '/distribution' : s.id === 'reception' ? '/reception' : s.id === 'exhibition' ? '/exhibition' : s.id === 'live' ? '/live' : '/modules/' + s.id}",badge="{['reception', 'exhibition', 'publishing', 'live'].includes(s.id) ? '本地流程可用' : s.phase + ' 待开发'}";
assert.equal(next.split(route).length,2);assert.equal(next.split(badge).length,2);next=next.replace(route,'to={s.path}').replace(badge,'本地流程可用');fs.writeFileSync(file,next);
fs.writeFileSync(folder+'/change.json',JSON.stringify({result:'IMPLEMENTED_PENDING_BROWSER_VERIFICATION',changedAt:new Date().toISOString(),requirementId:'R-061',taskId:'T16',beforeSHA256:createHash('sha256').update(old).digest('hex'),afterSHA256:createHash('sha256').update(next).digest('hex'),problems:['Overview marked working video/PPT and restaurant as pending development','Restaurant overview card routed to /modules/restaurant instead of existing restaurant service','Overview omitted independent advertising, course and role-practice entry points'],changes:['Nine existing scene applications have explicit current routes','All cards explicitly describe local flows, including simulated business effects','Restaurant now opens its real implemented local page'],backendOrDatabaseChanged:false,originalSourceRetained:true},null,2)+'\n',{flag:'wx'});console.log('Updated existing overview routes and local capability labels for R-061; browser verification pending.');
