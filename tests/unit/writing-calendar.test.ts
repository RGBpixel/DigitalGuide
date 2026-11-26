import fs from 'node:fs';
import {it,expect} from 'vitest';
import {writingConstraintFinding} from '@digitalguide/contracts';
import {writingConstraintFindings} from '../../packages/domain/src/writing-constraints.js';
import type {WritingReviewUnit} from '../../packages/domain/src/writing-review.js';

interface CalendarCase {id:string;source:string;text:string;supported:boolean;expectedRule:boolean}
const cases=(JSON.parse(fs.readFileSync('packages/test-fixtures/assets/writing-calendar-heldout.json','utf8')) as {cases:CalendarCase[]}).cases;
const unit=(text:string,quote:string):WritingReviewUnit=>({checkId:'v0s0',kind:'section',content:{text},supports:[{sourceId:'s0c0',quote}]});
const findings=(text:string,quote:string)=>writingConstraintFindings([unit(text,quote)],'explicit-constraints-v2');

for(const row of cases)it(row.id+' 开放安排规则与冻结预期相符，模型准确性另行实测',()=>{
  const observed=findings(row.text,row.source);
  expect(observed.length>0,JSON.stringify(observed)).toBe(row.expectedRule);
  for(const finding of observed){expect(writingConstraintFinding.safeParse(finding).success).toBe(true);expect(row.text).toContain(finding.unsupportedFragment);expect(finding.quote).toBe(row.source);if(finding.sourceAlternative)expect(row.source).toContain(finding.sourceAlternative);}
});

it('旧v2任务的有限规则不被新版本重新解释，默认仍为旧规则',()=>{
  const row=cases[0],input=[unit(row.text,row.source)];
  expect(writingConstraintFindings(input)).toEqual([]);
  expect(writingConstraintFindings(input,'explicit-constraints-v1')).toEqual([]);
  expect(writingConstraintFindings(input,'explicit-constraints-v2')[0].rule).toBe('availability-calendar');
});

it('每段仅以本段连续引用核对，不能借用另一段的周末安排',()=>{
  const input=[unit('展厅每天09:00到17:00开放。','展厅工作日09:00—17:00开放。'),{...unit('展厅周末09:00到17:00开放。','展厅周末09:00—17:00开放。'),checkId:'v0s1'}];
  const observed=writingConstraintFindings(input,'explicit-constraints-v2');
  expect(observed.map(f=>f.checkId)).toEqual(['v0s0']);
  expect(observed[0].quote).toBe(input[0].supports[0].quote);
});

it('节假日、临时和多场所/多时段不被当作单一固定日历自动修订',()=>{
  for(const [text,quote] of [
    ['展厅每天09:00到17:00开放。','展厅工作日09:00—17:00开放，节假日另行通知。'],
    ['展厅每天09:00到17:00开放。','展厅临时周一09:00—17:00开放。'],
    ['展厅每天09:00到17:00开放。','展厅工作日09:00—17:00开放。餐厅周末10:00—16:00营业。'],
    ['展厅每天09:00到17:00开放。','展厅每天09:00—12:00开放，14:00—17:00开放。'],
  ])expect(findings(text,quote)).toEqual([]);
});

it('不同场所的时间不能被日期规则互相替换，模型与人工事实核对仍独立',()=>{
  expect(findings('餐厅每天09:00到17:00营业。','展厅工作日09:00—17:00开放。')).toEqual([]);
});

it('口播开场提到开放安排不构成第二份营业日历，不能使后文日期检查失效',()=>{
  const observed=findings('先了解展厅的开放安排。展厅工作日09:00到17:00开放，周三闭馆。','展厅每天09:00—17:00开放，周三闭馆。');
  expect(observed).toHaveLength(1);expect(observed[0].rule).toBe('availability-calendar');
});

it('多个闭馆例外的修订线索保留来源连续原文和标点，不拼接成额外证据',()=>{
  const quote='展厅每天09:00—17:00开放。周三闭馆。周四闭馆。',observed=findings('展厅每天09:00到17:00开放，周二闭馆。',quote);
  const exception=observed.find(f=>f.rule==='availability-exception')!;
  expect(exception.sourceAlternative).toBe('周三闭馆。周四闭馆');
  expect(quote).toContain(exception.sourceAlternative);
});
