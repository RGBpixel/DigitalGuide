import {it,expect} from 'vitest';
import type pg from 'pg';
import {postgresCatalogFingerprint} from '../../packages/postgres/src/catalog.js';
import {digest} from '../../packages/postgres/src/source.js';
function catalog(views:object[]){return{query:async(sql:string)=>({rows:sql.includes('pg_get_viewdef')?views:[]})} as unknown as pg.Client;}
it('没有视图的历史目录保持原九组摘要，避免改写旧备份的校验算法',async()=>{expect(await postgresCatalogFingerprint(catalog([]),'fixture')).toBe(digest(Array.from({length:9},()=>[])));});
it('新增权限视图的定义参与目录校验，不能只保持同名及同列而换掉条件',async()=>{const a=await postgresCatalogFingerprint(catalog([{relname:'effective_memberships',relkind:'v',definition:'SELECT authorized_member'}]),'fixture'),b=await postgresCatalogFingerprint(catalog([{relname:'effective_memberships',relkind:'v',definition:'SELECT unrestricted_member'}]),'fixture');expect(a).not.toBe(b);expect(a).not.toBe(await postgresCatalogFingerprint(catalog([]),'fixture'));});
