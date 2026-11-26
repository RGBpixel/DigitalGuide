import { describe,it,expect } from 'vitest';
import { createHash } from 'node:crypto';
import { captureDocx,captureHtml,capturePlainText } from '../../packages/media/src/content-text.js';
import { contentUrl,publicContentAddress } from '../../packages/media/src/content-web.js';
import { originalWordContentFixture } from '../../packages/test-fixtures/src/content.js';
describe('T24内容来源实际解析与公开网页边界',()=>{
  it('Word按实际正文/表格顺序取文字，忽略删除和字段指令，不执行外部关系',async()=>{
    const bytes=await originalWordContentFixture('<w:p><w:r><w:t>甲&amp;乙</w:t></w:r><w:del><w:r><w:delText>旧删除稿</w:delText></w:r></w:del><w:ins><w:r><w:t>新修订</w:t></w:r></w:ins><w:r><w:instrText>IMPORT external</w:instrText></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格内容</w:t></w:r></w:p></w:tc></w:tr></w:tbl>');
    const result=await captureDocx(bytes);expect(result.paragraphs).toEqual(['甲&乙新修订','表格内容']);expect(result.text).not.toContain('external');expect(result.materialSHA256).toBe(createHash('sha256').update(bytes).digest('hex'));expect(result.warnings.length).toBeGreaterThan(0);
  });
  it('Word拒绝宏、损坏XML、外部嵌入及超限文件，不降为模拟成功',async()=>{
    await expect(captureDocx(await originalWordContentFixture(undefined,true))).rejects.toMatchObject({code:'CONTENT_SOURCE_INVALID'});
    await expect(captureDocx(await originalWordContentFixture('<w:p>未闭合'))).rejects.toMatchObject({code:'CONTENT_SOURCE_INVALID'});
    await expect(captureDocx(await originalWordContentFixture('<w:altChunk r:id="rId9"/>'))).rejects.toMatchObject({code:'CONTENT_SOURCE_INVALID'});
    await expect(captureDocx(Buffer.alloc(8388609))).rejects.toMatchObject({code:'CONTENT_SOURCE_INVALID'});
  });
  it('HTML只提取静态文字，实体还原，不执行脚本或读图片及iframe',()=>{
    const source='<html><head><title>网页标题</title><script>bad()</script></head><body><p>你好 &amp; 欢迎 &#x4E2D;&#25991;</p><iframe src="https://127.0.0.1">旁页内容</iframe><style>.secret{}</style><p>第二段<br>第三行</p></body></html>';
    const result=captureHtml(source);expect(result.paragraphs).toEqual(['你好 & 欢迎 中文','第二段','第三行']);expect(result.text).not.toMatch(/bad|secret|旁页内容/);expect(result.warnings.join('')).toContain('CSS');
  });
  it('正文保留段落和哈希，空白、NUL和过长内容明确失败，不静默裁剪',()=>{
    expect(capturePlainText('  一\r\n二  ').text).toBe('一\n二');
    for(const value of ['',' \n ','甲\0乙','字'.repeat(60001)])expect(()=>capturePlainText(value)).toThrow();
    expect(capturePlainText('字'.repeat(60000)).text.length).toBe(60000);
  });
  it('URL及地址检查拒绝本机、内网、凭据、非HTTPS、映射和特殊范围，允许普通公网双栈',()=>{
    for(const value of ['http://example.com','https://localhost','https://127.0.0.1','https://[::1]/','https://staff.local/','https://user:password@example.com/','https://example.com:8443/'])expect(()=>contentUrl(value)).toThrow();
    expect(contentUrl('https://example.com/a#private').href).toBe('https://example.com/a');
    for(const address of ['127.0.0.1','10.1.2.3','169.254.169.254','100.64.1.1','172.31.0.1','192.168.0.1','192.0.2.1','198.18.1.1','198.51.100.2','203.0.113.9','224.0.0.1','::1','fd00::1','fe80::1','::ffff:127.0.0.1','2001:db8::1','2002:7f00:1::'])expect(publicContentAddress(address),address).toBe(false);
    for(const address of ['93.184.216.34','8.8.8.8','2606:4700:4700::1111','2001:4860:4860::8888'])expect(publicContentAddress(address),address).toBe(true);
  });
});
