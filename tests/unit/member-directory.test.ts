import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {memberCreateInput,memberAccessInput} from '../../packages/contracts/src/member-directory.js';
import {effectiveMemberships} from '../../packages/enterprise/src/membership-sql.js';
const valid={workspaceId:randomUUID(),userId:randomUUID(),name:'  合成成员  ',role:'editor',workspaceIds:[randomUUID()],confirmed:true};
it('建号需要明确确认，姓名规范化且禁止控制字符和额外身份字段',()=>{expect(memberCreateInput.parse(valid).name).toBe('合成成员');for(const body of [{...valid,confirmed:false},{...valid,name:'\n\u0000'},{...valid,email:'auto@example.invalid'},{...valid,name:'x'.repeat(81)}])expect(memberCreateInput.safeParse(body).success).toBe(false);});
it('权限列表必须唯一、有界并且使用合法空间和角色',()=>{for(const body of [{...valid,workspaceIds:['invalid']},{...valid,workspaceIds:[valid.workspaceIds[0],valid.workspaceIds[0]]},{...valid,role:'owner'},{...valid,workspaceIds:Array.from({length:1001},()=>randomUUID())}])expect(memberCreateInput.safeParse(body).success).toBe(false);});
it('调岗要求明确版本并拒绝角色以外的隐式属性',()=>{const{name:_,...body}=valid;void _;expect(memberAccessInput.parse({...body,version:0}).version).toBe(0);expect(memberAccessInput.safeParse(body).success).toBe(false);expect(memberAccessInput.safeParse({...body,version:-1}).success).toBe(false);expect(memberAccessInput.safeParse({...body,version:1,identityVerified:true}).success).toBe(false);});
it('环境SQL仅接受固定枚举，拒绝把输入拼进SQL',()=>{expect(effectiveMemberships('live','production')).toContain("d.environment='live'");expect(()=>effectiveMemberships("mock' OR 1=1--",'development')).toThrow();expect(()=>effectiveMemberships('mock','unknown')).toThrow();});
