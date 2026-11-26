import { deflateRawSync } from 'node:zlib';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { syntheticPng } from '@digitalguide/media';
function crc32(bytes: Buffer) { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
export function zipFixture(files: { name: string; bytes: Buffer; declaredSize?: number }[]) {
  const local: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name), packed = deflateRawSync(file.bytes), crc = crc32(file.bytes), header = Buffer.alloc(30), directory = Buffer.alloc(46), size = file.declaredSize ?? file.bytes.length;
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(8, 8); header.writeUInt32LE(crc, 14); header.writeUInt32LE(packed.length, 18); header.writeUInt32LE(size, 22); header.writeUInt16LE(name.length, 26);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x800, 8); directory.writeUInt16LE(8, 10); directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(packed.length, 20); directory.writeUInt32LE(size, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42);
    local.push(header, name, packed); central.push(directory, name); offset += header.length + name.length + packed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16); return Buffer.concat([...local, directory, end]);
}
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function pptxFixture(options: { reverse?: boolean; externalImage?: boolean; macro?: boolean; doctype?: boolean } = {}) {
  const files: { name: string; bytes: Buffer }[] = [], add = (name: string, text: string) => files.push({ name, bytes: Buffer.from(text) });
  const ns = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  add('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>');
  add('ppt/presentation.xml', '<p:presentation ' + ns + '><p:sldIdLst>' + (options.reverse ? [2, 1] : [1, 2]).map(n => '<p:sldId id="' + (255 + n) + '" r:id="rId' + n + '"/>').join('') + '</p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/></p:presentation>');
  add('ppt/_rels/presentation.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + [1, 2].map(n => '<Relationship Id="rId' + n + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide' + n + '.xml"/>').join('') + '</Relationships>');
  for (const n of [1, 2]) {
    const title = n === 1 ? '合成产品介绍' : '工作流程与下一步', text = n === 1 ? '文字 & 图片均可编辑。' : '先审阅计划，再生成本地分镜预览。';
    const shape = (value: string, y: number) => '<p:sp><p:spPr><a:xfrm><a:off x="457200" y="' + y + '"/><a:ext cx="5029200" cy="914400"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:rPr sz="2800"><a:solidFill><a:srgbClr val="245649"/></a:solidFill></a:rPr><a:t>' + escape(value) + '</a:t></a:r></a:p></p:txBody></p:sp>';
    add('ppt/slides/slide' + n + '.xml', (options.doctype ? '<!DOCTYPE sld [<!ENTITY bad "unexpected">]>' : '') + '<p:sld ' + ns + '><p:cSld><p:spTree>' + shape(title, 457200) + shape(text, 1828800) + '<p:pic><p:blipFill><a:blip r:embed="img1"/></p:blipFill><p:spPr><a:xfrm><a:off x="6400800" y="1371600"/><a:ext cx="1828800" cy="1828800"/></a:xfrm></p:spPr></p:pic></p:spTree></p:cSld></p:sld>');
    add('ppt/slides/_rels/slide' + n + '.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="img1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" ' + (options.externalImage ? 'Target="https://example.com/private.png" TargetMode="External"' : 'Target="../media/pic.png"') + '/><Relationship Id="notes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide' + n + '.xml"/></Relationships>');
    add('ppt/notesSlides/notesSlide' + n + '.xml', '<p:notes ' + ns + '><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>本页演讲者备注 ' + n + '</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>');
  }
  files.push({ name: 'ppt/media/pic.png', bytes: syntheticPng() }); if (options.macro) files.push({ name: 'ppt/vbaProject.bin', bytes: Buffer.from('inert synthetic test') }); return zipFixture(files);
}
export async function pdfFixture(options: { scanned?: boolean } = {}) {
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= 2; n++) { const page = pdf.addPage([640, 360]); page.drawRectangle({ x: 0, y: 0, width: 640, height: 360, color: rgb(0.93, 0.96, 0.9) }); if (!options.scanned) { page.drawText('Synthetic PDF page ' + n, { x: 40, y: 275, size: 30, font, color: rgb(0.1, 0.3, 0.2) }); page.drawText('Editable narration and slide content.', { x: 40, y: 180, size: 20, font }); } }
  return Buffer.from(await pdf.save());
}
