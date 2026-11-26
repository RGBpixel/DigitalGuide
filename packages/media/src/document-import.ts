import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { fromBuffer, type Entry, type ZipFile } from 'yauzl';
import { PNG } from 'pngjs';
import type { StudioElement, StudioImportPage } from '@digitalguide/contracts';
import { AppError } from '@digitalguide/domain';
export interface ImportedMedia { id: string; png: Buffer; width: number; height: number; kind: 'image' | 'reference' }
export interface ImportedDocument { pages: StudioImportPage[]; media: ImportedMedia[]; warnings: string[] }
interface XNode { name: string; attrs: Record<string, string>; children: XNode[]; value: string }
const error = (message: string) => new AppError('DOCUMENT_IMPORT_FAILED', message, 422);
const limits = { entries: 2000, entryBytes: 12 * 1024 * 1024, totalBytes: 40 * 1024 * 1024, mediaBytes: 24 * 1024 * 1024, pages: 40 };
const elementsLimit = 60;
function xml(buffer: Buffer): XNode {
  const text = buffer.toString('utf8'); if (/<!\s*(DOCTYPE|ENTITY)/i.test(text) || text.length > limits.entryBytes) throw error('文档包含不支持的 XML 声明或内容过大。');
  if (XMLValidator.validate(text) !== true) throw error('PPTX 内部 XML 无效，请重新另存文件。');
  const parsed: unknown = new XMLParser({ ignoreAttributes: false, preserveOrder: true, parseTagValue: false, parseAttributeValue: false, trimValues: false, maxNestedTags: 64 }).parse(text);
  function nodes(value: unknown): XNode[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry: unknown) => { if (!entry || typeof entry !== 'object') return []; const obj = entry as Record<string, unknown>, key = Object.keys(obj).find(k => k !== ':@' && !k.startsWith('?')); if (!key) return [];
      const attrs: Record<string, string> = {}; for (const [name, attr] of Object.entries((obj[':@'] || {}) as Record<string, unknown>)) attrs[name.replace(/^@_/, '')] = String(attr);
      return [{ name: key.split(':').pop()!, attrs, value: typeof obj[key] === 'string' || typeof obj[key] === 'number' ? String(obj[key]) : '', children: nodes(obj[key]) }]; });
  }
  return { name: 'root', attrs: {}, value: '', children: nodes(parsed) };
}
function all(node: XNode, name: string): XNode[] { return node.children.flatMap(c => [...(c.name === name ? [c] : []), ...all(c, name)]); }
const first = (node: XNode, name: string) => all(node, name)[0];
const contents = (node: XNode): string => node.value + node.children.map(contents).join('');
const relationAttr = (node: XNode, key: string) => Object.entries(node.attrs).find(([name]) => name.endsWith(':' + key))?.[1];
function readZip(bytes: Buffer): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    let zip: ZipFile | undefined, failed = false, total = 0, entries = 0; const output = new Map<string, Buffer>();
    function fail(e: unknown) { if (failed) return; failed = true; zip?.close(); reject(e instanceof AppError ? e : error('PPTX 压缩结构无效或读取失败。')); }
    fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true, autoClose: true }, (err, opened) => {
      if (err || !opened) return fail(err); zip = opened; if (zip.entryCount > limits.entries) return fail(error('PPTX 内部文件过多，请简化文档。'));
      zip.on('error', fail); zip.on('end', () => { if (!failed) resolve(output); });
      zip.on('entry', (entry: Entry) => {
        const name = entry.fileName; if (++entries > limits.entries || name.includes('\0') || name.includes('\\') || name.startsWith('/') || name.split('/').some(p => p === '..') || /^[A-Za-z]:/.test(name) || output.has(name) || (entry.generalPurposeBitFlag & 1) || ![0, 8].includes(entry.compressionMethod) || (entry.externalFileAttributes >>> 16 & 0xF000) === 0xA000) return fail(error('PPTX 包含重复、加密或不安全的内部路径。'));
        if (/vbaProject\.bin$/i.test(name)) return fail(error('本地导入不接受宏，请另存为不含宏的 PPTX。'));
        if (entry.uncompressedSize > limits.entryBytes || total + entry.uncompressedSize > limits.totalBytes) return fail(error('PPTX 解压后过大，请拆分文档。'));
        if (name.endsWith('/')) { zip!.readEntry(); return; }
        zip!.openReadStream(entry, (streamError, stream) => { if (streamError || !stream) return fail(streamError); const chunks: Buffer[] = []; let size = 0;
          stream.on('error', fail); stream.on('data', (chunk: Buffer) => { size += chunk.length; total += chunk.length; if (size > limits.entryBytes || total > limits.totalBytes) { stream.destroy(); fail(error('PPTX 实际解压内容超过限制。')); } else chunks.push(chunk); });
          stream.on('end', () => { if (!failed) { output.set(name, Buffer.concat(chunks)); zip!.readEntry(); } });
        });
      }); zip.readEntry();
    });
  });
}
function relationships(files: Map<string, Buffer>, owner: string, warnings: string[]) {
  const file = files.get(path.posix.join(path.posix.dirname(owner), '_rels', path.posix.basename(owner) + '.rels')), result = new Map<string, { target: string; type: string }>();
  if (!file) return result;
  for (const rel of all(xml(file), 'Relationship')) {
    if (rel.attrs.TargetMode === 'External' || /^[a-z]+:/i.test(rel.attrs.Target || '')) { warnings.push('外部链接及媒体未抓取或执行。'); continue; }
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(owner), rel.attrs.Target || ''));
    if (!target.startsWith('ppt/') || target.includes('\0') || target.includes('\\')) throw error('PPTX 引用超出受控文档范围。');
    result.set(rel.attrs.Id, { target, type: rel.attrs.Type || '' });
  } return result;
}
function pngDimensions(bytes: Buffer) { if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return null; return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }; }
function jpegDimensions(bytes: Buffer) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null; let offset = 2;
  while (offset + 9 < bytes.length) { if (bytes[offset] !== 0xff) return null; const marker = bytes[offset + 1]; offset += 2; if (marker === 0xd9 || marker === 0xda) break; const length = bytes.readUInt16BE(offset); if (length < 2 || offset + length > bytes.length) return null; if ([0xc0,0xc1,0xc2].includes(marker)) return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) }; offset += length; } return null;
}
async function convertImage(bytes: Buffer) {
  const specs = pngDimensions(bytes) || jpegDimensions(bytes); if (!specs || !specs.width || !specs.height || specs.width * specs.height > 4_000_000) throw error('嵌入图片格式或尺寸不受支持，请使用四百万像素以内的 PNG/JPEG。');
  if (pngDimensions(bytes)) { PNG.sync.read(bytes, { checkCRC: true }); return { ...specs, png: bytes }; }
  const image = await loadImage(bytes), canvas = createCanvas(specs.width, specs.height); canvas.getContext('2d').drawImage(image, 0, 0); return { ...specs, png: await canvas.encode('png') };
}
function textElement(text: string, x: number, y: number, width: number, height: number, fontSize: number, zIndex: number, color = '#173E33'): StudioElement {
  const safeX = Math.max(0, Math.min(0.99, x)), safeY = Math.max(0, Math.min(0.99, y));
  return { id: randomUUID(), type: 'text', x: safeX, y: safeY, width: Math.max(0.005, Math.min(1 - safeX, width)), height: Math.max(0.005, Math.min(1 - safeY, height)), text, fontSize: Math.max(8, Math.min(200, Math.round(fontSize))), color, bold: false, align: 'left', zIndex: Math.min(100, zIndex), opacity: 1 };
}
async function importPptx(bytes: Buffer): Promise<ImportedDocument> {
  const files = await readZip(bytes), main = files.get('ppt/presentation.xml'), types = files.get('[Content_Types].xml');
  if (!main || !types || /macroEnabled/i.test(types.toString('utf8'))) throw error('文件不是支持的无宏 PPTX 演示文稿。');
  const warnings = ['PPTX 文字与 PNG/JPEG 图片已重建为可编辑对象；主题字体、动画、图表、SmartArt 和复杂分组需人工核对。'], root = xml(main), size = first(root, 'sldSz'), cx = Number(size?.attrs.cx || 12192000), cy = Number(size?.attrs.cy || 6858000);
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || cx < 10000 || cy < 10000) throw error('PPTX 页面尺寸无效。');
  const width = Math.min(4096, Math.max(320, Math.round(cx / 9525))), height = Math.min(4096, Math.max(320, Math.round(cy / 9525))), rels = relationships(files, 'ppt/presentation.xml', warnings), slideIds = all(root, 'sldId');
  if (!slideIds.length || slideIds.length > limits.pages) throw error('本地 PPTX 导入支持一至四十页，请拆分后重试。');
  const media: ImportedMedia[] = [], imageCache = new Map<string, ImportedMedia>(), pages: StudioImportPage[] = []; let mediaBytes = 0;
  for (const [index, id] of slideIds.entries()) {
    const target = rels.get(relationAttr(id, 'id') || '')?.target; if (!target || !/^ppt\/slides\/[^/]+\.xml$/.test(target) || !files.has(target)) throw error('PPTX 页面关系无效。');
    const slide = xml(files.get(target)!), links = relationships(files, target, warnings), pageWarnings: string[] = [], tree = first(slide, 'spTree') || slide, shapes = all(tree, 'sp'), elements: StudioElement[] = [], texts: string[] = [];
    for (const shape of shapes) {
      const paragraphs = all(shape, 'p').map(p => all(p, 't').map(contents).join('')), text = paragraphs.join('\n').trim(); if (!text) continue;
      if (text.length > 4000) throw error('单个文本框超过四千字符，请拆分后导入。'); texts.push(text);
      const xfrm = first(shape, 'xfrm'), off = xfrm && first(xfrm, 'off'), ext = xfrm && first(xfrm, 'ext'), properties = first(shape, 'rPr') || first(shape, 'defRPr'), srgb = properties && first(properties, 'srgbClr');
      const x = Number(off?.attrs.x || 0) / cx, y = Number(off?.attrs.y || 0) / cy, w = Number(ext?.attrs.cx || cx * 0.8) / cx, h = Number(ext?.attrs.cy || cy * 0.15) / cy;
      elements.push(textElement(text, x, y, w, h, Number(properties?.attrs.sz || 2400) / 100 * 96 / 72, elements.length, /^[a-f0-9]{6}$/i.test(srgb?.attrs.val || '') ? '#' + srgb!.attrs.val : '#173E33'));
    }
    for (const picture of all(tree, 'pic')) {
      const blip = first(picture, 'blip'), link = blip && links.get(relationAttr(blip, 'embed') || ''), data = link && files.get(link.target); if (!link || !data) { pageWarnings.push('一个外部或缺失图片未导入，请人工补充。'); continue; }
      if (!/^ppt\/media\//.test(link.target)) throw error('PPTX 图片来源不在允许范围内。');
      let image = imageCache.get(link.target);
      if (!image) { try { const converted = await convertImage(data); mediaBytes += converted.png.length; if (mediaBytes > limits.mediaBytes) throw error('导入图片总量超过二十四 MB，请拆分文档。'); image = { ...converted, id: randomUUID(), kind: 'image' }; imageCache.set(link.target, image); media.push(image); } catch (e) { if (e instanceof AppError && /总量/.test(e.message)) throw e; pageWarnings.push('一个不支持的图片需人工补充（当前支持受限尺寸 PNG/JPEG）。'); continue; } }
      const xfrm = first(picture, 'xfrm'), off = xfrm && first(xfrm, 'off'), ext = xfrm && first(xfrm, 'ext'), x = Math.max(0, Math.min(0.99, Number(off?.attrs.x || 0) / cx)), y = Math.max(0, Math.min(0.99, Number(off?.attrs.y || 0) / cy));
      elements.push({ id: randomUUID(), type: 'image', assetId: null, importMediaId: image.id, x, y, width: Math.max(0.005, Math.min(1 - x, Number(ext?.attrs.cx || cx * 0.3) / cx)), height: Math.max(0.005, Math.min(1 - y, Number(ext?.attrs.cy || cy * 0.3) / cy)), zIndex: Math.min(100, elements.length), opacity: 1, fit: 'contain' });
    }
    const noteLink = [...links.values()].find(r => r.type.endsWith('/notesSlide')), noteFile = noteLink && files.get(noteLink.target); let notes = '';
    if (noteFile) notes = all(xml(noteFile), 'sp').filter(s => first(s, 'ph')?.attrs.type === 'body').flatMap(s => all(s, 't').map(contents)).join('\n').trim();
    const text = texts.join('\n'); if (text.length > 4000 || notes.length > 4000) throw error('单页文字或备注超过四千字符，请拆分后导入。');
    if (elements.length > elementsLimit) { elements.splice(0, elements.length, textElement(text, 0.06, 0.06, 0.88, 0.88, 28, 0)); pageWarnings.push('图形过多，已合并为可编辑文字卡片，图片需人工安排。'); }
    if (!text) pageWarnings.push('本页没有可提取文字，请手动填写讲稿。'); if (all(tree, 'grpSp').length) pageWarnings.push('分组变换可能降级，请核对对象位置。');
    pages.push({ id: randomUUID(), number: index + 1, title: (texts[0]?.split('\n')[0] || '第 ' + (index + 1) + ' 页').slice(0, 100), text, notes, width, height, elements, referenceMediaId: null, warnings: [...new Set(pageWarnings)] });
  }
  return { pages, media, warnings: [...new Set(warnings)] };
}
async function importPdf(bytes: Buffer): Promise<ImportedDocument> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs'), require = createRequire(import.meta.url), directory = path.dirname(require.resolve('pdfjs-dist/package.json')).replace(/\\/g, '/');
  const task = getDocument({ data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: false, useWorkerFetch: false, useWasm: false, maxImageSize: 4_000_000, enableXfa: false, stopAtErrors: true, verbosity: 0, cMapUrl: directory + '/cmaps/', standardFontDataUrl: directory + '/standard_fonts/' });
  let document;
  try { document = await task.promise; } catch { throw error('PDF 可能已加密或损坏，请提供可读取的 PDF。'); }
  const pages: StudioImportPage[] = [], media: ImportedMedia[] = []; let mediaBytes = 0;
  try {
    if (!document.numPages || document.numPages > limits.pages) throw error('本地 PDF 导入支持一至四十页，请拆分后重试。');
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number), viewport = page.getViewport({ scale: 1 }), content = await page.getTextContent(), pageWarnings = ['PDF 图形保留为原页参考，提取文字重建为可编辑画面，复杂版式需人工核对。'];
      const items = content.items.filter((item): item is import('pdfjs-dist/types/src/display/api.js').TextItem => 'str' in item), text = items.map(i => i.str + (i.hasEOL ? '\n' : ' ')).join('').trim();
      if (text.length > 4000) throw error('单页 PDF 文字超过四千字符，请拆分页面后导入。');
      const normalized = items.filter(i => i.str.trim()).map((item, index) => { const transform = item.transform as number[], x = transform[4] / viewport.width, y = 1 - (transform[5] + item.height) / viewport.height; return textElement(item.str, x, y, Math.max(0.05, item.width / viewport.width + 0.01), Math.max(0.03, item.height / viewport.height * 1.4), Math.abs(transform[3]) || 20, index); });
      const elements = normalized.length > elementsLimit ? [textElement(text, 0.06, 0.06, 0.88, 0.88, 24, 0)] : normalized;
      if (normalized.length > elementsLimit) pageWarnings.push('本页文字块较多，已合并为文字卡片。'); if (!text) pageWarnings.push('本页没有提取到文字，可能为扫描页；本地未做 OCR，请手动补充讲稿。');
      const scale = Math.min(1280 / viewport.width, 1280 / viewport.height, 2), rendered = page.getViewport({ scale }), width = Math.max(1, Math.ceil(rendered.width)), height = Math.max(1, Math.ceil(rendered.height));
      if (!Number.isFinite(width) || !Number.isFinite(height) || width * height > 2_000_000) throw error('PDF 页面尺寸超出本地渲染限制。');
      const canvas = createCanvas(width, height); await page.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport: rendered }).promise; const png = await canvas.encode('png'); mediaBytes += png.length; if (mediaBytes > limits.mediaBytes) throw error('PDF 参考页总量过大，请拆分文档。');
      const image = { id: randomUUID(), png, width, height, kind: 'reference' as const }; media.push(image); pages.push({ id: randomUUID(), number, title: (items.find(i => i.str.trim())?.str.trim() || '第 ' + number + ' 页').slice(0, 100), text, notes: '', width: Math.min(4096, Math.max(320, Math.round(viewport.width))), height: Math.min(4096, Math.max(320, Math.round(viewport.height))), elements, referenceMediaId: image.id, warnings: pageWarnings }); page.cleanup(); canvas.width = 1; canvas.height = 1;
    }
  } finally { await task.destroy(); }
  return { pages, media, warnings: ['PDF 已实际分页、提取文字和渲染参考图；图形/表单/链接不是可交互对象，未执行文档脚本。'] };
}
export async function importStudioDocument(bytes: Buffer, format: 'pdf' | 'pptx'): Promise<ImportedDocument> {
  if (bytes.length < 8 || bytes.length > 8 * 1024 * 1024) throw error('文档大小需在八 MB 以内。');
  if (format === 'pdf' && bytes.subarray(0, 1024).indexOf(Buffer.from('%PDF-')) >= 0) return importPdf(bytes);
  if (format === 'pptx' && bytes.readUInt32LE(0) === 0x04034b50) return importPptx(bytes);
  throw error('文件扩展名与内容不匹配；当前支持无宏 PPTX 和可读取 PDF。');
}
