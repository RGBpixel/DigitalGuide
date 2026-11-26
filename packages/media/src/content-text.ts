import { createHash } from 'node:crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { fromBuffer, type ZipFile, type Entry } from 'yauzl';
import { AppError } from '@digitalguide/domain';
export interface CapturedContent {
  text: string; paragraphs: string[]; materialSHA256: string; textSHA256: string; warnings: string[];
}
const fail = (message: string) => new AppError('CONTENT_SOURCE_INVALID', message, 422);
const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
export function capturePlainText(text: string, material: Buffer | string = text, warnings: string[] = []): CapturedContent {
  if (text.includes('\0')) throw fail('正文包含无效控制字符，请删除后重试。');
  const cleaned = Array.from(text.replace(/\r\n?/g,'\n')).filter(c=>c.charCodeAt(0)>=32||c==='\n'||c==='\t').join('').trim();
  if (!cleaned || cleaned.length > 60000) throw fail('正文须为1—60000字符；内容过多时请主动选摘或拆分，不会静默截断。');
  const paragraphs = cleaned.split(/\n+/).map(p => p.trim()).filter(Boolean);
  if (paragraphs.length > 1000) throw fail('正文段落超过1000，请拆分来源。');
  return { text: cleaned, paragraphs, materialSHA256: sha(material), textSHA256: sha(cleaned), warnings };
}
function decodeEntities(value: string) {
  const names: Record<string,string> = { amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',hellip:'…',mdash:'—',ndash:'–',ldquo:'“',rdquo:'”',lsquo:'‘',rsquo:'’',copy:'©',reg:'®',bull:'•' };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi,(whole,key:string) => {
    if (!key.startsWith('#')) return names[key.toLowerCase()] ?? whole;
    const point = key[1].toLowerCase() === 'x' ? Number.parseInt(key.slice(2),16) : Number.parseInt(key.slice(1),10);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : '';
  });
}
export function captureHtml(html: string | Buffer) {
  const raw = Buffer.isBuffer(html) ? new TextDecoder('utf-8',{fatal:true}).decode(html) : html;
  if (Buffer.byteLength(raw) > 1000000) throw fail('网页快照超过1MB，请主动复制需要的正文。');
  // This text extractor never executes or follows HTML. Hidden/CSS-rendered layout is not inferred.
  const visible = raw.replace(/<!--[\s\S]*?(?:-->|$)/g,'')
    .replace(/<(script|style|head|iframe|object|template|noscript)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi,'')
    .replace(/<(?:br|hr)\b[^>]*\/?>/gi,'\n')
    .replace(/<\/(?:p|div|section|article|h[1-6]|li|tr|blockquote|pre)\s*>/gi,'\n')
    .replace(/<[^>]*>/g,' ');
  const text = decodeEntities(visible).split('\n').map(line=>line.replace(/[ \t\f\v]+/g,' ').trim()).filter(Boolean).join('\n');
  return capturePlainText(text,Buffer.isBuffer(html) ? html : Buffer.from(html),[
    '提取静态HTML文字；未执行JavaScript、登录、获取图片或判断CSS隐藏状态。请核对导航、广告和正文。',
    '网页文字是待审阅来源，不构成系统指令或自动可信事实。'
  ]);
}
function wordXml(bytes: Buffer) {
  const xml = new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  if (/<!\s*(DOCTYPE|ENTITY)/i.test(xml) || XMLValidator.validate(xml) !== true) throw fail('Word正文XML无效或包含不支持的实体声明。');
  const parsed: unknown = new XMLParser({ignoreAttributes:true,preserveOrder:true,parseTagValue:false,trimValues:false,maxNestedTags:64,processEntities:true}).parse(xml);
  const paragraphs: string[] = [];
  function text(nodes: unknown): string {
    if (!Array.isArray(nodes)) return '';
    return nodes.map(node => {
      if (!node || typeof node !== 'object') return '';
      return Object.entries(node).map(([tag,value])=>{
        const name=tag.split(':').at(-1);
        if (name==='del' || name==='instrText' || name==='fldChar') return '';
        if (name==='#text') return String(value);
        if (name==='tab') return '\t';
        if (name==='br' || name==='cr') return '\n';
        return text(value);
      }).join('');
    }).join('');
  }
  function walk(nodes: unknown) {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (!node || typeof node!=='object') continue;
      for (const [tag,value] of Object.entries(node)) {
        if (tag.split(':').at(-1)==='p') { const paragraph=text(value).trim(); if(paragraph)paragraphs.push(paragraph); }
        else walk(value);
      }
    }
  }
  if (/<(?:\w+:)?altChunk\b/i.test(xml)) throw fail('Word包含外部嵌入正文，请另存为普通DOCX或复制需要的文字。');
  walk(parsed);
  return paragraphs.join('\n');
}
export async function captureDocx(bytes: Buffer): Promise<CapturedContent> {
  if (bytes.length > 8*1024*1024 || !bytes.subarray(0,4).equals(Buffer.from([80,75,3,4]))) throw fail('请使用8MB以内的无宏DOCX文件。');
  const files = await new Promise<Map<string,Buffer>>((resolve,reject)=>{
    let zip: ZipFile|undefined, failed=false, total=0, entries=0;
    const files=new Map<string,Buffer>(), seen=new Set<string>();
    function abort(error: unknown) { if(failed)return;failed=true;zip?.close();reject(error instanceof AppError ? error : fail('Word压缩结构无效。')); }
    fromBuffer(bytes,{lazyEntries:true,strictFileNames:true,validateEntrySizes:true},(error,opened)=>{
      if(error||!opened)return abort(error);zip=opened;
      if(zip.entryCount>1000)return abort(fail('Word包内文件过多，请简化文档。'));
      zip.on('error',abort);zip.on('end',()=>{if(!failed)resolve(files);});
      zip.on('entry',(entry:Entry)=>{
        const name=entry.fileName;
        if(++entries>1000 || seen.has(name) || name.includes('\\') || name.includes('\0') || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').includes('..') || (entry.generalPurposeBitFlag&1) || ![0,8].includes(entry.compressionMethod) || ((entry.externalFileAttributes>>>16)&0xf000)===0xa000) return abort(fail('Word包内含重复、加密、链接或无效路径。'));
        seen.add(name);
        total+=entry.uncompressedSize;
        if(entry.uncompressedSize>8*1024*1024 || total>24*1024*1024 || /vbaProject\.bin$/i.test(name))return abort(fail('Word包含宏或解压大小超限。'));
        if(!['[Content_Types].xml','word/document.xml'].includes(name)){zip!.readEntry();return;}
        zip!.openReadStream(entry,(streamError,stream)=>{
          if(streamError||!stream)return abort(streamError);
          const chunks:Buffer[]=[];let read=0;
          stream.on('error',abort);stream.on('data',(chunk:Buffer)=>{read+=chunk.length;if(read>8*1024*1024){stream.destroy();abort(fail('Word实际展开大小超限。'));}else chunks.push(chunk);});
          stream.on('end',()=>{if(!failed){files.set(name,Buffer.concat(chunks));zip!.readEntry();}});
        });
      });zip.readEntry();
    });
  });
  const types=files.get('[Content_Types].xml')?.toString('utf8'),document=files.get('word/document.xml');
  if(!document || !types || /macroEnabled/i.test(types) || !types.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml')) throw fail('文件不是支持的无宏Word DOCX。');
  return capturePlainText(wordXml(document),bytes,[
    '仅提取正文与表格段落；未导入图片、版式、页眉页脚、批注、脚注和嵌入对象。',
    '保留插入后的文字，忽略删除修订与字段指令；需人工核对原稿。'
  ]);
}
