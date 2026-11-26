import {it,expect} from 'vitest';
import {writingConstraintFindings} from '../../packages/domain/src/writing-constraints.js';
import type {WritingReviewUnit} from '../../packages/domain/src/writing-review.js';
const quote='数字展厅每天09:00—17:00开放，周三闭馆。';
const check=(text:string,source=quote)=>writingConstraintFindings([{checkId:'v0s0',kind:'section',content:{text},supports:[{sourceId:'s0c0',quote:source}]} satisfies WritingReviewUnit],'explicit-constraints-v2');
it('实际编译生成的工作日与周末并集保留完整开放安排，不能误判为只有工作日',()=>{
  expect(check('今天能去展厅吗？周三闭馆，其他工作日和周末都开放，时间是09:00至17:00。')).toEqual([]);
});
it('中英文明确并集可与每天等价，单独工作日仍需标出范围变化',()=>{
  expect(check('周三闭馆，其他工作日及周末09:00至17:00开放。')).toEqual([]);
  expect(check('The gallery opens on weekdays and at weekends from 09:00 to 17:00. It is closed on Wednesday.','The gallery opens daily from 09:00 to 17:00. It is closed on Wednesday.')).toEqual([]);
  expect(check('周三闭馆，其他工作日09:00至17:00开放。').some(f=>f.rule==='availability-calendar')).toBe(true);
});
it('相邻且明确属于开放安排的独立时段不能被忽略，起止颠倒仍须标出',()=>{
  const findings=check('周三闭馆，其他工作日和周末都开放，时间是17:00至09:00。');
  expect(findings).toHaveLength(1);expect(findings[0].rule).toBe('availability-hours');
  expect(findings[0].unsupportedFragment).toContain('17:00至09:00');
});
it('其他工作事项的处理时间不被借为开放时段',()=>{
  expect(check('周三闭馆，其他工作日和周末都开放。工作人员处理时间是17:00至09:00。')).toEqual([]);
});
