import { describe, it, expect } from 'vitest';
import { importStudioDocument } from '../../packages/media/src/document-import.js';
import { pptxFixture, pdfFixture, zipFixture } from '../../packages/test-fixtures/src/documents.js';
import { inspectMedia } from '@digitalguide/media';
describe('T08 实际 PPTX/PDF 解析及边界', () => {
  it('按演示文稿关系保留实际页序、中文转义、备注和可编辑图片，而非猜测文件名顺序', async () => {
    const result = await importStudioDocument(pptxFixture({ reverse: true }), 'pptx'); expect(result.pages.map(p => p.number)).toEqual([1, 2]); expect(result.pages[0].title).toBe('工作流程与下一步'); expect(result.pages[1].text).toContain('文字 & 图片'); expect(result.pages[1].notes).toContain('备注 1');
    expect(result.pages[0].elements.some(e => e.type === 'image')).toBe(true); expect(result.media).toHaveLength(1); expect(inspectMedia(result.media[0].png).mediaType).toBe('image/png');
  });
  it('PDF 实际提取分页文字并渲染有效参考 PNG，输出可编辑文字对象', async () => {
    const result = await importStudioDocument(await pdfFixture(), 'pdf'); expect(result.pages).toHaveLength(2); expect(result.pages[1].text).toContain('Synthetic PDF page 2'); expect(result.pages[0].elements.some(e => e.type === 'text')).toBe(true); expect(result.media).toHaveLength(2); expect(inspectMedia(result.media[0].png).specs.width).toBe(1280);
  });
  it('扫描或无文字页保留真实参考页并明确人工补稿，不虚构 OCR 结果', async () => {
    const result = await importStudioDocument(await pdfFixture({ scanned: true }), 'pdf'); expect(result.pages[0].text).toBe(''); expect(result.pages[0].referenceMediaId).toBeTruthy(); expect(result.pages[0].warnings.join('')).toContain('未做 OCR');
  });
  it('外部关系不发起网络请求，不把缺失图片冒充已导入', async () => {
    const result = await importStudioDocument(pptxFixture({ externalImage: true }), 'pptx'); expect(result.media).toHaveLength(0); expect(result.warnings.join('')).toContain('未抓取'); expect(result.pages[0].warnings.join('')).toContain('未导入');
  });
  it('拒绝宏、DOCTYPE、重复路径和目录穿越，不执行包内代码', async () => {
    for (const options of [{ macro: true }, { doctype: true }]) await expect(importStudioDocument(pptxFixture(options), 'pptx')).rejects.toThrow();
    for (const entries of [[{ name: '../escape.xml', bytes: Buffer.from('test') }], [{ name: 'same.xml', bytes: Buffer.from('a') }, { name: 'same.xml', bytes: Buffer.from('b') }]]) await expect(importStudioDocument(zipFixture(entries), 'pptx')).rejects.toThrow();
  });
  it('对谎报体积的解压内容及错误格式明确失败', async () => {
    await expect(importStudioDocument(zipFixture([{ name: 'ppt/presentation.xml', bytes: Buffer.alloc(1_000_000, 65), declaredSize: 1 }]), 'pptx')).rejects.toThrow();
    await expect(importStudioDocument(Buffer.from('not a pdf'), 'pdf')).rejects.toThrow('不匹配');
  });
});
