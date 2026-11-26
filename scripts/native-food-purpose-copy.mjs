import fs from 'node:fs';
import assert from 'node:assert/strict';
const file='apps/web/src/people/PeoplePage.tsx';let text=fs.readFileSync(file,'utf8');
const changes=[['用于本工作空间接待；登记后对话最多保存 30 天','用于{session?.scene===\'restaurant\'?\'本店接待和本人明确授权的口味建议\':\'本工作空间接待\'}；登记后对话最多保存 30 天'],['前台目录可见显示称呼与业务角色，私人记录仅本人可读。',"{session?.scene==='restaurant'?'餐厅资料不会列入企业前台人员目录，私人记录仅本人可读。':'前台目录可见显示称呼与业务角色，私人记录仅本人可读。'}"]];for(const[before,after]of changes){assert.equal(text.split(before).length,2,before);text=text.replace(before,after);}fs.writeFileSync(file,text);
