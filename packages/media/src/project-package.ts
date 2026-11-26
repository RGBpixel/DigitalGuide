import fs from 'node:fs';
import { createHash,randomUUID } from 'node:crypto';
import { Readable,Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { crc32 } from 'node:zlib';
import * as yazl from 'yazl';
import * as yauzl from 'yauzl';
import type { PortableProject } from '@digitalguide/contracts';
import { AppError } from '@digitalguide/domain';
import { packageMaxBytes,packageManifestMaxBytes,validatePortableProject } from '../../domain/src/portable-project.js';
import { ownedFile } from './files.js';
const invalid = (message: string) => new AppError('INVALID_PROJECT_PACKAGE','工程包校验失败：'+message,422);
export async function writeProjectPackage(input: { portable: PortableProject;files: Record<string,string>;objects: string;file: string },signal: AbortSignal,onProgress: (progress: number) => void) {
  const p = validatePortableProject(input.portable),manifest = Buffer.from(JSON.stringify(p,null,2)),total = p.assets.reduce((n,a) => n+a.size,0),abort = new AbortController(),combined = AbortSignal.any([signal,abort.signal]);let read = 0,written = 0;
  if (manifest.length > packageManifestMaxBytes) throw invalid('工程清单超过8 MB。');
  const zip = new yazl.ZipFile();zip.on('error',e => (zip.outputStream as Readable).destroy(e));
  zip.addBuffer(manifest,'project.json',{ compress: true });
  for (const a of p.assets) zip.addReadStreamLazy(a.file,{ size: a.size,compress: false },callback => {
    const source = ownedFile(input.objects,input.files[a.id]),checked = Readable.from((async function* () {
      const hash = createHash('sha256');let size = 0;
      for await (const bytes of fs.createReadStream(source,{ signal: combined })) { size += bytes.length;if (size > a.size) throw invalid('源素材大小已变化，请重新上传。');hash.update(bytes);read += bytes.length;onProgress(total ? read/total : 1);yield bytes; }
      if (size !== a.size || hash.digest('hex') !== a.sha256) throw invalid('源素材校验不一致，请重新上传。');
    })());checked.once('error',e => (zip.outputStream as Readable).destroy(e));callback(null,checked);
  });
  const limit = new Transform({ transform(chunk: Buffer,_encoding,callback) { written += chunk.length;callback(written > packageMaxBytes ? invalid('ZIP超过1 GB，请拆分工程。') : null,chunk); } });
  try { zip.end();await pipeline(zip.outputStream,limit,fs.createWriteStream(input.file,{ flags: 'wx' }),{ signal: combined }); }
  finally { abort.abort(); }
}
export interface ExtractedProjectPackage { project: PortableProject;files: Record<string,string> }
export async function readProjectPackage(file: string,directory: string,signal: AbortSignal,onProgress: (progress: number) => void): Promise<ExtractedProjectPackage> {
  if (fs.statSync(file).size > packageMaxBytes) throw invalid('ZIP超过1 GB。');
  signal.throwIfAborted();
  const zip = await new Promise<yauzl.ZipFile>((resolve,reject) => yauzl.open(file,{ lazyEntries: true,autoClose: false,validateEntrySizes: true,strictFileNames: true },(e,z) => e ? reject(e) : resolve(z!)));
  let zipError: Error|null = null,active: Readable|null = null,metadataReject: ((e: Error) => void)|null = null;
  const onError = (e: Error) => { zipError = e;active?.destroy(e);metadataReject?.(e); },onAbort = () => { onError(invalid('检查已取消。'));zip.close(); };
  zip.on('error',onError);signal.addEventListener('abort',onAbort,{ once: true });
  try {
    if (signal.aborted) onAbort();
    const entries = await new Promise<Map<string,yauzl.Entry>>((resolve,reject) => {
      metadataReject = reject;if (zipError) return reject(zipError);const result = new Map<string,yauzl.Entry>();let total = 0;
      zip.on('entry',(entry: yauzl.Entry) => {
        try {
          signal.throwIfAborted();const name = entry.fileName,mode = (entry.externalFileAttributes >>> 16)&0xf000;
          if (!(name === 'project.json' || /^assets\/[a-f0-9-]{36}\.(png|wav|mp4|mov)$/.test(name)) || result.has(name.toLowerCase())) throw invalid('路径不受支持或重复。');
          if (entry.isEncrypted() || ![0,8].includes(entry.compressionMethod) || (mode && mode !== 0x8000) || (entry.externalFileAttributes&0x10)) throw invalid('不允许加密、链接、目录或特殊文件。');
          const max = name === 'project.json' ? packageManifestMaxBytes : name.endsWith('.mov')?packageMaxBytes:128*1024*1024;
          total += entry.uncompressedSize;if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize <= 0 || entry.uncompressedSize > max || total > packageMaxBytes || result.size >= 1001 || entry.uncompressedSize > Math.max(1024*1024,entry.compressedSize*200)) throw invalid('展开大小、数量或压缩比例超过限制。');
          result.set(name.toLowerCase(),entry);zip.readEntry();
        } catch (e) { reject(e); }
      });
      zip.once('end',() => resolve(result));zip.readEntry();
    });metadataReject = null;
    async function stream(entry: yauzl.Entry) {
      signal.throwIfAborted();if (zipError) throw zipError;
      const s = await new Promise<Readable>((resolve,reject) => zip.openReadStream(entry,(e,s) => e ? reject(e) : resolve(s!)));active = s;return s;
    }
    async function checked(entry: yauzl.Entry,consume: (bytes: Buffer) => Promise<void>|void) {
      let size = 0,crc = 0;const source = await stream(entry);
      try { for await (const buffer of source) { signal.throwIfAborted();const bytes = buffer as Buffer;size += bytes.length;if (size > entry.uncompressedSize) throw invalid('实际展开大小超过清单。');crc = crc32(bytes,crc);await consume(bytes); } }
      finally { active = null;source.destroy(); }
      if (size !== entry.uncompressedSize || crc !== entry.crc32) throw invalid('展开大小或CRC校验不一致。');
    }
    const manifest = entries.get('project.json');if (!manifest) throw invalid('缺少project.json。');const chunks: Buffer[] = [];await checked(manifest,b => { chunks.push(b); });
    let project: PortableProject;
    try { project = validatePortableProject(JSON.parse(new TextDecoder('utf-8',{ fatal: true }).decode(Buffer.concat(chunks)))); }
    catch (e) { if (e instanceof AppError) throw e;throw invalid('清单格式、版本或工程内容无效。'); }
    if (entries.size !== project.assets.length+1 || project.assets.some(a => entries.get(a.file)?.uncompressedSize !== a.size)) throw invalid('ZIP内容与素材清单不一致。');
    const files: Record<string,string> = {},total = project.assets.reduce((n,a) => n+a.size,0);let done = 0;
    for (const a of project.assets) {
      const entry = entries.get(a.file)!,destination = ownedFile(directory,randomUUID()+'.'+a.file.split('.').at(-1)),out = await fs.promises.open(destination,'wx'),hash = createHash('sha256');
      try { await checked(entry,async bytes => { hash.update(bytes);let offset = 0;while (offset < bytes.length) { const result = await out.write(bytes,offset,bytes.length-offset);if (!result.bytesWritten) throw invalid('临时文件写入失败。');offset += result.bytesWritten; }done += bytes.length;onProgress(total ? done/total : 1); }); }
      finally { await out.close(); }
      if (hash.digest('hex') !== a.sha256) throw invalid('源素材SHA-256不一致。');files[a.id] = destination;
    }
    return { project,files };
  } finally { signal.removeEventListener('abort',onAbort);zip.close(); }
}
